/**
 * Vehicle quality — "is this a good way to buy this exposure?", as distinct
 * from "is this exposure worth buying?".
 *
 * Two funds tracking the same index are the same investment and different
 * products: cost compounds, thin liquidity taxes every entry and exit, and a
 * short track record means the risk statistics elsewhere on the page rest on
 * less. Those are the fields a long-term holder actually decides on.
 *
 * Strictly limited to what the existing data supports. Deliberately NOT
 * reported, because Yahoo's fund modules don't carry them and a plausible wrong
 * number is worse than an absent one: bid/ask spread, premium/discount to NAV,
 * replication methodology (physical vs synthetic), securities-lending revenue,
 * and tracking error. Tracking error in particular needs the fund's OWN index —
 * measuring it against the market benchmark the chart happens to use would
 * report a real number for the wrong question. `omissions` names them so the UI
 * can say what it doesn't know rather than quietly showing a shorter list.
 *
 * Pure and client-safe.
 */

import type { FundProfileData, HistoryPoint } from "../../types";

export type LiquidityTier = "deep" | "adequate" | "thin" | "illiquid";

/** Median daily traded value, in the listing currency, for each tier's floor. */
export const LIQUIDITY_FLOORS: Record<Exclude<LiquidityTier, "illiquid">, number> = {
  deep: 50_000_000,
  adequate: 5_000_000,
  thin: 500_000,
};

export interface VehicleQuality {
  /** Annual cost of holding 10,000 units of the fund's currency, from the expense ratio. */
  annualCostPer10k: number | null;
  expenseRatioPct: number | null;
  expenseRatioSource: "yahoo" | "amfi" | null;
  /** Total net assets, in the fund's own reporting currency. */
  aum: number | null;
  currency: string | null;
  turnoverPct: number | null;
  morningstarRating: number | null;

  /** Years since inception, one decimal. Null when inception is unknown. */
  trackRecordYears: number | null;
  /** True when the fund is too young for the 5-year statistics elsewhere to exist. */
  shortTrackRecord: boolean;

  /** Median daily traded value over the last ~3 months, listing currency. */
  medianDailyValue: number | null;
  liquidity: LiquidityTier | null;

  /** Fields Yahoo's fund modules don't carry — stated, not silently dropped. */
  omissions: string[];
  /** One sentence on whether this is a good vehicle, null when nothing is known. */
  summary: string | null;
}

const OMISSIONS = [
  "bid/ask spread",
  "premium/discount to NAV",
  "replication method",
  "tracking error vs the fund's own index",
];

/** ~3 months of sessions — recent enough to describe how it trades today. */
const LIQUIDITY_WINDOW_DAYS = 63;

function medianDailyTradedValue(history: HistoryPoint[]): number | null {
  const values: number[] = [];
  for (const p of history.slice(-LIQUIDITY_WINDOW_DAYS)) {
    const close = p.close;
    if (p.volume == null || !Number.isFinite(p.volume) || p.volume <= 0) continue;
    if (!Number.isFinite(close) || close <= 0) continue;
    values.push(p.volume * close);
  }
  // A mutual fund has no traded volume at all; a handful of stray sessions on an
  // otherwise untraded line would produce a confident median off ~3 prints.
  if (values.length < 20) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

function tierOf(value: number | null): LiquidityTier | null {
  if (value == null) return null;
  if (value >= LIQUIDITY_FLOORS.deep) return "deep";
  if (value >= LIQUIDITY_FLOORS.adequate) return "adequate";
  if (value >= LIQUIDITY_FLOORS.thin) return "thin";
  return "illiquid";
}

export function assessVehicle(fund: FundProfileData, history: HistoryPoint[]): VehicleQuality {
  const expenseRatioPct = fund.expenseRatio != null ? fund.expenseRatio * 100 : null;

  let trackRecordYears: number | null = null;
  if (fund.inceptionDate) {
    const t = Date.parse(fund.inceptionDate);
    if (!Number.isNaN(t)) {
      const years = (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
      if (years >= 0) trackRecordYears = Math.round(years * 10) / 10;
    }
  }

  const medianDailyValue = medianDailyTradedValue(history);
  const liquidity = tierOf(medianDailyValue);

  const parts: string[] = [];
  if (expenseRatioPct != null) {
    const costWord = expenseRatioPct <= 0.15 ? "cheap" : expenseRatioPct <= 0.4 ? "reasonably priced" : expenseRatioPct <= 0.75 ? "mid-priced" : "expensive";
    parts.push(`${costWord} at ${expenseRatioPct.toFixed(2)}% a year (${Math.round(expenseRatioPct * 100)} per 10,000 held)`);
  }
  if (liquidity === "deep") parts.push("deeply traded, so entry and exit cost little");
  else if (liquidity === "thin" || liquidity === "illiquid") parts.push(`thinly traded — around ${Math.round((medianDailyValue ?? 0) / 1000).toLocaleString()}k of value changes hands on a typical day, so use limit orders`);
  if (trackRecordYears != null && trackRecordYears < 3) parts.push(`only ${trackRecordYears.toFixed(1)} years old, so its risk statistics rest on a short sample`);

  return {
    annualCostPer10k: expenseRatioPct != null ? Math.round(expenseRatioPct * 100) : null,
    expenseRatioPct,
    expenseRatioSource: fund.expenseRatioSource,
    aum: fund.totalNetAssets,
    currency: fund.currency,
    turnoverPct: fund.turnoverPercent != null ? fund.turnoverPercent * 100 : null,
    morningstarRating: fund.morningstarRating,
    trackRecordYears,
    shortTrackRecord: trackRecordYears != null && trackRecordYears < 5,
    medianDailyValue,
    liquidity,
    omissions: OMISSIONS,
    summary: parts.length > 0 ? `As a vehicle: ${parts.join("; ")}.` : null,
  };
}
