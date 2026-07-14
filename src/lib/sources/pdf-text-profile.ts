import type {
  MonetaryUnit,
  ParsedEarningsReport,
  ParsedFinancialMetric,
} from "./types";
import {
  buildStandardComparatives,
  buildStandardQuickNote,
  maybeQoq,
  metric,
  round,
  segment,
  type TripleValue,
} from "./profile-utils";
import { sha256 } from "./sec";

type RowValueIndexes = {
  current: number;
  priorYear: number;
  previousQuarter?: number;
};

type PdfTextRowProfile = {
  label: string;
  occurrence?: number;
  after?: string;
  before?: string;
  valueIndexes?: RowValueIndexes;
  sourceLabel?: string;
};

type PdfTextSegmentProfile = PdfTextRowProfile & {
  name: string;
  driver: string;
  disclosedYoy?: number | null;
  disclosedQoq?: number | null;
};

type PdfTextCompanyProfile = {
  fiscalYear: number;
  fiscalQuarter: string;
  periodLabel: string;
  reportDate?: string;
  currencyUnit: MonetaryUnit;
  scale: number;
  defaultValueIndexes: RowValueIndexes;
  revenue: PdfTextRowProfile;
  grossProfit?: PdfTextRowProfile;
  costOfRevenue?: PdfTextRowProfile;
  operatingProfit: PdfTextRowProfile;
  netIncome: PdfTextRowProfile;
  segments: PdfTextSegmentProfile[];
  priorYearPeriod: {
    fiscalYear: number;
    fiscalQuarter: string;
    periodLabel: string;
    reportDate?: string;
  };
  previousQuarterPeriod?: {
    fiscalYear: number;
    fiscalQuarter: string;
    periodLabel: string;
    reportDate?: string;
  };
  aiSummary?: string;
};

const pdfTextCompanyProfiles: Record<string, PdfTextCompanyProfile> = {
  tencent: {
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    currencyUnit: "RMB bn",
    scale: 0.001,
    defaultValueIndexes: { current: 0, priorYear: 1, previousQuarter: 2 },
    revenue: { label: "Revenues", after: "CONSOLIDATED INCOME STATEMENT", sourceLabel: "Revenues" },
    grossProfit: { label: "Gross profit", after: "CONSOLIDATED INCOME STATEMENT" },
    operatingProfit: { label: "Operating profit", after: "CONSOLIDATED INCOME STATEMENT" },
    netIncome: {
      label: "Equity holders of the Company",
      after: "Attributable to:",
      sourceLabel: "Profit attributable to equity holders of the Company",
    },
    segments: [
      {
        name: "VAS",
        label: "VAS",
        after: "CONSOLIDATED INCOME STATEMENT",
        driver: "增值服务收入，包含游戏与社交网络。",
      },
      {
        name: "Marketing Services",
        label: "Marketing Services",
        after: "CONSOLIDATED INCOME STATEMENT",
        driver: "广告与营销服务收入，受 AI 推荐模型和微信生态闭环能力提升驱动。",
      },
      {
        name: "FinTech and Business Services",
        label: "FinTech and Business Services",
        after: "CONSOLIDATED INCOME STATEMENT",
        driver: "金融科技及企业服务收入，包含支付、理财、云及企业服务。",
      },
      {
        name: "Others",
        label: "Others",
        after: "CONSOLIDATED INCOME STATEMENT",
        driver: "其他业务收入。",
      },
    ],
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
    aiSummary:
      "公告披露腾讯继续投入混元、元宝、CodeBuddy、WorkBuddy 等 AI 产品，广告推荐模型和生产力 AI agent 已进入业务场景。",
  },
  kuaishou: {
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    currencyUnit: "RMB bn",
    scale: 0.001,
    defaultValueIndexes: { current: 0, priorYear: 1 },
    revenue: {
      label: "Revenues",
      after: "CONSOLIDATED INCOME STATEMENT",
      valueIndexes: { current: 1, priorYear: 2 },
    },
    grossProfit: { label: "Gross profit", after: "CONSOLIDATED INCOME STATEMENT" },
    operatingProfit: { label: "Operating profit", after: "CONSOLIDATED INCOME STATEMENT" },
    netIncome: {
      label: "Equity holders of the Company",
      after: "Attributable to:",
      valueIndexes: { current: 0, priorYear: 1 },
      sourceLabel: "Profit attributable to equity holders of the Company",
    },
    segments: [
      {
        name: "Online marketing services",
        label: "Online marketing services",
        after: "revenues by type",
        driver: "线上营销服务收入，受电商内循环和广告模型优化影响。",
        valueIndexes: { current: 0, priorYear: 2 },
      },
      {
        name: "Live streaming",
        label: "Live streaming",
        after: "revenues by type",
        driver: "直播收入，平台继续优化直播生态和内容供给。",
        valueIndexes: { current: 0, priorYear: 2 },
      },
      {
        name: "Other services",
        label: "Other services",
        after: "revenues by type",
        driver: "其他服务收入，公告称 Kling AI 业务增长贡献明显。",
        valueIndexes: { current: 0, priorYear: 2 },
      },
    ],
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
    aiSummary:
      "公告披露 Kling AI 一季度收入超过 RMB650mn，同比增长超过 300%，并披露生成式推荐、智能投放和电商 AI 工具对商业化场景的贡献。",
  },
  chineseall: {
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    currencyUnit: "RMB bn",
    scale: 0.000000001,
    defaultValueIndexes: { current: 0, priorYear: 1 },
    revenue: { label: "营业收入", after: "营业收入（元）" },
    costOfRevenue: { label: "营业成本", after: "二、营业总成本" },
    operatingProfit: { label: "营业利润", after: "合并利润表" },
    netIncome: {
      label: "归属于母公司所有者的净利润",
      after: "按所有权归属分类",
      valueIndexes: { current: 1, priorYear: 2 },
    },
    segments: [
      {
        name: "短剧与 AIGC 内容",
        label: "营业收入",
        after: "营业收入（元）",
        driver:
          "一季报披露收入增长主要来自出海短剧业务提质增效及 AI 剧业务快速发展；报告未披露可拆分收入，因此按公司级收入记录该主题。",
        valueIndexes: { current: 0, priorYear: 1 },
      },
    ],
    priorYearPeriod: {
      fiscalYear: 2025,
      fiscalQuarter: "Q1",
      periodLabel: "2025 Q1",
      reportDate: "2025-03-31",
    },
    aiSummary:
      "一季报披露 AI 剧业务快速发展，但未披露可单独量化的 AI 收入；当前 parser 仅记录官方文字口径，不做拆分推算。",
  },
};

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForSearch(value: string) {
  return normalizeText(value).toLowerCase();
}

function numberFromToken(token: string) {
  const compact = token
    .replace(/[,，]/g, "")
    .replace(/\s+/g, "")
    .replace(/[％%]/g, "");
  if (!compact || compact === "-" || compact === "—") return null;

  const isNegative = compact.includes("(") || compact.startsWith("-") || compact.startsWith("－");
  const parsed = Math.abs(Number.parseFloat(compact.replace(/[()（）－-]/g, "")));
  if (!Number.isFinite(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

function numbersInText(text: string) {
  return [...text.matchAll(/\(?[－-]?\d[\d,，]*(?:\.\d+)?\s*\)?\s*[％%]?/g)]
    .map((match) => numberFromToken(match[0]))
    .filter((value): value is number => value !== null);
}

function preparePdfText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/−/g, "-")
    .replace(/－/g, "-")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function linesFromText(text: string) {
  return preparePdfText(text)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function lineMatches(line: string, label: string) {
  const normalizedLine = normalizeForSearch(line);
  const normalizedLabel = normalizeForSearch(label);
  return normalizedLine.includes(normalizedLabel);
}

function windowedLines(lines: string[], profile: PdfTextRowProfile) {
  const afterIndex = profile.after
    ? lines.findIndex((line) => lineMatches(line, profile.after ?? ""))
    : -1;
  const beforeIndex =
    profile.before && afterIndex >= 0
      ? lines.findIndex((line, index) => index > afterIndex && lineMatches(line, profile.before ?? ""))
      : -1;

  return lines
    .map((line, index) => ({ line, index }))
    .filter((item) => afterIndex < 0 || item.index >= afterIndex)
    .filter((item) => beforeIndex < 0 || item.index <= beforeIndex);
}

function collectLogicalRow(lines: string[], index: number) {
  const current = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  const following = lines[index + 2] ?? "";

  if (numbersInText(current).length >= 2) return current;
  if (next && numbersInText(`${current} ${next}`).length >= 2) return `${current} ${next}`;
  return `${current} ${next} ${following}`.trim();
}

function findPdfTextRow(rawText: string, rowProfile: PdfTextRowProfile) {
  const lines = linesFromText(rawText);
  const candidates = windowedLines(lines, rowProfile).filter((item) => lineMatches(item.line, rowProfile.label));
  let seen = 0;

  for (const candidate of candidates) {
    const row = collectLogicalRow(lines, candidate.index);
    if (numbersInText(row).length < 2) continue;
    seen += 1;
    if (seen === (rowProfile.occurrence ?? 1)) return row;
  }

  throw new Error(`Unable to find PDF text row: ${rowProfile.label}`);
}

function rowToValues(rawText: string, rowProfile: PdfTextRowProfile, profile: PdfTextCompanyProfile) {
  const row = findPdfTextRow(rawText, rowProfile);
  return {
    row,
    values: numbersInText(row).map((value) => value * profile.scale),
  };
}

function valueFromRow(rawText: string, rowProfile: PdfTextRowProfile, profile: PdfTextCompanyProfile): TripleValue {
  const { row, values } = rowToValues(rawText, rowProfile, profile);
  const indexes = rowProfile.valueIndexes ?? profile.defaultValueIndexes;
  const current = values[indexes.current];
  const sameQuarterPriorYear = values[indexes.priorYear];
  const previousQuarter = indexes.previousQuarter === undefined ? null : values[indexes.previousQuarter] ?? null;

  if (current === undefined || sameQuarterPriorYear === undefined) {
    throw new Error(`Unable to parse comparable PDF row values: ${rowProfile.label}`);
  }

  return {
    current,
    sameQuarterPriorYear,
    previousQuarter,
    snippet: `${rowProfile.sourceLabel ?? rowProfile.label} PDF text row: ${row}`,
  };
}

function pdfYoy(current: number, prior: number) {
  return round(((current - prior) / Math.abs(prior)) * 100);
}

function metricFromTriple(
  name: string,
  normalized: string,
  values: TripleValue,
  unit: MonetaryUnit,
  options: Partial<Pick<ParsedFinancialMetric, "confidence">> = {},
) {
  return metric(name, normalized, values.current, unit, values.snippet, {
    yoy: values.disclosedYoy ?? pdfYoy(values.current, values.sameQuarterPriorYear),
    qoq: values.disclosedQoq ?? maybeQoq(values.current, values.previousQuarter),
    confidence: options.confidence ?? 0.88,
  });
}

function buildSegment(
  rawText: string,
  item: PdfTextSegmentProfile,
  profile: PdfTextCompanyProfile,
  totalRevenue: number,
) {
  const values = valueFromRow(rawText, item, profile);
  values.disclosedYoy = item.disclosedYoy ?? undefined;
  values.disclosedQoq = item.disclosedQoq ?? undefined;
  return segment(item.name, values, totalRevenue, profile.currencyUnit, item.driver);
}

function buildGrossProfit(rawText: string, profile: PdfTextCompanyProfile, revenue: TripleValue): TripleValue {
  if (profile.grossProfit) {
    return valueFromRow(rawText, profile.grossProfit, profile);
  }

  if (!profile.costOfRevenue) {
    throw new Error("PDF text profile requires either grossProfit or costOfRevenue");
  }

  const costOfRevenue = valueFromRow(rawText, profile.costOfRevenue, profile);
  return {
    current: revenue.current - Math.abs(costOfRevenue.current),
    previousQuarter:
      revenue.previousQuarter === null || costOfRevenue.previousQuarter === null
        ? null
        : revenue.previousQuarter - Math.abs(costOfRevenue.previousQuarter),
    sameQuarterPriorYear: revenue.sameQuarterPriorYear - Math.abs(costOfRevenue.sameQuarterPriorYear),
    snippet: "Derived from revenue less cost of revenue / operating cost in official PDF.",
  };
}

function previousQuarterPeriod(profile: PdfTextCompanyProfile) {
  return (
    profile.previousQuarterPeriod ?? {
      fiscalYear: profile.fiscalYear,
      fiscalQuarter: "PQ",
      periodLabel: `${profile.fiscalYear} previous quarter`,
      reportDate: undefined,
    }
  );
}

export function hasPdfTextCompanyProfile(companyId: string) {
  return Boolean(pdfTextCompanyProfiles[companyId]);
}

export function parsePdfTextStandardReport(params: {
  companyId: string;
  companyName: string;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const profile = pdfTextCompanyProfiles[params.companyId];
  if (!profile) throw new Error(`PDF text parser profile not implemented for ${params.companyId}`);

  const rawText = preparePdfText(params.html);
  const revenue = valueFromRow(rawText, profile.revenue, profile);
  const grossProfit = buildGrossProfit(rawText, profile, revenue);
  const operatingProfit = valueFromRow(rawText, profile.operatingProfit, profile);
  const netIncome = valueFromRow(rawText, profile.netIncome, profile);
  const grossMargin = (grossProfit.current / revenue.current) * 100;
  const operatingMargin = (operatingProfit.current / revenue.current) * 100;
  const segments = profile.segments.map((item) => buildSegment(rawText, item, profile, revenue.current));

  const metrics: ParsedFinancialMetric[] = [
    metricFromTriple("总营收", "revenue", revenue, profile.currencyUnit),
    metric("毛利润", "gross_profit", grossProfit.current, profile.currencyUnit, grossProfit.snippet, {
      yoy: pdfYoy(grossProfit.current, grossProfit.sameQuarterPriorYear),
      qoq: maybeQoq(grossProfit.current, grossProfit.previousQuarter),
      confidence: profile.grossProfit ? 0.88 : 0.78,
    }),
    metric("毛利率", "gross_margin", grossMargin, "%", "Derived from gross profit divided by revenue.", {
      yoy: round(grossMargin - (grossProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq:
        grossProfit.previousQuarter === null || revenue.previousQuarter === null
          ? null
          : round(grossMargin - (grossProfit.previousQuarter / revenue.previousQuarter) * 100),
      confidence: profile.grossProfit ? 0.86 : 0.76,
    }),
    metricFromTriple("营业利润", "operating_profit", operatingProfit, profile.currencyUnit),
    metric("营业利润率", "operating_margin", operatingMargin, "%", "Derived from operating profit divided by revenue.", {
      yoy: round(operatingMargin - (operatingProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq:
        operatingProfit.previousQuarter === null || revenue.previousQuarter === null
          ? null
          : round(operatingMargin - (operatingProfit.previousQuarter / revenue.previousQuarter) * 100),
      confidence: 0.86,
    }),
    metricFromTriple("归母净利润", "net_income_attributable", netIncome, profile.currencyUnit),
  ];

  return {
    companyId: params.companyId,
    fiscalYear: profile.fiscalYear,
    fiscalQuarter: profile.fiscalQuarter,
    periodLabel: profile.periodLabel,
    reportDate: profile.reportDate,
    releaseDate: params.releaseDate,
    sourceTitle: params.sourceTitle,
    sourceUrl: params.sourceUrl,
    contentHash: sha256(params.html),
    rawText: rawText.slice(0, 180_000),
    metrics,
    segments,
    quickNote: buildStandardQuickNote({
      context: {
        companyName: params.companyName,
        periodLabel: profile.periodLabel,
        currencyUnit: profile.currencyUnit,
        sourceTitle: params.sourceTitle,
      },
      revenue,
      grossProfit,
      netIncome,
      grossMargin,
      operatingProfit,
      operatingMargin,
      segments,
      aiSummary: profile.aiSummary,
      sourceMap: {
        revenue: revenue.snippet,
        netIncome: netIncome.snippet,
        source: params.sourceUrl,
      },
    }),
    comparativeReports: buildStandardComparatives({
      currencyUnit: profile.currencyUnit,
      priorYearPeriod: profile.priorYearPeriod,
      previousQuarterPeriod: previousQuarterPeriod(profile),
      revenue,
      grossProfit,
      netIncome,
      operatingProfit,
    }),
  };
}

export const __pdfTextProfileTestUtils = {
  findPdfTextRow,
  numbersInText,
};
