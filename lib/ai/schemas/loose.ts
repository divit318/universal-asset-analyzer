/**
 * Shared PASS-THROUGH parse schema for migrated call sites whose defaulting
 * and coercion deliberately stay in feature code.
 *
 * The verdict migration set the precedent (lib/ai/schemas/verdict.ts): when a
 * call site already owns a plan- or context-dependent coercion layer
 * (coerceFields, cleanList/cleanString + per-field fallbacks, readNote), the
 * parse schema must NOT duplicate it — two defaulting implementations for one
 * shape is exactly the drift AGENTS.md's "reuse, never duplicate" rule exists
 * to prevent. The wire schema still carries full constraints for Devin's
 * server-side validation; this only says "a JSON object arrived".
 */

import { z } from "zod";

export const LooseObjectSchema = z.record(z.string(), z.unknown());

export type LooseObject = z.infer<typeof LooseObjectSchema>;

/**
 * Object OR array. For call sites whose token-stack prompt asks for a bare
 * JSON array (the thematic dependency chain and tier mapping): the sessions
 * API can only return an object, so their WIRE schemas wrap the array in a
 * single-key object, while the token stack keeps answering bare arrays — the
 * parse view must admit both shapes and let the feature's list extraction
 * unify them.
 */
export const LooseJsonSchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export type LooseJson = z.infer<typeof LooseJsonSchema>;
