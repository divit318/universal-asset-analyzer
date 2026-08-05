import { NextResponse } from "next/server";
import { auth, clearSessionCookie, currentToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/signout — destroys the current session. Idempotent. */
export async function POST() {
  try {
    const token = await currentToken();
    if (token) await auth().signOut(token);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
