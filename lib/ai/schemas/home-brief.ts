/**
 * Home Brief wire schema (schema v1) — the {headline, note, portfolioSummary}
 * shape lib/home/brief.ts's prompt asks for, carried as JSON Schema Draft 7 on
 * Devin sessions.
 *
 * `note` is nullable ON THE WIRE: the pre-migration parser (readNote) treats a
 * missing/undecodable note as "no long-form note today", and the homepage
 * renders fine without one. Requiring it would force the model to pad. Parse
 * tolerance stays in brief.ts (str()/readNote/grounding gate) — see
 * lib/ai/schemas/loose.ts.
 */

import { z } from "zod";

// v2 (Wave 4 of the Today rebuild): `macro` dropped (audit LQ-03: no macro
// facts exist in the prompt, so the section was structurally forced to
// invent) and `portfolioSummary` dropped (audit LQ-06: generated, streamed,
// rendered by nothing — the deterministic line covers the contract field).
export const HOME_BRIEF_SCHEMA_VERSION = 2;

const NoteWire = z.object({
  regime: z.string().min(10).describe("What kind of market this currently is, in plain language"),
  opportunities: z.string(),
  risks: z.string(),
  portfolio: z.string(),
  sectors: z.string(),
  recommendations: z.array(z.string()).max(5),
});

export const HomeBriefWireSchema = z.object({
  headline: z.string().min(10).describe("The most decision-relevant read of the day, grounded in the supplied facts only"),
  note: NoteWire.nullable(),
});

export type HomeBriefWire = z.infer<typeof HomeBriefWireSchema>;
