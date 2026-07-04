import { NextResponse } from "next/server";
import type { CalendarEvent } from "../route";
import { generate } from "@/lib/ai/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The brief only ever cites a handful of events; cap the client-supplied list.
const MAX_EVENTS = 200;

function buildPrompt(events: CalendarEvent[], weekStart: string, weekEnd: string): string {
  const earnings = events.filter((e) => e.type === "earnings");
  const macro = events.filter((e) => e.type === "macro");
  const dividends = events.filter((e) => e.type === "exDividend");

  const earningsLines = earnings.map((e) =>
    `- ${e.symbol ?? e.name}${e.quarter ? ` (${e.quarter})` : ""}${e.epsEstimate != null ? ` | EPS est. $${e.epsEstimate.toFixed(2)}` : ""}`,
  ).join("\n") || "None";

  const macroLines = macro
    .filter((e) => e.impact === "high")
    .map((e) => `- ${e.date}: ${e.name}${e.country ? ` (${e.country})` : ""}${e.forecast ? ` | Forecast: ${e.forecast}` : ""}`)
    .join("\n") || "None";

  const divLines = dividends.map((e) =>
    `- ${e.symbol ?? e.name}${e.dividendYield != null ? ` | Yield: ${e.dividendYield.toFixed(2)}%` : ""}`,
  ).join("\n") || "None";

  return [
    `You are a senior macro strategist writing a concise institutional market calendar brief for the week of ${weekStart} to ${weekEnd}.`,
    "Based on the upcoming events listed below, write a focused 150-200 word weekly brief.",
    "Structure it as:",
    "1. One opening sentence on the overall market calendar tone (busy/quiet, risk-on/risk-off).",
    "2. 2-3 bullet points on the most important events and what to watch.",
    "3. One closing sentence on potential portfolio implications.",
    "",
    "Keep the tone institutional and factual. Do not invent data not listed.",
    "",
    `EARNINGS REPORTS:\n${earningsLines}`,
    "",
    `HIGH-IMPACT MACRO EVENTS:\n${macroLines}`,
    "",
    `EX-DIVIDEND DATES:\n${divLines}`,
  ].join("\n");
}

export async function POST(request: Request) {
  let body: { events?: CalendarEvent[]; weekStart?: string; weekEnd?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const events = (body.events ?? []).slice(0, MAX_EVENTS);
  const weekStart = body.weekStart ?? new Date().toISOString().slice(0, 10);
  const weekEnd = body.weekEnd ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const prompt = buildPrompt(events, weekStart, weekEnd);

  try {
    const brief = await generate(prompt, { timeoutMs: 50_000 });
    return NextResponse.json({ brief });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI brief generation failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
