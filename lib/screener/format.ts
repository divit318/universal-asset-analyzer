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
    case "₹Cr": {
      // Raw INR → Indian units: ₹1,79,880 Cr, or ₹17.99L Cr above a lakh crore.
      const cr = value / 1e7;
      const sign = cr < 0 ? "-" : "";
      const abs = Math.abs(cr);
      if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L Cr`;
      return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
    }
    case "$":
      return value >= 1000 ? formatMoney(value) : `$${value.toFixed(2)}`;
    case "%": {
      // Precision scales with magnitude, because a single rule can't serve both
      // a 22.4% ROIC and a 0.03% expense ratio.
      //
      // Two decimals below 1%: sub-1% percentages are a real and common class
      // of value here — 111 of the 457 US ETFs in the universe charge between
      // 0.00% and 0.10%, and at one decimal every one of them rendered as
      // "0.0%" or "0.1%", making the single most important column in the ETF
      // screener useless for comparing funds. Worse, `explain` formats the
      // *filter bound* with this function too, so a "max 0.15%" filter was
      // restated back to the user as "Expense Ratio ≤ 0.2%" — a constraint that
      // was never applied.
      //
      // One decimal in between: the difference between a 22.4% and a 22.9% ROIC
      // is real. Above 100% (a triple-digit return) the decimal is noise.
      const abs = Math.abs(value);
      return `${value.toFixed(abs < 1 && abs > 0 ? 2 : abs < 100 ? 1 : 0)}%`;
    }
    case "pp":
      // Signed by design: a QoQ ownership delta's direction IS the information.
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}pp`;
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
