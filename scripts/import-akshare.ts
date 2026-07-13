import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Company } from "@/lib/mock-data";
import { parsedReportToDashboardCompany } from "@/lib/parsed-to-dashboard";
import { readEarningsSnapshot, writeEarningsSnapshot } from "@/lib/snapshot";
import { aksharePayloadToParsedReport, type AkshareCompanyPayload } from "@/lib/sources/akshare";
import { getCompanyConfig, trackedCompanyConfigs } from "@/lib/sources/company-config";
import type { CompanySourceConfig } from "@/lib/sources/types";

type Args = {
  company?: string;
  all?: boolean;
  snapshot?: boolean;
  dryRun?: boolean;
};

const pythonPath = ".venv/bin/python";

function parseArgs(argv: string[]) {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--company") args.company = argv[index + 1];
    if (arg === "--all") args.all = true;
    if (arg === "--snapshot") args.snapshot = true;
    if (arg === "--dry-run") args.dryRun = true;
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  npm run import:akshare -- --all --dry-run",
    "  npm run import:akshare -- --company tencent --dry-run",
    "  npm run import:akshare -- --all --snapshot",
    "  npm run snapshot:akshare",
  ].join("\n");
}

function akshareCurrency(config: CompanySourceConfig) {
  if (config.market === "US") return "USD";
  return "RMB";
}

function latestKnownReleaseDate(config: CompanySourceConfig) {
  return Object.values(config.knownReports ?? {})
    .sort((first, second) => second.releaseDate.localeCompare(first.releaseDate))[0]?.releaseDate;
}

function hasComputedMarketReaction(value?: string) {
  return Boolean(value && !["待接入", "未配置", "需接入"].some((keyword) => value.includes(keyword)));
}

function parsePythonJson(stdout: string) {
  const jsonLine = stdout
    .trim()
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  if (!jsonLine) throw new Error("AkShare provider did not emit JSON");
  return JSON.parse(jsonLine) as AkshareCompanyPayload;
}

function runAkshareProvider(config: CompanySourceConfig) {
  if (!existsSync(pythonPath)) {
    throw new Error(`${pythonPath} not found. Run: python3 -m venv .venv && .venv/bin/python -m pip install -r requirements-akshare.txt`);
  }

  const result = spawnSync(
    pythonPath,
    [
      "scripts/akshare-provider.py",
      "--company",
      config.id,
      "--name",
      config.name,
      "--market",
      config.market,
      "--ticker",
      config.ticker,
      "--hkex-code",
      config.hkexCode ?? "",
      "--currency",
      akshareCurrency(config),
      "--limit",
      "8",
      "--known-release-date",
      latestKnownReleaseDate(config) ?? "",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 16,
    },
  );

  if (result.status !== 0) {
    throw new Error(`AkShare provider failed for ${config.id}: ${result.stderr || result.stdout}`);
  }

  const payload = parsePythonJson(result.stdout);
  if (!payload.ok) throw new Error(`AkShare provider returned ok=false for ${config.id}`);
  return payload;
}

async function buildAkshareCompanies(configs: CompanySourceConfig[]) {
  const companies: Company[] = [];

  for (const config of configs) {
    console.log(`fetching AkShare ${config.name}`);
    const payload = runAkshareProvider(config);
    const parsed = aksharePayloadToParsedReport(config, payload);
    const company = parsedReportToDashboardCompany(config, parsed, {
      dataQuality: "AkShare third-party",
      sourceLabel: "AkShare / EastMoney third-party snapshot",
    });
    companies.push(company);

    console.log(
      `parsed ${config.name} ${parsed.periodLabel}: ${parsed.metrics.length} metrics, ${parsed.comparativeReports?.length ?? 0} history rows`,
    );
  }

  return companies;
}

function mergeOfficialSnapshot(akshareCompanies: Company[], officialCompanies: Company[]) {
  const merged = new Map<string, Company>();
  for (const company of akshareCompanies) merged.set(company.id, company);
  for (const company of officialCompanies) {
    const akshareCompany = merged.get(company.id);
    const computedReaction = hasComputedMarketReaction(akshareCompany?.shareReaction)
      ? akshareCompany?.shareReaction
      : undefined;
    merged.set(company.id, {
      ...company,
      shareReaction: computedReaction ?? company.shareReaction,
      risks: computedReaction
        ? company.risks.map((item) =>
            item.includes("市场反应") ? "行情反应已用 AkShare/EastMoney 历史日线初步校验，后续可切换授权行情源。" : item,
          )
        : company.risks,
    });
  }
  return trackedCompanyConfigs.flatMap((config) => {
    const company = merged.get(config.id);
    return company ? [company] : [];
  });
}

function mergeExistingSnapshot(akshareCompanies: Company[], existingCompanies: Company[]) {
  const merged = new Map<string, Company>();
  for (const company of existingCompanies) merged.set(company.id, company);
  for (const company of akshareCompanies) merged.set(company.id, company);
  return trackedCompanyConfigs.flatMap((config) => {
    const company = merged.get(config.id);
    return company ? [company] : [];
  });
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
    : [getCompanyConfig(args.company ?? "")].filter((config): config is CompanySourceConfig => Boolean(config));

  if (!configs.length) throw new Error(`Unknown company: ${args.company}`);

  const akshareCompanies = await buildAkshareCompanies(configs);
  if (args.dryRun) {
    console.table(
      akshareCompanies.map((company) => ({
        id: company.id,
        period: company.fiscalPeriod,
        quality: company.dataQuality,
        source: company.sourceLabel,
        revenue: company.metrics.find((metric) => metric.label === "总营收")?.displayValue,
        reportDate: company.reportDate,
      })),
    );
  }

  if (args.snapshot) {
    const existing = await readEarningsSnapshot();
    const officialCompanies = existing?.companies.filter((company) => company.dataQuality === "SEC verified") ?? [];
    const companies = args.all
      ? mergeOfficialSnapshot(akshareCompanies, officialCompanies)
      : mergeOfficialSnapshot(mergeExistingSnapshot(akshareCompanies, existing?.companies ?? []), officialCompanies);
    await writeEarningsSnapshot({
      generatedAt: new Date().toISOString(),
      provenance: {
        mode: "snapshot",
        note:
          "Snapshot combines official verified parsers when available with AkShare/EastMoney third-party historical indicators for broader coverage. Third-party rows are not official verified.",
        sourceUrls: companies.map((company) => company.sourceUrl).filter((url): url is string => Boolean(url)),
      },
      companies,
    });
    console.log(`wrote snapshot with ${companies.length} companies (${officialCompanies.length} official overrides)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
