import type {
  MonetaryUnit,
  ParsedBusinessSegment,
  ParsedEarningsReport,
  ParsedFinancialMetric,
} from "./types";
import {
  buildStandardComparatives,
  buildStandardQuickNote,
  metric,
  normalizeLabel,
  round,
  segment,
  TripleValue,
  yoy,
} from "./profile-utils";
import { htmlToText, sha256 } from "./sec";

export type TwoPeriodValue = Omit<TripleValue, "previousQuarter"> & {
  previousQuarter: null;
};

export type Sec6kTwoPeriodProfile = {
  currencyUnit: MonetaryUnit;
  scale: number;
  revenueLabel: string;
  costOfRevenueLabel?: string;
  grossProfitLabel?: string;
  operatingProfitLabel: string;
  netIncomeLabel: string;
  segmentLabels: Array<{
    name: string;
    rowLabel: string;
    driver: string;
    valueIndexes?: [number, number];
    yoy?: number | null;
  }>;
};

function numberFromToken(token: string) {
  const isNegative = token.includes("(") || token.trim().startsWith("-");
  const parsed = Number.parseFloat(token.replace(/[(),%]/g, ""));
  if (Number.isNaN(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

function rowValues(text: string, scale: number) {
  return [...text.matchAll(/\(?-?\d[\d,]*(?:\.\d+)?\s*\)?/g)]
    .map((match) => numberFromToken(match[0]))
    .filter((value): value is number => value !== null)
    .map((value) => value * scale);
}

export function findTwoPeriodValueFromText(
  rawText: string,
  rowLabel: string,
  options: { scale: number; valueIndexes?: [number, number] },
): TwoPeriodValue {
  const line = rawText
    .split(/(?<=\d)\s+(?=[A-Z][A-Za-z ,()'-]+(?:\d|RMB|US\$))/)
    .find((candidate) => candidate.toLowerCase().includes(rowLabel.toLowerCase()));

  if (!line) throw new Error(`Unable to find text row: ${rowLabel}`);

  const values = rowValues(line, options.scale);
  const [priorIndex, currentIndex] = options.valueIndexes ?? [0, 1];
  const sameQuarterPriorYear = values[priorIndex];
  const current = values[currentIndex];
  if (sameQuarterPriorYear === undefined || current === undefined) {
    throw new Error(`Unable to parse two comparable values from row: ${rowLabel}`);
  }

  return {
    current,
    previousQuarter: null,
    sameQuarterPriorYear,
    snippet: `${rowLabel} text row: ${round(sameQuarterPriorYear, 4)}, ${round(current, 4)}`,
  };
}

export function buildTwoPeriodMetrics(params: {
  profile: Sec6kTwoPeriodProfile;
  rawText: string;
}): {
  metrics: ParsedFinancialMetric[];
  segments: ParsedBusinessSegment[];
  values: {
    revenue: TwoPeriodValue;
    grossProfit: TwoPeriodValue;
    operatingProfit: TwoPeriodValue;
    netIncome: TwoPeriodValue;
  };
} {
  const { profile, rawText } = params;
  const revenue = findTwoPeriodValueFromText(rawText, profile.revenueLabel, { scale: profile.scale });
  const operatingProfit = findTwoPeriodValueFromText(rawText, profile.operatingProfitLabel, {
    scale: profile.scale,
  });
  const netIncome = findTwoPeriodValueFromText(rawText, profile.netIncomeLabel, {
    scale: profile.scale,
  });
  const grossProfit = profile.grossProfitLabel
    ? findTwoPeriodValueFromText(rawText, profile.grossProfitLabel, { scale: profile.scale })
    : (() => {
        if (!profile.costOfRevenueLabel) {
          throw new Error("profile requires either grossProfitLabel or costOfRevenueLabel");
        }
        const costOfRevenue = findTwoPeriodValueFromText(rawText, profile.costOfRevenueLabel, {
          scale: profile.scale,
        });
        return {
          current: revenue.current - costOfRevenue.current,
          previousQuarter: null,
          sameQuarterPriorYear: revenue.sameQuarterPriorYear - costOfRevenue.sameQuarterPriorYear,
          snippet: "Derived from revenue less cost of revenue.",
        };
      })();
  const grossMargin = (grossProfit.current / revenue.current) * 100;
  const operatingMargin = (operatingProfit.current / revenue.current) * 100;

  const metrics = [
    metric("总营收", "revenue", revenue.current, profile.currencyUnit, revenue.snippet, {
      yoy: yoy(revenue.current, revenue.sameQuarterPriorYear),
      qoq: null,
    }),
    metric("毛利润", "gross_profit", grossProfit.current, profile.currencyUnit, grossProfit.snippet, {
      yoy: yoy(grossProfit.current, grossProfit.sameQuarterPriorYear),
      qoq: null,
    }),
    metric("毛利率", "gross_margin", grossMargin, "%", "Derived from gross profit divided by revenue.", {
      yoy: round(grossMargin - (grossProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq: null,
    }),
    metric("营业利润", "operating_profit", operatingProfit.current, profile.currencyUnit, operatingProfit.snippet, {
      yoy: yoy(operatingProfit.current, operatingProfit.sameQuarterPriorYear),
      qoq: null,
    }),
    metric("营业利润率", "operating_margin", operatingMargin, "%", "Derived from operating profit divided by revenue.", {
      yoy: round(operatingMargin - (operatingProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq: null,
    }),
    metric("归母净利润", "net_income_attributable", netIncome.current, profile.currencyUnit, netIncome.snippet, {
      yoy: yoy(netIncome.current, netIncome.sameQuarterPriorYear),
      qoq: null,
    }),
  ];

  const segments = profile.segmentLabels.map((item) => {
    const value = findTwoPeriodValueFromText(rawText, item.rowLabel, {
      scale: profile.scale,
      valueIndexes: item.valueIndexes,
    });
    value.disclosedYoy = item.yoy ?? undefined;
    return segment(item.name, value, revenue.current, profile.currencyUnit, item.driver);
  });

  return { metrics, segments, values: { revenue, grossProfit, operatingProfit, netIncome } };
}

export function prepareSec6kText(html: string) {
  return htmlToText(html)
    .replace(/RMB\s+/g, "RMB")
    .replace(/US\$\s+/g, "US$")
    .replace(/\s+/g, " ")
    .trim();
}

type RowValueIndexes = {
  priorYear: number;
  previousQuarter?: number;
  current: number;
};

type Sec6kSegmentProfile = {
  name: string;
  rowLabel: string;
  driver: string;
  valueIndexes?: RowValueIndexes;
};

type Sec6kCompanyProfile = {
  fiscalYear: number;
  fiscalQuarter: string;
  periodLabel: string;
  reportDate?: string;
  currencyUnit: MonetaryUnit;
  scale: number;
  valueIndexes: RowValueIndexes;
  revenueLabel: string;
  costOfRevenueLabel: string;
  costOfRevenueValueIndexes?: RowValueIndexes;
  skipGrossProfit?: boolean;
  operatingProfitLabel: string;
  netIncomeLabel: string;
  segments: Sec6kSegmentProfile[];
  aiSummary?: string;
};

const sec6kCompanyProfiles: Record<string, Sec6kCompanyProfile> = {
  alibaba: {
    fiscalYear: 2026,
    fiscalQuarter: "Q4",
    periodLabel: "2026 Q4",
    reportDate: "2026-03-31",
    currencyUnit: "RMB bn",
    scale: 0.001,
    valueIndexes: { priorYear: 0, current: 1 },
    revenueLabel: "Revenue",
    costOfRevenueLabel: "Cost of revenue",
    costOfRevenueValueIndexes: { priorYear: 0, current: 2 },
    operatingProfitLabel: "Income (Loss) from operations",
    netIncomeLabel: "Net income attributable to ordinary shareholders",
    segments: [
      {
        name: "Alibaba China E-commerce Group",
        rowLabel: "Total Alibaba China E-commerce Group",
        driver: "中国电商集团收入，含电商、即时零售和中国批发。",
      },
      {
        name: "Alibaba International Digital Commerce Group",
        rowLabel: "Total Alibaba International Digital Commerce Group",
        driver: "国际零售和批发商业收入。",
      },
      {
        name: "Cloud Intelligence Group",
        rowLabel: "Cloud Intelligence Group",
        driver: "云智能集团收入，AI 相关产品为主要增量来源之一。",
      },
    ],
    aiSummary: "公司披露 Cloud Intelligence Group 外部收入增长加速，AI 相关产品收入保持高增长。",
  },
  jd: {
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    currencyUnit: "RMB bn",
    scale: 0.001,
    valueIndexes: { priorYear: 0, current: 1 },
    revenueLabel: "Total net revenues",
    costOfRevenueLabel: "Cost of revenues",
    operatingProfitLabel: "Income from operations",
    netIncomeLabel: "Net income attributable to the Company",
    segments: [
      {
        name: "Net product revenues",
        rowLabel: "Net product revenues",
        driver: "自营商品销售收入。",
      },
      {
        name: "Net service revenues",
        rowLabel: "Net service revenues",
        driver: "平台、营销、物流及其他服务收入。",
      },
    ],
  },
  trip: {
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    currencyUnit: "RMB bn",
    scale: 0.001,
    valueIndexes: { priorYear: 0, previousQuarter: 1, current: 2 },
    revenueLabel: "Total net revenues",
    costOfRevenueLabel: "Cost of revenue",
    operatingProfitLabel: "Income from operations",
    netIncomeLabel: "Net income attributable to Trip.com Group Limited",
    segments: [
      {
        name: "Accommodation reservation",
        rowLabel: "Accommodation reservation",
        driver: "住宿预订收入。",
      },
      {
        name: "Transportation ticketing",
        rowLabel: "Transportation ticketing",
        driver: "交通票务收入。",
      },
      {
        name: "Packaged-tour",
        rowLabel: "Packaged-tour",
        driver: "跟团游和打包旅游产品收入。",
      },
      {
        name: "Corporate travel",
        rowLabel: "Corporate travel",
        driver: "商旅管理收入。",
      },
    ],
  },
  weibo: {
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    currencyUnit: "USD bn",
    scale: 0.000001,
    valueIndexes: { priorYear: 0, current: 1 },
    revenueLabel: "Net revenues",
    costOfRevenueLabel: "Cost of revenues",
    operatingProfitLabel: "Income from operations",
    netIncomeLabel: "Net income attributable to Weibo",
    segments: [
      {
        name: "Advertising and marketing",
        rowLabel: "Advertising and marketing",
        driver: "广告与营销收入。",
      },
      {
        name: "Value-added services",
        rowLabel: "Value-added services",
        driver: "会员、直播及其他增值服务收入。",
      },
    ],
    aiSummary: "公司披露继续用 AI 提升广告转化效率和搜索能力。",
  },
  zhihu: {
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    currencyUnit: "RMB bn",
    scale: 0.000001,
    valueIndexes: { priorYear: 0, previousQuarter: 1, current: 2 },
    revenueLabel: "Total revenues",
    costOfRevenueLabel: "Cost of revenues",
    operatingProfitLabel: "Loss from operations",
    netIncomeLabel: "Adjusted net income",
    segments: [
      {
        name: "Marketing services",
        rowLabel: "Marketing services",
        driver: "营销服务收入。",
      },
      {
        name: "Paid content and IP operations",
        rowLabel: "Paid content and IP operations",
        driver: "付费内容与 IP 运营收入。",
      },
    ],
  },
};

function cellsFromRow(rowHtml: string) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi)]
    .map((match) => htmlToText(match[0]))
    .map((text) => text.replace(/&middot;|&#149;|&#9679;/g, " ").replace(/\s+/g, " ").trim());
}

function isFootnoteCell(text: string) {
  return /^\(\d+\)$/.test(text.trim());
}

function numberFromCell(text: string) {
  if (!text || isFootnoteCell(text)) return null;
  const token = text.match(/\(?-?\d[\d,]*(?:\.\d+)?\)?/);
  if (!token) return null;
  const tokenEnd = (token.index ?? 0) + token[0].length;
  const nextNonSpace = text.slice(tokenEnd).trimStart()[0];
  const normalizedToken = token[0] + (token[0].startsWith("(") && !token[0].includes(")") && nextNonSpace === ")" ? ")" : "");
  const isNegative = normalizedToken.includes("(") || normalizedToken.trim().startsWith("-");
  const parsed = Number.parseFloat(normalizedToken.replace(/[(),%]/g, ""));
  if (Number.isNaN(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

function rowLabelMatches(rowHtml: string, label: string) {
  const normalizedLabel = normalizeLabel(label);
  const firstCell = cellsFromRow(rowHtml).find(Boolean);
  return firstCell ? normalizeLabel(firstCell).includes(normalizedLabel) : false;
}

function findValueRow(html: string, label: string, occurrence = 1) {
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  let seen = 0;

  for (const row of rows) {
    if (!rowLabelMatches(row, label)) continue;
    const values = rowValuesFromCells(row);
    if (values.length < 2) continue;
    seen += 1;
    if (seen === occurrence) return row;
  }

  throw new Error(`Unable to find SEC 6-K table row: ${label}`);
}

function rowValuesFromCells(rowHtml: string) {
  const cells = cellsFromRow(rowHtml);
  return cells
    .map((cell, index) => {
      if (isFootnoteCell(cell)) return null;
      const nextCell = cells[index + 1]?.trim();
      const mergedCell = cell.trim().startsWith("(") && nextCell === ")" ? `${cell})` : cell;
      return numberFromCell(mergedCell);
    })
    .filter((value): value is number => value !== null);
}

function valueFromRow(html: string, label: string, profile: Sec6kCompanyProfile, indexes = profile.valueIndexes): TripleValue {
  const row = findValueRow(html, label);
  const values = rowValuesFromCells(row).map((value) => value * profile.scale);
  const sameQuarterPriorYear = values[indexes.priorYear];
  const current = values[indexes.current];
  const previousQuarter = indexes.previousQuarter === undefined ? null : values[indexes.previousQuarter] ?? null;

  if (sameQuarterPriorYear === undefined || current === undefined) {
    throw new Error(`Unable to parse SEC 6-K row values: ${label}`);
  }

  return {
    sameQuarterPriorYear,
    previousQuarter,
    current,
    snippet: `${label} table row: ${round(sameQuarterPriorYear, 4)}, ${previousQuarter === null ? "n/a" : round(previousQuarter, 4)}, ${round(current, 4)}`,
  };
}

export function hasSec6kCompanyProfile(companyId: string) {
  return Boolean(sec6kCompanyProfiles[companyId]);
}

export function parseSec6kStandardReport(params: {
  companyId: string;
  companyName: string;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const profile = sec6kCompanyProfiles[params.companyId];
  if (!profile) throw new Error(`SEC 6-K parser profile not implemented for ${params.companyId}`);

  const revenue = valueFromRow(params.html, profile.revenueLabel, profile);
  const costOfRevenue = valueFromRow(
    params.html,
    profile.costOfRevenueLabel,
    profile,
    profile.costOfRevenueValueIndexes ?? profile.valueIndexes,
  );
  const operatingProfit = valueFromRow(params.html, profile.operatingProfitLabel, profile);
  const netIncome = valueFromRow(params.html, profile.netIncomeLabel, profile);
  const grossProfit: TripleValue = {
    current: revenue.current - Math.abs(costOfRevenue.current),
    previousQuarter:
      revenue.previousQuarter === null || costOfRevenue.previousQuarter === null
        ? null
        : revenue.previousQuarter - Math.abs(costOfRevenue.previousQuarter),
    sameQuarterPriorYear: revenue.sameQuarterPriorYear - Math.abs(costOfRevenue.sameQuarterPriorYear),
    snippet: "Derived from revenue less cost of revenue.",
  };
  const grossMargin = (grossProfit.current / revenue.current) * 100;
  const operatingMargin = (operatingProfit.current / revenue.current) * 100;
  const metrics = [
    metric("总营收", "revenue", revenue.current, profile.currencyUnit, revenue.snippet, {
      yoy: yoy(revenue.current, revenue.sameQuarterPriorYear),
      qoq: revenue.previousQuarter === null ? null : yoy(revenue.current, revenue.previousQuarter),
    }),
    ...(profile.skipGrossProfit
      ? []
      : [
          metric("毛利润", "gross_profit", grossProfit.current, profile.currencyUnit, grossProfit.snippet, {
            yoy: yoy(grossProfit.current, grossProfit.sameQuarterPriorYear),
            qoq: grossProfit.previousQuarter === null ? null : yoy(grossProfit.current, grossProfit.previousQuarter),
          }),
          metric("毛利率", "gross_margin", grossMargin, "%", "Derived from gross profit divided by revenue.", {
            yoy: round(grossMargin - (grossProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
            qoq:
              grossProfit.previousQuarter === null || revenue.previousQuarter === null
                ? null
                : round(grossMargin - (grossProfit.previousQuarter / revenue.previousQuarter) * 100),
          }),
        ]),
    metric("营业利润", "operating_profit", operatingProfit.current, profile.currencyUnit, operatingProfit.snippet, {
      yoy: yoy(operatingProfit.current, operatingProfit.sameQuarterPriorYear),
      qoq: operatingProfit.previousQuarter === null ? null : yoy(operatingProfit.current, operatingProfit.previousQuarter),
    }),
    metric("营业利润率", "operating_margin", operatingMargin, "%", "Derived from operating profit divided by revenue.", {
      yoy: round(operatingMargin - (operatingProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq:
        operatingProfit.previousQuarter === null || revenue.previousQuarter === null
          ? null
          : round(operatingMargin - (operatingProfit.previousQuarter / revenue.previousQuarter) * 100),
    }),
    metric("归母净利润", "net_income_attributable", netIncome.current, profile.currencyUnit, netIncome.snippet, {
      yoy: yoy(netIncome.current, netIncome.sameQuarterPriorYear),
      qoq: netIncome.previousQuarter === null ? null : yoy(netIncome.current, netIncome.previousQuarter),
    }),
  ];
  const segments = profile.segments.map((item) =>
    segment(
      item.name,
      valueFromRow(params.html, item.rowLabel, profile, item.valueIndexes ?? profile.valueIndexes),
      revenue.current,
      profile.currencyUnit,
      item.driver,
    ),
  );
  const rawText = prepareSec6kText(params.html);

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
    rawText,
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
      grossMargin: profile.skipGrossProfit ? 0 : round(grossMargin),
      operatingProfit,
      operatingMargin: round(operatingMargin),
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
      priorYearPeriod: {
        fiscalYear: profile.fiscalYear - 1,
        fiscalQuarter: profile.fiscalQuarter,
        periodLabel: `${profile.fiscalYear - 1} ${profile.fiscalQuarter}`,
        reportDate: profile.reportDate,
      },
      previousQuarterPeriod: {
        fiscalYear: profile.fiscalYear,
        fiscalQuarter: "PQ",
        periodLabel: `${profile.fiscalYear} previous quarter`,
      },
      revenue,
      grossProfit: profile.skipGrossProfit
        ? {
            current: 0,
            previousQuarter: null,
            sameQuarterPriorYear: 0,
            snippet: "Gross profit not disclosed in this parser profile.",
          }
        : grossProfit,
      netIncome,
      operatingProfit,
    }),
  };
}
