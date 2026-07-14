import { PDFParse } from "pdf-parse";
import { parsedReportToDashboardCompany } from "@/lib/parsed-to-dashboard";
import { prisma } from "@/lib/db";
import { readEarningsSnapshot, writeEarningsSnapshot } from "@/lib/snapshot";
import { getCompanyConfig } from "@/lib/sources/company-config";
import { persistDiscoveredSourceOnly, persistParsedEarningsReport } from "@/lib/sources/persist";
import { parseEarningsReport } from "@/lib/sources/parser";
import { hasPdfTextCompanyProfile } from "@/lib/sources/pdf-text-profile";
import { discoverLatestSecEarningsFiling, fetchSecText, htmlToText, sha256 } from "@/lib/sources/sec";
import { hasSec6kCompanyProfile } from "@/lib/sources/sec-6k-standard-profile";
import type { Company } from "@/lib/mock-data";
import type { CompanySourceConfig } from "@/lib/sources/types";

type RefreshOptions = {
  persist?: boolean;
  snapshot?: boolean;
  checkLatest?: boolean;
};

function shouldUseDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  return Boolean(databaseUrl && !databaseUrl.includes("localhost:5432"));
}

function isImplementedParser(config: CompanySourceConfig) {
  return (
    config.parserProfile === "netease-q1-2026" ||
    config.parserProfile === "baidu-q1-2026" ||
    config.parserProfile === "aeromexico-20f-2025" ||
    config.parserProfile === "sec-companyfacts-us-tech" ||
    (config.parserProfile === "sec-6k-standard" && hasSec6kCompanyProfile(config.id)) ||
    (config.parserProfile === "pdf-text-standard" && hasPdfTextCompanyProfile(config.id))
  );
}

async function mergeSnapshot(company: Company, sourceUrl: string) {
  const existing = await readEarningsSnapshot();
  const companies = existing?.companies.filter((item) => item.id !== company.id) ?? [];
  companies.unshift(company);

  await writeEarningsSnapshot({
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "snapshot",
      note: "Snapshot updated by manual earnings refresh.",
      sourceUrls: [...(existing?.provenance.sourceUrls ?? []), sourceUrl],
    },
    companies,
  });
}

async function resolveSource(config: CompanySourceConfig, options: Pick<RefreshOptions, "checkLatest"> = {}) {
  const knownReports = Object.values(config.knownReports ?? {});
  const latestKnown = knownReports.sort((first, second) => second.releaseDate.localeCompare(first.releaseDate))[0];
  const discovered =
    options.checkLatest && config.sourceProvider === "sec"
      ? await discoverLatestSecEarningsFiling(config, {
          afterFilingDate: latestKnown?.releaseDate.slice(0, 10),
          maxCandidates: 6,
        })
      : null;

  if (discovered && (!latestKnown || discovered.filingDate >= latestKnown.releaseDate.slice(0, 10))) {
    return {
      sourceUrl: discovered.documentUrl,
      sourceTitle: discovered.primaryDocDescription ?? `${config.name} ${discovered.form}`,
      releaseDate: discovered.filingDate,
      discovered: true,
    };
  }

  if (latestKnown) {
    return {
      sourceUrl: latestKnown.sourceUrl,
      sourceTitle: latestKnown.title,
      releaseDate: latestKnown.releaseDate,
      discovered: false,
    };
  }

  return null;
}

async function fetchGenericSourceText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.SEC_USER_AGENT ?? "earnings-dashboard/0.1 contact: zhouziyi@example.com",
      Accept: "application/pdf,text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`source fetch failed ${response.status}: ${url}`);

  const contentType = response.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!contentType.includes("pdf") && !url.toLowerCase().endsWith(".pdf")) {
    return htmlToText(bytes.toString("utf8"));
  }

  const parser = new PDFParse({ data: bytes });
  try {
    const text = await parser.getText();
    return text.text
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } finally {
    await parser.destroy();
  }
}

export async function refreshCompanyEarnings(companyId: string, options: RefreshOptions = {}) {
  const config = getCompanyConfig(companyId);
  if (!config) throw new Error(`Unknown company: ${companyId}`);

  const source = await resolveSource(config, { checkLatest: options.checkLatest ?? false });
  if (!source) {
    return {
      status: "skipped" as const,
      companyId: config.id,
      message: "No official earnings source was discovered.",
    };
  }

  const html =
    config.sourceProvider === "sec"
      ? await fetchSecText(source.sourceUrl)
      : await fetchGenericSourceText(source.sourceUrl);
  if (!config.parserProfile || !isImplementedParser(config)) {
    if (options.persist && shouldUseDatabase()) {
      await persistDiscoveredSourceOnly({
        prisma,
        config,
        title: source.sourceTitle,
        url: source.sourceUrl,
        rawText: htmlToText(html),
        contentHash: sha256(html),
        reason: "Official source fetched, but deterministic parser is not implemented.",
      });
    }

    return {
      status: "source-only" as const,
      companyId: config.id,
      sourceUrl: source.sourceUrl,
      message: "Official source was fetched, but parser is not implemented.",
    };
  }

  const parsed = await parseEarningsReport({
    config,
    html,
    sourceUrl: source.sourceUrl,
    sourceTitle: source.sourceTitle,
    releaseDate: source.releaseDate,
  });
  const company = parsedReportToDashboardCompany(config, parsed);

  if (options.persist && shouldUseDatabase()) {
    await persistParsedEarningsReport(prisma, config, parsed);
  }

  if (options.snapshot ?? !shouldUseDatabase()) {
    await mergeSnapshot(company, parsed.sourceUrl);
  }

  return {
    status: "published" as const,
    companyId: config.id,
    sourceUrl: parsed.sourceUrl,
    message: `${config.name} ${parsed.periodLabel} parsed and updated.`,
    company,
  };
}
