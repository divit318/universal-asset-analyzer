import { NextResponse } from "next/server";
import { generatePatternInsight } from "@/lib/ai-pattern-insight";
import type { TechnicalSignal } from "@/lib/pattern-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/pattern-insight
 * Body: { symbol, signal }
 *
 * Takes the already-computed TechnicalSignal from the client (the chart
 * already ran buildTechnicalSignals() over the history it holds) rather than
 * recomputing anything server-side — mirrors the financial-insight route's
 * POST-with-body pattern. Fired once per pattern click, never in a loop.
 */
export async function POST(request: Request) {
  let body: { symbol?: string; signal?: TechnicalSignal };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { symbol, signal } = body;
  if (!symbol || !signal?.name || !signal?.date) {
    return NextResponse.json({ error: "symbol and signal are required" }, { status: 400 });
  }

  try {
    const result = await generatePatternInsight({ symbol, signal });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pattern insight generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
