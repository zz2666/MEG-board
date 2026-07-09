import "dotenv/config";
import { prisma } from "@/lib/db";
import { parsedReportToDashboardCompany } from "@/lib/parsed-to-dashboard";
import { writeEarningsSnapshot } from "@/lib/snapshot";
import { getCompanyConfig, trackedCompanyConfigs } from "@/lib/sources/company-config";
import { persistDiscoveredSourceOnly, persistParsedEarningsReport } from "@/lib/sources/persist";
import { parseEarningsReport } from "@/lib/sources/parser";
import { discoverLatestSecEarningsFiling, fetchSecText, htmlToText, sha256 } from "@/lib/sources/sec";
import type { CompanySourceConfig, ParsedEarningsReport } from "@/lib/sources/types";

type Args = {
  company?: string;
  period?: string;
  all?: boolean;
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
    if (arg === "--dry-run") args.dryRun = true;
    if (arg === "--snapshot") args.snapshot = true;
    if (arg === "--company") args.company = argv[index + 1];
    if (arg === "--period") args.period = argv[index + 1];
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
    "  npm run import:earnings -- --all",
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

async function fetchCompanyEarnings(config: CompanySourceConfig, period?: string): Promise<FetchResult> {
  if (config.sourceProvider !== "sec") {
    return {
      kind: "skipped",
      config,
      reason: `${config.sourceProvider} provider is scaffolded, but HKEX/IR PDF parsing is not implemented yet.`,
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

  if (!config.parserProfile) {
    const text = htmlToText(html);
    return {
      kind: "source-only",
      config,
      sourceTitle,
      sourceUrl,
      html,
      text,
      reason: "Official source was fetched, but no deterministic parser profile is configured for this company yet.",
    };
  }

  return {
    kind: "parsed",
    config,
    html,
    parsed: parseEarningsReport({
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

  if (!args.all && !args.company) {
    console.log(usage());
    process.exitCode = 1;
    return;
  }

  const configs = args.all
    ? trackedCompanyConfigs
    : [getCompanyConfig(args.company ?? "")].filter(
        (config): config is CompanySourceConfig => Boolean(config),
      );

  if (!configs.length) {
    throw new Error(`Unknown company: ${args.company}`);
  }

  const results: FetchResult[] = [];

  for (const config of configs) {
    const result = await fetchCompanyEarnings(config, args.period);
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
