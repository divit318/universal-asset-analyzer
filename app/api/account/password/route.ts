import { NextResponse } from "next/server";
import { auth, AuthError, currentToken, currentUser } from "@/lib/auth";
import { validPassword } from "@/lib/auth-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/password — body { currentPassword, newPassword } re-verifies
 * the current password, rotates the hash, and revokes every other session.
 */
export async function POST(request: Request) {
  const [user, token] = await Promise.all([currentUser(), currentToken()]);
  if (!user || !token) return NextResponse.json({ error: "Sign in to change your password." }, { status: 401 });

  let body: { currentPassword?: string; newPassword?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";
  if (!currentPassword) return NextResponse.json({ error: "Enter your current password." }, { status: 400 });
  if (!validPassword(newPassword)) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  try {
    await auth().changePassword({ userId: user.id, token, currentPassword, newPassword });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError && err.code === "invalid_credentials") {
      return NextResponse.json({ error: "Your current password is incorrect." }, { status: 403 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
