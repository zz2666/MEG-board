import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/lib/db";
import { parsedReportToDashboardCompany } from "@/lib/parsed-to-dashboard";
import { writeEarningsSnapshot } from "@/lib/snapshot";
import { getCompanyConfig, trackedCompanyConfigs } from "@/lib/sources/company-config";
import { persistDiscoveredSourceOnly, persistParsedEarningsReport } from "@/lib/sources/persist";
import { parseEarningsReport } from "@/lib/sources/parser";
import { hasPdfTextCompanyProfile } from "@/lib/sources/pdf-text-profile";
import { discoverLatestSecEarningsFiling, fetchSecText, htmlToText, sha256 } from "@/lib/sources/sec";
import { hasSec6kCompanyProfile } from "@/lib/sources/sec-6k-standard-profile";
import type { CompanySourceConfig, ParsedEarningsReport } from "@/lib/sources/types";

type Args = {
  company?: string;
  period?: string;
  sourceUrl?: string;
  all?: boolean;
  implemented?: boolean;
  dryRun?: boolean;
  snapshot?: boolean;
};

type FetchResult =
  | {
      kind: "parsed";
      config: CompanySourceConfig;
      parsed: ParsedEarningsReport;
      html: string;
    }
  | {
      kind: "source-only";
      config: CompanySourceConfig;
      sourceTitle: string;
      sourceUrl: string;
      html: string;
      text: string;
      reason: string;
    }
  | {
      kind: "skipped";
      config: CompanySourceConfig;
      reason: string;
    };

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") args.all = true;
    if (arg === "--implemented") args.implemented = true;
    if (arg === "--dry-run") args.dryRun = true;
    if (arg === "--snapshot") args.snapshot = true;
    if (arg === "--company") args.company = argv[index + 1];
    if (arg === "--period") args.period = argv[index + 1];
    if (arg === "--source-url") args.sourceUrl = argv[index + 1];
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  npm run import:earnings -- --company netease --period 2026Q1",
    "  npm run import:earnings -- --company netease --period 2026Q1 --dry-run",
    "  npm run import:earnings -- --company netease --period 2026Q1 --snapshot",
    "  npm run import:earnings -- --company baidu",
    "  npm run import:earnings -- --company tencent --source-url https://official.example/results.pdf --dry-run",
    "  npm run import:earnings -- --all",
    "  npm run import:earnings -- --implemented --snapshot",
  ].join("\n");
}

function getReportTarget(config: CompanySourceConfig, period?: string) {
  if (period) {
    const target = config.knownReports?.[period];
    if (!target) {
      throw new Error(`${config.name} does not have a known report configured for ${period}`);
    }
    return target;
  }

  const knownReports = Object.values(config.knownReports ?? {});
  return knownReports.sort((first, second) => second.releaseDate.localeCompare(first.releaseDate))[0] ?? null;
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

async function fetchPdfText(url: string) {
  const isLocalFile =
    url.startsWith("file://") ||
    (!url.startsWith("http://") && !url.startsWith("https://") && url.includes("/"));
  if (!isLocalFile) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": process.env.SEC_USER_AGENT ?? "earnings-dashboard/0.1 contact: zhouziyi@example.com",
        Accept: "application/pdf,text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new Error(`source fetch failed ${response.status}: ${url}`);

    const contentType = response.headers.get("content-type") ?? "";
    const bytes = Buffer.from(await response.arrayBuffer());
    return contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")
      ? await parsePdfBytes(bytes)
      : htmlToText(bytes.toString("utf8"));
  }

  const bytes = await readFile(url.startsWith("file://") ? new URL(url) : url);
  return url.toLowerCase().endsWith(".pdf") ? parsePdfBytes(bytes) : htmlToText(bytes.toString("utf8"));
}

async function parsePdfBytes(bytes: Buffer) {
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

async function fetchDirectSourceOnly(
  config: CompanySourceConfig,
  sourceUrl: string,
  reason: string,
): Promise<FetchResult> {
  console.log(`fetching ${config.name}: ${sourceUrl}`);
  const text = await fetchPdfText(sourceUrl);
  return {
    kind: "source-only",
    config,
    sourceTitle: `${config.name} official source`,
    sourceUrl,
    html: text,
    text,
    reason,
  };
}

async function fetchDirectParsedSource(
  config: CompanySourceConfig,
  sourceUrl: string,
  sourceTitle: string,
  releaseDate: string,
): Promise<FetchResult> {
  console.log(`fetching ${config.name}: ${sourceUrl}`);
  const html = await fetchPdfText(sourceUrl);
  return {
    kind: "parsed",
    config,
    html,
    parsed: await parseEarningsReport({
      config,
      html,
      sourceUrl,
      sourceTitle,
      releaseDate,
    }),
  };
}

async function fetchCompanyEarnings(
  config: CompanySourceConfig,
  period?: string,
  sourceUrlOverride?: string,
): Promise<FetchResult> {
  if (config.sourceProvider !== "sec") {
    const knownReport = getReportTarget(config, period);
    const sourceUrl = sourceUrlOverride ?? knownReport?.sourceUrl;
    const sourceTitle = knownReport?.title ?? `${config.name} official source`;
    const releaseDate = knownReport?.releaseDate ?? new Date().toISOString();

    if (sourceUrl && config.parserProfile && isImplementedParser(config)) {
      return fetchDirectParsedSource(config, sourceUrl, sourceTitle, releaseDate);
    }

    if (sourceUrlOverride) {
      return fetchDirectSourceOnly(
        config,
        sourceUrlOverride,
        `${config.sourceProvider} source fetched and text extracted; deterministic parser profile is scaffolded but not yet implemented.`,
      );
    }

    return {
      kind: "skipped",
      config,
      reason: `${config.sourceProvider} provider is scaffolded. Configure a known report or pass --source-url with the official PDF/HTML announcement to extract source text.`,
    };
  }

  const knownReport = getReportTarget(config, period);
  const discovered = knownReport ? null : await discoverLatestSecEarningsFiling(config);
  const sourceUrl = knownReport?.sourceUrl ?? discovered?.documentUrl;
  const sourceTitle =
    knownReport?.title ??
    discovered?.primaryDocDescription ??
    `${config.name} SEC ${discovered?.form ?? "filing"}`;
  const releaseDate = knownReport?.releaseDate ?? discovered?.filingDate;

  if (!sourceUrl) {
    return {
      kind: "skipped",
      config,
      reason: "no SEC source URL discovered",
    };
  }

  console.log(`fetching ${config.name}: ${sourceUrl}`);
  const html = await fetchSecText(sourceUrl);

  if (!config.parserProfile || !isImplementedParser(config)) {
    const text = htmlToText(html);
    return {
      kind: "source-only",
      config,
      sourceTitle,
      sourceUrl,
      html,
      text,
      reason: config.parserProfile
        ? `Official source was fetched, but parser profile ${config.parserProfile} is scaffolded and not implemented yet.`
        : "Official source was fetched, but no deterministic parser profile is configured for this company yet.",
    };
  }

  return {
    kind: "parsed",
    config,
    html,
    parsed: await parseEarningsReport({
      config,
      html,
      sourceUrl,
      sourceTitle,
      releaseDate: releaseDate ?? new Date().toISOString(),
    }),
  };
}

function printDryRun(result: FetchResult) {
  if (result.kind === "skipped") {
    console.log(`skipped ${result.config.name}: ${result.reason}`);
    return;
  }

  if (result.kind === "source-only") {
    console.log(`dry-run source only for ${result.config.name}: ${result.sourceTitle}`);
    console.log(`source hash ${sha256(result.html)}`);
    console.log(result.text.slice(0, 360));
    return;
  }

  console.log(`dry-run parsed ${result.config.name} ${result.parsed.periodLabel}`);
  console.table(
    result.parsed.metrics.map((metric) => ({
      name: metric.name,
      value: metric.value,
      unit: metric.unit,
      yoy: metric.yoy,
      qoq: metric.qoq,
    })),
  );
  console.table(
    result.parsed.segments.map((segment) => ({
      name: segment.name,
      revenue: segment.revenue,
      share: segment.share,
      yoy: segment.yoy,
      qoq: segment.qoq,
    })),
  );
  console.log(`source hash ${result.parsed.contentHash}`);
  console.log(`source ${result.parsed.sourceUrl}`);
}

async function persistResult(result: FetchResult) {
  if (result.kind === "skipped") {
    console.log(`skipped ${result.config.name}: ${result.reason}`);
    return;
  }

  if (result.kind === "source-only") {
    await persistDiscoveredSourceOnly({
      prisma,
      config: result.config,
      title: result.sourceTitle,
      url: result.sourceUrl,
      rawText: result.text,
      contentHash: sha256(result.html),
      reason: result.reason,
    });
    console.log(`stored source only for ${result.config.name}; parser profile still needed`);
    return;
  }

  const persisted = await persistParsedEarningsReport(prisma, result.config, result.parsed);
  console.log(
    `imported ${result.config.name} ${result.parsed.periodLabel}: ${result.parsed.metrics.length} metrics, ${result.parsed.segments.length} segments, report=${persisted.report.id}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.all && !args.implemented && !args.company) {
    console.log(usage());
    process.exitCode = 1;
    return;
  }

  let configs: CompanySourceConfig[];
  if (args.implemented) {
    configs = trackedCompanyConfigs.filter((config) => isImplementedParser(config));
  } else if (args.all) {
    configs = trackedCompanyConfigs;
  } else {
    configs = [getCompanyConfig(args.company ?? "")].filter(
      (config): config is CompanySourceConfig => Boolean(config),
    );
  }

  if (!configs.length) {
    throw new Error(`Unknown company: ${args.company}`);
  }

  const results: FetchResult[] = [];

  for (const config of configs) {
    const result = await fetchCompanyEarnings(config, args.period, args.sourceUrl);
    results.push(result);

    if (args.dryRun) {
      printDryRun(result);
    } else if (!args.snapshot) {
      await persistResult(result);
    }
  }

  if (args.snapshot) {
    const parsedResults = results.filter(
      (result): result is Extract<FetchResult, { kind: "parsed" }> => result.kind === "parsed",
    );

    await writeEarningsSnapshot({
      generatedAt: new Date().toISOString(),
      provenance: {
        mode: "snapshot",
        note:
          "Temporary snapshot generated from official source parsers. This is a DB-free bridge until PostgreSQL is connected.",
        sourceUrls: parsedResults.map((result) => result.parsed.sourceUrl),
      },
      companies: parsedResults.map((result) => parsedReportToDashboardCompany(result.config, result.parsed)),
    });
    console.log(`wrote snapshot with ${parsedResults.length} parsed companies`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
