/**
 * The investment verdict — ONE definition, shared by the streamed and the
 * non-streamed route.
 *
 * ## Why this module exists
 *
 * The verdict used to live entirely inside `app/api/ai/verdict/route.ts` as six
 * near-identical `respondWith*Verdict` functions (equity, fund, crypto,
 * commodity, forex, macro). Each one repeated the same twenty lines of
 * parse → coerce → collect claims → verify grounding → fall back, differing
 * only in its facts, prompt, and task. That had two costs:
 *
 *   1. Six copies of the fallback/grounding logic drift independently. One of
 *      them already had a slightly different fallback shape than the others.
 *   2. The streamed route (`/api/ai/report`) could only serve **equities**,
 *      because the other five verdicts were welded to `NextResponse` inside a
 *      route handler and could not be reached from anywhere else. So the one
 *      surface that fixes time-to-first-content was unavailable to five of the
 *      six asset classes.
 *
 * Splitting a verdict into a **plan** (which task, which prompt, which evidence,
 * which fallback) and an **assembly** (parsed fields → verified verdict) fixes
 * both. Every asset class now produces a plan; the streamed and non-streamed
 * routes consume plans identically, so they cannot produce different verdicts
 * for the same inputs — that property is structural now, not merely intended.
 */

import { buildVerdictPrompt } from "./report-sections";
import type { PortfolioFacts } from "./facts";
import { collectClaimText, verifyGrounding, type GroundingReport } from "./grounding";
import type { CompanyContext } from "./types";
import type { TaskType } from "./task-registry";
import { runPromptWithMeta } from "../ai";
import { getDataset, peekDataset } from "../platform/data-layer";
import { writeCache } from "../platform/cache";
import { cacheKey } from "../platform/registry";
import { extractJson } from "../json-extract";
import { detectAssetClass } from "../asset-class";
import { formatCompactCurrency, formatCurrency, formatMarketCap } from "../format";
import { scoreDirection } from "../recommendation";
import { getFundProfile, getHistory, getMacroSummary } from "../yahoo";
import { computeFundScore } from "../fund-scoring";
import { computeCryptoScore } from "../crypto-scoring";
import { computeCommodityScore } from "../commodity-scoring";
import { COMMODITY_BENCHMARK_SYMBOL } from "../research-engines/commodity";
import { computeForexScore, DOLLAR_INDEX_SYMBOL } from "../forex-scoring";
import type { NewsItem } from "../types";
import { AI_RECOVERY_HINT } from "./availability";

export interface InvestmentVerdict {
  verdict: "bullish" | "bearish" | "neutral";
  headline: string;
  /** The single most important conflict in the evidence — the equity verdict's
   *  highest-value line. Empty for asset classes whose prompt omits it. */
  tension: string;
  thesis: string;
  catalysts: string[];
  risks: string[];
  /** Measurable events that would change the verdict. Empty when not requested. */
  triggers: string[];
  confidence: "high" | "medium" | "low";
  timeHorizon: "short-term" | "medium-term" | "long-term";
  keyMetrics: Array<{ label: string; value: string; signal: "positive" | "negative" | "neutral" }>;
  /** Verification that the verdict's figures trace back to the source data.
   *  Absent when the AI was unavailable (nothing was generated to verify). */
  grounding?: GroundingReport;
  model: string;
  generatedAt: string;
}

/** The mutable fields a generation produces, before grounding/model metadata. */
export type VerdictFields = Omit<InvestmentVerdict, "model" | "generatedAt" | "grounding">;

export type VerdictKind = "equity" | "fund" | "crypto" | "commodity" | "forex" | "macro";

/**
 * Everything needed to generate a verdict, with no I/O left to do.
 *
 * Producing a plan is the expensive part (it fetches history, computes the
 * asset-class score, builds the fact block). Consuming one is pure. That split
 * is what lets the streamed route reuse the exact prompt the blocking route
 * would have used.
 */
export interface VerdictPlan {
  kind: VerdictKind;
  task: TaskType;
  prompt: string;
  /** The fact block the grounding check verifies generated claims against. */
  evidence: string;
  /**
   * The deterministic composite score (0–100) for scored asset classes.
   * When present, the final verdict direction is COMPUTED from it via
   * {@link verdictFromScore} — the model narrates, it does not decide.
   * Absent for macro (a yield curve has no composite).
   */
  composite?: number | null;
  /** Used verbatim when generation fails (AI unavailable, unparseable output). */
  fallback: {
    verdict: InvestmentVerdict["verdict"];
    name: string;
    /** "stock", "fund", "currency pair" — reads inside the offline message. */
    subject: string;
    /** "Review metrics and score below" — the offline risks[1] line. */
    reviewHint: string;
  };
}

/**
 * Direction from a composite score — shared by every scored asset class.
 * Derived from lib/recommendation.ts's canonical bands so the AI verdict can
 * NEVER contradict the recommendation badge rendered beside it: BUY tiers
 * (≥60) are bullish, SELL tiers (<42) are bearish, HOLD is neutral. The old
 * thresholds (>65 / <40) disagreed with the bands in the 60–65 and 40–42
 * windows, which is exactly how a "Buy 62/100" page carried a NEUTRAL hero.
 */
export function verdictFromScore(composite: number): InvestmentVerdict["verdict"] {
  return scoreDirection(composite);
}

/** The complete default shape every parse coerces against.
 *
 *  A model can emit valid JSON that omits `catalysts`/`risks`/`keyMetrics`,
 *  which the research page then `.map()`s over — a bare cast crashes the page.
 *  Coercing against a full shape is what makes that impossible. */
function defaultFields(plan: VerdictPlan): VerdictFields {
  return {
    verdict: plan.fallback.verdict,
    headline: `${plan.fallback.name}: AI verdict`,
    tension: "",
    thesis: "",
    catalysts: [],
    risks: [],
    triggers: [],
    confidence: "low",
    timeHorizon: "medium-term",
    keyMetrics: [],
  };
}

/** The verdict shown when nothing could be generated. Actionable, not blank. */
export function offlineVerdict(plan: VerdictPlan): InvestmentVerdict {
  return {
    verdict: plan.fallback.verdict,
    headline: `${plan.fallback.name}: connect an AI provider to generate the investment verdict`,
    tension: "",
    thesis: `${AI_RECOVERY_HINT} Then refresh to generate the AI analysis for this ${plan.fallback.subject}.`,
    catalysts: [
      "No AI provider reachable",
      AI_RECOVERY_HINT,
      "The verdict generates automatically once one is available",
    ],
    risks: ["AI analysis unavailable", plan.fallback.reviewHint, "Check the AI status badge in the header"],
    triggers: [],
    confidence: "low",
    timeHorizon: "medium-term",
    keyMetrics: [],
    model: "unavailable",
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Turn parsed model output into a verified verdict.
 *
 * Called by BOTH paths — the blocking route (from `extractJsonObject`) and the
 * streamed route (from `JsonFieldStreamer.result()`) — so the assembled object
 * is identical regardless of how the bytes arrived.
 */
export function assembleVerdict(
  plan: VerdictPlan,
  raw: Record<string, unknown>,
  model: string,
): InvestmentVerdict {
  const fields = coerceFields(plan, raw);
  const claims = collectClaimText([
    fields.headline,
    fields.tension,
    fields.thesis,
    fields.catalysts,
    fields.risks,
    fields.triggers,
    fields.keyMetrics.map((m) => `${m.label} ${m.value}`),
  ]);

  return {
    ...fields,
    grounding: verifyGrounding(claims, plan.evidence),
    model,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Coerce a loosely-typed field bag into the strict verdict shape.
 *
 * The streamed path hands us fields one at a time as they close, so by the end
 * we have a plain object whose values are `unknown`. This narrows it with the
 * same defaults the blocking path gets from `extractJsonObject`.
 */
function coerceFields(plan: VerdictPlan, raw: Record<string, unknown>): VerdictFields {
  const base = defaultFields(plan);
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : base.catalysts;

  const verdict = raw.verdict;
  const confidence = raw.confidence;
  const timeHorizon = raw.timeHorizon;

  // "Never let the model derive a directional verdict" (AGENTS.md): for scored
  // asset classes the direction is a pure function of the composite score.
  // Whatever the model emitted is overridden — this is what makes the hero
  // verdict and the Conviction tab's recommendation structurally identical.
  const computedVerdict =
    plan.composite != null
      ? verdictFromScore(plan.composite)
      : verdict === "bullish" || verdict === "bearish" || verdict === "neutral"
        ? verdict
        : base.verdict;

  return {
    verdict: computedVerdict,
    headline: typeof raw.headline === "string" && raw.headline.trim() ? raw.headline : base.headline,
    tension: typeof raw.tension === "string" ? raw.tension : base.tension,
    thesis: typeof raw.thesis === "string" ? raw.thesis : base.thesis,
    catalysts: strings(raw.catalysts),
    risks: strings(raw.risks),
    triggers: strings(raw.triggers),
    confidence:
      confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : base.confidence,
    timeHorizon:
      timeHorizon === "short-term" || timeHorizon === "medium-term" || timeHorizon === "long-term"
        ? timeHorizon
        : base.timeHorizon,
    keyMetrics: Array.isArray(raw.keyMetrics)
      ? raw.keyMetrics.flatMap((m) => {
          if (!m || typeof m !== "object") return [];
          const { label, value, signal } = m as Record<string, unknown>;
          if (typeof label !== "string" || typeof value !== "string") return [];
          return [
            {
              label,
              value,
              signal:
                signal === "positive" || signal === "negative" || signal === "neutral"
                  ? signal
                  : ("neutral" as const),
            },
          ];
        })
      : base.keyMetrics,
  };
}

/**
 * Parse the model's raw output into the loose field bag {@link coerceFields}
 * narrows. Returns `{}` when there is no parseable JSON object.
 *
 * Deliberately NOT `extractJsonObject`: that helper only copies keys that exist
 * in the `defaults` object it is handed, so calling it with `{}` returned `{}`
 * for every input — silently discarding a complete, valid verdict after ~80s of
 * local inference. Defaulting is `coerceFields`'s job; this only parses.
 */
export function parseVerdictFields(raw: string): Record<string, unknown> {
  try {
    const parsed = extractJson<unknown>(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Generate a verdict without streaming — the blocking path.
 *
 * Runs through the analysis seam (ai-migration/03 §9), so AI_PROVIDER decides
 * Ollama vs Devin. Both providers return the loose field bag that
 * {@link assembleVerdict} → coerceFields narrows with plan-specific defaults —
 * one defaulting implementation, two transports.
 *
 * Never throws: an inference failure degrades to {@link offlineVerdict} so the
 * research page always has something to render. One deliberate asymmetry,
 * preserving each path's pre-migration semantics exactly:
 *   - Ollama emitting UNPARSEABLE bytes assembles the plan's defaults (what
 *     `parseVerdictFields → {}` always did) rather than the offline fallback;
 *   - Devin failing produces the offline fallback, which `cacheVerdict`
 *     refuses to persist — a session error must not pin a defaults verdict
 *     into a 6h cache.
 */
export async function generateVerdict(
  plan: VerdictPlan,
  opts: { signal?: AbortSignal; subjectKey?: string } = {},
): Promise<InvestmentVerdict> {
  try {
    /* Merge resolution (origin/main → f22/day-change, 2026-08-06): kept this
       branch's provider-agnostic seam (runPromptWithMeta). main's runAnalysis
       variant imported ./providers/ollama-analysis and ./schemas/verdict,
       neither of which exists after 42d579d ("six providers behind one
       seam") — the branch side is the only one that compiles, and it is the
       newer architecture. */
    const { text: raw, model } = await runPromptWithMeta(plan.task, plan.prompt, { json: true });
    if (opts.signal?.aborted) return offlineVerdict(plan);
    return assembleVerdict(plan, parseVerdictFields(raw), model);
  } catch {
    return offlineVerdict(plan);
  }
}

/* -------------------------------------------------------------------------- */
/* Caching                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A verdict was generated while the AI was unavailable.
 *
 * Thrown so the cache layer treats it as a failure and does NOT persist it. The
 * platform's rule is "failures are never cached", and it matters more here than
 * anywhere else: caching the offline fallback would pin the "AI unavailable"
 * verdict on screen for six hours after the user had already fixed the cause
 * (e.g. added their API key).
 */
class VerdictUnavailableError extends Error {
  constructor(readonly fallback: InvestmentVerdict) {
    super("Verdict generation unavailable");
    this.name = "VerdictUnavailableError";
  }
}

/**
 * Cache parameters for a verdict.
 *
 * Personalization is part of the key: a verdict written for a user whose book is
 * underweight Technology says different things than a generic one, and serving
 * one for the other would be a correctness bug, not a cache optimization. The
 * `kind` is included so an asset that changes classification cannot read a
 * verdict built from the wrong prompt.
 */
export function verdictCacheParams(
  symbol: string,
  kind: VerdictKind,
  personalization: Record<string, string> = {},
): Record<string, string> {
  return { symbol: symbol.toUpperCase(), kind, ...personalization };
}

/**
 * Read a cached verdict without generating one. Null on a true miss.
 *
 * Used by the streamed route to replay a finished report instantly instead of
 * paying for the generation a second time.
 */
export function peekVerdict(params: Record<string, string>): InvestmentVerdict | null {
  return peekDataset<InvestmentVerdict>("aiVerdict", params)?.data ?? null;
}

/**
 * Like {@link peekVerdict} but with the cache metadata attached, so the caller
 * can distinguish a FRESH hit (serve, done) from a STALE-within-SWR hit
 * (serve instantly AND schedule a background regeneration). The streamed route
 * used to drop that distinction — stale replays were served and then never
 * refreshed, so a verdict could ride the whole 24h SWR window without a single
 * regeneration while the blocking route's getDataset path revalidated properly.
 */
export function peekVerdictWithMeta(
  params: Record<string, string>,
): { verdict: InvestmentVerdict; freshness: "fresh" | "revalidating" | "stale" } | null {
  const hit = peekDataset<InvestmentVerdict>("aiVerdict", params);
  if (!hit) return null;
  return { verdict: hit.data, freshness: hit.meta.freshness };
}

/** Persist a freshly-generated verdict under the platform's `aiVerdict` policy. */
export function cacheVerdict(
  params: Record<string, string>,
  verdict: InvestmentVerdict,
  symbol: string,
): void {
  if (verdict.model === "unavailable") return; // never cache a failure
  writeCache("aiVerdict", cacheKey("aiVerdict", params), verdict, symbol.toUpperCase());
}

/**
 * The verdict, from cache when possible.
 *
 * Goes through `getDataset`, so it inherits the whole platform contract that AI
 * generation had been quietly bypassing despite being by far the most expensive
 * thing to recompute: the registry's `aiVerdict` policy (6h fresh, 24h
 * stale-while-revalidate, persisted across restarts), request deduplication, and
 * — most importantly — dependency-aware invalidation. New filings, statements,
 * or fundamentals drop the verdict; a price tick or a news headline does not.
 *
 * That policy already existed in lib/platform/registry.ts. Nothing was reading
 * it, so every visit to a page re-ran a multi-minute local generation whose
 * answer had not changed.
 */
export async function getVerdict(
  plan: VerdictPlan,
  params: Record<string, string>,
  opts: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<{ verdict: InvestmentVerdict; cached: boolean }> {
  try {
    const result = await getDataset<InvestmentVerdict>(
      "aiVerdict",
      params,
      async () => {
        const verdict = await generateVerdict(plan, {
          signal: opts.signal,
          // The cache key's symbol is the stable subject; the plan's display
          // name would make e.g. "Apple Inc." and "AAPL" distinct subjects.
          subjectKey: params.symbol ? `verdict:${params.symbol}` : undefined,
        });
        if (verdict.model === "unavailable") throw new VerdictUnavailableError(verdict);
        return verdict;
      },
      { symbol: params.symbol, signal: opts.signal, fresh: opts.fresh },
    );
    return { verdict: result.data, cached: result.cached };
  } catch (err) {
    if (err instanceof VerdictUnavailableError) return { verdict: err.fallback, cached: false };
    return { verdict: offlineVerdict(plan), cached: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Per-asset-class plans                                                      */
/* -------------------------------------------------------------------------- */

/** The JSON schema block every non-equity prompt shares. */
const SCHEMA_BLOCK = `Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON. Emit the keys in exactly this order:
{
  "headline": "Decisive 10-14 word investment thesis naming the subject and the core reason",
  "thesis": "2-3 sentences: the investment case with specific metrics cited from the data",
  "catalysts": ["specific reason citing a number or fact", "reason 2", "reason 3"],
  "risks": ["specific risk citing a number or fact", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ],
  "verdict": "bullish" or "bearish" or "neutral"
}`;

/**
 * Key order note: the schema above emits `headline` first and `verdict` last,
 * matching the equity prompt in report-sections.ts. That order IS the streaming
 * order — the user reads the call before the supporting table. The previous
 * non-equity prompts put `verdict` first, which streamed a bare "bullish" with
 * no reasoning attached to it. Do not reorder without understanding that.
 */
function scoreFacts(score: {
  composite: number;
  recommendation: string;
  buckets: { name: string; points: number; max: number; factors: { label: string; detail?: string | null }[] }[];
}): string[] {
  return [
    `Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}`,
    ...score.buckets.flatMap((b) =>
      b.factors.filter((f) => f.detail && f.detail !== "n/a").map((f) => `${f.label}: ${f.detail}`),
    ),
  ];
}

function newsFact(news: NewsItem[]): string {
  return news.length > 0
    ? `Recent news: ${news.slice(0, 5).map((n) => n.headline).join(" | ")}`
    : "Recent news: none available";
}

function plan(
  kind: VerdictKind,
  task: TaskType,
  facts: string[],
  instructions: string,
  fallback: VerdictPlan["fallback"],
  role: string,
  subjectLabel: string,
  composite?: number | null,
): VerdictPlan {
  return {
    kind,
    task,
    evidence: facts.join("\n"),
    fallback,
    composite,
    prompt: `You are ${role}. Based ONLY on the data below, generate a structured investment verdict for this ${subjectLabel}.

DATA:
${facts.join("\n")}

${SCHEMA_BLOCK}

REQUIREMENTS:
${instructions}`,
  };
}

/** The established-conclusions instruction block shared by every scored plan:
 *  the verdict is settled in code; the model's job is narration only. */
function establishedVerdictInstruction(composite: number, scoreLabel: string): string {
  return `- verdict: MUST be exactly "${verdictFromScore(composite)}" — it is computed from the ${scoreLabel} of ${composite}/100 and is not yours to change
- Every score, subscore, or percentage you mention MUST be copied verbatim from the DATA block above. Do not compute, round differently, or invent any score figure.`;
}

async function planFundVerdict(ctx: CompanyContext): Promise<VerdictPlan> {
  const { symbol, name, quote } = ctx;
  const [fund, history] = await Promise.all([getFundProfile(symbol), getHistory(symbol, 730)]);
  const score = computeFundScore(fund, history);

  const facts = [
    `Fund: ${name} (${symbol})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Total net assets: ${fund.totalNetAssets != null ? formatCompactCurrency(fund.totalNetAssets, fund.currency) : "n/a"}`,
    `Category: ${fund.category ?? "n/a"}`,
    // "n/a" alone reads as "free" to a model told the fund is an index-style
    // pool — the explicit instruction stops fee claims being invented.
    `Expense ratio: ${fund.expenseRatio != null ? `${(fund.expenseRatio * 100).toFixed(2)}%` : "not reported by our data source — do NOT assume it is zero or low"}`,
    `Fund score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    ...scoreFacts(score),
    `Top holdings: ${fund.holdings.slice(0, 5).map((h) => `${h.symbol} ${h.weightPercent.toFixed(1)}%`).join(", ") || "n/a"}`,
    `Top-10 concentration: ${fund.holdings.slice(0, 10).reduce((s, h) => s + h.weightPercent, 0).toFixed(0)}%`,
    `Top sector: ${fund.sectorWeights[0] ? `${fund.sectorWeights[0].sector} ${fund.sectorWeights[0].weightPercent.toFixed(0)}%` : "n/a"}`,
    `1-year return: ${fund.trailingReturns.oneYear != null ? `${fund.trailingReturns.oneYear >= 0 ? "+" : ""}${fund.trailingReturns.oneYear.toFixed(1)}%` : "n/a"}`,
    `1-year return vs category: ${fund.categoryRelativeReturns.oneYear != null ? `${fund.categoryRelativeReturns.oneYear >= 0 ? "+" : ""}${fund.categoryRelativeReturns.oneYear.toFixed(1)}pp` : "n/a"}`,
    `Risk: beta ${fund.risk?.beta?.toFixed(2) ?? "n/a"}, Sharpe ${fund.risk?.sharpeRatio?.toFixed(2) ?? "n/a"}`,
  ];

  return plan(
    "fund",
    "fund-research",
    facts,
    `${establishedVerdictInstruction(score.composite, "fund score")}
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers from the data (cost, concentration, performance vs category). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering cost + diversification + performance vs category + risk-adjusted quality + momentum
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data`,
    { verdict: verdictFromScore(score.composite), name, subject: "fund", reviewHint: "Review the fund score below" },
    "a fund analyst",
    "fund",
    score.composite,
  );
}

async function planCryptoVerdict(ctx: CompanyContext): Promise<VerdictPlan> {
  const { symbol, name, quote } = ctx;
  const isBtc = symbol.toUpperCase().startsWith("BTC-USD");
  const [history, btcHistory] = await Promise.all([
    getHistory(symbol, 730),
    isBtc ? Promise.resolve([]) : getHistory("BTC-USD", 730),
  ]);
  const score = computeCryptoScore(symbol, history, btcHistory.length > 0 ? btcHistory : null);

  const facts = [
    `Crypto asset: ${name} (${symbol})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Market cap: ${formatMarketCap(quote.marketCap)}`,
    `Crypto score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    ...scoreFacts(score),
    "This analysis is market-data only — no tokenomics, on-chain, or developer-activity data is available.",
  ];

  return plan(
    "crypto",
    "crypto-research",
    facts,
    `${establishedVerdictInstruction(score.composite, "crypto score")}
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers from the data (momentum, relative strength vs BTC, volatility, drawdown). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering momentum + relative strength vs BTC + risk-adjusted return + drawdown risk + volatility
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent tokenomics, on-chain, or developer-activity figures — that data isn't available`,
    { verdict: verdictFromScore(score.composite), name, subject: "asset", reviewHint: "Review the crypto score below" },
    "a crypto markets analyst",
    "crypto asset",
    score.composite,
  );
}

async function planCommodityVerdict(ctx: CompanyContext): Promise<VerdictPlan> {
  const { symbol, name, quote, news } = ctx;
  const [history, benchmarkHistory] = await Promise.all([
    getHistory(symbol, 730),
    getHistory(COMMODITY_BENCHMARK_SYMBOL, 730),
  ]);
  const score = computeCommodityScore(history, benchmarkHistory.length > 0 ? benchmarkHistory : null);

  const facts = [
    `Commodity: ${name} (${symbol})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Commodity score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    ...scoreFacts(score),
    newsFact(news),
    "The score is market-data only — no inventory, production, or futures-curve data is available; use the news headlines above (if any) for supply/demand context, do not invent figures.",
  ];

  return plan(
    "commodity",
    "commodity-research",
    facts,
    `${establishedVerdictInstruction(score.composite, "commodity score")}
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers or headlines from the data (momentum, relative strength vs commodity index, volatility, drawdown, or recent news). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering momentum + relative strength vs commodity index + risk-adjusted return + drawdown risk + volatility
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent inventory, production, or futures-curve figures — that data isn't available`,
    { verdict: verdictFromScore(score.composite), name, subject: "commodity", reviewHint: "Review the commodity score below" },
    "a commodities markets analyst",
    "commodity",
    score.composite,
  );
}

async function planForexVerdict(ctx: CompanyContext): Promise<VerdictPlan> {
  const { symbol, name, quote, news } = ctx;
  const isDxy = symbol.toUpperCase() === DOLLAR_INDEX_SYMBOL.toUpperCase();
  const [history, benchmarkHistory] = await Promise.all([
    getHistory(symbol, 730),
    isDxy ? Promise.resolve([]) : getHistory(DOLLAR_INDEX_SYMBOL, 730),
  ]);
  const score = computeForexScore(symbol, history, benchmarkHistory.length > 0 ? benchmarkHistory : null);

  const facts = [
    `Currency pair: ${name} (${symbol})`,
    `Rate: ${quote.price} ${quote.currency} (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today)`,
    `Forex score: ${score.composite}/100 (${score.recommendation.replace(/_/g, " ")})`,
    ...scoreFacts(score),
    newsFact(news),
    "The score is market-data only — no central bank policy, inflation, GDP, or interest-rate data is available; use the news headlines above (if any) for macro context, do not invent figures.",
  ];

  return plan(
    "forex",
    "forex-research",
    facts,
    `${establishedVerdictInstruction(score.composite, "forex score")}
- headline: NO generic phrases like "shows potential" — make a real call
- catalysts + risks: MUST cite specific numbers or headlines from the data (momentum, relative strength vs Dollar Index, volatility, drawdown, or recent news). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering momentum + relative strength vs Dollar Index + risk-adjusted return + drawdown risk + volatility
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent central bank policy, inflation, GDP, or interest-rate figures — that data isn't available`,
    { verdict: verdictFromScore(score.composite), name, subject: "currency pair", reviewHint: "Review the forex score below" },
    "a currency markets analyst",
    "currency pair",
    score.composite,
  );
}

/**
 * Macro has no 0-100 score to threshold — a yield curve has no BUY/SELL call.
 * The offline fallback reads curve shape instead: inverted curves have
 * historically preceded US recessions, which maps to "bearish" on the growth
 * outlook, not on a security.
 */
async function planMacroVerdict(ctx: CompanyContext): Promise<VerdictPlan> {
  const { name, news } = ctx;
  const summary = await getMacroSummary();

  const curveLines = summary.curve
    .map((p) => `${p.label} (${p.symbol}): ${p.yieldPercent != null ? `${p.yieldPercent.toFixed(2)}%` : "n/a"}`)
    .join(", ");

  const facts = [
    `US Treasury yield curve: ${curveLines}`,
    `10-Year minus 3-Month spread: ${summary.tenYearMinusThreeMonth != null ? `${summary.tenYearMinusThreeMonth >= 0 ? "+" : ""}${summary.tenYearMinusThreeMonth.toFixed(2)}pp` : "n/a"}`,
    `Curve shape: ${summary.shape ?? "n/a"}`,
    `Curve trend (vs ~20 trading days ago): ${summary.curveTrend ?? "n/a"}`,
    newsFact(news),
    "No CPI, GDP, payrolls, or Fed policy-decision data is available; use the news headlines above (if any) for that context, do not invent figures.",
  ];

  const fallbackVerdict: InvestmentVerdict["verdict"] =
    summary.shape === "inverted"
      ? "bearish"
      : summary.shape === "normal" && summary.curveTrend === "steepening"
        ? "bullish"
        : "neutral";

  return {
    kind: "macro",
    task: "macro-research",
    evidence: facts.join("\n"),
    fallback: { verdict: fallbackVerdict, name, subject: "yield curve", reviewHint: "Review the yield curve below" },
    prompt: `You are a macroeconomics analyst. Based ONLY on the data below, generate a structured verdict on what the current yield curve and macro news suggest about the growth/recession outlook. This is NOT a directional call on a security — "bullish"/"bearish" here means bullish/bearish on the growth outlook, not a buy/sell recommendation.

DATA:
${facts.join("\n")}

${SCHEMA_BLOCK}

REQUIREMENTS:
- verdict: bearish (on growth outlook) if the curve is inverted; bullish if normal and steepening; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real call about the growth outlook
- catalysts + risks: MUST cite specific numbers or headlines from the data (yield levels, spread, curve shape/trend, or recent news). Generic bullets will be rejected.
- keyMetrics: exactly 5, covering the 4 tenor yields plus the 10y-3m spread
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data
- Do NOT invent CPI, GDP, payrolls, or Fed policy-decision figures — that data isn't available`,
  };
}

function planEquityVerdict(ctx: CompanyContext, portfolio: PortfolioFacts | null): VerdictPlan {
  const { prompt, evidence } = buildVerdictPrompt(ctx, portfolio);
  return {
    kind: "equity",
    // "investment-verdict", not "investment-thesis": a human is watching this
    // spinner, and the shared task type made the hero verdict inherit the
    // scanner/IC batch policy (background priority, 300s budget). Same models.
    task: "investment-verdict",
    prompt,
    evidence,
    composite: ctx.score?.composite ?? null,
    fallback: {
      verdict: ctx.score ? verdictFromScore(ctx.score.composite) : "neutral",
      name: ctx.name,
      subject: "stock",
      reviewHint: "Review metrics and score below",
    },
  };
}

/**
 * The verdict kind a quote resolves to — the same mapping {@link planVerdict}
 * dispatches on, exported so the streamed route can compute the CACHE IDENTITY
 * from the quote alone (a ~15s-TTL, deduplicated lookup) without paying for
 * the full context assembly and plan on a cache hit. One function, used by
 * both, so the cheap identity and the plan's kind cannot drift.
 */
export function verdictKindForQuote(quote: CompanyContext["quote"]): VerdictKind {
  switch (detectAssetClass(quote)) {
    case "fund":
      return "fund";
    case "crypto":
      return "crypto";
    case "commodity":
      return "commodity";
    case "forex":
      return "forex";
    case "macro":
      return "macro";
    default:
      return "equity";
  }
}

/**
 * Build the verdict plan for whatever this symbol turns out to be.
 *
 * Funds/crypto/commodities/forex/macro must NOT reuse `ctx.score`: that score is
 * computed from equity fundamentals which are mostly null for them, and showing
 * it beside an asset-class-native score is exactly the "two contradictory
 * headline scores" bug the India research path was built to avoid.
 */
export async function planVerdict(
  ctx: CompanyContext,
  portfolio: PortfolioFacts | null,
): Promise<VerdictPlan> {
  switch (verdictKindForQuote(ctx.quote)) {
    case "fund":
      return planFundVerdict(ctx);
    case "crypto":
      return planCryptoVerdict(ctx);
    case "commodity":
      return planCommodityVerdict(ctx);
    case "forex":
      return planForexVerdict(ctx);
    case "macro":
      return planMacroVerdict(ctx);
    default:
      return planEquityVerdict(ctx, portfolio);
  }
}
