/**
 * The sectioned investment report — one generation, streamed as complete sections.
 *
 * ## Why it is built this way
 *
 * The obvious design is to generate each section with its own prompt, so they
 * can be produced and streamed independently. I built that first and measured
 * it, and it is the wrong design *for this platform*:
 *
 *   - Local Ollama **serializes** requests (measured: three concurrent
 *     generations take as long as three sequential ones — 1.13x, not 3x). So
 *     nine independent section generations cost ~9x one generation.
 *   - In practice that turned a ~40s report into a 138s report, with the first
 *     section arriving at 32s — barely better than just waiting for the whole
 *     monolithic verdict.
 *
 * Streaming is only permitted to improve *perceived* responsiveness. Making the
 * report 3.4x slower in total to shave a few seconds off the first paint is a
 * straight downgrade, so that design was discarded.
 *
 * What this does instead: **one generation — the exact prompt, context, and
 * schema the non-streamed verdict uses — parsed incrementally, with each
 * top-level JSON field emitted as a finished section the moment it closes**
 * (see lib/ai/streaming-json.ts).
 *
 * The properties that buys:
 *   - The final report is not merely *equivalent* to the non-streamed one, it is
 *     **the same object** — same single generation, same prompt, same context,
 *     same model. Verified in tests/streaming-json.test.ts.
 *   - Total generation time is **unchanged**. No extra inference is paid.
 *   - Time-to-first-section drops from the full generation (~40s) to the moment
 *     the headline closes (~4s).
 *   - Complete sections only. Never a token, never a half-written sentence — a
 *     field is emitted only once its string/array/object is syntactically closed.
 *   - "High-value first" is enforced by the schema order in the prompt below:
 *     the model writes headline → thesis → catalysts → risks → … , so that is
 *     the order they stream in.
 */

import { buildEquityFacts, buildPortfolioFacts, hasPortfolioContext, type PortfolioFacts } from "./facts";
import type { DatasetId } from "../platform/types";
import type { CompanyContext } from "./types";

export type ReportSectionId =
  | "headline"
  | "thesis"
  | "catalysts"
  | "risks"
  | "keyMetrics"
  | "confidence"
  | "timeHorizon"
  | "verdict";

export interface ReportSectionSpec {
  /** The top-level JSON key the model emits. */
  id: ReportSectionId;
  title: string;
  /** Emission order — mirrors the schema order in the prompt. */
  order: number;
  /**
   * Datasets whose change makes this section's conclusion potentially wrong.
   * Drives selective regeneration: a price tick moves the verdict and the key
   * metrics; it does not move the catalysts.
   */
  invalidatedBy: DatasetId[];
}

/**
 * The report's sections, in the order the model produces them — which is the
 * order they stream to the user. High-value first: a portfolio manager can act
 * on the headline and thesis long before the key metrics table has been written.
 */
export const REPORT_SECTIONS: ReportSectionSpec[] = [
  { id: "headline", title: "Investment Summary", order: 1, invalidatedBy: ["fundamentals", "statements", "filings"] },
  { id: "thesis", title: "Investment Thesis", order: 2, invalidatedBy: ["fundamentals", "statements", "filings"] },
  { id: "catalysts", title: "Catalysts", order: 3, invalidatedBy: ["fundamentals", "news", "filings"] },
  { id: "risks", title: "Key Risks", order: 4, invalidatedBy: ["fundamentals", "statements", "filings"] },
  { id: "confidence", title: "Confidence", order: 5, invalidatedBy: ["fundamentals", "statements"] },
  { id: "timeHorizon", title: "Time Horizon", order: 6, invalidatedBy: ["fundamentals"] },
  { id: "keyMetrics", title: "Key Metrics", order: 7, invalidatedBy: ["quote", "fundamentals", "statements"] },
  { id: "verdict", title: "Investment Verdict", order: 8, invalidatedBy: ["quote", "fundamentals", "statements", "filings"] },
];

const BY_ID = new Map(REPORT_SECTIONS.map((s) => [s.id, s]));

export function sectionFor(key: string): ReportSectionSpec | undefined {
  return BY_ID.get(key as ReportSectionId);
}

export function sectionsInOrder(): ReportSectionSpec[] {
  return [...REPORT_SECTIONS].sort((a, b) => a.order - b.order);
}

/**
 * Which sections a dataset change invalidates.
 *
 * Makes regeneration surgical rather than wholesale: after a price tick,
 * `sectionsInvalidatedBy("quote")` returns keyMetrics and verdict — the thesis,
 * catalysts, and risks are left exactly as they are, because nothing about them
 * changed.
 */
export function sectionsInvalidatedBy(dataset: DatasetId): ReportSectionId[] {
  return REPORT_SECTIONS.filter((s) => s.invalidatedBy.includes(dataset)).map((s) => s.id);
}

/**
 * THE prompt — used by BOTH the streamed report and the non-streamed
 * `/api/ai/verdict`.
 *
 * It lives here, in one place, precisely so the two paths cannot drift. If the
 * streamed report used its own prompt, "the streamed report is identical to the
 * non-streamed one" would be a claim nobody could actually keep.
 *
 * The key order below is the streaming order. Do not reorder it without
 * understanding that you are also reordering what the user sees first.
 */
export function buildVerdictPrompt(
  ctx: CompanyContext,
  portfolio: PortfolioFacts | null,
): { prompt: string; evidence: string } {
  const facts = buildEquityFacts(ctx);
  const portfolioFacts = buildPortfolioFacts(ctx.symbol, portfolio);
  const hasPortfolioCtx = hasPortfolioContext(portfolio);
  const suggestedPct = portfolio?.suggestedPct ?? null;

  const portfolioInstructions = hasPortfolioCtx
    ? `
PORTFOLIO PERSONALIZATION (mandatory):
- The headline MUST be personalized: reference this user's portfolio context (e.g., "fills your missing [sector] gap", "adds to existing position", "low correlation with your tech-heavy portfolio")
- The thesis MUST include 1 sentence about how this fits or doesn't fit this user's specific portfolio
- If it fills a missing sector, call that out explicitly
- Recommend position sizing consistent with the IOS-suggested allocation of ${suggestedPct ?? "N/A"}%
- If already held: frame as "add to position" vs "initiate new position"`
    : "";

  const prompt = `You are an institutional buy-side equity analyst. Based ONLY on the data below, generate a structured investment verdict.

DATA:
${facts.join("\n")}
${portfolioFacts.length > 0 ? "\n" + portfolioFacts.join("\n") : ""}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON. Emit the keys in exactly this order:
{
  "headline": "Decisive 10-14 word investment thesis naming the company and the core reason",
  "thesis": "2-3 sentences: the investment case with specific metrics cited from the data",
  "catalysts": ["specific catalyst citing a number or fact", "catalyst 2", "catalyst 3"],
  "risks": ["specific risk citing a number or fact", "risk 2", "risk 3"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "keyMetrics": [
    {"label": "metric name", "value": "formatted value", "signal": "positive" or "negative" or "neutral"}
  ],
  "verdict": "bullish" or "bearish" or "neutral"
}

REQUIREMENTS:
- verdict: bullish if score>65 AND no high risks overwhelming thesis; bearish if score<40 OR multiple compounding high risks; neutral otherwise
- headline: NO generic phrases like "shows potential" — make a real investment call${hasPortfolioCtx ? " — MUST reference portfolio fit" : ""}
- catalysts + risks: MUST cite specific numbers from the data. Generic bullets will be rejected.
- keyMetrics: exactly 5, covering valuation + quality + growth + momentum + analyst
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data${portfolioInstructions}`;

  return {
    prompt,
    evidence: [facts.join("\n"), portfolioFacts.join("\n")].join("\n"),
  };
}
