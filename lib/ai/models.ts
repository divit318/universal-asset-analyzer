/**
 * Model Registry — the single place model capabilities live.
 *
 * Business logic references models by *role* (the default chat model) and by id
 * through this registry, never by hardcoded name. Switching the local model, or
 * adding a future Ollama model, is a registry edit — no other layer changes.
 */

/** What we know about a local model, independent of whether it's installed. */
export interface ModelSpec {
  /** Ollama model id, e.g. "qwen3:8b". Also matches `ollama pull <id>`. */
  id: string;
  /** Short display label. */
  label: string;
  /** Model family for prompt tuning. */
  family: "qwen" | "deepseek" | "llama" | "mistral" | "other";
  /** Usable context window in tokens. */
  contextWindow: number;
  /** Emits <think>…</think> reasoning we must segregate from the answer. */
  reasoning: boolean;
  /** Sampling temperature tuned for grounded, analytical output. */
  temperature: number;
  /** One-line positioning shown in the model picker. */
  blurb: string;
}

/**
 * Known models, best first. `id`s match what users would `ollama pull`. Prefix
 * matching (see {@link specForInstalled}) means tagged variants like
 * "qwen3:8b-q4_K_M" still resolve to their base spec.
 */
export const MODEL_REGISTRY: ModelSpec[] = [
  {
    id: "qwen3",
    label: "Qwen 3",
    family: "qwen",
    contextWindow: 32_768,
    reasoning: true,
    temperature: 0.4,
    blurb: "Strong reasoning + long context. Great default for deep analysis.",
  },
  {
    id: "deepseek-r1",
    label: "DeepSeek R1",
    family: "deepseek",
    contextWindow: 32_768,
    reasoning: true,
    temperature: 0.5,
    blurb: "Chain-of-thought reasoning model; best for valuation logic.",
  },
  {
    id: "llama3.1",
    label: "Llama 3.1",
    family: "llama",
    contextWindow: 32_768,
    reasoning: false,
    temperature: 0.4,
    blurb: "Well-rounded instruction following; fast and reliable.",
  },
  {
    id: "mistral",
    label: "Mistral",
    family: "mistral",
    contextWindow: 32_768,
    reasoning: false,
    temperature: 0.4,
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
  return {
    id,
    label: id,
    family,
    contextWindow: 8_192,
    reasoning: lower.includes("r1") || lower.includes("qwen3") || lower.includes("qwq"),
    temperature: 0.4,
    blurb: "Locally installed model.",
  };
}

/**
 * Resolve a registry spec for an installed Ollama model id. Matches by exact id
 * or registry-id prefix (so "qwen3:8b" → the "qwen3" spec), else a generic spec
 * inferred from the name. Pure / testable.
 */
export function specForInstalled(installedId: string): ModelSpec {
  const base = installedId.split(":")[0].toLowerCase();
  const match = MODEL_REGISTRY.find(
    (m) => m.id === installedId || base === m.id || base.startsWith(m.id) || m.id.startsWith(base),
  );
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
