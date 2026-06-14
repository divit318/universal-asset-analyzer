import type {
  AnalystConsensus,
  DecisionSignals,
  FinancialStatements,
  FundamentalsSnapshot,
  HistoryPoint,
  InsiderActivity,
  MomentumSignal,
  Recommendation,
  RiskItem,
  RiskLevel,
  ScoreBucket,
  ScoreFactor,
  ScoreResult,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Linear score: maps `value` from `worst`→0 to `best`→max, clamped. */
function lerp(value: number, worst: number, best: number, max: number): number {
  const t = (value - worst) / (best - worst);
  return Math.max(0, Math.min(1, t)) * max;
}

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
/* Buckets                                                                    */
/* -------------------------------------------------------------------------- */

export function scoreValuation(s: FundamentalsSnapshot, a: AnalystConsensus) {
  const fwdRatio =
    s.forwardPE != null && s.trailingPE != null && s.trailingPE !== 0
      ? s.forwardPE / s.trailingPE
      : null;
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
  // Prefer EDGAR-derived FCF (operating CF − capex); Yahoo's freeCashflow field
  // is unreliable. Compare against the same year's net income.
  const latestNetIncome = st?.netIncome.at(-1)?.value ?? null;
  const latestFcf = st?.freeCashFlow.at(-1)?.value ?? s.freeCashflow ?? null;
  const fcfQuality =
    latestFcf != null && latestNetIncome != null && latestNetIncome !== 0
      ? latestFcf / latestNetIncome
      : null;
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
  return bucket("Growth", [
    mk("Revenue growth", s.revenueGrowth, 0, 0.2, 9, (v) => `Rev growth ${v >= 0 ? "+" : ""}${pct(v)}`),
    mk("Earnings growth", s.earningsGrowth, 0, 0.25, 8, (v) => `EPS growth ${v >= 0 ? "+" : ""}${pct(v)}`),
    mk("Revenue CAGR", st?.revenueCagr, 0, 0.2, 8, (v) => `Rev CAGR ${pct(v)}`),
  ]);
}

export function scoreHealth(s: FundamentalsSnapshot) {
  const netDebtToEbitda =
    s.totalDebt != null && s.totalCash != null && s.ebitda != null && s.ebitda !== 0
      ? (s.totalDebt - s.totalCash) / s.ebitda
      : null;
  return bucket("Financial health", [
    mk("Debt / equity", s.debtToEquity, 2, 0.2, 8, (v) => `D/E ${ratio(v)}`),
    mk("Current ratio", s.currentRatio, 0.8, 2, 6, (v) => `Current ${ratio(v)}`),
    mk("Net debt / EBITDA", netDebtToEbitda, 4, 0, 6, (v) => `Net debt/EBITDA ${ratio(v)}`),
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

/** Map the blended 0-100 composite to a 5-tier recommendation. */
function recommend(composite: number): Recommendation {
  if (composite >= 78) return "STRONG_BUY";
  if (composite >= 60) return "BUY";
  if (composite >= 42) return "HOLD";
  if (composite >= 25) return "SELL";
  return "STRONG_SELL";
}

const REC_LABEL: Record<Recommendation, string> = {
  STRONG_BUY: "Strong Buy",
  BUY: "Buy",
  HOLD: "Hold",
  SELL: "Sell",
  STRONG_SELL: "Strong Sell",
};

const TIER_EDGES = [25, 42, 60, 78];

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

  const parts: string[] = [`${REC_LABEL[rec]} — ${sig.join(", ")} (all /100).`];
  if (strengths.length) parts.push(`Strengths: ${strengths.map((f) => f.detail).join(", ")}.`);
  if (concerns.length) parts.push(`Watch: ${concerns.map((f) => f.detail).join(", ")}.`);
  return parts.join(" ");
}

export function computeScore(
  snapshot: FundamentalsSnapshot,
  statements: FinancialStatements | null,
  analyst: AnalystConsensus,
  momentum: MomentumSignal | null = null,
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
  const signals: DecisionSignals = { fundamentals: total, analysts, momentum: momentumScore };

  // Blend the available signals. Fundamentals anchor the call; analyst consensus
  // and price momentum refine it. Weights renormalize when a signal is missing.
  const weighted: [number, number][] = [[total, 0.5]];
  if (analysts != null) weighted.push([analysts, 0.3]);
  if (momentumScore != null) weighted.push([momentumScore, 0.2]);
  const wSum = weighted.reduce((s, [, w]) => s + w, 0);
  const composite = Math.round(weighted.reduce((s, [v, w]) => s + v * w, 0) / wSum);

  const rec = recommend(composite);

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
/* Risk heat map                                                              */
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
  if (s.revenueGrowth != null) {
    if (s.revenueGrowth < 0.03) {
      growthLevel = worse(growthLevel, "high");
      growthReasons.push(`rev growth ${pct(s.revenueGrowth)}`);
    } else if (s.revenueGrowth < 0.1) {
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

  // Financial risk
  let finLevel: RiskLevel = "low";
  const finReasons: string[] = [];
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
