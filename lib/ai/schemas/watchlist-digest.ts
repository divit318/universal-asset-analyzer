/**
 * Watchlist digest output schema (schema v1) — wire + tolerant-parse views,
 * mirroring the defaults `lib/ai-watchlist.ts` enforced via extractJsonObject
 * (missing/non-array fields fall back, never crash). No confidence field
 * exists in this shape — verified in the Blocker-1 audit.
 */

import { z } from "zod";

export const WATCHLIST_DIGEST_SCHEMA_VERSION = 1;

const strArray = (desc: string) => z.array(z.string().min(1)).describe(desc);

export const WatchlistDigestWireSchema = z.object({
  summary: z
    .string()
    .min(30)
    .describe("2-3 sentence overall watchlist health summary — specific about the mix of buy/hold/sell signals and risk profile"),
  actionItems: strArray("Specific actionable items for the 1-2 highest-priority stocks, each under 15 words"),
  concentrationRisks: strArray("Obvious sector/theme concentration risks visible from the list and portfolio, each under 15 words"),
  topPicks: strArray("Top 2-3 symbols to research further, one-line reason each"),
  topConcerns: strArray("Top 2-3 stocks with concerning signals and why"),
});

const tolerantList = z.array(z.string()).catch([]);

export const WatchlistDigestSchema = z.object({
  summary: z.string().catch(""),
  actionItems: tolerantList,
  concentrationRisks: tolerantList,
  topPicks: tolerantList,
  topConcerns: tolerantList,
});

export type WatchlistDigestAnalysis = z.infer<typeof WatchlistDigestSchema>;
