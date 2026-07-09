import { createHash } from "node:crypto";
import type { CompanySourceConfig, SecDiscoveredFiling } from "./types";

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
    try {
      const response = await fetch(url, {
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
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`SEC fetch failed: ${url}`);
}

export async function fetchSecText(url: string) {
  const response = await secFetch(url);
  return response.text();
}

export async function fetchSecSubmissions(cik: string) {
  const normalized = normalizeCik(cik);
  const response = await secFetch(`https://data.sec.gov/submissions/CIK${normalized}.json`);
  return (await response.json()) as SecSubmissions;
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

export async function discoverLatestSecEarningsFiling(
  config: CompanySourceConfig,
): Promise<SecDiscoveredFiling | null> {
  if (!config.secCik) return null;

  const submissions = await fetchSecSubmissions(config.secCik);
  const recent = submissions.filings?.recent;
  if (!recent?.accessionNumber?.length) return null;

  const keywords = config.filingKeywords?.map((keyword) => keyword.toLowerCase()) ?? [];
  let checkedCandidates = 0;

  for (let index = 0; index < recent.accessionNumber.length; index += 1) {
    const form = recent.form?.[index] ?? "";
    const primaryDocument = recent.primaryDocument?.[index] ?? "";
    const primaryDocDescription = recent.primaryDocDescription?.[index] ?? "";
    const looksLike6k = form.toUpperCase() === "6-K" || primaryDocDescription.toUpperCase().includes("6-K");

    if (!looksLike6k || primaryDocument.includes("xsl")) continue;

    checkedCandidates += 1;
    if (checkedCandidates > 20) break;

    const accessionNumber = recent.accessionNumber[index];
    const candidate = {
      accessionNumber,
      filingDate: recent.filingDate?.[index] ?? "",
      reportDate: recent.reportDate?.[index],
      form,
      primaryDocument,
      primaryDocDescription,
      filingUrl: buildSecFilingUrl(config.secCik, accessionNumber),
      documentUrl: buildSecDocumentUrl(config.secCik, accessionNumber, primaryDocument),
    };

    if (!keywords.length) return candidate;

    try {
      const documentText = htmlToText(await fetchSecText(candidate.documentUrl)).toLowerCase();
      if (keywords.some((keyword) => documentText.includes(keyword))) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}
