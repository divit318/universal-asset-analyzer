/**
 * Calendar weekly brief — prompt builder + generation, extracted from
 * app/api/calendar/ai-brief/route.ts so the parity harness and the route
 * share one implementation (route files cannot export helpers).
 */

import type { CalendarEvent } from "@/app/api/calendar/route";
import { runAnalysis } from "./ai/analysis";
import { TextAnalysisSchema, TextWireSchema, TEXT_SCHEMA_VERSION } from "./ai/schemas/text";

// The brief only ever cites a handful of events; cap the client-supplied list.
export const MAX_CALENDAR_EVENTS = 200;

export function buildCalendarBriefPrompt(events: CalendarEvent[], weekStart: string, weekEnd: string): string {
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

/**
 * Generate the weekly brief through the analysis seam (tranche 2). Text mode
 * keeps the prompt identical to the pre-migration runPrompt; no cache —
 * the panel has an explicit Regenerate button.
 */
export async function generateCalendarBrief(
  events: CalendarEvent[],
  weekStart: string,
  weekEnd: string,
): Promise<string> {
  const prompt = buildCalendarBriefPrompt(events.slice(0, MAX_CALENDAR_EVENTS), weekStart, weekEnd);
  const result = await runAnalysis({
    taskType: "calendar-brief",
    subjectKey: `calendar:${weekStart}:${weekEnd}`,
    prompt,
    schema: TextAnalysisSchema,
    wireSchema: TextWireSchema,
    schemaVersion: TEXT_SCHEMA_VERSION,
    output: "text",
    timeoutMs: 50_000,
  });
  return result.data.text;
}
