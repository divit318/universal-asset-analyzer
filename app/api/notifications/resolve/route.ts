/**
 * GET /api/notifications/resolve?id=<notificationId>
 *
 * Resolves a notification to a navigable destination, checking whether the
 * target (watchlist item / holding) still exists so the client never lands
 * on a page with nothing to show. Read status is a separate concern — the
 * bell marks the notification read only once this call succeeds and it is
 * about to navigate, per the "mark read only after a successful click"
 * requirement.
 */
import { NextResponse } from "next/server";
import { getNotificationById } from "@/lib/db";
import { resolveDestination } from "@/lib/notifications/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const idParam = new URL(request.url).searchParams.get("id");
  const id = idParam != null ? Number(idParam) : NaN;
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "`id` must be a numeric notification id" }, { status: 400 });
  }

  const notification = getNotificationById(id);
  if (!notification) {
    return NextResponse.json({ error: `Notification ${id} not found` }, { status: 404 });
  }

  try {
    return NextResponse.json(resolveDestination(notification));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve destination";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
