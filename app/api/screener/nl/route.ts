import { NextResponse } from "next/server";
import type { FundamentalScreenerCriteria } from "@/lib/types";
import { listInstalledModels } from "@/lib/ai/ollama";
import { runPromptWithMeta } from "@/lib/ai";
import { extractJson } from "@/lib/json-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are a financial screener assistant. Given a plain-English description of an investment strategy or stock type, output a valid JSON object that encodes the screening criteria.

The JSON must conform to this TypeScript interface:
{
  sector?: string | null,           // e.g. "Technology", "Healthcare", "Energy"
  industry?: string | null,         // partial match, e.g. "Semiconductors"
  marketCap?: { min?: number, max?: number },  // in dollars, e.g. 1e9 = $1B
  forwardPE?: { min?: number, max?: number },  // forward P/E ratio
  evToEbitda?: { min?: number, max?: number }, // EV/EBITDA multiple
  fcfYield?: { min?: number, max?: number },   // free cash flow yield %
  revenueGrowthYoY?: { min?: number, max?: number }, // revenue growth % YoY
  revenueCagr3y?: { min?: number, max?: number },    // 3-year revenue CAGR %
  epsGrowthYoY?: { min?: number, max?: number },     // EPS growth % YoY
  epsCagr3y?: { min?: number, max?: number },        // 3-year EPS CAGR %
  roic?: { min?: number, max?: number },        // return on invested capital %
  roe?: { min?: number, max?: number },         // return on equity %
  grossMargin?: { min?: number, max?: number }, // gross margin %
  operatingMargin?: { min?: number, max?: number }, // operating margin %
  debtToEquity?: { min?: number, max?: number },    // debt/equity ratio
  netDebtToEbitda?: { min?: number, max?: number }, // net debt / EBITDA
  currentRatio?: { min?: number, max?: number },    // current assets / current liabilities
  fcfMargin?: { min?: number, max?: number },       // free cash flow margin %
  fcfGrowthYoY?: { min?: number, max?: number },    // FCF growth % YoY
  dividendYield?: { min?: number, max?: number },   // dividend yield %
  buybackYield?: { min?: number, max?: number },    // net buyback yield %
  oneYearReturn?: { min?: number, max?: number },   // 1-year price return %
  distanceFrom52WkHigh?: { min?: number, max?: number }, // % from 52-week high (negative = below)
  institutionalOwnership?: { min?: number, max?: number }, // % held by institutions
  earningsSurprisePct?: { min?: number, max?: number },   // avg EPS surprise %
  valueScore?: { min?: number, max?: number },          // composite value score 0-100
  growthScore?: { min?: number, max?: number },         // composite growth score 0-100
  qualityScore?: { min?: number, max?: number },        // composite quality score 0-100
  financialHealthScore?: { min?: number, max?: number }, // financial health score 0-100
  overallScore?: { min?: number, max?: number },         // overall composite score 0-100
  sortField?: string,  // field name to sort by, e.g. "overallScore", "revenueGrowthYoY"
  sortDir?: "asc" | "desc"
}

Rules:
- Only include fields relevant to the user's description. Omit everything else.
- marketCap ranges are in dollars (e.g. 1000000000 for $1B, 10000000000 for $10B).
- % fields are in percent units (e.g. 15 means 15%).
- For "large cap" use marketCap.min = 10000000000. For "small cap" use marketCap.max = 2000000000. For "mid cap" use min=2000000000, max=10000000000.
- For "cheap" or "value", use forwardPE.max around 15, or valueScore.min around 60.
- For "growth", use revenueGrowthYoY.min >= 15 or growthScore.min >= 60.
- For "quality" or "profitable", use roe.min >= 15, grossMargin.min >= 40, or qualityScore.min >= 60.
- For "dividend", use dividendYield.min >= 2.
- For "safe" or "conservative balance sheet", use debtToEquity.max <= 0.5 or financialHealthScore.min >= 65.
- For "momentum" or "trending up", use oneYearReturn.min >= 20 or distanceFrom52WkHigh.min >= -10.
- Default sortDir to "desc". Default sortField to "overallScore" unless a more specific field fits the description.
- Output ONLY the JSON object. No explanation, no markdown code fences.`;

/** GET /api/screener/nl — list installed Ollama models for the model picker. */
export async function GET() {
  return NextResponse.json({ models: await listInstalledModels() });
}

/** POST /api/screener/nl — body { prompt, model } → FundamentalScreenerCriteria */
export async function POST(request: Request) {
  let body: { prompt?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userPrompt = body.prompt?.trim();
  if (!userPrompt) return NextResponse.json({ error: "`prompt` is required" }, { status: 400 });

  let raw: string;
  let model: string;
  try {
    const result = await runPromptWithMeta("nl-screener", userPrompt, {
      model: body.model?.trim() || undefined,
      system: SYSTEM_PROMPT,
      temperature: 0.1,
      timeoutMs: 30_000,
    });
    raw = result.text;
    model = result.model;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ollama request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!raw) return NextResponse.json({ error: "Ollama returned an empty response" }, { status: 502 });

  let criteria: FundamentalScreenerCriteria;
  try {
    criteria = extractJson<FundamentalScreenerCriteria>(raw);
  } catch {
    return NextResponse.json(
      { error: "Ollama did not return valid JSON. Try rephrasing your description.", raw },
      { status: 422 },
    );
  }

  return NextResponse.json({ criteria, model });
}
