import { NextResponse } from "next/server";
import { getAssetClass, isAssetClassId } from "@/lib/assets/registry";
import { parseFilters } from "@/lib/screener/filter-engine";
import { runScreen } from "@/lib/screener/pipeline";
import { summarizeRanking } from "@/lib/screener/ai-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/screener/explain — AI read on the ranking as a whole.
 *
 * Re-runs the screen server-side rather than trusting rows posted by the
 * client, so the model can only ever be shown values the pipeline actually
 * produced. Per-row "why this matched" is already computed deterministically in
 * lib/screener/explain.ts and needs no model at all.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isAssetClassId(body.assetClass)) {
    return NextResponse.json(
      { error: `Unknown asset class: ${String(body.assetClass)}` },
      { status: 400 },
    );
  }
  const assetClass = body.assetClass;
  const def = getAssetClass(assetClass);

  const template =
    typeof body.templateId === "string"
      ? (def.templates.find((t) => t.id === body.templateId) ?? null)
      : null;
  const templateId = template?.id ?? null;

  // Same contract as /api/screener: an omitted `filters` key means "use the
  // template's own filters"; a present one is authoritative.
  const filters =
    body.filters === undefined && template
      ? template.filters
      : parseFilters(assetClass, body.filters);

  try {
    const result = await runScreen({
      assetClass,
      templateId,
      filters,
      sortKey: typeof body.sortKey === "string" ? body.sortKey : def.defaultSort.key,
      sortDir: body.sortDir === "asc" ? "asc" : "desc",
      size: 25,
      offset: 0,
    });

    // The filter labels the model is told about are taken from the *first*
    // matched row's explanation, which is built by the same code that did the
    // filtering — so they can't drift from what was actually applied.
    const filterLabels = result.rows[0]?.match.passed.map((p) => p.label) ?? [];
    const template = templateId ? def.templates.find((t) => t.id === templateId) : null;

    const { summary, model } = await summarizeRanking(
      assetClass,
      result.rows,
      template?.name ?? null,
      filterLabels,
    );

    return NextResponse.json({ summary, model, matched: result.total });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not explain this ranking";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
