import { NextResponse } from "next/server";
import { listInstalledModels } from "@/lib/ai/ollama";
import { runPromptWithMeta } from "@/lib/ai";
import { extractJson } from "@/lib/json-extract";
import { availableMetrics, getAssetClass, isAssetClassId } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { parseFilters } from "@/lib/screener/filter-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Natural-language → filters.
 *
 * The schema handed to the model is now *generated from the Asset Registry*
 * rather than hardcoded. That's the whole reason this route went from
 * equity-only to universal without gaining a single branch: ask for a crypto
 * screen and the model is shown crypto's metrics, their units and their real
 * ranges; ask for bonds and it's shown duration and credit quality. It also
 * means a metric can never be offered to the model unless it has a live data
 * source behind it, because `availableMetrics()` is the same function the
 * filter registry is built from.
 *
 * The model's output still goes through `parseFilters`, so anything it invents
 * is discarded rather than trusted.
 */

function buildSchema(assetClass: AssetClassId): string {
  const metrics = availableMetrics(assetClass);

  const lines = metrics.map((m) => {
    if (m.options) {
      return `  ${m.key}?: { value: string } | { values: string[] },  // ${m.label}. One of: ${m.options.join(" | ")}`;
    }
    const unit =
      m.unit === "$B"
        ? "in dollars (1000000000 = $1B)"
        : m.unit === "%"
          ? "percent units (15 = 15%)"
          : m.unit === "x"
            ? "a multiple (15 = 15x)"
            : m.unit === "yrs"
              ? "in years"
              : m.unit === "score"
                ? "0-100"
                : "a raw number";
    return `  ${m.key}?: { min?: number, max?: number },  // ${m.label} — ${unit}. ${m.description}`;
  });

  return `{\n${lines.join("\n")}\n}`;
}

function buildSystemPrompt(assetClass: AssetClassId): string {
  const def = getAssetClass(assetClass);

  return `You are a screening assistant for ${def.label.toLowerCase()}. Given a plain-English description of what someone is looking for, output a valid JSON object encoding the screening filters.

The JSON must conform to this schema (every field optional):

${buildSchema(assetClass)}

Rules:
- Only include fields relevant to the user's description. Omit everything else.
- Use ONLY the field names listed above. Any other field name will be discarded.
- Respect each field's stated units.
- For categorical fields, use only the listed allowed values, spelled exactly.
- Do not invent thresholds the user didn't imply — a vague request should produce few filters, not many.
- Output ONLY the JSON object. No explanation, no markdown code fences.

Available templates for this asset class, if the description matches one closely: ${def.templates.map((t) => `${t.id} (${t.name}: ${t.tagline})`).join("; ")}.
If one clearly matches, also include "templateId": "<id>".`;
}

/** GET /api/screener/nl — installed Ollama models, for the model picker. */
export async function GET() {
  return NextResponse.json({ models: await listInstalledModels() });
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
  const def = getAssetClass(assetClass);

  let raw: string;
  let model: string;
  try {
    const result = await runPromptWithMeta("nl-screener", userPrompt, {
      model: body.model?.trim() || undefined,
      system: buildSystemPrompt(assetClass),
      temperature: 0.1,
      timeoutMs: 30_000,
    });
    raw = result.text;
    model = result.model;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ollama request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!raw) {
    return NextResponse.json({ error: "Ollama returned an empty response" }, { status: 502 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson<Record<string, unknown>>(raw);
  } catch {
    return NextResponse.json(
      { error: "Ollama did not return valid JSON. Try rephrasing your description.", raw },
      { status: 422 },
    );
  }

  const templateId =
    typeof parsed.templateId === "string" && def.templates.some((t) => t.id === parsed.templateId)
      ? parsed.templateId
      : null;

  // The model's output is untrusted: parseFilters drops any key that isn't a
  // real, available metric on this class, and coerces the rest into shape.
  const filters = parseFilters(assetClass, parsed);

  return NextResponse.json({ assetClass, filters, templateId, model });
}
