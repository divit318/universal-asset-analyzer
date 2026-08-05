/**
 * GET /api/materiality/research?symbol=NVDA — the server-derived half of the
 * research page's materiality lens.
 *
 * Returns, for one symbol:
 *   - `dimensions`: the symbol's peer-group percentiles for a headline set of
 *     equity metrics, framed by the SAME universe statistics the Screener uses
 *     (lib/screener/universe-stats.ts) — no cutoffs are invented here, and the
 *     peer group size is carried so the pure verdict function can refuse to
 *     claim an extreme off a tiny group. `null` when the symbol is not in the
 *     cached equity universe (foreign listing, fund, crypto…): the check is
 *     then honestly skipped rather than approximated.
 *   - `priorVisitAt`: when the user last opened this symbol on /research
 *     (the activity register), for "changed since your last visit" items.
 *     Read before this visit's debounced activity POST lands, so it still
 *     reports the previous visit.
 *
 * The judgments themselves happen client-side in lib/materiality.ts.
 */
import { NextResponse } from "next/server";
import { getActivityAt } from "@/lib/db";
import { getUniverseProvider } from "@/lib/screener/universes";
import { getUniverseStats } from "@/lib/screener/universe-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;

/** Headline metrics only — one per concern, all defined in lib/assets/equity.ts. */
const DIMENSION_KEYS: { key: string; label: string }[] = [
  { key: "forwardPE", label: "Forward P/E" },
  { key: "fcfYield", label: "FCF yield" },
  { key: "revenueCagr3y", label: "Revenue CAGR (3y)" },
  { key: "roic", label: "ROIC" },
  { key: "grossMargin", label: "Gross margin" },
  { key: "debtToEquity", label: "Debt / equity" },
  { key: "oneYearReturn", label: "1y return" },
];

interface ResearchMaterialityPayload {
  dimensions:
    | {
        key: string;
        label: string;
        percentile: number | null;
        peerGroup: string | null;
        peerGroupSize: number | null;
      }[]
    | null;
  universeBuiltAt: string | null;
  priorVisitAt: string | null;
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const priorVisitAt = getActivityAt("research", symbol);

  let payload: ResearchMaterialityPayload = { dimensions: null, universeBuiltAt: null, priorVisitAt };

  // Dispersion framing is best-effort: a universe that cannot be loaded (cold
  // cache, provider down) degrades to "no dimension checks", never to an error
  // that would take the whole lens down with it.
  try {
    const { status, candidates } = await getUniverseProvider("equity").load();
    const inUniverse = candidates.some((c) => c.symbol.toUpperCase() === symbol);
    if (inUniverse) {
      const stats = getUniverseStats("equity", candidates, status.builtAt);
      const peerGroup = stats.peerGroupOf.get(symbol) ?? null;
      const peerGroupSize = peerGroup != null ? stats.peerGroupSize.get(peerGroup) ?? null : null;
      payload = {
        dimensions: DIMENSION_KEYS.map(({ key, label }) => ({
          key,
          label,
          percentile: stats.peerPercentiles.get(key)?.get(symbol) ?? null,
          peerGroup,
          peerGroupSize,
        })),
        universeBuiltAt: status.builtAt,
        priorVisitAt,
      };
    }
  } catch {
    // Leave dimensions null — the lens skips the check.
  }

  return NextResponse.json(payload);
}
