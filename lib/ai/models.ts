/**
 * Model Registry — the single place model capabilities live.
 *
 * Business logic references models by *capability* (via the Task Registry, see
 * ./task-registry) and by id through this registry, never by hardcoded name.
 * Adding or swapping a model is a registry edit; no other layer changes.
 *
 * ## The numbers here are measured, not guessed
 *
 * `tokensPerSecond` and `quality` come from benchmarking the installed models on
 * this project's own prompts (see /PLAN-ai-platform.md). That matters, because
 * the intuitive answer was wrong twice:
 *
 *   - `qwen3:30b-a3b` is a Mixture-of-Experts model with only ~3.3B active
 *     parameters, so it "should" be the fast one. It is not: at 18.6GB it cannot
 *     be resident on a 17GB machine, so it thrashes and runs at 0.9 tok/s — 11x
 *     SLOWER than 4.4GB mistral. Parameter count does not predict latency;
 *     whether the weights fit in RAM does. Hence the Router's memory filter.
 *   - Bigger is not automatically a better trade. mistral answers a structured
 *     scoring task in 7.4s with 3/3 valid JSON; qwen3:14b needs 17.1s for the
 *     same. For short, low-stakes output that is a bad deal.
 */

import { memoryBudgetGb } from "./config";

/** Coarse capabilities the Task Registry routes on. Extend, don't overload. */
export type ModelCapability =
  | "reasoning" // strong multi-step analytical reasoning
  | "long-context" // reliable well beyond ~16k tokens
  | "coding" // code generation / review
  | "fast" // low latency; prefer for short/simple tasks
  | "structured-json"; // reliably follows "respond with JSON only"

/** How a model handles chain-of-thought. */
export type ThinkingMode =
  /** Toggleable per request (Qwen3). Off by default — measured ~5x latency cost. */
  | "hybrid"
  /** No reasoning channel; the `think` flag is never sent to it. */
  | "none";

/** What we know about a model, independent of whether it's installed. */
export interface ModelSpec {
  /** Provider-native id, exactly as `ollama list` names it. */
  id: string;
  label: string;
  family: "qwen" | "mistral" | "other";
  /** Which provider serves this model. Local-only today. */
  provider: "ollama";
  /** Usable context window in tokens. */
  contextWindow: number;
  /** Chain-of-thought support. */
  thinking: ThinkingMode;
  /** Sampling temperature tuned for grounded, analytical output. */
  temperature: number;
  /** Default request timeout in ms for tasks that don't override it. */
  timeoutMs: number;
  /** What this model is good at — the Router matches these against task requirements. */
  capabilities: ModelCapability[];
  /**
   * Reasoning strength, 1–10. Judgment, informed by benchmark output quality.
   * The Router weighs this against speed according to what the task needs.
   */
  quality: number;
  /** Measured generation speed on this host; ranks latency-sensitive tasks. */
  tokensPerSecond: number;
  /**
   * Expected weights size in GB. A *fallback*: the provider reports the real
   * size from Ollama and that wins. Kept so routing still works when the daemon
   * hasn't answered yet.
   */
  sizeGb: number;
  /** Lower = tried first among models the scorer ranks equally. */
  priority: number;
  /** Set false to take a model out of routing without deleting its entry. */
  enabled: boolean;
  /** One-line positioning shown in the model picker. */
  blurb: string;
}

/** Local Ollama daemon endpoint every "ollama" provider model is served from. */
export function endpointForProvider(provider: ModelSpec["provider"]): string {
  switch (provider) {
    case "ollama":
      return process.env.OLLAMA_HOST ?? "http://localhost:11434";
  }
}

/**
 * Known models, best first. Ids are exact installed tags — NOT family prefixes.
 *
 * The previous registry keyed on the bare family name ("qwen3"), so `qwen3:14b`
 * and `qwen3:30b-a3b` both resolved to one shared spec. The router was
 * structurally incapable of telling a 9.3GB model that works from an 18.6GB one
 * that thrashes, and got whichever `/api/tags` happened to list first. Exact
 * tags, always.
 */
export const MODEL_REGISTRY: ModelSpec[] = [
  {
    // Registered but not selectable on a 17GB host: the memory filter excludes
    // it. On a machine with the RAM to hold it, this becomes the best model here
    // and the Router starts choosing it with no code change — which is the whole
    // point of deriving a memory budget rather than hardcoding `enabled: false`.
    id: "qwen3:30b-a3b",
    label: "Qwen 3 30B (MoE)",
    family: "qwen",
    provider: "ollama",
    contextWindow: 32_768,
    thinking: "hybrid",
    temperature: 0.4,
    timeoutMs: 300_000,
    capabilities: ["reasoning", "long-context", "structured-json"],
    quality: 9,
    tokensPerSecond: 0.9, // measured while memory-starved; far higher when resident
    sizeGb: 18.6,
    priority: 0,
    enabled: true,
    blurb: "Strongest reasoning. Needs ~24GB+ RAM to be usable.",
  },
  {
    id: "qwen3:14b",
    label: "Qwen 3 14B",
    family: "qwen",
    provider: "ollama",
    contextWindow: 32_768,
    thinking: "hybrid",
    temperature: 0.4,
    timeoutMs: 300_000,
    capabilities: ["reasoning", "long-context", "structured-json"],
    quality: 8,
    tokensPerSecond: 5.0,
    sizeGb: 9.3,
    priority: 1,
    enabled: true,
    blurb: "Best reasoning that fits in memory. The analytical workhorse.",
  },
  {
    id: "mistral:latest",
    label: "Mistral 7B",
    family: "mistral",
    provider: "ollama",
    contextWindow: 32_768,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 120_000,
    capabilities: ["fast", "structured-json"],
    quality: 5,
    tokensPerSecond: 10.5,
    sizeGb: 4.4,
    priority: 2,
    enabled: true,
    blurb: "2x faster, reliably valid JSON. The fast lane for short output.",
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Qwen 2.5 Coder 14B",
    family: "qwen",
    provider: "ollama",
    contextWindow: 32_768,
    thinking: "none",
    temperature: 0.2,
    timeoutMs: 120_000,
    capabilities: ["coding", "structured-json"],
    quality: 6,
    tokensPerSecond: 5.0,
    sizeGb: 9.0,
    priority: 3,
    enabled: true,
    blurb: "Code-specialized. The only coding model within the memory budget.",
  },
  {
    // Same 18.6GB and same thrashing as qwen3:30b-a3b, and redundant besides:
    // UAA ships no coding feature, and qwen2.5-coder covers the reserved
    // `coding` task at half the footprint.
    id: "qwen3-coder:latest",
    label: "Qwen 3 Coder (MoE)",
    family: "qwen",
    provider: "ollama",
    contextWindow: 32_768,
    thinking: "none",
    temperature: 0.2,
    timeoutMs: 300_000,
    capabilities: ["coding", "long-context", "structured-json"],
    quality: 7,
    tokensPerSecond: 0.9,
    sizeGb: 18.6,
    priority: 9,
    enabled: true,
    blurb: "Code-specialized MoE. Needs ~24GB+ RAM.",
  },
  {
    // An agentic *coding* model with no role in an investment-research platform:
    // no UAA task would route to it even with RAM to spare, and at 14.3GB it is
    // over budget here anyway. Registered only so it is explicitly accounted for
    // rather than silently mis-specced — the old registry didn't know it, so it
    // inferred capabilities from the model's NAME and tagged this 23.6B dense
    // model as "fast".
    id: "devstral:24b",
    label: "Devstral 24B",
    family: "other",
    provider: "ollama",
    contextWindow: 32_768,
    thinking: "none",
    temperature: 0.2,
    timeoutMs: 300_000,
    capabilities: ["coding"],
    quality: 6,
    tokensPerSecond: 2.5,
    sizeGb: 14.3,
    priority: 10,
    enabled: false, // no research use-case; safe to `ollama rm`
    blurb: "Agentic coding model. Unused by UAA.",
  },
];

/**
 * Fallback spec for an installed model with no registry entry.
 *
 * Conservative by design: an unknown model gets NO capabilities, so the Router
 * can never *prefer* it — only fall back to it when nothing else is installed.
 * The old version inferred capabilities from substrings of the model's name,
 * which is how `devstral` (23.6B, dense, coding) came to be labelled "fast".
 * Guessing from a name is worse than admitting ignorance.
 */
export function genericSpec(id: string): ModelSpec {
  const lower = id.toLowerCase();
  const family: ModelSpec["family"] = lower.includes("qwen")
    ? "qwen"
    : lower.includes("mistral")
      ? "mistral"
      : "other";
  return {
    id,
    label: id,
    family,
    provider: "ollama",
    contextWindow: 8_192,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 120_000,
    capabilities: [],
    quality: 3,
    tokensPerSecond: 5,
    sizeGb: 0, // unknown; the provider's reported size overrides this
    priority: 99,
    enabled: true,
    blurb: "Locally installed model, not in the registry.",
  };
}

/**
 * Resolve a registry spec for an installed model id. Exact match — the registry
 * keys on full tags, so there is no prefix fuzziness left to get wrong.
 */
export function specForInstalled(installedId: string): ModelSpec {
  return MODEL_REGISTRY.find((m) => m.id === installedId) ?? genericSpec(installedId);
}

/**
 * Can this model actually run here? A model whose weights exceed the memory
 * budget doesn't degrade gracefully — it swaps, and throughput collapses by ~11x
 * (measured). So this is a hard eligibility gate in the Router, not a ranking
 * penalty: a 302s answer is a failure, not a slow success.
 *
 * `reportedSizeGb` (from Ollama's /api/tags) wins over the registry's declared
 * size when available, so the check reflects what is really installed.
 */
export function fitsInMemory(spec: ModelSpec, reportedSizeGb?: number): boolean {
  const size = reportedSizeGb && reportedSizeGb > 0 ? reportedSizeGb : spec.sizeGb;
  if (size <= 0) return true; // size unknown — don't exclude on a guess
  return size <= memoryBudgetGb();
}

/** A model offered to the UI: its spec plus whether it's installed locally. */
export interface ModelOption extends ModelSpec {
  installed: boolean;
}

/**
 * Merge the registry with the installed set into the picker list: installed
 * models first (registry order), then known-but-not-installed ones so the user
 * can see what to `ollama pull`. Pure / testable.
 */
export function buildModelOptions(installed: string[]): ModelOption[] {
  const installedSet = new Set(installed);
  const seen = new Set<string>();
  const options: ModelOption[] = [];

  for (const id of installed) {
    const spec = specForInstalled(id);
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    options.push({ ...spec, installed: true });
  }
  for (const spec of MODEL_REGISTRY) {
    if (seen.has(spec.id) || installedSet.has(spec.id)) continue;
    seen.add(spec.id);
    options.push({ ...spec, installed: false });
  }
  return options;
}

/**
 * Default model for the picker UI: the best installed model that is enabled and
 * actually fits in memory. An env override is honored only if that model is
 * installed AND fits — `OLLAMA_MODEL` must not be able to pin the app to a model
 * that cannot run.
 */
export function pickDefaultModel(
  installed: string[],
  envModel = process.env.OLLAMA_MODEL,
): string | null {
  if (installed.length === 0) return null;
  if (envModel && installed.includes(envModel) && fitsInMemory(specForInstalled(envModel))) {
    return envModel;
  }
  const eligible = installed
    .map((id) => specForInstalled(id))
    .filter((s) => s.enabled && fitsInMemory(s))
    .sort((a, b) => b.quality - a.quality || a.priority - b.priority);
  return eligible[0]?.id ?? installed[0];
}
