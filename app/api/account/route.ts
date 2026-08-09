import { NextResponse } from "next/server";
import { auth, AuthError, currentUser } from "@/lib/auth";
import { validEmail, validDisplayName } from "@/lib/auth-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/account — body { email?, displayName? } updates the signed-in user's profile. */
export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to update your account." }, { status: 401 });

  let body: { email?: string; displayName?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: { email?: string; displayName?: string } = {};
  if (body.email !== undefined) {
    if (!validEmail(body.email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    patch.email = body.email.trim();
  }
  if (body.displayName !== undefined) {
    if (!validDisplayName(body.displayName)) {
      return NextResponse.json({ error: "Enter a display name (2–60 characters)." }, { status: 400 });
    }
    patch.displayName = body.displayName.trim();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const updated = await auth().updateProfile(user.id, patch);
    return NextResponse.json({ user: updated });
  } catch (err) {
    if (err instanceof AuthError && err.code === "email_taken") {
      return NextResponse.json({ error: "Another account already uses this email." }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
