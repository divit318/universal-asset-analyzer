/**
 * GET /api/home — the homepage's single deterministic payload.
 *
 * One request for the whole page. Every module reads its slice from this
 * response (see app/_home/home-provider.tsx); no module fetches on its own,
 * which is what keeps a ten-module homepage at one round-trip instead of ten.
 *
 * Contains no AI. The narrative streams separately from /api/home/brief so a
 * slow AI generation can never delay first paint.
 */
import { NextResponse } from "next/server";
import { buildHomeDigest } from "@/lib/home/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const digest = await buildHomeDigest();
    return NextResponse.json(digest);
  } catch (err) {
    console.error("[api/home]", err);
    const message = err instanceof Error ? err.message : "Failed to build home digest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
