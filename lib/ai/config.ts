/**
 * AI Platform configuration — routing policy that can change without code.
 *
 * Everything here is env-overridable. Repointing a task at a different model,
 * benching a model, or moving the memory ceiling is a config change, never an
 * edit to the Router or to feature code.
 *
 *   AI_MAX_MODEL_GB      — memory ceiling for a routable model (default: 75% of RAM)
 *   AI_DISABLED_MODELS   — comma-separated model ids to take out of routing
 *   AI_PROVIDER_ORDER    — provider chain, best first (default: "devin,ollama")
 *   AI_TASK_<TASK>       — pin one task to an ordered model list, e.g.
 *                          AI_TASK_NL_SCREENER="mistral:latest,qwen3:14b"
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

const KNOWN_PROVIDERS: readonly ProviderId[] = ["devin", "ollama"];

/**
 * The DEFAULT chain is hosted-first: Devin primary, Ollama fallback.
 *
 * This is the signed-off product decision (2026-08-02): Devin is the primary
 * AI provider for all UAA work; Ollama remains in the chain as the offline
 * fallback, not the default. The measured basis: hosted answers in 4-20s
 * against 28-115s local on the same prompts, nine concurrent calls in 5.3s
 * where Ollama serializes them into minutes, and the per-task bench in
 * bench-out/model-bench/ (mapping + numbers in TASK_MODEL_PINS below).
 * Local-only remains one env var away for offline work:
 *
 *   AI_PROVIDER_ORDER=ollama         # local-only (plane / captive portal)
 *
 * Unknown names are dropped rather than throwing — a typo in an env var
 * should not take the whole platform down — and an order that names nothing
 * valid falls back to the default.
 */
const DEFAULT_PROVIDER_ORDER: readonly ProviderId[] = ["devin", "ollama"];

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
 * entirely and is tried in the order given (still subject to the memory and
 * installed checks — a pin cannot conjure a model that can't run).
 *
 * ## The hosted mapping below is MEASURED, not assumed (2026-08-02)
 *
 * Bench: scripts/devin-model-bench.ts — real UAA prompts (the live
 * nl-screener system prompt, the persisted AAPL movement dossier, the real
 * calendar week, a deep thesis over the same dossiers) against the live
 * catalogue (165 variants; `devin models list`). Means of 2 runs, wall-clock
 * including the ~2s CLI spawn, strict wire-schema validation:
 *
 *   LIGHT     swe-1-6-fast 9.0s/11.5s (4/4 valid)   gpt-5-6-luna-low 7.8s json
 *             but 17.6s prose (4/4)                 gemini-3-6-flash-minimal
 *             8.6s/13.3s (4/4)
 *             swe-1-7-lightning REJECTED: returned EMPTY output 1/2 on JSON
 *             (44.9s mean) — newer is not better here.
 *   STANDARD  claude-sonnet-5-low 21.8s (2/2, richest cross-evidence
 *             synthesis: pulled the sector-wide shakeout headline the others
 *             missed)                               gpt-5-6-terra-low 19.6s
 *             (2/2, slightly more conservative)     claude-5-fable-low 30.9s,
 *             gemini-3-6-flash-medium 36.6s — slower, no quality edge.
 *   DEEP      claude-opus-5-low 51.6s (2/2, quote-level evidence grounding)
 *             claude-sonnet-5-medium 47.1s (2/2)    claude-opus-5-medium
 *             DEMOTED to third: violated the schema's array cap 1/2 runs
 *             (7 risks > max 6) — highest quality tier, weakest adherence,
 *             and the CLI path has no corrective turn.
 *
 * Order within each pin = primary, then fallback the Router walks on failure.
 * Ollama models are deliberately NOT pinned here: when the chain falls
 * through to the local provider (offline, hosted outage), the scorer picks
 * the best installed local model exactly as before.
 */
const LIGHT_PIN = ["swe-1-6-fast", "gpt-5-6-luna-low", "gemini-3-6-flash-minimal"];
const STANDARD_PIN = ["claude-sonnet-5-low", "gpt-5-6-terra-low"];
const DEEP_PIN = ["claude-opus-5-low", "claude-sonnet-5-medium", "claude-opus-5-medium"];

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
  // Interactive but standard-complexity: real judgment, and hosted sonnet's
  // ~20s beats local qwen3:14b's 28-115s anyway.
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

/** Env-var pin for a task, e.g. AI_TASK_NL_SCREENER="mistral:latest". */
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
