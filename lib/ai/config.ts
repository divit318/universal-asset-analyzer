/**
 * AI Platform configuration — routing policy that can change without code.
 *
 * Everything here is env-overridable. Repointing a task at a different model,
 * benching a model, or moving the memory ceiling is a config change, never an
 * edit to the Router or to feature code.
 *
 *   AI_MAX_MODEL_GB      — memory ceiling for a routable model (default: 75% of
 *                          RAM). Only meaningful for a local provider; dormant
 *                          today with the hosted-only chain.
 *   AI_DISABLED_MODELS   — comma-separated model ids to take out of routing
 *   AI_TASK_<TASK>       — pin one task to an ordered model list, e.g.
 *                          AI_TASK_NL_SCREENER="claude-opus-5-low"
 *                          (task name upper-cased, '-' → '_')
 */

import { totalmem } from "node:os";
import type { ProviderId } from "./models";
import type { TaskType } from "./task-registry";

/**
 * Fraction of system RAM a model's weights may occupy and still be considered
 * routable. The rest is headroom for the KV cache, the OS, and Next.js itself.
 *
 * This is the single most consequential number in the platform. Measured on a
 * 17GB M4: an 18.6GB model ran at 0.9 tok/s (302s for one answer) because it
 * could not stay resident, while a 4.4GB model on the same prompt ran at 10.5
 * tok/s. Exceeding memory is not "slower", it is broken.
 */
const DEFAULT_MEMORY_FRACTION = 0.75;

function envNumber(key: string): number | null {
  const raw = process.env[key];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Largest model (GB of weights) the Router will consider on this machine.
 *
 * Derived from actual system memory rather than hardcoded, so the same registry
 * is correct on a 17GB laptop (→ ~12.7GB budget, excludes the 30B models) and on
 * a 64GB workstation (→ 48GB, includes them). Not cached: `totalmem()` is a cheap
 * syscall and tests override the env var between cases.
 */
export function memoryBudgetGb(): number {
  return envNumber("AI_MAX_MODEL_GB") ?? (totalmem() / 1e9) * DEFAULT_MEMORY_FRACTION;
}

const KNOWN_PROVIDERS: readonly ProviderId[] = [
  "devin",
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "ollama",
];

/**
 * The DEFAULT provider chain, best first (owner decision, 2026-08-06: the
 * platform is provider-agnostic and never requires an Anthropic key).
 *
 *   1. devin      — the Devin CLI (`devin -p`), Cognition-hosted models on the
 *                   user's own `devin login`. Zero API keys; works out of the
 *                   box. Measured 8.9s for a light JSON task on this host.
 *   2. anthropic  — direct Anthropic API when the user configures a key
 *                   (real token streaming, prompt caching, native structured
 *                   outputs — the richest wire features of the chain).
 *   3. openai / gemini / openrouter — BYO-key hosted APIs, dormant until a
 *                   key exists (health = key presence; they cost nothing to
 *                   keep in the chain).
 *   6. ollama     — the local daemon, offline fallback of last resort.
 *
 * Reorder without code via AI_PROVIDER_ORDER, e.g.:
 *
 *   AI_PROVIDER_ORDER=anthropic,devin   # direct API first
 *   AI_PROVIDER_ORDER=ollama            # local-only (plane / captive portal)
 *
 * Unknown names are dropped rather than throwing — a typo in an env var must
 * not take the platform down — and an order that names nothing valid falls
 * back to the default.
 */
const DEFAULT_PROVIDER_ORDER: readonly ProviderId[] = [
  "devin",
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "ollama",
];

export function providerOrder(): ProviderId[] {
  const raw = process.env.AI_PROVIDER_ORDER;
  if (!raw) return [...DEFAULT_PROVIDER_ORDER];
  const seen = new Set<ProviderId>();
  for (const part of raw.split(",").map((s) => s.trim().toLowerCase())) {
    const match = KNOWN_PROVIDERS.find((p) => p === part);
    if (match) seen.add(match);
  }
  return seen.size > 0 ? [...seen] : [...DEFAULT_PROVIDER_ORDER];
}

/** Model ids taken out of routing entirely, via AI_DISABLED_MODELS. */
export function disabledModels(): Set<string> {
  const raw = process.env.AI_DISABLED_MODELS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Static per-task model pins. An entry here overrides the Router's scoring
 * entirely and is tried in the order given (still subject to the availability
 * check — a pin cannot conjure a model the provider doesn't offer).
 *
 * One model, three depths: every id below is claude-opus-5 at a different
 * effort tier (see lib/ai/models.ts). The tier IS the task policy — deep
 * research earns the largest reasoning budget, interactive parsing the
 * smallest. Order within each pin = primary, then the fallback the Router
 * walks on failure: a transiently failing high-effort call degrades to a
 * shallower tier of the same model rather than to nothing.
 */
const LIGHT_PIN = ["claude-opus-5-low"];
const STANDARD_PIN = ["claude-opus-5-medium", "claude-opus-5-low"];
const DEEP_PIN = ["claude-opus-5-high", "claude-opus-5-medium"];

export const TASK_MODEL_PINS: Partial<Record<TaskType, string[]>> = {
  /* ---- deep: institutional reasoning; quality then adherence ------------- */
  "investment-thesis": DEEP_PIN,
  "sec-filing-analysis": DEEP_PIN,
  "risk-review": DEEP_PIN,
  "accounting-red-flags": DEEP_PIN,
  "scenario-analysis": DEEP_PIN,
  "stress-testing": DEEP_PIN,
  "ic-agent-analysis": DEEP_PIN,
  "thematic-analysis": DEEP_PIN,

  /* ---- standard: substantive JSON/narrative work -------------------------- */
  "company-research": STANDARD_PIN,
  "fund-research": STANDARD_PIN,
  "crypto-research": STANDARD_PIN,
  "commodity-research": STANDARD_PIN,
  "forex-research": STANDARD_PIN,
  "macro-research": STANDARD_PIN,
  "manual-asset-research": STANDARD_PIN,
  comparison: STANDARD_PIN,
  "portfolio-intelligence": STANDARD_PIN,
  "portfolio-audit": STANDARD_PIN,
  "watchlist-intelligence": STANDARD_PIN,
  "opportunity-engine": STANDARD_PIN,
  "timeline-analysis": STANDARD_PIN,
  "explain-movement": STANDARD_PIN,
  "portfolio-construction": STANDARD_PIN,
  // Interactive but standard-complexity: real judgment, so medium effort
  // rather than the light tier.
  "chart-qa": STANDARD_PIN,
  "app-assistant": STANDARD_PIN,
  coding: STANDARD_PIN,

  /* ---- light: parsing and one-liners; latency is the product -------------- */
  "market-summary": LIGHT_PIN,
  "daily-briefing": LIGHT_PIN,
  "knowledge-graph-explain": LIGHT_PIN,
  "calendar-brief": LIGHT_PIN,
  "nl-screener": LIGHT_PIN,
  "quick-summary": LIGHT_PIN,
};

/** Env-var pin for a task, e.g. AI_TASK_NL_SCREENER="claude-opus-5-medium". */
function envPin(taskType: TaskType): string[] | null {
  const key = `AI_TASK_${taskType.toUpperCase().replace(/-/g, "_")}`;
  const raw = process.env[key];
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/** The pinned model list for a task, if any. Env wins over the static table. */
export function pinnedModels(taskType: TaskType): string[] | null {
  return envPin(taskType) ?? TASK_MODEL_PINS[taskType] ?? null;
}
