/**
 * Task Registry — the single place task→model routing policy lives.
 *
 * Every AI call in the app names a {@link TaskType}. This registry declares what
 * that task *needs*; the Router (./router.ts) works out which installed model
 * best satisfies it. Adding a task, or a model, changes nothing else.
 *
 * ## Why requirements instead of a model list
 *
 * The previous registry hand-maintained a `preferredModels: string[]` for each
 * of 30 tasks — 30 copies of the same policy, which is precisely how it drifted:
 * it listed `deepseek-r1` and `llama3.1` (neither installed, so the top
 * preference of every reasoning task silently resolved to nothing) while not
 * knowing the models that *were* installed. Adding one model meant editing 30
 * lines, so nobody did.
 *
 * A task now declares its reasoning complexity, latency sensitivity, context
 * needs, and output shape. The Router scores the installed models against that.
 * To override a specific decision, pin the task in ./config.ts — no code change.
 */

/** Every distinct AI job in the app. Add new tasks here, not ad hoc model picks. */
export type TaskType =
  | "company-research" // general company research / free-text copilot Q&A
  | "fund-research" // fund (ETF/mutual/closed-end): holdings, allocation, cost, category-relative performance
  | "crypto-research" // crypto: momentum, relative strength vs BTC, risk-adjusted return, drawdown
  | "commodity-research" // commodity: momentum, relative strength vs index, news-grounded supply/demand
  | "forex-research" // forex: momentum, relative strength vs Dollar Index, news-grounded macro
  | "derivatives-research" // options chain: implied vol, term structure, open-interest positioning, Greeks
  | "macro-research" // yield curve shape/trend + news-grounded inflation/GDP/employment
  | "manual-asset-research" // real estate / private markets / alternatives: computed metrics over user-entered facts
  | "investment-thesis" // bull/bear thesis generation, IC thesis synthesis, verdicts
  | "sec-filing-analysis" // filings-grounded deep analysis
  | "risk-review" // 10-K / risk-domain IC agent
  | "accounting-red-flags" // accounting-domain IC agent
  | "scenario-analysis" // valuation scenarios, divergence explanations
  | "stress-testing" // portfolio/position stress scenarios
  | "explain-movement" // "why did this move" narratives
  | "portfolio-intelligence" // portfolio brief + new-position suggestions (JSON)
  | "portfolio-audit" // CIO audit memo (prose; see note in the registry below)
  | "watchlist-intelligence" // watchlist digest/alerts summarization
  | "opportunity-engine" // scanner: classification, causal chains, sector/company impact, dedup
  | "comparison" // multi-stock comparison narrative
  | "ic-agent-analysis" // IC agent domains without a more specific task
  | "thematic-analysis" // thematic engine's 10-stage framework
  | "market-summary" // regime/macro narrative
  | "daily-briefing" // Mission Control's daily digest narration
  | "timeline-analysis" // timeline event detail / what-changed
  | "knowledge-graph-explain" // KG node explanation
  | "calendar-brief" // earnings calendar AI brief
  | "nl-screener" // natural-language screener query parsing
  | "portfolio-construction" // Simulator intake: decide the next follow-up question for a hypothetical-portfolio mandate (JSON)
  | "quick-summary" // short, low-stakes single-field summaries
  | "chart-qa" // one-off interactive Q&A about the fullscreen chart workspace's current context
  | "app-assistant" // global "how do I…" helper: explains the app AND can navigate/preload pages, aware only of the current page — not a research surface
  | "coding"; // code generation/review (reserved; no feature ships this yet)

/** How much genuine multi-step reasoning the task needs. */
export type Complexity =
  /** Institutional analysis: theses, filings, valuation, risk. Quality dominates. */
  | "deep"
  /** Substantive narrative or structured analysis. Balanced. */
  | "standard"
  /** Short, mechanical, low-stakes: parse a query, one-line summary. Speed dominates. */
  | "light";

/** How much the user is waiting on this. */
export type LatencySensitivity =
  /** A human is watching a spinner. Every second counts. */
  | "interactive"
  /** On-page content the user expects "soon". */
  | "standard"
  /** Background/long-running job; correctness far outweighs latency. */
  | "background";

export interface TaskConfig {
  /** Reasoning requirement — drives how heavily model quality is weighted. */
  complexity: Complexity;
  /** Latency requirement — drives how heavily model speed is weighted. */
  latency: LatencySensitivity;
  /** Minimum usable context window, when the task assembles a large dossier. */
  contextTokens?: number;
  /** Output requirement: the model must emit JSON only. Implies `thinking: false`. */
  jsonMode?: boolean;
  /**
   * Opt into chain-of-thought for reasoning models.
   *
   * Off everywhere by default, and deliberately so: measured on qwen3:14b,
   * thinking cost 143s vs 28s (5x) for a comparable answer, and under
   * `jsonMode` it is not merely slow but *broken* — the model returns the
   * literal `{}` (0/3 valid vs 3/3 with thinking off). The Router hard-forces
   * this to false whenever `jsonMode` is set; setting both is a config error,
   * not a preference.
   */
  thinking?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Which analysis backend runs this task ("ollama" | "devin" | "auto").
   * Resolution order and the interactive-tier guardrail live in
   * lib/ai/analysis-provider.ts:resolveProvider. Unset = "auto" (follow the
   * AI_PROVIDER global default).
   */
  provider?: "ollama" | "devin" | "auto";
  /**
   * Total wall-clock budget for a Devin session running this task, AFTER
   * which the session is terminated and the run marked timeout. Amendment 3
   * (ai-migration/04): sized off the observed MAX, never the median — the
   * spike's 84 runs peaked at 48.8s for a movement-class analysis, so a
   * small-analysis budget of 240s is ~5x the worst case. Unset = 8 min for
   * standard tasks, 15 min for latency:"background" tasks.
   */
  devinTimeoutMs?: number;
  /** Hard per-session ACU cap for this task (default: DEVIN_MAX_ACU env or 4). */
  devinMaxAcu?: number;
}

/**
 * What each task needs. Note there is not a single model name in this file —
 * that is the point.
 */
export const TASK_REGISTRY: Record<TaskType, TaskConfig> = {
  /* ---- Deep analysis: institutional research quality is the product ------- */
  "investment-thesis": {
    complexity: "deep",
    latency: "background",
    jsonMode: true,
    maxTokens: 2048,
    timeoutMs: 300_000,
  },
  "sec-filing-analysis": {
    complexity: "deep",
    latency: "background",
    contextTokens: 16_000,
    jsonMode: true,
    maxTokens: 2048,
    timeoutMs: 300_000,
  },
  "risk-review": {
    complexity: "deep",
    latency: "background",
    jsonMode: true,
    maxTokens: 1536,
    timeoutMs: 300_000,
  },
  "accounting-red-flags": {
    complexity: "deep",
    latency: "background",
    jsonMode: true,
    maxTokens: 1536,
    timeoutMs: 300_000,
  },
  "scenario-analysis": {
    complexity: "deep",
    latency: "background",
    jsonMode: true,
    maxTokens: 2048,
    timeoutMs: 300_000,
  },
  "stress-testing": {
    complexity: "deep",
    latency: "background",
    jsonMode: true,
    maxTokens: 1536,
    timeoutMs: 300_000,
  },
  "ic-agent-analysis": {
    complexity: "deep",
    latency: "background",
    jsonMode: true,
    maxTokens: 1200,
    timeoutMs: 300_000,
  },
  "thematic-analysis": {
    complexity: "deep",
    latency: "background",
    jsonMode: true,
    maxTokens: 2048,
    timeoutMs: 300_000,
  },

  /* ---- Standard: substantive research the user is waiting on -------------- */
  "company-research": {
    complexity: "standard",
    latency: "standard",
    contextTokens: 16_000,
  },
  "fund-research": { complexity: "standard", latency: "standard", contextTokens: 16_000 },
  "crypto-research": { complexity: "standard", latency: "standard", contextTokens: 16_000 },
  "commodity-research": { complexity: "standard", latency: "standard", contextTokens: 16_000 },
  "forex-research": { complexity: "standard", latency: "standard", contextTokens: 16_000 },
  "derivatives-research": { complexity: "standard", latency: "standard", contextTokens: 16_000 },
  "macro-research": { complexity: "standard", latency: "standard", contextTokens: 16_000 },
  "manual-asset-research": { complexity: "standard", latency: "standard", contextTokens: 16_000 },
  comparison: {
    complexity: "standard",
    latency: "standard",
    jsonMode: true,
    maxTokens: 1800,
  },
  "portfolio-intelligence": {
    complexity: "standard",
    latency: "standard",
    jsonMode: true,
    maxTokens: 1024,
    timeoutMs: 180_000,
  },
  // Split out from portfolio-intelligence: the CIO panel streams a *prose* memo
  // while the brief and new-position callers want JSON. One task cannot declare
  // two output shapes — when the audit route bypassed the platform this went
  // unnoticed, but routing it through a `jsonMode: true` task would have turned
  // the memo into a JSON blob. Output shape is a task property, not a call-site
  // flag.
  "portfolio-audit": {
    complexity: "standard",
    latency: "standard",
    maxTokens: 1024,
    timeoutMs: 180_000,
  },
  "watchlist-intelligence": {
    complexity: "standard",
    latency: "standard",
    jsonMode: true,
    maxTokens: 1024,
    // Tranche-2 migrated task: tail-based Devin budget (amendment 3), same
    // movement-class sizing (~5x the observed 48.8s session max).
    devinTimeoutMs: 240_000,
  },
  "opportunity-engine": {
    complexity: "standard",
    latency: "background",
    jsonMode: true,
    maxTokens: 2048,
    timeoutMs: 300_000,
    // Without this the scanner ran at Ollama's 4096 default while its
    // company-impact prompts alone measured ~2.7k tokens (2026-07-31) — plus
    // the 2048-token generation cap, the window was silently overflowing and
    // shifting the oldest prompt tokens (the instructions) out of context.
    contextTokens: 8_192,
  },
  "timeline-analysis": {
    complexity: "standard",
    latency: "standard",
    jsonMode: true,
    maxTokens: 1800,
  },
  "explain-movement": {
    complexity: "standard",
    latency: "standard",
    maxTokens: 1024,
    // First migrated call site (ai-migration/03 §9). Budget sized off the
    // spike's observed MAX (48.8s across 84 runs), not the 22s median.
    devinTimeoutMs: 240_000,
  },

  /* ---- Light: short output where latency is what the user actually feels -- */
  "market-summary": { complexity: "light", latency: "standard", maxTokens: 800 },
  "daily-briefing": { complexity: "light", latency: "standard", maxTokens: 800 },
  "knowledge-graph-explain": { complexity: "light", latency: "interactive", maxTokens: 600 },
  // Tranche-2 migrated (text mode); interactive → stays on Ollama under a
  // global AI_PROVIDER=devin unless pinned. devinTimeoutMs applies when pinned.
  "calendar-brief": { complexity: "light", latency: "interactive", maxTokens: 600, devinTimeoutMs: 240_000 },
  "nl-screener": {
    // Parsing a search box into filters. The user is staring at a spinner and
    // there is no research quality to protect — pure latency play.
    complexity: "light",
    latency: "interactive",
    jsonMode: true,
    maxTokens: 512,
    temperature: 0.1,
  },
  "quick-summary": { complexity: "light", latency: "interactive", maxTokens: 400, devinTimeoutMs: 240_000 },
  // Simulator intake + generation — a human is in a live back-and-forth (or
  // watching a staged progress bar) with this exact task, so latency is
  // interactive; but choosing WHICH gap in an investor profile matters next,
  // spotting contradictions like preserve_capital at risk 9/10, and designing
  // an allocation is genuine judgment, not query parsing, so complexity stays
  // standard. maxTokens covers the largest output shape (a ~15-holding
  // selection with per-pick rationales); intake turns simply stop early. The
  // 150s budget covers a cold model load (see app-assistant's note); warm
  // turns are seconds, and the generation route passes a wider explicit
  // budget per call.
  "portfolio-construction": {
    complexity: "standard",
    latency: "interactive",
    jsonMode: true,
    temperature: 0.4,
    maxTokens: 1600,
    timeoutMs: 150_000,
  },
  // Interactive — a human is watching this exact spinner while the fullscreen
  // chart's AI dock is open. Standard complexity (real interpretive judgment
  // about a chart's selection/context, not just parsing a search box like
  // nl-screener) but interactive latency, so speed is weighted the same as
  // nl-screener; jsonMode alone now gates on "structured-json" (see
  // requiredCapabilities in router.ts), no separate capability list needed.
  "chart-qa": {
    complexity: "standard",
    latency: "interactive",
    jsonMode: true,
    temperature: 0.35,
    maxTokens: 900,
    timeoutMs: 45_000,
  },
  // A human is watching this exact panel too. Standard complexity — it has to
  // reason about what the user is actually asking, not just parse a query —
  // but the answer itself is short, so maxTokens stays low.
  "app-assistant": {
    complexity: "standard",
    latency: "interactive",
    jsonMode: true,
    temperature: 0.3,
    maxTokens: 500,
    // 45s could not cover a COLD model load, so on a host where the model had
    // been evicted the panel could never answer at all — measured here, 69.6s
    // to load a 4.4GB model and 0.4s to generate. Generation was never the
    // problem. Two changes make a budget this large safe rather than reckless:
    // the Router no longer retries the remaining candidates after a timeout (so
    // this is the total wait, not a third of it), and interactive tasks now hold
    // the model for 30m, so only the first question of a session pays the load.
    timeoutMs: 150_000,
  },

  /* ---- Reserved ---------------------------------------------------------- */
  coding: {
    complexity: "standard",
    latency: "standard",
    maxTokens: 2048,
  },
};

/** Map an IC agent domain to its task — accounting/valuation/risk get their own. */
export function taskForAgentDomain(
  domain:
    | "business"
    | "industry"
    | "competition"
    | "management"
    | "capitalAllocation"
    | "accounting"
    | "valuation"
    | "governance"
    | "risk",
): TaskType {
  switch (domain) {
    case "accounting":
      return "accounting-red-flags";
    case "valuation":
      return "scenario-analysis";
    case "risk":
      return "risk-review";
    default:
      return "ic-agent-analysis";
  }
}
