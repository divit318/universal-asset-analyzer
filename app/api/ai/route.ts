import { NextResponse } from "next/server";
import { analyzeAsset } from "@/lib/ai";
import type { Filing, Quote } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AiRequest {
  quote?: Quote;
  filings?: Filing[];
}

/**
 * POST /api/ai
 * Body: { quote, filings }
 *
 * Routes through the AI Orchestrator (lib/ai/orchestrator.ts), which picks
 * the right effort tier for the task and falls back automatically.
 */
export async function POST(request: Request) {
  let body: AiRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.quote?.symbol) {
    return NextResponse.json({ error: "A `quote` object is required" }, { status: 400 });
  }

  try {
    const result = await analyzeAsset({
      quote: body.quote,
      filings: body.filings ?? [],
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
