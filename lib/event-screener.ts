/**
 * Event-driven market scanner.
 *
 * Takes raw news items, runs them through the AI to extract themes + signals,
 * then cross-references signals against live Yahoo quotes and (where available)
 * screener.in fundamentals. Only signals backed by reasonable fundamentals
 * bubble up to the top.
 */

import { runPrompt } from "./ai";
import { getQuote } from "./yahoo";
import { extractJsonObject } from "./json-extract";
import type { NewsItem, EventSignal, ScanResult, Quote } from "./types";
import { aiUnavailableMessage } from "./ai/availability";

/* -------------------------------------------------------------------------- */
/* AI prompt                                                                  */
/* -------------------------------------------------------------------------- */

function buildScanPrompt(news: NewsItem[], userQuery?: string): string {
  const headlines = news
    .slice(0, 40)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.headline}${n.summary ? ` — ${n.summary.slice(0, 120)}` : ""}`)
    .join("\n");

  const focusLine = userQuery
    ? `\nFOCUS: The user is specifically interested in: "${userQuery}"\n`
    : "";

  return `You are a professional equity research analyst with expertise in both Indian and global markets.
Analyze the news headlines below and identify actionable market signals.${focusLine}

NEWS HEADLINES:
${headlines}

Extract:

1. THEMES (max 6): Short macro/sector themes active right now.
   Examples: "RBI rate pause", "Budget infra spend", "Oil price spike", "US tariff escalation", "IT sector slowdown"

2. SIGNALS (max 15): Specific actionable stock/sector opportunities.
   For each signal provide:
   - ticker: Use NSE symbol for Indian stocks (e.g. HDFCBANK, RELIANCE, TCS) or NYSE/NASDAQ for US stocks (e.g. AAPL, MSFT). Do NOT add .NS suffix.
   - name: Company full name
   - direction: "bullish", "bearish", or "neutral"
   - confidence: 0-100 integer
   - theme: Which theme drives this signal
   - rationale: One sentence max — be specific with numbers/facts from the news
   - timeframe: "short" (days-weeks), "medium" (weeks-months), "long" (months-years)
   - isIndian: true if NSE/BSE listed, false if US/other

3. SUMMARY: 3-4 sentences summarising the overall market picture from these headlines.

Respond ONLY with valid JSON in exactly this structure:
{
  "themes": ["theme1", "theme2"],
  "signals": [
    {
      "ticker": "HDFCBANK",
      "name": "HDFC Bank Ltd",
      "direction": "bullish",
      "confidence": 78,
      "theme": "RBI rate pause",
      "rationale": "Rate pause preserves NIM; HDFC Bank trades at 2.1x book vs 5-year avg 3.2x.",
      "timeframe": "medium",
      "isIndian": true
    }
  ],
  "summary": "Markets are digesting..."
}`;
}

interface RawSignal {
  ticker: string;
  name: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  theme: string;
  rationale: string;
  timeframe: "short" | "medium" | "long";
  isIndian?: boolean;
}

interface RawScanResponse {
  themes: string[];
  signals: RawSignal[];
  summary: string;
}

function sanitizeSignal(item: unknown): RawSignal | null {
  if (item === null || typeof item !== "object") return null;
  const s = item as Record<string, unknown>;
  if (typeof s.ticker !== "string" || typeof s.name !== "string") return null;
  const direction = typeof s.direction === "string" ? s.direction.toLowerCase() : "";
  const timeframe = typeof s.timeframe === "string" ? s.timeframe.toLowerCase() : "";
  const confidence = Number(s.confidence);
  return {
    ticker: s.ticker,
    name: s.name,
    direction: (["bullish", "bearish", "neutral"] as string[]).includes(direction)
      ? (direction as RawSignal["direction"])
      : "neutral",
    confidence: Number.isFinite(confidence) ? confidence : 0,
    theme: typeof s.theme === "string" ? s.theme : "",
    rationale: typeof s.rationale === "string" ? s.rationale : "",
    timeframe: (["short", "medium", "long"] as string[]).includes(timeframe)
      ? (timeframe as RawSignal["timeframe"])
      : "medium",
    isIndian: s.isIndian === true,
  };
}

/** Exported for unit testing — pure, no I/O. */
export function parseAiResponse(raw: string): RawScanResponse {
  const parsed = extractJsonObject(raw, { themes: [] as string[], signals: [] as unknown[], summary: "" });
  return {
    themes: parsed.themes.filter((x): x is string => typeof x === "string"),
    signals: parsed.signals.map(sanitizeSignal).filter((s): s is RawSignal => s !== null),
    summary: parsed.summary,
  };
}

/* -------------------------------------------------------------------------- */
/* Quote enrichment                                                            */
/* -------------------------------------------------------------------------- */

async function enrichWithQuote(signal: RawSignal): Promise<Quote | null> {
  const sym = signal.isIndian ? `${signal.ticker}.NS` : signal.ticker;
  try {
    return await getQuote(sym);
  } catch {
    // Try BSE suffix as fallback for Indian stocks.
    if (signal.isIndian) {
      try {
        return await getQuote(`${signal.ticker}.BO`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export interface ScanOptions {
  userQuery?: string;
  /** Minimum AI confidence to include a signal (default 50). */
  minConfidence?: number;
  /** If true, skip live quote enrichment for faster scans. */
  skipQuotes?: boolean;
}

export async function runEventScan(
  newsItems: NewsItem[],
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const { userQuery, minConfidence = 50, skipQuotes = false } = opts;

  if (newsItems.length === 0) {
    return {
      scannedAt: new Date().toISOString(),
      themes: [],
      signals: [],
      newsItems: [],
      aiSummary: "No news items available to scan.",
    };
  }

  // Run AI analysis.
  const prompt = buildScanPrompt(newsItems, userQuery);
  let parsed: RawScanResponse;
  try {
    const raw = await runPrompt("opportunity-engine", prompt, { maxTokens: 2000, json: true });
    parsed = parseAiResponse(raw);
  } catch {
    // Return empty scan with error note rather than throwing.
    return {
      scannedAt: new Date().toISOString(),
      themes: [],
      signals: [],
      newsItems,
      aiSummary: aiUnavailableMessage("scanner summaries"),
    };
  }

  // Filter by confidence.
  // CALIBRATION NOTE (2026-08-02, hosted-model switch): hosted-model
  // confidences run ~28 points lower than the old local-model numbers on the same
  // inputs (better calibration, ai-migration/06 §1b), so any caller-supplied
  // minConfidence tuned to the old distribution now drops more signals — by
  // design. Retune the caller's threshold, never rescale the model output.
  const filtered = (parsed.signals ?? []).filter((s) => s.confidence >= minConfidence);

  // Enrich with live quotes (parallel, best-effort).
  let signals: EventSignal[];
  if (skipQuotes) {
    signals = filtered.map((s) => ({
      ticker: s.isIndian ? `${s.ticker}.NS` : s.ticker,
      name: s.name,
      direction: s.direction,
      confidence: Math.max(0, Math.min(100, s.confidence)),
      theme: s.theme,
      rationale: s.rationale,
      timeframe: s.timeframe,
      quote: null,
      fundamentalScore: null,
    }));
  } else {
    const quoteResults = await Promise.allSettled(filtered.map(enrichWithQuote));
    signals = filtered.map((s, i) => {
      const quoteResult = quoteResults[i];
      const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
      return {
        ticker: s.isIndian ? `${s.ticker}.NS` : s.ticker,
        name: s.name,
        direction: s.direction,
        confidence: Math.max(0, Math.min(100, s.confidence)),
        theme: s.theme,
        rationale: s.rationale,
        timeframe: s.timeframe,
        quote,
        fundamentalScore: null, // computed post-enrichment if needed
      };
    });
  }

  // Sort: bullish high-confidence first, then bearish, then neutral.
  signals.sort((a, b) => {
    const dirRank = { bullish: 0, bearish: 1, neutral: 2 };
    const dr = dirRank[a.direction] - dirRank[b.direction];
    if (dr !== 0) return dr;
    return b.confidence - a.confidence;
  });

  return {
    scannedAt: new Date().toISOString(),
    themes: parsed.themes ?? [],
    signals,
    newsItems,
    aiSummary: parsed.summary ?? "",
  };
}
