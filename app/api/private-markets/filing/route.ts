import { NextResponse } from "next/server";
import { getFormDDetails } from "@/lib/edgar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/private-markets/filing?cik=...&accession=...
 * Fetches one Form D filing's offering details (amount raised, date of
 * first sale) as reference context for a selected search result. Never the
 * source of a "last round valuation" — Form D doesn't disclose that, only
 * capital raised — see lib/edgar.ts's FormDDetails doc comment.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cik = params.get("cik")?.trim();
  const accession = params.get("accession")?.trim();
  if (!cik || !accession) {
    return NextResponse.json({ error: "`cik` and `accession` query parameters are required" }, { status: 400 });
  }

  const details = await getFormDDetails(cik, accession);
  return NextResponse.json({ details });
}
