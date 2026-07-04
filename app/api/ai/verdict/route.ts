import { NextResponse } from "next/server";
import { buildCompanyContext } from "@/lib/ai/context";
import { runPrompt } from "@/lib/ai";
import { extractJson } from "@/lib/json-extract";
import { normalizeSymbol } from "@/lib/market";
import { formatCurrency, formatMarketCap } from "@/lib/format";

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
  model: string;
  generatedAt: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });

  // Portfolio context passed from the client (IOS-computed, per user).
  const fitScore     = url.searchParams.get("fitScore");
  const fitTier      = url.searchParams.get("fitTier");
  const fitReasons   = url.searchParams.get("reasons");
  const isInPortfolio = url.searchParams.get("isInPortfolio") === "true";
  const suggestedPct = url.searchParams.get("suggestedPct");
  const missingSectors = url.searchParams.get("missingSectors");
  const objective    = url.searchParams.get("objective");
  const hasPortfolioCtx = !!(fitScore && fitTier);

  let ctx;
  try {
    ctx = await buildCompanyContext(symbol);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load data" },
      { status: 404 },
    );
  }

  const q = ctx.quote;
  const s = ctx.snapshot;
  const score = ctx.score;
  const momentum = ctx.momentum;
  const analyst = ctx.analyst;

  const facts: string[] = [
    `Company: ${ctx.name} (${ctx.symbol})`,
    `Price: ${formatCurrency(q.price, q.currency)} (${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}% today)`,
    `Market cap: ${formatMarketCap(q.marketCap)}`,
  ];

  if (s) {
    if (s.forwardPE != null) facts.push(`Forward P/E: ${s.forwardPE.toFixed(1)}x`);
    if (s.trailingPE != null) facts.push(`Trailing P/E: ${s.trailingPE.toFixed(1)}x`);
    if (s.priceToBook != null) facts.push(`P/B ratio: ${s.priceToBook.toFixed(2)}x`);
    if (s.profitMargins != null) facts.push(`Net margin: ${(s.profitMargins * 100).toFixed(1)}%`);
    if (s.operatingMargins != null) facts.push(`Operating margin: ${(s.operatingMargins * 100).toFixed(1)}%`);
    if (s.grossMargins != null) facts.push(`Gross margin: ${(s.grossMargins * 100).toFixed(1)}%`);
    if (s.returnOnEquity != null) facts.push(`ROE: ${(s.returnOnEquity * 100).toFixed(1)}%`);
    if (s.returnOnAssets != null) facts.push(`ROA: ${(s.returnOnAssets * 100).toFixed(1)}%`);
    if (s.revenueGrowth != null) facts.push(`Revenue growth YoY: ${(s.revenueGrowth * 100).toFixed(1)}%`);
    if (s.earningsGrowth != null) facts.push(`EPS growth YoY: ${(s.earningsGrowth * 100).toFixed(1)}%`);
    if (s.debtToEquity != null) facts.push(`D/E ratio: ${s.debtToEquity.toFixed(2)}x`);
    if (s.currentRatio != null) facts.push(`Current ratio: ${s.currentRatio.toFixed(2)}x`);
    if (s.dividendYield != null && s.dividendYield > 0) facts.push(`Dividend yield: ${(s.dividendYield * 100).toFixed(2)}%`);
    if (s.enterpriseToEbitda != null) facts.push(`EV/EBITDA: ${s.enterpriseToEbitda.toFixed(1)}x`);
  }

  if (score) {
    facts.push(`Composite score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`);
    const bs = score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ");
    facts.push(`Score breakdown: ${bs}`);
    if (score.rationale) facts.push(`Score rationale: ${score.rationale}`);
  }

  if (momentum) {
    if (momentum.return3m != null) facts.push(`3-month return: ${momentum.return3m >= 0 ? "+" : ""}${momentum.return3m.toFixed(1)}%`);
    if (momentum.vsSma200 != null) facts.push(`vs SMA200: ${momentum.vsSma200 >= 0 ? "+" : ""}${momentum.vsSma200.toFixed(1)}%`);
    if (momentum.vsSma50 != null) facts.push(`vs SMA50: ${momentum.vsSma50 >= 0 ? "+" : ""}${momentum.vsSma50.toFixed(1)}%`);
    if (momentum.pctFrom52WkHigh != null) facts.push(`From 52-week high: ${momentum.pctFrom52WkHigh.toFixed(1)}%`);
    facts.push(`Price trend: ${momentum.trend}`);
  }

  if (analyst) {
    if (analyst.recommendationKey) {
      facts.push(`Analyst consensus: ${analyst.recommendationKey.replace(/_/g, " ")} (${analyst.numberOfOpinions ?? "?"} analysts)`);
    }
    if (analyst.targetMean != null) facts.push(`Price target: ${formatCurrency(analyst.targetMean, q.currency)}`);
    if (analyst.upsidePercent != null) facts.push(`Analyst upside: ${analyst.upsidePercent >= 0 ? "+" : ""}${analyst.upsidePercent.toFixed(0)}%`);
    const bullish = analyst.strongBuy + analyst.buy;
    const bearish = analyst.sell + analyst.strongSell;
    facts.push(`Ratings breakdown: ${bullish} buy, ${analyst.hold} hold, ${bearish} sell`);
  }

  const highRisks = ctx.risks.filter((r) => r.level === "high");
  const medRisks = ctx.risks.filter((r) => r.level === "medium");
  if (highRisks.length > 0) {
    facts.push(`High-severity risks: ${highRisks.map((r) => `${r.category} — ${r.reason}`).join("; ")}`);
  }
  if (medRisks.length > 0) {
    facts.push(`Medium risks: ${medRisks.map((r) => r.category).join(", ")}`);
  }

  const topNews = ctx.news.slice(0, 3).map((n) => n.headline);
  if (topNews.length > 0) facts.push(`Recent news: ${topNews.join(" | ")}`);

  // Portfolio context — personalizes the verdict to this specific user's portfolio.
  const portfolioFacts: string[] = [];
  if (hasPortfolioCtx) {
    portfolioFacts.push(`--- PORTFOLIO CONTEXT (this user's specific situation) ---`);
    if (objective) portfolioFacts.push(`User's investment objective: ${objective.replace(/_/g, " ")}`);
    portfolioFacts.push(`Portfolio fit score for ${ctx.symbol}: ${fitScore}/100 (${fitTier})`);
    portfolioFacts.push(`Already held in portfolio: ${isInPortfolio ? "Yes" : "No"}`);
    if (fitReasons) portfolioFacts.push(`Why it fits: ${fitReasons}`);
    if (suggestedPct) portfolioFacts.push(`IOS-suggested allocation: ${suggestedPct}% of portfolio`);
    if (missingSectors) portfolioFacts.push(`Sectors the user is missing entirely: ${missingSectors}`);
  }

  const portfolioInstructions = hasPortfolioCtx
    ? `
PORTFOLIO PERSONALIZATION (mandatory):
- The headline MUST be personalized: reference this user's portfolio context (e.g., "fills your missing [sector] gap", "adds to existing position", "low correlation with your tech-heavy portfolio")
- The thesis MUST include 1 sentence about how this fits or doesn't fit this user's specific portfolio
- If it fills a missing sector, call that out explicitly
- Recommend position sizing consistent with the IOS-suggested allocation of ${suggestedPct ?? "N/A"}%
- If already held: frame as "add to position" vs "initiate new position"`
    : "";

  const prompt = `You are an institutional buy-side equity analyst. Based ONLY on the data below, generate a structured investment verdict.

DATA:
${facts.join("\n")}
${portfolioFacts.length > 0 ? "\n" + portfolioFacts.join("\n") : ""}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON:
{
  "verdict": "bullish" or "bearish" or "neutral",
  "headline": "Decisive 10-14 word investment thesis naming the company and the core reason",
  "thesis": "2-3 sentences: the investment case with specific metrics cited from the data",
  "catalysts": ["specific catalyst citing a number or fact", "catalyst 2", "catalyst 3"],
  "risks": ["specific risk citing a number or fact", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ]
}

REQUIREMENTS:
- verdict: bullish if score>65 AND no high risks overwhelming thesis; bearish if score<40 OR multiple compounding high risks; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real investment call${hasPortfolioCtx ? " — MUST reference portfolio fit" : ""}
- catalysts + risks: MUST cite specific numbers from the data. Generic bullets will be rejected.
- keyMetrics: exactly 5, covering valuation + quality + growth + momentum + analyst
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data${portfolioInstructions}`;

  let parsed: Omit<InvestmentVerdict, "model" | "generatedAt">;

  try {
    const raw = await runPrompt(prompt, { json: true, maxTokens: 800 });
    parsed = extractJson<Omit<InvestmentVerdict, "model" | "generatedAt">>(raw);
  } catch {
    const v = score
      ? score.composite > 65 ? "bullish" : score.composite < 40 ? "bearish" : "neutral"
      : "neutral";
    parsed = {
      verdict: v,
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
    model: "ollama",
    generatedAt: new Date().toISOString(),
  } satisfies InvestmentVerdict);
}
