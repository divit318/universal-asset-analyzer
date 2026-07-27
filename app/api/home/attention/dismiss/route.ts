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
import { dismissalExpiresAt } from "@/lib/home/attention";
import type { AttentionKind } from "@/lib/home/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: AttentionKind[] = ["action", "threat", "alert", "event", "signal"];

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { dedupeKey?: unknown; kind?: unknown; occursAt?: unknown };
    const dedupeKey = typeof body.dedupeKey === "string" ? body.dedupeKey.trim() : "";
    const kind = body.kind as AttentionKind;
    const occursAt = typeof body.occursAt === "string" ? body.occursAt : null;

    if (!dedupeKey) return NextResponse.json({ error: "dedupeKey is required" }, { status: 400 });
    if (!KINDS.includes(kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });

    const now = Date.now();
    const expiresAt = dismissalExpiresAt(kind, occursAt, now);
    dismissAttention(dedupeKey, now, expiresAt);

    return NextResponse.json({ ok: true, dedupeKey, expiresAt });
  } catch (err) {
    console.error("[api/home/attention/dismiss POST]", err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as { dedupeKey?: unknown };
    const dedupeKey = typeof body.dedupeKey === "string" ? body.dedupeKey.trim() : "";
    if (!dedupeKey) return NextResponse.json({ error: "dedupeKey is required" }, { status: 400 });

    undismissAttention(dedupeKey);
    return NextResponse.json({ ok: true, dedupeKey });
  } catch (err) {
    console.error("[api/home/attention/dismiss DELETE]", err);
    return NextResponse.json({ error: "Failed to undo dismissal" }, { status: 500 });
  }
}
