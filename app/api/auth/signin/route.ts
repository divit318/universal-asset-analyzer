import { NextResponse } from "next/server";
import { auth, AuthError, setSessionCookie } from "@/lib/auth";
import { validEmail } from "@/lib/auth-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/signin — body { email, password } verifies credentials and opens a session. */
export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  if (!validEmail(email) || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  try {
    const { user, token } = await auth().signIn({ email, password });
    await setSessionCookie(token);
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof AuthError && err.code === "invalid_credentials") {
      // One message for both wrong-email and wrong-password, on purpose.
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
