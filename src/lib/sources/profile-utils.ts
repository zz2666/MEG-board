import type {
  MetricUnit,
  MonetaryUnit,
  ParsedBusinessSegment,
  ParsedComparativeReport,
  ParsedFinancialMetric,
  ParsedQuickNote,
} from "./types";
import { htmlToText } from "./sec";

export type TripleValue = {
  current: number;
  previousQuarter: number | null;
  sameQuarterPriorYear: number;
  snippet: string;
  disclosedYoy?: number | null;
  disclosedQoq?: number | null;
};

export type ProfileCompanyContext = {
  companyName: string;
  periodLabel: string;
  currencyUnit: MonetaryUnit;
  sourceTitle: string;
};

export function round(value: number, decimals = 1) {
  return Number(value.toFixed(decimals));
}

export function normalizeText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function normalizeLabel(value: string) {
  return normalizeText(value)
    .replace(/[()]/g, "")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function stripFootnotes(value: string) {
  return value
    .replace(/\(\d+\)/g, " ")
    .replace(/\b\d+\b(?=\s*$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractRows(html: string) {
  return [...html.matchAll(/<TR[^>]*>[\s\S]*?<\/TR>/gi)].map((match) => match[0]);
}

function extractRowEntries(html: string) {
  return [...html.matchAll(/<TR[^>]*>[\s\S]*?<\/TR>/gi)].map((match) => ({
    html: match[0],
    index: match.index ?? 0,
  }));
}

export function rowText(rowHtml: string) {
  return htmlToText(rowHtml.replace(/<SUP[\s\S]*?<\/SUP>/gi, " "));
}

export function numberFromToken(token: string) {
  const cleaned = token
    .replace(/&nbsp;|&#160;|&#8194;|&#8201;|&#8202;/g, " ")
    .replace(/\s+/g, "")
    .replace(/[$￥¥HKDUSDRMB]/gi, "")
    .replace(/,/g, "");

  if (!cleaned || cleaned === "%" || cleaned === "-") return null;
  const isNegative = cleaned.includes("(") || cleaned.startsWith("-");
  const normalized = cleaned.replace(/[()%]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

export function extractNumbers(text: string) {
  return [...text.matchAll(/\(?-?\d[\d,]*(?:\.\d+)?\s*\)?\s*%?/g)]
    .map((match) => numberFromToken(match[0]))
    .filter((value): value is number => value !== null);
}

export function valuesFromRow(rowHtml: string, scale = 1) {
  const text = rowText(rowHtml)
    .replace(/&#8212;|&mdash;|—/g, " ")
    .replace(/&#149;/g, " ");
  return extractNumbers(text).map((value) => value * scale);
}

export function findRow(html: string, label: string, options: { occurrence?: number; after?: string } = {}) {
  const rows = extractRowEntries(html);
  const normalizedLabel = normalizeLabel(label);
  const afterOffset = options.after ? html.toLowerCase().indexOf(options.after.toLowerCase()) : -1;
  let seen = 0;

  for (const row of rows) {
    if (afterOffset >= 0 && row.index < afterOffset) continue;
    const text = normalizeLabel(stripFootnotes(rowText(row.html)));
    if (!text.includes(normalizedLabel)) continue;
    seen += 1;
    if (seen === (options.occurrence ?? 1)) return row.html;
  }

  throw new Error(`Unable to find table row: ${label}`);
}

function findRows(html: string, label: string, options: { after?: string } = {}) {
  const rows = extractRowEntries(html);
  const normalizedLabel = normalizeLabel(label);
  const afterOffset = options.after ? html.toLowerCase().indexOf(options.after.toLowerCase()) : -1;

  return rows
    .filter((row) => afterOffset < 0 || row.index >= afterOffset)
    .map((row) => row.html)
    .filter((row) => normalizeLabel(stripFootnotes(rowText(row))).includes(normalizedLabel));
}

export function rowToTriple(
  html: string,
  label: string,
  options: {
    sourceLabel?: string;
    scale?: number;
    occurrence?: number;
    after?: string;
    valueIndexes?: [number, number, number];
    minValues?: number;
    unitLabel?: string;
  } = {},
): TripleValue {
  const candidateRows = options.minValues
    ? findRows(html, label, options).filter((row) => valuesFromRow(row, options.scale ?? 1).length >= options.minValues!)
    : [findRow(html, label, options)];
  const row = candidateRows[(options.occurrence ?? 1) - 1];
  if (!row) {
    throw new Error(`Unable to find table row with enough values: ${label}`);
  }
  const values = valuesFromRow(row, options.scale ?? 1);
  const [sameIndex, previousIndex, currentIndex] = options.valueIndexes ?? [0, 1, 2];
  const sameQuarterPriorYear = values[sameIndex];
  const previousQuarter = values[previousIndex];
  const current = values[currentIndex];

  if (
    sameQuarterPriorYear === undefined ||
    previousQuarter === undefined ||
    current === undefined ||
    values.length < 3
  ) {
    throw new Error(`Unable to parse three comparable values from row: ${label}`);
  }

  return {
    sameQuarterPriorYear,
    previousQuarter,
    current,
    snippet: `${options.sourceLabel ?? label} table row: ${round(sameQuarterPriorYear, 4)}, ${round(
      previousQuarter,
      4,
    )}, ${round(current, 4)} ${options.unitLabel ?? ""}`.trim(),
  };
}

export function parseDisclosureChange(text: string, pattern: RegExp, label: string) {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Unable to parse disclosed change: ${label}`);
  }

  const phrase = match[1]?.toLowerCase() ?? "";
  const raw = Number.parseFloat(match[2]);
  return phrase.includes("decreas") || phrase.includes("down") ? -raw : raw;
}

export function yoy(current: number, prior: number) {
  return round(((current - prior) / prior) * 100);
}

export function qoq(current: number, previous: number) {
  return round(((current - previous) / previous) * 100);
}

export function maybeQoq(current: number, previous: number | null | undefined) {
  return previous === null || previous === undefined ? null : qoq(current, previous);
}

export function metric(
  name: string,
  normalized: string,
  value: number,
  unit: MetricUnit,
  sourceAnchor: string,
  options: Partial<Pick<ParsedFinancialMetric, "yoy" | "qoq" | "confidence" | "isManual">> = {},
): ParsedFinancialMetric {
  return {
    name,
    normalized,
    value: round(value, unit === "%" ? 1 : 4),
    unit,
    yoy: options.yoy ?? null,
    qoq: options.qoq ?? null,
    sourceAnchor,
    confidence: options.confidence ?? 0.92,
    isManual: options.isManual,
  };
}

export function segment(
  name: string,
  values: TripleValue,
  totalRevenue: number,
  revenueUnit: MonetaryUnit,
  driver: string,
  grossMargin?: number | null,
): ParsedBusinessSegment {
  return {
    name,
    revenue: round(values.current, 4),
    revenueUnit,
    share: round((values.current / totalRevenue) * 100),
    yoy: values.disclosedYoy ?? yoy(values.current, values.sameQuarterPriorYear),
    qoq: values.disclosedQoq ?? maybeQoq(values.current, values.previousQuarter),
    grossMargin: grossMargin ?? null,
    driver,
    confidence: 0.9,
  };
}

export function comparativeMetric(
  name: string,
  normalized: string,
  value: number,
  unit: MetricUnit,
  sourceAnchor: string,
): ParsedFinancialMetric {
  return metric(name, normalized, value, unit, sourceAnchor, { confidence: 0.88 });
}

export function buildStandardComparatives(params: {
  currencyUnit: MonetaryUnit;
  priorYearPeriod: {
    fiscalYear: number;
    fiscalQuarter: string;
    periodLabel: string;
    reportDate?: string;
  };
  previousQuarterPeriod: {
    fiscalYear: number;
    fiscalQuarter: string;
    periodLabel: string;
    reportDate?: string;
  };
  revenue: TripleValue;
  grossProfit: TripleValue;
  netIncome: TripleValue;
  operatingProfit?: TripleValue;
  operatingExpenses?: TripleValue;
}): ParsedComparativeReport[] {
  const periodRows = [
    {
      ...params.priorYearPeriod,
      revenue: params.revenue.sameQuarterPriorYear,
      grossProfit: params.grossProfit.sameQuarterPriorYear,
      netIncome: params.netIncome.sameQuarterPriorYear,
      operatingProfit: params.operatingProfit?.sameQuarterPriorYear,
      operatingExpenses: params.operatingExpenses?.sameQuarterPriorYear,
    },
    {
      ...params.previousQuarterPeriod,
      revenue: params.revenue.previousQuarter,
      grossProfit: params.grossProfit.previousQuarter,
      netIncome: params.netIncome.previousQuarter,
      operatingProfit: params.operatingProfit?.previousQuarter,
      operatingExpenses: params.operatingExpenses?.previousQuarter,
    },
  ];

  const usableRows = periodRows.flatMap((period) => {
    if (period.revenue === null || period.grossProfit === null || period.netIncome === null) return [];
    return [
      {
        ...period,
        revenue: period.revenue,
        grossProfit: period.grossProfit,
        netIncome: period.netIncome,
        operatingProfit: period.operatingProfit ?? undefined,
        operatingExpenses: period.operatingExpenses ?? undefined,
      },
    ];
  });

  return usableRows.map((period) => {
    const operatingProfit =
      period.operatingProfit ??
      (period.operatingExpenses === undefined ? undefined : period.grossProfit - period.operatingExpenses);
    const grossMargin = (period.grossProfit / period.revenue) * 100;
    const operatingMargin =
      operatingProfit === undefined ? undefined : (operatingProfit / period.revenue) * 100;
    const expenseRatio =
      period.operatingExpenses === undefined ? undefined : (period.operatingExpenses / period.revenue) * 100;

    return {
      fiscalYear: period.fiscalYear,
      fiscalQuarter: period.fiscalQuarter,
      periodLabel: period.periodLabel,
      reportDate: period.reportDate,
      metrics: [
        comparativeMetric("总营收", "revenue", period.revenue, params.currencyUnit, params.revenue.snippet),
        comparativeMetric("毛利润", "gross_profit", period.grossProfit, params.currencyUnit, params.grossProfit.snippet),
        comparativeMetric(
          "归母净利润",
          "net_income_attributable",
          period.netIncome,
          params.currencyUnit,
          params.netIncome.snippet,
        ),
        ...(operatingProfit === undefined
          ? []
          : [
              comparativeMetric(
                "营业利润",
                "operating_profit",
                operatingProfit,
                params.currencyUnit,
                params.operatingProfit?.snippet ?? "Derived from gross profit less operating expenses.",
              ),
              comparativeMetric(
                "营业利润率",
                "operating_margin",
                operatingMargin ?? 0,
                "%",
                "Derived from operating profit divided by revenue.",
              ),
            ]),
        comparativeMetric("毛利率", "gross_margin", grossMargin, "%", "Derived from gross profit divided by revenue."),
        ...(expenseRatio === undefined
          ? []
          : [
              comparativeMetric(
                "费用率",
                "expense_ratio",
                expenseRatio,
                "%",
                "Derived from operating expenses divided by revenue.",
              ),
            ]),
      ],
    };
  });
}

export function buildStandardQuickNote(params: {
  context: ProfileCompanyContext;
  revenue: TripleValue;
  grossProfit: TripleValue;
  netIncome: TripleValue;
  grossMargin: number;
  operatingProfit?: TripleValue;
  operatingMargin?: number;
  segments: ParsedBusinessSegment[];
  aiSummary?: string;
  sourceMap?: Record<string, string>;
}): ParsedQuickNote {
  const { context } = params;
  const revenueYoy = params.revenue.disclosedYoy ?? yoy(params.revenue.current, params.revenue.sameQuarterPriorYear);
  const revenueQoq = params.revenue.disclosedQoq ?? maybeQoq(params.revenue.current, params.revenue.previousQuarter);
  const netIncomeYoy = yoy(params.netIncome.current, params.netIncome.sameQuarterPriorYear);
  const topSegment = [...params.segments].sort((first, second) => (second.revenue ?? 0) - (first.revenue ?? 0))[0];
  const weakSegment = [...params.segments].sort((first, second) => (first.yoy ?? 0) - (second.yoy ?? 0))[0];

  return {
    headline: `${context.companyName} ${context.periodLabel} 总营收 ${context.currencyUnit.replace(" bn", "")}${round(
      params.revenue.current,
      2,
    )}bn，YoY ${revenueYoy}%，归母净利润 ${context.currencyUnit.replace(" bn", "")}${round(
      params.netIncome.current,
      2,
    )}bn；后续重点观察核心业务增长和 AI 商业化兑现。`,
    highlights: [
      `总营收 ${context.currencyUnit.replace(" bn", "")}${round(params.revenue.current, 2)}bn，YoY ${revenueYoy}%${
        revenueQoq === null ? "" : `，QoQ ${revenueQoq}%`
      }。`,
      `毛利率 ${round(params.grossMargin)}%，归母净利润 YoY ${netIncomeYoy}%。`,
      topSegment
        ? `${topSegment.name} 收入 ${context.currencyUnit.replace(" bn", "")}${round(topSegment.revenue ?? 0, 2)}bn，占比 ${topSegment.share}%。`
        : `${context.companyName} 公司级指标已抽取，业务分部等待官方公告 parser。`,
    ],
    weaknesses: [
      weakSegment
        ? `${weakSegment.name} YoY ${weakSegment.yoy}%，是本期需要跟踪的业务分部。`
        : "部分业务分部未披露完整同比，需要人工 review。",
      "市场反应和一致预期差异尚未接入实时行情源。",
      "AI 收入贡献仅采用官方披露口径，未披露部分不做推断。",
    ],
    segmentComments: Object.fromEntries(params.segments.map((item) => [item.name, item.driver ?? "官方披露分部收入已抽取。"])),
    marginComments: `毛利润 ${context.currencyUnit.replace(" bn", "")}${round(
      params.grossProfit.current,
      2,
    )}bn，毛利率 ${round(params.grossMargin)}%${
      params.operatingProfit && params.operatingMargin
        ? `；营业利润 ${context.currencyUnit.replace(" bn", "")}${round(
            params.operatingProfit.current,
            2,
          )}bn，营业利润率 ${round(params.operatingMargin)}%`
        : ""
    }。`,
    aiSummary: params.aiSummary ?? "财报中未披露可单独量化的 AI 收入贡献，当前仅记录官方提及的 AI 业务进展。",
    watchItems: ["核心业务收入增长持续性", "利润率变化与费用投放", "AI 产品收入是否进入公司级披露"],
    marketReaction: "行情反应待接入实时行情源校验。",
    sourceMap: params.sourceMap ?? {
      revenue: params.revenue.snippet,
      netIncome: params.netIncome.snippet,
      source: context.sourceTitle,
    },
  };
}
