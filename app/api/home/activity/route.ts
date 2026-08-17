/**
 * POST /api/home/activity — record that the user visited something.
 *
 * Feeds Module 10 ("Continue where you left off"). Called fire-and-forget from
 * pages; it returns 204 and never blocks the caller. A failure to log a visit
 * must never surface to the user, so even a bad payload is a quiet 204 rather
 * than an error the calling page has to handle.
 */
import { NextResponse } from "next/server";
import { recordActivity, touchIdeaResearch } from "@/lib/db";
import { isActivityKind } from "@/lib/home/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LABEL = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      kind?: unknown;
      ref?: unknown;
      label?: unknown;
      href?: unknown;
    };

    const kind = typeof body.kind === "string" ? body.kind : "";
    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim().slice(0, MAX_LABEL) : "";
    const href = typeof body.href === "string" ? body.href.trim() : "";

    // Only same-origin app paths. An activity row is rendered as a link on the
    // homepage, so an attacker-supplied absolute URL (or a `javascript:` href)
    // would become a clickable link on the user's own dashboard.
    const isAppPath = href.startsWith("/") && !href.startsWith("//");

    if (isActivityKind(kind) && ref && label && isAppPath) {
      recordActivity({ kind, ref, label, href });
      // Research visits also stamp the tracked idea's durable recency — the
      // activity table prunes itself, and the Watchlist's derived workflow
      // must never forget that a name was researched (lib/ideas/evidence.ts).
      if (kind === "research") touchIdeaResearch(ref);
    }
  } catch {
    // Malformed body — drop it. See the note above on why this isn't an error.
  }

  return new NextResponse(null, { status: 204 });
}
