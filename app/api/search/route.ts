import { NextResponse } from "next/server";
import { searchSymbols } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=apple
 * Autocomplete suggestions matching a ticker or company name. Always 200s with
 * a (possibly empty) list so the typeahead never blocks the user.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }
  const results = await searchSymbols(q);
  return NextResponse.json({ results });
}
