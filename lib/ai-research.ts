/**
 * AI research prompts that use the full structured data available:
 * score, risks, analyst consensus, insider activity, peer comparison,
 * financial statements, and optional screener.in data for Indian stocks.
 *
 * Two modes:
 *   deepAnalysis()  — a one-shot comprehensive report on a stock
 *   chatWithData()  — freeform Q&A grounded in structured data
 */

import { runPrompt, getActiveModelName } from "./ai";
import type {
  FundamentalsData,
  PeerComparison,
  Quote,
} from "./types";
import type { ScreenerInCompany } from "./screener-in";
import { formatCurrency, formatPercent, formatCompact, formatMarketCap } from "./format";

/* -------------------------------------------------------------------------- */
/* Prompt builders                                                             */
/* -------------------------------------------------------------------------- */

function scoreBlock(data: FundamentalsData): string {
  const { score, risks, momentum } = data;
  const buckets = score.buckets
    .map((b) => `  ${b.name}: ${b.points}/${b.max} — ${b.factors.map((f) => f.detail).filter((d) => d !== "n/a").join(", ")}`)
    .join("\n");

  const riskLines = risks
    .map((r) => `  ${r.category} [${r.level.toUpperCase()}]: ${r.reason}`)
    .join("\n");

  const momentumLine = momentum
    ? `Momentum: score ${momentum.score}/100, trend ${momentum.trend}, vs 50d SMA ${momentum.vsSma50 != null ? `${momentum.vsSma50 >= 0 ? "+" : ""}${momentum.vsSma50.toFixed(1)}%` : "n/a"}, vs 200d SMA ${momentum.vsSma200 != null ? `${momentum.vsSma200 >= 0 ? "+" : ""}${momentum.vsSma200.toFixed(1)}%` : "n/a"}`
    : "Momentum: insufficient history";

  return `COMPOSITE SCORE: ${score.composite}/100 → ${score.recommendation} (${score.confidence}% confidence)
Signal breakdown:
  Fundamentals: ${score.signals.fundamentals}/100
  Analyst consensus: ${score.signals.analysts ?? "n/a"}/100
  Price momentum: ${score.signals.momentum ?? "n/a"}/100
${momentumLine}

Fundamental factor scores:
${buckets}

Risks:
${riskLines}`;
}

function analystBlock(data: FundamentalsData): string {
  const { analyst } = data;
  const total = analyst.strongBuy + analyst.buy + analyst.hold + analyst.sell + analyst.strongSell;
  const dist = total > 0
    ? `StrongBuy:${analyst.strongBuy} Buy:${analyst.buy} Hold:${analyst.hold} Sell:${analyst.sell} StrongSell:${analyst.strongSell}`
    : analyst.recommendationKey ?? "no coverage";

  return `ANALYST CONSENSUS (${analyst.numberOfOpinions ?? 0} analysts):
  Price target: mean ${formatCurrency(analyst.targetMean)} (low ${formatCurrency(analyst.targetLow)} – high ${formatCurrency(analyst.targetHigh)})
  Upside to target: ${analyst.upsidePercent != null ? `${analyst.upsidePercent >= 0 ? "+" : ""}${analyst.upsidePercent.toFixed(1)}%` : "n/a"}
  Rating distribution: ${dist}
  EPS revisions (30d): ↑${analyst.epsRevisionsUp30d ?? 0} ↓${analyst.epsRevisionsDown30d ?? 0}
  Recent EPS surprises: ${analyst.epsSurprises.slice(0, 4).map((s) => `${(s * 100).toFixed(1)}%`).join(", ") || "none"}`;
}

function insiderBlock(data: FundamentalsData): string {
  const { insider } = data;
  const summary = `${insider.buyCount} buys, ${insider.sellCount} sells, net value ${insider.netValue >= 0 ? "+" : "-"}$${formatCompact(Math.abs(insider.netValue))}`;
  const recent = insider.transactions
    .slice(0, 3)
    .map((t) => `  ${t.date} ${t.name}: ${t.type} ${t.shares != null ? formatCompact(t.shares) + " shares" : ""} ${t.value ? "($" + formatCompact(t.value) + ")" : ""}`)
    .join("\n");
  return `INSIDER ACTIVITY: ${summary}\nRecent transactions:\n${recent || "  none"}`;
}

function statementsBlock(data: FundamentalsData): string {
  const { statements } = data;
  if (!statements) return "FINANCIAL STATEMENTS: unavailable (EDGAR)";

  const rev = statements.revenue.map((p) => `FY${p.fy}: $${(p.value / 1e9).toFixed(1)}B`).join(", ");
  const ni = statements.netIncome.map((p) => `FY${p.fy}: $${(p.value / 1e9).toFixed(1)}B`).join(", ");
  const fcf = statements.freeCashFlow.map((p) => `FY${p.fy}: $${(p.value / 1e9).toFixed(1)}B`).join(", ");
  const om = statements.operatingMargin.map((p) => `FY${p.fy}: ${(p.value * 100).toFixed(1)}%`).join(", ");

  return `FINANCIAL STATEMENTS (EDGAR):
  Revenue: ${rev}
  Net income: ${ni}
  Free cash flow: ${fcf}
  Operating margin: ${om}
  Revenue CAGR (${statements.fiscalYears.length}y): ${statements.revenueCagr != null ? `${(statements.revenueCagr * 100).toFixed(1)}%` : "n/a"}
  FCF CAGR: ${statements.fcfCagr != null ? `${(statements.fcfCagr * 100).toFixed(1)}%` : "n/a"}`;
}

function snapshotBlock(data: FundamentalsData, quote: Quote): string {
  const { snapshot } = data;
  return `COMPANY SNAPSHOT:
  ${quote.symbol} — ${quote.name}
  Price: ${formatCurrency(quote.price, quote.currency)} (${formatPercent(quote.changePercent)} today)
  Market cap: ${formatMarketCap(quote.marketCap)}
  52-week range: ${formatCurrency(quote.fiftyTwoWeekLow, quote.currency)} – ${formatCurrency(quote.fiftyTwoWeekHigh, quote.currency)}
  Exchange: ${quote.exchange ?? "n/a"}
  Trailing P/E: ${snapshot.trailingPE?.toFixed(1) ?? "n/a"}
  Forward P/E: ${snapshot.forwardPE?.toFixed(1) ?? "n/a"}
  PEG: ${snapshot.pegRatio?.toFixed(2) ?? "n/a"}
  P/B: ${snapshot.priceToBook?.toFixed(1) ?? "n/a"}
  ROE: ${snapshot.returnOnEquity != null ? `${(snapshot.returnOnEquity * 100).toFixed(1)}%` : "n/a"}
  ROA: ${snapshot.returnOnAssets != null ? `${(snapshot.returnOnAssets * 100).toFixed(1)}%` : "n/a"}
  Operating margin: ${snapshot.operatingMargins != null ? `${(snapshot.operatingMargins * 100).toFixed(1)}%` : "n/a"}
  Revenue growth (YoY): ${snapshot.revenueGrowth != null ? `${(snapshot.revenueGrowth * 100).toFixed(1)}%` : "n/a"}
  Debt/Equity: ${snapshot.debtToEquity?.toFixed(2) ?? "n/a"}
  Current ratio: ${snapshot.currentRatio?.toFixed(2) ?? "n/a"}
  Dividend yield: ${snapshot.dividendYield != null ? `${(snapshot.dividendYield * 100).toFixed(2)}%` : "n/a"}`;
}

function peerBlock(peers: PeerComparison): string {
  const fmt = (v: number | null, suffix = "") =>
    v == null ? "n/a" : `${v.toFixed(1)}${suffix}`;
  return `PEER COMPARISON (${peers.sector}, n=${peers.peerCount}):
  Metric        This stock   Sector median
  P/E           ${fmt(peers.target.pe, "x").padEnd(12)} ${fmt(peers.median.pe, "x")}
  ROE           ${fmt(peers.target.roe != null ? peers.target.roe * 100 : null, "%").padEnd(12)} ${fmt(peers.median.roe != null ? peers.median.roe * 100 : null, "%")}
  Revenue growth ${fmt(peers.target.revenueGrowth != null ? peers.target.revenueGrowth * 100 : null, "%").padEnd(11)} ${fmt(peers.median.revenueGrowth != null ? peers.median.revenueGrowth * 100 : null, "%")}
  Debt/Equity   ${fmt(peers.target.debtToEquity, "x").padEnd(12)} ${fmt(peers.median.debtToEquity, "x")}`;
}

function screenerInBlock(company: ScreenerInCompany): string {
  return `SCREENER.IN DATA (Indian exchange):
  Market cap: ₹${company.marketCap ?? "n/a"} Cr
  P/E: ${company.pe ?? "n/a"}
  Book value/share: ₹${company.bookValue ?? "n/a"}
  ROCE: ${company.roce ?? "n/a"}%
  ROE: ${company.roe ?? "n/a"}%
  Dividend yield: ${company.dividendYield ?? "n/a"}%
  Debt: ₹${company.debt ?? "n/a"} Cr
  52W range: ₹${company.low52w ?? "n/a"} – ₹${company.high52w ?? "n/a"}`;
}

/* -------------------------------------------------------------------------- */
/* Deep analysis prompt                                                        */
/* -------------------------------------------------------------------------- */

export interface DeepAnalysisInput {
  quote: Quote;
  fundamentals: FundamentalsData;
  peers: PeerComparison | null;
  screenerIn?: ScreenerInCompany | null;
}

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

export async function deepAnalysis(input: DeepAnalysisInput): Promise<DeepAnalysisResult> {
  const { quote, fundamentals, peers, screenerIn } = input;

  const blocks = [
    snapshotBlock(fundamentals, quote),
    scoreBlock(fundamentals),
    analystBlock(fundamentals),
    insiderBlock(fundamentals),
    statementsBlock(fundamentals),
    peers && peers.peerCount > 0 ? peerBlock(peers) : null,
    screenerIn ? screenerInBlock(screenerIn) : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `You are a senior equity research analyst. Using ONLY the structured data below, write a comprehensive research note on ${quote.symbol} (${quote.name}).

${blocks}

Write a structured research note with exactly these six sections. Be specific — cite numbers from the data. Keep each section 3-5 sentences.

1. SUMMARY
One-paragraph executive summary of the investment case.

2. INVESTMENT_CASE
Key reasons to own (or avoid) this stock. Reference the composite score, revenue growth, margins.

3. COMPETITIVE_POSITION
How does this stock compare to sector peers? Reference the peer comparison data specifically.

4. RISKS
Top 3 risks based on the risk heatmap and financial data. Be specific.

5. KEY_METRICS
The 4-5 most important metrics for this specific company and why they matter.

6. VERDICT
One clear sentence: Buy / Hold / Sell with price target context from the analyst consensus.

Format your response as JSON:
{
  "summary": "...",
  "investmentCase": "...",
  "competitivePosition": "...",
  "risks": "...",
  "keyMetrics": "...",
  "verdict": "..."
}`;

  const model = getActiveModelName();

  const raw = await runPrompt(prompt, { maxTokens: 1500, json: true });

  let sections: DeepAnalysisResult["sections"];
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    sections = JSON.parse(cleaned) as DeepAnalysisResult["sections"];
  } catch {
    // Fallback: treat raw text as summary
    sections = {
      summary: raw,
      investmentCase: "",
      competitivePosition: "",
      risks: "",
      keyMetrics: "",
      verdict: "",
    };
  }

  return { model, sections, rawText: raw };
}

/* -------------------------------------------------------------------------- */
/* Chat with data                                                              */
/* -------------------------------------------------------------------------- */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatInput {
  quote: Quote;
  fundamentals: FundamentalsData;
  peers: PeerComparison | null;
  screenerIn?: ScreenerInCompany | null;
  history: ChatMessage[];
  question: string;
}

export async function chatWithData(input: ChatInput): Promise<{ answer: string; model: string }> {
  const { quote, fundamentals, peers, screenerIn, history, question } = input;

  const blocks = [
    snapshotBlock(fundamentals, quote),
    scoreBlock(fundamentals),
    analystBlock(fundamentals),
    statementsBlock(fundamentals),
    peers && peers.peerCount > 0 ? peerBlock(peers) : null,
    screenerIn ? screenerInBlock(screenerIn) : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const system = `You are an expert equity research analyst. You have access to structured financial data for ${quote.symbol} (${quote.name}) shown below. Answer questions using ONLY this data. Be precise and cite specific numbers. If data is missing, say so clearly. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${blocks}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const model = getActiveModelName();

  const answer = await runPrompt(fullPrompt, { maxTokens: 800 });
  return { answer: answer.trim(), model };
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

  const model = getActiveModelName();

  const raw = await runPrompt(prompt, { maxTokens: 1500, json: true });

  let sections: DeepAnalysisResult["sections"];
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    sections = JSON.parse(cleaned) as DeepAnalysisResult["sections"];
  } catch {
    sections = {
      summary: raw,
      investmentCase: "",
      competitivePosition: "",
      risks: "",
      keyMetrics: "",
      verdict: "",
    };
  }

  return { model, sections, rawText: raw };
}

export async function indianChatWithData(
  input: Omit<ChatInput, "fundamentals" | "peers"> & { company: ScreenerInCompany; derived: IndianDeepAnalysisInput["derived"] },
): Promise<{ answer: string; model: string }> {
  const { company, derived, quote, screenerIn, history, question } = input;

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

  const model = getActiveModelName();

  const answer = await runPrompt(fullPrompt, { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
