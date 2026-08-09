/**
 * POST /api/home/telemetry - append a batch of dashboard usage events (IN-05).
 *
 * The write half of audit 13's local-first instrumentation: the useTelemetry
 * hook batches events client-side and lands them here, this route validates
 * and hands them to lib/db.ts (the only file that touches the home_event
 * table). Local SQLite only, no external analytics of any kind (NORTH-STAR).
 *
 * Quiet-204 convention, same as the activity route (IN-06): telemetry is
 * fire-and-forget, so even a malformed or oversized payload is dropped (and
 * logged server-side) rather than surfaced as an error the page would have to
 * handle. Losing an event is fine; breaking the dashboard over one is not.
 */
import { NextResponse } from "next/server";
import { insertHomeEvents, type HomeEventRecord } from "@/lib/db";
import { isHomeEventName } from "@/lib/home/telemetry-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** More than a triage session plausibly buffers; anything bigger is a bug or abuse. */
const MAX_BATCH = 50;
/** Same cap as the activity route's MAX_LABEL: props carry keys, not prose. */
const MAX_STRING = 120;
const MAX_SESSION_ID = 64;
const MAX_PROP_KEYS = 12;
/** Client clocks drift; a claimed timestamp outside this window gets restamped. */
const MAX_CLOCK_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Keep only flat primitives: strings (capped), finite numbers, booleans, null.
 * Nested objects and arrays are dropped, so the ledger stays a flat-props
 * table no matter what a future emitter tries to send.
 */
function sanitizeProps(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (kept >= MAX_PROP_KEYS) break;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
    else continue;
    kept += 1;
  }
  return kept > 0 ? out : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: unknown; events?: unknown };

    // Random per page load, never an identity (NORTH-STAR: no PII). A missing
    // or malformed id still records the event; only session joins are lost.
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim().length > 0
        ? body.sessionId.trim().slice(0, MAX_SESSION_ID)
        : "unattributed";

    const now = Date.now();
    const rows: HomeEventRecord[] = [];
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
    for (const entry of events) {
      if (typeof entry !== "object" || entry === null) continue;
      const { at, event, props } = entry as { at?: unknown; event?: unknown; props?: unknown };
      // Unknown names are dropped, not stored: a typo'd emitter must fail
      // visibly in review, never silently pollute the calibration input.
      if (!isHomeEventName(event)) continue;
      const claimedAt = typeof at === "number" && Number.isFinite(at) ? at : now;
      rows.push({
        at: Math.abs(claimedAt - now) <= MAX_CLOCK_SKEW_MS ? claimedAt : now,
        sessionId,
        event,
        props: sanitizeProps(props),
      });
    }
    if (rows.length > 0) insertHomeEvents(rows);
  } catch (err) {
    // Log only, never a 500: see the module comment.
    console.warn("[home-telemetry] dropped batch:", err);
  }

  return new NextResponse(null, { status: 204 });
}
