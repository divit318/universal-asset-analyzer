import { NextResponse } from "next/server";
import { analyzeWithOllama } from "@/lib/ollama";
import type { Filing, Quote } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AiRequest {
  quote?: Quote;
  filings?: Filing[];
}

/**
 * POST /api/ai
 * Body: { quote, filings } — generates a local-LLM (Ollama) research summary.
 */
export async function POST(request: Request) {
  let body: AiRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.quote?.symbol) {
    return NextResponse.json(
      { error: "A `quote` object is required" },
      { status: 400 },
    );
  }

  try {
    const result = await analyzeWithOllama({
      quote: body.quote,
      filings: body.filings ?? [],
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    // 503: the model service is unavailable, not a client error.
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
