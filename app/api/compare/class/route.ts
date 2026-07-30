/**
 * GET /api/compare/class?assetClass=etf&symbols=VOO,SCHD — up to 5 symbols.
 *
 * The non-equity counterpart to /api/compare. Equity's route (and its
 * CompareEntry shape) is untouched — this is a parallel path for every other
 * asset class, built on top of the Screener's already-built, already-cached
 * universes (lib/screener/universes/*.ts) rather than a new data pipeline.
 * Same numbers a user would see on the Screener for this symbol, by
 * construction.
 */

import { NextResponse } from "next/server";
import { getUniverseProvider } from "@/lib/screener/universes";
import { isAssetClassId } from "@/lib/assets/registry";
import { normalizeSymbol } from "@/lib/market";
import { getCurvePoints } from "@/lib/compare/commodity-curve";
import { computeEntryBenchmarks, peerGroupOf } from "@/lib/compare/benchmarks";
import { computeClassRiskFlags } from "@/lib/compare/risk-flags";
import { compareClassAssets } from "@/lib/compare/class-ai-compare";
import type { ClassCompareEntry } from "@/lib/compare/types";
import {
  computeBondScores,
  computeCommodityScores,
  computeCryptoScores,
  computeEtfScores,
  computeForexScores,
  computeReitScores,
  type CompositeScoreResult,
} from "@/lib/compare/composite-scores";
import type { AssetClassId } from "@/lib/assets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function scoresFor(assetClass: AssetClassId, metrics: Record<string, number | null>): CompositeScoreResult {
  switch (assetClass) {
    case "etf": return computeEtfScores(metrics);
    case "reit": return computeReitScores(metrics);
    case "crypto": return computeCryptoScores(metrics);
    case "commodity": return computeCommodityScores(metrics);
    case "bond": return computeBondScores(metrics);
    case "forex": return computeForexScores(metrics);
    default: return { axes: [], overall: null };
  }
}

/** Shared by GET and POST — loads the class universe and builds one ClassCompareEntry per requested symbol. */
async function loadClassEntries(
  assetClass: AssetClassId,
  symbols: string[],
): Promise<{ entries: ClassCompareEntry[]; universeAsOf: string | null }> {
  const provider = getUniverseProvider(assetClass);
  let { candidates, status } = await provider.load();

  // REIT and equity (lib/dataset.ts's createEnrichedDataset) return an empty
  // snapshot immediately on a cold cache rather than blocking on the
  // in-flight build — the right call for the Screener's progressive-fill UI,
  // wrong here: a user who typed 2-5 specific symbols gets "not found" for
  // real, well-covered names that are seconds away from loading. Poll the
  // still-building universe briefly rather than accept a misleading empty
  // result; bounded well under this route's 60s maxDuration so POST's
  // downstream AI call still has room.
  const POLL_MS = 2000;
  const MAX_WAIT_MS = 20000;
  let waited = 0;
  while (candidates.length === 0 && status.stage === "building" && waited < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    waited += POLL_MS;
    ({ candidates, status } = await provider.load());
  }

  const universeAsOf = status.builtAt;
  const bySymbol = new Map(candidates.map((c) => [c.symbol.toUpperCase(), c]));

  // A universe with zero candidates that never reached "ready" (a hard error,
  // e.g. the cache module treats an empty build as a failure — see
  // universe-cache.ts — or it's still building after the poll above gave up)
  // means every symbol would otherwise come back "not found," which reads as
  // "this symbol isn't covered" when the real problem is that the data
  // provider is temporarily unavailable or still warming up.
  const universeUnavailable = candidates.length === 0 && status.stage !== "ready";
  const notFoundError = universeUnavailable
    ? status.error
      ? `The ${assetClass} universe is temporarily unavailable (${status.error}) — try again shortly`
      : `The ${assetClass} universe is still loading — try again in a moment`
    : `Not found in the ${assetClass} universe`;

  const entries: ClassCompareEntry[] = await Promise.all(
    symbols.map(async (symbol): Promise<ClassCompareEntry> => {
      const candidate = bySymbol.get(symbol.toUpperCase());
      if (!candidate) {
        return {
          symbol,
          name: symbol,
          assetClass,
          price: null,
          changePercent: null,
          metrics: {},
          attributes: {},
          scores: { axes: [], overall: null },
          error: notFoundError,
        };
      }

      const curvePoints = assetClass === "commodity" ? await getCurvePoints(symbol).catch(() => []) : undefined;
      const peerGroup = peerGroupOf(assetClass, candidate.attributes);
      const benchmarks = computeEntryBenchmarks(
        assetClass,
        Object.keys(candidate.metrics),
        candidate.symbol,
        candidate.metrics,
        peerGroup,
        candidates,
      );
      const riskFlags = computeClassRiskFlags(assetClass, candidate.metrics, candidate.attributes);

      return {
        symbol: candidate.symbol,
        name: candidate.name,
        assetClass,
        price: candidate.price,
        changePercent: candidate.changePercent,
        metrics: candidate.metrics,
        attributes: candidate.attributes,
        topHoldings: candidate.topHoldings,
        scores: scoresFor(assetClass, candidate.metrics),
        curvePoints,
        benchmarks,
        riskFlags,
        universeAsOf,
      };
    }),
  );

  return { entries, universeAsOf };
}

function parseAssetClass(assetClassParam: string | null): AssetClassId | null {
  if (!isAssetClassId(assetClassParam) || assetClassParam === "equity") return null;
  return assetClassParam;
}

/** GET /api/compare/class?assetClass=etf&symbols=VOO,SCHD — up to 5 symbols. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const assetClassParam = url.searchParams.get("assetClass");
  const raw = url.searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => normalizeSymbol(s)).filter((s): s is string => s !== null))].slice(0, 5);

  const assetClass = parseAssetClass(assetClassParam);
  if (!assetClass) {
    return NextResponse.json({ error: "A non-equity assetClass is required" }, { status: 400 });
  }
  if (symbols.length < 1) {
    return NextResponse.json({ error: "At least one symbol is required" }, { status: 400 });
  }

  let entries: ClassCompareEntry[];
  try {
    ({ entries } = await loadClassEntries(assetClass, symbols));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load universe" }, { status: 503 });
  }

  return NextResponse.json({ entries });
}

/**
 * POST /api/compare/class
 * Body: { assetClass, symbols: string[] } (2-5 symbols).
 * Returns ClassComparisonResult — the AI-generated ranked verdict for a
 * non-equity comparison, framed by that class's own registry (aiPrompt +
 * key questions), e.g. cost/liquidity/concentration/tracking for ETFs.
 */
export async function POST(request: Request) {
  let body: { assetClass?: string; symbols?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const assetClass = parseAssetClass(body.assetClass ?? null);
  if (!assetClass) {
    return NextResponse.json({ error: "A non-equity assetClass is required" }, { status: 400 });
  }

  const symbols = [...new Set(
    (Array.isArray(body.symbols) ? body.symbols : [])
      .map((s) => normalizeSymbol(s))
      .filter((s): s is string => s !== null),
  )].slice(0, 5);

  if (symbols.length < 2) {
    return NextResponse.json({ error: "At least two distinct symbols are required" }, { status: 400 });
  }

  try {
    const { entries } = await loadClassEntries(assetClass, symbols);
    const validEntries = entries.filter((e) => !e.error);
    if (validEntries.length < 2) {
      return NextResponse.json({ error: "At least two symbols must load successfully" }, { status: 422 });
    }
    const result = await compareClassAssets(assetClass, validEntries);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Comparison failed" }, { status: 503 });
  }
}
