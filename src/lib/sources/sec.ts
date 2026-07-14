import { createHash } from "node:crypto";
import type { CompanySourceConfig, SecDiscoveredFiling } from "./types";
import { windowlessSetTimeout } from "./runtime";

export const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT ?? "earnings-dashboard/0.1 contact: zhouziyi@example.com";

type SecSubmissions = {
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
};

export type SecCompanyFacts = {
  cik: number;
  entityName: string;
  facts?: Record<
    string,
    Record<
      string,
      {
        label?: string;
        description?: string;
        units?: Record<
          string,
          Array<{
            start?: string;
            end?: string;
            filed?: string;
            form?: string;
            fp?: string;
            fy?: number;
            frame?: string;
            val?: number;
          }>
        >;
      }
    >
  >;
};

export function normalizeCik(cik: string) {
  return cik.replace(/\D/g, "").padStart(10, "0");
}

export function cikForArchives(cik: string) {
  return String(Number.parseInt(cik.replace(/\D/g, ""), 10));
}

export function accessionForArchives(accessionNumber: string) {
  return accessionNumber.replace(/-/g, "");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;|&#8217;|&#x2019;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&ndash;|&#8211;/g, "-")
    .replace(/&mdash;|&#8212;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&middot;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function secFetch(url: string, attempts = 3) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = windowlessSetTimeout(() => controller.abort(), Number(process.env.SEC_FETCH_TIMEOUT_MS ?? 15_000));
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": SEC_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`SEC fetch failed ${response.status}: ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(750 * attempt);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`SEC fetch failed: ${url}`);
}

export async function fetchSecText(url: string) {
  const response = await secFetch(url);
  return response.text();
}

export async function fetchSecJson<T>(url: string) {
  const response = await secFetch(url);
  return (await response.json()) as T;
}

export async function fetchSecSubmissions(cik: string) {
  const normalized = normalizeCik(cik);
  return fetchSecJson<SecSubmissions>(`https://data.sec.gov/submissions/CIK${normalized}.json`);
}

export async function fetchSecCompanyFacts(cik: string) {
  const normalized = normalizeCik(cik);
  return fetchSecJson<SecCompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${normalized}.json`);
}

export function buildSecDocumentUrl(cik: string, accessionNumber: string, primaryDocument: string) {
  return `https://www.sec.gov/Archives/edgar/data/${cikForArchives(cik)}/${accessionForArchives(
    accessionNumber,
  )}/${primaryDocument}`;
}

export function buildSecFilingUrl(cik: string, accessionNumber: string) {
  return `https://www.sec.gov/Archives/edgar/data/${cikForArchives(cik)}/${accessionForArchives(
    accessionNumber,
  )}/`;
}

function urlDirname(url: string) {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

function normalizeSecHref(baseUrl: string, href: string) {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `https://www.sec.gov${href}`;
  return `${urlDirname(baseUrl)}${href}`;
}

function hasStrongEarningsSignal(text: string) {
  return (
    /(?:announces|reports).{0,120}(?:quarter|annual|year).{0,120}(?:financial )?results/i.test(text) ||
    /unaudited financial results/i.test(text) ||
    /financial results/i.test(text) ||
    /total revenues? were/i.test(text) ||
    /net revenues? were/i.test(text) ||
    /revenue was/i.test(text)
  );
}

export async function resolveSecExhibitDocumentUrl(params: {
  cik: string;
  accessionNumber: string;
  primaryDocumentUrl: string;
  keywords?: string[];
  excludeKeywords?: string[];
}) {
  try {
    const baseFilingUrl = buildSecFilingUrl(params.cik, params.accessionNumber);
    const indexUrls = [
      `${baseFilingUrl}${params.accessionNumber}-index.html`,
      `${baseFilingUrl}${params.accessionNumber}-index.htm`,
    ];
    let indexHtml = "";
    let indexUrl = indexUrls[0];

    for (const candidateIndexUrl of indexUrls) {
      try {
        indexHtml = await fetchSecText(candidateIndexUrl);
        indexUrl = candidateIndexUrl;
        break;
      } catch {
        indexHtml = "";
      }
    }

    if (!indexHtml) {
      indexHtml = await fetchSecText(params.primaryDocumentUrl);
      indexUrl = params.primaryDocumentUrl;
    }

    const rowLinks = [...indexHtml.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)].flatMap((rowMatch) => {
      const rowHtml = rowMatch[0];
      const link = rowHtml.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) return [];

      return [
        {
          href: normalizeSecHref(indexUrl, link[1]),
          text: `${htmlToText(rowHtml)} ${htmlToText(link[2])}`,
        },
      ];
    });
    const looseLinks = [...indexHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
      href: normalizeSecHref(indexUrl, match[1]),
      text: htmlToText(match[2]),
    }));
    const links = [...rowLinks, ...looseLinks]
      .filter((link) => /\.(htm|html)$/i.test(link.href));
    const keywords = params.keywords?.map((keyword) => keyword.toLowerCase()) ?? [];
    const excludeKeywords = params.excludeKeywords?.map((keyword) => keyword.toLowerCase()) ?? [];
    const scoreLink = (link: { href: string; text: string }) => {
      const lower = `${link.href} ${link.text}`.toLowerCase();
      let score = 0;
      if (
        lower.includes("ex-99.1") ||
        lower.includes("exhibit 99.1") ||
        lower.includes("dex991") ||
        lower.includes("ex991") ||
        lower.includes("_ex99-1")
      ) {
        score += 80;
      } else if (lower.includes("ex99") || lower.includes("ex-99") || lower.includes("exhibit 99")) {
        score += 30;
      }
      if (lower.includes("press release") || lower.includes("financial results") || lower.includes("results")) score += 25;
      if (excludeKeywords.some((keyword) => lower.includes(keyword))) score -= 60;
      return score;
    };
    const candidates = [...links].sort((first, second) => scoreLink(second) - scoreLink(first));

    for (const candidate of candidates) {
      if (candidate.href === params.primaryDocumentUrl) continue;
      let text = "";
      try {
        text = htmlToText(await fetchSecText(candidate.href)).toLowerCase();
      } catch {
        continue;
      }
      const excluded = excludeKeywords.some((keyword) => text.includes(keyword));
      const matched = !keywords.length || keywords.some((keyword) => text.includes(keyword));
      if (matched && (!excluded || hasStrongEarningsSignal(text))) {
        return candidate.href;
      }
    }
  } catch {
    return params.primaryDocumentUrl;
  }

  return params.primaryDocumentUrl;
}

export async function discoverLatestSecEarningsFiling(
  config: CompanySourceConfig,
  options: {
    afterFilingDate?: string;
    maxCandidates?: number;
    fallbackToLatestCandidate?: boolean;
  } = {},
): Promise<SecDiscoveredFiling | null> {
  if (!config.secCik) return null;

  const submissions = await fetchSecSubmissions(config.secCik);
  const recent = submissions.filings?.recent;
  if (!recent?.accessionNumber?.length) return null;

  const keywords = config.filingKeywords?.map((keyword) => keyword.toLowerCase()) ?? [];
  const excludeKeywords = config.excludeFilingKeywords?.map((keyword) => keyword.toLowerCase()) ?? [];
  const forms = (config.filingForms?.length ? config.filingForms : ["6-K"]).map((form) => form.toUpperCase());
  let checkedCandidates = 0;
  let fallbackCandidate: SecDiscoveredFiling | null = null;

  for (let index = 0; index < recent.accessionNumber.length; index += 1) {
    const filingDate = recent.filingDate?.[index] ?? "";
    if (options.afterFilingDate && filingDate < options.afterFilingDate) break;

    const form = recent.form?.[index] ?? "";
    const primaryDocument = recent.primaryDocument?.[index] ?? "";
    const primaryDocDescription = recent.primaryDocDescription?.[index] ?? "";
    const upperForm = form.toUpperCase();
    const looksLikeTargetForm =
      forms.includes(upperForm) || forms.some((targetForm) => primaryDocDescription.toUpperCase().includes(targetForm));

    if (!looksLikeTargetForm || primaryDocument.includes("xsl")) continue;

    checkedCandidates += 1;
    if (checkedCandidates > (options.maxCandidates ?? 20)) break;

    const accessionNumber = recent.accessionNumber[index];
    const candidate = {
      accessionNumber,
      filingDate,
      reportDate: recent.reportDate?.[index],
      form,
      primaryDocument,
      primaryDocDescription,
      filingUrl: buildSecFilingUrl(config.secCik, accessionNumber),
      documentUrl: buildSecDocumentUrl(config.secCik, accessionNumber, primaryDocument),
    };

    if (!keywords.length) return candidate;

    try {
      const resolvedDocumentUrl =
        upperForm === "6-K"
          ? await resolveSecExhibitDocumentUrl({
              cik: config.secCik,
              accessionNumber,
              primaryDocumentUrl: candidate.documentUrl,
              keywords,
              excludeKeywords,
            })
          : candidate.documentUrl;
      candidate.documentUrl = resolvedDocumentUrl;
      const documentText = htmlToText(await fetchSecText(candidate.documentUrl)).toLowerCase();
      const excluded = excludeKeywords.some((keyword) => documentText.includes(keyword));
      if (!fallbackCandidate && !excluded) {
        fallbackCandidate = { ...candidate };
      }
      const matched = keywords.some((keyword) => documentText.includes(keyword));
      if (matched && (!excluded || hasStrongEarningsSignal(documentText))) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return options.fallbackToLatestCandidate ? fallbackCandidate : null;
}
