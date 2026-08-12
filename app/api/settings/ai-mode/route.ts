/**
 * GET/POST /api/settings/ai-mode — the user's AI depth preference.
 *
 * Three values (fast / balanced / deep), stored server-side (~/.uaa/ai_mode)
 * because model routing happens server-side. The UI never sees model names —
 * the routing layer (lib/ai/config.ts MODE_OVERRIDES) owns the translation,
 * and only surfaces whose candidate models passed their eval gates differ by
 * mode at all.
 */
import { NextResponse } from "next/server";
import { AI_MODES, isAiMode, resolveAiMode, saveAiMode } from "@/lib/ai/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    mode: resolveAiMode(),
    modes: AI_MODES,
    // An env override wins over the saved file; the UI disables the control
    // rather than letting a save appear to work and silently not apply.
    envOverride: isAiMode(process.env.UAA_AI_MODE?.trim().toLowerCase()),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
  if (!isAiMode(body.mode)) {
    return NextResponse.json({ error: "mode must be one of fast, balanced, deep" }, { status: 400 });
  }
  saveAiMode(body.mode);
  return NextResponse.json({ mode: body.mode });
}
