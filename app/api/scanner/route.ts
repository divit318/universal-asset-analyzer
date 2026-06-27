import { NextResponse } from "next/server";
import { fetchMarketNews } from "@/lib/news";
import { runEventScan } from "@/lib/event-screener";
import type { ScanResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 60s — news fetch + AI analysis can take a while.
export const maxDuration = 60;

interface ScanRequest {
  query?: string;
  india?: boolean;
  global?: boolean;
  minConfidence?: number;
}

/**
 * POST /api/scanner
 * Body: { query?, india?, global?, minConfidence? }
 * Returns ScanResult.
 *
 * GET /api/scanner  — auto-scan with default settings.
 */
export async function POST(request: Request) {
  let body: ScanRequest = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — use defaults.
  }

  const { query, india = true, global: glob = true, minConfidence = 50 } = body;

  try {
    const news = await fetchMarketNews({ query, india, global: glob, limit: 60 });
    const result: ScanResult = await runEventScan(news, {
      userQuery: query,
      minConfidence,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const news = await fetchMarketNews({ india: true, global: true, limit: 60 });
    const result: ScanResult = await runEventScan(news, { minConfidence: 50 });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
