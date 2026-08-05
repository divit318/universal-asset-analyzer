import { NextResponse } from "next/server";
import { validEmail } from "@/lib/auth-gate";
import { isPricePreference, recordPricingInterest } from "@/lib/pricing-interest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pricing-interest — the Pro tier's interest list.
 *
 * Body: { email: string, pricePreference?: "monthly"|"annual"|"neither"|null,
 *         currency?: "USD"|"INR" }
 *
 * Stores exactly that plus a timestamp into the local SQLite (gitignored
 * data/ directory). Nothing is sent anywhere; there is no billing behind
 * this — it exists to measure willingness to pay for a tier that does not
 * ship yet.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; pricePreference?: unknown; currency?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "An email address is required." }, { status: 400 });
  }
  if (email.length > 254 || !validEmail(email)) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }

  const pricePreference =
    body.pricePreference == null
      ? null
      : isPricePreference(body.pricePreference)
        ? body.pricePreference
        : undefined;
  if (pricePreference === undefined) {
    return NextResponse.json({ error: "Unknown price preference." }, { status: 400 });
  }

  const currency = body.currency === "INR" ? "INR" : "USD";

  recordPricingInterest(email, pricePreference, currency);
  return NextResponse.json({ ok: true });
}
