/**
 * POST /api/home/attention/dismiss — persist a dismissal of one Attention Queue
 * story (§13, §14).
 * DELETE /api/home/attention/dismiss — undo it (the 10s Undo toast, §14).
 *
 * The queue's dismissal is *state*, not a session toggle: it survives reload and
 * lapses on its own by per-kind TTL (§12). The expiry deadline is computed by
 * `dismissalExpiresAt` in the engine, so the API and the digest read agree on
 * when a story is allowed back.
 */
import { NextResponse } from "next/server";
import { dismissAttention, undismissAttention } from "@/lib/db";
import { dismissalExpiresAt, MAX_SUPPRESS_MS } from "@/lib/home/attention";
import { invalidateDataset } from "@/lib/platform";
import type { AttentionKind } from "@/lib/home/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: AttentionKind[] = ["action", "threat", "alert", "event", "signal"];

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      dedupeKey?: unknown;
      kind?: unknown;
      occursAt?: unknown;
      storyKey?: unknown;
      snoozeUntil?: unknown;
      mode?: unknown;
    };
    const dedupeKey = typeof body.dedupeKey === "string" ? body.dedupeKey.trim() : "";
    const kind = body.kind as AttentionKind;
    const occursAt = typeof body.occursAt === "string" ? body.occursAt : null;
    const storyKey = typeof body.storyKey === "string" && body.storyKey.trim() ? body.storyKey.trim() : null;
    // Every verb here is a dismissal row; only the expiry differs. A snooze
    // (audit AG-04) is a user-chosen deadline; "done"/"mute" (AG-06/AG-05)
    // park the story for the 90-day maximum. Band resurfacing applies to all:
    // a materially worse version has a new dedupe key and comes right back.
    const mode = body.mode === "done" || body.mode === "mute" ? body.mode : null;
    const snoozeUntil =
      typeof body.snoozeUntil === "number" && Number.isFinite(body.snoozeUntil) ? body.snoozeUntil : null;

    if (!dedupeKey) return NextResponse.json({ error: "dedupeKey is required" }, { status: 400 });
    if (!KINDS.includes(kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });

    const now = Date.now();
    if (body.snoozeUntil != null && snoozeUntil == null) {
      return NextResponse.json({ error: "snoozeUntil must be epoch ms" }, { status: 400 });
    }
    if (snoozeUntil != null && (snoozeUntil <= now || snoozeUntil >= now + MAX_SUPPRESS_MS)) {
      return NextResponse.json({ error: "snoozeUntil must be in the future, within 90 days" }, { status: 400 });
    }

    const expiresAt =
      snoozeUntil ?? (mode ? now + MAX_SUPPRESS_MS : dismissalExpiresAt(kind, occursAt, now));
    dismissAttention(dedupeKey, now, expiresAt);
    // A merged story (audit DU-03) is dismissed as a STORY: suppressing only
    // the surviving item's key would let its absorbed twin resurface next
    // build under its own kind.
    if (storyKey) dismissAttention(storyKey, now, expiresAt);
    // The cached digest still contains the item; drop it so a reload inside
    // the TTL reflects the dismissal (audit PF-01/PF-04).
    invalidateDataset("homeDigest");

    return NextResponse.json({ ok: true, dedupeKey, expiresAt });
  } catch (err) {
    console.error("[api/home/attention/dismiss POST]", err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as { dedupeKey?: unknown; storyKey?: unknown };
    const dedupeKey = typeof body.dedupeKey === "string" ? body.dedupeKey.trim() : "";
    const storyKey = typeof body.storyKey === "string" && body.storyKey.trim() ? body.storyKey.trim() : null;
    if (!dedupeKey) return NextResponse.json({ error: "dedupeKey is required" }, { status: 400 });

    undismissAttention(dedupeKey);
    if (storyKey) undismissAttention(storyKey);
    invalidateDataset("homeDigest");
    return NextResponse.json({ ok: true, dedupeKey });
  } catch (err) {
    console.error("[api/home/attention/dismiss DELETE]", err);
    return NextResponse.json({ error: "Failed to undo dismissal" }, { status: 500 });
  }
}
