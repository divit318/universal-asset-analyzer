/**
 * Retrieval Layer — turns a CompanyContext + a question into the prioritized,
 * token-budgeted evidence that goes into the prompt.
 *
 * This is the deliberate, deterministic alternative to vector RAG: for a single
 * company the whole dataset fits in the model's window, so instead of embedding
 * similarity (an extra dependency + a fresh hallucination surface) we (1)
 * classify the question's intent, (2) format every source into labeled,
 * source-tagged blocks, (3) select + rank the blocks the intent needs, (4) rank
 * filings/news by relevance + recency, and (5) drop the lowest-priority blocks
 * until we're under budget. Every step is pure and unit-testable.
 */

import {
  formatCompact,
  formatCurrency,
  formatMarketCap,
  formatNumber,
  formatPercent,
} from "../format";
import { describeOwnership } from "../ownership-insight";
import { getScannerCache } from "../db";
import type { MovementExplanation } from "../types";
import type { CompanyContext, ContextBlock, ResearchIntent } from "./types";

/* -------------------------------------------------------------------------- */
/* Intent classification                                                      */
/* -------------------------------------------------------------------------- */

/** Keyword → intent signals. First-match-wins order doesn't matter; we collect all. */
const INTENT_KEYWORDS: Record<ResearchIntent, string[]> = {
  valuation: ["valuation", "undervalued", "overvalued", "intrinsic", "fair value", "cheap", "expensive", "worth", "dcf", "multiple", "p/e", "pe ratio", "price target"],
  growth: ["growth", "grow", "expansion", "revenue growth", "top line", "cagr", "scaling", "tam"],
  profitability: ["profit", "margin", "profitability", "roe", "roic", "returns on", "efficiency"],
  financialHealth: ["balance sheet", "debt", "leverage", "liquidity", "solvency", "financial health", "cash position", "current ratio"],
  competitive: ["competitor", "competition", "competitive", "moat", "advantage", "market share", "rivals", "peers", "versus", "threat"],
  management: ["management", "ceo", "executive", "leadership", "founder", "board", "governance"],
  capitalAllocation: ["capital allocation", "buyback", "dividend", "repurchase", "reinvest", "m&a", "acquisition", "payout"],
  risks: ["risk", "risks", "downside", "bear", "danger", "concern", "threat", "decline", "could go wrong", "break the thesis"],
  catalysts: ["catalyst", "catalysts", "upside", "bull", "double", "tailwind", "growth driver", "could cause", "outperform"],
  thesis: ["thesis", "invest", "investment", "long term", "long-term", "buy", "hold", "sell", "buffett", "good investment", "should i"],
  earnings: ["earnings", "eps", "quarter", "results", "report", "guidance", "beat", "miss", "surprise"],
  filings: ["filing", "filings", "10-k", "10-q", "8-k", "sec", "annual report", "disclosure", "proxy"],
  news: ["news", "recent", "latest", "headline", "happening", "announced", "today"],
  ownership: ["ownership", "institutional", "insider", "holders", "who owns", "shareholders", "float"],
  technical: ["technical", "momentum", "trend", "moving average", "sma", "chart", "52-week", "52 week", "oversold", "overbought"],
  comparison: ["compare", "comparison", "versus", "vs", "relative to", "against", "better than"],
  general: [],
};

/**
 * Classify a free-text question into one or more research intents. Always
 * returns at least ["general"]. Pure / testable.
 */
export function classifyIntent(question: string): ResearchIntent[] {
  const q = question.toLowerCase();
  const hits: ResearchIntent[] = [];
  for (const [intent, words] of Object.entries(INTENT_KEYWORDS) as [ResearchIntent, string[]][]) {
    if (words.some((w) => q.includes(w))) hits.push(intent);
  }
  return hits.length > 0 ? hits : ["general"];
}

/* -------------------------------------------------------------------------- */
/* Block formatting helpers                                                   */
/* -------------------------------------------------------------------------- */

/** Trim long prose to a character budget on a word boundary. Pure. */
function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

/** Format a fraction (0.25) as a percent string ("25.0%"). */
const fpct = (v: number | null | undefined, digits = 1): string =>
  v == null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

/** Join "Label: value" lines, dropping any whose value is "—". */
function lines(rows: [string, string][]): string {
  return rows.filter(([, v]) => v && v !== "—").map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** A block is only worth including if it has real content. */
function block(
  id: string,
  source: string,
  heading: string,
  body: string,
  priority: number,
): ContextBlock | null {
  return body.trim() ? { id, source, heading, body: body.trim(), priority } : null;
}

/* -------------------------------------------------------------------------- */
/* Context → blocks                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Render every available source into labeled, source-tagged blocks. Priorities
 * are baseline importance; {@link selectBlocks} boosts the ones an intent needs.
 * Pure / testable.
 */
export function buildBlocks(ctx: CompanyContext): ContextBlock[] {
  const out: (ContextBlock | null)[] = [];
  const cur = ctx.quote.currency;

  // Overview / business — always high priority (the anchor).
  if (ctx.profile) {
    const p = ctx.profile;
    const desc = p.description ? truncate(p.description, 900) : "";
    const meta = lines([
      ["Sector", p.sector ?? "—"],
      ["Industry", p.industry ?? "—"],
      ["Country", p.country ?? "—"],
      ["Employees", p.employees != null ? formatCompact(p.employees) : "—"],
      ["Enterprise value", p.enterpriseValue != null ? formatMarketCap(p.enterpriseValue) : "—"],
    ]);
    out.push(block("overview", "yahoo:profile", "Business overview", [desc, meta].filter(Boolean).join("\n\n"), 100));
    if (p.officers.length) {
      out.push(block("management", "yahoo:profile", "Key executives",
        p.officers.map((o) => `- ${o.name} — ${o.title}`).join("\n"), 40));
    }
  }

  // Price / snapshot — always present (quote is required).
  const q = ctx.quote;
  out.push(block("price", "yahoo:price", "Price & market data", lines([
    ["Price", `${formatCurrency(q.price, cur)} (${formatPercent(q.changePercent)} today)`],
    ["Market cap", formatMarketCap(q.marketCap)],
    ["52-week range", `${formatCurrency(q.fiftyTwoWeekLow, cur)} – ${formatCurrency(q.fiftyTwoWeekHigh, cur)}`],
    ["Volume", q.volume != null ? formatCompact(q.volume) : "—"],
    ["Exchange", q.exchange ?? "—"],
  ]), 90));

  const s = ctx.snapshot;
  if (s) {
    out.push(block("valuation", "yahoo:valuation", "Valuation metrics", lines([
      ["Trailing P/E", formatNumber(s.trailingPE)],
      ["Forward P/E", formatNumber(s.forwardPE)],
      ["PEG ratio", formatNumber(s.pegRatio)],
      ["Price / book", formatNumber(s.priceToBook)],
    ]), 50));

    out.push(block("growth", "yahoo:growth", "Growth metrics", lines([
      ["Revenue growth (YoY)", fpct(s.revenueGrowth)],
      ["Earnings growth (YoY)", fpct(s.earningsGrowth)],
      ["Revenue CAGR (5y)", fpct(ctx.statements?.revenueCagr)],
      ["FCF CAGR (5y)", fpct(ctx.statements?.fcfCagr)],
    ]), 50));

    out.push(block("profitability", "yahoo:profitability", "Profitability & returns", lines([
      ["Gross margin", fpct(s.grossMargins)],
      ["Operating margin", fpct(s.operatingMargins)],
      ["Net margin", fpct(s.profitMargins)],
      ["Return on equity", fpct(s.returnOnEquity)],
      ["Return on assets", fpct(s.returnOnAssets)],
    ]), 50));

    out.push(block("financialHealth", "yahoo:health", "Financial health", lines([
      ["Debt / equity", formatNumber(s.debtToEquity)],
      ["Current ratio", formatNumber(s.currentRatio)],
      ["Quick ratio", formatNumber(s.quickRatio)],
      ["Total cash", s.totalCash != null ? formatMarketCap(s.totalCash) : "—"],
      ["Total debt", s.totalDebt != null ? formatMarketCap(s.totalDebt) : "—"],
      ["Free cash flow", s.freeCashflow != null ? formatMarketCap(s.freeCashflow) : "—"],
    ]), 50));
  }

  // EDGAR financial statement trend.
  const st = ctx.statements;
  if (st && st.revenue.length) {
    const fy = st.fiscalYears;
    const row = (label: string, pts: { fy: number; value: number }[], fmt: (v: number) => string) => {
      const m = new Map(pts.map((p) => [p.fy, p.value]));
      const cells = fy.map((y) => (m.has(y) ? fmt(m.get(y)!) : "—")).join(", ");
      return [`${label} (${fy.join("/")})`, cells] as [string, string];
    };
    out.push(block("statements", "edgar:statements", "Financial statement history (annual)", lines([
      row("Revenue", st.revenue, (v) => `$${formatCompact(v)}`),
      row("Net income", st.netIncome, (v) => `$${formatCompact(v)}`),
      row("Free cash flow", st.freeCashFlow, (v) => `$${formatCompact(v)}`),
      row("Operating margin", st.operatingMargin, (v) => fpct(v)),
    ]), 45));
  }

  // Analyst consensus.
  const a = ctx.analyst;
  if (a && (a.numberOfOpinions || a.targetMean != null)) {
    out.push(block("analyst", "yahoo:analyst", "Analyst consensus", lines([
      ["Rating", a.recommendationKey ? a.recommendationKey.replace(/_/g, " ") : "—"],
      ["Mean target", a.targetMean != null ? `${formatCurrency(a.targetMean, cur)} (${formatPercent(a.upsidePercent)} upside)` : "—"],
      ["Target range", a.targetLow != null && a.targetHigh != null ? `${formatCurrency(a.targetLow, cur)} – ${formatCurrency(a.targetHigh, cur)}` : "—"],
      ["Distribution", `${a.strongBuy} strong buy / ${a.buy} buy / ${a.hold} hold / ${a.sell} sell / ${a.strongSell} strong sell`],
      ["EPS revisions (30d)", a.epsRevisionsUp30d != null || a.epsRevisionsDown30d != null ? `${a.epsRevisionsUp30d ?? 0} up / ${a.epsRevisionsDown30d ?? 0} down` : "—"],
      ["Recent EPS surprises", a.epsSurprises.length ? a.epsSurprises.slice(0, 4).map((x) => formatPercent(x)).join(", ") : "—"],
    ]), 45));
  }

  // Insider activity.
  const ins = ctx.insider;
  if (ins && ins.transactions.length) {
    out.push(block("insider", "yahoo:insider", "Insider activity (recent)", lines([
      ["Net insider value", `${ins.netValue >= 0 ? "+" : ""}$${formatCompact(Math.abs(ins.netValue))} (${ins.buyCount} buys / ${ins.sellCount} sells)`],
      ["Latest", ins.transactions.slice(0, 4).map((t) => `${t.date} ${t.name} ${t.type}`).join("; ")],
    ]), 30));
  }

  // Ownership — prefers the richer OwnershipData (institutions/insiders/short
  // interest/top holders) over the profile's bare percentages, and appends
  // the same deterministic narrative the Ownership tab shows (describeOwnership,
  // lib/ownership-insight.ts) so the copilot doesn't re-derive its own read.
  if (ctx.ownership) {
    const o = ctx.ownership;
    const narrative = describeOwnership(o);
    out.push(block("ownership", "yahoo:ownership", "Ownership structure", [
      lines([
        ["Institutional", fpct(o.institutionsPctHeld)],
        ["Insider", fpct(o.insidersPctHeld)],
        ["Short % of float", fpct(o.shortPctOfFloat)],
        ["Top holder", o.topHolders[0] ? `${o.topHolders[0].name} (${fpct(o.topHolders[0].pctHeld, 2)})` : "—"],
      ]),
      narrative.length ? narrative.map((n) => `- ${n}`).join("\n") : "",
    ].filter(Boolean).join("\n"), 30));
  } else if (ctx.profile && (ctx.profile.institutionalOwnership != null || ctx.profile.insiderOwnership != null)) {
    out.push(block("ownership", "yahoo:ownership", "Ownership structure", lines([
      ["Institutional", fpct(ctx.profile.institutionalOwnership != null ? ctx.profile.institutionalOwnership / 100 : null)],
      ["Insider", fpct(ctx.profile.insiderOwnership != null ? ctx.profile.insiderOwnership / 100 : null)],
    ]), 30));
  }

  // Sector Rotation — this company's sector rank/momentum/classification.
  if (ctx.sectorRotation) {
    const sr = ctx.sectorRotation;
    out.push(block("sectorRotation", "platform:sector-rotation", "Sector Rotation", lines([
      ["Sector", sr.sector],
      ["Classification", sr.classification],
      ["Rank", `#${sr.rank}/11 by relative strength`],
      ["Relative strength", `${sr.relativeStrength >= 0 ? "+" : ""}${sr.relativeStrength.toFixed(1)}pp vs. sector average`],
      ["1-month return", sr.returns["1m"] != null ? formatPercent(sr.returns["1m"]) : "—"],
    ]), 40));
  }

  // Investment Timeline — most recent milestones.
  if (ctx.recentTimelineEvents.length) {
    out.push(block("timeline", "platform:timeline", "Recent Investment Timeline milestones", ctx.recentTimelineEvents
      .map((e) => `- [${e.timestamp.slice(0, 10)}] ${e.title} (${e.category.replace(/_/g, " ")}, ${e.impact})`)
      .join("\n"), 35));
  }

  // Opportunity Map — theme + sibling opportunities, when this symbol was scanned.
  if (ctx.relatedOpportunities) {
    const ro = ctx.relatedOpportunities;
    out.push(block("opportunityMap", "platform:opportunity-map", "Related Opportunities (Opportunity Map)", lines([
      ["Theme", ro.theme],
      ["Related symbols", ro.siblings.length ? ro.siblings.join(", ") : "—"],
    ]), 25));
  }

  // Knowledge Graph — top related entities.
  if (ctx.graphNeighbors.length) {
    out.push(block("knowledgeGraph", "platform:knowledge-graph", "Knowledge Graph — related entities", ctx.graphNeighbors
      .map((n) => `- ${n.label} (${n.relationship})`)
      .join("\n"), 25));
  }

  // Movement Explainer — only if already cached (MovementExplainerCard's
  // autoLoad on Research already populates this); never trigger a fresh
  // model generation mid-chat just to populate context.
  try {
    const cached = getScannerCache(`movement:symbol:${ctx.symbol}:5`);
    if (cached) {
      const exp = JSON.parse(cached) as MovementExplanation;
      if (exp.drivers.length) {
        out.push(block("movement", "platform:movement", "Why the stock recently moved", [
          exp.summary,
          exp.drivers.map((d) => `- [${d.category}] ${d.description} (${d.direction})`).join("\n"),
        ].filter(Boolean).join("\n"), 40));
      }
    }
  } catch {
    /* cache miss or parse failure — just skip the block */
  }

  // Platform score — the app's own proprietary view; high priority anchor.
  const sc = ctx.score;
  if (sc) {
    out.push(block("platformScore", "platform:score", "Platform score & recommendation", [
      lines([
        ["Recommendation", `${sc.recommendation.replace(/_/g, " ")} (confidence ${sc.confidence}/100)`],
        ["Composite", `${sc.composite}/100`],
        ["Signals", `fundamentals ${sc.signals.fundamentals}, analysts ${sc.signals.analysts ?? "n/a"}, momentum ${sc.signals.momentum ?? "n/a"} (all /100)`],
      ]),
      sc.buckets.map((b) => `${b.name}: ${b.points}/${b.max}`).join(" · "),
      sc.rationale,
    ].filter(Boolean).join("\n"), 80));
  }

  // Risk heatmap.
  if (ctx.risks.length) {
    out.push(block("risks", "platform:risk", "Risk assessment", ctx.risks
      .map((r) => `- ${r.category} [${r.level}]: ${r.reason}`).join("\n"), 55));
  }

  // Momentum / technical.
  const m = ctx.momentum;
  if (m) {
    out.push(block("technical", "platform:momentum", "Technical / momentum", lines([
      ["Momentum score", `${m.score}/100 (${m.trend})`],
      ["vs 50-day SMA", m.vsSma50 != null ? formatPercent(m.vsSma50) : "—"],
      ["vs 200-day SMA", m.vsSma200 != null ? formatPercent(m.vsSma200) : "—"],
      ["3-month return", m.return3m != null ? formatPercent(m.return3m) : "—"],
      ["From 52-week high", m.pctFrom52WkHigh != null ? formatPercent(m.pctFrom52WkHigh) : "—"],
    ]), 30));
  }

  // Peer comparison.
  const pr = ctx.peers;
  if (pr && pr.peerCount > 0) {
    const cmp = (label: string, t: number | null, med: number | null, fmt: (v: number) => string) =>
      [`${label}`, t != null && med != null ? `${fmt(t)} vs sector median ${fmt(med)}` : "—"] as [string, string];
    out.push(block("peers", "yahoo:peers", `Peer comparison (${pr.sector}, ${pr.peerCount} peers)`, lines([
      cmp("P/E", pr.target.pe, pr.median.pe, (v) => formatNumber(v)),
      cmp("ROE", pr.target.roe, pr.median.roe, (v) => fpct(v)),
      cmp("Revenue growth", pr.target.revenueGrowth, pr.median.revenueGrowth, (v) => fpct(v)),
      cmp("Debt / equity", pr.target.debtToEquity, pr.median.debtToEquity, (v) => formatNumber(v)),
    ]), 45));
  }

  // Recent filings. Indian listings carry NSE corporate announcements in the
  // same slot (lib/india-news.ts) — label them honestly so the model cites
  // [nse:filings], not a SEC filing that doesn't exist.
  if (ctx.filings.length) {
    const isIndian = /\.(NS|BO)$/i.test(ctx.quote.symbol);
    out.push(block(
      "filings",
      isIndian ? "nse:filings" : "edgar:filings",
      isIndian ? "Recent NSE corporate announcements" : "Recent SEC filings",
      ctx.filings
        .slice(0, 8)
        .map((f) => `- ${f.form} (${f.filedAt.slice(0, 10)}): ${f.description.slice(0, 220)}`).join("\n"),
      35,
    ));
  }

  // News.
  if (ctx.news.length) {
    out.push(block("news", "news", "Recent news", ctx.news
      .slice(0, 6)
      .map((n, i) => `- [${i + 1}] ${n.headline}${n.source ? ` — ${n.source}` : ""}${n.publishedAt ? ` (${n.publishedAt.slice(0, 10)})` : ""}`)
      .join("\n"), 35));
  }

  // Saved research notes — prior analytical conclusions from this and peer sessions.
  if (ctx.savedNotes && ctx.savedNotes.length) {
    out.push(block("savedNotes", "platform:notes", "Prior research notes (your saved conclusions)", (ctx.savedNotes ?? [])
      .map((n) => `[${n.symbol} · ${n.createdAt.slice(0, 10)}] ${n.content.slice(0, 500)}`)
      .join("\n\n"), 70));
  }

  // Data gaps — so the model can be candid about what's missing.
  if (ctx.warnings.length) {
    out.push(block("gaps", "platform:gaps", "Data availability notes", ctx.warnings
      .map((w) => `- ${w}`).join("\n"), 20));
  }

  return out.filter((b): b is ContextBlock => b !== null);
}

/* -------------------------------------------------------------------------- */
/* Selection + budgeting                                                      */
/* -------------------------------------------------------------------------- */

/** Block ids each intent wants boosted to the top of the selection. */
const INTENT_SECTIONS: Record<ResearchIntent, string[]> = {
  valuation: ["valuation", "analyst", "peers", "statements", "platformScore"],
  growth: ["growth", "statements", "peers"],
  profitability: ["profitability", "statements", "peers"],
  financialHealth: ["financialHealth", "statements"],
  competitive: ["peers", "overview", "profitability", "growth", "knowledgeGraph"],
  management: ["management", "insider", "ownership", "platformScore"],
  capitalAllocation: ["financialHealth", "statements", "insider", "ownership"],
  risks: ["risks", "financialHealth", "valuation", "statements"],
  catalysts: ["growth", "analyst", "news", "technical", "timeline", "sectorRotation", "movement"],
  thesis: ["platformScore", "valuation", "growth", "profitability", "risks", "analyst", "sectorRotation", "timeline", "movement"],
  earnings: ["statements", "analyst", "growth", "filings"],
  filings: ["filings", "statements"],
  news: ["news", "filings"],
  ownership: ["ownership", "insider"],
  technical: ["technical", "price", "sectorRotation"],
  comparison: ["peers", "valuation", "profitability", "growth", "opportunityMap"],
  general: ["platformScore", "valuation", "growth", "risks"],
};

/** Anchors always kept regardless of intent — the company's identity. */
const ALWAYS = new Set(["overview", "price", "platformScore", "gaps", "savedNotes"]);

/** Rough token estimate (~4 chars/token). Good enough for budgeting. Pure. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Select and order blocks for a set of intents, then trim to a token budget.
 * Intent-relevant + always-on blocks are boosted; remaining blocks fill the
 * budget by baseline priority. Pure / testable.
 */
export function selectBlocks(
  blocks: ContextBlock[],
  intents: ResearchIntent[],
  tokenBudget = 2600,
): ContextBlock[] {
  const wanted = new Set<string>();
  for (const intent of intents) for (const id of INTENT_SECTIONS[intent] ?? []) wanted.add(id);

  const scored = blocks.map((b) => ({
    block: b,
    rank: (ALWAYS.has(b.id) ? 1000 : 0) + (wanted.has(b.id) ? 500 : 0) + b.priority,
  }));
  scored.sort((a, b) => b.rank - a.rank);

  const selected: ContextBlock[] = [];
  let used = 0;
  for (const { block: b } of scored) {
    const cost = estimateTokens(`${b.heading}\n${b.body}`) + 4;
    if (used + cost > tokenBudget && !ALWAYS.has(b.id)) continue;
    selected.push(b);
    used += cost;
  }
  // Preserve a stable, readable order (by original priority) in the prompt.
  return selected.sort((a, b) => b.priority - a.priority);
}
