import type {
  MonetaryUnit,
  ParsedBusinessSegment,
  ParsedFinancialMetric,
} from "./types";
import { metric, round, segment, TripleValue, yoy } from "./profile-utils";
import { htmlToText } from "./sec";

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
