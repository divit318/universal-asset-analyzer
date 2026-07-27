import { NextResponse } from "next/server";
import { buildProactiveInsights } from "@/lib/ai-proactive-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/assistant/insights
 *
 * 0 or 1 quiet, high-confidence observation for the assistant panel's header
 * row — computed deterministically from already-cached portfolio/calendar
 * data, no LLM call. Always 200s with a (possibly empty) list; a failure
 * here should never surface as an error in the assistant UI.
 */
export async function GET() {
  try {
    const insights = await buildProactiveInsights();
    return NextResponse.json({ insights });
  } catch {
    return NextResponse.json({ insights: [] });
  }
}
