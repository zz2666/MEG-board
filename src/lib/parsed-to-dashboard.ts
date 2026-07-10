import type {
  Company,
  FinancialMetric as DashboardMetric,
  QuarterPoint,
  Segment,
} from "@/lib/mock-data";
import {
  currencyFromUnit,
  formatMetricDisplay,
  isMonetaryUnit,
  toDashboardMonetaryValue,
} from "@/lib/financial-format";
import type { CompanySourceConfig } from "@/lib/sources/types";
import type {
  ParsedBusinessSegment,
  ParsedEarningsReport,
  ParsedFinancialMetric,
  ParsedQuickNote,
} from "@/lib/sources/types";

type ReportLike = {
  fiscalYear: number;
  fiscalQuarter: string;
  periodLabel: string;
  reportDate?: string;
  releaseDate?: string;
  metrics: ParsedFinancialMetric[];
};

const metricMeta: Record<
  string,
  {
    label: string;
    shortLabel: string;
    rank: string;
  }
> = {
  revenue: { label: "总营收", shortLabel: "Revenue", rank: "官方披露" },
  gross_profit: { label: "毛利润", shortLabel: "Gross Profit", rank: "官方披露" },
  gross_margin: { label: "毛利率", shortLabel: "Gross Margin", rank: "衍生指标" },
  operating_profit: { label: "营业利润", shortLabel: "Operating Profit", rank: "官方披露" },
  operating_margin: { label: "营业利润率", shortLabel: "Operating Margin", rank: "衍生指标" },
  net_income_attributable: { label: "归母净利润", shortLabel: "Net Income", rank: "官方披露" },
};

const segmentColors = ["#1d4ed8", "#0f766e", "#be123c", "#ca8a04", "#7c3aed", "#0891b2"];

function round(value: number, decimals = 1) {
  return Number(value.toFixed(decimals));
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function formatPeriod(report: Pick<ReportLike, "fiscalYear" | "fiscalQuarter">) {
  return `${String(report.fiscalYear).slice(2)}${report.fiscalQuarter}`;
}

function metricValue(report: ReportLike, normalized: string) {
  return report.metrics.find((metric) => metric.normalized === normalized)?.value ?? 0;
}

function buildDashboardMetric(metric: ParsedFinancialMetric): DashboardMetric | null {
  const meta = metricMeta[metric.normalized];
  if (!meta) return null;

  return {
    label: meta.label,
    shortLabel: meta.shortLabel,
    value: isMonetaryUnit(metric.unit) ? toDashboardMonetaryValue(metric.value, metric.unit) : metric.value,
    displayValue: formatMetricDisplay(metric.value, metric.unit),
    unit: metric.unit === "%" ? "%" : currencyFromUnit(metric.unit),
    yoy: metric.yoy ?? 0,
    qoq: metric.qoq ?? 0,
    source: metric.sourceAnchor,
    sourceUrl: undefined,
    rank: meta.rank,
  };
}

function buildQuarterPoint(report: ReportLike, currencyUnit: string): QuarterPoint {
  const revenue = metricValue(report, "revenue");
  const grossProfit = metricValue(report, "gross_profit");
  const netProfit = metricValue(report, "net_income_attributable");
  const grossMargin = metricValue(report, "gross_margin") || (revenue ? (grossProfit / revenue) * 100 : 0);
  const operatingMargin = metricValue(report, "operating_margin");
  const expenseRatio = metricValue(report, "expense_ratio");

  const monetaryMultiplier = currencyUnit === "RMB bn" ? 10 : 1;

  return {
    period: formatPeriod(report),
    revenue: round(revenue * monetaryMultiplier),
    grossProfit: round(grossProfit * monetaryMultiplier),
    netProfit: round(netProfit * monetaryMultiplier),
    grossMargin: round(grossMargin),
    operatingMargin: round(operatingMargin),
    expenseRatio: round(expenseRatio),
  };
}

function buildSegments(segments: ParsedBusinessSegment[]): Segment[] {
  return segments.map((segment, index) => {
    const revenue = segment.revenue ?? 0;
    const revenueUnit = segment.revenueUnit ?? "RMB bn";
    return {
      name: segment.name,
      revenue: round(toDashboardMonetaryValue(revenue, revenueUnit)),
      displayRevenue: formatMetricDisplay(revenue, revenueUnit),
      share: segment.share ?? 0,
      yoy: segment.yoy ?? 0,
      qoq: segment.qoq ?? 0,
      margin: segment.grossMargin ?? undefined,
      driver: segment.driver ?? "官方披露暂未抽取驱动描述。",
      color: segmentColors[index % segmentColors.length],
      trend: [round(revenue * 10)],
    };
  });
}

function quickNoteArray(value: string[] | undefined, fallback: string[]) {
  return value?.length ? value : fallback;
}

function marketReaction(note: ParsedQuickNote) {
  return note.marketReaction ?? "行情反应待接入实时行情源";
}

export function parsedReportToDashboardCompany(
  config: CompanySourceConfig,
  parsed: ParsedEarningsReport,
  options: {
    dataQuality?: Company["dataQuality"];
    sourceLabel?: string;
  } = {},
): Company {
  const comparativeReports = parsed.comparativeReports ?? [];
  const reports: ReportLike[] = [
    ...comparativeReports,
    {
      fiscalYear: parsed.fiscalYear,
      fiscalQuarter: parsed.fiscalQuarter,
      periodLabel: parsed.periodLabel,
      reportDate: parsed.reportDate,
      releaseDate: parsed.releaseDate,
      metrics: parsed.metrics,
    },
  ].sort((first, second) => `${first.fiscalYear}${first.fiscalQuarter}`.localeCompare(`${second.fiscalYear}${second.fiscalQuarter}`));
  const metrics = parsed.metrics
    .map(buildDashboardMetric)
    .filter((metric): metric is DashboardMetric => Boolean(metric));
  const currencyUnit =
    parsed.metrics.find((metric) => metric.normalized === "revenue" && isMonetaryUnit(metric.unit))?.unit ??
    "RMB bn";

  return {
    id: config.id,
    name: config.name,
    ticker: config.displayTicker,
    market: config.market === "CN" ? "HK" : config.market,
    industry: config.industry,
    fiscalPeriod: parsed.periodLabel,
    reportDate: formatDate(parsed.releaseDate ?? parsed.reportDate),
    shareReaction: marketReaction(parsed.quickNote),
    status: "已发布",
    aiTag: "早期产品化",
    dataQuality: options.dataQuality ?? "SEC verified",
    sourceUrl: parsed.sourceUrl,
    sourceLabel: options.sourceLabel ?? "SEC filing snapshot",
    verifiedAt: new Date().toISOString(),
    quickNote: parsed.quickNote.headline,
    highlights: quickNoteArray(parsed.quickNote.highlights, [`${config.name} ${parsed.periodLabel} 财报已由官方来源解析。`]),
    risks: quickNoteArray(parsed.quickNote.weaknesses, ["后续需补充人工 review。"]),
    metrics,
    quarters: reports.map((report) => buildQuarterPoint(report, currencyUnit)),
    segments: buildSegments(parsed.segments),
    aiDevelopments: [
      {
        title: "财报披露中的 AI 相关信息",
        category: "财报披露",
        date: formatDate(parsed.releaseDate),
        status: parsed.quickNote.aiSummary ? "早期产品化" : "暂无明确披露",
        summary: parsed.quickNote.aiSummary ?? "当前 snapshot 尚未接入独立 AI 新闻抓取。",
        source: parsed.sourceTitle,
        sourceUrl: parsed.sourceUrl,
      },
    ],
  };
}
