import type { MonetaryUnit, MetricUnit } from "@/lib/sources/types";

export type DisplayCurrency = "RMB" | "USD" | "HKD";

export function currencyFromUnit(unit: string | null | undefined): DisplayCurrency {
  if (unit === "USD bn") return "USD";
  if (unit === "HKD bn") return "HKD";
  return "RMB";
}

export function monetaryUnitForCurrency(currency: DisplayCurrency): MonetaryUnit {
  if (currency === "USD") return "USD bn";
  if (currency === "HKD") return "HKD bn";
  return "RMB bn";
}

export function isMonetaryUnit(unit: string | null | undefined): unit is MonetaryUnit {
  return unit === "RMB bn" || unit === "USD bn" || unit === "HKD bn";
}

export function toDashboardMonetaryValue(valueInBn: number, unit: MonetaryUnit) {
  return unit === "RMB bn" ? valueInBn * 10 : valueInBn;
}

export function formatMoneyFromBn(valueInBn: number, unit: MonetaryUnit) {
  if (unit === "RMB bn") return `${Math.round(valueInBn * 10)} 亿`;
  if (unit === "HKD bn") return `HK$${valueInBn.toFixed(valueInBn >= 10 ? 1 : 2)}bn`;
  return `$${valueInBn.toFixed(valueInBn >= 10 ? 1 : 2)}bn`;
}

export function formatMetricDisplay(value: number, unit: MetricUnit | string) {
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (isMonetaryUnit(unit)) return formatMoneyFromBn(value, unit);
  return `${value}`;
}

export function formatDashboardMoneyValue(value: number, currency: DisplayCurrency = "RMB") {
  if (currency === "RMB") return `${value.toFixed(value < 0 ? 1 : 0)} 亿`;
  if (currency === "HKD") return `HK$${value.toFixed(value >= 10 || value <= -10 ? 1 : 2)}bn`;
  return `$${value.toFixed(value >= 10 || value <= -10 ? 1 : 2)}bn`;
}
