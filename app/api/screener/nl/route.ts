import { NextResponse } from "next/server";
import { checkPlatformHealth } from "@/lib/ai/platform-health";
import { specForInstalled } from "@/lib/ai/models";
import { isAssetClassId } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { NlFilterParseError, parseNlFilters } from "@/lib/screener/nl-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/screener/nl — every routable, enabled model, for the model picker
 * and the header status badge.
 *
 * `active` describes the model the Router would reach for first. It is
 * resolved here rather than in the badge because `specForInstalled` lives in
 * lib/ai/models, which reaches node:os for the memory budget — importing it
 * from a client component is a build error that `tsc` happily lets through.
 */
export async function GET() {
  const { models: available } = await checkPlatformHealth();
  const models = available.filter((id) => specForInstalled(id).enabled);
  const first = models[0] ? specForInstalled(models[0]) : null;
  return NextResponse.json({
    models,
    active: first ? { id: first.id, label: first.label, provider: first.provider } : null,
  });
}

/** POST /api/screener/nl — body { prompt, model, assetClass } → { filters, templateId } */
export async function POST(request: Request) {
  let body: { prompt?: string; model?: string; assetClass?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userPrompt = body.prompt?.trim();
  if (!userPrompt) return NextResponse.json({ error: "`prompt` is required" }, { status: 400 });

  const assetClass: AssetClassId = isAssetClassId(body.assetClass) ? body.assetClass : "equity";

  try {
    const result = await parseNlFilters(userPrompt, assetClass, { model: body.model?.trim() || undefined });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NlFilterParseError) {
      return NextResponse.json({ error: err.message, raw: err.raw }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
