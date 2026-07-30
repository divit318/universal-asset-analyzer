/**
 * Universal Scenario / Stress-Testing Engine.
 *
 * ── Why this is a rewrite and not an extension ────────────────────────────────
 *
 * The engine this replaces defined a scenario as a map of GICS sector → % shock,
 * and applied it as `shocks[holding.sector] ?? -20`. That has three failures, in
 * increasing order of seriousness:
 *
 *   1. It cannot express a rate shock, an inflation shock, or a dollar shock —
 *      only "sector X falls Y%".
 *   2. Assets with no GICS sector (every bond, every commodity, all crypto, cash,
 *      real estate) fall through to the default.
 *   3. THE DEFAULT IS -20%. So in the "2008 Financial Crisis" scenario, this tool
 *      told you gold would fall 20% (it rose ~5%), long Treasuries would fall 20%
 *      (they rallied hard), and your cash would fall 20% (it did not).
 *
 * That last one is the point. The tool was not merely silent about diversifying
 * assets — it was CONFIDENTLY WRONG about them, in the exact scenario you own them
 * for. A user checking "am I hedged?" was told no when the answer was yes.
 *
 * ── The model ─────────────────────────────────────────────────────────────────
 *
 * A scenario is a vector of macro FACTOR shocks (rates +2pp, equities -35%,
 * credit spreads +3pp, …). Each holding carries factor SENSITIVITIES, supplied by
 * its class adapter and measured wherever possible (equity beta from returns, bond
 * duration from the provider).
 *
 *     holding impact = exp( Σ_factor  sensitivity[factor] × shock[factor] ) − 1
 *     portfolio impact = Σ_holding impact% × weight
 *
 * The composition is in LOG-RETURN space — see applyShocks() for why summing the
 * products as simple returns is not merely imprecise but produces impossible
 * results at crisis-sized shocks.
 *
 * Gold rises in the 2008 scenario because its gold/inflation sensitivities are
 * positive and its equity beta is ~0 — not because someone remembered to add a
 * `Gold:` row to a lookup table. Every asset class reacts appropriately to every
 * scenario BY CONSTRUCTION. That is the whole design.
 */

import type { Factor, FactorSensitivities, Holding } from "../model/types";
import { FACTOR_LABEL, FACTOR_SHOCK_UNIT } from "../model/types";

export type FactorShocks = Partial<Record<Factor, number>>;

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  /** What actually happens, in factor space. */
  shocks: FactorShocks;
  category: "macro" | "market" | "credit" | "geopolitical" | "sector";
}

export interface HoldingImpact {
  id: string;
  symbol: string | null;
  name: string;
  assetClass: string;
  /**
   * % change in this holding's value.
   *
   * Structurally bounded to (−100, ∞) for a long position — see applyShocks().
   */
  impactPct: number;
  /** Change in base-currency value. */
  impactValue: number;
  /** Which factors drove it, largest contribution first. */
  drivers: { factor: Factor; label: string; contribution: number }[];
}

export interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  category: ScenarioDef["category"];
  /** % change in total portfolio value. */
  portfolioImpactPct: number;
  /**
   * `portfolioImpactPct` before rounding to one decimal.
   *
   * Anything that DIFFERENCES two scenario runs must use this, for the same reason
   * HealthScore carries `totalExact`: a before/after comparison that subtracts two
   * values already quantized to 0.1pp cannot resolve a change smaller than that,
   * and it reports the quantization as the answer. That is how the cash plan's
   * scenario table came to show "−8.6% → −6.6%, change 0.0pp" — the columns and
   * the delta were rounded independently, so they contradicted each other.
   */
  portfolioImpactPctExact: number;
  portfolioImpactValue: number;
  holdings: HoldingImpact[];
  worst: HoldingImpact | null;
  best: HoldingImpact | null;
  /**
   * Share of portfolio value that had at least one relevant factor sensitivity.
   * Anything below 100% means part of the portfolio was NOT stress-tested — and we
   * say so, rather than defaulting it to -20% and presenting the result as complete.
   */
  coveragePct: number;
  /** Human-readable summary of the shocks applied. */
  shockSummary: string[];
}

/* -------------------------------------------------------------------------- */
/* The scenario library                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Shock units: `equityBeta`/`usd`/`oil`/`gold`/`cryptoBeta` are % moves in that
 * complex; `rates`/`creditSpread`/`inflation`/`realEstateCap` are moves in
 * percentage points; `liquidityStress` is a 0-1 severity.
 */
export const SCENARIOS: ScenarioDef[] = [
  {
    id: "equity_crash",
    name: "Equity Crash",
    description: "A broad 35% equity drawdown with a flight to quality — rates fall, credit spreads blow out.",
    category: "market",
    shocks: { equityBeta: -35, rates: -1.0, creditSpread: 2.5, liquidityStress: 0.7, cryptoBeta: -50, gold: 8, usd: 5 },
  },
  {
    id: "gfc_2008",
    name: "2008 Financial Crisis",
    description: "Global financial system freeze. Credit markets seize, equities halve, Treasuries and gold rally.",
    category: "credit",
    shocks: { equityBeta: -50, rates: -2.0, creditSpread: 5.0, liquidityStress: 1.0, realEstateCap: 2.5, oil: -55, gold: 5, usd: 12, cryptoBeta: -70 },
  },
  {
    id: "covid_crash",
    name: "COVID Crash (2020)",
    description: "Pandemic shutdown. Sharp equity and oil collapse, emergency rate cuts.",
    category: "market",
    shocks: { equityBeta: -34, rates: -1.5, creditSpread: 3.5, oil: -65, liquidityStress: 0.9, gold: 4, usd: 8, cryptoBeta: -50 },
  },
  {
    id: "rate_hikes",
    name: "Fed Rate Hikes (+300bp)",
    description: "Aggressive tightening. Long-duration assets — bonds, growth equities, REITs — take the damage.",
    category: "macro",
    shocks: { rates: 3.0, equityBeta: -18, inflation: 1.0, realEstateCap: 1.5, usd: 8, gold: -8, cryptoBeta: -35 },
  },
  {
    id: "rate_cuts",
    name: "Fed Rate Cuts (-200bp)",
    description: "Easing cycle. Duration rallies, rate-sensitive assets recover.",
    category: "macro",
    shocks: { rates: -2.0, equityBeta: 8, realEstateCap: -1.0, usd: -6, gold: 10, cryptoBeta: 25 },
  },
  {
    id: "high_inflation",
    name: "High Inflation (+4pp)",
    description: "A sustained inflation surprise. Real assets protect; cash and long bonds lose purchasing power.",
    category: "macro",
    shocks: { inflation: 4.0, rates: 2.5, equityBeta: -12, oil: 35, gold: 20, realEstateCap: 0.5 },
  },
  {
    id: "deflation",
    name: "Deflation",
    description: "Demand collapse and falling prices. Cash and long duration win; real assets and equities suffer.",
    category: "macro",
    shocks: { inflation: -3.0, rates: -2.0, equityBeta: -25, oil: -35, creditSpread: 3.0, gold: -10, realEstateCap: 1.5 },
  },
  {
    id: "stagflation",
    name: "Stagflation",
    description: "Inflation plus recession — the combination that hurts a conventional 60/40 most, because stocks AND bonds fall together.",
    category: "macro",
    shocks: { inflation: 5.0, rates: 2.5, equityBeta: -25, oil: 30, gold: 18, creditSpread: 2.0, realEstateCap: 1.0 },
  },
  {
    id: "credit_crunch",
    name: "Credit Spread Widening (+400bp)",
    description: "Credit repricing without a full equity crash. High-yield and levered borrowers are hit hardest.",
    category: "credit",
    shocks: { creditSpread: 4.0, equityBeta: -15, rates: -0.5, liquidityStress: 0.6 },
  },
  {
    id: "oil_shock",
    name: "Oil / Commodity Shock (+70%)",
    description: "A supply-driven energy spike. Energy producers gain; everyone who consumes energy pays.",
    category: "geopolitical",
    shocks: { oil: 70, inflation: 3.0, equityBeta: -12, rates: 1.5, gold: 10 },
  },
  {
    id: "housing_crash",
    name: "Housing / CRE Crash",
    description: "Cap rates expand sharply. Direct property and REITs reprice; levered owners are hit hardest.",
    category: "sector",
    shocks: { realEstateCap: 3.0, equityBeta: -15, creditSpread: 2.5, rates: -0.5, liquidityStress: 0.5 },
  },
  {
    id: "crypto_winter",
    name: "Crypto Bear Market",
    description: "A 70% drawdown in digital assets, with limited spillover into traditional markets.",
    category: "market",
    shocks: { cryptoBeta: -70, equityBeta: -5, liquidityStress: 0.3 },
  },
  {
    id: "ai_bubble",
    name: "AI Bubble Unwind",
    description: "A valuation collapse concentrated in growth and technology. Defensives and duration hold up.",
    category: "sector",
    shocks: { equityBeta: -30, rates: -0.5, cryptoBeta: -45, gold: 5 },
  },
  {
    id: "usd_strength",
    name: "USD Appreciation (+15%)",
    description: "A sustained dollar rally. Foreign-currency holdings, gold and commodities lose in USD terms.",
    category: "macro",
    shocks: { usd: 15, gold: -12, oil: -15, equityBeta: -5 },
  },
  {
    id: "usd_weakness",
    name: "USD Depreciation (-15%)",
    description: "A dollar decline. Foreign assets, gold and commodities gain in USD terms.",
    category: "macro",
    shocks: { usd: -15, gold: 15, oil: 12, inflation: 1.5 },
  },
  {
    id: "china_slowdown",
    name: "China Slowdown",
    description: "A sharp deceleration in Chinese growth. Industrial commodities and export-exposed equities suffer.",
    category: "geopolitical",
    shocks: { equityBeta: -14, oil: -25, inflation: -1.0, usd: 6, creditSpread: 1.5 },
  },
  {
    id: "european_recession",
    name: "European Recession",
    description: "A eurozone contraction with limited global contagion.",
    category: "geopolitical",
    shocks: { equityBeta: -12, rates: -1.0, creditSpread: 1.8, usd: 7, oil: -12 },
  },
  {
    id: "global_recession",
    name: "Global Recession",
    description: "A synchronized worldwide contraction. Nearly everything risky falls together; duration and cash protect.",
    category: "macro",
    shocks: { equityBeta: -30, rates: -1.8, creditSpread: 3.5, oil: -40, inflation: -1.5, liquidityStress: 0.8, cryptoBeta: -55, realEstateCap: 1.5 },
  },
];

/* -------------------------------------------------------------------------- */
/* The engine                                                                  */
/* -------------------------------------------------------------------------- */

/** Does this holding respond to any factor this scenario actually shocks? */
function isCovered(sens: FactorSensitivities, shocks: FactorShocks): boolean {
  return Object.keys(shocks).some((f) => {
    const s = sens[f as Factor];
    return s != null && s !== 0;
  });
}

/** A log return, as the simple % change a reader understands. */
const pctFromLog = (logReturn: number) => Math.expm1(logReturn) * 100;

/**
 * One factor's contribution, in LOG-RETURN space.
 *
 * `equityBeta`, `usd`, `oil`, `gold`, `cryptoBeta` are ELASTICITIES against a %
 * move in that complex, so the complex's move is converted to a log return first
 * and the elasticity scales it: a beta of 1.0 against a −50% equity shock is
 * exactly −50%, a beta of 2.0 is −75%, never −100%.
 *
 * `rates`, `creditSpread`, `inflation`, `realEstateCap`, `liquidityStress` are
 * per-unit-of-shock PRICE sensitivities, and that is a log-price derivative by
 * definition — modified duration IS −∂ln P/∂y, which is why the textbook
 * approximation for a large rate move is `exp(−D·Δy)`, not `1 − D·Δy`. So their
 * product is already a log return and only needs rescaling from % to a fraction.
 *
 * A complex cannot fall more than 100%, and a total wipeout of one is log(0) —
 * unbounded for anything with a NEGATIVE loading on it, and NaN for a shock past
 * −100%. Neither is a number the UI or JSON can carry, so the move is bounded a
 * hair above a wipeout. Only `runCustomScenario` can reach it; nothing in
 * SCENARIOS shocks a complex by more than −70%.
 */
const MIN_FACTOR_MOVE = -0.9999;

function logContribution(factor: Factor, sensitivity: number, shock: number): number {
  if (FACTOR_SHOCK_UNIT[factor] !== "%") return (sensitivity * shock) / 100;
  return sensitivity * Math.log1p(Math.max(shock / 100, MIN_FACTOR_MOVE));
}

/**
 * Apply a factor-shock vector to one holding.
 *
 * ── Why the sum is in log space ───────────────────────────────────────────────
 *
 * This used to be `impactPct = Σ sensitivity × shock`, floored at −100%. The
 * floor was load-bearing, and that is the tell: on the real book TSM carries a
 * MEASURED equity beta of 2.14, and the 2008 scenario shocks equities −50%, so
 * the sum came to −105.2% — a long-only position with no leverage projected to
 * lose more than it owns. The floor turned that into a confident "−100.0%", i.e.
 * a total wipeout of a quality large-cap (TSM fell ~55% in 2008), and every
 * dollar figure downstream inherited it.
 *
 * The defect is not the coefficient — a 2.14 beta is a real measurement — it is
 * the composition. Adding `sensitivity × shock` terms treats each as a SIMPLE
 * return, and simple returns do not compose additively over a large move: two
 * −50% legs are −75%, not −100%. Sensitivities are derivatives of log price
 * (see logContribution), so they compose by ADDITION IN LOG SPACE and convert
 * back through `exp`. That is bounded below by −100% for any finite exposure, so
 * the impossible result is now unrepresentable rather than clamped away.
 *
 * The correction only bites at crisis scale, which is the point: at a −12%
 * equity shock log and linear agree to ~0.1pp, so ordinary scenarios read as
 * they did. And it never flatters risk where it matters — a beta of 1.0 against
 * −50% is still exactly −50%, and a sub-1 beta loses slightly MORE than the
 * linear model said.
 */
export function applyShocks(holding: Holding, shocks: FactorShocks): HoldingImpact {
  const drivers: { factor: Factor; label: string; contribution: number }[] = [];
  let logImpact = 0;

  for (const [f, shock] of Object.entries(shocks) as [Factor, number][]) {
    const sensitivity = holding.factors[f];
    if (sensitivity == null || sensitivity === 0 || shock === 0) continue;
    if (!Number.isFinite(sensitivity) || !Number.isFinite(shock)) continue;

    const contribution = logContribution(f, sensitivity, shock);
    logImpact += contribution;
    // Reported in the same simple-% space as the total, so a driver reads as
    // "this factor alone would move the holding by X%".
    drivers.push({
      factor: f,
      label: FACTOR_LABEL[f],
      contribution: Math.round(pctFromLog(contribution) * 10) / 10,
    });
  }

  drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const impactPct = pctFromLog(logImpact);

  return {
    id: holding.id,
    symbol: holding.symbol,
    name: holding.name,
    assetClass: holding.assetClass,
    impactPct: Math.round(impactPct * 10) / 10,
    impactValue: Math.round((impactPct / 100) * holding.valuation.valueBase),
    drivers: drivers.slice(0, 3),
  };
}

function describeShocks(shocks: FactorShocks): string[] {
  return (Object.entries(shocks) as [Factor, number][])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([f, v]) => {
      const unit = FACTOR_SHOCK_UNIT[f];
      const sign = v > 0 ? "+" : "";
      const suffix = unit === "severity" ? "" : unit;
      return `${FACTOR_LABEL[f]} ${sign}${v}${suffix}`;
    });
}

export function runScenario(
  def: ScenarioDef,
  holdings: Holding[],
  totalValue: number,
): ScenarioResult {
  const impacts = holdings.map((h) => applyShocks(h, def.shocks));

  let portfolioImpactValue = 0;
  for (const i of impacts) portfolioImpactValue += i.impactValue;

  const coveredValue = holdings
    .filter((h) => isCovered(h.factors, def.shocks))
    .reduce((s, h) => s + h.valuation.valueBase, 0);

  const sorted = [...impacts].sort((a, b) => a.impactPct - b.impactPct);

  const impactPctExact = totalValue > 0 ? (portfolioImpactValue / totalValue) * 100 : 0;

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    portfolioImpactPct: Math.round(impactPctExact * 10) / 10,
    portfolioImpactPctExact: impactPctExact,
    portfolioImpactValue: Math.round(portfolioImpactValue),
    holdings: impacts,
    worst: sorted[0] ?? null,
    best: sorted[sorted.length - 1] ?? null,
    coveragePct: totalValue > 0 ? Math.round((coveredValue / totalValue) * 100) : 0,
    shockSummary: describeShocks(def.shocks),
  };
}

export interface ScenarioComparisonRow {
  id: string;
  name: string;
  description: string;
  /** Rounded to `decimals`. */
  beforePct: number | null;
  /** Rounded to `decimals`. */
  afterPct: number | null;
  /** EXACTLY `afterPct − beforePct` at the same precision. Null when the scenario wasn't in the before set. */
  deltaPp: number | null;
}

export interface ScenarioComparison {
  rows: ScenarioComparisonRow[];
  /** Decimal places every column in this table is rendered at. */
  decimals: number;
}

/**
 * Pair two scenario runs into before / after / change rows.
 *
 * Two rules, both learned from the bug this replaces:
 *
 *   1. THE CHANGE IS DERIVED FROM THE DISPLAYED VALUES, not computed in parallel
 *      with them. Rounding the columns and the delta independently is how a row
 *      came to read "−8.6% → −6.6%, change 0.0pp": three numbers that each
 *      answered a slightly different question. `deltaPp` here is the subtraction
 *      the reader can do on the page, by construction.
 *   2. THE PRECISION IS CHOSEN FROM THE DATA. One decimal is right for a −41%
 *      crisis loss and destroys a 0.02pp improvement, and a small deployment into
 *      a large portfolio produces exactly the latter — a table of "0.0pp"s that
 *      looks like a broken calculation but is really a precision floor. So when
 *      nothing in the table moves by 0.1pp, every column gains a decimal instead
 *      of the whole comparison collapsing to zero.
 */
export function compareScenarioSets(
  before: ScenarioResult[],
  after: ScenarioResult[],
): ScenarioComparison {
  const beforeById = new Map(before.map((s) => [s.id, s]));

  const largestMove = after.reduce((max, s) => {
    const b = beforeById.get(s.id);
    if (!b) return max;
    return Math.max(max, Math.abs(s.portfolioImpactPctExact - b.portfolioImpactPctExact));
  }, 0);
  const decimals = largestMove > 0 && largestMove < 0.1 ? 2 : 1;
  const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;

  const rows = after.map((s) => {
    const b = beforeById.get(s.id);
    const beforePct = b ? round(b.portfolioImpactPctExact) : null;
    const afterPct = round(s.portfolioImpactPctExact);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      beforePct,
      afterPct,
      // Rounded again so binary floating point can't turn 2.0 into 2.0000000000000004.
      deltaPp: beforePct != null ? round(afterPct - beforePct) : null,
    };
  });

  return { rows, decimals };
}

export function runAllScenarios(holdings: Holding[], totalValue: number): ScenarioResult[] {
  return SCENARIOS
    .map((s) => runScenario(s, holdings, totalValue))
    .sort((a, b) => a.portfolioImpactPct - b.portfolioImpactPct);
}

/** A user-defined "what if factor X moves Y?" — same engine, no special path. */
export function runCustomScenario(
  shocks: FactorShocks,
  holdings: Holding[],
  totalValue: number,
  name = "Custom Scenario",
): ScenarioResult {
  return runScenario(
    { id: "custom", name, description: "User-defined factor shock", shocks, category: "macro" },
    holdings,
    totalValue,
  );
}

export function getScenario(id: string): ScenarioDef | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Standardized probes                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A calibrated +1 percentage-point inflation surprise, as a full factor vector.
 *
 * Inflation sensitivity CANNOT be read off the raw `inflation` factor exposure,
 * because assets priced by a complex (gold, oil) carry no `inflation` loading —
 * their inflation response lives in their own factor, per the own-factor rule in
 * classes/reference/factor-sensitivities.ts. Reading the raw loading would report a
 * gold-heavy portfolio as having zero inflation protection, which is precisely
 * backwards.
 *
 * So we MEASURE it: shock the whole factor vector the way a 1pp inflation surprise
 * actually moves markets, and run it through the same engine everything else uses.
 * Gold's +5% shows up. Cash's -1% shows up. A long bond's duration loss shows up.
 */
export const INFLATION_1PP: FactorShocks = {
  inflation: 1.0,
  rates: 0.6,        // central banks respond
  gold: 5,
  oil: 8,
  equityBeta: -3,
  realEstateCap: 0.1,
};

/**
 * Portfolio inflation sensitivity: % change in value per +1pp inflation surprise.
 * Negative = the portfolio loses purchasing power.
 */
export function inflationSensitivity(holdings: Holding[], totalValue: number): number | null {
  if (holdings.length === 0 || totalValue <= 0) return null;
  const res = runScenario(
    { id: "probe", name: "Inflation probe", description: "", shocks: INFLATION_1PP, category: "macro" },
    holdings,
    totalValue,
  );
  return Math.round(res.portfolioImpactPct * 100) / 100;
}
