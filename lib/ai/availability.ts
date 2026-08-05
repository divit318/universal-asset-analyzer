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
  "Add your Anthropic API key in Settings to enable AI features.";

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
 * All generation runs on the Anthropic API (claude-opus-5, the user's own
 * key) — there is no local inference tier. Every badge states that plainly:
 * the prompt for this text left the machine, the computed figures did not
 * come from it. A static "Local AI" label was finding F-03 in the pre-demo
 * audit; nothing may ever claim locality for hosted output again.
 *
 * Kept dependency-free so client components can import it without dragging
 * node builtins across the boundary.
 */
export interface AiAttribution {
  /** Short badge text, e.g. "Claude · claude-opus-5-high". */
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
        "Written by Claude via the Anthropic API, using your API key. Every figure is computed by the deterministic engines; the model only narrates.",
      locality: "unknown",
    };
  }
  return {
    badge: `Claude · ${modelId}`,
    title: `Written by ${modelId} via the Anthropic API, using your API key. The prompt — company metrics and, where relevant, portfolio context — was sent to api.anthropic.com. Every figure is computed by the deterministic engines; the model only narrates.`,
    locality: "hosted",
  };
}
