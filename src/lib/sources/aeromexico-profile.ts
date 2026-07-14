import type {
  MonetaryUnit,
  ParsedBusinessSegment,
  ParsedEarningsReport,
  ParsedFinancialMetric,
} from "./types";
import { metric, normalizeLabel, round, yoy, type TripleValue } from "./profile-utils";
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
const SIX_K_SCALE = 0.001;

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

function cellsFromRow(rowHtml: string) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi)]
    .map((match) => htmlToText(match[0]))
    .map((text) =>
      text
        .replace(/&nbsp;|&#160;|&#8194;|&#8195;|&#8201;|&#8202;/g, " ")
        .replace(/&#8216;|&#8217;|&lsquo;|&rsquo;/g, "'")
        .replace(/&middot;|&#149;|&#9679;/g, " ")
        .replace(/&#8212;|&mdash;/g, "-")
        .replace(/\s+/g, " ")
        .trim(),
    );
}

function isFootnoteCell(text: string) {
  return /^\(\d+\)$/.test(text.trim()) && text.trim().length <= 3;
}

function numberFromCell(text: string) {
  if (!text || /^%?\)?$/.test(text.trim()) || text.trim() === "-") return null;
  const token = text.match(/\(?-?\d[\d,]*(?:\.\d+)?\)?/);
  if (!token) return null;
  const tokenEnd = (token.index ?? 0) + token[0].length;
  const nextNonSpace = text.slice(tokenEnd).trimStart()[0];
  const normalizedToken =
    token[0] + (token[0].startsWith("(") && !token[0].includes(")") && nextNonSpace === ")" ? ")" : "");
  const isNegative = normalizedToken.includes("(") || normalizedToken.trim().startsWith("-");
  const parsed = Number.parseFloat(normalizedToken.replace(/[(),%]/g, ""));
  if (Number.isNaN(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

function rowValuesFromCells(rowHtml: string) {
  const cells = cellsFromRow(rowHtml).slice(1);
  return cells
    .map((cell, index) => {
      if (isFootnoteCell(cell)) return null;
      const nextCell = cells[index + 1]?.trim();
      const mergedCell = cell.trim().startsWith("(") && /^%?\)?$/.test(nextCell ?? "") ? `${cell})` : cell;
      return numberFromCell(mergedCell);
    })
    .filter((value): value is number => value !== null);
}

function firstCellMatches(firstCell: string, label: string, exactLabel: boolean) {
  const normalizedFirstCell = normalizeLabel(firstCell);
  const normalizedLabel = normalizeLabel(label);
  return exactLabel ? normalizedFirstCell === normalizedLabel : normalizedFirstCell.startsWith(normalizedLabel);
}

function findAero6kRow(
  html: string,
  label: string,
  options: {
    after?: string;
    exactLabel?: boolean;
    minFirstValue?: number;
  } = {},
) {
  const afterOffset = options.after ? html.toLowerCase().indexOf(options.after.toLowerCase()) : -1;
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => ({
    html: match[0],
    index: match.index ?? 0,
  }));

  for (const row of rows) {
    if (afterOffset >= 0 && row.index < afterOffset) continue;
    const firstCell = cellsFromRow(row.html).find(Boolean);
    if (!firstCell || !firstCellMatches(firstCell, label, options.exactLabel ?? false)) continue;
    const values = rowValuesFromCells(row.html);
    if (values.length < 2) continue;
    if (options.minFirstValue !== undefined && Math.abs(values[0]) < options.minFirstValue) continue;
    return row.html;
  }

  throw new Error(`Unable to find AERO 6-K table row: ${label}`);
}

function aero6kValueFromRow(
  html: string,
  label: string,
  sourceLabel = label,
  options: Parameters<typeof findAero6kRow>[2] = {},
): TripleValue {
  const row = findAero6kRow(html, label, options);
  const values = rowValuesFromCells(row).map((value) => value * SIX_K_SCALE);
  const current = values[0];
  const sameQuarterPriorYear = values[1];

  if (current === undefined || sameQuarterPriorYear === undefined) {
    throw new Error(`Unable to parse AERO 6-K row values: ${label}`);
  }

  return {
    current,
    previousQuarter: null,
    sameQuarterPriorYear,
    snippet: `${sourceLabel} 6-K table row: ${round(current, 4)}, ${round(sameQuarterPriorYear, 4)} USD bn`,
  };
}

function quarterFromAero6k(rawText: string) {
  const match = rawText.match(/\b(First|Second|Third|Fourth) Quarter 20(\d{2}) Results/i);
  if (!match) throw new Error("Unable to identify AERO 6-K quarter");

  const quarterMap: Record<string, { quarter: string; monthDay: string }> = {
    first: { quarter: "Q1", monthDay: "03-31" },
    second: { quarter: "Q2", monthDay: "06-30" },
    third: { quarter: "Q3", monthDay: "09-30" },
    fourth: { quarter: "Q4", monthDay: "12-31" },
  };
  const item = quarterMap[match[1].toLowerCase()];
  const fiscalYear = Number(`20${match[2]}`);
  return {
    fiscalYear,
    fiscalQuarter: item.quarter,
    periodLabel: `${fiscalYear} ${item.quarter}`,
    reportDate: `${fiscalYear}-${item.monthDay}`,
  };
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

function buildAero6kSegment(
  name: string,
  rowLabel: string,
  values: TripleValue,
  totalRevenue: number,
  driver: string,
): ParsedBusinessSegment {
  return {
    name,
    revenue: round(values.current, 4),
    revenueUnit: CURRENCY_UNIT,
    share: round((values.current / totalRevenue) * 100),
    yoy: yoy(values.current, values.sameQuarterPriorYear),
    qoq: null,
    grossMargin: null,
    driver: `${driver} Source row: ${rowLabel}.`,
    confidence: 0.88,
  };
}

export function parseAeromexico6kEarningsRelease(params: {
  companyId: string;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const rawText = htmlToText(params.html);
  const period = quarterFromAero6k(rawText);
  const revenue = aero6kValueFromRow(params.html, "Total revenue", "Total revenue", {
    after: "Revenues:",
    minFirstValue: 100,
  });
  const operatingProfit = aero6kValueFromRow(params.html, "Total operating income", "Total operating income (loss)");
  const netIncome = aero6kValueFromRow(params.html, "Profit (loss) for the period", "Profit (loss) for the period");
  const operatingMargin = (operatingProfit.current / revenue.current) * 100;
  const priorOperatingMargin = (operatingProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100;
  const passengerRevenue = aero6kValueFromRow(params.html, "Passenger", "Passenger revenue", {
    after: "Revenues:",
    exactLabel: true,
  });
  const cargoRevenue = aero6kValueFromRow(params.html, "Air cargo", "Air cargo revenue", {
    after: "Revenues:",
    exactLabel: true,
  });
  const otherRevenue = aero6kValueFromRow(params.html, "Other", "Other revenue", {
    after: "Revenues:",
    exactLabel: true,
  });
  const adjustedEbitdar = aero6kValueFromRow(params.html, "Adjusted EBITDAR", "Adjusted EBITDAR", {
    minFirstValue: 100,
  });
  const metrics: ParsedFinancialMetric[] = [
    metric("总营收", "revenue", revenue.current, CURRENCY_UNIT, revenue.snippet, {
      yoy: yoy(revenue.current, revenue.sameQuarterPriorYear),
      qoq: null,
    }),
    metric("营业利润", "operating_profit", operatingProfit.current, CURRENCY_UNIT, operatingProfit.snippet, {
      yoy: yoy(operatingProfit.current, operatingProfit.sameQuarterPriorYear),
      qoq: null,
    }),
    metric("营业利润率", "operating_margin", operatingMargin, "%", "Derived from operating income divided by total revenue.", {
      yoy: round(operatingMargin - priorOperatingMargin),
      qoq: null,
    }),
    metric("归母净利润", "net_income_attributable", netIncome.current, CURRENCY_UNIT, netIncome.snippet, {
      yoy: yoy(netIncome.current, netIncome.sameQuarterPriorYear),
      qoq: null,
    }),
    metric("Adjusted EBITDAR", "adjusted_ebitdar", adjustedEbitdar.current, CURRENCY_UNIT, adjustedEbitdar.snippet, {
      yoy: yoy(adjustedEbitdar.current, adjustedEbitdar.sameQuarterPriorYear),
      qoq: null,
      confidence: 0.86,
    }),
  ];
  const segments = [
    buildAero6kSegment(
      "Passenger",
      "Passenger",
      passengerRevenue,
      revenue.current,
      "Passenger revenue includes fare and passenger-related airline revenue.",
    ),
    buildAero6kSegment("Air cargo", "Air cargo", cargoRevenue, revenue.current, "Air cargo revenue."),
    buildAero6kSegment("Other", "Other", otherRevenue, revenue.current, "Other operating revenue."),
  ];

  return {
    companyId: params.companyId,
    fiscalYear: period.fiscalYear,
    fiscalQuarter: period.fiscalQuarter,
    periodLabel: period.periodLabel,
    reportDate: period.reportDate,
    releaseDate: params.releaseDate,
    sourceTitle: params.sourceTitle,
    sourceUrl: params.sourceUrl,
    contentHash: sha256(params.html),
    rawText: rawText.slice(0, 180_000),
    metrics,
    segments,
    quickNote: {
      headline: `Aeromexico ${period.periodLabel} revenue was USD ${round(revenue.current, 2)}bn, with operating margin ${round(
        operatingMargin,
      )}% and profit/loss for the period of USD ${round(netIncome.current, 2)}bn.`,
      highlights: [
        `Total revenue reached USD ${round(revenue.current, 2)}bn, YoY ${yoy(
          revenue.current,
          revenue.sameQuarterPriorYear,
        )}%.`,
        `Passenger revenue reached USD ${round(passengerRevenue.current, 2)}bn.`,
        `Adjusted EBITDAR was USD ${round(adjustedEbitdar.current, 2)}bn, with operating income of USD ${round(
          operatingProfit.current,
          2,
        )}bn.`,
      ],
      weaknesses: [
        `Operating margin was ${round(operatingMargin)}%, down ${round(operatingMargin - priorOperatingMargin)} percentage points YoY.`,
        "Quarterly 6-K figures are unaudited and may not include every annual Form 20-F disclosure line.",
        "Fuel price and FX exposure remain key airline-specific sensitivities.",
      ],
      segmentComments: Object.fromEntries(segments.map((segment) => [segment.name, segment.driver ?? ""])),
      marginComments: `Operating income was USD ${round(
        operatingProfit.current,
        2,
      )}bn, implying an operating margin of ${round(operatingMargin)}%.`,
      aiSummary: "No material AI revenue disclosure was parsed from the airline 6-K earnings release.",
      watchItems: ["Second-half 2026 revenue guidance", "Fuel expense pressure", "Passenger and cargo revenue mix"],
      marketReaction: "行情反应待接入实时行情源校验。",
      sourceMap: {
        revenue: revenue.snippet,
        operatingProfit: operatingProfit.snippet,
        netIncome: netIncome.snippet,
        source: params.sourceUrl,
      },
    },
    comparativeReports: [
      {
        fiscalYear: period.fiscalYear - 1,
        fiscalQuarter: period.fiscalQuarter,
        periodLabel: `${period.fiscalYear - 1} ${period.fiscalQuarter}`,
        reportDate: `${period.fiscalYear - 1}-${period.reportDate.slice(5)}`,
        releaseDate: params.releaseDate,
        metrics: [
          metric("总营收", "revenue", revenue.sameQuarterPriorYear, CURRENCY_UNIT, revenue.snippet),
          metric(
            "营业利润",
            "operating_profit",
            operatingProfit.sameQuarterPriorYear,
            CURRENCY_UNIT,
            operatingProfit.snippet,
          ),
          metric(
            "营业利润率",
            "operating_margin",
            priorOperatingMargin,
            "%",
            "Derived from operating income divided by total revenue.",
          ),
          metric("归母净利润", "net_income_attributable", netIncome.sameQuarterPriorYear, CURRENCY_UNIT, netIncome.snippet),
        ],
      },
    ],
  };
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

export function parseAeromexicoReport(params: {
  companyId: string;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const text = htmlToText(params.html);
  if (/Reports Unaudited .* Quarter 20\d{2} Results/i.test(text)) {
    return parseAeromexico6kEarningsRelease(params);
  }

  return parseAeromexico2025Form20F(params);
}
