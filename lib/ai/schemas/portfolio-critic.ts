/**
 * Portfolio Intelligence (critic) wire schema — the executive-summary synthesis
 * over the deterministic findings computed in lib/portfolio/intelligence/.
 *
 * Small on purpose: the findings, evidence, severities and rankings are all
 * settled in code before the model is called. The model contributes exactly two
 * things — the executive summary and the one cross-finding observation — so the
 * schema carries exactly two fields.
 *
 * `crossCurrents` explicitly permits the empty string: the prompt instructs the
 * model to return "" rather than manufacture a connection between findings, and
 * a minimum length here would convert that honesty into fabrication at the
 * platform-validation layer (same reasoning as portfolio-thesis's bearCase).
 */

import { z } from "zod";

export const PORTFOLIO_CRITIC_SCHEMA_VERSION = 1;

export const PortfolioCriticWireSchema = z.object({
  executiveSummary: z
    .string()
    .min(40)
    .describe(
      "3-5 sentences answering 'what are you missing?' — leads with the most consequential finding, cites its figures, ends with the one question the investor should ask themselves",
    ),
  crossCurrents: z
    .string()
    .describe(
      "ONE observation that only exists across two or more findings combined; EMPTY STRING when there is none",
    ),
});

export type PortfolioCriticWire = z.infer<typeof PortfolioCriticWireSchema>;
