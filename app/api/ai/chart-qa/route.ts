import { NextResponse } from "next/server";
import { runChartQA } from "@/lib/ai-chart-qa";
import type { ChartQAContext } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/chart-qa
 * Body: { symbol, question, context }
 *
 * The fullscreen chart workspace's single AI input. `context` is built
 * client-side by build-chart-context.ts from the live chart state (selection,
 * visible range, drawings, nearby news) — this route never recomputes it.
 * Not cached: free-text questions aren't a stable cache key the way a fixed
 * pattern occurrence is (contrast app/api/ai/pattern-insight/route.ts).
 */
export async function POST(request: Request) {
  let body: { symbol?: string; question?: string; context?: ChartQAContext };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { symbol, question, context } = body;
  if (!symbol || !question?.trim() || !context) {
    return NextResponse.json({ error: "symbol, question, and context are required" }, { status: 400 });
  }

  try {
    const result = await runChartQA(context, question.trim());
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chart Q&A generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
