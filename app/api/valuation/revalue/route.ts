import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { appendValuationEvent, getValuationCase, listValuationCases } from "@/lib/db";
import { computeCaseResult } from "@/lib/valuation/case";
import { fetchValuationFacts, type ValuationFacts } from "@/lib/valuation/prefill";
import { revalueCase, type RevaluationOutcome } from "@/lib/valuation/revaluation";
import {
  calibrateAssumptions,
  calibrationEntriesFor,
  type CalibrationEntry,
  type CalibrationReport,
} from "@/lib/valuation/calibration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A revaluation, minus the assumption set (which the client has no use for). */
export type RevaluationSummary = Omit<RevaluationOutcome, "assumptions">;

export interface RevalueResponse {
  results: RevaluationSummary[];
  /** How the user's own growth assumptions compare to the record. */
  calibration: CalibrationReport;
  /** Symbols whose facts could not be refetched. Non-fatal. */
  skipped: string[];
}

/** How many names one batch call will fetch. Keeps the request bounded. */
const BATCH_LIMIT = 40;

function strip(outcome: RevaluationOutcome): RevaluationSummary {
  const { assumptions: _assumptions, ...rest } = outcome;
  void _assumptions;
  return rest;
}

/**
 * POST /api/valuation/revalue — re-run cases against the latest reported figures.
 *
 * Body: `{ symbol }` for one case, or `{}` for every case you hold.
 *
 * A version is appended only where an unclaimed fact actually moved. Cases whose
 * numbers are unchanged produce a verdict but no event, because an audit trail
 * full of "nothing changed" entries is an audit trail nobody reads.
 */
export async function POST(request: Request) {
  let body: { symbol?: string };
  try {
    body = (await request.json()) as { symbol?: string };
  } catch {
    body = {};
  }

  const single = body.symbol != null ? normalizeSymbol(body.symbol) : null;
  if (body.symbol != null && !single) {
    return NextResponse.json({ error: "Invalid `symbol`" }, { status: 400 });
  }

  const cases = single
    ? [getValuationCase(single)].filter((c): c is NonNullable<typeof c> => c !== null)
    : listValuationCases().slice(0, BATCH_LIMIT);

  if (cases.length === 0) {
    return NextResponse.json(
      single
        ? { error: `No valuation case exists for ${single}` }
        : { results: [], calibration: calibrateAssumptions([]), skipped: [] },
      { status: single ? 404 : 200 },
    );
  }

  // Sequential rather than parallel: this hits Yahoo once per name, and a burst
  // of forty concurrent quote requests is how you get rate-limited into failing
  // the whole batch instead of degrading a few rows of it.
  const results: RevaluationSummary[] = [];
  const calibrationEntries: CalibrationEntry[] = [];
  const skipped: string[] = [];

  for (const vcase of cases) {
    let facts: ValuationFacts;
    try {
      facts = await fetchValuationFacts(vcase.symbol);
    } catch {
      skipped.push(vcase.symbol);
      continue;
    }

    const outcome = revalueCase(vcase, {
      baseFcf: facts.baseFcf,
      sharesOutstanding: facts.sharesOutstanding,
      netDebt: facts.netDebt,
      price: facts.price,
      delivered: facts.deliveredGrowth,
    });

    if (outcome.changed) {
      appendValuationEvent({
        symbol: vcase.symbol,
        currency: vcase.currency,
        method: vcase.method,
        author: "system",
        kind: "earnings_revaluation",
        assumptions: outcome.assumptions,
        result: computeCaseResult(outcome.assumptions, facts.price ?? vcase.priceAt),
        priceAt: facts.price ?? vcase.priceAt,
        triggerSource: "reported_figures",
        note: outcome.headline,
      });
    }

    results.push(strip(outcome));
    calibrationEntries.push(...calibrationEntriesFor(vcase, facts.deliveredGrowth));
  }

  // Broken first, then weakened: the list is a worklist, not a report.
  const rank = { broken: 0, watch: 1, intact: 2 } as const;
  results.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return NextResponse.json({
    results,
    calibration: calibrateAssumptions(calibrationEntries),
    skipped,
  } satisfies RevalueResponse);
}
