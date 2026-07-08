/**
 * Task Registry — the single place task→model routing policy lives.
 *
 * Every AI call in the app names a `TaskType`; this registry says which
 * models are preferred for it, in priority order, plus generation defaults
 * (temperature/maxTokens/timeout/json mode). The Router (./router.ts) turns
 * a TaskType into an actual model choice against what's installed and
 * healthy. Adding a task or changing its routing is a registry edit — no
 * feature code changes.
 */

import type { ModelCapability } from "./models";

/** Every distinct AI job in the app. Add new tasks here, not ad hoc model picks. */
export type TaskType =
  | "company-research" // general company research / free-text copilot Q&A
  | "investment-thesis" // bull/bear thesis generation, IC thesis synthesis, verdicts
  | "sec-filing-analysis" // filings-grounded deep analysis
  | "risk-review" // 10-K / risk-domain IC agent
  | "accounting-red-flags" // accounting-domain IC agent
  | "scenario-analysis" // valuation scenarios, divergence explanations
  | "stress-testing" // portfolio/position stress scenarios
  | "explain-movement" // "why did this move" narratives
  | "portfolio-intelligence" // portfolio brief, CIO panel, audit, new-position suggestions
  | "watchlist-intelligence" // watchlist digest/alerts summarization
  | "opportunity-engine" // scanner: classification, causal chains, sector/company impact, dedup
  | "comparison" // multi-stock comparison narrative
  | "ic-agent-analysis" // IC agent domains without a more specific task (business/industry/competition/management/capitalAllocation/governance)
  | "thematic-analysis" // thematic engine's 10-stage framework
  | "market-summary" // regime/macro narrative
  | "timeline-analysis" // timeline event detail / what-changed
  | "knowledge-graph-explain" // KG node explanation
  | "calendar-brief" // earnings calendar AI brief
  | "nl-screener" // natural-language screener query parsing
  | "quick-summary" // short, low-stakes single-field summaries
  | "coding"; // code generation/review (not yet used by any feature; reserved)

export interface TaskConfig {
  /** Model ids tried in order; the Router intersects this with what's installed & healthy. */
  preferredModels: string[];
  /** Capabilities a model must have to be considered at all, beyond the preferred list. */
  requiredCapabilities?: ModelCapability[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the model to respond with JSON only. */
  jsonMode?: boolean;
}

/**
 * Routing policy per task. `preferredModels` reference {@link MODEL_REGISTRY}
 * ids (see ./models.ts) and are matched prefix-aware, so "qwen3" here matches
 * an installed "qwen3:30b-a3b" tag without pinning the exact size/quant.
 */
export const TASK_REGISTRY: Record<TaskType, TaskConfig> = {
  "company-research": {
    preferredModels: ["qwen3", "deepseek-r1", "llama3.1"],
    requiredCapabilities: ["long-context"],
  },
  "investment-thesis": {
    preferredModels: ["qwen3", "deepseek-r1"],
    requiredCapabilities: ["chain-of-thought"],
    maxTokens: 2048,
    jsonMode: true,
  },
  "sec-filing-analysis": {
    preferredModels: ["deepseek-r1", "qwen3"],
    requiredCapabilities: ["chain-of-thought", "long-context"],
    maxTokens: 2048,
    jsonMode: true,
  },
  "risk-review": {
    preferredModels: ["deepseek-r1", "qwen3"],
    requiredCapabilities: ["chain-of-thought"],
    maxTokens: 1536,
    jsonMode: true,
  },
  "accounting-red-flags": {
    preferredModels: ["deepseek-r1", "qwen3"],
    requiredCapabilities: ["chain-of-thought"],
    maxTokens: 1536,
    jsonMode: true,
  },
  "scenario-analysis": {
    preferredModels: ["deepseek-r1", "qwen3"],
    requiredCapabilities: ["chain-of-thought"],
    maxTokens: 2048,
    jsonMode: true,
  },
  "stress-testing": {
    preferredModels: ["deepseek-r1", "qwen3"],
    requiredCapabilities: ["chain-of-thought"],
    maxTokens: 1536,
    jsonMode: true,
  },
  "explain-movement": {
    preferredModels: ["deepseek-r1", "qwen3", "llama3.1"],
    maxTokens: 1024,
  },
  "portfolio-intelligence": {
    preferredModels: ["qwen3", "deepseek-r1", "llama3.1"],
    maxTokens: 1024,
    jsonMode: true,
  },
  "watchlist-intelligence": {
    preferredModels: ["qwen3", "llama3.1"],
    maxTokens: 1024,
    jsonMode: true,
  },
  "opportunity-engine": {
    preferredModels: ["qwen3", "llama3.1"],
    maxTokens: 2048,
    jsonMode: true,
  },
  comparison: {
    preferredModels: ["qwen3", "deepseek-r1"],
    maxTokens: 1800,
    jsonMode: true,
  },
  "ic-agent-analysis": {
    preferredModels: ["qwen3", "deepseek-r1", "llama3.1"],
    maxTokens: 1200,
    jsonMode: true,
  },
  "thematic-analysis": {
    preferredModels: ["qwen3", "llama3.1"],
    maxTokens: 2048,
    jsonMode: true,
  },
  "market-summary": {
    preferredModels: ["qwen3", "llama3.1", "mistral"],
    maxTokens: 800,
  },
  "timeline-analysis": {
    preferredModels: ["qwen3", "llama3.1"],
    maxTokens: 1800,
    jsonMode: true,
  },
  "knowledge-graph-explain": {
    preferredModels: ["qwen3", "llama3.1", "mistral"],
    maxTokens: 600,
  },
  "calendar-brief": {
    preferredModels: ["qwen3", "llama3.1", "mistral"],
    maxTokens: 600,
  },
  "nl-screener": {
    preferredModels: ["qwen3", "llama3.1"],
    requiredCapabilities: ["structured-json"],
    maxTokens: 512,
    jsonMode: true,
  },
  "quick-summary": {
    preferredModels: ["llama3.1", "mistral", "qwen3"],
    maxTokens: 400,
  },
  coding: {
    preferredModels: ["qwen2.5-coder", "qwen3"],
    requiredCapabilities: ["coding"],
    maxTokens: 2048,
  },
};

/** Map an IC agent domain to its task — accounting/valuation/risk get the reasoning-heavy route. */
export function taskForAgentDomain(
  domain: "business" | "industry" | "competition" | "management" | "capitalAllocation" | "accounting" | "valuation" | "governance" | "risk",
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
