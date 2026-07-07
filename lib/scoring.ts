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
  ScoreFactor,
  ScoreResult,
  SectorRotationEntry,
} from "./types";
import { sectorGroup } from "./sector";
// Type-only import — lib/market.ts has zero runtime deps beyond ./types, so
// this is safe in client bundles, unlike importing lib/sector-rotation.ts
// (which pulls in node:sqlite via lib/db.ts).
import type { MarketRegion } from "./market";
import { lerp } from "./score-math";
import { scoreToRecommendation, RECOMMENDATION_LABEL, TIER_EDGES } from "./recommendation";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const ratio = (v: number) => v.toFixed(2);

interface FactorResult {
  factor: ScoreFactor;
  hasData: boolean;
}

/** Build one factor; missing data yields half credit and is flagged. */
function mk(
  label: string,
  value: number | null | undefined,
  worst: number,
  best: number,
  max: number,
  detail: (v: number) => string,
): FactorResult {
  if (value == null || Number.isNaN(value)) {
    return { factor: { label, points: Math.round(max * 0.5), max, detail: "n/a" }, hasData: false };
  }
  return {
    factor: { label, points: Math.round(lerp(value, worst, best, max)), max, detail: detail(value) },
    hasData: true,
  };
}

function bucket(name: string, results: FactorResult[]): {
  bucket: ScoreBucket;
  dataCount: number;
  total: number;
} {
  const factors = results.map((r) => r.factor);
  const points = factors.reduce((s, f) => s + f.points, 0);
  const max = factors.reduce((s, f) => s + f.max, 0);
  return {
    bucket: { name, points, max, factors },
    dataCount: results.filter((r) => r.hasData).length,
    total: results.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Buckets (sector-aware)                                                     */
/* -------------------------------------------------------------------------- */

export function scoreValuation(s: FundamentalsSnapshot, a: AnalystConsensus) {
  const sg = sectorGroup(s.sector);
  const fwdRatio =
    s.forwardPE != null && s.trailingPE != null && s.trailingPE !== 0
      ? s.forwardPE / s.trailingPE
      : null;

  if (sg === "financials") {
    // Banks: P/E is less distorted than for industrials, but still apply tighter range
    return bucket("Valuation", [
      mk("Analyst upside", a.upsidePercent, -15, 30, 12, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}% to target`),
      mk("Forward P/E", s.forwardPE, 18, 8, 10, (v) => `Fwd P/E ${v.toFixed(1)}`),
      mk("Forward vs trailing P/E", fwdRatio, 1.2, 0.7, 8, () =>
        s.forwardPE != null ? `Fwd P/E ${s.forwardPE.toFixed(1)} vs ${s.trailingPE?.toFixed(1)}` : "n/a",
      ),
    ]);
  }
  if (sg === "utilities") {
    // Utilities trade at 14-20x P/E as a normal range — don't penalize 18x
    return bucket("Valuation", [
      mk("Analyst upside", a.upsidePercent, -15, 30, 12, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}% to target`),
      mk("Forward P/E", s.forwardPE, 28, 13, 10, (v) => `Fwd P/E ${v.toFixed(1)}`),
      mk("Forward vs trailing P/E", fwdRatio, 1.2, 0.6, 8, () =>
        s.forwardPE != null ? `Fwd P/E ${s.forwardPE.toFixed(1)} vs ${s.trailingPE?.toFixed(1)}` : "n/a",
      ),
    ]);
  }
  // default / REITs
  return bucket("Valuation", [
    mk("Analyst upside", a.upsidePercent, -15, 30, 12, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}% to target`),
    mk("PEG ratio", s.pegRatio, 3, 0.8, 10, (v) => `PEG ${ratio(v)}`),
    mk("Forward vs trailing P/E", fwdRatio, 1.2, 0.6, 8, () =>
      s.forwardPE != null ? `Fwd P/E ${s.forwardPE.toFixed(1)} vs ${s.trailingPE?.toFixed(1)}` : "n/a",
    ),
  ]);
}

export function scoreQuality(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
) {
  const sg = sectorGroup(s.sector);
  const latestNetIncome = st?.netIncome.at(-1)?.value ?? null;
  const latestFcf = st?.freeCashFlow.at(-1)?.value ?? s.freeCashflow ?? null;
  const fcfQuality =
    latestFcf != null && latestNetIncome != null && latestNetIncome !== 0
      ? latestFcf / latestNetIncome
      : null;

  if (sg === "financials") {
    // Gross margin is not meaningful for banks; ROE is the primary quality signal
    return bucket("Quality", [
      mk("Return on equity", s.returnOnEquity, 0.05, 0.18, 9, (v) => `ROE ${pct(v)}`),
      mk("Operating margin", s.operatingMargins, 0.10, 0.40, 8, (v) => `Op margin ${pct(v)}`),
      mk("FCF / net income", fcfQuality, 0.4, 1.1, 8, (v) => `FCF/NI ${ratio(v)}`),
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
  // default
  return bucket("Quality", [
    mk("Return on equity", s.returnOnEquity, 0.05, 0.25, 9, (v) => `ROE ${pct(v)}`),
    mk("Operating margin", s.operatingMargins, 0.05, 0.3, 8, (v) => `Op margin ${pct(v)}`),
    mk("FCF / net income", fcfQuality, 0.4, 1.1, 8, (v) => `FCF/NI ${ratio(v)}`),
  ]);
}

export function scoreGrowth(
  s: FundamentalsSnapshot,
  st: FinancialStatements | null,
) {
  const sg = sectorGroup(s.sector);

  if (sg === "utilities") {
    // Regulated utility growing revenue 5% YoY is doing very well
    return bucket("Growth", [
      mk("Revenue growth", s.revenueGrowth, -0.02, 0.08, 9, (v) => `Rev growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Earnings growth", s.earningsGrowth, -0.05, 0.10, 8, (v) => `EPS growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Revenue CAGR", st?.revenueCagr, -0.01, 0.06, 8, (v) => `Rev CAGR ${pct(v)}`),
    ]);
  }
  if (sg === "financials" || sg === "reits") {
    // Banks and REITs: 10-12% revenue growth is strong
    return bucket("Growth", [
      mk("Revenue growth", s.revenueGrowth, -0.02, 0.12, 9, (v) => `Rev growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Earnings growth", s.earningsGrowth, -0.05, 0.15, 8, (v) => `EPS growth ${v >= 0 ? "+" : ""}${pct(v)}`),
      mk("Revenue CAGR", st?.revenueCagr, -0.01, 0.08, 8, (v) => `Rev CAGR ${pct(v)}`),
    ]);
  }
  // default
  return bucket("Growth", [
    mk("Revenue growth", s.revenueGrowth, 0, 0.2, 9, (v) => `Rev growth ${v >= 0 ? "+" : ""}${pct(v)}`),
    mk("Earnings growth", s.earningsGrowth, 0, 0.25, 8, (v) => `EPS growth ${v >= 0 ? "+" : ""}${pct(v)}`),
    mk("Revenue CAGR", st?.revenueCagr, 0, 0.2, 8, (v) => `Rev CAGR ${pct(v)}`),
  ]);
}

export function scoreHealth(s: FundamentalsSnapshot) {
  const sg = sectorGroup(s.sector);
  const netDebtToEbitda =
    s.totalDebt != null && s.totalCash != null && s.ebitda != null && s.ebitda !== 0
      ? (s.totalDebt - s.totalCash) / s.ebitda
      : null;

  if (sg === "financials") {
    // Banks are structurally leveraged by design; D/E of 8-12x is healthy.
    // Current ratio is not a meaningful metric for banks — omit it.
    return bucket("Financial Health", [
      mk("Debt / equity", s.debtToEquity, 20, 4, 8, (v) => `D/E ${ratio(v)}`),
      mk("Net debt / EBITDA", netDebtToEbitda, 15, 2, 12, (v) => `Net debt/EBITDA ${ratio(v)}`),
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
  // default
  return bucket("Financial Health", [
    mk("Debt / equity", s.debtToEquity, 2, 0.2, 8, (v) => `D/E ${ratio(v)}`),
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
  const om = st?.operatingMargin ?? [];
  const marginTrendPp = om.length >= 2 ? om.at(-1)!.value - om[0].value : null;

  const dividendRange = sg === "utilities" || sg === "reits" ? { worst: 0, best: 0.06 } : { worst: 0, best: 0.04 };

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
 */
export function computeMomentum(history: HistoryPoint[]): MomentumSignal | null {
  const closes = history.map((p) => p.close).filter((c) => c > 0);
  if (closes.length < 20) return null;

  const price = closes.at(-1)!;
  const hi = Math.max(...closes);
  const lo = Math.min(...closes);
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

  const sig = [`fundamentals ${signals.fundamentals}`];
  if (signals.analysts != null) sig.push(`analysts ${signals.analysts}`);
  if (signals.momentum != null) sig.push(`momentum ${signals.momentum}`);
  if (signals.sectorRotation != null) sig.push(`sector rotation ${signals.sectorRotation}`);

  const parts: string[] = [`${RECOMMENDATION_LABEL[rec]} — ${sig.join(", ")} (all /100).`];
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

  // Capital Allocation is always computed (needs only snapshot/statements,
  // already required args) and always contributes to the blend. Sector
  // Rotation is opt-in — only appended when a caller explicitly threads a
  // rotation entry through, since most existing callers don't have one.
  const capAllocBucket = scoreCapitalAllocation(snapshot, statements).bucket;
  const capitalAllocationScore = Math.round((capAllocBucket.points / capAllocBucket.max) * 100);
  buckets.push(capAllocBucket);

  let sectorRotationScore: number | null = null;
  if (sectorRotation !== undefined) {
    const sectorBucket = scoreSectorMomentum(sectorRotation).bucket;
    sectorRotationScore = Math.round((sectorBucket.points / sectorBucket.max) * 100);
    buckets.push(sectorBucket);
  }

  const signals: DecisionSignals = {
    fundamentals: total,
    analysts,
    momentum: momentumScore,
    capitalAllocation: capitalAllocationScore,
    sectorRotation: sectorRotationScore,
  };

  const w = (market != null ? MARKET_SIGNAL_WEIGHTS[market] : undefined) ?? DEFAULT_SIGNAL_WEIGHTS;

  // Blend the available signals. Fundamentals anchor the call; analyst consensus,
  // price momentum, capital allocation discipline, and sector leadership refine
  // it. Weights renormalize when a signal is missing (the wSum divide below).
  const weighted: [number, number][] = [
    [total, w.fundamentals],
    [capitalAllocationScore, w.capitalAllocation],
  ];
  if (analysts != null) weighted.push([analysts, w.analysts]);
  if (momentumScore != null) weighted.push([momentumScore, w.momentum]);
  if (sectorRotationScore != null) weighted.push([sectorRotationScore, w.sectorRotation]);
  const wSum = weighted.reduce((s, [, w]) => s + w, 0);
  const composite = Math.round(weighted.reduce((s, [v, w]) => s + v * w, 0) / wSum);

  const rec = scoreToRecommendation(composite);

  // Confidence blends three things: how complete the fundamental data is, how
  // far the composite sits from a tier boundary, and how much the independent
  // signals agree with one another.
  const dataCount = parts.reduce((s, p) => s + p.dataCount, 0);
  const factorCount = parts.reduce((s, p) => s + p.total, 0);
  const completeness = factorCount ? dataCount / factorCount : 0;

  const nearestEdge = Math.min(...TIER_EDGES.map((e) => Math.abs(composite - e)));
  const clarity = Math.min(1, nearestEdge / 15);

  const sigVals = [total, analysts, momentumScore].filter((v): v is number => v != null);
  const mean = sigVals.reduce((s, v) => s + v, 0) / sigVals.length;
  const spread = Math.sqrt(
    sigVals.reduce((s, v) => s + (v - mean) ** 2, 0) / sigVals.length,
  );
  const agreement = Math.max(0, 1 - spread / 35); // 0 spread → 1, ≥35 spread → 0

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
 * Deterministic classification into a permanent investment identity — no AI
 * involved (matches "AI explains, engines decide"). Pure function of the
 * already-computed ScoreResult + snapshot + momentum; no new I/O.
 */
export function classifyInvestmentPersonality(
  score: ScoreResult,
  snapshot: FundamentalsSnapshot,
  momentum: MomentumSignal | null,
): { tag: InvestmentPersonalityTag; explanation: string } {
  const qualityR = bucketRatio(score.buckets, "Quality");
  const valuationR = bucketRatio(score.buckets, "Valuation");
  const growthR = bucketRatio(score.buckets, "Growth");
  const healthR = bucketRatio(score.buckets, "Financial Health");
  const capAllocR = bucketRatio(score.buckets, "Capital Allocation");
  const sector = snapshot.sector ?? null;
  const trend = momentum?.trend ?? "flat";

  if (growthR != null && growthR >= 0.75 && snapshot.revenueGrowth != null && snapshot.revenueGrowth > 0.20) {
    return {
      tag: "High Growth",
      explanation: `Growth bucket ${Math.round(growthR * 100)}/100 with ${pct(snapshot.revenueGrowth)} revenue growth — expanding well above the market.`,
    };
  }

  if (valuationR != null && valuationR >= 0.75 && qualityR != null && qualityR >= 0.45) {
    return {
      tag: "Deep Value",
      explanation: `Valuation bucket ${Math.round(valuationR * 100)}/100${snapshot.pegRatio != null ? ` (PEG ${ratio(snapshot.pegRatio)})` : ""} — trading cheap relative to underlying quality.`,
    };
  }

  if (qualityR != null && qualityR >= 0.70 && growthR != null && growthR >= 0.55 && healthR != null && healthR >= 0.55) {
    return {
      tag: "Compounder",
      explanation: `Quality ${Math.round(qualityR * 100)}/100, Growth ${Math.round(growthR * 100)}/100, and Financial Health ${Math.round(healthR * 100)}/100 all solid — durable compounding characteristics.`,
    };
  }

  if (growthR != null && growthR < 0.40 && trend === "up" && capAllocR != null && capAllocR >= 0.55) {
    return {
      tag: "Turnaround",
      explanation: `Growth still weak (${Math.round(growthR * 100)}/100) but capital allocation is improving (${Math.round(capAllocR * 100)}/100) with positive recent price momentum — early signs of a turn.`,
    };
  }

  if (snapshot.dividendYield != null && snapshot.dividendYield >= 0.025 && (growthR == null || growthR < 0.55)) {
    return {
      tag: "Income",
      explanation: `${pct(snapshot.dividendYield)} dividend yield with modest growth expectations — a shareholder-return-oriented holding.`,
    };
  }

  if (sector != null && CYCLICAL_SECTORS.has(sector)) {
    return {
      tag: "Cyclical",
      explanation: `${sector} is a cyclical sector — earnings and the stock typically track the broader economic cycle.`,
    };
  }

  if (sector != null && DEFENSIVE_SECTORS.has(sector) && trend !== "down") {
    return {
      tag: "Defensive",
      explanation: `${sector} tends to hold up in downturns; current momentum is ${trend === "up" ? "positive" : "stable"}, consistent with a defensive profile.`,
    };
  }

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

  // Valuation risk
  let valLevel: RiskLevel = "low";
  const valReasons: string[] = [];
  if (a.upsidePercent != null && a.upsidePercent < 0) {
    valLevel = worse(valLevel, "medium");
    valReasons.push(`${a.upsidePercent.toFixed(0)}% vs target`);
  }
  if (s.pegRatio != null && s.pegRatio > 2.5) {
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
    // Banks: only flag D/E > 15x as high, > 10x as medium
    if (s.debtToEquity != null && s.debtToEquity > 15) {
      finLevel = worse(finLevel, "high");
      finReasons.push(`D/E ${ratio(s.debtToEquity)} (very high for a bank)`);
    } else if (s.debtToEquity != null && s.debtToEquity > 10) {
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
