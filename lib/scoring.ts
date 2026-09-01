import type {
  AnalystConsensus,
  DecisionSignals,
  FinancialStatements,
  FundamentalsSnapshot,
  HistoryPoint,
  InsiderActivity,
  InvestmentPersonalityTag,
  MomentumSignal,
  Recommendation,
  RiskItem,
  RiskLevel,
  ScoreBucket,
  ScoreResult,
  SectorRotationEntry,
} from "./types";
import { sectorGroup } from "./sector";
// lib/market.ts has zero runtime deps beyond ./types, so importing it is safe
// in client bundles, unlike importing lib/sector-rotation.ts (which pulls in
// node:sqlite via lib/db.ts). detectMarket powers bandMarket() below.
import { detectMarket, type MarketRegion } from "./market";
import { lerp, mk, bucket } from "./score-math";
import { totalReturnClose } from "./prices";
import { scoreToRecommendation, RECOMMENDATION_LABEL, TIER_EDGES } from "./recommendation";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const ratio = (v: number) => v.toFixed(2);
/** Valuation-multiple rendering — matches lib/format.ts's formatRatio (2dp + "x")
 *  so a P/E quoted in a factor detail equals the one in the masthead. */
const pe = (v: number | null | undefined) => (v != null ? `${v.toFixed(2)}x` : "n/a");

/* -------------------------------------------------------------------------- */
/* Buckets (sector- and market-aware)                                          */
/* -------------------------------------------------------------------------- */

/** [worst, best] normalization band, in `mk()`'s argument order. */
type Band = readonly [worst: number, best: number];

/**
 * Market calibration for a snapshot, from the symbol suffix alone — derived
 * INSIDE the bucket scorers so no caller can accidentally score an NSE name
 * on US bands (Phase 2 audit; see lib/composite.ts for the same pattern and
 * the band rationale). Suffix-only on purpose: an ADR is a US listing priced
 * by US investors and keeps US bands. lib/market.ts has zero runtime deps
 * beyond ./types, so the runtime import stays client-bundle-safe.
 */
function bandMarket(s: FundamentalsSnapshot): "US" | "IN" {
  return detectMarket({ symbol: s.symbol, currency: "", exchange: null, assetType: null }) === "IN"
    ? "IN"
    : "US";
}

/** The band for this market — `inBand` only where the Indian norm differs. */
const pickBand = (mkt: "US" | "IN", usBand: Band, inBand?: Band): Band =>
  mkt === "IN" && inBand ? inBand : usBand;

export function scoreValuation(s: FundamentalsSnapshot, a: AnalystConsensus) {
  const sg = sectorGroup(s.sector);
  const mkt = bandMarket(s);
  const fwdRatio =
    s.forwardPE != null && s.trailingPE != null && s.trailingPE !== 0
      ? s.forwardPE / s.trailingPE
      : null;

  if (sg === "financials") {
    // Banks: P/E is less distorted than for industrials, but still apply tighter
    // range. IN: private-sector banks normally trade 15-25x (PSU banks 7-15x),
    // so 18x is mid-range for the group, not the worst case.
    return bucket("Valuation", [
      mk("Analyst upside", a.upsidePercent, -15, 30, 12, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}% to target`),
      mk("Forward P/E", s.forwardPE, ...pickBand(mkt, [18, 8], [26, 10]), 10, (v) => `Fwd P/E ${pe(v)}`),
      mk("Forward vs trailing P/E", fwdRatio, 1.2, 0.7, 8, () =>
        s.forwardPE != null ? `Fwd P/E ${pe(s.forwardPE)} vs ${pe(s.trailingPE)}` : "n/a",
      ),
    ]);
  }
  if (sg === "utilities") {
    // Utilities trade at 14-20x P/E as a normal range — don't penalize 18x
    return bucket("Valuation", [
      mk("Analyst upside", a.upsidePercent, -15, 30, 12, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}% to target`),
      mk("Forward P/E", s.forwardPE, 28, 13, 10, (v) => `Fwd P/E ${pe(v)}`),
      mk("Forward vs trailing P/E", fwdRatio, 1.2, 0.6, 8, () =>
        s.forwardPE != null ? `Fwd P/E ${pe(s.forwardPE)} vs ${pe(s.trailingPE)}` : "n/a",
      ),
    ]);
  }
  // default / REITs. IN PEG band: Indian quality compounders structurally carry
  // a growth premium — TCS ~3 and HUL ~3.7 scored 0/10 on the US band (Phase 2
  // audit) despite being the market's reference franchises; a sub-1 PEG in
  // India usually signals a cyclical top, not a bargain.
  return bucket("Valuation", [
    mk("Analyst upside", a.upsidePercent, -15, 30, 12, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}% to target`),
    mk("PEG ratio", s.pegRatio, ...pickBand(mkt, [3, 0.8], [4, 1.0]), 10, (v) => `PEG ${ratio(v)}`),
    mk("Forward vs trailing P/E", fwdRatio, 1.2, 0.6, 8, () =>
      s.forwardPE != null ? `Fwd P/E ${pe(s.forwardPE)} vs ${pe(s.trailingPE)}` : "n/a",
    ),
  ]);
}

export function scoreQuality(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
) {
  const sg = sectorGroup(s.sector);
  const mkt = bandMarket(s);
  const latestNetIncome = st?.netIncome.at(-1)?.value ?? null;
  const latestFcf = st?.freeCashFlow.at(-1)?.value ?? s.freeCashflow ?? null;
  const fcfQuality =
    latestFcf != null && latestNetIncome != null && latestNetIncome !== 0
      ? latestFcf / latestNetIncome
      : null;

  if (sg === "financials") {
    // Gross margin is not meaningful for banks; ROE is the primary quality
    // signal. FCF/NI is dropped too: a lender's operating cash flow embeds
    // loan-book flows, so FCF/NI ≈ 2–3x is routine and the factor saturated
    // for every bank — a Quality of 25/25 for any profitable lender read as
    // fake. ROA (the classic bank-quality metric) replaces it, and the ROE
    // ceiling sits at 22% so a genuinely elite franchise still isn't "perfect".
    // IN: ROE floor rises with the ~6.5% G-sec hurdle, and 1.8-2% ROA is
    // already elite for an Indian bank (US majors reach 3% on fee income).
    return bucket("Quality", [
      mk("Return on equity", s.returnOnEquity, ...pickBand(mkt, [0.05, 0.22], [0.08, 0.22]), 9, (v) => `ROE ${pct(v)}`),
      mk("Return on assets", s.returnOnAssets, ...pickBand(mkt, [0.005, 0.03], [0.005, 0.02]), 8, (v) => `ROA ${(v * 100).toFixed(1)}%`),
      mk("Net margin", s.profitMargins, 0.10, 0.40, 8, (v) => `Net margin ${pct(v)}`),
    ]);
  }
  if (sg === "utilities") {
    // Utilities have regulated margins; 20% op margin is solid, 30% is excellent
    return bucket("Quality", [
      mk("Return on equity", s.returnOnEquity, 0.05, 0.14, 9, (v) => `ROE ${pct(v)}`),
      mk("Operating margin", s.operatingMargins, 0.08, 0.25, 8, (v) => `Op margin ${pct(v)}`),
      mk("FCF / net income", fcfQuality, 0.4, 1.1, 8, (v) => `FCF/NI ${ratio(v)}`),
    ]);
  }
  // default. IN: the ROE floor rises with the ~6.5% G-sec hurdle — a 5% ROE
  // destroys value in India. Margins/FCF-conversion are business-model driven
  // and keep one band across markets.
  return bucket("Quality", [
    mk("Return on equity", s.returnOnEquity, ...pickBand(mkt, [0.05, 0.25], [0.08, 0.25]), 9, (v) => `ROE ${pct(v)}`),
    mk("Operating margin", s.operatingMargins, 0.05, 0.3, 8, (v) => `Op margin ${pct(v)}`),
    mk("FCF / net income", fcfQuality, 0.4, 1.1, 8, (v) => `FCF/NI ${ratio(v)}`),
  ]);
}

export function scoreGrowth(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
) {
  const sg = sectorGroup(s.sector);
  const mkt = bandMarket(s);

  if (sg === "utilities") {
    // Regulated utility growing revenue 5% YoY is doing very well
    return bucket("Growth", [
      mk("Revenue growth", s.revenueGrowth, -0.02, 0.08, 9, (v) => `Rev growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Earnings growth", s.earningsGrowth, -0.05, 0.10, 8, (v) => `EPS growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Revenue CAGR", st?.revenueCagr, -0.01, 0.06, 8, (v) => `Rev CAGR ${pct(v)}`),
    ]);
  }
  if (sg === "financials" || sg === "reits") {
    // Banks and REITs: 10-12% revenue growth is strong — but "strong" must
    // not be the ceiling. The old bands topped out at 12/15/8%, which every
    // large Indian private bank clears in a normal year, so four of five
    // compared banks scored an identical, saturated 100. The top of the band
    // now sits where growth is genuinely exceptional for a lender, so 12% vs
    // 18% vs 25% remain distinguishable.
    return bucket("Growth", [
      mk("Revenue growth", s.revenueGrowth, -0.02, 0.25, 9, (v) => `Rev growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Earnings growth", s.earningsGrowth, -0.05, 0.30, 8, (v) => `EPS growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Revenue CAGR", st?.revenueCagr, -0.01, 0.20, 8, (v) => `Rev CAGR ${pct(v)}`),
    ]);
  }
  // default. IN: bands shift up by roughly the ~5pp nominal-GDP differential —
  // flat revenue in a 10-11% nominal economy is losing share in real terms.
  return bucket("Growth", [
    mk("Revenue growth", s.revenueGrowth, ...pickBand(mkt, [0, 0.2], [0.05, 0.25]), 9, (v) => `Rev growth ${v >= 0 ? "+" : ""}${pct(v)}`),
    mk("Earnings growth", s.earningsGrowth, ...pickBand(mkt, [0, 0.25], [0.05, 0.3]), 8, (v) => `EPS growth ${v >= 0 ? "+" : ""}${pct(v)}`),
    mk("Revenue CAGR", st?.revenueCagr, ...pickBand(mkt, [0, 0.2], [0.03, 0.23]), 8, (v) => `Rev CAGR ${pct(v)}`),
  ]);
}

export function scoreHealth(s: FundamentalsSnapshot) {
  const sg = sectorGroup(s.sector);
  const mkt = bandMarket(s);
  const netDebtToEbitda =
    s.totalDebt != null && s.totalCash != null && s.ebitda != null && s.ebitda !== 0
      ? (s.totalDebt - s.totalCash) / s.ebitda
      : null;

  if (sg === "financials") {
    // Banks: current ratio and EBITDA are not meaningful — deposits are
    // current liabilities by design, and interest is both core revenue and
    // core cost. Net debt/EBITDA used to sit here anyway; since EBITDA is
    // null for every bank, mk() half-credited it for every bank identically,
    // which (with the D/E band below saturating) pinned the whole bucket at
    // exactly 70% for any profitable lender.
    //
    // What a bank-health score SHOULD blend (CAR/CET1, GNPA/NNPA, provision
    // coverage, CASA) is not in the provider dataset, so the bucket uses the
    // two genuine health signals that are: leverage (D/E — Yahoo's figure,
    // normalized ÷100 in lib/fundamentals.ts, covers borrowings over equity;
    // majors land ~0.5-1.5, stressed lenders 2.5+; the old 20→4 band assumed
    // the unnormalized scale and full-credited every bank in existence) and
    // operating efficiency (operating margin as a cost-income proxy — the
    // standard resilience measure regulators track for lenders).
    return bucket("Financial Health", [
      mk("Debt / equity", s.debtToEquity, 3, 0.3, 12, (v) => `D/E ${ratio(v)} (borrowings / equity)`),
      mk("Operating efficiency", s.operatingMargins, 0.20, 0.55, 8, (v) => `Op margin ${pct(v)} (cost-income proxy)`),
    ]);
  }
  if (sg === "utilities") {
    // Utilities carry infrastructure debt; 3-4x D/E is standard and not alarming
    return bucket("Financial Health", [
      mk("Debt / equity", s.debtToEquity, 4, 0.5, 8, (v) => `D/E ${ratio(v)}`),
      mk("Current ratio", s.currentRatio, 0.8, 1.8, 6, (v) => `Current ${ratio(v)}`),
      mk("Net debt / EBITDA", netDebtToEbitda, 8, 2, 6, (v) => `Net debt/EBITDA ${ratio(v)}`),
    ]);
  }
  if (sg === "reits") {
    // REITs use debt as part of their capital structure; 3x D/E is acceptable
    return bucket("Financial Health", [
      mk("Debt / equity", s.debtToEquity, 4, 0.5, 8, (v) => `D/E ${ratio(v)}`),
      mk("Current ratio", s.currentRatio, 0.8, 2, 6, (v) => `Current ${ratio(v)}`),
      mk("Net debt / EBITDA", netDebtToEbitda, 10, 3, 6, (v) => `Net debt/EBITDA ${ratio(v)}`),
    ]);
  }
  // default. IN: corporate India deleveraged hard post-2015 (IBC era) — D/E
  // above ~1.5x is already an outlier for the general group.
  return bucket("Financial Health", [
    mk("Debt / equity", s.debtToEquity, ...pickBand(mkt, [2, 0.2], [1.5, 0.2]), 8, (v) => `D/E ${ratio(v)}`),
    mk("Current ratio", s.currentRatio, 0.8, 2, 6, (v) => `Current ${ratio(v)}`),
    mk("Net debt / EBITDA", netDebtToEbitda, 4, 0, 6, (v) => `Net debt/EBITDA ${ratio(v)}`),
  ]);
}

/**
 * Capital allocation discipline: cash-generation growth, margin trajectory,
 * and shareholder returns. Reuses fields already fetched for other buckets
 * (st.operatingMargin is also read by assessRisks() for compression
 * flagging — same reuse pattern already used for debtToEquity across
 * scoreHealth() and assessRisks()) rather than fetching anything new.
 */
export function scoreCapitalAllocation(s: FundamentalsSnapshot, st: FinancialStatements | null) {
  const sg = sectorGroup(s.sector);
  const mkt = bandMarket(s);
  const om = st?.operatingMargin ?? [];
  const marginTrendPp = om.length >= 2 ? om.at(-1)!.value - om[0].value : null;

  // IN default: the Nifty's aggregate dividend yield runs ~1.2-1.5%, so a 3%
  // payer is already a high-distribution name — 4% is a US-market bar.
  const dividendRange =
    sg === "utilities" || sg === "reits"
      ? { worst: 0, best: 0.06 }
      : mkt === "IN"
        ? { worst: 0, best: 0.03 }
        : { worst: 0, best: 0.04 };

  return bucket("Capital Allocation", [
    mk("FCF growth (CAGR)", st?.fcfCagr, -0.05, 0.15, 10, (v) => `FCF CAGR ${v >= 0 ? "+" : ""}${pct(v)}`),
    mk("Operating margin trend", marginTrendPp, -0.03, 0.05, 8, (v) =>
      `Op margin ${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}pp since ${st?.fiscalYears[0] ?? "prior period"}`,
    ),
    mk("Shareholder yield", s.dividendYield, dividendRange.worst, dividendRange.best, 6, (v) => `Div yield ${pct(v)}`),
  ]);
}

/**
 * Sector leadership: relative strength, momentum, and rank from the Sector
 * Rotation Engine (lib/sector-rotation.ts). `entry` is passed in as plain
 * data rather than importing that module directly, to avoid pulling
 * node:sqlite (via lib/db.ts) into client bundles — the same precedent
 * lib/portfolio-analytics.ts already established for this exact hazard.
 * mk() degrades to half-credit "n/a" when entry is null, so symbols outside
 * the 11 GICS sector ETF map need no special-casing.
 */
export function scoreSectorMomentum(entry: SectorRotationEntry | null) {
  return bucket("Sector Rotation", [
    mk("Relative strength", entry?.relativeStrength ?? null, -5, 5, 10, (v) =>
      `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp vs sector avg`,
    ),
    mk("Momentum", entry?.momentum ?? null, -3, 3, 8, (v) => `Momentum ${v >= 0 ? "+" : ""}${v.toFixed(1)}`),
    mk("Rank", entry ? 12 - entry.rank : null, 0, 11, 6, () => `#${entry!.rank}/11 · ${entry!.classification}`),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Momentum / technical signal                                                */
/* -------------------------------------------------------------------------- */

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const sma = (xs: number[], n: number): number | null =>
  xs.length >= n ? xs.slice(-n).reduce((s, x) => s + x, 0) / n : null;

/**
 * Derive a price-momentum signal from daily closes. Pure so it can be tested
 * with a synthetic series. Returns null when there isn't enough history to be
 * meaningful (< ~1 month of closes).
 *
 * Computed on the total-return series (lib/prices.ts) so returns, SMA
 * distances, and the 52-week range share one basis with the Screener and
 * portfolio analytics — raw close understated every dividend payer's return.
 */
export function computeMomentum(history: HistoryPoint[]): MomentumSignal | null {
  const closes = history.map(totalReturnClose).filter((c) => c > 0);
  if (closes.length < 20) return null;

  const price = closes.at(-1)!;
  // 52-week range means the last ~252 trading sessions, NOT the whole series
  // — callers pass up to 5 years of history (the research/compare bundles use
  // 1825 days), and Math.max over all of it silently turned "from 52W high"
  // into "from 5-year high".
  const window52wk = closes.slice(-252);
  const hi = Math.max(...window52wk);
  const lo = Math.min(...window52wk);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const back3m = closes.at(-Math.min(63, closes.length))!;

  const pctFrom52WkHigh = hi ? ((price - hi) / hi) * 100 : null;
  const pctFrom52WkLow = lo ? ((price - lo) / lo) * 100 : null;
  const vsSma50 = sma50 ? ((price - sma50) / sma50) * 100 : null;
  const vsSma200 = sma200 ? ((price - sma200) / sma200) * 100 : null;
  const return3m = back3m ? ((price - back3m) / back3m) * 100 : null;

  // Blend the available sub-signals into a 0-100 momentum score.
  const components: number[] = [];
  if (return3m != null) components.push(lerp(return3m, -25, 25, 100));
  if (vsSma50 != null) components.push(lerp(vsSma50, -12, 12, 100));
  if (vsSma200 != null) components.push(lerp(vsSma200, -20, 25, 100));
  // Position within the 52-week range: a mild tailwind, capped so a stock
  // pinned at its high isn't treated as a screaming buy on momentum alone.
  if (pctFrom52WkHigh != null && lo !== hi) {
    const pos = (price - lo) / (hi - lo); // 0 = at low, 1 = at high
    components.push(clamp(35 + pos * 50));
  }
  const score = components.length
    ? Math.round(components.reduce((s, x) => s + x, 0) / components.length)
    : 50;

  const trend: MomentumSignal["trend"] =
    sma50 != null && sma200 != null
      ? sma50 > sma200 * 1.01
        ? "up"
        : sma50 < sma200 * 0.99
          ? "down"
          : "flat"
      : return3m != null
        ? return3m > 3
          ? "up"
          : return3m < -3
            ? "down"
            : "flat"
        : "flat";

  return { score, pctFrom52WkHigh, pctFrom52WkLow, vsSma50, vsSma200, return3m, trend };
}

/* -------------------------------------------------------------------------- */
/* Analyst signal                                                             */
/* -------------------------------------------------------------------------- */

function keyToScore(key: string | null): number | null {
  switch (key) {
    case "strong_buy":
      return 92;
    case "buy":
      return 75;
    case "hold":
    case "neutral":
      return 50;
    case "sell":
    case "underperform":
      return 28;
    case "strong_sell":
      return 10;
    default:
      return null;
  }
}

/**
 * Convert the analyst consensus into a 0-100 score, blending the rating
 * distribution, price-target upside, and recent EPS-estimate revisions.
 * Returns null when there's no analyst coverage at all.
 */
export function analystSignal(a: AnalystConsensus): number | null {
  const total = a.strongBuy + a.buy + a.hold + a.sell + a.strongSell;
  const dist =
    total > 0
      ? (a.strongBuy * 100 + a.buy * 75 + a.hold * 50 + a.sell * 25 + a.strongSell * 0) /
        total
      : keyToScore(a.recommendationKey);

  const upside = a.upsidePercent != null ? lerp(a.upsidePercent, -25, 40, 100) : null;

  let revision: number | null = null;
  if (a.epsRevisionsUp30d != null || a.epsRevisionsDown30d != null) {
    const up = a.epsRevisionsUp30d ?? 0;
    const down = a.epsRevisionsDown30d ?? 0;
    revision = up + down > 0 ? lerp((up - down) / (up + down), -1, 1, 100) : 50;
  }

  const parts: [number, number][] = []; // [value, weight]
  if (dist != null) parts.push([dist, 0.6]);
  if (upside != null) parts.push([upside, 0.3]);
  if (revision != null) parts.push([revision, 0.1]);
  if (parts.length === 0) return null;

  const wSum = parts.reduce((s, [, w]) => s + w, 0);
  return Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wSum);
}

/* -------------------------------------------------------------------------- */
/* Composite decision                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Composite signal weights, keyed by market. India research should lean on
 * fundamentals and sector leadership rather than analyst consensus (coverage
 * is sparser and less reliable for many NSE/BSE names) — see the "market-aware
 * research" requirement. Renormalized automatically when a signal is missing
 * (the wSum divide in computeScore), so these don't need to sum to exactly 1.
 */
const DEFAULT_SIGNAL_WEIGHTS = { fundamentals: 0.45, analysts: 0.25, momentum: 0.15, capitalAllocation: 0.07, sectorRotation: 0.08 };
const MARKET_SIGNAL_WEIGHTS: Partial<Record<MarketRegion, typeof DEFAULT_SIGNAL_WEIGHTS>> = {
  IN: { fundamentals: 0.55, analysts: 0.10, momentum: 0.15, capitalAllocation: 0.10, sectorRotation: 0.10 },
};

function buildRationale(
  rec: Recommendation,
  signals: DecisionSignals,
  buckets: ScoreBucket[],
): string {
  const factors = buckets.flatMap((b) => b.factors).filter((f) => f.detail !== "n/a");
  const byRatio = [...factors].sort((a, b) => b.points / b.max - a.points / a.max);
  const strengths = byRatio.filter((f) => f.points / f.max >= 0.6).slice(0, 2);
  const concerns = [...byRatio].reverse().filter((f) => f.points / f.max <= 0.4).slice(0, 2);

  const sig: string[] = [];
  if (signals.fundamentals != null) sig.push(`fundamentals ${signals.fundamentals}`);
  if (signals.analysts != null) sig.push(`analysts ${signals.analysts}`);
  if (signals.momentum != null) sig.push(`momentum ${signals.momentum}`);
  if (signals.sectorRotation != null) sig.push(`sector rotation ${signals.sectorRotation}`);

  // No signal resolved at all — say that, rather than open with a bare dash
  // and let the reader assume the numbers were simply omitted for brevity.
  const parts: string[] = sig.length
    ? [`${RECOMMENDATION_LABEL[rec]} — ${sig.join(", ")} (all /100).`]
    : ["No fundamental, analyst, or momentum signal is available for this instrument."];
  if (strengths.length) parts.push(`Strengths: ${strengths.map((f) => f.detail).join(", ")}.`);
  if (concerns.length) parts.push(`Watch: ${concerns.map((f) => f.detail).join(", ")}.`);
  return parts.join(" ");
}

export function computeScore(
  snapshot: FundamentalsSnapshot,
  statements: FinancialStatements | null,
  analyst: AnalystConsensus,
  momentum: MomentumSignal | null = null,
  /** Pass explicitly (including `null` for "checked, no entry") to add the Sector Rotation bucket. Omit entirely to leave existing callers' output unchanged. */
  sectorRotation?: SectorRotationEntry | null,
  market?: MarketRegion,
): ScoreResult {
  const parts = [
    scoreValuation(snapshot, analyst),
    scoreQuality(snapshot, statements),
    scoreGrowth(snapshot, statements),
    scoreHealth(snapshot),
  ];
  const buckets = parts.map((p) => p.bucket);
  const total = Math.round(buckets.reduce((s, b) => s + b.points, 0));

  const analysts = analystSignal(analyst);
  const momentumScore = momentum?.score ?? null;

  // How much of the fundamental picture is real. mk() half-credits every
  // absent input, so a symbol Yahoo has no fundamentals for at all (an index,
  // an unmapped quoteType falling through to the equity path) still sums to a
  // plausible ~51/100. Coverage is what tells those apart from a genuinely
  // mediocre company, and every fundamental-derived signal below is gated on
  // it — otherwise the blend reports padding as though it were evidence.
  const dataCount = parts.reduce((s, p) => s + p.dataCount, 0);
  const factorCount = parts.reduce((s, p) => s + p.total, 0);
  const completeness = factorCount ? dataCount / factorCount : 0;
  const hasFundamentals = dataCount > 0;

  // Capital Allocation is always computed (needs only snapshot/statements,
  // already required args) and always contributes to the blend. Sector
  // Rotation is opt-in — only appended when a caller explicitly threads a
  // rotation entry through, since most existing callers don't have one.
  const capAlloc = scoreCapitalAllocation(snapshot, statements);
  const capAllocBucket = capAlloc.bucket;
  const capitalAllocationScore =
    capAlloc.dataCount > 0
      ? Math.round((capAllocBucket.points / capAllocBucket.max) * 100)
      : null;
  buckets.push(capAllocBucket);

  let sectorRotationScore: number | null = null;
  if (sectorRotation !== undefined) {
    const sectorPart = scoreSectorMomentum(sectorRotation);
    const sectorBucket = sectorPart.bucket;
    // A null rotation entry half-credits all three factors into a flat 50.
    // That is the absence of a reading, not a neutral reading.
    if (sectorPart.dataCount > 0) {
      sectorRotationScore = Math.round((sectorBucket.points / sectorBucket.max) * 100);
    }
    buckets.push(sectorBucket);
  }

  const signals: DecisionSignals = {
    fundamentals: hasFundamentals ? total : null,
    analysts,
    momentum: momentumScore,
    capitalAllocation: capitalAllocationScore,
    sectorRotation: sectorRotationScore,
  };

  const w = (market != null ? MARKET_SIGNAL_WEIGHTS[market] : undefined) ?? DEFAULT_SIGNAL_WEIGHTS;

  // Blend the available signals. Fundamentals anchor the call; analyst consensus,
  // price momentum, capital allocation discipline, and sector leadership refine
  // it. Weights renormalize when a signal is missing (the wSum divide below).
  const weighted: [number, number][] = [];
  if (hasFundamentals) weighted.push([total, w.fundamentals]);
  if (capitalAllocationScore != null) weighted.push([capitalAllocationScore, w.capitalAllocation]);
  if (analysts != null) weighted.push([analysts, w.analysts]);
  if (momentumScore != null) weighted.push([momentumScore, w.momentum]);
  if (sectorRotationScore != null) weighted.push([sectorRotationScore, w.sectorRotation]);
  const wSum = weighted.reduce((s, [, w]) => s + w, 0);
  // wSum === 0 means no signal of any kind resolved. Fall back to the raw
  // bucket sum rather than dividing by zero; `fundamentalCoverage` below is
  // what tells the caller the number is not evidence.
  const composite = wSum
    ? Math.round(weighted.reduce((s, [v, w]) => s + v * w, 0) / wSum)
    : total;

  const rec = scoreToRecommendation(composite);

  // Confidence blends three things: how complete the fundamental data is, how
  // far the composite sits from a tier boundary, and how much the independent
  // signals agree with one another.
  const nearestEdge = Math.min(...TIER_EDGES.map((e) => Math.abs(composite - e)));
  const clarity = Math.min(1, nearestEdge / 15);

  const sigVals = [signals.fundamentals, analysts, momentumScore].filter(
    (v): v is number => v != null,
  );
  const mean = sigVals.length ? sigVals.reduce((s, v) => s + v, 0) / sigVals.length : 0;
  const spread = sigVals.length
    ? Math.sqrt(sigVals.reduce((s, v) => s + (v - mean) ** 2, 0) / sigVals.length)
    : 0;
  // With one signal the spread is trivially 0 — that is not agreement, and it
  // must not buy back the confidence the missing fundamentals just cost.
  const agreement = sigVals.length > 1 ? Math.max(0, 1 - spread / 35) : 0;

  const confidence = Math.round(
    clamp(45 + completeness * 22 + clarity * 16 + agreement * 17, 0, 95),
  );

  return {
    total,
    composite,
    buckets,
    recommendation: rec,
    confidence,
    rationale: buildRationale(rec, signals, buckets),
    signals,
    fundamentalCoverage: { available: dataCount, total: factorCount },
  };
}

/* -------------------------------------------------------------------------- */
/* Investment personality — permanent identity, not a transient AI take       */
/* -------------------------------------------------------------------------- */

const CYCLICAL_SECTORS = new Set(["Consumer Cyclical", "Energy", "Industrials", "Basic Materials", "Materials"]);
const DEFENSIVE_SECTORS = new Set(["Utilities", "Consumer Defensive", "Consumer Staples", "Healthcare"]);

function bucketRatio(buckets: ScoreBucket[], name: string): number | null {
  const b = buckets.find((x) => x.name === name);
  return b && b.max > 0 ? b.points / b.max : null;
}

/**
 * Deterministic, descriptive investment characteristics — no AI involved
 * (matches "AI explains, engines decide"). Pure function of the
 * already-computed ScoreResult + snapshot + momentum; no new I/O.
 *
 * Every branch is an independent threshold check, evaluated in the same
 * specificity order the single-tag classifier always used, so the FIRST
 * element is exactly the tag `classifyInvestmentPersonality` returns.
 * Returns [] when nothing meaningfully applies — callers omit the row
 * rather than forcing a label onto an undifferentiated company.
 */
export function deriveInvestmentCharacteristics(
  score: ScoreResult,
  snapshot: FundamentalsSnapshot,
  momentum: MomentumSignal | null,
): { tag: InvestmentPersonalityTag; explanation: string }[] {
  const qualityR = bucketRatio(score.buckets, "Quality");
  const valuationR = bucketRatio(score.buckets, "Valuation");
  const growthR = bucketRatio(score.buckets, "Growth");
  const healthR = bucketRatio(score.buckets, "Financial Health");
  const capAllocR = bucketRatio(score.buckets, "Capital Allocation");
  const sector = snapshot.sector ?? null;
  const trend = momentum?.trend ?? "flat";

  const traits: { tag: InvestmentPersonalityTag; explanation: string }[] = [];

  if (growthR != null && growthR >= 0.75 && snapshot.revenueGrowth != null && snapshot.revenueGrowth > 0.20) {
    traits.push({
      tag: "High Growth",
      explanation: `Growth bucket ${Math.round(growthR * 100)}/100 with ${pct(snapshot.revenueGrowth)} revenue growth — expanding well above the market.`,
    });
  }

  if (valuationR != null && valuationR >= 0.75 && qualityR != null && qualityR >= 0.45) {
    traits.push({
      tag: "Deep Value",
      explanation: `Valuation bucket ${Math.round(valuationR * 100)}/100${snapshot.pegRatio != null ? ` (PEG ${ratio(snapshot.pegRatio)})` : ""} — trading cheap relative to underlying quality.`,
    });
  }

  if (qualityR != null && qualityR >= 0.70 && growthR != null && growthR >= 0.55 && healthR != null && healthR >= 0.55) {
    traits.push({
      tag: "Compounder",
      explanation: `Quality ${Math.round(qualityR * 100)}/100, Growth ${Math.round(growthR * 100)}/100, and Financial Health ${Math.round(healthR * 100)}/100 all solid — durable compounding characteristics.`,
    });
  }

  if (growthR != null && growthR < 0.40 && trend === "up" && capAllocR != null && capAllocR >= 0.55) {
    traits.push({
      tag: "Turnaround",
      explanation: `Growth still weak (${Math.round(growthR * 100)}/100) but capital allocation is improving (${Math.round(capAllocR * 100)}/100) with positive recent price momentum — early signs of a turn.`,
    });
  }

  if (snapshot.dividendYield != null && snapshot.dividendYield >= 0.025 && (growthR == null || growthR < 0.55)) {
    traits.push({
      tag: "Income",
      explanation: `${pct(snapshot.dividendYield)} dividend yield with modest growth expectations — a shareholder-return-oriented holding.`,
    });
  }

  if (sector != null && CYCLICAL_SECTORS.has(sector)) {
    traits.push({
      tag: "Cyclical",
      explanation: `${sector} is a cyclical sector — earnings and the stock typically track the broader economic cycle.`,
    });
  }

  if (sector != null && DEFENSIVE_SECTORS.has(sector) && trend !== "down") {
    traits.push({
      tag: "Defensive",
      explanation: `${sector} tends to hold up in downturns; current momentum is ${trend === "up" ? "positive" : "stable"}, consistent with a defensive profile.`,
    });
  }

  // Standalone quality: strong Quality bucket without the growth/health combo
  // that already earned Compounder (which subsumes it).
  if (
    qualityR != null && qualityR >= 0.70 &&
    !traits.some((t) => t.tag === "Compounder")
  ) {
    traits.push({
      tag: "High Quality",
      explanation: `Quality bucket ${Math.round(qualityR * 100)}/100 — consistently strong margins and returns on capital.`,
    });
  }

  // Descriptive, not exhaustive: three characteristics orient; five decorate.
  return traits.slice(0, 3);
}

/**
 * Deterministic classification into a permanent investment identity — the
 * single most specific characteristic from `deriveInvestmentCharacteristics`,
 * with the historical quality-first fallback when nothing clears a threshold.
 */
export function classifyInvestmentPersonality(
  score: ScoreResult,
  snapshot: FundamentalsSnapshot,
  momentum: MomentumSignal | null,
): { tag: InvestmentPersonalityTag; explanation: string } {
  const traits = deriveInvestmentCharacteristics(score, snapshot, momentum);
  if (traits.length > 0) return traits[0];

  const qualityR = bucketRatio(score.buckets, "Quality");
  return {
    tag: "High Quality",
    explanation: qualityR != null
      ? `Quality bucket ${Math.round(qualityR * 100)}/100 is the strongest signal available — no single dimension dominates enough for a more specific tag.`
      : "Insufficient data for a more specific classification — defaulting to a quality-first read.",
  };
}

/* -------------------------------------------------------------------------- */
/* Risk heat map (sector-aware)                                               */
/* -------------------------------------------------------------------------- */

function rank(level: RiskLevel): number {
  return level === "high" ? 2 : level === "medium" ? 1 : 0;
}
const worse = (a: RiskLevel, b: RiskLevel): RiskLevel => (rank(a) >= rank(b) ? a : b);

export function assessRisks(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
  a: AnalystConsensus,
  insider: InsiderActivity,
): RiskItem[] {
  const sg = sectorGroup(s.sector);
  const mkt = bandMarket(s);

  // Valuation risk
  let valLevel: RiskLevel = "low";
  const valReasons: string[] = [];
  if (a.upsidePercent != null && a.upsidePercent < 0) {
    valLevel = worse(valLevel, "medium");
    valReasons.push(`${a.upsidePercent.toFixed(0)}% vs target`);
  }
  // IN threshold matches the higher PEG scoring band — the market's reference
  // compounders sit near 3 and must not all carry a "high valuation risk" flag.
  if (s.pegRatio != null && s.pegRatio > (mkt === "IN" ? 3.5 : 2.5)) {
    valLevel = worse(valLevel, "high");
    valReasons.push(`PEG ${ratio(s.pegRatio)}`);
  } else if (s.priceToBook != null && s.priceToBook > 15) {
    valLevel = worse(valLevel, "medium");
    valReasons.push(`P/B ${s.priceToBook.toFixed(0)}`);
  }

  // Growth risk (incl. deceleration from the statements trend)
  let growthLevel: RiskLevel = "low";
  const growthReasons: string[] = [];
  const growthThresholds = sg === "utilities"
    ? { low: -0.01, medium: 0.03 }
    : sg === "financials" || sg === "reits"
      ? { low: -0.01, medium: 0.04 }
      : { low: 0.03, medium: 0.10 };
  if (s.revenueGrowth != null) {
    if (s.revenueGrowth < growthThresholds.low) {
      growthLevel = worse(growthLevel, "high");
      growthReasons.push(`rev growth ${pct(s.revenueGrowth)}`);
    } else if (s.revenueGrowth < growthThresholds.medium) {
      growthLevel = worse(growthLevel, "medium");
      growthReasons.push(`rev growth ${pct(s.revenueGrowth)}`);
    }
  }
  const rev = st?.revenue ?? [];
  if (rev.length >= 3) {
    const g1 = rev.at(-1)!.value / rev.at(-2)!.value - 1;
    const g0 = rev.at(-2)!.value / rev.at(-3)!.value - 1;
    if (g1 < g0 - 0.05) {
      growthLevel = worse(growthLevel, "medium");
      growthReasons.push("decelerating");
    }
  }

  // Financial risk — thresholds differ by sector
  let finLevel: RiskLevel = "low";
  const finReasons: string[] = [];
  if (sg === "financials") {
    // Banks: snapshot D/E is the NORMALIZED borrowings/equity ratio (see
    // lib/fundamentals.ts ÷100) where majors sit ~0.5-1.5 — the old 10x/15x
    // thresholds were calibrated to the unnormalized scale and never fired.
    if (s.debtToEquity != null && s.debtToEquity > 3) {
      finLevel = worse(finLevel, "high");
      finReasons.push(`D/E ${ratio(s.debtToEquity)} (very high for a bank)`);
    } else if (s.debtToEquity != null && s.debtToEquity > 2) {
      finLevel = worse(finLevel, "medium");
      finReasons.push(`D/E ${ratio(s.debtToEquity)}`);
    }
  } else if (sg === "utilities" || sg === "reits") {
    // Utilities/REITs: 4x D/E high, 2.5x medium
    if (s.debtToEquity != null && s.debtToEquity > 4) {
      finLevel = worse(finLevel, "high");
      finReasons.push(`D/E ${ratio(s.debtToEquity)}`);
    } else if (s.debtToEquity != null && s.debtToEquity > 2.5) {
      finLevel = worse(finLevel, "medium");
      finReasons.push(`D/E ${ratio(s.debtToEquity)}`);
    }
    if (s.currentRatio != null && s.currentRatio < 0.8) {
      finLevel = worse(finLevel, "medium");
      finReasons.push(`current ${ratio(s.currentRatio)}`);
    }
  } else {
    // default
    if (s.debtToEquity != null && s.debtToEquity > 1.5) {
      finLevel = worse(finLevel, "high");
      finReasons.push(`D/E ${ratio(s.debtToEquity)}`);
    } else if (s.debtToEquity != null && s.debtToEquity > 0.8) {
      finLevel = worse(finLevel, "medium");
      finReasons.push(`D/E ${ratio(s.debtToEquity)}`);
    }
    if (s.currentRatio != null && s.currentRatio < 1) {
      finLevel = worse(finLevel, "medium");
      finReasons.push(`current ${ratio(s.currentRatio)}`);
    }
  }

  // Execution risk: insider selling, margin compression, EPS misses
  let execLevel: RiskLevel = "low";
  const execReasons: string[] = [];
  if (insider.sellCount > 0 && insider.netValue < -50_000_000) {
    execLevel = worse(execLevel, "medium");
    execReasons.push("net insider selling");
  }
  const om = st?.operatingMargin ?? [];
  if (om.length >= 2 && om.at(-1)!.value < om.at(-2)!.value - 0.02) {
    execLevel = worse(execLevel, "medium");
    execReasons.push("margin compression");
  }
  const misses = a.epsSurprises.filter((x) => x < 0).length;
  if (misses >= 2) {
    execLevel = worse(execLevel, "high");
    execReasons.push(`${misses} EPS misses`);
  }

  const fallback = (reasons: string[], low: string) =>
    reasons.length ? reasons.join(", ") : low;

  return [
    { category: "Valuation", level: valLevel, reason: fallback(valReasons, "reasonable vs target/peers") },
    { category: "Growth", level: growthLevel, reason: fallback(growthReasons, "growth intact") },
    { category: "Financial", level: finLevel, reason: fallback(finReasons, "healthy balance sheet") },
    { category: "Execution", level: execLevel, reason: fallback(execReasons, "stable margins & insiders") },
  ];
}
