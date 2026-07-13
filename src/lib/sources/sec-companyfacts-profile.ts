import type { SecCompanyFacts } from "./sec";
import { sha256 } from "./sec";
import type { MonetaryUnit, ParsedEarningsReport, ParsedFinancialMetric } from "./types";
import {
  buildStandardComparatives,
  buildStandardQuickNote,
  maybeQoq,
  metric,
  round,
  yoy,
  type TripleValue,
} from "./profile-utils";

export type CompanyFactMetric = {
  taxonomy?: string;
  concept: string;
  unit: string;
  normalized: string;
  name: string;
};

export type CompanyFactsProfile = {
  currencyUnit: MonetaryUnit;
  fiscalYear: number;
  fiscalQuarter: string;
  frame?: string;
  metrics: CompanyFactMetric[];
};

type SecFactValue = {
  start?: string;
  end?: string;
  filed?: string;
  form?: string;
  fp?: string;
  fy?: number;
  frame?: string;
  val?: number;
};

type QuarterFact = {
  taxonomy: string;
  concept: string;
  unit: string;
  start: string;
  end: string;
  filed: string;
  form: string;
  fp?: string;
  fy?: number;
  frame?: string;
  val: number;
  durationDays: number;
};

type FactBundle = {
  concept: string;
  current: QuarterFact;
  priorYear: QuarterFact;
  previousQuarter: QuarterFact | null;
};

const dayMs = 24 * 60 * 60 * 1000;

const usTechConcepts = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  grossProfit: ["GrossProfit"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  operatingProfit: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
};

function findFact(facts: SecCompanyFacts, item: CompanyFactMetric) {
  const taxonomy = item.taxonomy ?? "us-gaap";
  const fact = facts.facts?.[taxonomy]?.[item.concept];
  if (!fact) throw new Error(`SEC CompanyFacts concept not found: ${taxonomy}:${item.concept}`);
  const values = fact.units?.[item.unit];
  if (!values?.length) throw new Error(`SEC CompanyFacts unit not found: ${taxonomy}:${item.concept}:${item.unit}`);
  return values;
}

export function latestQuarterFactValue(
  facts: SecCompanyFacts,
  item: CompanyFactMetric,
  options: { fiscalYear: number; fiscalQuarter: string; frame?: string },
) {
  const values = findFact(facts, item);
  const target = values
    .filter((value) => value.form === "10-Q" || value.form === "10-K")
    .filter((value) => value.val !== undefined)
    .filter((value) =>
      options.frame
        ? value.frame === options.frame
        : value.fy === options.fiscalYear && value.fp === options.fiscalQuarter,
    )
    .sort((first, second) => (second.filed ?? "").localeCompare(first.filed ?? ""))[0];

  if (target?.val === undefined) {
    throw new Error(`SEC CompanyFacts value not found for ${item.concept} ${options.fiscalYear}${options.fiscalQuarter}`);
  }

  return target;
}

export function buildCompanyFactMetrics(params: {
  facts: SecCompanyFacts;
  profile: CompanyFactsProfile;
  priorYearProfile?: Pick<CompanyFactsProfile, "fiscalYear" | "fiscalQuarter" | "frame">;
}): ParsedFinancialMetric[] {
  return params.profile.metrics.map((item) => {
    const current = latestQuarterFactValue(params.facts, item, params.profile);
    const prior = params.priorYearProfile
      ? latestQuarterFactValue(params.facts, item, params.priorYearProfile)
      : null;
    const unit = item.unit === "pure" ? "%" : params.profile.currencyUnit;
    const currentValue = item.unit === "USD" ? current.val! / 1_000_000_000 : current.val!;
    const priorValue =
      prior && item.unit === "USD" ? prior.val! / 1_000_000_000 : prior ? prior.val! : null;

    return metric(item.name, item.normalized, round(currentValue, unit === "%" ? 1 : 4), unit, `${item.concept} frame=${current.frame ?? current.end}`, {
      yoy: priorValue === null ? null : yoy(currentValue, priorValue),
      qoq: null,
      confidence: 0.86,
    });
  });
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / dayMs) + 1;
}

function factYear(value: QuarterFact) {
  return value.fy ?? Number(value.end.slice(0, 4));
}

function periodLabel(fiscalYear: number, fiscalQuarter: string) {
  return `${fiscalYear} ${fiscalQuarter}`;
}

function sourceAnchor(value: QuarterFact) {
  const frame = value.frame ? ` frame=${value.frame}` : "";
  return `SEC CompanyFacts us-gaap:${value.concept}${frame}; ${value.start} to ${value.end}; filed ${value.filed}.`;
}

function valueBn(value: QuarterFact) {
  return value.val / 1_000_000_000;
}

function factsForConcept(
  facts: SecCompanyFacts,
  concept: string,
  options: { taxonomy?: string; unit?: string } = {},
) {
  const taxonomy = options.taxonomy ?? "us-gaap";
  const unit = options.unit ?? "USD";
  const values: SecFactValue[] = facts.facts?.[taxonomy]?.[concept]?.units?.[unit] ?? [];

  return values
    .flatMap((value): QuarterFact[] => {
      if (
        value.val === undefined ||
        value.form !== "10-Q" ||
        !value.start ||
        !value.end ||
        !value.filed
      ) {
        return [];
      }

      const durationDays = daysBetween(value.start, value.end);
      if (durationDays < 70 || durationDays > 120) return [];

      return [
        {
          taxonomy,
          concept,
          unit,
          start: value.start,
          end: value.end,
          filed: value.filed,
          form: value.form,
          fp: value.fp,
          fy: value.fy,
          frame: value.frame,
          val: value.val,
          durationDays,
        },
      ];
    })
    .sort((first, second) => {
      const endOrder = second.end.localeCompare(first.end);
      if (endOrder !== 0) return endOrder;
      return second.filed.localeCompare(first.filed);
    });
}

function selectPriorYearFact(current: QuarterFact, quarters: QuarterFact[]) {
  const sameFiling = quarters
    .filter((value) => value.filed === current.filed)
    .filter((value) => value.fp === current.fp || !value.fp || !current.fp)
    .filter((value) => value.end < current.end)
    .filter((value) => Math.abs(value.durationDays - current.durationDays) <= 7)
    .sort((first, second) => second.end.localeCompare(first.end))[0];

  if (sameFiling) return sameFiling;

  const currentEnd = Date.parse(current.end);
  return quarters
    .filter((value) => value.end < current.end)
    .map((value) => ({
      value,
      dayDistance: Math.round((currentEnd - Date.parse(value.end)) / dayMs),
    }))
    .filter((item) => item.dayDistance >= 330 && item.dayDistance <= 400)
    .sort((first, second) => Math.abs(first.dayDistance - 365) - Math.abs(second.dayDistance - 365))[0]?.value;
}

function selectPreviousQuarterFact(current: QuarterFact, quarters: QuarterFact[]) {
  const currentEnd = Date.parse(current.end);
  return quarters
    .filter((value) => value.end < current.end)
    .map((value) => ({
      value,
      dayDistance: Math.round((currentEnd - Date.parse(value.end)) / dayMs),
    }))
    .filter((item) => item.dayDistance >= 75 && item.dayDistance <= 120)
    .sort((first, second) => Math.abs(first.dayDistance - 91) - Math.abs(second.dayDistance - 91))[0]?.value ?? null;
}

function bundleFromCurrent(current: QuarterFact, quarters: QuarterFact[]): FactBundle | null {
  const priorYear = selectPriorYearFact(current, quarters);
  if (!priorYear) return null;

  return {
    concept: current.concept,
    current,
    priorYear,
    previousQuarter: selectPreviousQuarterFact(current, quarters),
  };
}

function latestBundleForConcepts(facts: SecCompanyFacts, concepts: string[]) {
  const bundles = concepts.flatMap((concept) => {
    const quarters = factsForConcept(facts, concept);
    const current = quarters[0];
    if (!current) return [];
    const bundle = bundleFromCurrent(current, quarters);
    return bundle ? [bundle] : [];
  });

  return bundles.sort((first, second) => {
    const endOrder = second.current.end.localeCompare(first.current.end);
    if (endOrder !== 0) return endOrder;
    return second.current.filed.localeCompare(first.current.filed);
  })[0];
}

function bundleForAnchor(facts: SecCompanyFacts, concepts: string[], anchor: QuarterFact) {
  for (const concept of concepts) {
    const quarters = factsForConcept(facts, concept);
    const current =
      quarters.find((value) => value.end === anchor.end && value.filed === anchor.filed) ??
      quarters.find((value) => value.end === anchor.end);
    if (!current) continue;

    const bundle = bundleFromCurrent(current, quarters);
    if (bundle) return bundle;
  }

  throw new Error(`SEC CompanyFacts did not contain a matching concept for ${concepts.join(", ")} at ${anchor.end}`);
}

function bundleToTriple(bundle: FactBundle): TripleValue {
  return {
    current: valueBn(bundle.current),
    previousQuarter: bundle.previousQuarter ? valueBn(bundle.previousQuarter) : null,
    sameQuarterPriorYear: valueBn(bundle.priorYear),
    snippet: sourceAnchor(bundle.current),
  };
}

function derivedGrossProfitTriple(revenue: TripleValue, costOfRevenue: TripleValue): TripleValue {
  return {
    current: revenue.current - costOfRevenue.current,
    previousQuarter:
      revenue.previousQuarter === null || costOfRevenue.previousQuarter === null
        ? null
        : revenue.previousQuarter - costOfRevenue.previousQuarter,
    sameQuarterPriorYear: revenue.sameQuarterPriorYear - costOfRevenue.sameQuarterPriorYear,
    snippet: "Derived from SEC CompanyFacts revenue less cost of revenue.",
  };
}

function marginChange(currentNumerator: number, currentDenominator: number, priorNumerator: number, priorDenominator: number) {
  return round((currentNumerator / currentDenominator) * 100 - (priorNumerator / priorDenominator) * 100);
}

function marginQoq(numerator: TripleValue, denominator: TripleValue) {
  if (numerator.previousQuarter === null || denominator.previousQuarter === null) return null;
  return marginChange(numerator.current, denominator.current, numerator.previousQuarter, denominator.previousQuarter);
}

function metricSet(params: {
  revenue: TripleValue;
  grossProfit: TripleValue;
  operatingProfit: TripleValue;
  netIncome: TripleValue;
  currencyUnit: MonetaryUnit;
}) {
  const { currencyUnit, revenue, grossProfit, operatingProfit, netIncome } = params;
  const grossMargin = (grossProfit.current / revenue.current) * 100;
  const operatingMargin = (operatingProfit.current / revenue.current) * 100;

  return {
    grossMargin,
    operatingMargin,
    metrics: [
      metric("总营收", "revenue", revenue.current, currencyUnit, revenue.snippet, {
        yoy: yoy(revenue.current, revenue.sameQuarterPriorYear),
        qoq: maybeQoq(revenue.current, revenue.previousQuarter),
        confidence: 0.9,
      }),
      metric("毛利润", "gross_profit", grossProfit.current, currencyUnit, grossProfit.snippet, {
        yoy: yoy(grossProfit.current, grossProfit.sameQuarterPriorYear),
        qoq: maybeQoq(grossProfit.current, grossProfit.previousQuarter),
        confidence: 0.86,
      }),
      metric("毛利率", "gross_margin", grossMargin, "%", "Derived from SEC CompanyFacts gross profit divided by revenue.", {
        yoy: marginChange(
          grossProfit.current,
          revenue.current,
          grossProfit.sameQuarterPriorYear,
          revenue.sameQuarterPriorYear,
        ),
        qoq: marginQoq(grossProfit, revenue),
        confidence: 0.86,
      }),
      metric("营业利润", "operating_profit", operatingProfit.current, currencyUnit, operatingProfit.snippet, {
        yoy: yoy(operatingProfit.current, operatingProfit.sameQuarterPriorYear),
        qoq: maybeQoq(operatingProfit.current, operatingProfit.previousQuarter),
        confidence: 0.9,
      }),
      metric(
        "营业利润率",
        "operating_margin",
        operatingMargin,
        "%",
        "Derived from SEC CompanyFacts operating profit divided by revenue.",
        {
          yoy: marginChange(
            operatingProfit.current,
            revenue.current,
            operatingProfit.sameQuarterPriorYear,
            revenue.sameQuarterPriorYear,
          ),
          qoq: marginQoq(operatingProfit, revenue),
          confidence: 0.86,
        },
      ),
      metric("归母净利润", "net_income_attributable", netIncome.current, currencyUnit, netIncome.snippet, {
        yoy: yoy(netIncome.current, netIncome.sameQuarterPriorYear),
        qoq: maybeQoq(netIncome.current, netIncome.previousQuarter),
        confidence: 0.9,
      }),
    ],
  };
}

export function parseSecCompanyFactsUsTechReport(params: {
  companyId: string;
  companyName: string;
  facts: SecCompanyFacts;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const currencyUnit: MonetaryUnit = "USD bn";
  const revenueBundle = latestBundleForConcepts(params.facts, usTechConcepts.revenue);
  if (!revenueBundle) {
    throw new Error("SEC CompanyFacts parser could not find a recent quarterly revenue fact");
  }

  const anchor = revenueBundle.current;
  const costBundle = bundleForAnchor(params.facts, usTechConcepts.costOfRevenue, anchor);
  const operatingProfitBundle = bundleForAnchor(params.facts, usTechConcepts.operatingProfit, anchor);
  const netIncomeBundle = bundleForAnchor(params.facts, usTechConcepts.netIncome, anchor);
  const grossProfitBundle = latestBundleForConcepts(params.facts, usTechConcepts.grossProfit);
  const alignedGrossProfitBundle =
    grossProfitBundle?.current.end === anchor.end && grossProfitBundle.current.filed === anchor.filed
      ? grossProfitBundle
      : null;

  const revenue = bundleToTriple(revenueBundle);
  const costOfRevenue = bundleToTriple(costBundle);
  const grossProfit = alignedGrossProfitBundle
    ? bundleToTriple(alignedGrossProfitBundle)
    : derivedGrossProfitTriple(revenue, costOfRevenue);
  const operatingProfit = bundleToTriple(operatingProfitBundle);
  const netIncome = bundleToTriple(netIncomeBundle);
  const currentFiscalYear = factYear(anchor);
  const currentFiscalQuarter = anchor.fp ?? "Q";
  const { grossMargin, operatingMargin, metrics } = metricSet({
    revenue,
    grossProfit,
    operatingProfit,
    netIncome,
    currencyUnit,
  });
  const rawText = JSON.stringify({
    entityName: params.facts.entityName,
    sourceUrl: params.sourceUrl,
    sourceTitle: params.sourceTitle,
    current: anchor,
    concepts: {
      revenue: revenueBundle.concept,
      costOfRevenue: costBundle.concept,
      grossProfit: alignedGrossProfitBundle?.concept ?? "derived",
      operatingProfit: operatingProfitBundle.concept,
      netIncome: netIncomeBundle.concept,
    },
    metrics,
  });

  return {
    companyId: params.companyId,
    fiscalYear: currentFiscalYear,
    fiscalQuarter: currentFiscalQuarter,
    periodLabel: periodLabel(currentFiscalYear, currentFiscalQuarter),
    reportDate: anchor.end,
    releaseDate: params.releaseDate,
    sourceTitle: params.sourceTitle,
    sourceUrl: params.sourceUrl,
    contentHash: sha256(rawText),
    rawText,
    metrics,
    segments: [],
    quickNote: buildStandardQuickNote({
      context: {
        companyName: params.companyName,
        periodLabel: periodLabel(currentFiscalYear, currentFiscalQuarter),
        currencyUnit,
        sourceTitle: params.sourceTitle,
      },
      revenue,
      grossProfit,
      netIncome,
      grossMargin: round(grossMargin),
      operatingProfit,
      operatingMargin: round(operatingMargin),
      segments: [],
      aiSummary:
        "SEC CompanyFacts parser covers company-level 10-Q XBRL metrics; business segment revenue still needs a filing-table parser.",
      sourceMap: {
        revenue: revenue.snippet,
        netIncome: netIncome.snippet,
        source: params.sourceUrl,
      },
    }),
    comparativeReports: buildStandardComparatives({
      currencyUnit,
      priorYearPeriod: {
        fiscalYear: currentFiscalYear - 1,
        fiscalQuarter: currentFiscalQuarter,
        periodLabel: periodLabel(currentFiscalYear - 1, currentFiscalQuarter),
        reportDate: revenueBundle.priorYear.end,
      },
      previousQuarterPeriod: {
        fiscalYear: revenueBundle.previousQuarter ? factYear(revenueBundle.previousQuarter) : currentFiscalYear,
        fiscalQuarter: revenueBundle.previousQuarter?.fp ?? currentFiscalQuarter,
        periodLabel: revenueBundle.previousQuarter
          ? periodLabel(factYear(revenueBundle.previousQuarter), revenueBundle.previousQuarter.fp ?? currentFiscalQuarter)
          : periodLabel(currentFiscalYear, currentFiscalQuarter),
        reportDate: revenueBundle.previousQuarter?.end,
      },
      revenue,
      grossProfit,
      netIncome,
      operatingProfit,
    }),
  };
}
