import { NextResponse } from "next/server";
import { buildProactiveInsights } from "@/lib/ai-proactive-insights";
import type { ProactiveInsight } from "@/lib/ai-proactive-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/assistant/insights
 *
 * 0 or 1 quiet, high-confidence observation for the assistant panel's header
 * row — computed deterministically from portfolio/calendar data, no LLM call.
 * Always 200s with a (possibly empty) list; a failure here should never
 * surface as an error in the assistant UI.
 *
 * The computation is only "fast and free" when its underlying caches are warm
 * — cold, the portfolio evaluation fetches live quotes for every holding and
 * was measured at 41 SECONDS. An optional decoration must never make the
 * panel feel frozen for that long, so this route serves whatever is ready
 * within a short budget and otherwise answers empty-but-`warming` while the
 * computation continues in the background (warming the caches it reads
 * from). The client retries once shortly after; the second call is served
 * from the now-warm cache in ~100ms.
 */
const COLD_BUDGET_MS = 1_500;

/** The in-flight cold computation, shared across requests so retries and
 * concurrent panel opens don't stack up duplicate portfolio evaluations. */
let inFlight: Promise<ProactiveInsight[]> | null = null;

export async function GET() {
  try {
    inFlight ??= buildProactiveInsights().finally(() => {
      inFlight = null;
    });
    const insights = await Promise.race([
      inFlight,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), COLD_BUDGET_MS)),
    ]);
    if (insights === null) {
      // Still computing — the promise keeps running and warms the caches.
      return NextResponse.json({ insights: [], warming: true });
    }
    return NextResponse.json({ insights });
  } catch {
    return NextResponse.json({ insights: [] });
  }
}
