import type {
  AnalystConsensus,
  FinancialStatements,
  FundamentalsSnapshot,
  InsiderActivity,
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
/* Composite                                                                  */
/* -------------------------------------------------------------------------- */

function recommend(total: number): Recommendation {
  if (total >= 70) return "BUY";
  if (total >= 45) return "HOLD";
  return "SELL";
}

function keyToRec(key: string | null): Recommendation | null {
  if (!key) return null;
  if (key === "strong_buy" || key === "buy") return "BUY";
  if (key === "hold") return "HOLD";
  if (key === "sell" || key === "strong_sell" || key === "underperform") return "SELL";
  return null;
}

function buildRationale(rec: Recommendation, total: number, buckets: ScoreBucket[]): string {
  const factors = buckets.flatMap((b) => b.factors).filter((f) => f.detail !== "n/a");
  const byRatio = [...factors].sort((a, b) => b.points / b.max - a.points / a.max);
  const strengths = byRatio.filter((f) => f.points / f.max >= 0.6).slice(0, 2);
  const concerns = [...byRatio].reverse().filter((f) => f.points / f.max <= 0.4).slice(0, 2);

  const parts: string[] = [`${rec} — score ${total}/100.`];
  if (strengths.length) parts.push(`Strengths: ${strengths.map((f) => f.detail).join(", ")}.`);
  if (concerns.length) parts.push(`Watch: ${concerns.map((f) => f.detail).join(", ")}.`);
  return parts.join(" ");
}

export function computeScore(
  snapshot: FundamentalsSnapshot,
  statements: FinancialStatements | null,
  analyst: AnalystConsensus,
): ScoreResult {
  const parts = [
    scoreValuation(snapshot, analyst),
    scoreQuality(snapshot, statements),
    scoreGrowth(snapshot, statements),
    scoreHealth(snapshot),
  ];
  const buckets = parts.map((p) => p.bucket);
  const total = Math.round(buckets.reduce((s, b) => s + b.points, 0));
  const rec = recommend(total);

  // Confidence: data completeness + clarity of the decision + analyst agreement.
  const dataCount = parts.reduce((s, p) => s + p.dataCount, 0);
  const factorCount = parts.reduce((s, p) => s + p.total, 0);
  const completeness = factorCount ? dataCount / factorCount : 0;
  const boundaryDist = Math.min(Math.abs(total - 45), Math.abs(total - 70));
  const clarity = Math.min(1, boundaryDist / 20);
  const analystRec = keyToRec(analyst.recommendationKey);
  const agree = analystRec == null ? 0.5 : analystRec === rec ? 1 : 0;
  const confidence = Math.round(
    Math.min(95, 50 + completeness * 25 + clarity * 15 + agree * 10),
  );

  return {
    total,
    buckets,
    recommendation: rec,
    confidence,
    rationale: buildRationale(rec, total, buckets),
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
