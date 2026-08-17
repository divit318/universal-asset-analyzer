/**
 * The sectioned investment report — one generation, streamed as complete sections.
 *
 * ## Why it is built this way
 *
 * The obvious design is to generate each section with its own prompt, so they
 * can be produced and streamed independently. I built that first and measured
 * it, and it is the wrong design *for this platform*:
 *
 *   - The then-local backend **serialized** requests (measured: three
 *     concurrent generations took as long as three sequential ones — 1.13x,
 *     not 3x). So nine independent section generations cost ~9x one.
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
import { buildResearchBrief, briefFactLines } from "./tension";
import { scoreDirection } from "../recommendation";
import type { DatasetId } from "../platform/types";
import type { CompanyContext } from "./types";

export type ReportSectionId =
  | "headline"
  | "tension"
  | "thesis"
  | "catalysts"
  | "risks"
  | "triggers"
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
/**
 * `tension` and `triggers` are new (2026-08-12) and `keyMetrics` is no longer
 * requested from the EQUITY prompt — it asked the model to re-emit five numbers
 * that the page already renders as cards directly above the verdict, which is
 * the single clearest instance of "restates what I can already see". It stays
 * in the list because the five non-equity plans (fund/crypto/commodity/forex/
 * macro in lib/ai/verdict.ts) still ask for it and have no such card strip.
 *
 * A section a given asset class does not emit simply never streams: the route
 * looks each key up with `sectionFor` and skips unknown ones, and the replay
 * path skips keys absent from the stored verdict. So this list is a superset,
 * not a contract that every class must satisfy.
 */
export const REPORT_SECTIONS: ReportSectionSpec[] = [
  { id: "headline", title: "Investment Summary", order: 1, invalidatedBy: ["fundamentals", "statements", "filings"] },
  { id: "tension", title: "The Central Tension", order: 2, invalidatedBy: ["fundamentals", "statements", "filings"] },
  { id: "thesis", title: "Investment Thesis", order: 3, invalidatedBy: ["fundamentals", "statements", "filings"] },
  { id: "catalysts", title: "What Supports It", order: 4, invalidatedBy: ["fundamentals", "news", "filings"] },
  { id: "risks", title: "What Worries Me", order: 5, invalidatedBy: ["fundamentals", "statements", "filings"] },
  { id: "triggers", title: "What Changes The Verdict", order: 6, invalidatedBy: ["fundamentals", "statements"] },
  { id: "confidence", title: "Confidence", order: 7, invalidatedBy: ["fundamentals", "statements"] },
  { id: "timeHorizon", title: "Time Horizon", order: 8, invalidatedBy: ["fundamentals"] },
  { id: "keyMetrics", title: "Key Metrics", order: 9, invalidatedBy: ["quote", "fundamentals", "statements"] },
  { id: "verdict", title: "Investment Verdict", order: 10, invalidatedBy: ["quote", "fundamentals", "statements", "filings"] },
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

  // The verdict direction is settled in code (lib/ai/verdict.ts overrides the
  // parsed field from the composite score) — the prompt states the conclusion
  // so the narration argues FOR it instead of contradicting it.
  const verdictRequirement = ctx.score
    ? `- verdict: MUST be exactly "${scoreDirection(ctx.score.composite)}" — it is computed from the composite score of ${ctx.score.composite}/100 and is not yours to change`
    : `- verdict: bullish, bearish, or neutral — justify it strictly from the data above`;

  // The unified action (Research Score × Portfolio Fit, lib/ios/unified-action.ts)
  // is settled by the deterministic engines before the model is asked to write.
  // Stating it as a hard requirement is what makes the narration, the fit panel,
  // and the position action card structurally incapable of disagreeing.
  const unifiedAction = portfolio?.action ?? null;
  const actionRequirement = unifiedAction
    ? `
- Your recommended course of action MUST be exactly "${unifiedAction.toUpperCase()}"${suggestedPct ? ` at ${suggestedPct}% of the portfolio` : ""} — it is computed from the research score and the portfolio fit together and is not yours to change. Argue FOR it; never suggest a different action or allocation.`
    : "";

  const portfolioInstructions = hasPortfolioCtx
    ? `
PORTFOLIO PERSONALIZATION (mandatory):
- The headline MUST be personalized: reference this user's portfolio context (e.g., "fills your missing [sector] gap", "adds to existing position", "low correlation with your tech-heavy portfolio")
- The thesis MUST include 1 sentence about how this fits or doesn't fit this user's specific portfolio
- If it fills a missing sector, call that out explicitly
- Recommend position sizing consistent with the IOS-suggested allocation of ${suggestedPct ?? "N/A"}%
- If already held: frame as "add to position" vs "initiate new position"${actionRequirement}`
    : "";

  // The deterministic brief (lib/ai/tension.ts) — the conflicts, multi-year
  // trends and verdict triggers, all computed before the model runs. Handing
  // the model ANALYSIS instead of only a metric list is what turns the output
  // from restatement into synthesis; see that module's header for the
  // reasoning and the evidence behind it.
  const brief = buildResearchBrief(ctx);
  const briefLines = briefFactLines(brief, ctx.score ?? null);

  const prompt = `You are an institutional buy-side equity analyst writing the one paragraph a portfolio manager will read before deciding. Base everything ONLY on the data below.

DATA:
${facts.join("\n")}
${portfolioFacts.length > 0 ? "\n" + portfolioFacts.join("\n") : ""}

${briefLines.join("\n")}

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON. Emit the keys in exactly this order:
{
  "headline": "Decisive 10-14 word investment call naming the company and the core reason",
  "tension": "ONE sentence naming the single most important conflict in the evidence, or — if the signals agree — saying plainly that they agree and on what",
  "thesis": "2-3 sentences resolving that tension: why this verdict follows from the evidence, and what the decisive question is",
  "catalysts": ["strongest supporting evidence, citing a number", "second"],
  "risks": ["strongest opposing evidence, citing a number", "second"],
  "triggers": ["a measurable event that would change the verdict", "second"],
  "confidence": "high" or "medium" or "low",
  "timeHorizon": "short-term" or "medium-term" or "long-term",
  "verdict": "bullish" or "bearish" or "neutral"
}

REQUIREMENTS:
${verdictRequirement}
- Every score, subscore, or percentage you mention MUST be copied verbatim from the DATA or DETERMINISTIC ANALYSIS blocks above. Do not compute, derive, round differently, or invent any figure — including ones that look easy to work out, like distance from a 52-week high.
- tension: this is the most valuable line you write. Name the actual disagreement from THE CENTRAL DISAGREEMENTS above and say which side the verdict lands on. Never "there are both risks and opportunities".
- thesis: 2-3 sentences, MAXIMUM 65 words. A portfolio manager must grasp the case in 15 seconds. Do NOT list metrics that appear elsewhere on the page — the user can already see the score breakdown, the P/E and the analyst split. Explain what they MEAN together.
- catalysts + risks: exactly 2 each, the STRONGEST only. Prioritization is the point; a list of five is a list of none.
- triggers: exactly 2, measurable and checkable against a future filing or print. Prefer the computed VERDICT TRIGGERS above. Never vague ("execution improves") — always a number or an event.
- Do NOT restate the score breakdown as a list. It is rendered directly above your text.
- confidence: high = comprehensive data + clear signal; medium = some gaps or mixed signals; low = limited data${portfolioInstructions}`;

  return {
    prompt,
    // The brief joins the evidence block so the grounding checker treats the
    // figures IT computed (trend deltas, gaps) as supported. Without this,
    // every correctly-cited trend figure would be flagged as unverifiable.
    evidence: [facts.join("\n"), portfolioFacts.join("\n"), briefLines.join("\n")].join("\n"),
  };
}
