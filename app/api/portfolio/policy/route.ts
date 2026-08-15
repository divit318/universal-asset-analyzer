import { NextResponse } from "next/server";
import { loadInvestorPolicy, saveInvestorPolicy } from "@/lib/portfolio/alignment/store";
import { parseInvestorPolicy } from "@/lib/portfolio/alignment/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function portfolioIdOf(request: Request): number {
  const raw = new URL(request.url).searchParams.get("portfolioId");
  const id = Number(raw ?? 1);
  return Number.isInteger(id) && id > 0 ? id : 1;
}

/** The investor's policy (assumed defaults, flagged `confirmed: false`, when unset). */
export async function GET(request: Request) {
  try {
    return NextResponse.json({ policy: loadInvestorPolicy(portfolioIdOf(request)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Save the investor's policy. Validated at the boundary; never stored raw. */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = parseInvestorPolicy(body?.policy);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const saved = saveInvestorPolicy(parsed.policy, portfolioIdOf(request));
    return NextResponse.json({ policy: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
