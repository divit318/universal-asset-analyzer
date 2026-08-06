/**
 * Model Registry — the single place model capabilities live.
 *
 * Business logic references models by *capability* (via the Task Registry, see
 * ./task-registry) and by id through this registry, never by hardcoded name.
 * Adding or swapping a model is a registry edit; no other layer changes.
 *
 * ## One real model, three routable depths
 *
 * The hosted backend is the Anthropic API and the real model is always
 * `claude-opus-5`. Per-task reasoning depth is expressed by registering the
 * effort tiers — `claude-opus-5-low|-medium|-high` — as distinct routable ids.
 * AnthropicProvider (./providers/anthropic-provider.ts) strips the suffix into
 * `output_config.effort` on the wire; the Router and the Task Registry treat
 * the tiers as ordinary models, so the whole task→depth mapping stays a
 * registry/config concern rather than provider special-casing.
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
  /** Toggleable per request. Costly when on — off by default in the Router. */
  | "hybrid"
  /**
   * No per-request toggle to send. For the Claude effort tiers this means
   * "don't send a flag": thinking is adaptive by default on claude-opus-5 and
   * depth rides on the effort tier baked into the model id — not "cannot
   * reason".
   */
  | "none";

/** Which backend serves a model. */
export type ProviderId =
  /** Devin CLI (`devin -p`) — Cognition-hosted models via the user's Devin login. No API key. */
  | "devin"
  /** Hosted Anthropic API (claude-opus-5). No memory gate, genuinely parallel. */
  | "anthropic"
  /** Hosted OpenAI API (chat completions), BYO key. */
  | "openai"
  /** Hosted Google Gemini API, BYO key. */
  | "gemini"
  /** OpenRouter — one key, many hosted models (OpenAI-compatible wire format). */
  | "openrouter"
  /** Local Ollama daemon — weights in local RAM, memory-gated, serialized generation. */
  | "ollama";

/**
 * Where each provider's weights actually run.
 *
 * A total `Record`, not a Set, deliberately: adding a member to `ProviderId`
 * is a compile error until it is classified here, because every consumer below
 * changes behaviour based on this answer and defaulting a new provider to
 * either side silently would be a bug rather than a gap.
 *
 * The Devin CLI spawns a LOCAL subprocess, but the weights run on Cognition's
 * hosts — no local RAM is occupied and calls execute genuinely in parallel,
 * so it is "hosted" for every purpose the Router cares about.
 */
const PROVIDER_LOCALITY: Record<ProviderId, "local" | "hosted"> = {
  devin: "hosted",
  anthropic: "hosted",
  openai: "hosted",
  gemini: "hosted",
  openrouter: "hosted",
  ollama: "local",
};

/** Backends whose models occupy local RAM and are therefore memory-gated. */
const LOCAL_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(
  (Object.keys(PROVIDER_LOCALITY) as ProviderId[]).filter((p) => PROVIDER_LOCALITY[p] === "local"),
);

/**
 * Is this provider KNOWN to run its weights off-machine?
 *
 * The Router branches on it for more than the memory gate: cold-load budgets,
 * warm-residency probing, `keepAlive` and the single-generation slot are all
 * consequences of weights living in local RAM behind a daemon that serializes
 * generation. A hosted provider has no load phase to widen a timeout for, no
 * residency to keep alive, and genuinely parallel execution — applying any of
 * that to it would be actively wrong, not merely redundant.
 *
 * Phrased as "is hosted" rather than "is local", and taking a `string`, so that
 * an UNRECOGNISED id resolves to false and therefore keeps the full local
 * treatment. That is the conservative default (the gate and the residency probe
 * are safe to apply to something that turns out not to need them; skipping them
 * on something that does need them is what breaks), and it is what the test
 * doubles depend on — `FakeProvider.id` is `"fake"`, and every cold-start,
 * gate and timeout assertion in tests/ai-router.test.ts is written against the
 * local path. Today no local provider is registered, so that machinery is
 * dormant in production — but it stays generic so a future local runtime is a
 * registry entry, not a Router rewrite.
 */
export function isHostedProvider(provider: string): boolean {
  return PROVIDER_LOCALITY[provider as ProviderId] === "hosted";
}

/**
 * What a model costs on the wire, USD per million tokens. Cache rows follow
 * the provider's billing split (Anthropic: 5-minute cache writes at 1.25× the
 * input rate, cache reads at 0.1×). Used by lib/ai/telemetry.ts to estimate
 * per-call cost — an estimate for tuning and review, never billing truth.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

/**
 * Claude Opus 5 list pricing (platform.claude.com/docs/en/about-claude/pricing,
 * checked 2026-08-06). The effort tiers are one model, so all three share it.
 */
const OPUS_5_PRICING: ModelPricing = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  cacheWritePerMTok: 6.25,
  cacheReadPerMTok: 0.5,
};

/** What we know about a model, independent of whether it's installed. */
export interface ModelSpec {
  /** Provider-native id — an Anthropic model+effort id, a Devin `model_uid`, or an `ollama list` tag. */
  id: string;
  label: string;
  family: "claude" | "gpt" | "gemini" | "qwen" | "mistral" | "other";
  /** The canonical provider for this model — timeouts, pricing, and display come from here. */
  provider: ProviderId;
  /**
   * Additional providers that can serve this exact model id. The Devin CLI's
   * catalogue includes the Claude effort tiers under the same uids, so the
   * same registry entry is routable through either backend — the Router's
   * provider chain decides which is tried first, and the normalized response
   * reports the provider that actually answered.
   */
  alsoServedBy?: ProviderId[];
  /** Usable context window in tokens. */
  contextWindow: number;
  /** Chain-of-thought support. */
  thinking: ThinkingMode;
  /** Sampling temperature tuned for grounded, analytical output. (claude-opus-5
   * does not accept the field; the provider deliberately ignores it.) */
  temperature: number;
  /** Default request timeout in ms for tasks that don't override it. */
  timeoutMs: number;
  /**
   * Timeout budget for a request DETECTED AS COLD — only meaningful for a
   * local provider (weights loading from disk into RAM). Hosted models have no
   * load phase and never use it.
   */
  coldStartTimeoutMs?: number;
  /** What this model is good at — the Router matches these against task requirements. */
  capabilities: ModelCapability[];
  /**
   * Reasoning strength, 1–10. For the effort tiers this ranks depth: same
   * weights, more reasoning budget.
   */
  quality: number;
  /** Effective end-to-end speed; ranks latency-sensitive tasks. Higher effort = slower. */
  tokensPerSecond: number;
  /**
   * Expected weights size in GB. Always 0 for hosted models — nothing is
   * loaded here, and the memory gate exempts them by provider, not by size.
   */
  sizeGb: number;
  /** Lower = tried first among models the scorer ranks equally. */
  priority: number;
  /** Set false to take a model out of routing without deleting its entry. */
  enabled: boolean;
  /** One-line positioning shown in the model picker. */
  blurb: string;
  /** Wire cost, when known. Missing = cost estimation reports null for this model. */
  pricing?: ModelPricing;
}

/** Where a provider's models are served from — for display and diagnostics. */
export function endpointForProvider(provider: ProviderId): string {
  switch (provider) {
    case "devin":
      // A local `devin -p` subprocess; the models themselves run on
      // Cognition's hosts, authenticated by the user's `devin login`.
      return "devin CLI (Cognition-hosted)";
    case "anthropic":
      // Pinned in lib/ai/anthropic-key.ts (ANTHROPIC_BASE_URL): the provider
      // constructs its client with this exact baseURL, so prompts go to
      // api.anthropic.com and nowhere else.
      return "https://api.anthropic.com";
    case "openai":
      return "https://api.openai.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "openrouter":
      return "https://openrouter.ai/api";
    case "ollama":
      return process.env.OLLAMA_HOST ?? "http://localhost:11434";
  }
}

/**
 * Known models, best first. The three entries are one model at three depths —
 * see the module comment. `quality`/`tokensPerSecond` rank the trade the
 * Router makes per task: a deep task weights quality (high effort), a
 * latency-sensitive one weights speed (low effort).
 */
export const MODEL_REGISTRY: ModelSpec[] = [
  {
    id: "claude-opus-5-high",
    label: "Claude Opus 5 (high effort)",
    family: "claude",
    provider: "anthropic",
    alsoServedBy: ["devin"],
    contextWindow: 1_000_000,
    // Effort is baked into the routable id rather than exposed as a
    // per-request toggle, so there is no `think` flag to send. "none" means
    // "don't send one", not "cannot reason" — thinking is adaptive by default.
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 300_000,
    capabilities: ["reasoning", "long-context", "structured-json", "coding"],
    quality: 10,
    tokensPerSecond: 12,
    sizeGb: 0,
    priority: 0,
    enabled: true,
    blurb: "Deepest reasoning budget. Theses, filings, risk — quality is the product.",
    pricing: OPUS_5_PRICING,
  },
  {
    id: "claude-opus-5-medium",
    label: "Claude Opus 5 (medium effort)",
    family: "claude",
    provider: "anthropic",
    alsoServedBy: ["devin"],
    contextWindow: 1_000_000,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 180_000,
    capabilities: ["reasoning", "long-context", "structured-json", "coding"],
    quality: 9,
    tokensPerSecond: 22,
    sizeGb: 0,
    priority: 1,
    enabled: true,
    blurb: "The standard-tier workhorse: substantive analysis at conversational latency.",
    pricing: OPUS_5_PRICING,
  },
  {
    id: "claude-opus-5-low",
    label: "Claude Opus 5 (low effort)",
    family: "claude",
    provider: "anthropic",
    alsoServedBy: ["devin"],
    contextWindow: 1_000_000,
    thinking: "none",
    temperature: 0.3,
    timeoutMs: 90_000,
    capabilities: ["fast", "reasoning", "long-context", "structured-json", "coding"],
    quality: 8,
    tokensPerSecond: 35,
    sizeGb: 0,
    priority: 2,
    enabled: true,
    blurb: "Fastest tier. Parsing, one-line summaries, interactive Q&A.",
    pricing: OPUS_5_PRICING,
  },

  /* ---- Devin CLI (Cognition-hosted, user's Devin login, no API key) -------
   * ids are `devin models list` model_uids, verified against the live
   * catalogue 2026-08-06. The Claude effort tiers above are ALSO servable
   * through Devin (`alsoServedBy`) under the same uids, so the task pins in
   * config.ts resolve through whichever provider the chain reaches first.
   * No `pricing`: Devin bills in ACUs against the user's plan, not USD/token,
   * so the telemetry cost estimate honestly reports null.
   * Latency numbers are from scripts/devin-model-bench.ts (2026-08-02, means
   * of 2 runs on real UAA prompts, including the ~2s CLI spawn). */
  {
    id: "adaptive",
    label: "Devin Adaptive (auto model)",
    family: "other",
    provider: "devin",
    contextWindow: 200_000,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 180_000,
    capabilities: ["reasoning", "long-context", "structured-json", "coding", "fast"],
    quality: 9,
    tokensPerSecond: 20,
    sizeGb: 0,
    priority: 3,
    enabled: true,
    blurb: "Devin's own router picks the best hosted model per prompt. Uses your Devin login — no API key.",
  },
  {
    id: "claude-sonnet-5-low",
    label: "Claude Sonnet 5 (low effort, via Devin)",
    family: "claude",
    provider: "devin",
    contextWindow: 200_000,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 120_000,
    capabilities: ["reasoning", "long-context", "structured-json"],
    quality: 8,
    tokensPerSecond: 28,
    sizeGb: 0,
    priority: 4,
    enabled: true,
    blurb: "Measured 21.8s on real dossier prompts with the richest cross-evidence synthesis of the standard bench.",
  },
  {
    id: "swe-1-6-fast",
    label: "SWE 1.6 Fast (via Devin)",
    family: "other",
    provider: "devin",
    contextWindow: 128_000,
    thinking: "none",
    temperature: 0.3,
    timeoutMs: 90_000,
    capabilities: ["fast", "structured-json", "coding"],
    quality: 7,
    tokensPerSecond: 40,
    sizeGb: 0,
    priority: 5,
    enabled: true,
    blurb: "Fastest Devin-served tier: 9-12s wall-clock, 4/4 valid JSON on the light-task bench.",
  },

  /* ---- Hosted BYO-key APIs (dormant until a key is configured) ------------
   * Best-guess ids, verified only against each provider's live /models
   * catalogue at runtime (each provider routes the INTERSECTION of this
   * registry with its live list, so a stale id here can never be routed to).
   * Explicit model overrides and AI_TASK_* env pins can reach any live
   * catalogue id regardless of registry membership. */
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    family: "gpt",
    provider: "openai",
    contextWindow: 400_000,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 180_000,
    capabilities: ["reasoning", "long-context", "structured-json", "coding"],
    quality: 9,
    tokensPerSecond: 25,
    sizeGb: 0,
    priority: 6,
    enabled: true,
    blurb: "OpenAI's flagship reasoning model. Requires an OpenAI API key in Settings.",
  },
  {
    id: "gpt-5.2-mini",
    label: "GPT-5.2 mini",
    family: "gpt",
    provider: "openai",
    contextWindow: 400_000,
    thinking: "none",
    temperature: 0.3,
    timeoutMs: 90_000,
    capabilities: ["fast", "structured-json", "coding"],
    quality: 7,
    tokensPerSecond: 45,
    sizeGb: 0,
    priority: 7,
    enabled: true,
    blurb: "OpenAI's fast tier for parsing and short answers. Requires an OpenAI API key.",
  },
  {
    id: "gemini-3-pro",
    label: "Gemini 3 Pro",
    family: "gemini",
    provider: "gemini",
    contextWindow: 1_000_000,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 180_000,
    capabilities: ["reasoning", "long-context", "structured-json", "coding"],
    quality: 9,
    tokensPerSecond: 25,
    sizeGb: 0,
    priority: 8,
    enabled: true,
    blurb: "Google's flagship. Requires a Gemini API key in Settings.",
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    family: "gemini",
    provider: "gemini",
    contextWindow: 1_000_000,
    thinking: "none",
    temperature: 0.3,
    timeoutMs: 90_000,
    capabilities: ["fast", "long-context", "structured-json"],
    quality: 7,
    tokensPerSecond: 50,
    sizeGb: 0,
    priority: 9,
    enabled: true,
    blurb: "Google's fast tier. Requires a Gemini API key in Settings.",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5 (via OpenRouter)",
    family: "claude",
    provider: "openrouter",
    contextWindow: 200_000,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 120_000,
    capabilities: ["reasoning", "long-context", "structured-json"],
    quality: 8,
    tokensPerSecond: 30,
    sizeGb: 0,
    priority: 10,
    enabled: true,
    blurb: "One OpenRouter key reaches many hosted models. Requires an OpenRouter API key in Settings.",
  },

  /* ---- Local (Ollama) — restored with the multi-provider chain ------------
   * Latency/size numbers were measured on this host before the 2026-08-05
   * consolidation removed the tier; the local machinery in the Router
   * (memory gate, generation slot, cold budgets) was kept dormant for exactly
   * this restoration. */
  {
    // Registered but not selectable on a 16GB host: the memory filter excludes
    // it. On a machine with the RAM to hold it this becomes the best local
    // model with no code change — the point of deriving a memory budget.
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
    priority: 11,
    enabled: true,
    blurb: "Strongest local reasoning. Needs ~24GB+ RAM to be usable.",
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
    // Measured: cold-loading this 9.3GB model has been observed consuming
    // its ENTIRE 300s base timeout under memory pressure, leaving zero time
    // to actually generate. 480s is a real, deliberate budget for the load
    // phase specifically — not a multiplier guess.
    coldStartTimeoutMs: 480_000,
    capabilities: ["reasoning", "long-context", "structured-json"],
    quality: 8,
    tokensPerSecond: 5.0,
    sizeGb: 9.3,
    priority: 12,
    enabled: true,
    blurb: "Best local reasoning that fits in memory. The offline analytical workhorse.",
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
    // Measured: cold-loads in ~70s on this host — the 120s base timeout
    // already has real headroom, so cold start only needs a modest bump.
    coldStartTimeoutMs: 150_000,
    capabilities: ["fast", "structured-json"],
    quality: 5,
    tokensPerSecond: 10.5,
    sizeGb: 4.4,
    priority: 13,
    enabled: true,
    blurb: "Fast local fallback with reliably valid JSON for short output.",
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
    priority: 14,
    enabled: true,
    blurb: "Code-specialized. The only local coding model within the memory budget.",
  },
];

/**
 * The registry ids a given provider can serve: its own entries plus any entry
 * that names it in `alsoServedBy`. Providers intersect this with their LIVE
 * catalogue (`devin models list`, `/v1/models`, `ollama list`) — the registry
 * is the policy, the catalogue is the availability check.
 */
export function registryModelsFor(provider: ProviderId): ModelSpec[] {
  return MODEL_REGISTRY.filter(
    (m) => m.provider === provider || (m.alsoServedBy ?? []).includes(provider),
  );
}

/**
 * Fallback spec for a model id with no registry entry (an explicit `model`
 * override, or a test double). Conservative by design: an unknown model gets
 * NO capabilities, so the Router can never *prefer* it — only fall back to it
 * when nothing else is available.
 */
export function genericSpec(id: string): ModelSpec {
  return {
    id,
    label: id,
    family: id.toLowerCase().includes("claude") ? "claude" : "other",
    // "ollama" (local) deliberately: an unknown LOCAL tag must stay behind
    // the memory gate when its daemon reports a size (fitsInMemory only gates
    // specs whose provider is local), and misclassifying a hosted model as
    // local costs nothing — its size is never reported, and sizeGb 0 passes
    // the gate. The reverse default (an ungated 18GB local model) thrashes
    // the machine.
    provider: "ollama",
    contextWindow: 8_192,
    thinking: "none",
    temperature: 0.4,
    timeoutMs: 120_000,
    capabilities: [],
    quality: 3,
    tokensPerSecond: 5,
    sizeGb: 0, // unknown; a local provider's reported size would override this
    priority: 99,
    enabled: true,
    blurb: "Model not in the registry.",
  };
}

/**
 * Resolve a registry spec for an installed model id. Exact match — the registry
 * keys on full ids, so there is no prefix fuzziness left to get wrong.
 */
export function specForInstalled(installedId: string): ModelSpec {
  return MODEL_REGISTRY.find((m) => m.id === installedId) ?? genericSpec(installedId);
}

/**
 * Can this model actually run here? Only meaningful for a LOCAL provider,
 * whose weights compete with everything else for RAM — a model bigger than
 * memory doesn't degrade gracefully, it thrashes. Hosted models are exempt by
 * provider, not by having `sizeGb: 0`: 0 otherwise means "size unknown, don't
 * exclude on a guess", and a hosted model's size is not unknown, it is
 * *irrelevant*. No local provider is registered today, so this gate is
 * dormant — kept because it is part of the provider-agnostic contract
 * ({@link ProviderModelInfo} reports sizes) rather than anything
 * provider-specific.
 */
export function fitsInMemory(spec: ModelSpec, reportedSizeGb?: number): boolean {
  if (!LOCAL_PROVIDERS.has(spec.provider)) return true;
  const size = reportedSizeGb && reportedSizeGb > 0 ? reportedSizeGb : spec.sizeGb;
  if (size <= 0) return true; // size unknown — don't exclude on a guess
  return size <= memoryBudgetGb();
}

/** A model offered to the UI: its spec plus whether it's routable right now. */
export interface ModelOption extends ModelSpec {
  installed: boolean;
}

/**
 * Merge the registry with the available set into the picker list: available
 * models first (registry order), then known-but-unavailable ones (e.g. every
 * tier, greyed out, when no API key is configured). Pure / testable.
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
 * Default model for the picker UI: the best available model that is enabled
 * and fits. An env/caller override is honored only if that model is available
 * — an override must not be able to pin the app to a model that cannot run.
 */
export function pickDefaultModel(installed: string[], envModel?: string): string | null {
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
