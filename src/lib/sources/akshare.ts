import type { CompanySourceConfig, ParsedEarningsReport, ParsedFinancialMetric } from "./types";
import { buildStandardQuickNote, round } from "./profile-utils";
import { sha256 } from "./sec";

type AkshareMetricPayload = Pick<
  ParsedFinancialMetric,
  "name" | "normalized" | "value" | "unit" | "yoy" | "qoq" | "sourceAnchor" | "confidence"
>;

export type AkshareReportPayload = {
  fiscalYear: number;
  fiscalQuarter: string;
  periodLabel: string;
  reportDate?: string | null;
  releaseDate?: string | null;
  marketReaction?: string | null;
  marketReactionSource?: string | null;
  marketReactionError?: string | null;
  currencyUnit: "RMB bn" | "USD bn" | "HKD bn";
  metrics: AkshareMetricPayload[];
};

export type AkshareCompanyPayload = {
  ok: boolean;
  provider: "akshare";
  companyId: string;
  companyName: string;
  market: string;
  ticker: string;
  sourceTitle: string;
  sourceUrl: string;
  reports: AkshareReportPayload[];
};

function metricValue(report: AkshareReportPayload, normalized: string) {
  return report.metrics.find((metric) => metric.normalized === normalized)?.value ?? null;
}

function metricPayload(report: AkshareReportPayload, normalized: string) {
  return report.metrics.find((metric) => metric.normalized === normalized) ?? null;
}

function requireMetric(report: AkshareReportPayload, normalized: string) {
  const item = metricPayload(report, normalized);
  if (!item) throw new Error(`AkShare payload missing metric: ${normalized}`);
  return item;
}

function comparativeReports(payload: AkshareCompanyPayload) {
  return payload.reports.slice(1).map((report) => ({
    fiscalYear: report.fiscalYear,
    fiscalQuarter: report.fiscalQuarter,
    periodLabel: report.periodLabel,
    reportDate: report.reportDate ?? undefined,
    releaseDate: report.releaseDate ?? undefined,
    metrics: report.metrics.map((metric) => ({ ...metric, confidence: metric.confidence ?? 0.68 })),
  }));
}

export function aksharePayloadToParsedReport(
  config: CompanySourceConfig,
  payload: AkshareCompanyPayload,
): ParsedEarningsReport {
  const latest = payload.reports[0];
  if (!latest) {
    throw new Error(`AkShare payload has no reports for ${config.id}`);
  }

  const revenue = requireMetric(latest, "revenue");
  const grossProfit = metricPayload(latest, "gross_profit");
  const grossMargin = metricValue(latest, "gross_margin");
  const netIncome = requireMetric(latest, "net_income_attributable");
  const rawText = JSON.stringify(payload);
  const grossProfitValue = grossProfit?.value ?? (grossMargin === null ? 0 : revenue.value * grossMargin / 100);
  const effectiveGrossMargin = grossMargin ?? (revenue.value ? (grossProfitValue / revenue.value) * 100 : 0);

  const parsed: ParsedEarningsReport = {
    companyId: config.id,
    fiscalYear: latest.fiscalYear,
    fiscalQuarter: latest.fiscalQuarter,
    periodLabel: latest.periodLabel,
    reportDate: latest.reportDate ?? undefined,
    releaseDate: latest.releaseDate ?? latest.reportDate ?? undefined,
    sourceTitle: payload.sourceTitle,
    sourceUrl: payload.sourceUrl,
    contentHash: sha256(rawText),
    rawText,
    metrics: latest.metrics.map((metric) => ({
      ...metric,
      confidence: metric.confidence ?? 0.68,
    })),
    segments: [],
    quickNote: buildStandardQuickNote({
      context: {
        companyName: config.name,
        periodLabel: latest.periodLabel,
        currencyUnit: latest.currencyUnit,
        sourceTitle: payload.sourceTitle,
      },
      revenue: {
        current: revenue.value,
        previousQuarter: null,
        sameQuarterPriorYear:
          revenue.yoy === null || revenue.yoy === undefined
            ? revenue.value
            : revenue.value / (1 + revenue.yoy / 100),
        disclosedYoy: revenue.yoy,
        disclosedQoq: revenue.qoq,
        snippet: revenue.sourceAnchor,
      },
      grossProfit: {
        current: grossProfitValue,
        previousQuarter: null,
        sameQuarterPriorYear:
          grossProfit?.yoy === null || grossProfit?.yoy === undefined
            ? grossProfitValue
            : grossProfitValue / (1 + grossProfit.yoy / 100),
        disclosedYoy: grossProfit?.yoy,
        disclosedQoq: grossProfit?.qoq,
        snippet: grossProfit?.sourceAnchor ?? "Derived from AkShare gross margin and revenue.",
      },
      netIncome: {
        current: netIncome.value,
        previousQuarter: null,
        sameQuarterPriorYear:
          netIncome.yoy === null || netIncome.yoy === undefined
            ? netIncome.value
            : netIncome.value / (1 + netIncome.yoy / 100),
        disclosedYoy: netIncome.yoy,
        disclosedQoq: netIncome.qoq,
        snippet: netIncome.sourceAnchor,
      },
      grossMargin: round(effectiveGrossMargin),
      segments: [],
      aiSummary:
        "AkShare only provides third-party financial indicators here; AI revenue and product updates remain pending official-source extraction.",
      sourceMap: {
        revenue: revenue.sourceAnchor,
        netIncome: netIncome.sourceAnchor,
        source: payload.sourceUrl,
        ...(latest.marketReactionSource ? { marketReaction: latest.marketReactionSource } : {}),
      },
    }),
    comparativeReports: comparativeReports(payload),
  };

  parsed.quickNote.marketReaction = latest.marketReaction ?? parsed.quickNote.marketReaction;

  if (latest.marketReaction) {
    parsed.quickNote.weaknesses = parsed.quickNote.weaknesses.map((item) =>
      item.includes("市场反应") ? "行情反应已用 AkShare/EastMoney 历史日线初步校验，后续可切换授权行情源。" : item,
    );
  }

  return parsed;
}
