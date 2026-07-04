/**
 * POST /api/portfolio/scenario
 *
 * User-defined stress-test scenario: apply an arbitrary sector shock to the
 * current portfolio and return the impact, computed the same way as the
 * built-in historical scenarios (lib/portfolio-analytics.ts computeCustomScenario).
 * Deterministic — no AI involved.
 */
import { NextResponse } from "next/server";
import { computeCustomScenario, ALL_SECTORS, type PortfolioReport } from "@/lib/portfolio-analytics";
import { getLatestSectorRotation } from "@/lib/sector-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  sector?: string;
  shockPct?: number; // negative for a downside shock, e.g. -30
  name?: string;
}

async function getReport(): Promise<PortfolioReport | null> {
  try {
    const host = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${host}/api/portfolio/report`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return (await res.json()) as PortfolioReport;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: RequestBody;
  try { body = await request.json(); } catch { body = {}; }

  const sector = body.sector?.trim();
  const shockPct = Number(body.shockPct);

  if (!sector || !ALL_SECTORS.includes(sector)) {
    return NextResponse.json({ error: `\`sector\` must be one of: ${ALL_SECTORS.join(", ")}` }, { status: 400 });
  }
  if (!Number.isFinite(shockPct) || shockPct < -95 || shockPct > 95) {
    return NextResponse.json({ error: "\`shockPct\` must be a number between -95 and 95" }, { status: 400 });
  }

  const report = await getReport();
  if (!report || report.positionCount === 0) {
    return NextResponse.json({ error: "No portfolio data available" }, { status: 404 });
  }

  const rotationSnapshot = getLatestSectorRotation();
  const scenario = computeCustomScenario(
    report.positions,
    report.totalValue,
    { [sector]: shockPct },
    body.name?.trim() || `${sector} ${shockPct >= 0 ? "+" : ""}${shockPct}%`,
    `User-defined: ${sector} moves ${shockPct >= 0 ? "+" : ""}${shockPct}%, other sectors unaffected`,
    rotationSnapshot,
  );

  return NextResponse.json({ scenario });
}
