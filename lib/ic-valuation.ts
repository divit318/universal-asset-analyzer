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

  return parts.join("\n\n");
}

export async function runValuationEngine(
  symbol: string,
  currentPrice: number | null,
  snapshot: FundamentalsSnapshot,
  statements: FinancialStatements | null,
  analyst: AnalystConsensus,
  screenerIn?: ScreenerInCompany | null,
  currency = "$",
): Promise<ValuationResult> {
  const context = buildValuationContext(
    symbol, currentPrice, snapshot, statements, analyst, screenerIn, currency,
  );

  const prompt = `You are a senior valuation analyst. Using ONLY the data below, build a rigorous multi-method valuation for ${symbol}.

${context}

Run 4 valuation approaches and 3 scenarios. Be explicit about every assumption. Cite the data that drives each assumption. Return as JSON:
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
    {
      "method": "FCF Yield",
      "priceTarget": "...",
      "impliedUpside": "...",
      "assumptions": "State: normalised FCF estimate, required FCF yield, basis for that yield target",
      "confidence": "high|medium|low"
    }
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
