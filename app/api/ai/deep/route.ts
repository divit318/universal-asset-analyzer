import { NextResponse } from "next/server";
import { deepAnalysis, chatWithData } from "@/lib/ai-research";
import type { FundamentalsData, PeerComparison, Quote } from "@/lib/types";
import type { ScreenerInCompany } from "@/lib/screener-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface DeepRequest {
  mode: "analysis" | "chat";
  quote: Quote;
  fundamentals: FundamentalsData;
  peers?: PeerComparison | null;
  screenerIn?: ScreenerInCompany | null;
  // chat mode only
  history?: { role: "user" | "assistant"; content: string }[];
  question?: string;
}

/**
 * POST /api/ai/deep
 * mode=analysis → full structured research note using all available data
 * mode=chat     → freeform Q&A grounded in the structured data
 */
export async function POST(request: Request) {
  let body: DeepRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.quote?.symbol || !body.fundamentals) {
    return NextResponse.json(
      { error: "quote and fundamentals are required" },
      { status: 400 },
    );
  }

  try {
    if (body.mode === "chat") {
      if (!body.question?.trim()) {
        return NextResponse.json({ error: "question is required for chat mode" }, { status: 400 });
      }
      const result = await chatWithData({
        quote: body.quote,
        fundamentals: body.fundamentals,
        peers: body.peers ?? null,
        screenerIn: body.screenerIn ?? null,
        history: body.history ?? [],
        question: body.question,
      });
      return NextResponse.json(result);
    }

    // mode=analysis (default)
    const result = await deepAnalysis({
      quote: body.quote,
      fundamentals: body.fundamentals,
      peers: body.peers ?? null,
      screenerIn: body.screenerIn ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
