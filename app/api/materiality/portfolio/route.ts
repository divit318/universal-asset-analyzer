/**
 * POST /api/materiality/portfolio — the tier-crossing baseline exchange.
 *
 * The portfolio page already holds the full report client-side, so this route
 * does NOT rebuild anything. The client posts the current per-symbol holding
 * scores it just rendered; the route returns the scores captured on the
 * PREVIOUS visit and stores the new ones. The actual "did it cross a
 * TIER_EDGES boundary" judgment happens client-side through
 * lib/materiality.ts#isMaterial, where it is pure and tested.
 *
 * Two-slot design copied from home_fingerprint (lib/home/changes.ts):
 * 'current' is the latest capture; when a new VISIT starts (a VISIT_GAP_MS
 * pause since the last capture) 'current' is promoted to 'baseline' first.
 * Reloading the page inside one sitting therefore keeps comparing against the
 * previous visit, not against thirty seconds ago.
 */
import { NextResponse } from "next/server";
import { getPageFingerprint, putPageFingerprint } from "@/lib/db";
import { VISIT_GAP_MS } from "@/lib/home/changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "portfolio-scores";
const MAX_SYMBOLS = 500;

interface StoredScores {
  scores: Record<string, number | null>;
}

function parseStored(raw: string | undefined | null): Record<string, number | null> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredScores;
    return parsed && typeof parsed === "object" && parsed.scores && typeof parsed.scores === "object"
      ? parsed.scores
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const scores: Record<string, number | null> = {};
  try {
    const body = (await request.json()) as { scores?: unknown };
    if (body.scores && typeof body.scores === "object" && !Array.isArray(body.scores)) {
      for (const [sym, val] of Object.entries(body.scores as Record<string, unknown>).slice(0, MAX_SYMBOLS)) {
        if (val === null) scores[sym.toUpperCase()] = null;
        else if (typeof val === "number" && Number.isFinite(val)) scores[sym.toUpperCase()] = val;
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const now = Date.now();
  const current = getPageFingerprint(PAGE, "current");
  const baseline = getPageFingerprint(PAGE, "baseline");

  // New visit? Promote the last sitting's state to baseline before overwriting.
  const isNewVisit = current != null && now - current.takenAt > VISIT_GAP_MS;
  if (isNewVisit) putPageFingerprint(PAGE, "baseline", current.data, current.takenAt);

  putPageFingerprint(PAGE, "current", JSON.stringify({ scores } satisfies StoredScores), now);

  // Compare against the previous VISIT: on a new visit that is the state just
  // promoted; within a sitting it is the already-promoted baseline. During the
  // very first sitting ever there is no previous visit, priorScores is null,
  // and the lens reports tier checks as not-applicable instead of flagging
  // (or fabricating) anything — including on a reload thirty seconds later.
  const prior = isNewVisit ? current : baseline;
  const priorScores = parseStored(prior?.data);

  return NextResponse.json({
    priorScores,
    priorTakenAt: prior ? new Date(prior.takenAt).toISOString() : null,
  });
}
