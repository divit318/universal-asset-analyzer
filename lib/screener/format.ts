/**
 * Metric formatting, driven entirely by the registry's MetricDef.unit. Shared
 * by the explanation layer (server) and the results table (client) so a value
 * reads identically wherever it surfaces.
 */

import type { MetricDef } from "../assets/types";

/** Compact money: $1.24B, $340M, $12.5K. */
export function formatMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatCount(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatMetricValue(metric: MetricDef, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";

  switch (metric.unit) {
    case "$B":
      return formatMoney(value);
    case "$":
      return value >= 1000 ? formatMoney(value) : `$${value.toFixed(2)}`;
    case "%":
      // One decimal below 100%: the difference between a 22.4% and a 22.9% ROIC
      // is real, and rounding it away in a screener is a loss of signal. Above
      // 100% (a triple-digit return) the decimal is noise.
      return `${value.toFixed(Math.abs(value) < 100 ? 1 : 0)}%`;
    case "x":
      return `${value.toFixed(2)}x`;
    case "yrs":
      return `${value.toFixed(1)} yrs`;
    case "bps":
      return `${Math.round(value)} bps`;
    case "score":
      return String(Math.round(value));
    case "":
      return formatCount(value);
  }
}

/** The value a user typed/stored, converted to the unit the metric is measured in. */
export function toStoredValue(metric: MetricDef, input: number): number {
  return metric.scale ? input * metric.scale : input;
}

/** The stored value, converted back to what the user should see in an input box. */
export function toInputValue(metric: MetricDef, stored: number): number {
  return metric.scale ? stored / metric.scale : stored;
}
