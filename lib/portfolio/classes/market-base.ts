/**
 * Shared behaviour for market-priced classes (equity, etf, reit, bond, crypto,
 * commodity, forex): value = quantity × live price, in the quote's own currency,
 * converted to base.
 *
 * This is the ONLY place that arithmetic lives. The seven market-priced adapters
 * differ in their factors, metrics and scoring — not in how they multiply.
 */

import { fxRate, coverage, lerpScore, shrinkToConfidence } from "../model/adapter";
import { alignPair, datedReturns } from "../engines/series";
import { resolveFactors } from "./reference/risk-models";
import type { InstrumentSignals, Measurements, ResolvedFactors } from "./reference/risk-models";
import type {
  Income,
  MarketContext,
  RawHolding,
  Valuation,
  HoldingScore,
  ContextFundamentals,
} from "../model/types";

/**
 * The signals the classifier is allowed to see, assembled from the MarketContext.
 *
 * ONE assembly, used by both questions the classifier answers — which risk model
 * (factor loadings) and which asset class (aggregation, targets, reporting). If
 * these were assembled twice, the two answers could disagree again, which is the
 * whole defect this path exists to make impossible.
 */
export function instrumentSignalsFor(
  raw: RawHolding,
  ctx: MarketContext,
  overrides: Partial<InstrumentSignals> = {},
): InstrumentSignals {
  const key = raw.symbol?.toUpperCase() ?? null;
  const f = key ? ctx.fundamentals.get(key) : undefined;
  const quote = key ? ctx.quotes.get(key) : undefined;

  return {
    symbol: raw.symbol,
    name: raw.name,
    assetClass: raw.assetClass,
    quoteAssetType: quote?.assetType ?? null,
    fundCategory: f?.fundCategory ?? null,
    creditQuality: f?.creditQuality ?? null,
    bondWeight: f?.bondWeight ?? null,
    equityWeight: f?.equityWeight ?? null,
    cashWeight: f?.cashWeight ?? null,
    otherWeight: f?.otherWeight ?? null,
    topSector: f?.topSector ?? null,
    topSectorWeight: f?.topSectorWeight ?? null,
    sector: f?.sector ?? null,
    industry: f?.industry ?? null,
    country: f?.country ?? null,
    currency: quote?.currency ?? f?.currency ?? raw.currency,
    baseCurrency: ctx.baseCurrency,
    ...overrides,
  };
}

/**
 * Resolve a holding's risk model and factor loadings.
 *
 * THE ONE PATH. Every adapter routes through this, so there is exactly one place
 * that decides what an instrument is for risk purposes, one place that decides
 * which measurement beats which reference, and one place to audit. An adapter that
 * re-derived any of this locally is how a corporate bond ETF came to be modelled
 * as a generic equity fund while an international equity ETF was modelled as a
 * bond — two adapters, two heuristics, both keyed off the wrong field.
 *
 * `overrides` lets a class contribute something only it knows (real estate's
 * leverage multiple, a structured note's barrier-conditional beta) without
 * reopening the classification.
 */
export function riskModelFor(
  raw: RawHolding,
  ctx: MarketContext,
  overrides: { signals?: Partial<InstrumentSignals>; measurements?: Measurements } = {},
): ResolvedFactors {
  const key = raw.symbol?.toUpperCase() ?? null;
  const f = key ? ctx.fundamentals.get(key) : undefined;

  return resolveFactors(instrumentSignalsFor(raw, ctx, overrides.signals ?? {}), {
    equityBeta: measuredBeta(raw.symbol, ctx) ?? f?.beta ?? null,
    measuredDuration: measuredDuration(raw.symbol, ctx),
    providerDuration: f?.duration ?? null,
    ...overrides.measurements,
  });
}

/**
 * Value a market-priced holding.
 *
 * Bonds are the reason `unit` exists: their quantity is FACE value and their price
 * is a percentage of par, so 10,000 face at a price of 98.5 is worth 9,850 — not
 * 985,000. Multiplying quantity by price the equity way overstates a bond position
 * by ~100×, which would silently dominate every allocation number in the portfolio.
 */
export function marketValuation(raw: RawHolding, ctx: MarketContext): Valuation {
  const quote = raw.symbol ? ctx.quotes.get(raw.symbol.toUpperCase()) : undefined;
  const currency = quote?.currency ?? raw.currency;
  const rate = fxRate(currency, ctx);

  // No live price → fall back to cost basis. Contributes 0 P&L rather than
  // vanishing from the portfolio (which would silently shrink the denominator
  // every other weight is computed against).
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
    return {
      mode: "market",
      value: raw.costBasis,
      valueBase: raw.costBasis * fxRate(raw.currency, ctx),
      fxRate: fxRate(raw.currency, ctx),
      source: "user",
      asOf: raw.acquiredAt,
      stale: true,
    };
  }

  const value = raw.unit === "face"
    ? raw.quantity * (quote.price / 100)
    : raw.quantity * quote.price;

  return {
    mode: "market",
    value,
    valueBase: value * rate,
    fxRate: rate,
    source: "yahoo",
    asOf: ctx.asOf,
    stale: false,
  };
}

/** Dividend/distribution income from the provider's yield, where it has one. */
export function yieldIncome(
  raw: RawHolding,
  valuation: Valuation,
  ctx: MarketContext,
  kind: Income["kind"],
): Income | null {
  const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
  const y = f?.dividendYield;
  if (y == null || !Number.isFinite(y) || y <= 0) return null;

  // Yahoo reports yield as a fraction (0.0234). Guard against the occasional
  // already-percentage response rather than silently reporting a 234% yield.
  const yieldPct = y > 1 ? y : y * 100;
  return {
    annual: (yieldPct / 100) * valuation.valueBase,
    yieldPct,
    kind,
  };
}

/**
 * Minimum R² for a measured beta to be trusted.
 *
 * A regression of two barely-related series still returns a beta — it is just a
 * meaningless one. Without this gate, a thinly-traded name, a short history, or a
 * genuinely uncorrelated asset yields a noise beta near zero, which then OVERRIDES
 * the provider's real beta and makes the holding look immune to an equity crash.
 * That is a silent, dangerous failure: the stress test reports a portfolio is
 * hedged when it is not.
 *
 * Below this threshold we return null and let the caller fall back to the
 * provider's beta, or to the class's reference beta. "I couldn't measure it" must
 * not be reported as "it measured zero".
 */
const MIN_BETA_R2 = 0.10;

/**
 * Measured equity beta vs the benchmark, from daily returns.
 *
 * Returns null when there isn't enough overlapping history OR when the regression
 * explains too little of the variance to be meaningful (see MIN_BETA_R2). The
 * caller then falls back to the provider's beta, and failing that to the class's
 * reference beta — never to a silent 0 or 1.
 */
export function measuredBeta(symbol: string | null, ctx: MarketContext): number | null {
  if (!symbol) return null;
  const closes = ctx.history.get(symbol.toUpperCase());
  if (!closes || closes.length < 30) return null;

  const bench = ctx.benchmarkReturns;
  if (bench.length < 30) return null;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) rets.push((closes[i] - prev) / prev);
  }

  const n = Math.min(rets.length, bench.length);
  if (n < 25) return null;

  const a = rets.slice(-n);
  const b = bench.slice(-n);
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varB === 0 || varA === 0) return null;

  // R² of the single-factor regression is just the squared correlation.
  const r = cov / Math.sqrt(varA * varB);
  if (!Number.isFinite(r) || r * r < MIN_BETA_R2) return null;

  const beta = cov / varB;
  return Number.isFinite(beta) ? Math.round(beta * 100) / 100 : null;
}

/**
 * Minimum R² for a measured duration to be trusted, and the minimum number of
 * paired sessions.
 *
 * Lower than MIN_BETA_R2 on purpose: a bond fund's daily return is genuinely
 * driven by more than the 10-year point (curve shape, spreads, roll), so an R² of
 * 0.25 against a single yield still identifies duration well, while an equity fund
 * regressed on yields lands near zero and is correctly rejected. High yield
 * typically fails this gate — its returns ARE mostly spread — and falls back to
 * the reference duration, which is the honest outcome.
 */
const MIN_DURATION_R2 = 0.2;
const MIN_DURATION_OBS = 60;

/**
 * EMPIRICAL effective duration, in years, from the holding's own price history.
 *
 * Regresses daily returns (%) on daily changes in the 10-year Treasury yield (pp).
 * The slope is −duration by definition: a fund that falls 7% when yields rise 1pp
 * has a duration of 7. Returns null when there is not enough overlapping history,
 * when the regression explains too little to be meaningful, or when the implied
 * duration is not a number a bond can have.
 *
 * WHY THIS EXISTS: the provider's `bondHoldings.duration` is not effective
 * duration. Probed 2026-07-29 it reported 3.55 for TLT (true ≈ 16), 3.88 for USFR
 * (a floating-rate fund, true ≈ 0.02), 4.48 for VXUS (an equity fund) and nothing
 * at all for VCLT (true ≈ 13). A number regressed out of the instrument's own
 * returns is a measurement of the instrument; that field is not.
 *
 * Series are joined on the CALENDAR (alignPair), never by index — a fund and the
 * yield index do not share a session count.
 */
export function measuredDuration(symbol: string | null, ctx: MarketContext): number | null {
  if (!symbol) return null;
  const key = symbol.toUpperCase();
  const closes = ctx.history.get(key);
  const rateChanges = ctx.rateChanges;
  if (!closes || closes.length < 30 || !rateChanges || rateChanges.length < MIN_DURATION_OBS) return null;

  const fund = datedReturns(closes, ctx.historyDates?.get(key));
  const paired = alignPair(fund, { dates: ctx.rateChangeDates ?? [], returns: rateChanges });
  if (!paired || paired[0].length < MIN_DURATION_OBS) return null;

  const [rets, dy] = paired;
  const n = rets.length;
  const meanR = rets.reduce((s, x) => s + x, 0) / n;
  const meanY = dy.reduce((s, x) => s + x, 0) / n;

  let cov = 0;
  let varY = 0;
  let varR = 0;
  for (let i = 0; i < n; i++) {
    const dr = rets[i] - meanR;
    const d = dy[i] - meanY;
    cov += dr * d;
    varY += d * d;
    varR += dr * dr;
  }
  if (varY === 0 || varR === 0) return null;

  const r2 = (cov * cov) / (varY * varR);
  if (!Number.isFinite(r2) || r2 < MIN_DURATION_R2) return null;

  // slope is in return-fraction per pp; ×100 gives % per pp, and duration = −slope.
  const duration = -(cov / varY) * 100;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 40) return null;
  return Math.round(duration * 100) / 100;
}

/** Realized annualized volatility (%) from daily closes. Null if too little history. */
export function realizedVol(symbol: string | null, ctx: MarketContext): number | null {
  if (!symbol) return null;
  const closes = ctx.history.get(symbol.toUpperCase());
  if (!closes || closes.length < 30) return null;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) rets.push((closes[i] - prev) / prev);
  }
  if (rets.length < 25) return null;

  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - m) ** 2, 0) / rets.length;
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

/**
 * The shared fundamental scoring shape for equity-like classes (equity, reit).
 *
 * Confidence is the fraction of inputs actually present, and the score is shrunk
 * toward neutral by it — so a name with one available metric cannot outrank a
 * fully-covered one. Returns null when NOTHING was available, rather than 50.
 */
export function fundamentalScore(
  f: ContextFundamentals | undefined,
  factors: { key: keyof ContextFundamentals; weight: number; worst: number; best: number; label: string }[],
): HoldingScore | null {
  if (!f) return null;

  let weighted = 0;
  let usedWeight = 0;
  const why: string[] = [];
  const inputs: (number | null)[] = [];

  for (const spec of factors) {
    const raw = f[spec.key];
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    inputs.push(v);
    if (v == null) continue;

    const s = lerpScore(v, spec.worst, spec.best);
    weighted += s * spec.weight;
    usedWeight += spec.weight;
    if (s >= 70) why.push(`Strong ${spec.label}`);
    else if (s <= 30) why.push(`Weak ${spec.label}`);
  }

  // Nothing measurable → say so. Do NOT emit a neutral score.
  if (usedWeight === 0) return null;

  // Redistribute the weight of missing factors across the present ones rather
  // than scoring them 0 (which would penalize a name for a provider gap).
  const base = weighted / usedWeight;
  const conf = coverage(inputs);

  return {
    score: Math.round(shrinkToConfidence(base, conf)),
    confidence: Math.round(conf),
    why: why.slice(0, 3),
  };
}
