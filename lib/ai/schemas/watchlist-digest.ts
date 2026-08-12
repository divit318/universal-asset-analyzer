/**
 * Watchlist digest output schema — wire + tolerant-parse views, mirroring the
 * defaults `lib/ai-watchlist.ts` enforced via extractJsonObject (missing/
 * non-array fields fall back, never crash). No confidence field exists in this
 * shape — verified in the Blocker-1 audit.
 *
 * v2 (2026-08 watchlist upgrade): the digest became a *brief* — grounded in
 * the user's own targets, theses and the change context, it now also answers
 * "what changed", "what should I investigate next", and "what does this mean
 * for my portfolio", each as its own field so the panel can lay them out as
 * sections rather than one blob.
 */

import { z } from "zod";

export const WATCHLIST_DIGEST_SCHEMA_VERSION = 2;

const strArray = (desc: string) => z.array(z.string().min(1)).describe(desc);

export const WatchlistDigestWireSchema = z.object({
  summary: z
    .string()
    .min(30)
    .describe("2-3 sentence overall watchlist health summary — specific about the mix of buy/hold/sell signals and risk profile"),
  topChanges: strArray("The 2-3 most decision-relevant CHANGES on this list right now (crossed/near targets, big moves, new developments), each naming its symbol, under 18 words"),
  actionItems: strArray("Specific actionable items for the 1-2 highest-priority stocks, each under 15 words"),
  concentrationRisks: strArray("Obvious sector/theme concentration risks visible from the list and portfolio, each under 15 words"),
  topPicks: strArray("Top 2-3 symbols to research further, one-line reason each"),
  topConcerns: strArray("Top 2-3 stocks with concerning signals and why"),
  researchNext: strArray("1-2 symbols whose thesis or data is thin/stale and the specific question to investigate, each under 18 words"),
  portfolioImplication: z
    .string()
    .describe("One sentence on what this watchlist implies for the user's existing portfolio; empty string when no portfolio context was given"),
});

const tolerantList = z.array(z.string()).catch([]);

export const WatchlistDigestSchema = z.object({
  summary: z.string().catch(""),
  topChanges: tolerantList,
  actionItems: tolerantList,
  concentrationRisks: tolerantList,
  topPicks: tolerantList,
  topConcerns: tolerantList,
  researchNext: tolerantList,
  portfolioImplication: z.string().catch(""),
});

export type WatchlistDigestAnalysis = z.infer<typeof WatchlistDigestSchema>;
