/**
 * GET /api/intelligence
 *
 * Mission Control's single composition endpoint. Returns the full
 * MissionControlDigest in one response — see lib/mission-control.ts for
 * how each card is assembled and degrades independently. Never triggers
 * the multi-minute Scanner pipeline; only reads its last persisted
 * snapshot (see lib/scanner/cache.ts).
 */
import { NextResponse } from "next/server";
import { buildMissionControlDigest } from "@/lib/mission-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const digest = await buildMissionControlDigest();
  return NextResponse.json(digest);
}
