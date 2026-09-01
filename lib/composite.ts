import type { CompositeScores, StockMetrics } from "./types";
import { sectorGroup } from "./sector";
import { detectMarket, type MarketRegion } from "./market";
import { norm } from "./score-math";

/**
 * Proprietary composite scores (0-100). Each raw metric is normalized to a
 * 0-100 sub-score against an absolute, investing-sensible scale (so a score is
 * comparable over time, not just within one screen), then averaged within its
 * dimension. The Overall score is a weighted blend of the dimensions.
 *
 * Scoring thresholds are sector-aware: Financials, Utilities, and REITs have
 * structurally different economics and would be misevaluated by one-size-fits-all
 * thresholds calibrated for general/tech companies.
 *
 * Thresholds are also MARKET-aware. The market is derived from the symbol
 * suffix inside this module (never trusted from callers — a caller that
 * forgets cannot reintroduce US bands for NSE names). India bands differ
 * where the Indian market norm materially differs from the US one, per the
 * Phase 2 localization audit (docs/india-strategy/PHASE2_LOCALIZATION_AUDIT.md):
 *   - Valuation: Nifty 50's long-term median TTM P/E is ~20-21x vs the S&P
 *     500's ~15-16x, and Indian quality/consumer names structurally carry a
 *     growth premium — "cheap"/"expensive" sit higher.
 *   - Growth: Indian nominal GDP runs ~10-11% vs ~4-5% in the US, so 0%
 *     revenue growth is a materially worse outcome in India; growth bands
 *     shift up by roughly the nominal-growth differential.
 *   - Quality: with the 10Y G-sec at ~6.5%, a 5% ROE/ROIC destroys value in
 *     India; return floors sit higher.
 *   - Leverage: Indian corporates deleveraged hard post-2015; D/E above
 *     ~1.5x is already an outlier for the general group.
 * Metrics whose norms are business-model rather than market driven (margins,
 * current ratio, net-debt/EBITDA, momentum) keep one band across markets.
 * Suffix-only detection is deliberate: an ADR (INFY on NYSE) is a US listing
 * priced by US investors and keeps US bands, matching waccRegionFor's intent.
 *
 * Pure and deterministic — fully unit-testable without any network data.
 */

/** Average the present sub-scores; null if fewer than `min` are available. */
function blend(parts: (number | null)[], min = 1): number | null {
  const present = parts.filter((p): p is number => p != null);
  if (present.length < min) return null;
  return Math.round(present.reduce((s, p) => s + p, 0) / present.length);
}

/** The metric fields the scores read (everything on StockMetrics bar the scores). */
export type ScorableMetrics = Omit<StockMetrics, "scores">;

/** [worst, best] normalization band, the argument order `norm()` takes. */
type Band = readonly [worst: number, best: number];

/** The two calibrations this module distinguishes. Every non-IN region scores
 *  on US bands today — the US set is the developed-market default. */
type BandMarket = "US" | "IN";

function bandMarketOf(m: ScorableMetrics): BandMarket {
  const region: MarketRegion = detectMarket({
    symbol: m.symbol,
    currency: "",
    exchange: null,
    assetType: null,
  });
  return region === "IN" ? "IN" : "US";
}

/** Normalize against the band for this market — `inBand` only where the Indian norm differs. */
function nb(value: number | null, market: BandMarket, usBand: Band, inBand?: Band): number | null {
  const [worst, best] = market === "IN" && inBand ? inBand : usBand;
  return norm(value, worst, best);
}

/* -------------------------------------------------------------------------- */
/* Sector- and market-aware sub-scorers                                        */
/* -------------------------------------------------------------------------- */

export function valueScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  const mk = bandMarketOf(m);
  if (sg === "utilities") {
    // Utilities trade at premium P/E due to stability; 18x is fairly valued, not
    // expensive. Indian utilities (largely PSU) trade at or below these levels,
    // so the band holds across markets.
    return blend([
      nb(m.forwardPE, mk, [30, 12]),
      nb(m.evToEbitda, mk, [20, 8]),
      nb(m.fcfYield, mk, [0, 6]),
    ]);
  }
  if (sg === "financials") {
    // P/E and EV/EBITDA aren't reliable for banks — rely on FCF yield and book value.
    // IN: private-sector banks normally trade 15-25x earnings (PSU banks 7-15x),
    // so 20x is mid-range, not the worst case.
    return blend([
      nb(m.forwardPE, mk, [20, 8], [24, 8]),
      nb(m.fcfYield, mk, [0, 6]),
    ]);
  }
  if (sg === "reits") {
    // REITs valued on income/yield; FCF yield and dividend yield matter most.
    // Indian REITs are a nascent asset class — no evidence the band differs.
    return blend([
      nb(m.forwardPE, mk, [35, 12]),
      nb(m.fcfYield, mk, [0, 7]),
      nb(m.dividendYield, mk, [0, 6]),
    ]);
  }
  // default — general/tech/consumer/industrials.
  // IN: the market's median P/E is ~5 points above the US median and quality
  // franchises (FMCG 30-60x) carry a structural premium; "cheap" starts higher
  // and 40x is not yet the extreme it is in the US.
  return blend([
    nb(m.forwardPE, mk, [40, 8], [45, 10]),
    nb(m.evToEbitda, mk, [22, 5], [26, 6]),
    nb(m.fcfYield, mk, [0, 8], [0, 7]),
  ]);
}

export function growthScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  const mk = bandMarketOf(m);
  if (sg === "utilities") {
    // Regulated utilities grow revenue at 2-5%; 8% is exceptional, not mediocre.
    // IN: capacity build-out lets Indian utilities grow faster than US regulated
    // peers — the exceptional bar sits ~4pp higher.
    return blend([
      nb(m.revenueGrowthYoY, mk, [-2, 8], [0, 12]),
      nb(m.revenueCagr3y, mk, [-1, 6], [0, 9]),
      nb(m.epsGrowthYoY, mk, [-5, 10], [-2, 14]),
      nb(m.epsCagr3y, mk, [-2, 8], [0, 10]),
    ]);
  }
  if (sg === "reits") {
    // REITs grow via acquisitions + rent increases; 10% revenue growth is strong.
    return blend([
      nb(m.revenueGrowthYoY, mk, [-2, 12]),
      nb(m.revenueCagr3y, mk, [-1, 9]),
      nb(m.epsGrowthYoY, mk, [-5, 15]),
      nb(m.epsCagr3y, mk, [-2, 10]),
    ]);
  }
  if (sg === "financials") {
    // Bank revenue growth is modest; 10% is very strong for a well-run US bank.
    // IN: system credit growth runs low-teens nominal, so the same numbers mean
    // less — strong is mid-to-high teens.
    return blend([
      nb(m.revenueGrowthYoY, mk, [-2, 12], [1, 16]),
      nb(m.revenueCagr3y, mk, [-1, 8], [0, 12]),
      nb(m.epsGrowthYoY, mk, [-5, 15], [-1, 18]),
      nb(m.epsCagr3y, mk, [-2, 10], [0, 14]),
    ]);
  }
  // default. IN: bands shift up by roughly the ~5pp nominal-GDP differential —
  // flat revenue in a 10-11% nominal economy is contraction in real share terms.
  return blend([
    nb(m.revenueGrowthYoY, mk, [0, 25], [5, 28]),
    nb(m.revenueCagr3y, mk, [0, 20], [3, 23]),
    nb(m.epsGrowthYoY, mk, [0, 30], [5, 32]),
    nb(m.epsCagr3y, mk, [0, 25], [3, 28]),
  ]);
}

export function qualityScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  const mk = bandMarketOf(m);
  if (sg === "financials") {
    // Gross margin is not meaningful for banks; ROE is the key quality signal.
    // Banks targeting 10-15% ROE; 18%+ is excellent. IN: the floor rises with
    // the risk-free rate — an 8% ROE bank earns less than a G-sec.
    return blend([
      nb(m.roe, mk, [5, 18], [8, 18]),
      nb(m.operatingMargin, mk, [10, 40]),
      nb(m.fcfMargin, mk, [2, 20]),
    ]);
  }
  if (sg === "utilities") {
    // Utilities have regulated, stable margins; 20% op margin is solid.
    return blend([
      nb(m.roic, mk, [3, 12]),
      nb(m.roe, mk, [5, 14]),
      nb(m.operatingMargin, mk, [8, 25]),
      nb(m.fcfMargin, mk, [2, 18]),
    ]);
  }
  if (sg === "reits") {
    // REITs distribute most earnings; ROE and margins differ from industrials.
    return blend([
      nb(m.roe, mk, [3, 15]),
      nb(m.operatingMargin, mk, [10, 45]),
      nb(m.fcfMargin, mk, [5, 30]),
    ]);
  }
  // default. IN: return floors sit ~3pp higher (10Y G-sec ~6.5% — sub-hurdle
  // returns destroy value sooner), and Indian analysis is ROCE-first, so the
  // ROIC ceiling stretches to keep 25%+ operators distinguishable.
  // Margins are business-model driven and keep one band across markets.
  return blend([
    nb(m.roic, mk, [5, 25], [8, 28]),
    nb(m.roe, mk, [5, 30], [8, 30]),
    nb(m.grossMargin, mk, [20, 70]),
    nb(m.operatingMargin, mk, [5, 30]),
    nb(m.fcfMargin, mk, [2, 25]),
  ]);
}

export function financialHealthScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  const mk = bandMarketOf(m);
  if (sg === "financials") {
    // Banks are inherently leveraged (deposits = debt); D/E of 8-12x is normal.
    // Use a wide range and only penalize extreme outliers.
    // Current ratio is not meaningful for banks; skip it.
    // (Yahoo reports Indian banks' D/E from borrowings only, ~1-1.5x, which
    // saturates this band; that is neutral rather than wrong, and asset-quality
    // discrimination for Indian banks lives in lib/india-snapshot.ts's NPA
    // factors — do not tighten this band without a bank-specific data source.)
    return blend([
      nb(m.debtToEquity, mk, [20, 4]),      // 4x = well-run bank, 20x = systemic risk
      nb(m.netDebtToEbitda, mk, [15, 2]),   // relative to earnings power
    ]);
  }
  if (sg === "utilities") {
    // Utilities carry debt to fund infrastructure; 3x D/E is standard.
    return blend([
      nb(m.debtToEquity, mk, [4, 0.5]),
      nb(m.netDebtToEbitda, mk, [8, 2]),
      nb(m.currentRatio, mk, [0.8, 1.8]),
    ]);
  }
  if (sg === "reits") {
    // REITs are capital-intensive but regulated; 2-3x D/E is typical.
    return blend([
      nb(m.debtToEquity, mk, [4, 0.5]),
      nb(m.netDebtToEbitda, mk, [10, 3]),
      nb(m.currentRatio, mk, [0.8, 2]),
    ]);
  }
  // default. IN: corporate India deleveraged hard post-2015 (IBC era) — D/E
  // above ~1.5x is already an outlier for the general group.
  return blend([
    nb(m.debtToEquity, mk, [2, 0.1], [1.5, 0.1]),
    nb(m.netDebtToEbitda, mk, [4, 0]),
    nb(m.currentRatio, mk, [0.8, 2.5]),
  ]);
}

export function momentumScore(m: ScorableMetrics): number | null {
  // Momentum is sector- and market-agnostic — price performance relative to
  // the stock's own history, in its own currency.
  return blend([
    norm(m.oneYearReturn, -25, 40),
    norm(m.distanceFrom52WkHigh, -50, -2),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Composite                                                                   */
/* -------------------------------------------------------------------------- */

const WEIGHTS: [keyof CompositeScores, number][] = [
  ["quality", 0.28],
  ["value", 0.24],
  ["growth", 0.24],
  ["financialHealth", 0.18],
  ["momentum", 0.06],
];

export function computeScores(m: ScorableMetrics): CompositeScores {
  const value = valueScore(m);
  const growth = growthScore(m);
  const quality = qualityScore(m);
  const financialHealth = financialHealthScore(m);
  const momentum = momentumScore(m);
  const dims: CompositeScores = { value, growth, quality, financialHealth, momentum, overall: null };

  // Overall: weighted blend of whichever dimensions are available (weights
  // renormalize so a missing dimension doesn't drag the score toward zero).
  const present = WEIGHTS.filter(([k]) => dims[k] != null);
  const wSum = present.reduce((s, [, w]) => s + w, 0);
  dims.overall = wSum
    ? Math.round(present.reduce((s, [k, w]) => s + (dims[k] as number) * w, 0) / wSum)
    : null;

  return dims;
}
