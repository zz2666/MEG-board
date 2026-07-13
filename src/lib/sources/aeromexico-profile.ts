import type {
  MonetaryUnit,
  ParsedBusinessSegment,
  ParsedEarningsReport,
  ParsedFinancialMetric,
} from "./types";
import { metric, round, yoy } from "./profile-utils";
import { htmlToText, sha256 } from "./sec";

type Year = 2023 | 2024 | 2025;
type TagValue = {
  name: string;
  contextRef: string;
  value: number;
  raw: string;
};

const YEARS: Year[] = [2023, 2024, 2025];
const CURRENCY_UNIT: MonetaryUnit = "USD bn";

function decodeHtml(value: string) {
  return htmlToText(value)
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();
}

function parseNumber(raw: string, attrs: string) {
  const text = decodeHtml(raw);
  const parsed = Number.parseFloat(text.replace(/[()]/g, ""));
  if (!Number.isFinite(parsed)) return null;

  const scaleMatch = attrs.match(/\bscale="(-?\d+)"/i);
  const scale = scaleMatch ? Number.parseInt(scaleMatch[1], 10) : 0;
  const sign = attrs.match(/\bsign="-"/i) ? -1 : 1;
  const negative = text.includes("(") ? -1 : 1;
  return parsed * 10 ** scale * sign * negative;
}

function extractTagValues(html: string) {
  return [...html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)].flatMap(
    (match): TagValue[] => {
      const attrs = match[1];
      const name = attrs.match(/\bname="([^"]+)"/i)?.[1];
      const contextRef = attrs.match(/\bcontextRef="([^"]+)"/i)?.[1];
      const value = parseNumber(match[2], attrs);
      if (!name || !contextRef || value === null) return [];
      return [
        {
          name,
          contextRef,
          value,
          raw: match[0],
        },
      ];
    },
  );
}

function yearContext(year: Year) {
  return `P01_01_${year}To12_31_${year}`;
}

function valueFor(values: TagValue[], tagName: string, year: Year) {
  const context = yearContext(year);
  const match = values.find((item) => item.name === tagName && item.contextRef === context);
  if (!match) throw new Error(`Unable to parse ${tagName} for ${year}`);
  return match.value / 1_000_000_000;
}

function sourceAnchor(label: string, tagName: string) {
  return `AERO 2025 Form 20-F inline XBRL: ${label} from ${tagName}. Values are reported in thousands of US dollars and normalized to USD bn.`;
}

function buildMetric(params: {
  label: string;
  normalized: string;
  value: number;
  prior?: number;
  unit?: MonetaryUnit | "%";
  anchor: string;
  confidence?: number;
}): ParsedFinancialMetric {
  return metric(params.label, params.normalized, params.value, params.unit ?? CURRENCY_UNIT, params.anchor, {
    yoy: params.prior === undefined ? null : yoy(params.value, params.prior),
    confidence: params.confidence ?? 0.9,
  });
}

function metricForYear(values: TagValue[], year: Year) {
  const priorYear = year === 2023 ? null : ((year - 1) as Year);
  const revenue = valueFor(values, "ifrs-full:Revenue", year);
  const priorRevenue = priorYear ? valueFor(values, "ifrs-full:Revenue", priorYear) : undefined;
  const operatingProfit = valueFor(values, "ifrs-full:ProfitLossFromOperatingActivities", year);
  const priorOperatingProfit = priorYear
    ? valueFor(values, "ifrs-full:ProfitLossFromOperatingActivities", priorYear)
    : undefined;
  const netIncome = valueFor(values, "ifrs-full:ProfitLoss", year);
  const priorNetIncome = priorYear ? valueFor(values, "ifrs-full:ProfitLoss", priorYear) : undefined;
  const operatingMargin = revenue ? (operatingProfit / revenue) * 100 : 0;
  const priorOperatingMargin =
    priorRevenue && priorOperatingProfit !== undefined ? (priorOperatingProfit / priorRevenue) * 100 : undefined;

  return [
    buildMetric({
      label: "总营收",
      normalized: "revenue",
      value: revenue,
      prior: priorRevenue,
      anchor: sourceAnchor("total revenue", "ifrs-full:Revenue"),
    }),
    buildMetric({
      label: "营业利润",
      normalized: "operating_profit",
      value: operatingProfit,
      prior: priorOperatingProfit,
      anchor: sourceAnchor("profit from operating activities", "ifrs-full:ProfitLossFromOperatingActivities"),
    }),
    buildMetric({
      label: "营业利润率",
      normalized: "operating_margin",
      value: operatingMargin,
      prior: priorOperatingMargin,
      unit: "%",
      anchor: "Derived from profit from operating activities divided by total revenue.",
      confidence: 0.88,
    }),
    buildMetric({
      label: "归母净利润",
      normalized: "net_income_attributable",
      value: netIncome,
      prior: priorNetIncome,
      anchor: sourceAnchor("income for the year", "ifrs-full:ProfitLoss"),
    }),
  ];
}

function segmentFor(
  values: TagValue[],
  name: string,
  tagName: string,
  year: Year,
  totalRevenue: number,
  driver: string,
): ParsedBusinessSegment {
  const current = valueFor(values, tagName, year);
  const prior = year === 2023 ? undefined : valueFor(values, tagName, (year - 1) as Year);

  return {
    name,
    revenue: round(current, 4),
    revenueUnit: CURRENCY_UNIT,
    share: round((current / totalRevenue) * 100),
    yoy: prior === undefined ? null : yoy(current, prior),
    qoq: null,
    grossMargin: null,
    driver,
    confidence: 0.88,
  };
}

function buildSegments(values: TagValue[], year: Year) {
  const totalRevenue = valueFor(values, "ifrs-full:Revenue", year);
  return [
    segmentFor(
      values,
      "Passenger",
      "ifrs-full:RevenueFromRenderingOfPassengerTransportServices",
      year,
      totalRevenue,
      "Passenger revenue includes airfare and ancillary passenger services.",
    ),
    segmentFor(
      values,
      "Air cargo",
      "ifrs-full:RevenueFromRenderingOfCargoAndMailTransportServices",
      year,
      totalRevenue,
      "Air cargo revenue covers domestic and international cargo transport.",
    ),
    segmentFor(
      values,
      "Other",
      "ifrs-full:OtherRevenue",
      year,
      totalRevenue,
      "Other revenue captures remaining operating revenue disclosed outside passenger and cargo.",
    ),
  ];
}

export function parseAeromexico2025Form20F(params: {
  companyId: string;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const values = extractTagValues(params.html);
  const currentYear: Year = 2025;
  const currentMetrics = metricForYear(values, currentYear);
  const revenue = currentMetrics.find((item) => item.normalized === "revenue");
  const operatingMargin = currentMetrics.find((item) => item.normalized === "operating_margin");
  const netIncome = currentMetrics.find((item) => item.normalized === "net_income_attributable");
  if (!revenue || !operatingMargin || !netIncome) {
    throw new Error("AERO Form 20-F parser did not produce required metrics");
  }

  const segments = buildSegments(values, currentYear);

  return {
    companyId: params.companyId,
    fiscalYear: currentYear,
    fiscalQuarter: "FY",
    periodLabel: "2025 FY",
    reportDate: "2025-12-31",
    releaseDate: params.releaseDate,
    sourceTitle: params.sourceTitle,
    sourceUrl: params.sourceUrl,
    contentHash: sha256(params.html),
    rawText: htmlToText(params.html).slice(0, 180_000),
    metrics: currentMetrics,
    segments,
    quickNote: {
      headline: `Aeromexico 2025 FY revenue was USD ${round(revenue.value, 2)}bn, with operating margin ${round(
        operatingMargin.value,
      )}% and income for the year of USD ${round(netIncome.value, 2)}bn.`,
      highlights: [
        `Total revenue reached USD ${round(revenue.value, 2)}bn, YoY ${revenue.yoy}%.`,
        `Passenger revenue remained the largest stream at USD ${round(segments[0].revenue ?? 0, 2)}bn.`,
        `Operating margin was ${round(operatingMargin.value)}%, based on operating profit divided by revenue.`,
      ],
      weaknesses: [
        "2025 annual revenue declined versus 2024; next update should watch quarterly demand recovery.",
        "Fuel price and FX exposure remain key airline-specific sensitivities.",
        "The current parser covers Form 20-F annual data; interim 6-K earnings releases still need validation after the next release appears.",
      ],
      segmentComments: Object.fromEntries(segments.map((segment) => [segment.name, segment.driver ?? ""])),
      marginComments: `Operating profit was USD ${round(
        currentMetrics.find((item) => item.normalized === "operating_profit")?.value ?? 0,
        2,
      )}bn, implying an operating margin of ${round(operatingMargin.value)}%.`,
      aiSummary: "No material AI revenue disclosure was parsed from the airline Form 20-F.",
      watchItems: ["Upcoming interim 6-K earnings format", "Passenger revenue recovery", "Fuel price sensitivity"],
      marketReaction: "行情反应待接入实时行情源校验。",
      sourceMap: {
        revenue: sourceAnchor("total revenue", "ifrs-full:Revenue"),
        operatingProfit: sourceAnchor("profit from operating activities", "ifrs-full:ProfitLossFromOperatingActivities"),
        netIncome: sourceAnchor("income for the year", "ifrs-full:ProfitLoss"),
      },
    },
    comparativeReports: YEARS.filter((year) => year !== currentYear).map((year) => ({
      fiscalYear: year,
      fiscalQuarter: "FY",
      periodLabel: `${year} FY`,
      reportDate: `${year}-12-31`,
      releaseDate: params.releaseDate,
      metrics: metricForYear(values, year),
    })),
  };
}
