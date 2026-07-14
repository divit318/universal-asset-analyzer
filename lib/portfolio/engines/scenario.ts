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
 *     holding impact % = Σ_factor  sensitivity[factor] × shock[factor]
 *     portfolio impact = Σ_holding impact% × weight
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
  /** % change in this holding's value. */
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

/**
 * Apply a factor-shock vector to one holding.
 *
 * `equityBeta`, `usd`, `oil`, `gold`, `cryptoBeta` are elasticities: a beta of 1.2
 * against a -35% equity shock is -42%. `rates`, `creditSpread`, `inflation`,
 * `realEstateCap` are per-percentage-point: a -7 duration against a +2pp rate shock
 * is -14%. Both are just `sensitivity × shock` — the units are chosen so the
 * arithmetic is uniform, which is what lets one line of code handle a Treasury fund
 * and a gold ETF correctly at the same time.
 */
export function applyShocks(holding: Holding, shocks: FactorShocks): HoldingImpact {
  const drivers: { factor: Factor; label: string; contribution: number }[] = [];
  let impactPct = 0;

  for (const [f, shock] of Object.entries(shocks) as [Factor, number][]) {
    const sensitivity = holding.factors[f];
    if (sensitivity == null || sensitivity === 0 || shock === 0) continue;

    const contribution = sensitivity * shock;
    impactPct += contribution;
    drivers.push({ factor: f, label: FACTOR_LABEL[f], contribution: Math.round(contribution * 10) / 10 });
  }

  drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  // A holding cannot lose more than 100% of its value. Without this bound a
  // long-duration bond against a large rate shock, or a levered property, can
  // mathematically go below zero — which would then quietly corrupt the
  // portfolio total it feeds into.
  impactPct = Math.max(impactPct, -100);

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

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    portfolioImpactPct: totalValue > 0
      ? Math.round((portfolioImpactValue / totalValue) * 1000) / 10
      : 0,
    portfolioImpactValue: Math.round(portfolioImpactValue),
    holdings: impacts,
    worst: sorted[0] ?? null,
    best: sorted[sorted.length - 1] ?? null,
    coveragePct: totalValue > 0 ? Math.round((coveredValue / totalValue) * 100) : 0,
    shockSummary: describeShocks(def.shocks),
  };
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
