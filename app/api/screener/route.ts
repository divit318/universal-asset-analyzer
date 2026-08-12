import { NextResponse } from "next/server";
import { getAssetClass, getMetric, isAssetClassId } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { parseFilters, parsePreferences } from "@/lib/screener/filter-engine";
import { refreshUniverse, runScreen } from "@/lib/screener/pipeline";
import { getUniverseProvider } from "@/lib/screener/universes";
import { getUniverseStats } from "@/lib/screener/universe-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The universal screener endpoint. One route, every screening universe —
 * base asset classes and market variants (indiaEquity) alike, since each is a
 * genuine screening domain. Everything that differs between them is looked up
 * in the Asset Registry, so this handler has no per-class branching at all.
 */

/** Default universe when a caller doesn't name one — preserves the old equity-only contract. */
const DEFAULT_CLASS: AssetClassId = "equity";

function resolveClass(value: unknown): AssetClassId | null {
  if (value == null || value === "") return DEFAULT_CLASS;
  return isAssetClassId(value) ? value : null;
}

/** Columns the ranking layer can actually order by: the row's own fields, plus any metric of the class. */
const BUILTIN_SORT_KEYS = new Set(["rankScore", "symbol", "name", "price", "changePercent"]);

function isSortable(assetClass: AssetClassId, key: string): boolean {
  return BUILTIN_SORT_KEYS.has(key) || getMetric(assetClass, key) != null;
}

/**
 * GET /api/screener?class=<id>[&stats=1] — universe build status, for polling
 * while it warms, plus (on request) the per-metric distributions the filter UI
 * needs to show a user what they're aiming at.
 *
 * The distributions are behind a flag and served here rather than on the POST
 * because they are per *universe*, not per screen: fetching them once when the
 * asset class changes is correct, and attaching ~1,000 numbers to every screen
 * response would tax the hot path to redeliver something that only changes every
 * twelve hours.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("class");
  const assetClass = resolveClass(raw);
  if (!assetClass) {
    return NextResponse.json({ error: `Unknown asset class: ${raw}` }, { status: 400 });
  }

  const { status, candidates } = await getUniverseProvider(assetClass).load();
  if (url.searchParams.get("stats") !== "1") {
    return NextResponse.json({ assetClass, status });
  }

  // Already computed and cached for this build — this is a map read, not a scan.
  const stats = getUniverseStats(assetClass, candidates, status.builtAt);
  return NextResponse.json({
    assetClass,
    status,
    peerGroupBy: getAssetClass(assetClass).peerGroupBy ?? null,
    distributions: Object.fromEntries(stats.distributions),
  });
}

/**
 * POST /api/screener
 * Body: { assetClass, templateId, filters, sortKey, sortDir, size, offset, refresh }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const assetClass = resolveClass(body.assetClass);
  if (!assetClass) {
    return NextResponse.json(
      { error: `Unknown asset class: ${String(body.assetClass)}` },
      { status: 400 },
    );
  }

  if (body.refresh === true) {
    return NextResponse.json({
      assetClass,
      status: refreshUniverse({ assetClass }),
      total: 0,
      universeReady: 0,
      offset: 0,
      rows: [],
    });
  }

  const def = getAssetClass(assetClass);
  const template =
    typeof body.templateId === "string"
      ? (def.templates.find((t) => t.id === body.templateId) ?? null)
      : null;
  const templateId = template?.id ?? null;

  /**
   * Template filters vs request filters.
   *
   * `templateId` selects the *ranking*, and — when the caller sends no `filters`
   * key at all — also seeds the filters from the template. That makes
   * `{ assetClass, templateId }` a complete, self-sufficient request: ask for
   * the "Layer 1" crypto template and you get Layer 1 tokens, not the whole
   * universe ranked by Layer-1 weights. (Before this, a template-only request
   * returned every token, stablecoins included, which is how live verification
   * caught it.)
   *
   * But when `filters` IS present it is authoritative and the template's
   * filters are not merged underneath. That distinction matters: the UI seeds
   * its filter draft from the template and then lets you loosen it, so if the
   * server re-merged the template's filters as a base layer, a filter you
   * deleted would silently come back and you could never widen a template.
   */
  // A template's filters are already typed FilterValues, validated against the
  // registry (tests/asset-registry.test.ts enforces that they only reference
  // real, available metrics), so they don't need to go back through the parser.
  const filters =
    body.filters === undefined && template
      ? template.filters
      : parseFilters(assetClass, body.filters);

  /**
   * An unrecognised sortKey used to be passed straight through to the sorter,
   * where every candidate resolved to `null` and the "sorted" table silently
   * came back in universe order with no column marked. Saved screens and the
   * NL-filter handoff can both name a key that no longer exists on this class,
   * so falling back to the class's own default sort is the honest outcome.
   */
  const sortKey =
    typeof body.sortKey === "string" && isSortable(assetClass, body.sortKey)
      ? body.sortKey
      : def.defaultSort.key;
  const sortDir = body.sortDir === "asc" ? "asc" : "desc";
  const size = Math.min(Math.max(Number(body.size) || 50, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);

  try {
    const result = await runScreen({
      assetClass,
      templateId,
      filters,
      preferences: parsePreferences(assetClass, body.preferences),
      sortKey,
      sortDir,
      size,
      offset,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Screener data unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
