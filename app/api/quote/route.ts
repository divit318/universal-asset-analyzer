import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/yahoo";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/quote?symbols=AAPL,MSFT — batch live quotes. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols")?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "A `symbols` query parameter is required" },
      { status: 400 },
    );
  }

  const symbols = raw
    .split(",")
    .map((s) => normalizeSymbol(s))
    .filter((s): s is string => s !== null);

  try {
    const quotes = await getQuotes(symbols);
    return NextResponse.json({ quotes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
