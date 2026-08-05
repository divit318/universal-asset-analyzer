import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/session — the signed-in user, or { user: null }. Never errors on a bad cookie. */
export async function GET() {
  try {
    return NextResponse.json({ user: await currentUser() });
  } catch {
    return NextResponse.json({ user: null });
  }
}
