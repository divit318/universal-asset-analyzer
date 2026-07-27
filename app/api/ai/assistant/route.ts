import { NextResponse } from "next/server";
import { runAppAssistant, type AppAssistantPageContext, type AppAssistantTurn } from "@/lib/ai-app-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/assistant
 * Body: { pathname, question, history?, pageContext? }
 *
 * The global "how do I…" helper's single endpoint. One-shot per turn — no
 * server-side session, unlike the Research Copilot's /api/research/chat.
 * `history` is a short client-held list of prior turns for continuity only.
 * `pageContext` is whatever's loaded on the current page (symbol, compare
 * set, tab) — built client-side from the URL in ai-assistant.tsx.
 */
export async function POST(request: Request) {
  let body: {
    pathname?: string;
    question?: string;
    history?: AppAssistantTurn[];
    pageContext?: AppAssistantPageContext;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { pathname, question, history, pageContext } = body;
  if (!pathname || !question?.trim()) {
    return NextResponse.json({ error: "pathname and question are required" }, { status: 400 });
  }

  try {
    const result = await runAppAssistant(
      pathname,
      question.trim(),
      Array.isArray(history) ? history.slice(-3) : [],
      pageContext,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assistant generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
