/** GET /api/portfolio/portfolios — the named portfolios (Main + promoted). */
import { NextResponse } from "next/server";
import { listPortfolios } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ portfolios: listPortfolios() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list portfolios";
    console.error("[portfolio/portfolios]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
