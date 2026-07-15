/**
 * PortfolioClassAdapter — the ONE extension point for asset classes.
 *
 * Adding an 11th asset class must mean writing one file in lib/portfolio/classes/
 * and registering it here. It must not mean editing an engine, a route, or a page.
 * If you find yourself widening a `switch` in lib/portfolio/engines/, the thing you
 * actually needed belongs on this interface instead.
 *
 * Adapters are PURE functions of (RawHolding, MarketContext). They never fetch —
 * lib/portfolio/context.ts resolves everything once, through the platform data
 * layer, and hands it in. That is what keeps them unit-testable with no I/O.
 */

import type {
  FactorSensitivities,
  Holding,
  HoldingScore,
  HoldingUnit,
  Liquidity,
  MarketContext,
  PortfolioAssetClass,
  RawHolding,
  Valuation,
  ValuationMode,
  Income,
} from "./types";
import type { AssetClassId } from "../../assets/types";

export interface PortfolioClassAdapter {
  id: PortfolioAssetClass;
  valuationMode: ValuationMode;
  defaultLiquidity: Liquidity;
  unit: HoldingUnit;

  /**
   * The corresponding class in the shared Asset Registry (lib/assets/), when one
   * exists. Metrics, warnings, chart config and AI framing are read from there —
   * this adapter must not restate them. `null` for the four manually-valued
   * classes and cash, which have no screening domain and therefore no registry
   * entry (they can't be screened — there is no universe to screen).
   */
  registryClass: AssetClassId | null;

  /**
   * How long a manually-entered valuation stays trustworthy for this class,
   * in days. Beyond it, Valuation.stale flips and confidence is discounted.
   * `null` for market-priced classes, whose value is never manual.
   */
  manualStalenessDays: number | null;

  /** Establish current value. Must set both `value` and `valueBase`. */
  value(raw: RawHolding, ctx: MarketContext): Valuation;

  /** Expected annual income. `null` when the class produces none. */
  income(raw: RawHolding, valuation: Valuation, ctx: MarketContext): Income | null;

  /**
   * Sensitivity to each macro factor. Measured where possible (equity beta from
   * returns, bond duration from the provider), from a curated reference table
   * where not, and ABSENT where neither — never guessed.
   */
  factors(raw: RawHolding, ctx: MarketContext): FactorSensitivities;

  /** Class-native metrics, for display and for this class's own scoring. */
  metrics(raw: RawHolding, ctx: MarketContext): Record<string, number | null>;

  /** Cross-cutting attributes the engines aggregate on (sector, geography, …). */
  attributes(raw: RawHolding, ctx: MarketContext): Record<string, string | null>;

  /**
   * This class's own attractiveness score.
   *
   * MUST return `null` — never a neutral 50 — when the class has no honest basis
   * to score the holding. Returning a fabricated midpoint is the specific bug this
   * contract exists to prevent: today a bond scores 50 purely because
   * `computeScore()` wanted a FundamentalsSnapshot and got null, and that 50 then
   * drives target weights and BUY/SELL actions as if it had been measured.
   */
  score(raw: RawHolding, ctx: MarketContext): HoldingScore | null;

  /** Liquidity, when the class can be more specific than `defaultLiquidity`. */
  liquidity?(raw: RawHolding, ctx: MarketContext): Liquidity;

  /**
   * Override the basis P&L is measured against. Defaults to `raw.costBasis` when
   * absent — correct for every class except a LEVERED one.
   *
   * The bug this exists to prevent: real estate's `value()` returns NET equity
   * (property value minus the mortgage), but `raw.costBasis` is the GROSS purchase
   * price. Comparing a net valuation against a gross cost basis produced a
   * fabricated -50% P&L on a property that had actually appreciated — a $520k
   * property bought for $420k with a $310k mortgage nets to $210k of equity, and
   * $210k against a $420k gross cost basis reads as "lost half your money" when the
   * true story is a healthy, leverage-amplified gain on the $110k actually invested.
   * The real-estate adapter overrides this to return the same "cash invested"
   * figure (acquisitionCost − outstandingMortgage) its own cash-on-cash metric
   * already uses, so valueBase and costBasis are compared on the SAME (net) basis.
   */
  costBasis?(raw: RawHolding, ctx: MarketContext): number;

  /** Which metric keys the holdings table shows for this class, in order. */
  row: { primary: string[]; secondary: string[] };
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

const adapters = new Map<PortfolioAssetClass, PortfolioClassAdapter>();

export function registerClass(adapter: PortfolioClassAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getClassAdapter(id: PortfolioAssetClass): PortfolioClassAdapter {
  const a = adapters.get(id);
  if (!a) throw new Error(`No portfolio class adapter registered for "${id}"`);
  return a;
}

export function hasClassAdapter(id: string): id is PortfolioAssetClass {
  return adapters.has(id as PortfolioAssetClass);
}

export function listClassAdapters(): PortfolioClassAdapter[] {
  return [...adapters.values()];
}

/* -------------------------------------------------------------------------- */
/* Shared helpers for adapters                                                 */
/* -------------------------------------------------------------------------- */

/** Convert an amount in `currency` to the portfolio's base currency. */
export function toBase(amount: number, currency: string, ctx: MarketContext): number {
  const rate = ctx.fx[currency.toUpperCase()] ?? 1;
  return amount * rate;
}

export function fxRate(currency: string, ctx: MarketContext): number {
  return ctx.fx[currency.toUpperCase()] ?? 1;
}

/** Days between an ISO date and now. Returns null for a missing/invalid date. */
export function ageInDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

/**
 * Build a Valuation for a manually-valued holding, applying the class's staleness
 * bound. Shared by real estate / private markets / alternatives so the staleness
 * rule cannot drift between them.
 */
export function manualValuation(
  raw: RawHolding,
  ctx: MarketContext,
  stalenessDays: number,
  mode: ValuationMode = "manual",
): Valuation {
  // Fall back to cost basis when the user has never stated a value — cost is a
  // known, honest number; a zero would silently erase the asset from the portfolio.
  const value = raw.manualValue ?? raw.costBasis;
  const asOf = raw.manualValueAsOf ?? raw.acquiredAt;
  const age = ageInDays(asOf);
  const rate = fxRate(raw.currency, ctx);

  return {
    mode,
    value,
    valueBase: value * rate,
    fxRate: rate,
    source: "user",
    asOf,
    stale: age != null && age > stalenessDays,
  };
}

/**
 * Confidence-weighted blend toward a neutral midpoint.
 *
 * Without this, a holding scoring 90 on the one input that happened to be
 * available outranks a fully-covered holding scoring 75 — the exact failure mode
 * that produced the screener's bond-ranking bug and the fit-scorer's "everything
 * scores 73". Shrinking toward 50 in proportion to missing data means a
 * thinly-evidenced score cannot masquerade as a strong one.
 */
export function shrinkToConfidence(score: number, confidence: number, neutral = 50): number {
  const c = Math.max(0, Math.min(100, confidence)) / 100;
  return neutral + (score - neutral) * c;
}

/** Percentage of the given inputs that are non-null — the natural confidence measure. */
export function coverage(inputs: (number | null | undefined)[]): number {
  if (inputs.length === 0) return 0;
  const present = inputs.filter((x) => x != null && Number.isFinite(x)).length;
  return (present / inputs.length) * 100;
}

/** Map a value onto 0-100 by linear interpolation, clamped. */
export function lerpScore(value: number, worst: number, best: number): number {
  if (worst === best) return 50;
  const t = (value - worst) / (best - worst);
  return Math.max(0, Math.min(100, t * 100));
}

/** Assemble the normalized Holding. Called only by lib/portfolio/model/holding.ts. */
export type NormalizedHolding = Holding;
