/**
 * IC Pipeline — Stage 5: Valuation adjudication.
 *
 * This stage no longer produces an intrinsic value. The ValuationCase does
 * (lib/valuation/), and it is persisted, versioned and correctable by the user;
 * a second estimate narrated here would be a competing answer to the one
 * question the case exists to own, and an unfalsifiable one at that.
 *
 * What this stage does instead:
 *   1. Reports the case's own fair value, range and margin of safety.
 *   2. Runs cross-checks that are genuinely *different lenses*, not DCF copies:
 *      relative multiples vs peers, dividend/earnings yield, and sum-of-the-parts
 *      for conglomerates. These triangulate the case; they do not replace it.
 *   3. Adjudicates — states where it agrees with the case and where it does not,
 *      and which assumption is weakest.
 *   4. Reconciles the case against the quant engine's Monte Carlo prior when one
 *      is available.
 */

import { runPrompt } from "./ai";
import { extractJsonObject } from "./json-extract";
import type { FundamentalsSnapshot, FinancialStatements, AnalystConsensus } from "./types";
import { summarizeCase, type ValuationCase } from "./valuation/case";
import type { ScreenerInCompany } from "./screener-in";

/* ─── FX context helpers ─────────────────────────────────────────────── */

const FX_CONGLOMERATE_NAMES = [
  "tata", "reliance", "adani", "mahindra", "bajaj", "birla", "godrej", "hinduja",
  "ltimindtree", "l&t", "larsen", "itc", "vedanta", "jsw", "suzlon",
];

function detectFxExposure(symbol: string, companyName: string): "exporter" | "importer" | "none" {
  const name = (companyName + " " + symbol).toLowerCase();
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) {
    // Crude sector heuristic from symbol prefix
    const it = ["infy", "tcs", "wipro", "hcl", "tech", "ltimind", "mphasis", "coforge", "persistent", "hexaware"];
    const pharma = ["cipla", "sunpharma", "drreddy", "lupin", "biocon", "aurobindo", "divi", "alkem"];
    const energy = ["iocl", "bpcl", "hpcl", "ongc", "reliance", "adanigreen", "adanipower", "powergrid"];
    if (it.some((s) => name.includes(s)) || pharma.some((s) => name.includes(s))) return "exporter";
    if (energy.some((s) => name.includes(s))) return "importer";
  }
  return "none";
}

function isConglomerate(symbol: string, companyName: string): boolean {
  const name = (companyName + " " + symbol).toLowerCase();
  return FX_CONGLOMERATE_NAMES.some((n) => name.includes(n));
}

async function fetchLiveUsdInr(): Promise<number | null> {
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const q = await yf.quote("INR=X") as { regularMarketPrice?: number };
    return q.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

/* ─── Run Hot / Cold percentile helper ──────────────────────────────── */

export interface HistoricalReturnWindow {
  years: number;
  return: number;           // CAGR % over this window
  available: boolean;
  percentile?: number;      // percentile of current CAGR vs rolling history of same window
  signal?: "run_hot" | "run_cold" | "neutral";
}

/** Compute rolling CAGR percentile for a given window length (in trading days). */
function rollingCagrPercentile(
  sorted: { date: string; close: number }[],
  windowDays: number,
  stepDays = 63,
): { cagr: number; percentile: number } | null {
  const n = sorted.length;
  if (n < windowDays + stepDays) return null;
  const years = windowDays / 252;
  const current = sorted[n - 1].close;
  const startCurrent = sorted[n - 1 - windowDays].close;
  if (!startCurrent || startCurrent <= 0) return null;
  const currentCagr = (Math.pow(current / startCurrent, 1 / years) - 1) * 100;

  const rolling: number[] = [];
  for (let i = n - 1; i >= windowDays; i -= stepDays) {
    const end = sorted[i].close;
    const start = sorted[i - windowDays].close;
    if (start > 0) rolling.push((Math.pow(end / start, 1 / years) - 1) * 100);
  }
  if (rolling.length < 3) return null;

  const sortedRolling = [...rolling].sort((a, b) => a - b);
  const below = sortedRolling.filter((r) => r <= currentCagr).length;
  const percentile = Math.round((below / sortedRolling.length) * 100);
  return { cagr: Math.round(currentCagr * 10) / 10, percentile };
}

/**
 * Given daily closes (any length — handles recent IPOs gracefully), compute:
 * - Rolling CAGR percentile per window (1Y/3Y/5Y/10Y/15Y/20Y) vs own rolling history
 * - Primary signal driven by longest available window with ≥3 rolling observations
 * - Gracefully degrades: IPO with <252 days gets only since-IPO total return, no percentile
 * Returns null only if fewer than 21 trading days (no meaningful data at all).
 */
export function computeRunHotCold(dailyCloses: { date: string; close: number }[]): {
  oneYearReturn: number;
  medianReturn: number;
  percentile: number;
  signal: "run_hot" | "run_cold" | "neutral";
  historicalWindows: HistoricalReturnWindow[];
} | null {
  if (dailyCloses.length < 21) return null;
  const sorted = [...dailyCloses].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const tradingDaysPerYear = 252;

  // Compute CAGR + per-window percentile for each window
  const WINDOWS = [1, 3, 5, 10, 15, 20];
  const historicalWindows: HistoricalReturnWindow[] = WINDOWS.map((yrs) => {
    const windowDays = yrs * tradingDaysPerYear;
    if (windowDays >= n) return { years: yrs, return: 0, available: false };
    const result = rollingCagrPercentile(sorted, windowDays);
    if (!result) return { years: yrs, return: 0, available: false };
    const sig: "run_hot" | "run_cold" | "neutral" =
      result.percentile >= 80 ? "run_hot" : result.percentile <= 20 ? "run_cold" : "neutral";
    return { years: yrs, return: result.cagr, available: true, percentile: result.percentile, signal: sig };
  });

  // Derive oneYearReturn: use 1Y window if available, else since-IPO total return
  const oneYearWindow = historicalWindows.find((w) => w.available && w.years === 1);
  const last = sorted[n - 1].close;
  const first = sorted[0].close;
  const sinceIpoReturn = first > 0 ? Math.round(((last - first) / first) * 100 * 10) / 10 : 0;
  const oneYearReturn = oneYearWindow ? oneYearWindow.return * (1 / 1) : sinceIpoReturn; // 1Y is already annualised CAGR

  // Rolling 1-year returns for medianReturn (only when ≥ 1Y of data)
  const annualReturns: number[] = [];
  if (n >= tradingDaysPerYear) {
    for (let i = n - 1; i >= tradingDaysPerYear; i -= 63) {
      const end = sorted[i].close;
      const start = sorted[i - tradingDaysPerYear].close;
      if (start > 0) annualReturns.push((end - start) / start * 100);
    }
  }
  const sortedReturns = annualReturns.length >= 3 ? [...annualReturns].sort((a, b) => a - b) : [];
  const medianReturn = sortedReturns.length > 0
    ? sortedReturns[Math.floor(sortedReturns.length / 2)]
    : sinceIpoReturn;

  // Primary signal: longest available window with a percentile (≥5Y → ≥3Y → ≥1Y)
  const primaryWindow =
    historicalWindows.find((w) => w.available && w.percentile != null && w.years === 5) ??
    historicalWindows.find((w) => w.available && w.percentile != null && w.years === 3) ??
    historicalWindows.find((w) => w.available && w.percentile != null && w.years === 1);

  const percentile = primaryWindow?.percentile ??
    (sortedReturns.length > 0
      ? Math.round((sortedReturns.filter((r) => r <= oneYearReturn).length / sortedReturns.length) * 100)
      : 50); // neutral fallback for very new companies
  const signal: "run_hot" | "run_cold" | "neutral" =
    percentile >= 80 ? "run_hot" : percentile <= 20 ? "run_cold" : "neutral";

  return { oneYearReturn, medianReturn, percentile, signal, historicalWindows };
}

export interface ValuationScenario {
  label: string;
  priceTarget: string; // e.g. "$185–$210" or "₹1,450–₹1,600"
  impliedUpside: string; // e.g. "+18%" or "-5%"
  keyAssumptions: string[];
}

export interface ValuationApproach {
  method: string;
  priceTarget: string;
  impliedUpside: string;
  assumptions: string;
  confidence: "high" | "medium" | "low";
}

/** Where the report stands relative to the case it is discussing. */
export type CaseStance = "agrees" | "disagrees" | "partial";

export interface CaseAssessment {
  stance: CaseStance;
  /** Where the report agrees with the case and where it does not. */
  reasoning: string;
  /** Assumptions the report considers least supported, weakest first. */
  weakestAssumptions: string[];
}

export interface ValuationResult {
  currentPrice: string;
  /**
   * The ValuationCase's bear–bull range, per share.
   *
   * Named for what it is now: the case's range, copied in. It was
   * `intrinsicValueRange` when this stage produced its own estimate, and that
   * name became a lie the moment the case took ownership of the number.
   * `intrinsicValueRange` is retained as a deprecated alias so existing report
   * renderers and exports keep working.
   */
  caseValueRange: string;
  /** @deprecated Use `caseValueRange`. Kept so older consumers do not break. */
  intrinsicValueRange: string;
  /** Return implied by the case's base value from today's price. */
  caseImpliedUpside: string;
  /** @deprecated Use `caseImpliedUpside`. */
  impliedUpside: string;
  /** Cross-checks only. The DCF lens is the case and is deliberately absent. */
  approaches: ValuationApproach[];
  /** Narrative around the case's own bear/base/bull, whose prices come from it. */
  scenarios: ValuationScenario[];
  /**
   * Prose on how the case reacts to growth and discount-rate changes. The
   * numeric grid lives in the workspace and the case export; this is commentary.
   */
  sensitivityCommentary: string;
  /** @deprecated Use `sensitivityCommentary`. */
  dcfSensitivity: string;
  valuationVerdict: string;
  /** The adjudication. Null when there is no case to discuss. */
  caseAssessment: CaseAssessment | null;
}

const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

function sanitizeApproach(item: unknown): ValuationApproach | null {
  if (item === null || typeof item !== "object") return null;
  const a = item as Record<string, unknown>;
  if (typeof a.method !== "string") return null;
  const confidence = typeof a.confidence === "string" ? a.confidence.toLowerCase() : "";
  return {
    method: a.method,
    priceTarget: typeof a.priceTarget === "string" ? a.priceTarget : "",
    impliedUpside: typeof a.impliedUpside === "string" ? a.impliedUpside : "",
    assumptions: typeof a.assumptions === "string" ? a.assumptions : "",
    confidence: (CONFIDENCE_LEVELS as readonly string[]).includes(confidence)
      ? (confidence as ValuationApproach["confidence"])
      : "medium",
  };
}

function sanitizeScenario(item: unknown): ValuationScenario | null {
  if (item === null || typeof item !== "object") return null;
  const s = item as Record<string, unknown>;
  if (typeof s.label !== "string") return null;
  return {
    label: s.label,
    priceTarget: typeof s.priceTarget === "string" ? s.priceTarget : "",
    impliedUpside: typeof s.impliedUpside === "string" ? s.impliedUpside : "",
    keyAssumptions: Array.isArray(s.keyAssumptions)
      ? s.keyAssumptions.filter((x): x is string => typeof x === "string")
      : [],
  };
}

const CASE_STANCES = ["agrees", "disagrees", "partial"] as const;

function sanitizeCaseAssessment(item: unknown): CaseAssessment | null {
  if (item === null || typeof item !== "object") return null;
  const a = item as Record<string, unknown>;
  const reasoning = typeof a.reasoning === "string" ? a.reasoning : "";
  if (!reasoning) return null;
  const raw = typeof a.stance === "string" ? a.stance.toLowerCase() : "";
  const stance = (CASE_STANCES as readonly string[]).includes(raw) ? (raw as CaseStance) : "partial";
  return {
    stance,
    reasoning,
    weakestAssumptions: Array.isArray(a.weakestAssumptions)
      ? a.weakestAssumptions.filter((x): x is string => typeof x === "string")
      : [],
  };
}

/** Exported for unit testing — pure, no I/O. */
export function parseValuation(raw: string): ValuationResult {
  // extractJsonObject does not recurse into nested arrays — approaches/scenarios
  // need per-item sanitation since the UI maps over them and indexes `confidence`.
  const parsed = extractJsonObject(raw, {
    currentPrice: "n/a",
    intrinsicValueRange: "n/a",
    impliedUpside: "n/a",
    approaches: [] as unknown[],
    scenarios: [] as unknown[],
    dcfSensitivity: "",
    valuationVerdict: "",
    caseAssessment: null as unknown,
  });
  return {
    ...parsed,
    // The new names are canonical; the deprecated aliases are kept in lockstep so
    // a consumer reading either sees the same string.
    caseValueRange: parsed.intrinsicValueRange,
    caseImpliedUpside: parsed.impliedUpside,
    sensitivityCommentary: parsed.dcfSensitivity,
    approaches: parsed.approaches.map(sanitizeApproach).filter((a): a is ValuationApproach => a !== null),
    scenarios: parsed.scenarios.map(sanitizeScenario).filter((s): s is ValuationScenario => s !== null),
    caseAssessment: sanitizeCaseAssessment(parsed.caseAssessment),
  };
}

function buildValuationContext(
  symbol: string,
  currentPrice: number | null,
  snapshot: FundamentalsSnapshot,
  statements: FinancialStatements | null,
  analyst: AnalystConsensus,
  screenerIn: ScreenerInCompany | null | undefined,
  currency: string,
  fxRate?: number | null,
  runHotCold?: ReturnType<typeof computeRunHotCold>,
): string {
  const parts: string[] = [];

  const px = currentPrice ?? snapshot.price;
  parts.push(`CURRENT PRICE: ${px != null ? `${currency}${px.toFixed(2)}` : "n/a"}`);

  parts.push(`VALUATION INPUTS:
  Trailing P/E: ${snapshot.trailingPE?.toFixed(1) ?? "n/a"}x
  Forward P/E: ${snapshot.forwardPE?.toFixed(1) ?? "n/a"}x
  PEG: ${snapshot.pegRatio?.toFixed(2) ?? "n/a"}
  P/B: ${snapshot.priceToBook?.toFixed(1) ?? "n/a"}x
  Dividend yield: ${snapshot.dividendYield != null ? `${(snapshot.dividendYield * 100).toFixed(2)}%` : "n/a"}
  ROE: ${snapshot.returnOnEquity != null ? `${(snapshot.returnOnEquity * 100).toFixed(1)}%` : "n/a"}
  Operating margin: ${snapshot.operatingMargins != null ? `${(snapshot.operatingMargins * 100).toFixed(1)}%` : "n/a"}
  Revenue growth (YoY): ${snapshot.revenueGrowth != null ? `${(snapshot.revenueGrowth * 100).toFixed(1)}%` : "n/a"}
  Earnings growth (YoY): ${snapshot.earningsGrowth != null ? `${(snapshot.earningsGrowth * 100).toFixed(1)}%` : "n/a"}
  Total debt: ${snapshot.totalDebt != null ? `$${(snapshot.totalDebt / 1e9).toFixed(1)}B` : "n/a"}
  Total cash: ${snapshot.totalCash != null ? `$${(snapshot.totalCash / 1e9).toFixed(1)}B` : "n/a"}
  EBITDA: ${snapshot.ebitda != null ? `$${(snapshot.ebitda / 1e9).toFixed(1)}B` : "n/a"}
  FCF: ${snapshot.freeCashflow != null ? `$${(snapshot.freeCashflow / 1e9).toFixed(1)}B` : "n/a"}`);

  if (statements) {
    const revGrowths = statements.revenue
      .slice(-4)
      .map((p, i, arr) => i === 0 ? null : ((arr[i].value / arr[i - 1].value - 1) * 100).toFixed(1) + "%")
      .filter(Boolean);
    const fcfLast = statements.freeCashFlow.slice(-3).map((p) => `FY${p.fy}: $${(p.value / 1e9).toFixed(1)}B`).join(", ");
    parts.push(`HISTORICAL FINANCIALS:
  Revenue CAGR: ${statements.revenueCagr != null ? `${(statements.revenueCagr * 100).toFixed(1)}%` : "n/a"}
  FCF CAGR: ${statements.fcfCagr != null ? `${(statements.fcfCagr * 100).toFixed(1)}%` : "n/a"}
  Revenue growth trend (recent): ${revGrowths.join(", ")}
  FCF history: ${fcfLast}
  Margin trend: ${statements.operatingMargin.slice(-3).map((p) => `FY${p.fy}: ${(p.value * 100).toFixed(1)}%`).join(", ")}`);
  }

  parts.push(`ANALYST TARGETS (${analyst.numberOfOpinions ?? 0} analysts):
  Mean target: ${analyst.targetMean != null ? `$${analyst.targetMean.toFixed(0)}` : "n/a"}
  Range: ${analyst.targetLow != null ? `$${analyst.targetLow.toFixed(0)}` : "n/a"} – ${analyst.targetHigh != null ? `$${analyst.targetHigh.toFixed(0)}` : "n/a"}
  Upside to mean: ${analyst.upsidePercent != null ? `${analyst.upsidePercent >= 0 ? "+" : ""}${analyst.upsidePercent.toFixed(1)}%` : "n/a"}`);

  if (screenerIn) {
    parts.push(`INDIAN MARKET DATA (screener.in):
  P/E: ${screenerIn.pe ?? "n/a"}
  P/B: ${screenerIn.bookValue && screenerIn.currentPrice ? (screenerIn.currentPrice / screenerIn.bookValue).toFixed(1) + "x" : "n/a"}
  ROCE: ${screenerIn.roce ?? "n/a"}%
  ROE: ${screenerIn.roe ?? "n/a"}%
  Peers P/E range: ${screenerIn.peers.slice(0, 3).map((p) => p.pe ?? "n/a").join(", ")} (first 3 peers)`);
  }

  // FX context for export/import-heavy names
  if (fxRate != null) {
    const fxExp = detectFxExposure(symbol, symbol);
    if (fxExp !== "none") {
      parts.push(`FX CONTEXT:
  Live USD/INR: ${fxRate.toFixed(2)}
  This company appears to be an ${fxExp === "exporter" ? "EXPORTER (revenue in USD/EUR, costs in INR — INR weakness = earnings tailwind)' " : "IMPORTER (costs in USD, revenue in INR — INR weakness = margin headwind)"}.
  FX sensitivity: every 1% change in USD/INR moves earnings by ~2–4% for IT exporters, ~1–3% for pharma exporters, ~3–6% for oil importers.`);
    }
  }

  // Run Hot / Cold percentile + multi-timeframe CAGR
  if (runHotCold) {
    const availableWindows = runHotCold.historicalWindows.filter((w) => w.available);
    const windowStr = availableWindows.map((w) => `${w.years}Y CAGR: ${w.return.toFixed(1)}%`).join(", ");
    parts.push(`HISTORICAL RETURN CONTEXT (Run Hot/Cold):
  1-year return: ${runHotCold.oneYearReturn.toFixed(1)}%
  Median 1-year return (own history): ${runHotCold.medianReturn.toFixed(1)}%
  Percentile vs own history: ${runHotCold.percentile}th percentile
  Signal: ${runHotCold.signal === "run_hot" ? "RUN HOT — current return is in the top 20% of own history. Counter-cyclical caution: mean reversion likely." : runHotCold.signal === "run_cold" ? "RUN COLD — current return is in the bottom 20% of own history. Counter-cyclical opportunity: potential upward reversion." : "NEUTRAL — return is within normal historical range."}
  Long-run CAGR windows: ${windowStr || "insufficient data"}
  Note: Use this as a counter-cyclical overlay, not a standalone signal.`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Valuation reconciliation (fix 10.2)
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  spread_pct: number;           // |llm_target - mc_p50| / mc_p50 as fraction
  divergence: boolean;          // true if spread > 30%
  llm_target_mid: number | null;
  mc_p50: number | null;
  explanation: string;          // AI-generated if divergent; simple text otherwise
}

/**
 * Reconcile the ValuationCase against the quant engine's Monte Carlo prior.
 *
 * Previously this compared the *LLM's* narrated mid-target against the engine,
 * which required scraping a number back out of a formatted string like
 * "₹1,450–₹1,600" — and, more importantly, reconciled two estimates the user
 * could neither see the workings of nor correct. It now takes the case's fair
 * value directly: one side is the user-owned judgment, the other is the
 * systematic prior, which is the comparison actually worth explaining.
 *
 * caseFairValue: the case's base-case fair value per share
 * mc_p50:        the engine's Monte Carlo median intrinsic value per share
 */
export async function reconcileValuations(
  symbol: string,
  caseFairValue: number | null,
  mc_p50: number | null,
  currency = "$",
  crossChecks: string[] = [],
): Promise<ReconciliationResult> {
  const llm_target_mid = caseFairValue != null && Number.isFinite(caseFairValue)
    ? caseFairValue
    : null;

  if (llm_target_mid === null || mc_p50 === null || mc_p50 === 0) {
    return {
      spread_pct: 0,
      divergence: false,
      llm_target_mid,
      mc_p50,
      explanation: "Insufficient data to reconcile — one or both valuations unavailable.",
    };
  }

  const spread_pct = Math.abs(llm_target_mid - mc_p50) / Math.abs(mc_p50);
  const divergence = spread_pct > 0.30;

  if (!divergence) {
    const direction = llm_target_mid >= mc_p50 ? "above" : "below";
    return {
      spread_pct,
      divergence: false,
      llm_target_mid,
      mc_p50,
      explanation: `The case (${currency}${llm_target_mid.toFixed(0)}) is ${(spread_pct * 100).toFixed(1)}% ${direction} the engine's Monte Carlo median (${currency}${mc_p50.toFixed(0)}) — within the 30% threshold.`,
    };
  }

  // Divergence call: ask LLM to explain the gap
  const divergencePrompt = `Two independent valuations diverge for ${symbol}.

Valuation case (user-owned assumptions): ${currency}${llm_target_mid.toFixed(0)}
Quant engine Monte Carlo p50:            ${currency}${mc_p50.toFixed(0)}
Spread: ${(spread_pct * 100).toFixed(1)}%

Engine assumptions: CAPM WACC with rolling 252-day beta, sector-specific terminal growth, TTM revenue from SEC XBRL (or EBITDA proxy), 50k simulated paths.
${crossChecks.length > 0 ? `Independent cross-checks run on this name: ${crossChecks.join(", ")}.` : ""}

Explain in 2–3 sentences: why these estimates diverge and which is likely more reliable for ${symbol} given its sector and stage.
Be concrete — reference the actual numbers. Do not speculate beyond the data.`;

  try {
    const explanation = await runPrompt("scenario-analysis", divergencePrompt, { maxTokens: 300, json: false });
    return { spread_pct, divergence: true, llm_target_mid, mc_p50, explanation: explanation.trim() };
  } catch {
    return {
      spread_pct,
      divergence: true,
      llm_target_mid,
      mc_p50,
      explanation: `Divergence detected (${(spread_pct * 100).toFixed(1)}%): case ${currency}${llm_target_mid.toFixed(0)} vs engine ${currency}${mc_p50.toFixed(0)}. Explanation call failed.`,
    };
  }
}


export async function runValuationEngine(
  symbol: string,
  currentPrice: number | null,
  snapshot: FundamentalsSnapshot,
  statements: FinancialStatements | null,
  analyst: AnalystConsensus,
  screenerIn?: ScreenerInCompany | null,
  currency = "$",
  priceHistory?: { date: string; close: number }[],
  companyName?: string,
  model?: string,
  /** The case being adjudicated. Without one, the stage runs cross-checks only. */
  vcase?: ValuationCase | null,
): Promise<ValuationResult> {
  // Compute run hot/cold percentile from 5Y history
  const runHotCold = priceHistory && priceHistory.length >= 252
    ? computeRunHotCold(priceHistory)
    : null;

  // Fetch live USD/INR for FX-sensitive Indian stocks
  let fxRate: number | null = null;
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) {
    fxRate = await fetchLiveUsdInr();
  }

  const conglomerate = isConglomerate(symbol, companyName ?? symbol);

  const context = buildValuationContext(
    symbol, currentPrice, snapshot, statements, analyst, screenerIn, currency, fxRate, runHotCold,
  );

  const method4 = conglomerate
    ? `{
      "method": "Sum-of-the-Parts (SOTP)",
      "priceTarget": "...",
      "impliedUpside": "...",
      "assumptions": "Identify the main business segments (e.g. Jio, Retail, O2C for Reliance). Assign an EV/EBITDA or P/E multiple to each segment. Sum to get total EV. Subtract net debt. Divide by shares. State segment EBITDA estimates and multiples used.",
      "confidence": "high|medium|low"
    }`
    : `{
      "method": "FCF Yield",
      "priceTarget": "...",
      "impliedUpside": "...",
      "assumptions": "State: normalised FCF estimate, required FCF yield, basis for that yield target",
      "confidence": "high|medium|low"
    }`;

  const fxInstruction = fxRate != null
    ? `\nFX NOTE: Live USD/INR = ${fxRate.toFixed(2)}. Explicitly quantify FX impact on your valuation: how a 5% INR depreciation or appreciation changes the intrinsic value estimate. Add this as a sensitivity note in dcfSensitivity.`
    : "";

  const runHotColdInstruction = runHotCold
    ? `\nRUN HOT/COLD NOTE: Stock is at the ${runHotCold.percentile}th percentile of its own historical 1-year returns (${runHotCold.signal.replace("_", " ")}). Reflect this in valuationVerdict — if run hot, warn of mean reversion risk; if run cold, note potential reversion opportunity.`
    : "";

  const caseBlock = vcase
    ? `\n${summarizeCase(vcase)}\n`
    : "\nNo valuation case exists for this symbol yet.\n";

  const caseInstruction = vcase
    ? `\nYOUR ROLE: A valuation case already exists (above) and it is this app's single intrinsic-value estimate. Do NOT produce your own fair value, price target, or intrinsic value range — those come from the case. Your job is to (a) run independent cross-checks that use a *different* lens than discounted cash flow, and (b) adjudicate: say where you agree with the case and where you do not, and which of its assumptions is weakest. Assumptions marked "user-owned" are the user's judgment — you may argue with them, but treat them as deliberate.`
    : `\nYOUR ROLE: No case exists yet, so run the cross-checks below and leave caseAssessment null.`;

  const prompt = `You are a senior valuation analyst reviewing an existing valuation case for ${symbol}.

${context}
${caseBlock}${caseInstruction}

Run 3 cross-check approaches and 3 scenarios. For scenarios give only the label and key assumptions — the prices come from the case, not from you. Cite the data behind every claim.${fxInstruction}${runHotColdInstruction}

Return as JSON:
{
  "currentPrice": "current price as string with currency symbol",
  "intrinsicValueRange": "leave as empty string — the case supplies this",
  "impliedUpside": "leave as empty string — the case supplies this",
  "approaches": [
    {
      "method": "Relative Valuation (P/E)",
      "priceTarget": "...",
      "impliedUpside": "...",
      "assumptions": "State: peer P/E multiple used, earnings estimate used, why this multiple is appropriate",
      "confidence": "high|medium|low"
    },
    {
      "method": "EV/EBITDA",
      "priceTarget": "...",
      "impliedUpside": "...",
      "assumptions": "State: EV/EBITDA multiple used, EBITDA estimate, net debt used",
      "confidence": "high|medium|low"
    },
    ${method4}
  ],
  "scenarios": [
    {
      "label": "Bull case",
      "priceTarget": "...",
      "impliedUpside": "...",
      "keyAssumptions": ["assumption 1", "assumption 2", "assumption 3"]
    },
    {
      "label": "Base case",
      "priceTarget": "",
      "impliedUpside": "",
      "keyAssumptions": ["assumption 1", "assumption 2", "assumption 3"]
    },
    {
      "label": "Bear case",
      "priceTarget": "",
      "impliedUpside": "",
      "keyAssumptions": ["assumption 1", "assumption 2", "assumption 3"]
    }
  ],
  "dcfSensitivity": "2-3 sentences: how sensitive is the DCF valuation to changes in growth rate and WACC? What is the breakeven growth rate?",
  "valuationVerdict": "2-3 sentences: summary of valuation — cheap/fair/expensive vs history and peers, with your recommended entry/exit levels",
  "caseAssessment": {
    "stance": "agrees|disagrees|partial",
    "reasoning": "2-3 sentences: where you agree with the case and where you do not, citing its actual assumption values",
    "weakestAssumptions": ["name of the least-supported assumption", "next"]
  }
}`;

  const px = currentPrice ?? snapshot.price;

  let result: ValuationResult;
  try {
    const raw = await runPrompt("scenario-analysis", prompt, { maxTokens: 2000, json: true, model });
    result = parseValuation(raw);
  } catch {
    // The cross-checks and the adjudication are lost, but the case's own numbers
    // are not — they are applied below regardless, so the report still reports a
    // valuation even with AI unavailable.
    result = {
      currentPrice: px != null ? `${currency}${px.toFixed(2)}` : "n/a",
      caseValueRange: "n/a",
      intrinsicValueRange: "n/a",
      caseImpliedUpside: "n/a",
      impliedUpside: "n/a",
      approaches: [],
      scenarios: [],
      sensitivityCommentary: "Cross-checks unavailable — AI response could not be parsed.",
      dcfSensitivity: "Cross-checks unavailable — AI response could not be parsed.",
      valuationVerdict: vcase
        ? "Showing the valuation case's own numbers; AI commentary unavailable."
        : "See analyst consensus targets above.",
      caseAssessment: null,
    };
  }

  return applyCaseNumbers(result, vcase ?? null, px, currency);
}

/**
 * Overwrite every price the model may have emitted with the case's own.
 *
 * Belt and braces: the prompt asks it not to produce prices, but a model that
 * ignores that instruction must not be able to introduce a second fair value
 * into the report. Scenario labels and key assumptions are the model's; the
 * numbers beside them are always the case's.
 */
export function applyCaseNumbers(
  result: ValuationResult,
  vcase: ValuationCase | null,
  price: number | null,
  currency = "$",
): ValuationResult {
  if (!vcase) return result;
  const r = vcase.result;
  const fmt = (v: number) => `${currency}${v.toFixed(2)}`;
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const range = r.fairValueBear != null && r.fairValueBull != null
    ? `${fmt(r.fairValueBear)}–${fmt(r.fairValueBull)}`
    : r.fairValue != null ? fmt(r.fairValue) : "not computable";

  const byLabel: Record<string, number | null> = {
    bull: r.fairValueBull,
    base: r.fairValue,
    bear: r.fairValueBear,
  };

  const upside = r.impliedUpside != null ? pct(r.impliedUpside) : "n/a";
  return {
    ...result,
    currentPrice: price != null ? fmt(price) : result.currentPrice,
    caseValueRange: range,
    intrinsicValueRange: range,
    caseImpliedUpside: upside,
    impliedUpside: upside,
    scenarios: result.scenarios.map((scenario) => {
      const key = Object.keys(byLabel).find((k) => scenario.label.toLowerCase().includes(k));
      const value = key ? byLabel[key] : null;
      return {
        ...scenario,
        priceTarget: value != null ? fmt(value) : "",
        impliedUpside: value != null && price != null && price > 0
          ? pct(((value - price) / price) * 100)
          : "",
      };
    }),
  };
}
