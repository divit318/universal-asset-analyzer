import { NextResponse } from "next/server";
import { searchRealEstate, type RealEstateLookupResult, type RealEstateSearchReason } from "@/lib/rentcast";
import { getCachedRealEstateLookup, putRealEstateLookup } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — RentCast's free tier is only 50 calls/month

/**
 * GET /api/real-estate/search?address=...
 * Cache-first (30-day TTL, since property facts don't change fast and the
 * free-tier budget is small). Never returns an error status for "no data"
 * outcomes — a missing API key or an address that doesn't resolve are both
 * legitimate, expected results the client falls back to manual entry for,
 * not failures.
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "A non-empty `address` query parameter is required" }, { status: 400 });
  }

  const cached = getCachedRealEstateLookup<RealEstateLookupResult>(address, CACHE_TTL_MS);
  if (cached) {
    return NextResponse.json({ result: cached.data, asOf: cached.updatedAt, reason: null });
  }

  if (!process.env.RENTCAST_API_KEY?.trim()) {
    const reason: RealEstateSearchReason = "not_configured";
    return NextResponse.json({ result: null, asOf: null, reason });
  }

  try {
    const result = await searchRealEstate(address);
    if (!result) {
      const reason: RealEstateSearchReason = "not_found";
      return NextResponse.json({ result: null, asOf: null, reason });
    }
    putRealEstateLookup(address, result);
    return NextResponse.json({ result, asOf: Date.now(), reason: null });
  } catch {
    const reason: RealEstateSearchReason = "error";
    return NextResponse.json({ result: null, asOf: null, reason });
  }
}
