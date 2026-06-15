import { NextResponse } from "next/server";
import { indianDeepAnalysis, indianChatWithData } from "@/lib/ai-research";
import type { Quote } from "@/lib/types";
import type { ScreenerInCompany } from "@/lib/screener-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface IndiaAiRequest {
  mode: "analysis" | "chat";
  company: ScreenerInCompany;
  quote: Quote | null;
  derived: {
    promoterHolding: number | null;
    fiiHolding: number | null;
    diiHolding: number | null;
    evToEbitda: number | null;
    priceToSales: number | null;
    priceToBook: number | null;
    debtToEquity: number | null;
    interestCoverage: number | null;
    peers: import("@/lib/screener-in").ScreenerInPeer[];
  };
  // chat mode
  history?: { role: "user" | "assistant"; content: string }[];
  question?: string;
}

/**
 * POST /api/ai/india
 * mode=analysis → structured research note for Indian stock (screener.in data)
 * mode=chat     → freeform Q&A grounded in screener.in data
 */
export async function POST(request: Request) {
  let body: IndiaAiRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.company?.symbol || !body.derived) {
    return NextResponse.json(
      { error: "company and derived are required" },
      { status: 400 },
    );
  }

  try {
    if (body.mode === "chat") {
      if (!body.question?.trim()) {
        return NextResponse.json({ error: "question is required for chat mode" }, { status: 400 });
      }
      const result = await indianChatWithData({
        company: body.company,
        derived: body.derived,
        quote: body.quote ?? { symbol: body.company.symbol, name: body.company.name, price: body.company.currentPrice ?? 0, previousClose: 0, change: 0, changePercent: body.company.changePercent ?? 0, currency: "INR", marketCap: null, peRatio: body.company.pe, dayHigh: body.company.high52w, dayLow: body.company.low52w, fiftyTwoWeekHigh: body.company.high52w, fiftyTwoWeekLow: body.company.low52w, volume: null, exchange: "NSE" },
        screenerIn: body.company,
        history: body.history ?? [],
        question: body.question,
      });
      return NextResponse.json(result);
    }

    const result = await indianDeepAnalysis({
      company: body.company,
      quote: body.quote,
      derived: body.derived,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
