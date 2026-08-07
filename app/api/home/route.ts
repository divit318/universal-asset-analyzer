/**
 * GET /api/home — the homepage's single deterministic payload.
 *
 * One request for the whole page. Every module reads its slice from this
 * response (see app/_home/home-provider.tsx); no module fetches on its own,
 * which is what keeps a ten-module homepage at one round-trip instead of ten.
 *
 * Contains no AI. The narrative streams separately from /api/home/brief so a
 * slow AI generation can never delay first paint.
 */
import { NextResponse } from "next/server";
import { buildHomeDigest } from "@/lib/home/digest";
import { reconcileDashboardFacts } from "@/lib/home/facts";
import { getDataset } from "@/lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Through the platform's homeDigest dataset (audit PF-01): a working
    // session is served from the last build in milliseconds; past the TTL the
    // stale payload paints instantly (it carries its own generatedAt) while
    // the rebuild runs behind it (SWR). A dismissal invalidates the dataset.
    const { data: digest } = await getDataset("homeDigest", {}, () => buildHomeDigest(), { timeoutMs: 30_000 });
    // The reconciliation harness runs on every dev build (and in CI over the
    // pure builders). A violation is a correctness bug in an engine or a
    // projection; it is logged loudly here and must never 500 the page.
    if (process.env.NODE_ENV !== "production") {
      for (const issue of reconcileDashboardFacts(digest)) {
        console.warn(`[api/home] reconciliation: ${issue.invariant}: ${issue.detail}`);
      }
    }
    return NextResponse.json(digest);
  } catch (err) {
    console.error("[api/home]", err);
    const message = err instanceof Error ? err.message : "Failed to build home digest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
