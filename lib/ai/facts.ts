/**
 * The evidence block — the exact set of facts every AI feature reasons over.
 *
 * Extracted from `app/api/ai/verdict/route.ts` so the single-shot verdict and
 * the streamed sectioned report are grounded in *identical* data. If these were
 * two separate builders they would drift, and a streamed report would quietly
 * stop matching the non-streamed one — precisely the failure mode the streaming
 * work is required not to introduce.
 *
 * This is also what `lib/ai/grounding.ts` verifies generated prose against, so
 * every figure the model writes must trace back to a line produced here.
 */

import { formatCompactCurrency, formatCurrency, formatRatio } from "../format";
import type { CompanyContext } from "./types";
import { evidenceBuckets } from "../score-math";

/** Portfolio personalization passed through from the client (IOS-computed, per user). */
export interface PortfolioFacts {
  fitScore: string | null;
  fitTier: string | null;
  reasons: string | null;
  isInPortfolio: boolean;
  suggestedPct: string | null;
  missingSectors: string | null;
  objective: string | null;
  /** The unified action (lib/ios/unified-action.ts) — the ONE decision derived
   *  from Research Score × Portfolio Fit. The prompt pins the model to it. */
  action: string | null;
  /** The unified action's quantitative rationale (cites both scores). */
  actionReason: string | null;
}

export function hasPortfolioContext(p: PortfolioFacts | null): p is PortfolioFacts {
  return !!(p && p.fitScore && p.fitTier);
}

/** The company's fundamental/technical/analyst evidence, one fact per line. */
export function buildEquityFacts(ctx: CompanyContext): string[] {
  const q = ctx.quote;
  const s = ctx.snapshot;
  const score = ctx.score;
  const momentum = ctx.momentum;
  const analyst = ctx.analyst;

  const facts: string[] = [
    `Company: ${ctx.name} (${ctx.symbol})`,
    `Price: ${formatCurrency(q.price, q.currency)} (${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}% today)`,
    `Market cap: ${formatCompactCurrency(q.marketCap, q.currency)}`,
  ];

  if (s) {
    // formatRatio matches the UI's ratio rendering (2dp + "x") so the model
    // quotes the same figure the page shows — never "8.1x" beside "8.13x".
    if (s.forwardPE != null) facts.push(`Forward P/E: ${formatRatio(s.forwardPE)}`);
    if (s.trailingPE != null) facts.push(`Trailing P/E: ${formatRatio(s.trailingPE)}`);
    if (s.priceToBook != null) facts.push(`P/B ratio: ${formatRatio(s.priceToBook)}`);
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
    // Only buckets with a real reading. An all-padding bucket sums to ~50%
    // and would otherwise be narrated as a genuine mid-pack score.
    const real = evidenceBuckets(score.buckets);
    facts.push(
      real.length
        ? `Score breakdown: ${real.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}`
        : "Score breakdown: unavailable — no fundamental factor for this instrument has data.",
    );
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
    if (analyst.upsidePercent != null) facts.push(`Analyst upside: ${analyst.upsidePercent >= 0 ? "+" : ""}${analyst.upsidePercent.toFixed(1)}%`);
    const bullish = analyst.strongBuy + analyst.buy;
    const bearish = analyst.sell + analyst.strongSell;
    const total = bullish + analyst.hold + bearish;
    // Total is stated alongside the split so the model cannot pair the split
    // with a different analyst count from another line ("16 of 23" over a
    // 4+12+8 = 24 breakdown).
    facts.push(`Ratings breakdown: ${bullish} buy, ${analyst.hold} hold, ${bearish} sell (${total} analysts total)`);
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

  return facts;
}

/** The user's-portfolio half of the evidence block. Empty when no portfolio context was supplied. */
export function buildPortfolioFacts(symbol: string, p: PortfolioFacts | null): string[] {
  if (!hasPortfolioContext(p)) return [];

  const out: string[] = ["--- PORTFOLIO CONTEXT (this user's specific situation) ---"];
  if (p.objective) out.push(`User's investment objective: ${p.objective.replace(/_/g, " ")}`);
  out.push(`Portfolio fit score for ${symbol}: ${p.fitScore}/100 (${p.fitTier}) — inherits the research score, adjusted for this portfolio`);
  out.push(`Already held in portfolio: ${p.isInPortfolio ? "Yes" : "No"}`);
  if (p.reasons) out.push(`Why it fits: ${p.reasons}`);
  if (p.action) {
    out.push(
      `Computed portfolio decision for ${symbol}: ${p.action.toUpperCase()}${p.suggestedPct ? ` at ${p.suggestedPct}% of portfolio` : ""} — settled by the deterministic engines, not open for revision`,
    );
  }
  if (p.actionReason) out.push(`Decision rationale: ${p.actionReason}`);
  if (p.suggestedPct) out.push(`IOS-suggested allocation: ${p.suggestedPct}% of portfolio`);
  if (p.missingSectors) out.push(`Sectors the user is missing entirely: ${p.missingSectors}`);
  return out;
}

/** Read portfolio context off a request URL — shared by the verdict and report routes. */
export function readPortfolioFacts(url: URL): PortfolioFacts {
  return {
    fitScore: url.searchParams.get("fitScore"),
    fitTier: url.searchParams.get("fitTier"),
    reasons: url.searchParams.get("reasons"),
    isInPortfolio: url.searchParams.get("isInPortfolio") === "true",
    suggestedPct: url.searchParams.get("suggestedPct"),
    missingSectors: url.searchParams.get("missingSectors"),
    objective: url.searchParams.get("objective"),
    action: url.searchParams.get("action"),
    actionReason: url.searchParams.get("actionReason"),
  };
}
