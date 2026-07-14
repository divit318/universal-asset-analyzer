import { NextResponse } from "next/server";
import { getMacroSummary } from "@/lib/yahoo";
import type { MacroSummary } from "@/lib/macro-analysis";
import { macroSectionInsight, type MacroInsightSection } from "@/lib/ai-macro-research";
import type { NewsItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/macro
 * Always returns the full 4-tenor yield curve regardless of which yield
 * symbol (^IRX/^FVX/^TNX/^TYX) the user searched — a single point isn't
 * informative without the curve. No `symbol` param needed.
 */
export async function GET() {
  try {
    return NextResponse.json({ summary: await getMacroSummary() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yield curve lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

interface MacroInsightRequest {
  section: MacroInsightSection;
  summary: MacroSummary;
  news?: NewsItem[];
}

/**
 * POST /api/macro — mode=insight only today, mirrors the other asset-class
 * insight routes. `news` is passed from the client (already fetched by
 * /api/research), only used by the macro-context section.
 */
export async function POST(request: Request) {
  let body: MacroInsightRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.summary || !body.section) {
    return NextResponse.json({ error: "summary and section are required" }, { status: 400 });
  }

  try {
    const result = await macroSectionInsight({ section: body.section, summary: body.summary, news: body.news ?? [] });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI macro insight failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
