/**
 * AI research prompts for Indian equities (screener.in primary + Yahoo
 * secondary): a one-shot deep analysis, per-section "so what" insights, and
 * freeform chat, all grounded in structured data.
 *
 * The equivalent Yahoo/global-equity prompt-builder path (deepAnalysis /
 * chatWithData) was removed — it was unreachable from the live Research Hub
 * (superseded by the Copilot's context/retrieval/grounding pipeline in
 * lib/ai/context.ts) and only existed to power the now-deleted orphaned
 * /stocks/[symbol] route.
 */

import { runPromptWithMeta } from "./ai";
import type { Quote } from "./types";
import type { ScreenerInCompany } from "./screener-in";
import { formatPercent } from "./format";
import { extractJson, extractJsonObject } from "./json-extract";

/* -------------------------------------------------------------------------- */
/* Shared result shape                                                         */
/* -------------------------------------------------------------------------- */

export interface DeepAnalysisResult {
  model: string;
  sections: {
    summary: string;
    investmentCase: string;
    competitivePosition: string;
    risks: string;
    keyMetrics: string;
    verdict: string;
  };
  rawText: string;
}

/**
 * Exported for unit testing — pure, no I/O. Shared by deepAnalysis() and
 * indianDeepAnalysis(), whose "six-section research note" prompts and
 * fallback behavior are identical.
 */
export function parseSections(raw: string): DeepAnalysisResult["sections"] {
  const fallback: DeepAnalysisResult["sections"] = {
    summary: raw,
    investmentCase: "",
    competitivePosition: "",
    risks: "",
    keyMetrics: "",
    verdict: "",
  };
  try {
    // extractJson still throws on total garbage (falls to the catch below,
    // which shows the raw model text as the summary rather than a blank
    // card); extractJsonObject then guards against the model omitting one
    // of the six string fields on an otherwise-valid parse. extractJsonObject
    // only guards array-vs-non-array mismatches, not object-vs-string — a
    // field the model returns as a nested object would otherwise reach JSX
    // as `{sections.summary}` and crash React ("Objects are not valid as a
    // React child"), so re-check each field is actually a string.
    extractJson(raw);
    const parsed = extractJsonObject(raw, fallback);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : fallback.summary,
      investmentCase: typeof parsed.investmentCase === "string" ? parsed.investmentCase : "",
      competitivePosition: typeof parsed.competitivePosition === "string" ? parsed.competitivePosition : "",
      risks: typeof parsed.risks === "string" ? parsed.risks : "",
      keyMetrics: typeof parsed.keyMetrics === "string" ? parsed.keyMetrics : "",
      verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
    };
  } catch {
    return fallback;
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/* -------------------------------------------------------------------------- */
/* Indian stock deep analysis (screener.in primary + Yahoo secondary)         */
/* -------------------------------------------------------------------------- */

export interface IndianDeepAnalysisInput {
  company: ScreenerInCompany;
  quote: Quote | null;
  derived: {
    promoterHolding: number | null;
    fiiHolding: number | null;
    diiHolding: number | null;
    evToEbitda: number | null;
    priceToSales: number | null;
    priceToBook: number | null;
    debtToEquity: number | null;
    interestCoverage: number | null;
    peers: import("@/lib/screener-in").ScreenerInPeer[];
  };
}

export async function indianDeepAnalysis(
  input: IndianDeepAnalysisInput,
): Promise<DeepAnalysisResult> {
  const { company, quote, derived } = input;

  const priceStr = quote ? `₹${quote.price.toFixed(2)} (${formatPercent(quote.changePercent)} today)` : `₹${company.currentPrice ?? "n/a"}`;

  const peerLines = derived.peers
    .slice(0, 5)
    .map(
      (p) =>
        `  ${p.name}: P/E ${p.pe ?? "n/a"}, ROCE ${p.roce ?? "n/a"}%, ROE ${p.roe ?? "n/a"}%`,
    )
    .join("\n");

  const prompt = `You are a senior equity research analyst specialising in Indian listed companies (NSE/BSE). Using ONLY the structured data below, write a comprehensive research note.

COMPANY: ${company.name} (${company.symbol})
Price: ${priceStr}
Market cap: ₹${company.marketCap ?? "n/a"} Cr
52W range: ₹${company.low52w ?? "n/a"} – ₹${company.high52w ?? "n/a"}

VALUATION:
  P/E: ${company.pe ?? "n/a"}
  P/B: ${derived.priceToBook ?? "n/a"}
  EV/EBITDA: ${derived.evToEbitda ?? "n/a"}
  P/S: ${derived.priceToSales ?? "n/a"}
  Dividend yield: ${company.dividendYield ?? "n/a"}%

PROFITABILITY:
  ROCE: ${company.roce ?? "n/a"}%
  ROE: ${company.roe ?? "n/a"}%
  Book value/share: ₹${company.bookValue ?? "n/a"}

BALANCE SHEET:
  Debt: ₹${company.debt ?? "n/a"} Cr
  Debt/Equity: ${derived.debtToEquity ?? "n/a"}
  Interest coverage: ${derived.interestCoverage ?? "n/a"}

SHAREHOLDING (latest quarter):
  Promoter: ${derived.promoterHolding ?? "n/a"}%
  FII: ${derived.fiiHolding ?? "n/a"}%
  DII: ${derived.diiHolding ?? "n/a"}%

PEERS (from screener.in):
${peerLines || "  not available"}

Write a structured research note with exactly these sections. Keep each 3-5 sentences. Return as JSON:
{
  "summary": "Executive summary of the investment case for this Indian stock",
  "investmentCase": "Key reasons to own or avoid — reference ROCE, ROE, P/E vs peers",
  "competitivePosition": "How does it compare to peers? Reference the peer table specifically",
  "risks": "Top 3 risks — consider promoter holding, leverage, valuation, sector risks",
  "keyMetrics": "The 4-5 most important metrics for evaluating this Indian stock specifically",
  "verdict": "One clear sentence: Buy/Hold/Sell with valuation context"
}`;

  const { text: raw, model } = await runPromptWithMeta("company-research", prompt, {
    maxTokens: 1500,
    json: true,
  });

  const sections = parseSections(raw);

  return { model, sections, rawText: raw };
}

/* -------------------------------------------------------------------------- */
/* Indian section insight — quick "so what" per page section                  */
/* -------------------------------------------------------------------------- */

export type IndianInsightSection = "financials" | "ownership" | "peers" | "valuation";

export interface IndianSectionInsightInput {
  section: IndianInsightSection;
  company: ScreenerInCompany;
  derived: IndianDeepAnalysisInput["derived"];
  quote: Quote | null;
}

export async function indianSectionInsight(
  input: IndianSectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { section, company, derived, quote } = input;

  let prompt = "";

  if (section === "financials") {
    const annualSales = company.annualPL.map((d) => `${d.period}: ₹${d.sales ?? "n/a"} Cr`).join(", ");
    const annualProfit = company.annualPL.map((d) => `${d.period}: ₹${d.netProfit ?? "n/a"} Cr`).join(", ");
    const recentQ = company.quarterlyPL.slice(-4).map((d) => `${d.period}: ₹${d.sales ?? "n/a"} Cr sales, ₹${d.netProfit ?? "n/a"} Cr profit`).join("; ");
    prompt = `You are a senior equity analyst. In 2-3 sentences, interpret the financial performance of ${company.name} (${company.symbol}) for an institutional investor. Focus on the trend, any inflection points, and what it means for the investment case.

Annual Revenue trend: ${annualSales || "not available"}
Annual Net Profit: ${annualProfit || "not available"}
Recent quarters: ${recentQ || "not available"}
ROCE: ${company.roce ?? "n/a"}%
ROE: ${company.roe ?? "n/a"}%

Be direct. Cite the most important number. Answer: is this business growing, stable, or deteriorating, and what should an investor watch?`;
  } else if (section === "ownership") {
    const holdingLines = company.shareholding
      .map((s) => `${s.name}: ${s.values.at(-1) ?? "n/a"}%`)
      .join(", ");
    const promoterChange = (() => {
      const pr = company.shareholding.find((s) => s.holding === "promoter");
      if (!pr || pr.values.length < 4) return "";
      const first = parseFloat(pr.values[0] ?? "");
      const last = parseFloat(pr.values.at(-1) ?? "");
      if (!isFinite(first) || !isFinite(last)) return "";
      return ` (changed by ${(last - first).toFixed(1)}pp over the period)`;
    })();
    prompt = `You are a senior equity analyst. In 2-3 sentences, interpret the shareholding pattern of ${company.name} (${company.symbol}) for an institutional investor.

Current holdings: ${holdingLines || "Promoter: " + (derived.promoterHolding ?? "n/a") + "%, FII: " + (derived.fiiHolding ?? "n/a") + "%, DII: " + (derived.diiHolding ?? "n/a") + "%"}
Promoter trend${promoterChange}

Explain: Are institutions accumulating or exiting? What does the promoter stake signal? What's the key ownership risk or strength?`;
  } else if (section === "peers") {
    const peerLines = derived.peers.slice(0, 6).map((p) => `${p.name}: P/E ${p.pe ?? "n/a"}, ROCE ${p.roce ?? "n/a"}%`).join("; ");
    prompt = `You are a senior equity analyst. In 2-3 sentences, summarise how ${company.name} (${company.symbol}) compares to its sector peers.

${company.symbol}: P/E ${company.pe ?? "n/a"}, ROCE ${company.roce ?? "n/a"}%, ROE ${company.roe ?? "n/a"}%
Peers: ${peerLines || "not available"}

Answer: where does this company rank? Is the valuation premium/discount justified by quality metrics?`;
  } else {
    // valuation
    const price = quote ? `₹${quote.price.toFixed(2)}` : `₹${company.currentPrice ?? "n/a"}`;
    prompt = `You are a senior equity analyst. In 2-3 sentences, interpret the current valuation of ${company.name} (${company.symbol}).

Price: ${price}
52W High/Low: ₹${company.high52w ?? "n/a"} / ₹${company.low52w ?? "n/a"}
P/E: ${company.pe ?? "n/a"}, P/B: ${derived.priceToBook ?? "n/a"}, EV/EBITDA: ${derived.evToEbitda ?? "n/a"}
ROCE: ${company.roce ?? "n/a"}%, ROE: ${company.roe ?? "n/a"}%
Dividend yield: ${company.dividendYield ?? "n/a"}%

Is the stock cheap, fair, or expensive? What justifies or undermines the valuation?`;
  }

  const { text: raw, model } = await runPromptWithMeta("quick-summary", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface IndianChatInput {
  quote: Quote | null;
  company: ScreenerInCompany;
  derived: IndianDeepAnalysisInput["derived"];
  history: ChatMessage[];
  question: string;
}

export async function indianChatWithData(
  input: IndianChatInput,
): Promise<{ answer: string; model: string }> {
  const { company, derived, quote, history, question } = input;

  const system = `You are an expert analyst specialising in Indian listed stocks (NSE/BSE). Using ONLY the structured data below, answer the user's question. Be precise, cite specific numbers. If data is missing, say so.

DATA:
Company: ${company.name} (${company.symbol})
P/E: ${company.pe ?? "n/a"}, ROCE: ${company.roce ?? "n/a"}%, ROE: ${company.roe ?? "n/a"}%
EV/EBITDA: ${derived.evToEbitda ?? "n/a"}, Debt/Equity: ${derived.debtToEquity ?? "n/a"}
Promoter holding: ${derived.promoterHolding ?? "n/a"}%, FII: ${derived.fiiHolding ?? "n/a"}%, DII: ${derived.diiHolding ?? "n/a"}%
Price: ${quote ? `₹${quote.price.toFixed(2)}` : `₹${company.currentPrice ?? "n/a"}`}
Market cap: ₹${company.marketCap ?? "n/a"} Cr
52W range: ₹${company.low52w ?? "n/a"} – ₹${company.high52w ?? "n/a"}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const { text: answer, model } = await runPromptWithMeta("company-research", fullPrompt, {
    maxTokens: 800,
  });
  return { answer: answer.trim(), model };
}
