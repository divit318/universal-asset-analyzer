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
  /** Hosted Anthropic API (claude-opus-5). No memory gate, genuinely parallel. */
  "anthropic";

/**
 * Where each provider's weights actually run.
 *
 * A total `Record`, not a Set, deliberately: adding a member to `ProviderId`
 * is a compile error until it is classified here, because every consumer below
 * changes behaviour based on this answer and defaulting a new provider to
 * either side silently would be a bug rather than a gap.
 */
const PROVIDER_LOCALITY: Record<ProviderId, "local" | "hosted"> = {
  anthropic: "hosted",
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
  /** Provider-native id — for Anthropic, `claude-opus-5` plus an effort suffix. */
  id: string;
  label: string;
  family: "claude" | "other";
  /** Which provider serves this model. */
  provider: ProviderId;
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
    case "anthropic":
      // Pinned in lib/ai/anthropic-key.ts (ANTHROPIC_BASE_URL): the provider
      // constructs its client with this exact baseURL, so prompts go to
      // api.anthropic.com and nowhere else.
      return "https://api.anthropic.com";
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
];

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
    provider: "anthropic",
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
