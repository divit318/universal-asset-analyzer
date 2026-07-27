import { NextResponse } from "next/server";
import { listInstalledModels } from "@/lib/ai/ollama";
import { specForInstalled } from "@/lib/ai/models";
import { isAssetClassId } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { NlFilterParseError, parseNlFilters } from "@/lib/screener/nl-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/screener/nl — list installed, enabled Ollama models for the model picker. */
export async function GET() {
  const installed = await listInstalledModels();
  const models = installed.filter((id) => specForInstalled(id).enabled);
  return NextResponse.json({ models });
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
    const message = err instanceof Error ? err.message : "Ollama request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
