/**
 * Model Registry — the single place model capabilities live.
 *
 * Business logic references models by *capability* (via the Task Registry,
 * see ./task-registry) and by id through this registry, never by hardcoded
 * name. Switching the local model, or adding a future Ollama model — local or
 * a future hosted provider — is a registry edit, no other layer changes.
 */

/** Coarse capabilities the Task Registry routes on. Extend, don't overload. */
export type ModelCapability =
  | "chain-of-thought" // emits/benefits from explicit step-by-step reasoning
  | "long-context" // reliable well beyond ~16k tokens
  | "coding" // code generation / review
  | "fast" // low latency, prefer for short/simple tasks
  | "structured-json"; // reliably follows "respond with JSON only"

/** What we know about a model, independent of whether it's installed. */
export interface ModelSpec {
  /** Provider-native model id, e.g. "qwen3:30b-a3b". Also matches `ollama pull <id>`. */
  id: string;
  /** Short display label. */
  label: string;
  /** Model family for prompt tuning. */
  family: "qwen" | "deepseek" | "llama" | "mistral" | "other";
  /** Which provider serves this model. Local-only today; future entries may add others. */
  provider: "ollama";
  /** Usable context window in tokens. */
  contextWindow: number;
  /** Emits <think>…</think> reasoning we must segregate from the answer. */
  reasoning: boolean;
  /** Sampling temperature tuned for grounded, analytical output. */
  temperature: number;
  /** Default cap on generated tokens for tasks that don't override it. */
  maxTokens: number;
  /** Default request timeout in ms for tasks that don't override it. */
  timeoutMs: number;
  /** What this model is good at — the Task Registry matches on these. */
  capabilities: ModelCapability[];
  /** Lower = tried first when multiple installed models satisfy a task. */
  priority: number;
  /** Set false to take a model out of routing consideration without deleting it. */
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
 * Known models, best first. `id`s match what users would `ollama pull`. Prefix
 * matching (see {@link specForInstalled}) means tagged variants like
 * "qwen3:30b-a3b" still resolve to their base "qwen3" spec, so routing config
 * can reference the family without pinning an exact quantization/size tag.
 */
export const MODEL_REGISTRY: ModelSpec[] = [
  {
    id: "qwen3",
    label: "Qwen 3",
    family: "qwen",
    provider: "ollama",
    contextWindow: 32_768,
    reasoning: true,
    temperature: 0.4,
    maxTokens: 2048,
    timeoutMs: 120_000,
    capabilities: ["chain-of-thought", "long-context", "structured-json"],
    priority: 1,
    enabled: true,
    blurb: "Strong reasoning + long context. Great default for deep analysis.",
  },
  {
    id: "deepseek-r1",
    label: "DeepSeek R1",
    family: "deepseek",
    provider: "ollama",
    contextWindow: 32_768,
    reasoning: true,
    temperature: 0.5,
    maxTokens: 2048,
    timeoutMs: 150_000,
    capabilities: ["chain-of-thought", "long-context"],
    priority: 2,
    enabled: false,
    blurb: "Chain-of-thought reasoning model; best for valuation and risk logic.",
  },
  {
    id: "qwen2.5-coder",
    label: "Qwen 2.5 Coder",
    family: "qwen",
    provider: "ollama",
    contextWindow: 32_768,
    reasoning: false,
    temperature: 0.2,
    maxTokens: 2048,
    timeoutMs: 120_000,
    capabilities: ["coding", "structured-json"],
    priority: 3,
    enabled: true,
    blurb: "Code-specialized model for coding tasks.",
  },
  {
    id: "llama3.1",
    label: "Llama 3.1",
    family: "llama",
    provider: "ollama",
    contextWindow: 32_768,
    reasoning: false,
    temperature: 0.4,
    maxTokens: 1536,
    timeoutMs: 90_000,
    capabilities: ["fast", "structured-json"],
    priority: 4,
    enabled: true,
    blurb: "Well-rounded instruction following; fast and reliable.",
  },
  {
    id: "mistral",
    label: "Mistral",
    family: "mistral",
    provider: "ollama",
    contextWindow: 32_768,
    reasoning: false,
    temperature: 0.4,
    maxTokens: 1024,
    timeoutMs: 60_000,
    capabilities: ["fast"],
    priority: 5,
    enabled: true,
    blurb: "Compact 7B; low latency for quick research summaries.",
  },
];

/** Fallback spec for an installed model we don't have an explicit entry for. */
function genericSpec(id: string): ModelSpec {
  const lower = id.toLowerCase();
  const family: ModelSpec["family"] = lower.includes("qwen")
    ? "qwen"
    : lower.includes("deepseek")
      ? "deepseek"
      : lower.includes("llama")
        ? "llama"
        : lower.includes("mistral")
          ? "mistral"
          : "other";
  const reasoning = lower.includes("r1") || lower.includes("qwen3") || lower.includes("qwq");
  return {
    id,
    label: id,
    family,
    provider: "ollama",
    contextWindow: 8_192,
    reasoning,
    temperature: 0.4,
    maxTokens: 1024,
    timeoutMs: 90_000,
    capabilities: reasoning ? ["chain-of-thought"] : ["fast"],
    priority: 99,
    enabled: true,
    blurb: "Locally installed model.",
  };
}

/**
 * Resolve a registry spec for an installed Ollama model id. Matches by exact
 * id, or by the id's `:`-tag base (so "qwen3:8b" → the "qwen3" spec), else a
 * generic spec inferred from the name. Deliberately NOT a loose `startsWith`
 * in either direction — that previously matched an unrelated model like
 * "qwen3-coder" to the "qwen3" spec just because the string starts the same,
 * silently routing general-purpose tasks to a coding-specialized model. Pure
 * / testable.
 */
export function specForInstalled(installedId: string): ModelSpec {
  const base = installedId.split(":")[0].toLowerCase();
  const match = MODEL_REGISTRY.find((m) => m.id === installedId || base === m.id);
  return match ? { ...match, id: installedId } : genericSpec(installedId);
}

/**
 * Choose the default model from the set actually installed, honoring an env
 * override when that model is present. Preference follows registry order
 * (best first); falls back to the first installed model. Pure / testable.
 */
export function pickDefaultModel(
  installed: string[],
  envModel = process.env.OLLAMA_MODEL,
): string | null {
  if (installed.length === 0) return null;
  if (envModel && installed.includes(envModel)) return envModel;
  for (const spec of MODEL_REGISTRY) {
    const hit = installed.find((id) => id === spec.id || id.split(":")[0] === spec.id);
    if (hit) return hit;
  }
  return installed[0];
}

/** A model offered to the UI: its spec plus whether it's installed locally. */
export interface ModelOption extends ModelSpec {
  installed: boolean;
}

/**
 * Merge the registry with the installed set into the picker list: installed
 * models first (in registry order), then known-but-not-installed models so the
 * user can see what to `ollama pull`. Pure / testable.
 */
export function buildModelOptions(installed: string[]): ModelOption[] {
  const installedSet = new Set(installed.map((i) => i.split(":")[0]));
  const seen = new Set<string>();
  const options: ModelOption[] = [];

  // Installed first, resolved through their specs.
  for (const id of installed) {
    const spec = specForInstalled(id);
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    options.push({ ...spec, installed: true });
  }
  // Then registry entries not yet installed.
  for (const spec of MODEL_REGISTRY) {
    if (seen.has(spec.id) || installedSet.has(spec.id)) continue;
    seen.add(spec.id);
    options.push({ ...spec, installed: false });
  }
  return options;
}
