/**
 * Portfolio Analytics Engine — pure, deterministic computation layer.
 *
 * All analytics here are computed from structured inputs: no network I/O,
 * no LLM calls. The AI layer receives these outputs and explains them; it
 * never invents the numbers. Every recommendation is derived from the
 * scoring / risk / optimization pipeline below.
 */

import { computeScore, computeMomentum } from "./scoring";
// NOTE: deliberately not importing from ./sector-rotation — that module
// statically imports ./db (node:sqlite), which is server-only and must never
// enter the client bundle. This file is imported by client components for
// its types/constants, so it must stay free of any db.ts-reaching import.
// The caller (API route) resolves the snapshot and passes it in as data.
// findSectorRotationEntry lives in ./sector-rotation-utils, a zero-I/O leaf
// module, specifically so this file can share the lookup logic safely.
import { findSectorRotationEntry } from "./sector-rotation-utils";
import type { SectorRotationSnapshot } from "./types";
import type {
  AnalystConsensus,
  FinancialStatements,
  FundamentalsSnapshot,
  HistoryPoint,
  MomentumSignal,
  PortfolioPosition,
  Quote,
  ScoreResult,
} from "./types";

/* ============================================================
   Portfolio Objective & Constraints (user-driven AI steering)
   ============================================================ */

export type PortfolioObjective =
  | "maximize_growth"
  | "reduce_risk"
  | "improve_diversification"
  | "increase_income"
  | "beat_benchmark"
  | "preserve_capital"
  | "ai_optimized";

export interface ObjectiveConfig {
  label: string;
  description: string;
  icon: string;
  color: string;
  activeColor: string;
}

export const OBJECTIVE_CONFIG: Record<PortfolioObjective, ObjectiveConfig> = {
  maximize_growth:         { label: "Maximize Growth",    description: "Focus on high-growth, high-momentum stocks",              icon: "↗", color: "border-border text-muted hover:border-positive/40 hover:text-positive",         activeColor: "border-positive/50 bg-positive/10 text-positive" },
  reduce_risk:             { label: "Reduce Risk",        description: "Prioritize defensive, low-volatility positions",          icon: "◉", color: "border-border text-muted hover:border-blue-400/40 hover:text-blue-400",          activeColor: "border-blue-400/50 bg-blue-400/10 text-blue-400" },
  improve_diversification: { label: "Diversify",         description: "Fill sector and factor gaps in the portfolio",            icon: "⊞", color: "border-border text-muted hover:border-accent/40 hover:text-accent",              activeColor: "border-accent/50 bg-accent/10 text-accent" },
  increase_income:         { label: "Increase Income",   description: "Prioritize high-dividend and income-generating assets",   icon: "$", color: "border-border text-muted hover:border-amber-400/40 hover:text-amber-400",        activeColor: "border-amber-400/50 bg-amber-400/10 text-amber-400" },
  beat_benchmark:          { label: "Beat Benchmark",    description: "Maximize alpha relative to SPY",                         icon: "⚡", color: "border-border text-muted hover:border-orange-400/40 hover:text-orange-400",      activeColor: "border-orange-400/50 bg-orange-400/10 text-orange-400" },
  preserve_capital:        { label: "Preserve Capital",  description: "Minimize drawdown risk, protect principal",              icon: "◈", color: "border-border text-muted hover:border-muted/60 hover:text-foreground",            activeColor: "border-border bg-surface-2 text-foreground" },
  ai_optimized:            { label: "AI Optimized",      description: "AI selects the optimal objective based on your profile", icon: "✦", color: "border-border text-muted hover:border-accent/50 hover:text-accent",              activeColor: "border-accent bg-accent/15 text-accent font-semibold" },
};

export interface PortfolioConstraints {
  maxPositionPct: number;      // max % allocation per single stock (default: 25)
  maxSectorPct: number;        // max % allocation per sector (default: 40)
  minCashPct: number;          // minimum cash reserve % (default: 2)
  excludedSymbols: string[];   // never-sell / avoid-buy list
  requireDividend: boolean;    // only recommend dividend payers (default: false)
  marketCapFilter: "any" | "large" | "mid" | "small";  // default: "any"
}

export const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  maxPositionPct: 25,
  maxSectorPct: 40,
  minCashPct: 2,
  excludedSymbols: [],
  requireDividend: false,
  marketCapFilter: "any",
};

export interface NewPositionRecommendation {
  symbol: string;
  name: string;
  currentPrice: number | null;
  marketCap: string | null;
  sector: string;
  reason: string;
  weaknessAddressed: string;
  expectedImpact: {
    diversification: "improves" | "neutral" | "reduces";
    risk: "reduces" | "neutral" | "increases";
    growthPotential: "high" | "medium" | "low";
    incomePotential: "high" | "medium" | "low";
  };
  suggestedAllocationPct: number;
  suggestedDollarAmount: number;
  confidenceScore: number;
  breakdown: {
    portfolioFitScore: number;
    fundamentalScore: number;
    technicalScore: number;
    valuationScore: number;
    momentumScore: number;
  };
  supportingFactors: string[];
  fromWatchlist: boolean;
  /** Watchlist Intelligence auto-promotion: crossed the "new opportunity" threshold before the AI was even asked. */
  autoQualified: boolean;
}

/* ============================================================
   External input types (what the API route provides)
   ============================================================ */

export interface PositionInput {
  position: PortfolioPosition;
  quote: Quote | null;
  snapshot: FundamentalsSnapshot | null;
  statements: FinancialStatements | null;
  analyst: AnalystConsensus | null;
  history: HistoryPoint[];   // daily closes, ascending
}

/* ============================================================
   Output types
   ============================================================ */

export type PortfolioAction =
  | "STRONG_BUY"
  | "INCREASE"
  | "HOLD"
  | "REDUCE"
  | "SELL";

const ACTION_LABEL: Record<PortfolioAction, string> = {
  STRONG_BUY: "Strong Buy",
  INCREASE:   "Increase",
  HOLD:       "Hold",
  REDUCE:     "Reduce",
  SELL:       "Sell",
};
export { ACTION_LABEL };

export type HealthGrade = "A" | "B" | "C" | "D" | "F";
export type ScoreTrend = "strong" | "good" | "neutral" | "weak" | "poor";

export interface HealthDimension {
  name: string;
  score: number;         // 0-100
  weight: number;        // 0-1
  trend: ScoreTrend;
  explanation: string;
}

export interface HealthScore {
  total: number;         // 0-100
  grade: HealthGrade;
  dimensions: HealthDimension[];
  summary: string;
}

export interface EnrichedPosition {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  price: number | null;
  value: number;
  costBasis: number;
  unrealizedPL: number | null;
  unrealizedPct: number | null;
  todayChangePct: number | null;
  todayChangeDollar: number | null;
  weight: number;        // % of total portfolio
  sector: string;
  score: ScoreResult | null;
  momentum: MomentumSignal | null;
  dividendYield: number | null;
  upsidePercent: number | null;
}

export interface SectorAllocation {
  sector: string;
  value: number;
  weight: number;
  positionCount: number;
  avgComposite: number | null;
}

export interface PositionRecommendation {
  symbol: string;
  name: string;
  action: PortfolioAction;
  confidence: number;       // 0-100
  currentWeight: number;    // %
  targetWeight: number;     // %
  delta: number;            // targetWeight - currentWeight, in %
  suggestedDollar: number;  // + = buy, - = sell
  suggestedShares: number | null;
  composite: number;        // 0-100
  fundamentalScore: number;
  analystScore: number | null;
  momentumScore: number | null;
  reasoning: string;
  keyMetrics: string[];
  catalysts: string[];
  risks: string[];
}

export interface Trade {
  symbol: string;
  name: string;
  action: "BUY" | "SELL";
  dollarAmount: number;
  sharesApprox: number | null;
  fromWeight: number;
  toWeight: number;
  reason: string;
}

export interface RebalanceProposal {
  trades: Trade[];
  sectorChanges: { sector: string; from: number; to: number }[];
  buyTotal: number;
  sellTotal: number;
  netCash: number;         // sell - buy (positive means cash freed)
  estimatedRiskReduction: number | null;  // % vol reduction
}

export interface MissingExposure {
  type: "sector" | "factor" | "geography" | "style";
  name: string;
  reason: string;
  priority: "high" | "medium" | "low";
  suggestedSymbols: string[];
}

export interface GapAnalysis {
  missing: MissingExposure[];
  overweight: { sector: string; currentWeight: number; reason: string }[];
  concentrationScore: number;   // 0-100, higher = better diversified
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][];
  highPairs: { a: string; b: string; r: number }[];
  avgCorrelation: number;
}

export interface FactorTilt {
  factor: string;
  score: number;   // -100 to +100, 0 = neutral market
  direction: "overweight" | "neutral" | "underweight";
  description: string;
}

export interface FactorExposure {
  tilts: FactorTilt[];
  topFactor: string;
  bottomFactor: string;
}

export interface RiskAnalytics {
  annualizedVolatility: number | null;   // % annualized
  beta: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;            // % negative
  var95Pct: number | null;              // 1-day VaR % at 95%
  var95Dollar: number | null;
  hhi: number;                          // Herfindahl index 0-10000
  topPositionWeight: number;            // %
  topSectorWeight: number;              // %
  concentrationRisk: "low" | "medium" | "high";
}

export interface ScenarioImpact {
  name: string;
  description: string;
  portfolioImpact: number;   // % change
  dollarImpact: number;
  worstHolding: string | null;
  bestHolding: string | null;
}

export interface BenchmarkResult {
  spyReturn1y: number | null;
  portfolioReturn: number;   // based on cost vs value
  alpha: number | null;
  relativePerformance: "outperforming" | "underperforming" | "in-line" | null;
}

export interface PortfolioAlert {
  type: "concentration" | "valuation" | "momentum" | "diversification" | "rebalance" | "risk";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  action: string;
  symbol?: string;
}

export interface OpportunityRank {
  symbol: string;
  name: string;
  rank: number;
  conviction: "high" | "medium" | "low";
  composite: number;
  action: PortfolioAction;
  upside: number | null;
  thesis: string;
  weight: number;
}

export interface CashAllocation {
  symbol: string;
  name: string;
  dollarAmount: number;
  shareCount: number | null;
  targetWeight: number;
  reason: string;
}

export interface PortfolioReport {
  generatedAt: string;
  positionCount: number;

  // P&L
  totalCost: number;
  totalValue: number;
  totalReturn: number;
  totalReturnDollar: number;
  todayChangeDollar: number;
  todayChangePct: number;

  // Core data
  positions: EnrichedPosition[];
  sectorAllocation: SectorAllocation[];
  concentrationWarnings: { type: "position" | "sector"; label: string; pct: number; message: string }[];

  // Analytics
  health: HealthScore;
  recommendations: PositionRecommendation[];
  rebalance: RebalanceProposal;
  gaps: GapAnalysis;
  risk: RiskAnalytics;
  factors: FactorExposure;
  scenarios: ScenarioImpact[];
  correlation: CorrelationMatrix | null;
  benchmark: BenchmarkResult | null;
  opportunities: OpportunityRank[];
  alerts: PortfolioAlert[];
}

/* ============================================================
   Pure math helpers

   mean/stddev/pearson/dailyReturns/maxDrawdown are exported (originally
   portfolio-only) because they're genuinely asset-agnostic — correlation,
   volatility, and drawdown math has no equity-specific assumption baked in.
   lib/crypto-scoring.ts reuses them rather than reimplementing the same
   formulas, the same reasoning that promoted mk()/bucket() to score-math.ts.
   ============================================================ */

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let cov = 0, varx = 0, vary = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy;
    varx += dx * dx;
    vary += dy * dy;
  }
  const denom = Math.sqrt(varx * vary);
  return denom === 0 ? 0 : clamp(cov / denom, -1, 1);
}

export function dailyReturns(history: HistoryPoint[]): number[] {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  const ret: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    ret.push(prev === 0 ? 0 : (closes[i] - prev) / prev);
  }
  return ret;
}

function portfolioReturns(
  positions: { weight: number; returns: number[] }[],
  dateCount: number,
): number[] {
  if (positions.length === 0 || dateCount < 2) return [];
  const result: number[] = new Array(dateCount).fill(0);
  for (const { weight, returns } of positions) {
    const w = weight / 100;
    for (let i = 0; i < Math.min(dateCount, returns.length); i++) {
      result[i] += w * returns[i];
    }
  }
  return result;
}

/**
 * Annualized Sharpe/Sortino from a daily *decimal* return series (0.001 = 0.1%).
 * The risk-free rate is annual decimal (default 4.25% T-bill) — converted to a
 * daily decimal before comparing against daily returns; mixing percent and
 * decimal units here previously produced Sharpe ratios ~100× too negative.
 * Exported for tests.
 */
export function computeRiskAdjustedRatios(
  portReturns: number[],
  annualRiskFree = 0.0425,
): { sharpe: number | null; sortino: number | null } {
  const dailyVol = stddev(portReturns);
  const avgDailyReturn = mean(portReturns);
  const dailyRiskFree = annualRiskFree / 252;

  const sharpe =
    dailyVol > 0
      ? ((avgDailyReturn - dailyRiskFree) / dailyVol) * Math.sqrt(252)
      : null;

  const downside = portReturns.filter((r) => r < dailyRiskFree);
  const downsideVol =
    stddev(downside.length >= 2 ? downside : portReturns) * Math.sqrt(252);
  const sortino =
    downsideVol > 0
      ? (avgDailyReturn * 252 - annualRiskFree) / downsideVol
      : null;

  return { sharpe, sortino };
}

export function maxDrawdown(returns: number[]): number {
  let peak = 1;
  let maxDD = 0;
  let value = 1;
  for (const r of returns) {
    value *= 1 + r;
    if (value > peak) peak = value;
    const dd = (value - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/* ============================================================
   Trend label helper
   ============================================================ */

function scoreTrend(score: number): ScoreTrend {
  if (score >= 78) return "strong";
  if (score >= 62) return "good";
  if (score >= 45) return "neutral";
  if (score >= 28) return "weak";
  return "poor";
}

function grade(score: number): HealthGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/* ============================================================
   HHI (Herfindahl-Hirschman Index)
   ============================================================ */

function computeHHI(weights: number[]): number {
  return weights.reduce((s, w) => s + (w / 100) ** 2, 0) * 10000;
}

/* ============================================================
   Target weight computation
   ============================================================ */

function computeTargetWeights(
  items: { symbol: string; composite: number }[],
  maxSinglePosition = 18,
): Map<string, number> {
  if (items.length === 0) return new Map();
  const base = 100 / items.length;

  // Score premium: ±0.2% per composite point relative to 50
  const raw = items.map(({ symbol, composite }) => {
    const premium = (composite - 50) * 0.2;
    return { symbol, w: clamp(base + premium, 1, maxSinglePosition) };
  });

  // Normalize to 100
  const total = raw.reduce((s, x) => s + x.w, 0);
  const map = new Map<string, number>();
  for (const { symbol, w } of raw) {
    map.set(symbol, (w / total) * 100);
  }
  return map;
}

/* ============================================================
   Health Score — 8 dimensions
   ============================================================ */

function diversificationDimension(
  positions: EnrichedPosition[],
  sectorAlloc: SectorAllocation[],
): HealthDimension {
  const n = positions.length;
  const sectorCount = sectorAlloc.length;
  const hhi = computeHHI(positions.map((p) => p.weight));

  // Scored from 0-100
  const posScore = clamp(n * 8, 0, 100);        // 12+ positions → 96
  const sectorScore = clamp(sectorCount * 13, 0, 100); // 8 sectors → 104→100
  const hhiScore = clamp(100 - (hhi - 800) / 60, 0, 100); // HHI<800→100, HHI>6800→0

  const score = Math.round((posScore * 0.3 + sectorScore * 0.4 + hhiScore * 0.3));
  const explanation = `${n} positions across ${sectorCount} sectors. HHI ${Math.round(hhi)} (${hhi < 1500 ? "well diversified" : hhi < 2500 ? "moderate concentration" : "high concentration"}).`;

  return { name: "Diversification", score, weight: 0.2, trend: scoreTrend(score), explanation };
}

function qualityDimension(positions: EnrichedPosition[]): HealthDimension {
  const scored = positions.filter(
    (p) => p.score?.buckets?.find((b) => b.name === "Quality"),
  );
  if (scored.length === 0) {
    return { name: "Quality", score: 50, weight: 0.15, trend: "neutral", explanation: "Insufficient data to score quality." };
  }
  let weightedSum = 0, weightSum = 0;
  for (const p of scored) {
    const bucket = p.score!.buckets.find((b) => b.name === "Quality");
    if (!bucket || bucket.max === 0) continue;
    const s = (bucket.points / bucket.max) * 100;
    weightedSum += s * p.weight;
    weightSum += p.weight;
  }
  const score = weightSum > 0 ? Math.round(weightedSum / weightSum) : 50;
  const top = scored.sort((a, b) => {
    const bA = a.score!.buckets.find((b) => b.name === "Quality")!;
    const bB = b.score!.buckets.find((b) => b.name === "Quality")!;
    return (bB.points / bB.max) - (bA.points / bA.max);
  })[0];
  return {
    name: "Quality",
    score,
    weight: 0.15,
    trend: scoreTrend(score),
    explanation: `Weighted quality score. Highest quality: ${top.symbol}.`,
  };
}

function growthDimension(positions: EnrichedPosition[]): HealthDimension {
  const scored = positions.filter(
    (p) => p.score?.buckets?.find((b) => b.name === "Growth"),
  );
  if (scored.length === 0) {
    return { name: "Growth", score: 50, weight: 0.12, trend: "neutral", explanation: "Insufficient data." };
  }
  let weightedSum = 0, weightSum = 0;
  for (const p of scored) {
    const bucket = p.score!.buckets.find((b) => b.name === "Growth");
    if (!bucket || bucket.max === 0) continue;
    const s = (bucket.points / bucket.max) * 100;
    weightedSum += s * p.weight;
    weightSum += p.weight;
  }
  const score = weightSum > 0 ? Math.round(weightedSum / weightSum) : 50;
  return {
    name: "Growth",
    score,
    weight: 0.12,
    trend: scoreTrend(score),
    explanation: `Portfolio-weighted growth score across ${scored.length} positions.`,
  };
}

function valuationDimension(positions: EnrichedPosition[]): HealthDimension {
  const scored = positions.filter(
    (p) => p.score?.buckets?.find((b) => b.name === "Valuation"),
  );
  if (scored.length === 0) {
    return { name: "Valuation", score: 50, weight: 0.10, trend: "neutral", explanation: "Insufficient data." };
  }
  let weightedSum = 0, weightSum = 0;
  for (const p of scored) {
    const bucket = p.score!.buckets.find((b) => b.name === "Valuation");
    if (!bucket || bucket.max === 0) continue;
    const s = (bucket.points / bucket.max) * 100;
    weightedSum += s * p.weight;
    weightSum += p.weight;
  }
  const score = weightSum > 0 ? Math.round(weightedSum / weightSum) : 50;
  const expensive = positions
    .filter((p) => {
      const b = p.score?.buckets.find((x) => x.name === "Valuation");
      return b && b.max > 0 && (b.points / b.max) < 0.4;
    })
    .map((p) => p.symbol);
  return {
    name: "Valuation",
    score,
    weight: 0.10,
    trend: scoreTrend(score),
    explanation: expensive.length
      ? `${expensive.slice(0, 2).join(", ")} appear stretched on valuation.`
      : "Portfolio valuation is broadly reasonable.",
  };
}

function financialHealthDimension(positions: EnrichedPosition[]): HealthDimension {
  const scored = positions.filter(
    (p) => p.score?.buckets?.find((b) => b.name === "Financial Health"),
  );
  if (scored.length === 0) {
    return { name: "Financial Health", score: 50, weight: 0.10, trend: "neutral", explanation: "Insufficient data." };
  }
  let weightedSum = 0, weightSum = 0;
  for (const p of scored) {
    const bucket = p.score!.buckets.find((b) => b.name === "Financial Health");
    if (!bucket || bucket.max === 0) continue;
    const s = (bucket.points / bucket.max) * 100;
    weightedSum += s * p.weight;
    weightSum += p.weight;
  }
  const score = weightSum > 0 ? Math.round(weightedSum / weightSum) : 50;
  return {
    name: "Financial Health",
    score,
    weight: 0.10,
    trend: scoreTrend(score),
    explanation: `Weighted balance sheet quality. Covers debt/equity, current ratio, and leverage.`,
  };
}

function riskDimension(
  positions: EnrichedPosition[],
  hhi: number,
  topPosPct: number,
  topSecPct: number,
): HealthDimension {
  const hhiScore = clamp(100 - (hhi - 800) / 60, 0, 100);
  const posRisk = clamp(100 - (topPosPct - 8) * 3, 0, 100); // 8% = 100, 40%+ = 0
  const secRisk = clamp(100 - (topSecPct - 25) * 2.5, 0, 100); // 25% = 100, 65%+ = 0
  const score = Math.round(hhiScore * 0.4 + posRisk * 0.3 + secRisk * 0.3);

  const issues: string[] = [];
  if (topPosPct > 20) issues.push(`${topPosPct.toFixed(0)}% in one position`);
  if (topSecPct > 40) issues.push(`${topSecPct.toFixed(0)}% in one sector`);

  return {
    name: "Risk",
    score,
    weight: 0.12,
    trend: scoreTrend(score),
    explanation: issues.length ? `Concentration risk: ${issues.join("; ")}.` : "Position and sector sizes are reasonable.",
  };
}

function incomeDimension(positions: EnrichedPosition[]): HealthDimension {
  const yieldPositions = positions.filter((p) => (p.dividendYield ?? 0) > 0);
  const weightedYield = positions.reduce((s, p) => {
    return s + (p.dividendYield ?? 0) * (p.weight / 100);
  }, 0);
  const score = Math.round(clamp(weightedYield * 20, 0, 100)); // 5% yield = 100
  const explanation = yieldPositions.length
    ? `Weighted portfolio yield: ${weightedYield.toFixed(2)}%. ${yieldPositions.length} income-paying positions.`
    : "No dividend income. Portfolio is growth-focused.";
  return { name: "Income", score, weight: 0.08, trend: scoreTrend(score), explanation };
}

function momentumDimension(positions: EnrichedPosition[]): HealthDimension {
  const withMom = positions.filter((p) => p.momentum != null);
  if (withMom.length === 0) {
    return { name: "Momentum", score: 50, weight: 0.13, trend: "neutral", explanation: "Insufficient price history." };
  }
  let weightedSum = 0, weightSum = 0;
  for (const p of withMom) {
    weightedSum += p.momentum!.score * p.weight;
    weightSum += p.weight;
  }
  const score = weightSum > 0 ? Math.round(weightedSum / weightSum) : 50;
  const trending = withMom.filter((p) => p.momentum?.trend === "up").map((p) => p.symbol);
  return {
    name: "Momentum",
    score,
    weight: 0.13,
    trend: scoreTrend(score),
    explanation: trending.length
      ? `${trending.slice(0, 3).join(", ")} showing positive momentum.`
      : "Momentum signals are mixed or negative.",
  };
}

function computeHealthScore(
  positions: EnrichedPosition[],
  sectorAlloc: SectorAllocation[],
  riskData: { hhi: number; topPosPct: number; topSecPct: number },
): HealthScore {
  const dimensions: HealthDimension[] = [
    diversificationDimension(positions, sectorAlloc),
    qualityDimension(positions),
    growthDimension(positions),
    valuationDimension(positions),
    financialHealthDimension(positions),
    riskDimension(positions, riskData.hhi, riskData.topPosPct, riskData.topSecPct),
    incomeDimension(positions),
    momentumDimension(positions),
  ];

  const total = Math.round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0),
  );
  const g = grade(total);
  const worstDim = dimensions.reduce((a, b) => (a.score < b.score ? a : b));
  const bestDim = dimensions.reduce((a, b) => (a.score > b.score ? a : b));
  const summary = `${g === "A" || g === "B" ? "Strong" : g === "C" ? "Solid" : "Weak"} portfolio. Best: ${bestDim.name} (${bestDim.score}/100). Needs work: ${worstDim.name} (${worstDim.score}/100).`;

  return { total, grade: g, dimensions, summary };
}

/* ============================================================
   Position Recommendations
   ============================================================ */

function classifyAction(
  composite: number,
  currentWeight: number,
  targetWeight: number,
): PortfolioAction {
  const delta = targetWeight - currentWeight;
  // Below target and strong score → increase
  if (composite >= 70 && delta > 2) return "INCREASE";
  if (composite >= 78 && delta > -1) return "STRONG_BUY";
  // Above target and weak score → reduce/sell
  if (composite < 30) return "SELL";
  if (composite < 42 && delta < -2) return "REDUCE";
  if (composite >= 42 && delta < -4) return "REDUCE";
  return "HOLD";
}

function buildReasoningText(
  p: EnrichedPosition,
  action: PortfolioAction,
  currentWeight: number,
  targetWeight: number,
): string {
  const score = p.score;
  if (!score) return `Composite score unavailable. ${ACTION_LABEL[action]} at ${currentWeight.toFixed(1)}% allocation.`;

  const conf = score.confidence;
  const delta = targetWeight - currentWeight;

  const parts: string[] = [
    `${ACTION_LABEL[action]} — composite score ${score.composite}/100 (${conf}% confidence).`,
  ];

  if (action === "INCREASE" || action === "STRONG_BUY") {
    parts.push(`Currently ${currentWeight.toFixed(1)}% vs ${targetWeight.toFixed(1)}% target — room to add.`);
  } else if (action === "REDUCE" || action === "SELL") {
    parts.push(
      delta < -5
        ? `Overweight at ${currentWeight.toFixed(1)}% vs ${targetWeight.toFixed(1)}% target.`
        : `Fundamental weakness warrants reducing exposure.`,
    );
  }

  if (score.rationale) parts.push(score.rationale);
  return parts.join(" ");
}

function buildKeyMetrics(p: EnrichedPosition, snapshot: FundamentalsSnapshot | null): string[] {
  const metrics: string[] = [];
  if (!snapshot) return metrics;
  if (snapshot.forwardPE != null) metrics.push(`Fwd P/E: ${snapshot.forwardPE.toFixed(1)}x`);
  if (snapshot.returnOnEquity != null) metrics.push(`ROE: ${(snapshot.returnOnEquity * 100).toFixed(1)}%`);
  if (snapshot.revenueGrowth != null) metrics.push(`Rev growth: ${(snapshot.revenueGrowth * 100).toFixed(1)}%`);
  if (snapshot.operatingMargins != null) metrics.push(`Op margin: ${(snapshot.operatingMargins * 100).toFixed(1)}%`);
  if (p.upsidePercent != null) metrics.push(`Analyst upside: ${p.upsidePercent >= 0 ? "+" : ""}${p.upsidePercent.toFixed(0)}%`);
  return metrics.slice(0, 4);
}

function buildCatalysts(p: EnrichedPosition, analyst: AnalystConsensus | null, rotationSnapshot: SectorRotationSnapshot | null): string[] {
  const cats: string[] = [];
  if (analyst && analyst.upsidePercent != null && analyst.upsidePercent > 10) {
    cats.push(`${analyst.upsidePercent.toFixed(0)}% analyst consensus upside to target`);
  }
  if (p.momentum?.trend === "up") cats.push("Positive price momentum — above 50-day and 200-day SMA");
  if (analyst && analyst.epsRevisionsUp30d != null && analyst.epsRevisionsUp30d > 2) {
    cats.push(`${analyst.epsRevisionsUp30d} upward EPS estimate revisions in 30 days`);
  }
  // Sector Rotation Engine: surface as a catalyst when the holding's sector is
  // strengthening — evidence for the Decision Engine, not a new scoring path.
  const rotation = findSectorRotationEntry(rotationSnapshot, p.sector);
  if (rotation && (rotation.classification === "leading" || rotation.classification === "strengthening")) {
    cats.push(`${p.sector} sector ${rotation.classification} — rank ${rotation.rank}/11 by relative strength`);
  }
  return cats.slice(0, 3);
}

function buildRisks(p: EnrichedPosition, snapshot: FundamentalsSnapshot | null, rotationSnapshot: SectorRotationSnapshot | null): string[] {
  const risks: string[] = [];
  if (p.weight > 15) risks.push(`High concentration: ${p.weight.toFixed(1)}% of portfolio`);
  if (snapshot?.pegRatio != null && snapshot.pegRatio > 3) risks.push(`Elevated PEG ratio: ${snapshot.pegRatio.toFixed(1)}`);
  if (p.momentum?.trend === "down") risks.push("Negative price momentum — below key moving averages");
  if (snapshot?.debtToEquity != null && snapshot.debtToEquity > 2) risks.push(`High leverage: D/E ${snapshot.debtToEquity.toFixed(1)}`);
  // Sector Rotation Engine: surface as a risk when the holding's sector is
  // losing relative strength — evidence for the Decision Engine's Reduce/Exit calls.
  const rotation = findSectorRotationEntry(rotationSnapshot, p.sector);
  if (rotation && (rotation.classification === "lagging" || rotation.classification === "weakening")) {
    risks.push(`${p.sector} sector ${rotation.classification} — rank ${rotation.rank}/11 by relative strength`);
  }
  return risks.slice(0, 3);
}

function computeRecommendations(
  positions: EnrichedPosition[],
  snapshots: Map<string, FundamentalsSnapshot | null>,
  analysts: Map<string, AnalystConsensus | null>,
  totalValue: number,
  rotationSnapshot: SectorRotationSnapshot | null,
): PositionRecommendation[] {
  const targetMap = computeTargetWeights(
    positions.map((p) => ({ symbol: p.symbol, composite: p.score?.composite ?? 50 })),
  );

  return positions.map((p) => {
    const target = targetMap.get(p.symbol) ?? p.weight;
    const delta = target - p.weight;
    const snap = snapshots.get(p.symbol) ?? null;
    const analyst = analysts.get(p.symbol) ?? null;
    const composite = p.score?.composite ?? 50;
    const action = classifyAction(composite, p.weight, target);

    const dollarDelta = (delta / 100) * totalValue;
    const shareCount = p.price != null && p.price > 0 ? Math.abs(dollarDelta) / p.price : null;

    return {
      symbol: p.symbol,
      name: p.name,
      action,
      confidence: p.score?.confidence ?? 40,
      currentWeight: p.weight,
      targetWeight: target,
      delta,
      suggestedDollar: dollarDelta,
      suggestedShares: shareCount != null ? Math.floor(shareCount) : null,
      composite,
      fundamentalScore: p.score?.total ?? 50,
      analystScore: p.score?.signals.analysts ?? null,
      momentumScore: p.score?.signals.momentum ?? null,
      reasoning: buildReasoningText(p, action, p.weight, target),
      keyMetrics: buildKeyMetrics(p, snap),
      catalysts: buildCatalysts(p, analyst, rotationSnapshot),
      risks: buildRisks(p, snap, rotationSnapshot),
    };
  });
}

/* ============================================================
   Rebalancing Engine
   ============================================================ */

function computeRebalance(
  positions: EnrichedPosition[],
  recommendations: PositionRecommendation[],
  sectorAlloc: SectorAllocation[],
): RebalanceProposal {
  const trades: Trade[] = recommendations
    .filter((r) => Math.abs(r.delta) > 1.5)   // > 1.5% delta = worth a trade
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((r) => {
      return {
        symbol: r.symbol,
        name: r.name,
        action: r.delta > 0 ? "BUY" : "SELL",
        dollarAmount: Math.abs(r.suggestedDollar),
        sharesApprox: r.suggestedShares,
        fromWeight: r.currentWeight,
        toWeight: r.targetWeight,
        reason:
          r.delta > 0
            ? `Score ${r.composite}/100 — increase to ${r.targetWeight.toFixed(1)}% target`
            : `Score ${r.composite}/100 — trim from ${r.currentWeight.toFixed(1)}% to ${r.targetWeight.toFixed(1)}%`,
      };
    });

  // Sector before/after from position weights
  const targetMap = new Map(recommendations.map((r) => [r.symbol, r.targetWeight]));
  const sectorBefore = new Map(sectorAlloc.map((s) => [s.sector, s.weight]));
  const sectorAfter = new Map<string, number>();
  for (const p of positions) {
    const t = targetMap.get(p.symbol) ?? p.weight;
    sectorAfter.set(p.sector, (sectorAfter.get(p.sector) ?? 0) + t);
  }
  const sectorChanges = [...sectorBefore.entries()]
    .filter(([sector]) => sectorAfter.has(sector))
    .map(([sector, from]) => ({ sector, from, to: sectorAfter.get(sector) ?? from }))
    .filter((c) => Math.abs(c.to - c.from) > 0.5)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

  const sells = trades.filter((t) => t.action === "SELL");
  const buys = trades.filter((t) => t.action === "BUY");
  const sellTotal = sells.reduce((s, t) => s + t.dollarAmount, 0);
  const buyTotal = buys.reduce((s, t) => s + t.dollarAmount, 0);

  // Rough risk reduction estimate from HHI improvement
  const hhiBefore = computeHHI(positions.map((p) => p.weight));
  const targetWeights = positions.map((p) => targetMap.get(p.symbol) ?? p.weight);
  const hhiAfter = computeHHI(targetWeights);
  const estimatedRiskReduction =
    hhiBefore > 0 ? clamp(((hhiBefore - hhiAfter) / hhiBefore) * 100 * 0.4, 0, 25) : null;

  return { trades, sectorChanges, buyTotal, sellTotal, netCash: sellTotal - buyTotal, estimatedRiskReduction };
}

/* ============================================================
   Gap Analysis
   ============================================================ */

export const ALL_SECTORS = [
  "Technology",
  "Healthcare",
  "Financials",
  "Consumer Staples",
  "Consumer Discretionary",
  "Energy",
  "Utilities",
  "Industrials",
  "Materials",
  "Real Estate",
  "Communication Services",
];

const SECTOR_RATIONALE: Record<string, { reason: string; priority: "high" | "medium" | "low"; symbols: string[] }> = {
  Healthcare:                { priority: "high",   reason: "Defensive growth with aging demographics tailwind. Low correlation to tech.", symbols: ["JNJ", "UNH", "LLY", "ABT", "MRK"] },
  Financials:                { priority: "high",   reason: "Rate-sensitive income. Banks benefit from higher-for-longer environment.", symbols: ["JPM", "BRK-B", "BAC", "V", "MA"] },
  "Consumer Staples":        { priority: "medium", reason: "Defensive ballast. Low beta, reliable dividends, outperforms in downturns.", symbols: ["PG", "KO", "WMT", "COST", "PEP"] },
  Energy:                    { priority: "medium", reason: "Inflation hedge. Diversification against tech drawdowns.", symbols: ["XOM", "CVX", "SLB", "EOG", "PSX"] },
  Utilities:                 { priority: "low",    reason: "Low volatility income. Undervalued when rates peak.", symbols: ["NEE", "DUK", "SO", "AEP", "XEL"] },
  Industrials:               { priority: "medium", reason: "Infrastructure and reshoring exposure. Cyclical upside.", symbols: ["CAT", "GE", "HON", "UPS", "DE"] },
  Materials:                 { priority: "low",    reason: "Commodity and inflation exposure. Diversifier.", symbols: ["LIN", "APD", "FCX", "NEM", "ALB"] },
  "Real Estate":             { priority: "low",    reason: "Dividend income. Inflation-linked rents. Interest-rate sensitive.", symbols: ["AMT", "PLD", "EQIX", "SPG", "O"] },
  "Consumer Discretionary":  { priority: "medium", reason: "Consumer spending cycle exposure. Growth when economy strong.", symbols: ["AMZN", "TSLA", "HD", "MCD", "NKE"] },
  "Communication Services":  { priority: "medium", reason: "Media, internet and telecom. Diversified digital exposure.", symbols: ["GOOG", "META", "NFLX", "DIS", "T"] },
  Technology:                { priority: "high",   reason: "Core growth engine. AI, cloud, semiconductors.", symbols: ["AAPL", "MSFT", "NVDA", "AVGO", "AMD"] },
};

function computeGapAnalysis(
  sectorAlloc: SectorAllocation[],
  positions: EnrichedPosition[],
): GapAnalysis {
  const covered = new Set(sectorAlloc.map((s) => s.sector));
  const hhi = computeHHI(positions.map((p) => p.weight));
  const concentrationScore = Math.round(clamp(100 - (hhi - 800) / 60, 0, 100));

  const missing: MissingExposure[] = ALL_SECTORS
    .filter((s) => !covered.has(s))
    .map((s) => {
      const meta = SECTOR_RATIONALE[s] ?? { priority: "low", reason: "Potential diversification benefit.", symbols: [] };
      return {
        type: "sector" as const,
        name: s,
        reason: meta.reason,
        priority: meta.priority,
        suggestedSymbols: meta.symbols,
      };
    })
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });

  const overweight = sectorAlloc
    .filter((s) => s.weight > 40)
    .map((s) => ({
      sector: s.sector,
      currentWeight: s.weight,
      reason: `${s.weight.toFixed(1)}% concentration exceeds the 40% guideline. Consider diversifying within ${s.sector} or into other sectors.`,
    }));

  return { missing, overweight, concentrationScore };
}

/* ============================================================
   Correlation Matrix
   ============================================================ */

function computeCorrelation(
  inputs: { symbol: string; history: HistoryPoint[] }[],
): CorrelationMatrix | null {
  const filtered = inputs.filter((i) => i.history.length >= 30);
  if (filtered.length < 2) return null;

  const returnsMap = new Map(
    filtered.map(({ symbol, history }) => [symbol, dailyReturns(history)]),
  );

  const symbols = filtered.map((i) => i.symbol);
  const n = symbols.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  let sumCorr = 0;
  let pairCount = 0;

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(returnsMap.get(symbols[i])!, returnsMap.get(symbols[j])!);
      matrix[i][j] = r;
      matrix[j][i] = r;
      sumCorr += r;
      pairCount++;
    }
  }

  const avgCorrelation = pairCount > 0 ? sumCorr / pairCount : 0;

  const highPairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matrix[i][j] > 0.75) {
        highPairs.push({ a: symbols[i], b: symbols[j], r: matrix[i][j] });
      }
    }
  }
  highPairs.sort((a, b) => b.r - a.r);

  return { symbols, matrix, highPairs: highPairs.slice(0, 5), avgCorrelation };
}

/* ============================================================
   Factor Exposure
   ============================================================ */

const SECTOR_FACTOR_MAP: Record<string, Record<string, number>> = {
  "Technology":             { Growth: 80, Innovation: 90, Quality: 65, Value: -20, Dividend: -30 },
  "Healthcare":             { Quality: 75, Growth: 50, Defensive: 70, Value: 30, Dividend: 20 },
  "Financials":             { Value: 60, Dividend: 55, Quality: 50, Growth: 30, LowVol: -10 },
  "Consumer Staples":       { Defensive: 90, Dividend: 70, LowVol: 75, Value: 40, Growth: 10 },
  "Consumer Discretionary": { Growth: 60, Cyclical: 70, Value: 10, Dividend: -10, LowVol: -30 },
  "Energy":                 { Value: 55, Dividend: 60, Cyclical: 65, Inflation: 80, Growth: 10 },
  "Utilities":              { Defensive: 85, Dividend: 80, LowVol: 80, Value: 35, Growth: -10 },
  "Industrials":            { Cyclical: 70, Value: 50, Growth: 40, Dividend: 30, LowVol: 10 },
  "Materials":              { Cyclical: 75, Inflation: 70, Value: 45, Dividend: 30, Growth: 30 },
  "Real Estate":            { Dividend: 75, Inflation: 60, LowVol: 40, Value: 30, Growth: 20 },
  "Communication Services": { Growth: 55, Innovation: 60, Value: 20, Dividend: 25, LowVol: -10 },
};

const FACTOR_LABELS: Record<string, string> = {
  Growth: "Growth",
  Innovation: "Innovation",
  Quality: "Quality",
  Value: "Value",
  Dividend: "Income",
  Defensive: "Defensive",
  LowVol: "Low Volatility",
  Cyclical: "Cyclical",
  Inflation: "Inflation Hedge",
};

function computeFactorExposure(positions: EnrichedPosition[]): FactorExposure {
  const factorSums = new Map<string, number>();
  const weightTotal = positions.reduce((s, p) => s + p.weight, 0);

  for (const p of positions) {
    const sectorMap = SECTOR_FACTOR_MAP[p.sector] ?? {};
    for (const [factor, raw] of Object.entries(sectorMap)) {
      const contribution = (raw / 100) * (p.weight / Math.max(weightTotal, 1)) * 100;
      factorSums.set(factor, (factorSums.get(factor) ?? 0) + contribution);
    }
  }

  // Also layer in individual position data for momentum, quality, value
  for (const p of positions) {
    if (p.momentum) {
      const momContrib = ((p.momentum.score - 50) / 50) * (p.weight / Math.max(weightTotal, 1)) * 30;
      factorSums.set("Growth", (factorSums.get("Growth") ?? 0) + momContrib);
    }
    if (p.score) {
      const qBucket = p.score.buckets.find((b) => b.name === "Quality");
      if (qBucket && qBucket.max > 0) {
        const qScore = (qBucket.points / qBucket.max - 0.5) * 2 * 20 * (p.weight / Math.max(weightTotal, 1));
        factorSums.set("Quality", (factorSums.get("Quality") ?? 0) + qScore);
      }
    }
    if ((p.dividendYield ?? 0) > 1.5) {
      const dContrib = Math.min(p.dividendYield! * 5, 20) * (p.weight / Math.max(weightTotal, 1));
      factorSums.set("Dividend", (factorSums.get("Dividend") ?? 0) + dContrib);
    }
  }

  const tilts: FactorTilt[] = [...factorSums.entries()]
    .filter(([f]) => FACTOR_LABELS[f])
    .map(([factor, raw]) => {
      const score = clamp(Math.round(raw), -100, 100);
      return {
        factor: FACTOR_LABELS[factor],
        score,
        direction: (score > 15 ? "overweight" : score < -15 ? "underweight" : "neutral") as FactorTilt["direction"],
        description:
          score > 15
            ? `Strong tilt — consider whether this is intentional`
            : score < -15
              ? `Low exposure — potential gap in this factor`
              : `Broadly market-neutral exposure`,
      };
    })
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 8);

  const topFactor = tilts.find((t) => t.score > 0)?.factor ?? "N/A";
  const bottomFactor = tilts.find((t) => t.score < 0)?.factor ?? "N/A";

  return { tilts, topFactor, bottomFactor };
}

/* ============================================================
   Risk Analytics
   ============================================================ */

function computeRiskAnalytics(
  positions: EnrichedPosition[],
  positionHistories: Map<string, HistoryPoint[]>,
  spyHistory: HistoryPoint[],
  totalValue: number,
): RiskAnalytics {
  const hhi = computeHHI(positions.map((p) => p.weight));
  const topPosPct = positions.length > 0 ? Math.max(...positions.map((p) => p.weight)) : 0;
  const topSecPct = (() => {
    const sMap = new Map<string, number>();
    for (const p of positions) sMap.set(p.sector, (sMap.get(p.sector) ?? 0) + p.weight);
    return sMap.size > 0 ? Math.max(...sMap.values()) : 0;
  })();

  const concentrationRisk: "low" | "medium" | "high" =
    hhi > 2500 || topPosPct > 25 ? "high"
    : hhi > 1500 || topPosPct > 15 ? "medium"
    : "low";

  // Build daily portfolio return series
  const hasHistory = positions.some((p) => (positionHistories.get(p.symbol)?.length ?? 0) >= 20);
  if (!hasHistory) {
    return {
      annualizedVolatility: null,
      beta: null,
      sharpeRatio: null,
      sortinoRatio: null,
      maxDrawdown: null,
      var95Pct: null,
      var95Dollar: null,
      hhi: Math.round(hhi),
      topPositionWeight: topPosPct,
      topSectorWeight: topSecPct,
      concentrationRisk,
    };
  }

  // Find dates with all positions present (or at least majority)
  const returnsPerPos: { weight: number; returns: number[] }[] = positions
    .map((p) => {
      const hist = positionHistories.get(p.symbol) ?? [];
      return { weight: p.weight, returns: dailyReturns(hist) };
    })
    .filter((x) => x.returns.length >= 20);

  if (returnsPerPos.length === 0) {
    return {
      annualizedVolatility: null, beta: null, sharpeRatio: null, sortinoRatio: null,
      maxDrawdown: null, var95Pct: null, var95Dollar: null,
      hhi: Math.round(hhi), topPositionWeight: topPosPct, topSectorWeight: topSecPct, concentrationRisk,
    };
  }

  const minLen = Math.min(...returnsPerPos.map((x) => x.returns.length));
  const portReturns = portfolioReturns(returnsPerPos, minLen);

  const annualizedVol = stddev(portReturns) * Math.sqrt(252) * 100;
  const { sharpe, sortino } = computeRiskAdjustedRatios(portReturns);

  const dd = maxDrawdown(portReturns);
  const var95 = Math.abs(quantile(portReturns, 0.05)) * 100;

  // Beta vs SPY
  let beta: number | null = null;
  if (spyHistory.length >= 20) {
    const spyRet = dailyReturns(spyHistory);
    const commonLen = Math.min(portReturns.length, spyRet.length);
    if (commonLen >= 10) {
      const port = portReturns.slice(-commonLen);
      const spy = spyRet.slice(-commonLen);
      const covPS = pearson(port, spy) * stddev(port) * stddev(spy);
      const varSpy = stddev(spy) ** 2;
      beta = varSpy > 0 ? covPS / varSpy : null;
    }
  }

  return {
    annualizedVolatility: annualizedVol > 0 ? Math.round(annualizedVol * 10) / 10 : null,
    beta: beta != null ? Math.round(beta * 100) / 100 : null,
    sharpeRatio: sharpe != null ? Math.round(sharpe * 100) / 100 : null,
    sortinoRatio: sortino != null ? Math.round(sortino * 100) / 100 : null,
    maxDrawdown: Math.round(dd * 10) / 10,
    var95Pct: Math.round(var95 * 100) / 100,
    var95Dollar: totalValue > 0 ? Math.round(var95 / 100 * totalValue) : null,
    hhi: Math.round(hhi),
    topPositionWeight: Math.round(topPosPct * 10) / 10,
    topSectorWeight: Math.round(topSecPct * 10) / 10,
    concentrationRisk,
  };
}

/* ============================================================
   Scenario Analysis
   ============================================================ */

const SCENARIOS: { name: string; description: string; shocks: Record<string, number> }[] = [
  {
    name: "2008 Financial Crisis",
    description: "Global financial system freeze, credit markets seize",
    shocks: {
      Financials: -73, Technology: -53, "Consumer Discretionary": -45,
      Energy: -54, Materials: -50, Industrials: -45, "Communication Services": -40,
      "Consumer Staples": -15, Healthcare: -23, Utilities: -29, "Real Estate": -70,
    },
  },
  {
    name: "COVID Crash (2020)",
    description: "Pandemic-driven economic shutdown",
    shocks: {
      Energy: -68, Financials: -44, "Consumer Discretionary": -38, Industrials: -37,
      Materials: -38, "Real Estate": -32, Technology: -26, "Communication Services": -20,
      Healthcare: -16, "Consumer Staples": -16, Utilities: -19,
    },
  },
  {
    name: "Rate Rise Cycle (2022)",
    description: "Rapid Fed rate hikes to combat 40-year inflation",
    shocks: {
      Technology: -36, "Communication Services": -40, "Consumer Discretionary": -38,
      "Real Estate": -28, Financials: -13, Industrials: -16, Materials: -14,
      Energy: 59, "Consumer Staples": -3, Healthcare: -6, Utilities: -2,
    },
  },
  {
    name: "AI / Semiconductor Bubble",
    description: "Valuation collapse in AI-driven tech names",
    shocks: {
      Technology: -55, "Communication Services": -45, "Consumer Discretionary": -20,
      Financials: -15, Industrials: -15, Materials: -10, "Real Estate": -10,
      Healthcare: -5, Energy: 10, "Consumer Staples": 5, Utilities: 5,
    },
  },
  {
    name: "Stagflation",
    description: "Inflation + recession — worst of both worlds",
    shocks: {
      Energy: 20, Materials: 15, "Consumer Staples": -10, Technology: -30,
      "Consumer Discretionary": -35, Financials: -25, Healthcare: -5,
      Industrials: -20, Utilities: -15, "Communication Services": -25, "Real Estate": -30,
    },
  },
];

/**
 * Sector Rotation Engine adjustment: a sector currently losing relative
 * strength (lagging/weakening) is more vulnerable to a downside shock than
 * the static historical coefficient assumes; a sector gaining strength
 * (leading/strengthening) is more resilient. Applied as a bounded multiplier
 * on negative shocks only — positive shocks (e.g. Energy in a rate-hike
 * scenario) are left as-is since rotation strength doesn't offset a genuine
 * sector-specific tailwind.
 */
function rotationAdjustedShock(
  baseShock: number,
  sector: string,
  rotationSnapshot: SectorRotationSnapshot | null,
): number {
  if (baseShock >= 0) return baseShock;
  const entry = findSectorRotationEntry(rotationSnapshot, sector);
  if (!entry) return baseShock;
  if (entry.classification === "lagging" || entry.classification === "weakening") return baseShock * 1.15;
  if (entry.classification === "leading" || entry.classification === "strengthening") return baseShock * 0.85;
  return baseShock;
}

/** Apply a shock map to positions and summarize the portfolio-wide impact. Reusable for both named and user-defined scenarios. */
function applyScenarioShocks(
  positions: EnrichedPosition[],
  totalValue: number,
  name: string,
  description: string,
  shocks: Record<string, number>,
  rotationSnapshot: SectorRotationSnapshot | null,
  defaultShock = -20,
): ScenarioImpact {
  let portfolioImpact = 0;
  let worstImpact = Infinity;
  let bestImpact = -Infinity;
  let worstHolding: string | null = null;
  let bestHolding: string | null = null;

  for (const p of positions) {
    const baseShock = shocks[p.sector] ?? defaultShock;
    const shock = rotationAdjustedShock(baseShock, p.sector, rotationSnapshot);
    const posImpact = shock * (p.weight / 100);
    portfolioImpact += posImpact;

    if (posImpact < worstImpact) { worstImpact = posImpact; worstHolding = p.symbol; }
    if (posImpact > bestImpact) { bestImpact = posImpact; bestHolding = p.symbol; }
  }

  return {
    name,
    description,
    portfolioImpact: Math.round(portfolioImpact * 10) / 10,
    dollarImpact: Math.round((portfolioImpact / 100) * totalValue),
    worstHolding,
    bestHolding,
  };
}

/** Compute a single user-defined scenario on demand (e.g. "what if Technology drops 30%?"). */
export function computeCustomScenario(
  positions: EnrichedPosition[],
  totalValue: number,
  shocks: Record<string, number>,
  name = "Custom Scenario",
  description = "User-defined sector shock",
  rotationSnapshot: SectorRotationSnapshot | null = null,
): ScenarioImpact {
  return applyScenarioShocks(positions, totalValue, name, description, shocks, rotationSnapshot);
}

function computeScenarios(
  positions: EnrichedPosition[],
  totalValue: number,
  rotationSnapshot: SectorRotationSnapshot | null,
): ScenarioImpact[] {
  return SCENARIOS.map((s) =>
    applyScenarioShocks(positions, totalValue, s.name, s.description, s.shocks, rotationSnapshot),
  );
}

/* ============================================================
   Smart Alerts
   ============================================================ */

function computeAlerts(
  positions: EnrichedPosition[],
  sectorAlloc: SectorAllocation[],
  risk: RiskAnalytics,
): PortfolioAlert[] {
  const alerts: PortfolioAlert[] = [];

  // Concentration alerts
  for (const p of positions) {
    if (p.weight > 20) {
      alerts.push({
        type: "concentration",
        severity: "high",
        title: `${p.symbol} is ${p.weight.toFixed(1)}% of portfolio`,
        description: `Single-stock concentration above 20% significantly amplifies idiosyncratic risk.`,
        action: `Consider trimming ${p.symbol} to under 15%`,
        symbol: p.symbol,
      });
    }
  }

  for (const s of sectorAlloc) {
    if (s.weight > 45) {
      alerts.push({
        type: "concentration",
        severity: "high",
        title: `${s.sector} is ${s.weight.toFixed(1)}% of portfolio`,
        description: `Sector concentration above 45% is high. A sector-specific downturn would have outsized impact.`,
        action: `Diversify into other sectors to reduce ${s.sector} exposure below 40%`,
      });
    } else if (s.weight > 35) {
      alerts.push({
        type: "concentration",
        severity: "medium",
        title: `${s.sector} approaching concentration limit (${s.weight.toFixed(1)}%)`,
        description: `${s.sector} exposure is elevated. Monitor sector risk.`,
        action: `Avoid adding further ${s.sector} exposure until weight reduces`,
      });
    }
  }

  // Risk alerts
  if (risk.beta != null && risk.beta > 1.5) {
    alerts.push({
      type: "risk",
      severity: "medium",
      title: `High portfolio beta (${risk.beta.toFixed(2)})`,
      description: `Portfolio amplifies market moves by ${((risk.beta - 1) * 100).toFixed(0)}%. Significant downside in a market correction.`,
      action: "Add defensive positions (Healthcare, Consumer Staples, Utilities) to reduce beta",
    });
  }

  // Momentum alerts
  const negMomentum = positions.filter((p) => p.momentum?.trend === "down" && p.weight > 5);
  for (const p of negMomentum.slice(0, 2)) {
    alerts.push({
      type: "momentum",
      severity: "low",
      title: `${p.symbol} showing negative momentum`,
      description: `Price trend is below key moving averages. ${p.weight.toFixed(1)}% portfolio weight.`,
      action: `Review thesis for ${p.symbol}. Consider reducing if fundamentals also weakening.`,
      symbol: p.symbol,
    });
  }

  // Diversification alerts
  const sectorCount = sectorAlloc.length;
  if (sectorCount <= 2 && positions.length >= 5) {
    alerts.push({
      type: "diversification",
      severity: "high",
      title: `Only ${sectorCount} ${sectorCount === 1 ? "sector" : "sectors"} represented`,
      description: "Portfolio lacks sector diversification. A single sector shock could severely impair returns.",
      action: "Add exposure to Healthcare, Financials, or Consumer Staples",
    });
  } else if (sectorCount === 3 && positions.length >= 6) {
    alerts.push({
      type: "diversification",
      severity: "medium",
      title: `Only 3 sectors represented`,
      description: "Portfolio is concentrated in 3 sectors. Consider broadening exposure to reduce correlated sector risk.",
      action: "Add exposure to Healthcare, Financials, Energy, or Consumer Staples",
    });
  }

  // Rebalancing alert
  const driftPositions = positions.filter((p) => p.weight > 20 || (p.weight < 2 && p.weight > 0));
  if (driftPositions.length >= 2) {
    alerts.push({
      type: "rebalance",
      severity: "medium",
      title: "Portfolio needs rebalancing",
      description: `${driftPositions.length} positions have drifted significantly from their target weights.`,
      action: "Review the Rebalancing tab for specific trade recommendations",
    });
  }

  // Sort by severity
  const order = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8);
}

/* ============================================================
   Opportunity Ranking
   ============================================================ */

function computeOpportunities(
  positions: EnrichedPosition[],
  recommendations: PositionRecommendation[],
): OpportunityRank[] {
  const recMap = new Map(recommendations.map((r) => [r.symbol, r]));

  return positions
    .map((p) => {
      const rec = recMap.get(p.symbol);
      const composite = p.score?.composite ?? 50;
      const conviction: "high" | "medium" | "low" =
        (p.score?.confidence ?? 0) >= 70 ? "high"
        : (p.score?.confidence ?? 0) >= 50 ? "medium"
        : "low";
      const action = rec?.action ?? "HOLD";
      const thesis =
        p.score?.rationale
          ? p.score.rationale.split(".")[0]
          : `${p.symbol} — fundamentals score ${composite}/100`;

      return {
        symbol: p.symbol,
        name: p.name,
        rank: 0,
        conviction,
        composite,
        action,
        upside: p.upsidePercent,
        thesis,
        weight: p.weight,
      };
    })
    .sort((a, b) => {
      // Sort by composite score descending, break ties by action urgency
      const actionOrder = { STRONG_BUY: 0, INCREASE: 1, HOLD: 2, REDUCE: 3, SELL: 4 };
      if (Math.abs(b.composite - a.composite) > 3) return b.composite - a.composite;
      return actionOrder[a.action] - actionOrder[b.action];
    })
    .map((o, i) => ({ ...o, rank: i + 1 }));
}

/* ============================================================
   Invest New Cash
   ============================================================ */

export function computeCashAllocation(
  cashAmount: number,
  report: PortfolioReport,
): CashAllocation[] {
  // Allocate new cash proportionally to recommended increases, capped by target weight gap
  const buys = report.recommendations
    .filter((r) => r.action === "INCREASE" || r.action === "STRONG_BUY")
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 5);

  if (buys.length === 0) {
    // Fall back to top-scoring positions. Weights are normalized against however
    // many positions are actually available (< 3 when the portfolio is that small)
    // so the fallback always allocates the full cash amount rather than a fraction.
    const sorted = [...report.positions].sort((a, b) => (b.score?.composite ?? 0) - (a.score?.composite ?? 0));
    const top = sorted.slice(0, 3);
    const rawShares = [0.5, 0.3, 0.2].slice(0, top.length);
    const shareTotal = rawShares.reduce((s, w) => s + w, 0);
    const fractions = rawShares.map((w) => w / shareTotal);
    return top.map((p, i) => {
      const share = cashAmount * fractions[i];
      return {
        symbol: p.symbol,
        name: p.name,
        dollarAmount: share,
        shareCount: p.price ? Math.floor(share / p.price) : null,
        targetWeight: p.weight + (share / (report.totalValue + cashAmount)) * 100,
        reason: `Highest composite score (${p.score?.composite ?? 0}/100) among held positions`,
      };
    });
  }

  // Weight by a blend of "room to target" (delta) and conviction (composite score).
  // classifyAction grants STRONG_BUY down to delta > -1 (a high-conviction name can be
  // at/slightly above its target weight), so delta alone can be <= 0 for an included
  // buy — floor it at 0.5pp so a STRONG_BUY never gets zeroed out of its own allocation.
  const weights = buys.map((r) => Math.max(0.5, r.delta) * (r.composite / 100));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  return buys.map((r, i) => {
    const frac = totalWeight > 0 ? weights[i] / totalWeight : 1 / buys.length;
    const dollarAmount = Math.round(cashAmount * frac * 100) / 100;
    const pos = report.positions.find((p) => p.symbol === r.symbol);
    return {
      symbol: r.symbol,
      name: r.name,
      dollarAmount,
      shareCount: pos?.price ? Math.floor(dollarAmount / pos.price) : null,
      targetWeight: r.currentWeight + (dollarAmount / (report.totalValue + cashAmount)) * 100,
      reason: r.reasoning.split(".")[0],
    };
  });
}

/* ============================================================
   Main Orchestrator
   ============================================================ */

export function computePortfolioReport(
  inputs: PositionInput[],
  spyHistory: HistoryPoint[],
  spyReturn1y: number | null,
  rotationSnapshot: SectorRotationSnapshot | null = null,
): PortfolioReport {
  const now = new Date().toISOString();

  if (inputs.length === 0) {
    return {
      generatedAt: now,
      positionCount: 0,
      totalCost: 0,
      totalValue: 0,
      totalReturn: 0,
      totalReturnDollar: 0,
      todayChangeDollar: 0,
      todayChangePct: 0,
      positions: [],
      sectorAllocation: [],
      concentrationWarnings: [],
      health: { total: 0, grade: "F", dimensions: [], summary: "No positions." },
      recommendations: [],
      rebalance: { trades: [], sectorChanges: [], buyTotal: 0, sellTotal: 0, netCash: 0, estimatedRiskReduction: null },
      gaps: { missing: [], overweight: [], concentrationScore: 0 },
      risk: { annualizedVolatility: null, beta: null, sharpeRatio: null, sortinoRatio: null, maxDrawdown: null, var95Pct: null, var95Dollar: null, hhi: 0, topPositionWeight: 0, topSectorWeight: 0, concentrationRisk: "low" },
      factors: { tilts: [], topFactor: "", bottomFactor: "" },
      scenarios: [],
      correlation: null,
      benchmark: null,
      opportunities: [],
      alerts: [],
    };
  }

  // ---- Enrich positions ----
  let totalCost = 0;
  let totalCostWithPrices = 0;  // cost basis of only positions with live quotes
  let totalValue = 0;
  let todayChangeDollar = 0;

  const rawPositions = inputs.map(({ position, quote, snapshot, statements, analyst, history }) => {
    const cost = position.shares * position.avgCost;
    const price = quote?.price ?? null;
    // Positions without a live price are valued at cost (contributes 0 to P&L)
    const value = price != null ? position.shares * price : cost;
    const unrealizedPL = price != null ? value - cost : null;
    const unrealizedPct = cost > 0 && unrealizedPL != null ? (unrealizedPL / cost) * 100 : null;
    const todayChgPct = quote?.changePercent ?? null;
    const todayChgDollar = price != null && todayChgPct != null
      ? position.shares * price * (todayChgPct / 100) : null;

    totalCost += cost;
    if (price != null) totalCostWithPrices += cost;
    totalValue += value;
    if (todayChgDollar) todayChangeDollar += todayChgDollar;

    const momentum = computeMomentum(history);
    let score: ScoreResult | null = null;
    if (snapshot && analyst) {
      try {
        score = computeScore(snapshot, statements, analyst, momentum);
      } catch {
        score = null;
      }
    }

    return {
      symbol: position.symbol,
      name: position.name,
      shares: position.shares,
      avgCost: position.avgCost,
      price,
      value,
      costBasis: cost,
      unrealizedPL,
      unrealizedPct,
      todayChangePct: todayChgPct,
      todayChangeDollar: todayChgDollar,
      weight: 0,   // filled in below
      sector: snapshot?.sector ?? (quote?.name?.includes("ETF") ? "ETF" : "Unknown"),
      score,
      momentum,
      dividendYield: snapshot?.dividendYield ? snapshot.dividendYield * 100 : null,
      upsidePercent: analyst?.upsidePercent ?? null,
    } satisfies Omit<EnrichedPosition, "weight"> & { weight: number };
  });

  // Assign weights
  const positions: EnrichedPosition[] = rawPositions.map((p) => ({
    ...p,
    weight: totalValue > 0 ? (p.value / totalValue) * 100 : 0,
    sector: p.sector || "Unknown",
  }));

  // ---- Sector allocation ----
  const sectorMap = new Map<string, { value: number; count: number; composites: number[] }>();
  for (const p of positions) {
    const ex = sectorMap.get(p.sector) ?? { value: 0, count: 0, composites: [] };
    ex.value += p.value;
    ex.count++;
    if (p.score) ex.composites.push(p.score.composite);
    sectorMap.set(p.sector, ex);
  }
  const sectorAllocation: SectorAllocation[] = [...sectorMap.entries()]
    .map(([sector, { value, count, composites }]) => ({
      sector,
      value,
      weight: totalValue > 0 ? (value / totalValue) * 100 : 0,
      positionCount: count,
      avgComposite: composites.length > 0 ? Math.round(mean(composites)) : null,
    }))
    .sort((a, b) => b.weight - a.weight);

  // ---- Concentration warnings ----
  const concentrationWarnings: PortfolioReport["concentrationWarnings"] = [];
  for (const p of positions) {
    if (p.weight >= 25) {
      concentrationWarnings.push({
        type: "position",
        label: p.symbol,
        pct: p.weight,
        message: `${p.symbol} is ${p.weight.toFixed(1)}% of your portfolio — single-stock concentration risk`,
      });
    }
  }
  for (const s of sectorAllocation) {
    if (s.weight >= 40 && s.sector !== "Unknown") {
      concentrationWarnings.push({
        type: "sector",
        label: s.sector,
        pct: s.weight,
        message: `${s.sector} is ${s.weight.toFixed(1)}% of your portfolio — sector concentration risk`,
      });
    }
  }

  // ---- Risk inputs ----
  const positionHistories = new Map(inputs.map(({ position, history }) => [position.symbol, history]));
  const hhi = computeHHI(positions.map((p) => p.weight));
  const topPosPct = positions.length ? Math.max(...positions.map((p) => p.weight)) : 0;
  const topSecPct = sectorAllocation.length ? sectorAllocation[0].weight : 0;

  // ---- Core analytics ----
  const snapshots = new Map(inputs.map(({ position, snapshot }) => [position.symbol, snapshot]));
  const analysts = new Map(inputs.map(({ position, analyst }) => [position.symbol, analyst]));

  const risk = computeRiskAnalytics(positions, positionHistories, spyHistory, totalValue);
  const health = computeHealthScore(positions, sectorAllocation, { hhi, topPosPct, topSecPct });
  const recommendations = computeRecommendations(positions, snapshots, analysts, totalValue, rotationSnapshot);
  const rebalance = computeRebalance(positions, recommendations, sectorAllocation);
  const gaps = computeGapAnalysis(sectorAllocation, positions);
  const factors = computeFactorExposure(positions);
  const scenarios = computeScenarios(positions, totalValue, rotationSnapshot);
  const correlation = computeCorrelation(
    inputs.map(({ position, history }) => ({ symbol: position.symbol, history })),
  );
  const opportunities = computeOpportunities(positions, recommendations);
  const alerts = computeAlerts(positions, sectorAllocation, risk);

  // Use cost of positions with live prices as denominator so % matches the $ P&L shown
  const totalReturn = totalCostWithPrices > 0 ? ((totalValue - totalCost) / totalCostWithPrices) * 100 : 0;
  const todayChangePct = totalValue > 0 ? (todayChangeDollar / totalValue) * 100 : 0;

  const benchmark: BenchmarkResult | null = spyReturn1y != null
    ? {
        spyReturn1y,
        portfolioReturn: totalReturn,
        alpha: totalReturn - spyReturn1y,
        relativePerformance:
          totalReturn > spyReturn1y + 2 ? "outperforming"
          : totalReturn < spyReturn1y - 2 ? "underperforming"
          : "in-line",
      }
    : null;

  return {
    generatedAt: now,
    positionCount: positions.length,
    totalCost,
    totalValue,
    totalReturn,
    totalReturnDollar: totalValue - totalCost,
    todayChangeDollar,
    todayChangePct,
    positions,
    sectorAllocation,
    concentrationWarnings,
    health,
    recommendations,
    rebalance,
    gaps,
    risk,
    factors,
    scenarios,
    correlation,
    benchmark,
    opportunities,
    alerts,
  };
}
