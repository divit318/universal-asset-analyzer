/**
 * User-facing copy for "the AI could not answer".
 *
 * Deliberately dependency-free so client components can import it: everything
 * else in lib/ai reaches node:os or node:fs (the key file) within an import
 * hop or two, and pulling those across the server/client boundary is a build
 * error that `tsc` does not catch.
 *
 * It is a constant rather than a string literal per call site because the
 * advice was previously hand-written in ~15 files — every one of which said
 * "start Ollama", advice that stopped being true when that provider was
 * removed. One constant, one truth.
 */

/** How a user restores AI service. */
export const AI_RECOVERY_HINT =
  "Connect an AI provider in Settings — sign in to the Devin CLI (no API key needed) or add a provider API key — to enable AI features.";

/** Full sentence for a feature that could not run. */
export function aiUnavailableMessage(feature = "AI features"): string {
  return `No AI provider is available for ${feature}. ${AI_RECOVERY_HINT}`;
}

/**
 * Short form for inline fallbacks inside otherwise-complete output — a
 * comparison table or portfolio panel whose numbers are all computed and whose
 * only missing piece is the written narrative.
 */
export const AI_NARRATIVE_UNAVAILABLE =
  "AI narrative unavailable — the numbers below are computed directly and are unaffected.";

/* -------------------------------------------------------------------------- */
/* Attribution                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Truthful attribution for a piece of AI-generated output.
 *
 * Generation runs on a HOSTED provider — the Devin CLI (Cognition-hosted
 * models on the user's Devin login) or a BYO-key API (Anthropic, OpenAI,
 * Gemini, OpenRouter) — unless the user has explicitly routed to the local
 * Ollama tier. Every badge states plainly that the prompt for this text left
 * the machine and that the computed figures did not come from it. A static
 * "Local AI" label was finding F-03 in the pre-demo audit; nothing may ever
 * claim locality for hosted output again — so with only a model id to go on
 * (the serving provider is not always threaded through), the copy stays
 * provider-generic rather than guessing a host.
 *
 * Kept dependency-free so client components can import it without dragging
 * node builtins across the boundary.
 */
export interface AiAttribution {
  /** Short badge text, e.g. "AI · claude-opus-5-high". */
  badge: string;
  /** Tooltip copy stating exactly where the generation ran. */
  title: string;
  locality: "hosted" | "unknown";
}

export function aiAttribution(modelId?: string | null): AiAttribution {
  if (!modelId || modelId === "unavailable") {
    return {
      badge: "AI",
      title:
        "Written by a hosted AI model via your configured provider (Devin CLI or your own API key). Every figure is computed by the deterministic engines; the model only narrates.",
      locality: "unknown",
    };
  }
  const family = modelId.toLowerCase().includes("claude") ? "Claude" : "AI";
  return {
    badge: `${family} · ${modelId}`,
    title: `Written by ${modelId} via your configured AI provider. The prompt — company metrics and, where relevant, portfolio context — was sent to that provider. Every figure is computed by the deterministic engines; the model only narrates.`,
    locality: "hosted",
  };
}
