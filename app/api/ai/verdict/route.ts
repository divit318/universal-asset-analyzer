import { NextResponse } from "next/server";
import { buildCompanyContext } from "@/lib/ai/context";
import { readPortfolioFacts } from "@/lib/ai/facts";
import { buildVerdictPrompt } from "@/lib/ai/report-sections";
import { runPrompt } from "@/lib/ai";
import { extractJsonObject } from "@/lib/json-extract";
import { normalizeSymbol } from "@/lib/market";
import { detectAssetClass } from "@/lib/asset-class";
import { formatCurrency, formatMarketCap } from "@/lib/format";
import { verifyGrounding, collectClaimText, type GroundingReport } from "@/lib/ai/grounding";
import { getFundProfile, getHistory, getMacroSummary } from "@/lib/yahoo";
import { computeFundScore } from "@/lib/fund-scoring";
import { computeCryptoScore } from "@/lib/crypto-scoring";
import { computeCommodityScore } from "@/lib/commodity-scoring";
import { COMMODITY_BENCHMARK_SYMBOL } from "@/lib/research-engines/commodity";
import { computeForexScore, DOLLAR_INDEX_SYMBOL } from "@/lib/forex-scoring";
import type { NewsItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface InvestmentVerdict {
  verdict: "bullish" | "bearish" | "neutral";
  headline: string;
  thesis: string;
  catalysts: string[];
  risks: string[];
  confidence: "high" | "medium" | "low";
  timeHorizon: "short-term" | "medium-term" | "long-term";
  keyMetrics: Array<{ label: string; value: string; signal: "positive" | "negative" | "neutral" }>;
  /** Verification that the verdict's figures trace back to the source data.
   *  Absent when Ollama was offline (nothing was generated to verify). */
  grounding?: GroundingReport;
  model: string;
  generatedAt: string;
}

/**
 * Fund-grounded verdict: same JSON schema and grounding-verification
 * mechanism as the equity path, but facts/prompt built from FundProfileData +
 * computeFundScore() instead of equity snapshot/analyst/score.
 */
async function respondWithFundVerdict(
  symbol: string,
  name: string,
  quote: { price: number; currency: string; changePercent: number },
): Promise<NextResponse> {
  const [fund, history] = await Promise.all([getFundProfile(symbol), getHistory(symbol, 730)]);
  const score = computeFundScore(fund, history);

  const facts: string[] = [
    `Fund: ${name} (${symbol})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Total net assets: ${fund.totalNetAssets != null ? `$${(fund.totalNetAssets / 1e9).toFixed(1)}B` : "n/a"}`,
    `Category: ${fund.category ?? "n/a"}`,
    `Expense ratio: ${fund.expenseRatio != null ? `${(fund.expenseRatio * 100).toFixed(2)}%` : "n/a"}`,
    `Fund score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    `Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}`,
    `Top holdings: ${fund.holdings.slice(0, 5).map((h) => `${h.symbol} ${h.weightPercent.toFixed(1)}%`).join(", ") || "n/a"}`,
    `Top-10 concentration: ${fund.holdings.slice(0, 10).reduce((s, h) => s + h.weightPercent, 0).toFixed(0)}%`,
    `Top sector: ${fund.sectorWeights[0] ? `${fund.sectorWeights[0].sector} ${fund.sectorWeights[0].weightPercent.toFixed(0)}%` : "n/a"}`,
    `1-year return: ${fund.trailingReturns.oneYear != null ? `${fund.trailingReturns.oneYear >= 0 ? "+" : ""}${fund.trailingReturns.oneYear.toFixed(1)}%` : "n/a"}`,
    `1-year return vs category: ${fund.categoryRelativeReturns.oneYear != null ? `${fund.categoryRelativeReturns.oneYear >= 0 ? "+" : ""}${fund.categoryRelativeReturns.oneYear.toFixed(1)}pp` : "n/a"}`,
    `Risk: beta ${fund.risk?.beta?.toFixed(2) ?? "n/a"}, Sharpe ${fund.risk?.sharpeRatio?.toFixed(2) ?? "n/a"}`,
  ];

  const prompt = `You are a fund analyst. Based ONLY on the data below, generate a structured investment verdict for this fund.

DATA:
${facts.join("\n")}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON:
{
  "verdict": "bullish" or "bearish" or "neutral",
  "headline": "Decisive 10-14 word investment thesis naming the fund and the core reason",
  "thesis": "2-3 sentences: the investment case with specific metrics cited from the data",
  "catalysts": ["specific reason to hold citing a number or fact", "reason 2", "reason 3"],
  "risks": ["specific risk citing a number or fact", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ]
}

REQUIREMENTS:
- verdict: bullish if fund score>65; bearish if fund score<40; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers from the data (cost, concentration, performance vs category). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering cost + diversification + performance vs category + risk-adjusted quality + momentum
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data`;

  const fallbackVerdict: InvestmentVerdict["verdict"] =
    score.composite > 65 ? "bullish" : score.composite < 40 ? "bearish" : "neutral";

  let parsed: Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">;
  let grounding: GroundingReport | undefined;

  try {
    const raw = await runPrompt("fund-research", prompt, { json: true, maxTokens: 800 });
    parsed = extractJsonObject(raw, {
      verdict: fallbackVerdict,
      headline: `${name}: AI verdict`,
      thesis: "",
      catalysts: [] as string[],
      risks: [] as string[],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [] as InvestmentVerdict["keyMetrics"],
    } satisfies Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">);

    const claims = collectClaimText([
      parsed.headline,
      parsed.thesis,
      parsed.catalysts,
      parsed.risks,
      parsed.keyMetrics.map((m) => `${m.label} ${m.value}`),
    ]);
    grounding = verifyGrounding(claims, facts.join("\n"));
  } catch {
    parsed = {
      verdict: fallbackVerdict,
      headline: `${name}: Start Ollama to generate the AI investment verdict`,
      thesis: "Run `ollama serve` in your terminal, then refresh to generate the AI analysis for this fund.",
      catalysts: ["Ollama offline — start with `ollama serve`", "Refresh page after Ollama starts", "AI verdict generates automatically"],
      risks: ["AI analysis unavailable", "Review the fund score below", "Check Ollama status badge in the header"],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [],
    };
  }

  return NextResponse.json({
    ...parsed,
    grounding,
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies InvestmentVerdict);
}

/**
 * Crypto-grounded verdict: same JSON schema and grounding-verification
 * mechanism, but facts/prompt built from computeCryptoScore() (market-data
 * only) instead of equity snapshot/analyst/score — same fix as the fund
 * verdict above, for the same "two contradictory headline scores" reason.
 */
async function respondWithCryptoVerdict(
  symbol: string,
  name: string,
  quote: { price: number; currency: string; changePercent: number; marketCap: number | null },
): Promise<NextResponse> {
  const isBtc = symbol.toUpperCase().startsWith("BTC-USD");
  const [history, btcHistory] = await Promise.all([
    getHistory(symbol, 730),
    isBtc ? Promise.resolve([]) : getHistory("BTC-USD", 730),
  ]);
  const score = computeCryptoScore(symbol, history, btcHistory.length > 0 ? btcHistory : null);

  const facts: string[] = [
    `Crypto asset: ${name} (${symbol})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Market cap: ${formatMarketCap(quote.marketCap)}`,
    `Crypto score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    `Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}`,
    ...score.buckets.flatMap((b) => b.factors.filter((f) => f.detail && f.detail !== "n/a").map((f) => `${f.label}: ${f.detail}`)),
    "This analysis is market-data only — no tokenomics, on-chain, or developer-activity data is available.",
  ];

  const prompt = `You are a crypto markets analyst. Based ONLY on the data below, generate a structured investment verdict for this crypto asset.

DATA:
${facts.join("\n")}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON:
{
  "verdict": "bullish" or "bearish" or "neutral",
  "headline": "Decisive 10-14 word investment thesis naming the asset and the core reason",
  "thesis": "2-3 sentences: the investment case with specific metrics cited from the data",
  "catalysts": ["specific reason to hold citing a number or fact", "reason 2", "reason 3"],
  "risks": ["specific risk citing a number or fact", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ]
}

REQUIREMENTS:
- verdict: bullish if crypto score>65; bearish if crypto score<40; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers from the data (momentum, relative strength vs BTC, volatility, drawdown). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering momentum + relative strength vs BTC + risk-adjusted return + drawdown risk + volatility
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent tokenomics, on-chain, or developer-activity figures — that data isn't available`;

  const fallbackVerdict: InvestmentVerdict["verdict"] =
    score.composite > 65 ? "bullish" : score.composite < 40 ? "bearish" : "neutral";

  let parsed: Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">;
  let grounding: GroundingReport | undefined;

  try {
    const raw = await runPrompt("crypto-research", prompt, { json: true, maxTokens: 800 });
    parsed = extractJsonObject(raw, {
      verdict: fallbackVerdict,
      headline: `${name}: AI verdict`,
      thesis: "",
      catalysts: [] as string[],
      risks: [] as string[],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [] as InvestmentVerdict["keyMetrics"],
    } satisfies Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">);

    const claims = collectClaimText([
      parsed.headline,
      parsed.thesis,
      parsed.catalysts,
      parsed.risks,
      parsed.keyMetrics.map((m) => `${m.label} ${m.value}`),
    ]);
    grounding = verifyGrounding(claims, facts.join("\n"));
  } catch {
    parsed = {
      verdict: fallbackVerdict,
      headline: `${name}: Start Ollama to generate the AI investment verdict`,
      thesis: "Run `ollama serve` in your terminal, then refresh to generate the AI analysis for this asset.",
      catalysts: ["Ollama offline — start with `ollama serve`", "Refresh page after Ollama starts", "AI verdict generates automatically"],
      risks: ["AI analysis unavailable", "Review the crypto score below", "Check Ollama status badge in the header"],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [],
    };
  }

  return NextResponse.json({
    ...parsed,
    grounding,
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies InvestmentVerdict);
}

/**
 * Commodity-grounded verdict: same schema/grounding as crypto's, but facts
 * built from computeCommodityScore() plus recent news (for the honest
 * supply/demand caveat) instead of equity snapshot/analyst/score.
 */
async function respondWithCommodityVerdict(
  symbol: string,
  name: string,
  quote: { price: number; currency: string; changePercent: number },
  news: NewsItem[],
): Promise<NextResponse> {
  const [history, benchmarkHistory] = await Promise.all([
    getHistory(symbol, 730),
    getHistory(COMMODITY_BENCHMARK_SYMBOL, 730),
  ]);
  const score = computeCommodityScore(history, benchmarkHistory.length > 0 ? benchmarkHistory : null);

  const facts: string[] = [
    `Commodity: ${name} (${symbol})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Commodity score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    `Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}`,
    ...score.buckets.flatMap((b) => b.factors.filter((f) => f.detail && f.detail !== "n/a").map((f) => `${f.label}: ${f.detail}`)),
    news.length > 0
      ? `Recent news: ${news.slice(0, 5).map((n) => n.headline).join(" | ")}`
      : "Recent news: none available",
    "The score is market-data only — no inventory, production, or futures-curve data is available; use the news headlines above (if any) for supply/demand context, do not invent figures.",
  ];

  const prompt = `You are a commodities markets analyst. Based ONLY on the data below, generate a structured investment verdict for this commodity.

DATA:
${facts.join("\n")}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON:
{
  "verdict": "bullish" or "bearish" or "neutral",
  "headline": "Decisive 10-14 word investment thesis naming the commodity and the core reason",
  "thesis": "2-3 sentences: the investment case with specific metrics cited from the data",
  "catalysts": ["specific reason to hold citing a number or fact or headline", "reason 2", "reason 3"],
  "risks": ["specific risk citing a number or fact or headline", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ]
}

REQUIREMENTS:
- verdict: bullish if commodity score>65; bearish if commodity score<40; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers or headlines from the data (momentum, relative strength vs commodity index, volatility, drawdown, or recent news). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering momentum + relative strength vs commodity index + risk-adjusted return + drawdown risk + volatility
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent inventory, production, or futures-curve figures — that data isn't available`;

  const fallbackVerdict: InvestmentVerdict["verdict"] =
    score.composite > 65 ? "bullish" : score.composite < 40 ? "bearish" : "neutral";

  let parsed: Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">;
  let grounding: GroundingReport | undefined;

  try {
    const raw = await runPrompt("commodity-research", prompt, { json: true, maxTokens: 800 });
    parsed = extractJsonObject(raw, {
      verdict: fallbackVerdict,
      headline: `${name}: AI verdict`,
      thesis: "",
      catalysts: [] as string[],
      risks: [] as string[],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [] as InvestmentVerdict["keyMetrics"],
    } satisfies Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">);

    const claims = collectClaimText([
      parsed.headline,
      parsed.thesis,
      parsed.catalysts,
      parsed.risks,
      parsed.keyMetrics.map((m) => `${m.label} ${m.value}`),
    ]);
    grounding = verifyGrounding(claims, facts.join("\n"));
  } catch {
    parsed = {
      verdict: fallbackVerdict,
      headline: `${name}: Start Ollama to generate the AI investment verdict`,
      thesis: "Run `ollama serve` in your terminal, then refresh to generate the AI analysis for this commodity.",
      catalysts: ["Ollama offline — start with `ollama serve`", "Refresh page after Ollama starts", "AI verdict generates automatically"],
      risks: ["AI analysis unavailable", "Review the commodity score below", "Check Ollama status badge in the header"],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [],
    };
  }

  return NextResponse.json({
    ...parsed,
    grounding,
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies InvestmentVerdict);
}

/**
 * Forex-grounded verdict: same schema/grounding as commodity's, but facts
 * built from computeForexScore() plus recent news (for the honest central-
 * bank/rates caveat) instead of equity snapshot/analyst/score.
 */
async function respondWithForexVerdict(
  symbol: string,
  name: string,
  quote: { price: number; currency: string; changePercent: number },
  news: NewsItem[],
): Promise<NextResponse> {
  const isDxy = symbol.toUpperCase() === DOLLAR_INDEX_SYMBOL.toUpperCase();
  const [history, benchmarkHistory] = await Promise.all([
    getHistory(symbol, 730),
    isDxy ? Promise.resolve([]) : getHistory(DOLLAR_INDEX_SYMBOL, 730),
  ]);
  const score = computeForexScore(symbol, history, benchmarkHistory.length > 0 ? benchmarkHistory : null);

  const facts: string[] = [
    `Currency pair: ${name} (${symbol})`,
    `Rate: ${quote.price} ${quote.currency} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Forex score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    `Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}`,
    ...score.buckets.flatMap((b) => b.factors.filter((f) => f.detail && f.detail !== "n/a").map((f) => `${f.label}: ${f.detail}`)),
    news.length > 0
      ? `Recent news: ${news.slice(0, 5).map((n) => n.headline).join(" | ")}`
      : "Recent news: none available",
    "The score is market-data only — no central bank policy, inflation, GDP, or interest-rate data is available; use the news headlines above (if any) for macro context, do not invent figures.",
  ];

  const prompt = `You are a currency markets analyst. Based ONLY on the data below, generate a structured investment verdict for this currency pair.

DATA:
${facts.join("\n")}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON:
{
  "verdict": "bullish" or "bearish" or "neutral",
  "headline": "Decisive 10-14 word investment thesis naming the currency pair and the core reason",
  "thesis": "2-3 sentences: the investment case with specific metrics cited from the data",
  "catalysts": ["specific reason to hold citing a number or fact or headline", "reason 2", "reason 3"],
  "risks": ["specific risk citing a number or fact or headline", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ]
}

REQUIREMENTS:
- verdict: bullish if forex score>65; bearish if forex score<40; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers or headlines from the data (momentum, relative strength vs Dollar Index, volatility, drawdown, or recent news). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering momentum + relative strength vs Dollar Index + risk-adjusted return + drawdown risk + volatility
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent central bank policy, inflation, GDP, or interest-rate figures — that data isn't available`;

  const fallbackVerdict: InvestmentVerdict["verdict"] =
    score.composite > 65 ? "bullish" : score.composite < 40 ? "bearish" : "neutral";

  let parsed: Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">;
  let grounding: GroundingReport | undefined;

  try {
    const raw = await runPrompt("forex-research", prompt, { json: true, maxTokens: 800 });
    parsed = extractJsonObject(raw, {
      verdict: fallbackVerdict,
      headline: `${name}: AI verdict`,
      thesis: "",
      catalysts: [] as string[],
      risks: [] as string[],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [] as InvestmentVerdict["keyMetrics"],
    } satisfies Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">);

    const claims = collectClaimText([
      parsed.headline,
      parsed.thesis,
      parsed.catalysts,
      parsed.risks,
      parsed.keyMetrics.map((m) => `${m.label} ${m.value}`),
    ]);
    grounding = verifyGrounding(claims, facts.join("\n"));
  } catch {
    parsed = {
      verdict: fallbackVerdict,
      headline: `${name}: Start Ollama to generate the AI investment verdict`,
      thesis: "Run `ollama serve` in your terminal, then refresh to generate the AI analysis for this currency pair.",
      catalysts: ["Ollama offline — start with `ollama serve`", "Refresh page after Ollama starts", "AI verdict generates automatically"],
      risks: ["AI analysis unavailable", "Review the forex score below", "Check Ollama status badge in the header"],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [],
    };
  }

  return NextResponse.json({
    ...parsed,
    grounding,
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies InvestmentVerdict);
}

/**
 * Macro-grounded verdict: same schema/grounding as the others, but there's
 * no 0-100 score to threshold — a yield curve has no BUY/SELL call. The
 * fallback verdict (used only if Ollama is offline/parsing fails) is based
 * on curve shape instead: inverted curves have historically preceded US
 * recessions, so that maps to "bearish" (on growth outlook, not a security).
 */
async function respondWithMacroVerdict(name: string, news: NewsItem[]): Promise<NextResponse> {
  const summary = await getMacroSummary();

  const curveLines = summary.curve
    .map((p) => `${p.label} (${p.symbol}): ${p.yieldPercent != null ? `${p.yieldPercent.toFixed(2)}%` : "n/a"}`)
    .join(", ");

  const facts: string[] = [
    `US Treasury yield curve: ${curveLines}`,
    `10-Year minus 3-Month spread: ${summary.tenYearMinusThreeMonth != null ? `${summary.tenYearMinusThreeMonth >= 0 ? "+" : ""}${summary.tenYearMinusThreeMonth.toFixed(2)}pp` : "n/a"}`,
    `Curve shape: ${summary.shape ?? "n/a"}`,
    `Curve trend (vs ~20 trading days ago): ${summary.curveTrend ?? "n/a"}`,
    news.length > 0
      ? `Recent news: ${news.slice(0, 5).map((n) => n.headline).join(" | ")}`
      : "Recent news: none available",
    "No CPI, GDP, payrolls, or Fed policy-decision data is available; use the news headlines above (if any) for that context, do not invent figures.",
  ];

  const prompt = `You are a macroeconomics analyst. Based ONLY on the data below, generate a structured verdict on what the current yield curve and macro news suggest about the growth/recession outlook. This is NOT a directional call on a security — "bullish"/"bearish" here means bullish/bearish on the growth outlook, not a buy/sell recommendation.

DATA:
${facts.join("\n")}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON:
{
  "verdict": "bullish" or "bearish" or "neutral",
  "headline": "Decisive 10-14 word summary of what the curve/macro picture signals",
  "thesis": "2-3 sentences: the macro case with specific numbers cited from the data",
  "catalysts": ["specific supportive fact citing a number or headline", "fact 2", "fact 3"],
  "risks": ["specific risk/concern citing a number or headline", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ]
}

REQUIREMENTS:
- verdict: bearish (on growth outlook) if the curve is inverted; bullish if normal and steepening; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real call about the growth outlook
- catalysts + risks: MUST cite specific numbers or headlines from the data (yield levels, spread, curve shape/trend, or recent news). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering the 4 tenor yields plus the 10y-3m spread
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent CPI, GDP, payrolls, or Fed policy-decision figures — that data isn't available`;

  const fallbackVerdict: InvestmentVerdict["verdict"] =
    summary.shape === "inverted" ? "bearish" : summary.shape === "normal" && summary.curveTrend === "steepening" ? "bullish" : "neutral";

  let parsed: Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">;
  let grounding: GroundingReport | undefined;

  try {
    const raw = await runPrompt("macro-research", prompt, { json: true, maxTokens: 800 });
    parsed = extractJsonObject(raw, {
      verdict: fallbackVerdict,
      headline: `${name}: AI verdict`,
      thesis: "",
      catalysts: [] as string[],
      risks: [] as string[],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [] as InvestmentVerdict["keyMetrics"],
    } satisfies Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">);

    const claims = collectClaimText([
      parsed.headline,
      parsed.thesis,
      parsed.catalysts,
      parsed.risks,
      parsed.keyMetrics.map((m) => `${m.label} ${m.value}`),
    ]);
    grounding = verifyGrounding(claims, facts.join("\n"));
  } catch {
    parsed = {
      verdict: fallbackVerdict,
      headline: `${name}: Start Ollama to generate the AI investment verdict`,
      thesis: "Run `ollama serve` in your terminal, then refresh to generate the AI analysis for the yield curve.",
      catalysts: ["Ollama offline — start with `ollama serve`", "Refresh page after Ollama starts", "AI verdict generates automatically"],
      risks: ["AI analysis unavailable", "Review the yield curve below", "Check Ollama status badge in the header"],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [],
    };
  }

  return NextResponse.json({
    ...parsed,
    grounding,
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies InvestmentVerdict);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });

  // Portfolio context passed from the client (IOS-computed, per user).
  const portfolio = readPortfolioFacts(url);

  let ctx;
  try {
    ctx = await buildCompanyContext(symbol);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load data" },
      { status: 404 },
    );
  }

  // Funds/crypto: the equity ctx.score computed above is meaningless (built
  // from mostly-null equity fundamentals) and must never be shown alongside
  // an asset-class-native score — that's precisely the "two contradictory
  // headline scores" bug the India research path was built to avoid.
  const verdictAssetClass = detectAssetClass(ctx.quote);
  if (verdictAssetClass === "fund") {
    return respondWithFundVerdict(ctx.symbol, ctx.name, ctx.quote);
  }
  if (verdictAssetClass === "crypto") {
    return respondWithCryptoVerdict(ctx.symbol, ctx.name, ctx.quote);
  }
  if (verdictAssetClass === "commodity") {
    return respondWithCommodityVerdict(ctx.symbol, ctx.name, ctx.quote, ctx.news);
  }
  if (verdictAssetClass === "forex") {
    return respondWithForexVerdict(ctx.symbol, ctx.name, ctx.quote, ctx.news);
  }
  if (verdictAssetClass === "macro") {
    return respondWithMacroVerdict(ctx.name, ctx.news);
  }

  // Prompt + evidence come from the SHARED builder (lib/ai/report-sections.ts),
  // which the streamed /api/ai/report route also uses. One prompt, one schema,
  // one evidence block — so "the streamed report is identical to the
  // non-streamed one" is structurally true rather than merely intended.
  const score = ctx.score;
  const { prompt, evidence } = buildVerdictPrompt(ctx, portfolio);

  const fallbackVerdict: InvestmentVerdict["verdict"] = score
    ? score.composite > 65 ? "bullish" : score.composite < 40 ? "bearish" : "neutral"
    : "neutral";

  let parsed: Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">;
  let grounding: GroundingReport | undefined;

  try {
    const raw = await runPrompt("investment-thesis", prompt, { json: true, maxTokens: 800 });
    // Coerce against a complete default shape: the model can return valid JSON
    // that omits array fields (catalysts/risks/keyMetrics) which the research
    // page then .map()s over — a bare cast would crash the page on those.
    parsed = extractJsonObject(raw, {
      verdict: fallbackVerdict,
      headline: `${ctx.name}: AI verdict`,
      thesis: "",
      catalysts: [] as string[],
      risks: [] as string[],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [] as InvestmentVerdict["keyMetrics"],
    } satisfies Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">);

    // Verify the generated prose against the exact facts the model was handed:
    // every figure in the thesis/catalysts/risks must trace to a data point.
    const claims = collectClaimText([
      parsed.headline,
      parsed.thesis,
      parsed.catalysts,
      parsed.risks,
      parsed.keyMetrics.map((m) => `${m.label} ${m.value}`),
    ]);
    grounding = verifyGrounding(claims, evidence);
  } catch {
    parsed = {
      verdict: fallbackVerdict,
      headline: `${ctx.name}: Start Ollama to generate the AI investment verdict`,
      thesis: "Run `ollama serve` in your terminal, then refresh to generate the AI analysis for this stock.",
      catalysts: ["Ollama offline — start with `ollama serve`", "Refresh page after Ollama starts", "AI verdict generates automatically"],
      risks: ["AI analysis unavailable", "Review metrics and score below", "Check Ollama status badge in the header"],
      confidence: "low",
      timeHorizon: "medium-term",
      keyMetrics: [],
    };
  }

  return NextResponse.json({
    ...parsed,
    grounding,
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies InvestmentVerdict);
}
