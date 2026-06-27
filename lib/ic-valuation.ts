/**
 * IC Pipeline — Stage 5: Valuation Engine
 *
 * Runs 4 valuation approaches in parallel using structured data and AI:
 *   1. DCF — AI derives growth/margin/WACC assumptions from data, builds model
 *   2. Relative valuation — vs sector peers on key multiples
 *   3. Dividend discount / earnings yield (where applicable)
 *   4. Sum-of-the-parts (SOTP) — for conglomerates / multi-segment businesses
 *
 * Each approach returns a price target range with explicit assumptions.
 * The final output includes scenario analysis and a consolidated target.
 */

import { runPrompt } from "./ai";
import type { FundamentalsSnapshot, FinancialStatements, AnalystConsensus } from "./types";
import type { ScreenerInCompany } from "./screener-in";

/* ─── FX context helpers ─────────────────────────────────────────────── */

// Sectors where ₹/$ movement materially impacts earnings
const FX_EXPORT_SECTORS = ["Information Technology", "Technology", "Healthcare", "Pharmaceuticals", "Chemicals", "Textiles"];
const FX_IMPORT_SECTORS = ["Energy", "Oil & Gas", "Airlines", "Automobile", "Metals", "Consumer Electronics"];
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

export interface ValuationResult {
  currentPrice: string;
  intrinsicValueRange: string;
  impliedUpside: string;
  approaches: ValuationApproach[];
  scenarios: ValuationScenario[];
  dcfSensitivity: string;
  valuationVerdict: string;
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
 * Reconcile LLM valuation target vs MC p50.
 *
 * If the spread between LLM mid-target and MC p50 exceeds 30%, triggers a
 * divergence LLM call to explain the discrepancy. Otherwise returns a simple
 * one-line reconciliation.
 *
 * llm_target_mid: midpoint parsed from ValuationResult.intrinsicValueRange
 * mc_p50:         MC p50 intrinsic value from scorecard/detail
 */
export async function reconcileValuations(
  symbol: string,
  llmResult: ValuationResult,
  mc_p50: number | null,
  currency = "$",
): Promise<ReconciliationResult> {
  // Parse LLM mid-target from intrinsicValueRange string
  let llm_target_mid: number | null = null;
  const rangeStr = llmResult.intrinsicValueRange;
  if (rangeStr && rangeStr !== "n/a") {
    // Handles "$180–$220", "₹1,450–₹1,600", "$195", etc.
    const nums = rangeStr.replace(/[^\d.,–\-]/g, " ").trim().split(/[–\-]+/).map((s) => {
      const n = parseFloat(s.replace(/,/g, "").trim());
      return isFinite(n) ? n : null;
    }).filter((n): n is number => n !== null);
    if (nums.length === 2) llm_target_mid = (nums[0] + nums[1]) / 2;
    else if (nums.length === 1) llm_target_mid = nums[0];
  }

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
      explanation: `LLM target (${currency}${llm_target_mid.toFixed(0)}) is ${(spread_pct * 100).toFixed(1)}% ${direction} MC p50 (${currency}${mc_p50.toFixed(0)}) — within 30% threshold.`,
    };
  }

  // Divergence call: ask LLM to explain the gap
  const divergencePrompt = `Two independent valuation methods produce divergent estimates for ${symbol}.

LLM multi-method mid-target: ${currency}${llm_target_mid.toFixed(0)}
Monte Carlo DCF p50:          ${currency}${mc_p50.toFixed(0)}
Spread: ${(spread_pct * 100).toFixed(1)}%

MC DCF assumptions: CAPM WACC with rolling 252-day beta, sector-specific terminal growth, TTM revenue from SEC XBRL (or EBITDA proxy), 50k paths.
LLM target approaches: ${llmResult.approaches.map((a) => a.method).join(", ")}.

Explain in 2–3 sentences: why these estimates diverge and which is likely more reliable for ${symbol} given its sector and stage.
Be concrete — reference the actual numbers. Do not speculate beyond the data.`;

  try {
    const explanation = await runPrompt(divergencePrompt, { maxTokens: 300, json: false });
    return { spread_pct, divergence: true, llm_target_mid, mc_p50, explanation: explanation.trim() };
  } catch {
    return {
      spread_pct,
      divergence: true,
      llm_target_mid,
      mc_p50,
      explanation: `Divergence detected (${(spread_pct * 100).toFixed(1)}%): LLM ${currency}${llm_target_mid.toFixed(0)} vs MC ${currency}${mc_p50.toFixed(0)}. Reconciliation LLM call failed.`,
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

  const prompt = `You are a senior valuation analyst. Using ONLY the data below, build a rigorous multi-method valuation for ${symbol}.

${context}

Run 4 valuation approaches and 3 scenarios. Be explicit about every assumption. Cite the data that drives each assumption.${fxInstruction}${runHotColdInstruction}

Return as JSON:
{
  "currentPrice": "current price as string with currency symbol",
  "intrinsicValueRange": "your consolidated intrinsic value range e.g. '$180–$220'",
  "impliedUpside": "e.g. '+15%' or '-8%' vs current price (use the midpoint of your range)",
  "approaches": [
    {
      "method": "DCF",
      "priceTarget": "e.g. '$195'",
      "impliedUpside": "e.g. '+12%'",
      "assumptions": "Explicitly state: revenue growth rate used (cite historical CAGR), operating margin trajectory, WACC assumed, terminal growth rate, net debt adjustment",
      "confidence": "high|medium|low"
    },
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
      "priceTarget": "...",
      "impliedUpside": "...",
      "keyAssumptions": ["assumption 1", "assumption 2", "assumption 3"]
    },
    {
      "label": "Bear case",
      "priceTarget": "...",
      "impliedUpside": "...",
      "keyAssumptions": ["assumption 1", "assumption 2", "assumption 3"]
    }
  ],
  "dcfSensitivity": "2-3 sentences: how sensitive is the DCF valuation to changes in growth rate and WACC? What is the breakeven growth rate?",
  "valuationVerdict": "2-3 sentences: summary of valuation — cheap/fair/expensive vs history and peers, with your recommended entry/exit levels"
}`;

  try {
    const raw = await runPrompt(prompt, { maxTokens: 2000, json: true });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(cleaned) as ValuationResult;
  } catch {
    const px = currentPrice ?? snapshot.price;
    const analystTarget = analyst.targetMean;
    const upside = px && analystTarget ? ((analystTarget - px) / px * 100).toFixed(1) : "n/a";
    return {
      currentPrice: px != null ? `${currency}${px.toFixed(2)}` : "n/a",
      intrinsicValueRange: analystTarget ? `${currency}${analystTarget.toFixed(0)}` : "n/a",
      impliedUpside: upside !== "n/a" ? `${parseFloat(upside) >= 0 ? "+" : ""}${upside}%` : "n/a",
      approaches: [],
      scenarios: [],
      dcfSensitivity: "Valuation engine unavailable — AI response could not be parsed.",
      valuationVerdict: "See analyst consensus targets above.",
    };
  }
}
