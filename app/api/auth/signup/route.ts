import { NextResponse } from "next/server";
import { auth, AuthError, setSessionCookie } from "@/lib/auth";
import { validEmail, validPassword, validDisplayName } from "@/lib/auth-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/signup — body { email, displayName, password } creates the local account and opens a session. */
export async function POST(request: Request) {
  let body: { email?: string; displayName?: string; password?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  const displayName = body.displayName?.trim() ?? "";
  const password = body.password ?? "";
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!validDisplayName(displayName)) return NextResponse.json({ error: "Enter a display name (2–60 characters)." }, { status: 400 });
  if (!validPassword(password)) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  try {
    const { user, token } = await auth().signUp({ email, displayName, password });
    await setSessionCookie(token);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError && err.code === "email_taken") {
      return NextResponse.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
