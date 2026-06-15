import { NextResponse } from "next/server";
import { compareStocks } from "@/lib/ai-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/compare
 * Body: { symbolA: string, symbolB: string }
 * Returns ComparisonResult — full structured AI comparison with metric table.
 */
export async function POST(request: Request) {
  let body: { symbolA?: string; symbolB?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const a = body.symbolA?.trim().toUpperCase();
  const b = body.symbolB?.trim().toUpperCase();
  if (!a || !b) {
    return NextResponse.json({ error: "symbolA and symbolB are required" }, { status: 400 });
  }
  if (a === b) {
    return NextResponse.json({ error: "Symbols must be different" }, { status: 400 });
  }

  try {
    const result = await compareStocks(a, b);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Comparison failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
