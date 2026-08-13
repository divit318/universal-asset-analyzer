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
import type { NewsItem, Quote } from "./types";
import type { ScreenerInCompany } from "./screener-in";
import { extractOwnership, ownershipTrends } from "./india-ownership";
import type { IndiaDerivedFundamentals } from "./india-snapshot";
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
  derived: IndiaDerivedFundamentals & {
    promoterHolding: number | null;
    fiiHolding: number | null;
    diiHolding: number | null;
    peers: import("@/lib/screener-in").ScreenerInPeer[];
  };
  /** Recent NSE filings + media (cached upstream) — lets the model answer
   *  "what happened recently" from evidence instead of declining or guessing. */
  developments?: NewsItem[];
}

const fmtCr = (v: number | null | undefined) =>
  v == null ? "n/a" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`;

const fmtPct1 = (v: number | null | undefined) => (v == null ? "n/a" : `${v.toFixed(1)}%`);

/**
 * The one grounding block for Indian AI prompts — identity, basis, statements,
 * latest quarter (Indian fiscal label), cash flow, shareholding. Deep analysis
 * and chat share it so the model never sees two different pictures of the
 * same company.
 */
function indiaFactBlock(input: IndianDeepAnalysisInput): string {
  const { company: c, quote, derived: d } = input;
  const financial = d.statementKind === "financial";
  const priceStr = quote
    ? `₹${quote.price.toFixed(2)} (${formatPercent(quote.changePercent)} today)`
    : `₹${c.currentPrice ?? "n/a"}`;

  const fys = c.annualPL.filter((r) => /^[A-Za-z]{3}\s+\d{4}$/.test(r.period)).slice(-4);
  const ttm = c.annualPL.find((r) => r.period.toUpperCase() === "TTM");
  const annualLines = [...fys, ...(ttm ? [ttm] : [])]
    .map((r) => `  ${r.period}: revenue ${fmtCr(r.sales)}, net profit ${fmtCr(r.netProfit)}${r.eps != null ? `, EPS ₹${r.eps}` : ""}`)
    .join("\n");

  const q = d.latestQuarter;
  const latestQLine = q
    ? `${q.fiscalLabel} (${q.period}): revenue ${fmtCr(q.sales)}${q.salesYoYPercent != null ? ` (${q.salesYoYPercent >= 0 ? "+" : ""}${q.salesYoYPercent.toFixed(1)}% YoY)` : ""}, net profit ${fmtCr(q.netProfit)}${q.netProfitYoYPercent != null ? ` (${q.netProfitYoYPercent >= 0 ? "+" : ""}${q.netProfitYoYPercent.toFixed(1)}% YoY)` : ""}${q.eps != null ? `, EPS ₹${q.eps}` : ""}`
    : "not available";

  const bankBlock = financial
    ? `\nASSET QUALITY (latest quarter):
  Gross NPA: ${fmtPct1(d.grossNpaPercent)} | Net NPA: ${fmtPct1(d.netNpaPercent)}
  Deposits: ${fmtCr(d.deposits)}
  Note: this is a bank/NBFC — debt/equity and interest coverage are not meaningful for lenders.`
    : `\nLEVERAGE:
  Debt/Equity: ${d.debtToEquity ?? "n/a"} | Interest coverage: ${d.interestCoverage != null ? `${d.interestCoverage}x` : "n/a"}`;

  return `COMPANY: ${c.name} (${c.symbol}) — ${d.basis === "standalone" ? "STANDALONE" : "CONSOLIDATED"} figures, ₹ Cr
Price: ${priceStr} | Market cap: ${fmtCr(c.marketCap)} | 52W range: ₹${c.low52w ?? "n/a"} – ₹${c.high52w ?? "n/a"}

VALUATION:
  P/E: ${c.pe ?? "n/a"} | P/B: ${d.priceToBook ?? "n/a"} | P/S: ${d.priceToSales ?? "n/a"} | Dividend yield: ${fmtPct1(c.dividendYield)}

PROFITABILITY:
  ROCE: ${fmtPct1(c.roce)} | ROE: ${fmtPct1(c.roe)} | Book value/share: ₹${c.bookValue ?? "n/a"}

BALANCE SHEET (latest FY):
  Total equity: ${fmtCr(d.totalEquity)} | Borrowings: ${fmtCr(d.totalDebt)}${bankBlock}

CASH FLOW (${d.latestAnnualPeriod ?? "latest FY"}):
  Operating cash flow: ${fmtCr(d.operatingCashFlow)} | Free cash flow: ${fmtCr(d.freeCashFlow)}

GROWTH:
  Sales YoY: ${fmtPct1(d.salesGrowthYoYPercent)} | Sales 3Y CAGR: ${fmtPct1(d.salesCagr3yPercent)} | Profit YoY: ${fmtPct1(d.profitGrowthYoYPercent)}

ANNUAL TREND:
${annualLines || "  not available"}

LATEST QUARTER: ${latestQLine}

${shareholdingBlock(input)}${developmentsBlock(input.developments)}`;
}

/**
 * Shareholding with its disclosure quarter, QoQ deltas (percentage POINTS)
 * and multi-quarter trends — computed by the same lib/india-ownership-trends
 * math every UI surface uses, so the model can answer "how are promoter and
 * FII holdings trending?" from real disclosures instead of one snapshot.
 */
function shareholdingBlock(input: IndianDeepAnalysisInput): string {
  const d = input.derived;
  const own = extractOwnership(input.company);
  const t = ownershipTrends(own);

  const delta = (curr: number | null, prev: number | null) =>
    curr != null && prev != null ? ` (${curr - prev >= 0 ? "+" : ""}${(curr - prev).toFixed(2)}pp QoQ)` : "";

  const streakLine = (label: string, streak: number | null, change4Q: number | null) => {
    if (streak == null && change4Q == null) return null;
    const parts: string[] = [];
    if (streak != null && streak !== 0) parts.push(`${streak > 0 ? "rose" : "fell"} ${Math.abs(streak)} consecutive disclosed quarter${Math.abs(streak) > 1 ? "s" : ""}`);
    if (streak === 0) parts.push("flat last quarter");
    if (change4Q != null) parts.push(`${change4Q >= 0 ? "+" : ""}${change4Q.toFixed(1)}pp over the last 4 disclosed quarters`);
    return `  ${label} trend: ${parts.join("; ")}`;
  };

  const trendLines = [
    streakLine("Promoter", t.promoterStreak, t.promoterChange4Q),
    streakLine("FII", t.fiiStreak, t.fiiChange4Q),
    streakLine("DII", t.diiStreak, t.diiChange4Q),
  ].filter(Boolean).join("\n");

  return `SHAREHOLDING (SEBI pattern, as of ${own.period ?? "latest disclosed quarter"}${own.prevPeriod ? `; QoQ vs ${own.prevPeriod}` : ""}):
  Promoter: ${fmtPct1(d.promoterHolding)}${delta(own.promoterHolding, own.promoterPrev)} | FII: ${fmtPct1(d.fiiHolding)}${delta(own.fiiHolding, own.fiiPrev)} | DII: ${fmtPct1(d.diiHolding)}${delta(own.diiHolding, own.diiPrev)}${trendLines ? `\n${trendLines}` : ""}`;
}

/** Recent NSE filings + media, dated and categorized — evidence, not vibes. */
function developmentsBlock(developments: NewsItem[] | undefined): string {
  if (!developments || developments.length === 0) return "";
  const lines = developments
    .slice(0, 6)
    .map((n) => `  ${n.publishedAt.slice(0, 10)} [${n.source}] ${n.headline.slice(0, 140)}`)
    .join("\n");
  return `\n\nRECENT DEVELOPMENTS (exchange filings + media, newest first):\n${lines}`;
}

export async function indianDeepAnalysis(
  input: IndianDeepAnalysisInput,
): Promise<DeepAnalysisResult> {
  const { derived } = input;

  const peerLines = derived.peers
    .slice(0, 5)
    .map(
      (p) =>
        `  ${p.name}: P/E ${p.pe ?? "n/a"}, ROCE ${p.roce ?? "n/a"}%, ROE ${p.roe ?? "n/a"}%`,
    )
    .join("\n");

  const prompt = `You are a senior equity research analyst specialising in Indian listed companies (NSE/BSE). Using ONLY the structured data below, write a comprehensive research note. Quarters follow the Indian fiscal year (April–March); "Q1 FY27" is the quarter ended June 2026.

${indiaFactBlock(input)}

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
  /** Recent NSE filings + media (cached upstream). */
  developments?: NewsItem[];
}

export async function indianChatWithData(
  input: IndianChatInput,
): Promise<{ answer: string; model: string }> {
  const { company, derived, quote, history, question, developments } = input;

  const system = `You are an expert analyst specialising in Indian listed stocks (NSE/BSE). Using ONLY the structured data below, answer the user's question. Be precise, cite specific numbers. If data is missing, say so. Quarters follow the Indian fiscal year (April–March). Ownership trends are descriptive disclosures — never present them as the cause of results or price moves.

DATA:
${indiaFactBlock({ company, quote, derived, developments })}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const { text: answer, model } = await runPromptWithMeta("company-research", fullPrompt, {
    maxTokens: 800,
  });
  return { answer: answer.trim(), model };
}
