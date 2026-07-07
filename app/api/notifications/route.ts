import { NextResponse } from "next/server";
import {
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notifications — the notification center feed + unread count. */
export async function GET() {
  return NextResponse.json({
    items: listNotifications(50),
    unread: unreadNotificationCount(),
  });
}

/** POST /api/notifications — { action: "read", id } | { action: "readAll" }. */
export async function POST(request: Request) {
  let body: { action?: string; id?: number };
  try {
    body = (await request.json()) as { action?: string; id?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "readAll") {
    markAllNotificationsRead();
  } else if (body.action === "read" && typeof body.id === "number") {
    markNotificationRead(body.id);
  } else {
    return NextResponse.json({ error: "action must be 'read' (with id) or 'readAll'" }, { status: 400 });
  }
  return NextResponse.json({ unread: unreadNotificationCount() });
}
