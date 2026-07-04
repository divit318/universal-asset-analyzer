import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { explainMovement } from "@/lib/movement-explainer";
import type { MovementSubjectKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS: MovementSubjectKind[] = ["symbol", "sector", "portfolio"];

/**
 * GET /api/movement?kind=symbol&subject=AAPL&window=5&sector=Technology
 * Explain Every Movement — drivers, evidence, confidence, persistence for a
 * symbol, sector, or portfolio.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = (params.get("kind") ?? "symbol") as MovementSubjectKind;
  const subject = params.get("subject")?.trim();
  const windowDays = Number(params.get("window") ?? "5");
  const sector = params.get("sector")?.trim() || null;

  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Invalid `kind`; expected symbol, sector, or portfolio" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "A `subject` query parameter is required" }, { status: 400 });
  }
  if (kind === "symbol" && !isValidSymbol(subject.toUpperCase())) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  try {
    const explanation = await explainMovement({
      subjectKind: kind,
      subject: kind === "symbol" ? subject.toUpperCase() : subject,
      windowDays: Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 5,
      sector,
    });
    return NextResponse.json({ explanation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Movement explanation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
