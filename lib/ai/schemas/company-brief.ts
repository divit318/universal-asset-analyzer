/**
 * Company orientation brief (schema v1) — the plain-English "what does this
 * company actually do?" layer at the top of the Research Hub.
 *
 * Every field except `oneLiner` is nullable ON THE WIRE by design: the model
 * is grounded exclusively in the Yahoo business description, and a field the
 * description doesn't support must come back null rather than padded — the
 * UI omits absent rows (see lib/ai-company-brief.ts's prompt contract).
 */

import { z } from "zod";

export const COMPANY_BRIEF_SCHEMA_VERSION = 1;

const wireField = (desc: string) => z.string().min(3).nullable().describe(desc);

export const CompanyBriefWireSchema = z.object({
  oneLiner: z
    .string()
    .min(20)
    .describe("ONE plain-English sentence explaining what the company actually does and for whom — no jargon, no marketing language, no investment opinion"),
  whatItSells: wireField("The concrete products/services sold, 1-2 short sentences; null if the description does not say"),
  businessModel: wireField("How the company makes money, 1 short sentence; null if the description does not say"),
  customers: wireField("Who the primary customers are, 1 short sentence; null if the description does not say"),
  geography: wireField("Where the company operates/sells, 1 short sentence; null if the description does not say"),
});

/** Tolerant parse view — a malformed optional field degrades to null, never throws. */
export const CompanyBriefAnalysisSchema = z.object({
  oneLiner: z.string().min(1),
  whatItSells: z.string().nullable().catch(null),
  businessModel: z.string().nullable().catch(null),
  customers: z.string().nullable().catch(null),
  geography: z.string().nullable().catch(null),
});

export type CompanyBriefAnalysis = z.infer<typeof CompanyBriefAnalysisSchema>;
