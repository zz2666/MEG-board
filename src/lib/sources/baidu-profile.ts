import type { ParsedBusinessSegment, ParsedEarningsReport, ParsedFinancialMetric } from "./types";
import { htmlToText, sha256 } from "./sec";
import {
  buildStandardComparatives,
  buildStandardQuickNote,
  maybeQoq,
  metric,
  qoq,
  round,
  rowToTriple,
  segment,
  yoy,
} from "./profile-utils";
import type { TripleValue } from "./profile-utils";

const currencyUnit = "RMB bn" as const;

type ThreePeriodValue = TripleValue & { previousQuarter: number };

function requirePreviousQuarter(values: TripleValue, label: string): ThreePeriodValue {
  if (values.previousQuarter === null) {
    throw new Error(`Baidu profile requires a previous-quarter value for ${label}`);
  }
  return values as ThreePeriodValue;
}

function metricFromTriple(
  name: string,
  normalized: string,
  values: ReturnType<typeof rowToTriple>,
  options: { disclosedYoy?: number; disclosedQoq?: number; confidence?: number } = {},
): ParsedFinancialMetric {
  return metric(name, normalized, values.current, currencyUnit, values.snippet, {
    yoy: options.disclosedYoy ?? values.disclosedYoy ?? yoy(values.current, values.sameQuarterPriorYear),
    qoq: options.disclosedQoq ?? values.disclosedQoq ?? maybeQoq(values.current, values.previousQuarter),
    confidence: options.confidence ?? 0.92,
  });
}

export function parseBaiduQ12026SecReport(params: {
  companyId: string;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const rawText = htmlToText(params.html);
  const revenue = rowToTriple(params.html, "Revenue", {
    scale: 0.001,
    unitLabel: "RMB bn",
    after: "Condensed Consolidated Statements of Income",
  });
  const costOfRevenue = rowToTriple(params.html, "Cost of revenue", {
    scale: 0.001,
    unitLabel: "RMB bn",
    after: "Condensed Consolidated Statements of Income",
  });
  const operatingProfit = rowToTriple(params.html, "Operating income", {
    scale: 0.001,
    unitLabel: "RMB bn",
    after: "Condensed Consolidated Statements of Income",
  });
  const netIncome = rowToTriple(params.html, "Net income attributable to Baidu", {
    scale: 0.001,
    unitLabel: "RMB bn",
    after: "Condensed Consolidated Statements of Income",
  });
  const baiduGeneral = rowToTriple(params.html, "Revenue", {
    scale: 0.001,
    after: "Baidu General Business",
    valueIndexes: [0, 4, 8],
    minValues: 12,
    unitLabel: "RMB bn",
    sourceLabel: "Baidu General Business revenue",
  });
  const iqiyi = rowToTriple(params.html, "Revenue", {
    scale: 0.001,
    after: "Baidu General Business",
    valueIndexes: [1, 5, 9],
    minValues: 12,
    unitLabel: "RMB bn",
    sourceLabel: "iQIYI revenue",
  });
  const baiduCoreAi = rowToTriple(params.html, "Baidu Core AI-powered Business", {
    unitLabel: "RMB bn",
    valueIndexes: [0, 1, 2],
    after: "selected revenue highlights",
  });
  baiduCoreAi.disclosedYoy = 49;
  baiduCoreAi.disclosedQoq = 21;
  const aiCloudInfra = rowToTriple(params.html, "AI Cloud Infra", {
    unitLabel: "RMB bn",
    valueIndexes: [0, 1, 2],
    after: "selected revenue highlights",
  });
  aiCloudInfra.disclosedYoy = 79;
  aiCloudInfra.disclosedQoq = 52;
  const onlineMarketing = rowToTriple(params.html, "Online Marketing Services", {
    unitLabel: "RMB bn",
    valueIndexes: [0, 1, 2],
    after: "selected revenue highlights",
  });
  onlineMarketing.disclosedYoy = -22;
  onlineMarketing.disclosedQoq = -17;
  const aiApplicationsValue = rawText.match(/Revenue from AI Applications was RMB\s*([\d.]+)\s*billion/i);
  const aiApplicationsCurrent = aiApplicationsValue ? Number.parseFloat(aiApplicationsValue[1]) : null;
  const revenueWithQoq = requirePreviousQuarter(revenue, "revenue");
  const costOfRevenueWithQoq = requirePreviousQuarter(costOfRevenue, "cost of revenue");
  const operatingProfitWithQoq = requirePreviousQuarter(operatingProfit, "operating profit");

  const grossProfit = {
    current: revenue.current - costOfRevenue.current,
    previousQuarter: revenueWithQoq.previousQuarter - costOfRevenueWithQoq.previousQuarter,
    sameQuarterPriorYear: revenue.sameQuarterPriorYear - costOfRevenue.sameQuarterPriorYear,
    snippet: "Derived from revenue less cost of revenue.",
  };
  const operatingExpenses = {
    current: grossProfit.current - operatingProfit.current,
    previousQuarter: grossProfit.previousQuarter - operatingProfitWithQoq.previousQuarter,
    sameQuarterPriorYear: grossProfit.sameQuarterPriorYear - operatingProfit.sameQuarterPriorYear,
    snippet: "Derived from gross profit less operating income.",
  };
  const grossMargin = (grossProfit.current / revenue.current) * 100;
  const operatingMargin = (operatingProfit.current / revenue.current) * 100;
  const expenseRatio = (operatingExpenses.current / revenue.current) * 100;

  const segments: ParsedBusinessSegment[] = [
    segment("百度主体业务", baiduGeneral, revenue.current, currencyUnit, "Baidu General Business 收入恢复正增长，AI Cloud 是主要增量来源。"),
    segment("爱奇艺", iqiyi, revenue.current, currencyUnit, "iQIYI 收入同比下降，内容业务仍承压。"),
    segment("AI Cloud Infra", aiCloudInfra, revenue.current, currencyUnit, "企业 AI 基建需求推动 AI Cloud Infra 高增长。"),
    segment("在线营销服务", onlineMarketing, revenue.current, currencyUnit, "在线营销服务收入同比和环比下滑，传统广告仍是主要压力点。"),
    ...(aiApplicationsCurrent
      ? [
          {
            name: "AI Applications",
            revenue: aiApplicationsCurrent,
            revenueUnit: currencyUnit,
            share: round((aiApplicationsCurrent / revenue.current) * 100),
            yoy: 0,
            qoq: null,
            grossMargin: null,
            driver: "AI Applications 收入公告披露为同比基本持平。",
            confidence: 0.82,
          },
        ]
      : []),
  ];

  const metrics: ParsedFinancialMetric[] = [
    metricFromTriple("总营收", "revenue", revenue),
    metric("毛利润", "gross_profit", grossProfit.current, currencyUnit, grossProfit.snippet, {
      yoy: yoy(grossProfit.current, grossProfit.sameQuarterPriorYear),
      qoq: qoq(grossProfit.current, grossProfit.previousQuarter),
      confidence: 0.88,
    }),
    metric("毛利率", "gross_margin", grossMargin, "%", "Derived from gross profit divided by revenue.", {
      yoy: round(grossMargin - (grossProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq: round(grossMargin - (grossProfit.previousQuarter / revenueWithQoq.previousQuarter) * 100),
      confidence: 0.88,
    }),
    metric("营业费用", "operating_expenses", operatingExpenses.current, currencyUnit, operatingExpenses.snippet, {
      yoy: yoy(operatingExpenses.current, operatingExpenses.sameQuarterPriorYear),
      qoq: qoq(operatingExpenses.current, operatingExpenses.previousQuarter),
      confidence: 0.84,
    }),
    metricFromTriple("营业利润", "operating_profit", operatingProfit),
    metric("营业利润率", "operating_margin", operatingMargin, "%", "Derived from operating income divided by revenue.", {
      yoy: round(operatingMargin - (operatingProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq: round(operatingMargin - (operatingProfitWithQoq.previousQuarter / revenueWithQoq.previousQuarter) * 100),
      confidence: 0.88,
    }),
    metric("费用率", "expense_ratio", expenseRatio, "%", "Derived from operating expenses divided by revenue.", {
      yoy: round(expenseRatio - (operatingExpenses.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq: round(expenseRatio - (operatingExpenses.previousQuarter / revenueWithQoq.previousQuarter) * 100),
      confidence: 0.84,
    }),
    metricFromTriple("归母净利润", "net_income_attributable", netIncome),
    metricFromTriple("Baidu Core AI-powered Business 收入", "ai_core_revenue", baiduCoreAi, {
      disclosedYoy: baiduCoreAi.disclosedYoy ?? undefined,
      disclosedQoq: baiduCoreAi.disclosedQoq ?? undefined,
    }),
  ];

  return {
    companyId: params.companyId,
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    releaseDate: params.releaseDate,
    sourceTitle: params.sourceTitle,
    sourceUrl: params.sourceUrl,
    contentHash: sha256(params.html),
    rawText,
    metrics,
    segments,
    quickNote: buildStandardQuickNote({
      context: {
        companyName: "百度",
        periodLabel: "2026 Q1",
        currencyUnit,
        sourceTitle: params.sourceTitle,
      },
      revenue,
      grossProfit,
      netIncome,
      grossMargin,
      operatingProfit,
      operatingMargin,
      segments,
      aiSummary:
        "公告明确披露 Baidu Core AI-powered Business、AI Cloud Infra 和 AI Applications 收入，AI 已成为百度主体业务的核心增长来源之一。",
      sourceMap: {
        revenue: revenue.snippet,
        aiCloudInfra: aiCloudInfra.snippet,
        netIncome: netIncome.snippet,
      },
    }),
    comparativeReports: buildStandardComparatives({
      currencyUnit,
      priorYearPeriod: {
        fiscalYear: 2025,
        fiscalQuarter: "Q1",
        periodLabel: "2025 Q1",
        reportDate: "2025-03-31",
      },
      previousQuarterPeriod: {
        fiscalYear: 2025,
        fiscalQuarter: "Q4",
        periodLabel: "2025 Q4",
        reportDate: "2025-12-31",
      },
      revenue,
      grossProfit,
      netIncome,
      operatingProfit,
      operatingExpenses,
    }),
  };
}
