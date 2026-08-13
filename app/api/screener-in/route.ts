import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import {
  getScreenerInCompany,
  getPeers,
  getPromoterHolding,
  getFIIHolding,
  getDIIHolding,
} from "@/lib/screener-in";
import { deriveIndiaFundamentals } from "@/lib/india-snapshot";
import { getQuote, getCorporateActions } from "@/lib/yahoo";
import { getLatestResultsMeta, getUpcomingResultsDate } from "@/lib/india-news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Months between two ISO/period dates, for freshness gating. */
function monthsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return Math.abs(a.getFullYear() * 12 + a.getMonth() - (b.getFullYear() * 12 + b.getMonth()));
}

/** "Jun 2026" → "2026-06-30"-ish anchor for comparisons. */
function periodToIso(period: string | null | undefined): string | null {
  if (!period) return null;
  const d = new Date(`01 ${period} UTC`);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/**
 * GET /api/screener-in?symbol=RELIANCE
 *
 * Returns enriched screener.in data + live Yahoo quote merged together, plus
 * corporate actions (Yahoo events) and official NSE results metadata.
 * Designed for the Indian stock research view.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` parameter is required" }, { status: 400 });
  }

  const nsSymbol = `${symbol.replace(/\.(NS|BO)$/i, "")}.NS`;
  const [company, quoteResult, actionsResult] = await Promise.allSettled([
    getScreenerInCompany(symbol),
    getQuote(nsSymbol),
    getCorporateActions(nsSymbol),
  ]);

  if (company.status === "rejected" || company.value == null) {
    return NextResponse.json(
      { error: `Company "${symbol}" not found on screener.in` },
      { status: 404 },
    );
  }

  const data = company.value;
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const corporateActions =
    actionsResult.status === "fulfilled" ? actionsResult.value : { dividends: [], splits: [] };

  // All statement-derived metrics (D/E, interest coverage, P/B, growth,
  // cash flow, latest quarter, NPA…) come from ONE derivation over the
  // scraped balance sheet / cash flow / P&L.
  const derived = deriveIndiaFundamentals(data);

  // Official NSE results metadata: the "reported on" timestamp, plus bank
  // asset quality from the standalone XBRL (screener.in login-gates those
  // rows). Both best-effort — an NSE outage degrades, never blocks.
  const financial = data.statementKind === "financial";
  const [resultsMeta, upcomingResults] = await Promise.all([
    getLatestResultsMeta(nsSymbol, { wantBankMetrics: financial }),
    getUpcomingResultsDate(nsSymbol),
  ]);

  // Adopt NSE NPA into the scoring inputs ONLY when the filing is close
  // enough to the quarter we display (≤ 6 months) — the NSE endpoint can lag
  // several quarters, and a stale ratio presented as current is worse than a
  // gap. The UI separately renders the figures with their own period label.
  const latestQIso = periodToIso(derived.latestQuarter?.period);
  const npaFresh =
    financial &&
    resultsMeta?.periodEnd != null &&
    latestQIso != null &&
    monthsBetween(resultsMeta.periodEnd, latestQIso) <= 6;
  if (npaFresh && derived.netNpaPercent == null && resultsMeta?.netNpaPercent != null) {
    derived.netNpaPercent = resultsMeta.netNpaPercent;
    derived.missing = derived.missing.filter((m) => m !== "NPA");
  }
  if (npaFresh && derived.grossNpaPercent == null && resultsMeta?.grossNpaPercent != null) {
    derived.grossNpaPercent = resultsMeta.grossNpaPercent;
  }

  return NextResponse.json({
    company: data,
    quote,
    derived: {
      promoterHolding: getPromoterHolding(data),
      fiiHolding: getFIIHolding(data),
      diiHolding: getDIIHolding(data),
      peers: getPeers(data),
      ...derived,
    },
    corporateActions,
    resultsMeta,
    upcomingResults,
  });
}
