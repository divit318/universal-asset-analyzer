/**
 * Natural-language → screener filters.
 *
 * Shared by the Screener's own NL search (app/api/screener/nl/route.ts) and
 * the App Assistant's screener actions (lib/ai-app-assistant.ts) — one
 * schema-generation + parsing path, not two independently-drifting ones.
 *
 * The schema handed to the model is generated from the Asset Registry rather
 * than hardcoded, so this works across every screening universe without a
 * single branch: ask for a crypto screen and the model is shown crypto's
 * metrics, their units and their real ranges; ask for bonds and it's shown
 * duration and credit quality. A metric can never be offered to the model
 * unless it has a live data source behind it, because `availableMetrics()` is
 * the same function the filter registry is built from.
 *
 * The model's output still goes through `parseFilters`, so anything it
 * invents is discarded rather than trusted.
 */

import { runPromptWithMeta } from "../ai";
import { extractJson } from "../json-extract";
import { availableMetrics, getAssetClass } from "../assets/registry";
import type { AssetClassId, FilterValues } from "../assets/types";
import { parseFilters } from "./filter-engine";

export interface NlFilterResult {
  assetClass: AssetClassId;
  filters: FilterValues;
  templateId: string | null;
  model: string;
}

/** Thrown when the model's response isn't valid JSON — distinct from a
 * request/model failure so callers can surface the raw text for debugging. */
export class NlFilterParseError extends Error {
  raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.raw = raw;
  }
}

function buildSchema(assetClass: AssetClassId): string {
  const metrics = availableMetrics(assetClass);

  const lines = metrics.map((m) => {
    if (m.options) {
      return `  ${m.key}?: { value: string } | { values: string[] },  // ${m.label}. One of: ${m.options.join(" | ")}`;
    }
    const unit =
      m.unit === "$B"
        ? "in dollars (1000000000 = $1B)"
        : // Without this branch the model was told ₹Cr metrics were "a raw
          // number" and answered in crores — so "Nifty-50 sized" became
          // marketCap ≥ 100000 (₹1 lakh in rupees), a filter that matched
          // every stock in the universe. The engine stores raw INR.
          m.unit === "₹Cr"
          ? "in Indian rupees (10000000 = ₹1 crore, 1000000000000 = ₹1,00,000 Cr)"
          : m.unit === "pp"
            ? "percentage points of change (1.5 = +1.5pp)"
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

/** Exported for benching — pure. */
export function buildSystemPrompt(assetClass: AssetClassId): string {
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

/** Plain-English description → validated FilterValues for the given asset class. */
export async function parseNlFilters(
  prompt: string,
  assetClass: AssetClassId,
  opts: { model?: string } = {},
): Promise<NlFilterResult> {
  const def = getAssetClass(assetClass);

  const { text: raw, model } = await runPromptWithMeta("nl-screener", prompt, {
    model: opts.model,
    system: buildSystemPrompt(assetClass),
    temperature: 0.1,
    timeoutMs: 30_000,
  });

  if (!raw) throw new Error("The AI returned an empty response");

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson<Record<string, unknown>>(raw);
  } catch {
    throw new NlFilterParseError("The AI did not return valid JSON. Try rephrasing your description.", raw);
  }

  const templateId =
    typeof parsed.templateId === "string" && def.templates.some((t) => t.id === parsed.templateId)
      ? parsed.templateId
      : null;

  const filters = parseFilters(assetClass, parsed);

  return { assetClass, filters, templateId, model };
}
