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
