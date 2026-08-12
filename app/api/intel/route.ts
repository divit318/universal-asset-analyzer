import { NextResponse } from "next/server";
import { getIntelResponse, isIntelSurface } from "@/lib/intel/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,12}$/;

/**
 * GET /api/intel?surface=research&symbols=NVDA
 *
 * The intel rail's single read endpoint. Fast by construction: the engine
 * serves from the platform's `intelCards` dataset (90s TTL) and never waits
 * on AI — `aiPending: true` tells the client one more poll may add a card.
 * An empty `cards` array is the normal, correct response, not an error.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const surface = url.searchParams.get("surface")?.trim() ?? "";
  if (!isIntelSurface(surface)) {
    return NextResponse.json({ error: "Invalid surface" }, { status: 400 });
  }

  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4);
  if (symbols.some((s) => !SYMBOL_RE.test(s))) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  try {
    const response = await getIntelResponse({ surface, symbols });
    return NextResponse.json(response);
  } catch {
    // The rail is ambient chrome — a failure must render as "nothing to
    // show", never as an error state competing with the page's research.
    return NextResponse.json({ cards: [], generatedAt: new Date().toISOString(), aiPending: false });
  }
}
