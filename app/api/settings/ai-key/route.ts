import { NextResponse } from "next/server";
import { deleteApiKey, keyStatus, saveApiKey } from "@/lib/ai/anthropic-key";
import { resetPlatformHealthCache } from "@/lib/ai/platform-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Anthropic API key management route, backing /settings.
 *
 * GET reports presence and source ONLY — the key itself is never returned by
 * any API route, logged, or echoed back in an error (see
 * lib/ai/anthropic-key.ts for the full set of guarantees).
 */
export async function GET() {
  return NextResponse.json(keyStatus());
}

/** POST { key }: persist the user's key to the local key file (mode 600). */
export async function POST(request: Request) {
  let body: { key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json({ error: "An API key is required" }, { status: 400 });
  }
  try {
    saveApiKey(key);
  } catch (err) {
    // saveApiKey's validation message is static and never contains the key.
    const message = err instanceof Error ? err.message : "Could not save the API key";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  // A cached "no key" readiness result must not outlive the fix.
  resetPlatformHealthCache();
  return NextResponse.json(keyStatus());
}

/** DELETE: remove the stored key file (an env var, if set, is the operator's to unset). */
export async function DELETE() {
  deleteApiKey();
  resetPlatformHealthCache();
  return NextResponse.json(keyStatus());
}
