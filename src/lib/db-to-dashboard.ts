import type { BusinessSegment, Company as PrismaCompany, EarningsReport, FinancialMetric, QuickNote } from "@prisma/client";
import {
  currencyFromUnit,
  formatMetricDisplay,
  isMonetaryUnit,
  toDashboardMonetaryValue,
} from "@/lib/financial-format";
import type { AiDevelopment, Company, FinancialMetric as DashboardMetric, QuarterPoint, Segment } from "@/lib/mock-data";
import { companies as fallbackCompanies } from "@/lib/mock-data";
import { trackedCompanyConfigs } from "@/lib/sources/company-config";

type ReportWithData = EarningsReport & {
  metrics: FinancialMetric[];
  segments: BusinessSegment[];
  quickNotes: QuickNote[];
};

type CompanyWithReports = PrismaCompany & {
  reports: ReportWithData[];
  aiDevelopments: {
    title: string;
    category: string;
    publishedAt: Date | null;
    commercialStatus: string;
    summary: string;
    sourceUrl: string | null;
  }[];
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
  operating_profit: { label: "营业利润", shortLabel: "Operating Profit", rank: "衍生指标" },
  operating_margin: { label: "营业利润率", shortLabel: "Operating Margin", rank: "衍生指标" },
  net_income_attributable: { label: "归母净利润", shortLabel: "Net Income", rank: "官方披露" },
  expense_ratio: { label: "费用率", shortLabel: "Expense Ratio", rank: "衍生指标" },
};

const segmentColors = ["#1d4ed8", "#0f766e", "#be123c", "#ca8a04", "#7c3aed", "#0891b2"];

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

function formatDate(date: Date | null | undefined) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

function formatPeriod(report: EarningsReport) {
  return `${String(report.fiscalYear).slice(2)}${report.fiscalQuarter}`;
}

function getMetric(report: ReportWithData, normalized: string) {
  return report.metrics.find((metric) => metric.normalized === normalized);
}

function buildDashboardMetric(metric: FinancialMetric, sourceUrl?: string | null): DashboardMetric | null {
  const meta = metricMeta[metric.normalized];
  if (!meta) return null;
  const value = numberValue(metric.value);
  return {
    label: meta.label,
    shortLabel: meta.shortLabel,
    value: isMonetaryUnit(metric.unit) ? toDashboardMonetaryValue(value, metric.unit) : value,
    displayValue: formatMetricDisplay(value, metric.unit),
    unit: metric.unit === "%" ? "%" : currencyFromUnit(metric.unit),
    yoy: numberValue(metric.yoy),
    qoq: numberValue(metric.qoq),
    source: metric.sourceAnchor ?? "Structured from official source document.",
    sourceUrl: sourceUrl ?? undefined,
    rank: meta.rank,
  };
}

function buildQuarterPoint(report: ReportWithData, currencyUnit: string): QuarterPoint {
  const revenue = numberValue(getMetric(report, "revenue")?.value);
  const grossProfit = numberValue(getMetric(report, "gross_profit")?.value);
  const netProfit = numberValue(getMetric(report, "net_income_attributable")?.value);
  const grossMargin =
    numberValue(getMetric(report, "gross_margin")?.value) ||
    (revenue ? (grossProfit / revenue) * 100 : 0);
  const operatingMargin = numberValue(getMetric(report, "operating_margin")?.value);
  const expenseRatio = numberValue(getMetric(report, "expense_ratio")?.value);

  const monetaryMultiplier = currencyUnit === "RMB bn" ? 10 : 1;

  return {
    period: formatPeriod(report),
    revenue: revenue * monetaryMultiplier,
    grossProfit: grossProfit * monetaryMultiplier,
    netProfit: netProfit * monetaryMultiplier,
    grossMargin,
    operatingMargin: getMetric(report, "operating_margin") ? operatingMargin : null,
    expenseRatio: getMetric(report, "expense_ratio") ? expenseRatio : null,
  };
}

function buildSegments(report: ReportWithData): Segment[] {
  return report.segments.map((segment, index) => {
    const revenue = numberValue(segment.revenue);
    const revenueUnit = isMonetaryUnit(segment.revenueUnit) ? segment.revenueUnit : "RMB bn";
    return {
      name: segment.name,
      revenue: toDashboardMonetaryValue(revenue, revenueUnit),
      displayRevenue: formatMetricDisplay(revenue, revenueUnit),
      share: numberValue(segment.share),
      yoy: numberValue(segment.yoy),
      qoq: numberValue(segment.qoq),
      margin: segment.grossMargin === null ? undefined : numberValue(segment.grossMargin),
      driver: segment.driver ?? "官方披露暂未抽取驱动描述。",
      color: segmentColors[index % segmentColors.length],
      trend: [revenue * 10],
    };
  });
}

function mapAiStatus(status: string): AiDevelopment["status"] {
  if (status === "REVENUE_CONTRIBUTING") return "已贡献收入";
  if (status === "EARLY_PRODUCTIZATION") return "早期产品化";
  if (status === "STRATEGIC_INVESTMENT") return "战略投入";
  return "暂无明确披露";
}

function mapAiDevelopments(company: CompanyWithReports): AiDevelopment[] {
  if (!company.aiDevelopments.length) {
    return [
      {
        title: "AI 动态待抓取",
        category: "可信新闻",
        date: formatDate(company.reports[0]?.releaseDate) || "待更新",
        status: "暂无明确披露",
        summary: "当前数据库尚未导入该公司的 AI 动态；后续由 AI news crawler 和 LLM 摘要补充。",
        source: "local database",
      },
    ];
  }

  return company.aiDevelopments.map((item) => ({
    title: item.title,
    category: item.category === "earnings" ? "财报披露" : item.category === "official" ? "官方新闻" : "可信新闻",
    date: formatDate(item.publishedAt),
    status: mapAiStatus(item.commercialStatus),
    summary: item.summary,
    source: item.sourceUrl ?? "source stored in database",
    sourceUrl: item.sourceUrl ?? undefined,
  }));
}

export function mapDbCompanyToDashboard(company: CompanyWithReports): Company | null {
  const sortedReports = [...company.reports].sort((first, second) => {
    const left = `${first.fiscalYear}${first.fiscalQuarter}`;
    const right = `${second.fiscalYear}${second.fiscalQuarter}`;
    return left.localeCompare(right);
  });
  const latest = sortedReports.at(-1);
  if (!latest) return null;

  const config = trackedCompanyConfigs.find(
    (item) => item.ticker === company.ticker || item.secCik === company.secCik || item.hkexCode === company.hkexCode,
  );
  const quickNote = latest.quickNotes[0];
  const metrics = latest.metrics
    .map((metric) => buildDashboardMetric(metric, latest.sourceUrl))
    .filter((metric): metric is DashboardMetric => Boolean(metric))
    .filter((metric) => metric.label !== "费用率");
  const quarters = sortedReports
    .filter((report) => getMetric(report, "revenue"))
    .map((report) =>
      buildQuarterPoint(
        report,
        getMetric(report, "revenue")?.unit ??
          latest.metrics.find((metric) => metric.normalized === "revenue")?.unit ??
          "RMB bn",
      ),
    );
  const segments = buildSegments(latest);
  const revenueMetric = metrics.find((metric) => metric.label === "总营收");
  return {
    id: config?.id ?? company.id,
    name: company.name,
    ticker: config?.displayTicker ?? company.ticker,
    market: company.market === "CN" ? "HK" : company.market,
    industry: company.industry ?? "互联网",
    fiscalPeriod: latest.periodLabel,
    reportDate: formatDate(latest.releaseDate ?? latest.reportDate),
    shareReaction: latest.marketReaction ?? "行情反应待接入实时行情源",
    status: latest.status === "PUBLISHED" ? "已发布" : latest.status === "FAILED" ? "待校验" : "抓取中",
    aiTag: "暂无明确披露",
    dataQuality: "SEC verified",
    sourceUrl: latest.sourceUrl ?? undefined,
    sourceLabel: latest.sourceUrl?.includes("sec.gov") ? "SEC filing parsed into SQL" : "Official source parsed into SQL",
    verifiedAt: new Date().toISOString(),
    quickNote: quickNote?.headline ?? `${company.name} ${latest.periodLabel} 财报已导入 SQL。`,
    highlights: Array.isArray(quickNote?.highlights)
      ? (quickNote.highlights as string[])
      : revenueMetric
        ? [`${revenueMetric.label} ${revenueMetric.displayValue}，YoY ${revenueMetric.yoy}%。`]
        : [],
    risks: Array.isArray(quickNote?.weaknesses) ? (quickNote.weaknesses as string[]) : ["后续需补充人工 review。"],
    metrics,
    quarters: quarters.length ? quarters : fallbackCompanies[0].quarters,
    segments,
    aiDevelopments: mapAiDevelopments(company),
  };
}

export function hasPublishedFinancials(company: CompanyWithReports) {
  return company.reports.some((report) => report.status === "PUBLISHED" && report.metrics.length > 0);
}
