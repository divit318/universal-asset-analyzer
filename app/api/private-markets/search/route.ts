import { NextResponse } from "next/server";
import { searchFormD } from "@/lib/edgar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/private-markets/search?company=...
 * Free, no-key SEC EDGAR Form D full-text search — helps confirm a private
 * company is real and surfaces its known private-offering filings. No
 * "not_configured" case here (unlike Real Estate's RentCast dependency):
 * EDGAR needs no key, so the only outcomes are "found some filings" or
 * "found none", both legitimate — many private companies never file Form D
 * under their own name (e.g. they raise through an SPV), so an empty result
 * isn't a failure.
 */
export async function GET(request: Request) {
  const company = new URL(request.url).searchParams.get("company")?.trim();
  if (!company) {
    return NextResponse.json({ error: "A non-empty `company` query parameter is required" }, { status: 400 });
  }

  const filings = await searchFormD(company);
  return NextResponse.json({ filings });
}
