import type { MonetaryUnit, ParsedFinancialMetric } from "./types";
import { metric, round, yoy } from "./profile-utils";

export type PdfTextMetricRule = {
  name: string;
  normalized: string;
  labelPatterns: RegExp[];
  unit: MonetaryUnit | "%";
  scale?: number;
  valueIndex?: number;
};

export type PdfTextProfile = {
  currencyUnit: MonetaryUnit;
  metrics: PdfTextMetricRule[];
};

function numberFromToken(token: string) {
  const isNegative = token.includes("(") || token.trim().startsWith("-");
  const parsed = Number.parseFloat(token.replace(/[(),%]/g, ""));
  if (Number.isNaN(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

function numbersInText(text: string) {
  return [...text.matchAll(/\(?-?\d[\d,]*(?:\.\d+)?\s*\)?\s*%?/g)]
    .map((match) => numberFromToken(match[0]))
    .filter((value): value is number => value !== null);
}

export function findMetricLine(text: string, rule: PdfTextMetricRule) {
  const lines = text
    .split(/\n|(?<=\d)\s{2,}(?=[^\d])/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return lines.find((line) => rule.labelPatterns.some((pattern) => pattern.test(line)));
}

export function buildPdfTextMetrics(text: string, profile: PdfTextProfile): ParsedFinancialMetric[] {
  return profile.metrics.map((rule) => {
    const line = findMetricLine(text, rule);
    if (!line) throw new Error(`Unable to find PDF text metric line: ${rule.name}`);

    const values = numbersInText(line);
    const value = values[rule.valueIndex ?? 0];
    if (value === undefined) throw new Error(`Unable to parse PDF text metric value: ${rule.name}`);

    const scaled = round(value * (rule.scale ?? 1), rule.unit === "%" ? 1 : 4);
    return metric(rule.name, rule.normalized, scaled, rule.unit, line, {
      yoy: values.length > 1 && rule.unit !== "%" ? yoy(value, values[1]) : null,
      qoq: null,
      confidence: 0.72,
    });
  });
}
