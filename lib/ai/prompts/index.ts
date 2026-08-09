/**
 * Prompt Registry — shared prompt primitives.
 *
 * Two things live here:
 *
 *   1. The canonical JSON directives. The instruction telling a model to emit
 *      JSON and nothing else was hand-written in ~13 feature modules and twice
 *      more inside the provider service layer. It is one rule, and it belongs in
 *      one place — if a model regresses on JSON compliance, the wording should
 *      be tunable from a single line.
 *   2. The template primitives ({@link definePrompt}, {@link renderPrompt}),
 *      re-exported from ../prompt-builder, for authoring new prompts with a
 *      proper system/developer/user separation instead of concatenating strings.
 *
 * ## What is deliberately NOT here
 *
 * The ~20 hand-tuned feature prompts (IC agents, scanner, thesis, comparison)
 * still live next to the code that builds them. They are *not* duplicated
 * templates — each is a distinct, schema-specific instruction — so hoisting them
 * into a registry would move text without removing duplication. Rewording them
 * is a quality-sensitive change that needs per-model evaluation, and a
 * mechanical rewrite is exactly how research quality regresses invisibly. What
 * they shared was the boilerplate below, and only that has been lifted out.
 */

export { definePrompt, renderPrompt, type PromptTemplate } from "../prompt-builder";

/**
 * Appended by the provider when a task runs in JSON mode. Belt and braces:
 * this discourages the model from wrapping the object in a ```json fence or a
 * preamble, and the extraction layer tolerates one anyway.
 */
export const JSON_ONLY_INSTRUCTION =
  "Respond ONLY with valid JSON. No markdown, no explanation.";

/**
 * The lead-in a feature prompt uses immediately before showing its expected
 * JSON schema. Byte-identical across the scanner, timeline, movement-explainer
 * and knowledge-graph prompts, so it is a constant rather than ten string
 * literals that could drift apart.
 *
 * Usage keeps each prompt's own schema verbatim:
 *
 *   `${JSON_SCHEMA_LEAD_IN}
 *   { "themes": [...] }`
 */
export const JSON_SCHEMA_LEAD_IN = "Return ONLY valid JSON:";
