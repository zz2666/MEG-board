import type { SecCompanyFacts } from "./sec";
import type { MonetaryUnit, ParsedFinancialMetric } from "./types";
import { metric, round, yoy } from "./profile-utils";

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

  if (!target?.val) {
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
