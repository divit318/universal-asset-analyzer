/**
 * Portfolio Thesis wire schema (schema v1) — the shape
 * lib/portfolio/thesis.ts's prompt contract asks for, carried as JSON Schema
 * Draft 7 on Devin sessions.
 *
 * Parse-side tolerance lives in thesis.ts itself (cleanList/cleanString,
 * per-field fallbacks, resolveSectionConflicts) — see lib/ai/schemas/loose.ts
 * for why the parse view is a passthrough.
 *
 * `bearCase` explicitly permits the empty string: the prompt instructs the
 * model to return "" rather than manufacture a bear case, and a wire schema
 * that demanded a minimum length would silently convert honesty into
 * fabrication at the platform-validation layer.
 */

import { z } from "zod";

export const PORTFOLIO_THESIS_SCHEMA_VERSION = 1;

export const PortfolioThesisWireSchema = z.object({
  thesis: z
    .string()
    .min(20)
    .describe("Two sentences: the strategy these weights actually express, not a restatement of figures"),
  identity: z.array(z.string().min(2)).min(2).max(5).describe("Short tags justified by the numbers"),
  strengths: z
    .array(z.string().min(8).describe("Must cite a specific number or holding"))
    .min(1)
    .max(3),
  risks: z
    .array(z.string().min(8).describe("Prefer risks visible only when several facts are combined"))
    .min(1)
    .max(3),
  bearCase: z
    .string()
    .describe("Strongest honest argument the portfolio is worse than it looks; EMPTY STRING when there is none"),
  mustBeTrue: z
    .string()
    .min(10)
    .describe("The one condition that must hold for this portfolio to perform as constructed"),
});

export type PortfolioThesisWire = z.infer<typeof PortfolioThesisWireSchema>;
