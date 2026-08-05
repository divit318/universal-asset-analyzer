/**
 * User-facing copy for "the AI could not answer".
 *
 * Deliberately dependency-free so client components can import it: everything
 * else in lib/ai reaches node:os (the memory budget) or node:child_process
 * (the Devin transport) within an import hop or two, and pulling those across
 * the server/client boundary is a build error that `tsc` does not catch.
 *
 * It is a constant rather than a string literal per call site because the
 * advice was previously hand-written in ~15 files — every one of which said
 * "start Ollama", which since the hosted provider landed is at best half the
 * fix and at worst irrelevant advice for a user who has never installed it.
 */

/** How a user restores AI service, naming both paths. */
export const AI_RECOVERY_HINT =
  "Sign in with `devin auth login` for hosted models, or start Ollama (`ollama serve`) for local ones.";

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
 * The Router walks a chain (hosted Devin first by default, local Ollama as the
 * fallback — lib/ai/config.ts), so a static "Local AI" label is wrong whenever
 * the hosted path answered. Every badge must derive from the model that
 * actually generated the output.
 *
 * Locality heuristic: Ollama's /api/tags always reports colon-tagged ids
 * ("mistral:latest", "qwen3:14b") while the hosted catalogue ids never carry a
 * tag ("claude-opus-5-low", "swe-1-6-fast") — the same rule the header badge
 * (app/_components/ollama-status.tsx) has always used. Kept here, dependency-
 * free, so client components can import it without dragging node builtins
 * across the boundary.
 */
export interface AiAttribution {
  /** Short badge text, e.g. "Local AI · mistral" or "Hosted AI · claude-opus-5-low". */
  badge: string;
  /** Tooltip copy stating exactly where the generation ran. */
  title: string;
  locality: "local" | "hosted" | "unknown";
}

export function aiAttribution(modelId?: string | null): AiAttribution {
  if (!modelId || modelId === "unavailable" || modelId === "ollama") {
    return {
      badge: "AI",
      title:
        "Written by the configured AI provider — hosted (Devin) or local (Ollama). Every figure is computed by the deterministic engines; the model only narrates.",
      locality: "unknown",
    };
  }
  const local = modelId.includes(":");
  return local
    ? {
        badge: `Local AI · ${modelId.split(":")[0]}`,
        title: `Written on this machine by Ollama model ${modelId}. Nothing was sent to a hosted service for this text.`,
        locality: "local",
      }
    : {
        badge: `Hosted AI · ${modelId}`,
        title: `Written by ${modelId} via the hosted provider (Devin). The prompt — company metrics and, where relevant, portfolio context — was sent to that service. Set AI_PROVIDER_ORDER=ollama for a fully local setup.`,
        locality: "hosted",
      };
}
