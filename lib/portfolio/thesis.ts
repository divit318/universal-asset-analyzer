/**
 * Portfolio Thesis + Identity — the one-paragraph AI summary and the persistent
 * identity tags shown at the top of the Portfolio page.
 *
 * Regenerates automatically whenever the portfolio actually CHANGES — not on
 * every page load and not on every intraday price tick. The cache key is a
 * content hash of (asset class, symbol, weight rounded to the nearest whole
 * percent) for every holding, so adding, removing or meaningfully resizing a
 * position invalidates it, while today's quote wiggling the weight by 0.2pp
 * does not burn a redundant Ollama call. Uses the same `scanner_cache` table
 * every other cached AI output in this app uses (lib/timeline.ts,
 * lib/movement-explainer.ts, lib/ai-financial-insight.ts) — no new cache.
 *
 * Reuses the "portfolio-intelligence" task type verbatim: it is already
 * declared as "portfolio brief + new-position suggestions (JSON)", and a
 * thesis + identity tags is exactly that shape of output, just a different
 * consumer. No new task type, no new model policy.
 */

import { runPrompt } from "@/lib/ai";
import { extractJsonObject } from "@/lib/json-extract";
import { getScannerCache, putScannerCache } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL } from "./model/types";
import type { PortfolioEvaluation } from "./engines/simulate";
import type { ReturnAttribution } from "./engines/attribution";
import type { ChangeOutcome } from "./history";
import { AI_NARRATIVE_UNAVAILABLE, AI_RECOVERY_HINT } from "../ai/availability";

/**
 * ── What this asks the model for, and why it changed ──────────────────────────
 *
 * The original prompt asked for "one paragraph: the portfolio's style, strengths,
 * weaknesses and dominant theme". On a real book it produced ninety words that
 * restated figures already on the screen — 8.3% VOO, 13.5% cash, health 75 — in
 * prose. That is a summary, not an analysis, and it fails the only test that
 * matters for an AI feature in a tool like this: it did not tell the user anything
 * the deterministic engines had not already told them, better and with citations.
 *
 * So the model is now asked for the three things the engines genuinely CANNOT
 * produce, and given the evidence to do it with:
 *
 *   • THE BEAR CASE. Engines detect threshold breaches one at a time. They cannot
 *     assemble several unremarkable facts into one coherent argument for why this
 *     portfolio is worse than it looks — which is exactly what a skeptical CIO does
 *     in a review, and the most valuable thing anyone can hear about their own book.
 *
 *   • HIDDEN RISK. A concentration warning fires on a weight. It cannot notice that
 *     three holdings which look diversified by sector are one macro trade — a gold
 *     miner, a second gold miner and a gold ETF are 3 sectors and 1 driver. Given
 *     the correlation pairs and factor loadings, a language model can.
 *
 *   • WHAT WOULD HAVE TO BE TRUE. Falsifiability. A thesis nobody can be wrong
 *     about is not a thesis, and naming the condition converts a vague feeling of
 *     conviction into something the user can actually monitor.
 *
 * The prompt is also given the health engine's WEAKEST dimensions with their own
 * explanations, the return attribution, and the outcome of the user's last change —
 * none of which the previous prompt could see. Most of the quality gain is from the
 * grounding, not from the wording.
 *
 * Where the model would have to invent something (a price target, a macro forecast)
 * it is told to stay silent, and every field degrades to a deterministic fallback.
 */
export interface PortfolioThesis {
  /** Two sentences: what this portfolio actually IS. */
  thesis: string;
  identity: string[];
  /** Specific, each tied to a figure from the portfolio. */
  strengths: string[];
  risks: string[];
  /**
   * The strongest honest argument AGAINST this portfolio. Empty when the model had
   * nothing non-generic to say — an empty bear case is better than a fabricated one.
   */
  bearCase: string;
  /** The condition that has to hold for this portfolio to work. */
  mustBeTrue: string;
  generatedAt: string;
  /** Whether this came from the AI or the deterministic fallback (Ollama offline). */
  source: "ai" | "fallback";
}

/** Deterministic djb2 hash — a cache key, not a security primitive. */
function hashOf(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function contentHash(evaluation: PortfolioEvaluation): string {
  const parts = evaluation.holdings
    .map((h) => `${h.assetClass}:${h.symbol ?? h.name}:${Math.round(h.weight)}`)
    .sort();
  return `portfolio-thesis:${hashOf(parts.join("|"))}`;
}

/** Grounded, honest summary used when Ollama is unavailable or returns nothing usable. */
export function fallbackThesis(evaluation: PortfolioEvaluation): string {
  const { allocation, risk, health, totalValue } = evaluation;
  const top = allocation.byAssetClass.slices[0];
  const topLabel = top ? PORTFOLIO_CLASS_LABEL[top.key as keyof typeof PORTFOLIO_CLASS_LABEL] ?? top.label : "no single class";
  const concentrationNote = risk.topAssetClassWeight > 50
    ? `concentrated in ${topLabel.toLowerCase()} (${risk.topAssetClassWeight.toFixed(0)}% of value)`
    : `spread across ${allocation.byAssetClass.slices.length} asset classes with no single one dominating`;
  return `A ${formatCurrency(totalValue)} portfolio ${concentrationNote}. Health scores ${health.total}/100 (${health.grade}). ` +
    `${AI_NARRATIVE_UNAVAILABLE} ${AI_RECOVERY_HINT}`;
}

export function fallbackIdentity(evaluation: PortfolioEvaluation): string[] {
  const { risk, allocation } = evaluation;
  const tags: string[] = [];
  if (risk.topAssetClassWeight > 60) tags.push("Concentrated");
  else if (allocation.byAssetClass.slices.length >= 5) tags.push("Diversified");
  if (risk.beta != null && risk.beta > 1.1) tags.push("Aggressive Growth");
  else if (risk.beta != null && risk.beta < 0.8) tags.push("Defensive");
  const usPct = allocation.byGeography.slices.find((s) => /united states|usa|us/i.test(s.label))?.weight ?? 0;
  if (usPct > 80) tags.push("US-Centric");
  if (risk.illiquidPct > 15) tags.push("Illiquid-Heavy");
  return tags.length > 0 ? tags.slice(0, 5) : ["Balanced"];
}

/* ─────────────────── Ground truth: one figure, one direction ────────────────
 *
 * The ESTABLISHED CONCLUSIONS block below started as five sentences with no
 * stated direction, and the model used one of them twice — in opposite
 * directions, in the same card:
 *
 *   Working: "The 3 biggest movers accounted for 49% of all movement …
 *             suggesting diversification across multiple positions."
 *   Watch:   "… the top 3 movers accounted for nearly half of the total
 *             movement, suggesting that the portfolio's performance is still
 *             heavily influenced by a small number of positions."
 *
 * One measured figure, presented as reassuring in the left column and alarming
 * in the right. Both readings are defensible for a middle-band 49% — which is
 * exactly the problem: an unassigned figure is an invitation to spin, and a card
 * that argues with itself is worth less than either half alone.
 *
 * So direction is no longer left to the model. Each verdict is tagged in code
 * with the section it belongs to, `neutral` meaning "cite this in NEITHER
 * column on its own". The tag is both an instruction in the prompt and the key
 * the deterministic guard (`resolveSectionConflicts`) uses afterwards, because a
 * 7B model follows a rule most of the time and the card has to be right all of
 * it.
 */

/** Which column a measured figure legitimately belongs in. */
export type VerdictDirection = "strength" | "risk" | "neutral";

/**
 * The subject a claim is about. Matching on subject rather than on digits is
 * load-bearing: the contradictory pair above shared no number at all — one said
 * "49%" and the other said "nearly half".
 */
export type VerdictTopic = "inflation" | "breadth" | "concentration" | "liquidity" | "cash";

export interface GroundTruthVerdict {
  topic: VerdictTopic;
  direction: VerdictDirection;
  text: string;
}

const SECTION_TAG: Record<VerdictDirection, string> = {
  strength: "STRENGTH — may support a strength, never a risk",
  risk: "RISK — may support a risk, never a strength",
  neutral: "NEUTRAL — neither a strength nor a risk on its own; do not spin it either way",
};

/** Phrasings that identify what a sentence is ABOUT, independent of wording. */
const TOPIC_PATTERNS: Record<VerdictTopic, RegExp> = {
  inflation: /inflation/i,
  breadth:
    /biggest movers|top ?-?\s?(3|three) (movers|positions|holdings|contributors)|of (all|the total) movement|effective drivers|return (is )?(narrowly|broadly) sourced|return breadth|breadth of (the )?return|return distribution/i,
  concentration: /concentrat|largest (single )?(holding|position|asset class)|single position/i,
  liquidity: /illiquid|liquidity|cannot be sold|sold (quickly|within days)/i,
  cash: /\bcash\b|dry powder/i,
};

/**
 * The engine's own verdicts, each with the direction already decided.
 *
 * Exported so the guard and its tests reason over the same list the prompt is
 * built from — a second copy of these bands would be a second source of truth
 * for the one thing this block exists to make single.
 */
export function groundTruthVerdicts(
  evaluation: PortfolioEvaluation,
  extra: ThesisContext,
): GroundTruthVerdict[] {
  const { allocation, risk } = evaluation;
  const cashWeight = allocation.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0;

  const inflation: GroundTruthVerdict =
    risk.inflationSensitivity == null
      ? { topic: "inflation", direction: "neutral", text: "Inflation exposure could not be measured." }
      : risk.inflationSensitivity < -0.5
        ? {
            topic: "inflation",
            direction: "risk",
            text: `POORLY protected against inflation: a +1pp inflation surprise costs about ${Math.abs(risk.inflationSensitivity).toFixed(1)}% of value. Cash and nominal bonds are the CAUSE of this, never the cure.`,
          }
        : risk.inflationSensitivity > 0.5
          ? {
              topic: "inflation",
              direction: "strength",
              text: `WELL protected against inflation (+${risk.inflationSensitivity.toFixed(1)}% per 1pp surprise) via real assets.`,
            }
          : { topic: "inflation", direction: "neutral", text: "Roughly inflation-neutral in the short term." };

  const breadth: GroundTruthVerdict = !extra.attribution
    ? { topic: "breadth", direction: "neutral", text: "Return breadth could not be measured." }
    : extra.attribution.top3SharePct >= 70
      ? {
          topic: "breadth",
          direction: "risk",
          text: `The return is NARROWLY sourced: the 3 biggest movers produced ${extra.attribution.top3SharePct.toFixed(0)}% of all movement (${extra.attribution.effectiveDrivers.toFixed(1)} effective drivers — LOW means narrow).`,
        }
      : extra.attribution.top3SharePct <= 40
        ? {
            topic: "breadth",
            direction: "strength",
            text: `The return is BROADLY sourced: the 3 biggest movers produced only ${extra.attribution.top3SharePct.toFixed(0)}% of all movement (${extra.attribution.effectiveDrivers.toFixed(1)} effective drivers — HIGH means broad, so this is a strength, not a concentration risk).`,
          }
        : {
            topic: "breadth",
            direction: "neutral",
            // Spelled out because the middle band is where the contradiction
            // happened: 49% is genuinely unremarkable, and "unremarkable" is a
            // conclusion the model has to be handed, not one it will reach.
            text: `The return is MODERATELY BROAD: the 3 biggest movers produced ${extra.attribution.top3SharePct.toFixed(0)}% of all movement (${extra.attribution.effectiveDrivers.toFixed(1)} effective drivers — HIGHER means broader). This is an ordinary, middle-of-the-range result: it is NOT evidence of good diversification and NOT evidence of dependence on a few positions. Do not offer it as either.`,
          };

  const concentration: GroundTruthVerdict =
    risk.concentrationRisk === "high"
      ? {
          topic: "concentration",
          direction: "risk",
          text: `Position concentration is HIGH (largest holding ${risk.topHoldingWeight.toFixed(1)}%, largest class ${risk.topAssetClassWeight.toFixed(0)}%).`,
        }
      : risk.concentrationRisk === "medium"
        ? {
            topic: "concentration",
            direction: "neutral",
            text: `Position concentration is MODERATE (largest holding ${risk.topHoldingWeight.toFixed(1)}%, largest class ${risk.topAssetClassWeight.toFixed(0)}%) — unremarkable in either direction.`,
          }
        : {
            topic: "concentration",
            direction: "strength",
            text: `Position concentration is LOW at the individual-holding level (largest holding only ${risk.topHoldingWeight.toFixed(1)}%), though the largest ASSET CLASS is ${risk.topAssetClassWeight.toFixed(0)}% — these are different things.`,
          };

  const liquidity: GroundTruthVerdict =
    risk.illiquidPct >= 30
      ? {
          topic: "liquidity",
          direction: "risk",
          text: `${risk.illiquidPct.toFixed(0)}% of the portfolio cannot be sold quickly — a genuine constraint.`,
        }
      : {
          topic: "liquidity",
          direction: "strength",
          text: `Liquidity is not a constraint: only ${risk.illiquidPct.toFixed(0)}% cannot be sold within days.`,
        };

  // Cash is a risk at both extremes and a non-event in between: 30% uninvested
  // is a drag, 0.5% leaves no room to act, and 8% is simply a cash balance.
  const cash: GroundTruthVerdict = {
    topic: "cash",
    direction: cashWeight > 25 || cashWeight < 1 ? "risk" : "neutral",
    text:
      `Cash is ${cashWeight.toFixed(1)}% of the portfolio. Cash reduces volatility and provides dry powder; it does NOT protect against inflation and earns no equity return.` +
      (cashWeight > 25
        ? " At this weight it is a material drag on expected return."
        : cashWeight < 1
          ? " At this weight there is no buffer left to act on an opportunity or a drawdown."
          : ""),
  };

  return [inflation, breadth, concentration, liquidity, cash];
}

/** Every ground-truth topic a sentence talks about. */
function topicsIn(text: string): VerdictTopic[] {
  return (Object.keys(TOPIC_PATTERNS) as VerdictTopic[]).filter((t) => TOPIC_PATTERNS[t].test(text));
}

/**
 * The deterministic half of the one-figure-one-direction rule: when Working and
 * Watch both talk about the same measured subject, one of them is dropped.
 *
 * A subject mentioned in only one column is left alone — the rule is about
 * contradiction, not about vocabulary. Which side survives a clash is decided by
 * the engine, never by which bullet the model happened to emit first:
 *
 *   - the engine called it a STRENGTH → the risk bullet is the wrong one
 *   - the engine called it a RISK     → the strength bullet is the wrong one
 *   - the engine called it NEUTRAL    → the STRENGTH bullet goes, because a
 *     neutral figure sold as reassurance is the more damaging of the two errors,
 *     and a card one bullet shorter is better than a card that flatters.
 *
 * `bearCase` and `mustBeTrue` are deliberately not policed: both are explicitly
 * arguments AGAINST the portfolio or conditions on it, so they never form the
 * reassuring half of a contradiction.
 */
export function resolveSectionConflicts(
  strengths: string[],
  risks: string[],
  verdicts: GroundTruthVerdict[],
): { strengths: string[]; risks: string[] } {
  const direction = new Map(verdicts.map((v) => [v.topic, v.direction]));
  const riskTopics = new Set(risks.flatMap(topicsIn));
  const contested = new Set(strengths.flatMap(topicsIn).filter((t) => riskTopics.has(t)));
  if (contested.size === 0) return { strengths, risks };

  const clashes = (text: string, losingSides: VerdictDirection[]) =>
    topicsIn(text).some(
      (t) => contested.has(t) && losingSides.includes(direction.get(t) ?? "neutral"),
    );

  return {
    // A strength loses the subject unless the engine actually called it one.
    strengths: strengths.filter((s) => !clashes(s, ["risk", "neutral"])),
    // A risk only loses it when the engine called the subject a strength.
    risks: risks.filter((r) => !clashes(r, ["strength"])),
  };
}

function buildPrompt(evaluation: PortfolioEvaluation, extra: ThesisContext): string {
  const { holdings, allocation, risk, health, totalValue } = evaluation;
  const top = [...holdings].sort((a, b) => b.weight - a.weight).slice(0, 10);
  const holdingLines = top
    .map(
      (h) =>
        `${h.symbol ?? h.name} (${PORTFOLIO_CLASS_LABEL[h.assetClass]}, ${h.attributes.sector ?? "no sector"}): ` +
        `${h.weight.toFixed(1)}%${h.unrealizedPct != null ? `, ${h.unrealizedPct >= 0 ? "+" : ""}${h.unrealizedPct.toFixed(1)}% on cost` : ""}`,
    )
    .join("\n");
  const classLines = allocation.byAssetClass.slices
    .map((s) => `${s.label}: ${s.weight.toFixed(1)}%`)
    .join(", ");

  // The health engine's own weakest dimensions, WITH its explanations. The previous
  // prompt saw only the total, so it could never discuss why the score was what it
  // was — it had to guess, and a guess about the user's own score is worse than
  // silence.
  const weakest = health.dimensions
    .filter((d) => d.score != null)
    .sort((a, b) => a.score! - b.score!)
    .slice(0, 4)
    .map((d) => `${d.name}: ${d.score}/100 — ${d.explanation}`)
    .join("\n");

  // Correlation pairs and factor loadings are what make a HIDDEN concentration
  // findable: three holdings in three sectors can still be one trade.
  const pairs = risk.correlation?.highPairs
    .slice(0, 6)
    .map((p) => `${p.a}/${p.b} r=${p.r.toFixed(2)}`)
    .join(", ");
  const factors = allocation.byFactor
    .filter((f) => Math.abs(f.exposure) >= 0.05)
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure))
    .slice(0, 5)
    .map((f) => `${f.label} ${f.exposure > 0 ? "+" : ""}${f.exposure.toFixed(2)}`)
    .join(", ");

  const attributionLines = extra.attribution
    ? `Return so far: ${extra.attribution.totalReturnPct >= 0 ? "+" : ""}${extra.attribution.totalReturnPct.toFixed(2)}%. ` +
      `The 3 biggest movers produced ${extra.attribution.top3SharePct.toFixed(0)}% of all movement ` +
      `(${extra.attribution.effectiveDrivers.toFixed(1)} effective drivers); ${extra.attribution.winners} up, ${extra.attribution.losers} down.\n` +
      // Labelled unambiguously, and each side told not to be described as the
      // other. With the neutral headings "Carrying:" and "Dragging:" the model
      // placed ORLA — the single largest POSITIVE contributor at +0.13pp — into its
      // risks list as a position that "dragged on returns", and invented a figure
      // for it. Naming the direction inside the heading removes the inference.
      `POSITIONS THAT ADDED TO RETURN — these HELPED, never describe them as detractors: ` +
      `${extra.attribution.carrying.slice(0, 4).map((c) => `${c.symbol ?? c.name} +${c.contributionPct.toFixed(2)}pp`).join(", ") || "none"}\n` +
      `POSITIONS THAT SUBTRACTED FROM RETURN — these HURT: ` +
      `${extra.attribution.dragging.slice(0, 4).map((c) => `${c.symbol ?? c.name} ${c.contributionPct.toFixed(2)}pp`).join(", ") || "none"}\n` +
      `Do not cite a contribution figure for any position not listed on one of those two lines.`
    : "Return attribution unavailable (no cost basis recorded).";

  const trajectoryLine = extra.lastChange
    ? `The investor's most recent executed change moved health ${extra.lastChange.healthBefore} -> ${extra.lastChange.healthAfter} ` +
      `and the largest asset class ${extra.lastChange.concentrationBefore.toFixed(1)}% -> ${extra.lastChange.concentrationAfter.toFixed(1)}%.`
    : "No executed changes recorded yet.";

  /**
   * The engine's own verdicts, written out as sentences the model is told to reuse
   * rather than re-derive.
   *
   * This block exists because of what a 7B local model actually did with the richer
   * prompt. Given the numbers and asked for judgement, it produced three claims that
   * contradicted the deterministic panels rendered inches away:
   *
   *   • "USD Cash is fully hedged against inflation" — cash is the single worst
   *     inflation hedge, and the health engine had scored Inflation Protection
   *     32/100 for exactly that reason.
   *   • "a small number of holdings ... account for 11.3 effective drivers" — 11.3
   *     effective drivers is the definition of a BROAD result; the attribution panel
   *     directly above said "Moderately broad".
   *   • "large-cap ETFs like VCLT" — VCLT is a long-term corporate bond fund, and
   *     the prompt had already labelled it "(Bonds)".
   *
   * A model that contradicts the measurements beside it is worse than a bland one:
   * it destroys the credibility of the numbers too. The fix is not a better
   * adjective in the instructions — it is removing the model's need to interpret at
   * all. Directional judgements are computed here, in code, and handed over as
   * settled facts. The model's remaining job is the one it is actually good at:
   * noticing that several settled facts combine into something.
   */
  const groundTruth = groundTruthVerdicts(evaluation, extra)
    .map((v) => `- [${SECTION_TAG[v.direction]}] ${v.text}`)
    .join("\n");

  return `You are a skeptical Chief Investment Officer reviewing a self-directed investor's portfolio. You are not writing marketing copy and you are not summarising the data back to them — they can already see every number below. Your job is to say the things the numbers do not say on their own.

RULES — these exist because breaking them produces output that CONTRADICTS the measured panels displayed next to yours, which is worse than saying nothing:

1. Never restate what a metric MEANS or which direction is good. The verdicts are given to you under ESTABLISHED CONCLUSIONS. Use them as written. Do not re-derive them.
2. Never describe an asset class other than the one given for that holding. Each holding's class is stated in parentheses; a bond fund is a bond fund even if its ticker looks like an equity ETF.
3. Every claim must cite a specific holding, weight, correlation or figure from below. If you lack the evidence, omit the claim.
4. Never invent a price target, an earnings estimate, or a macro forecast. Never mention a security that is not listed below.
5. Combine facts; do not reinterpret them. Your value is in noticing that two or three of the facts below add up to something — not in re-characterising any one of them.
6. ONE FIGURE, ONE DIRECTION. Every conclusion below is tagged with the section it may appear in. A figure tagged RISK may never be offered as a strength; a figure tagged STRENGTH may never be offered as a risk; a figure tagged NEUTRAL belongs in NEITHER — it is an ordinary reading, not a finding. "strengths" and "risks" are read side by side in one card, so the same number appearing in both, framed in opposite directions, reads as the tool contradicting itself.
7. Each of strengths, risks, bearCase and mustBeTrue must rest on a DIFFERENT observation. Three sections and one honest omission beat four sections that are one observation in four tones. If you have only two real strengths, give two.

ESTABLISHED CONCLUSIONS (already computed and displayed to the user — restate, never contradict; the tag on each line is the ONLY section it may support)
${groundTruth}

PORTFOLIO
Total value: ${formatCurrency(totalValue)}
Health: ${health.total}/100 (${health.grade})
Annualized volatility: ${risk.annualizedVolatility != null ? risk.annualizedVolatility.toFixed(1) + "%" : "not measurable"}
Beta vs S&P 500: ${risk.beta != null ? risk.beta.toFixed(2) : "not measurable"}
Largest asset class: ${risk.topAssetClassWeight.toFixed(0)}% · largest single holding: ${risk.topHoldingWeight.toFixed(1)}%
Illiquid share: ${risk.illiquidPct.toFixed(1)}% · foreign currency: ${risk.foreignCurrencyPct.toFixed(0)}%

ASSET CLASSES
${classLines}

TOP HOLDINGS (weight, own return)
${holdingLines}

WEAKEST HEALTH DIMENSIONS
${weakest || "none scored"}

MACRO FACTOR EXPOSURE (portfolio % move per unit shock)
${factors || "none material"}

MOST CORRELATED HOLDING PAIRS
${pairs || "none above r=0.75"}

RETURN ATTRIBUTION
${attributionLines}

RECENT ACTIVITY
${trajectoryLine}

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "thesis": "Two sentences. What this portfolio IS — the strategy actually being expressed by these weights, not the one the investor may believe they hold.",
  "identity": ["2-5 short tags justified by the numbers above, e.g. 'Concentrated', 'US-Centric', 'Gold-Levered'"],
  "strengths": ["2-3 specific strengths. Each must cite a number or holding. Not 'well diversified' — say what is diversified and to what degree."],
  "risks": ["2-3 risks that are NOT already obvious from a single number on the screen. Prefer a risk that only appears when two or three facts are combined — e.g. several holdings in different sectors that share one macro driver, or a return that depends on very few positions."],
  "bearCase": "The single strongest honest argument that this portfolio is worse than it looks. Be concrete and name holdings. If the portfolio is genuinely sound and you have no substantive bear case, return an empty string rather than manufacturing one.",
  "mustBeTrue": "One sentence: the specific condition that must hold for this portfolio to perform as constructed — the assumption the investor is implicitly making and should monitor."
}`;
}

/** Keep only non-empty strings, trimmed, capped — the model returns arrays loosely. */
function cleanList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Deterministic strengths and risks, derived from the health engine's own
 * dimensions.
 *
 * The fallback must still be USEFUL, not an apology. Health already knows which
 * dimensions are strong and weak and has written a sentence about each, so an
 * Ollama outage degrades the thesis from "judgement" to "the measured facts,
 * ranked" rather than to nothing.
 */
function fallbackStrengthsAndRisks(evaluation: PortfolioEvaluation): { strengths: string[]; risks: string[] } {
  const scored = evaluation.health.dimensions.filter((d) => d.score != null);
  const byScore = [...scored].sort((a, b) => b.score! - a.score!);
  return {
    strengths: byScore.slice(0, 2).map((d) => `${d.name} (${d.score}/100). ${d.explanation}`),
    risks: byScore
      .slice(-2)
      .reverse()
      .map((d) => `${d.name} (${d.score}/100). ${d.explanation}`),
  };
}

/**
 * Extra evidence the thesis reasons over. Optional so the route can pass what it
 * has; the prompt degrades a section at a time rather than all at once.
 */
export interface ThesisContext {
  attribution?: ReturnAttribution | null;
  lastChange?: ChangeOutcome | null;
}

export async function buildPortfolioThesis(
  evaluation: PortfolioEvaluation,
  extra: ThesisContext = {},
): Promise<PortfolioThesis> {
  const empty = {
    identity: [] as string[],
    strengths: [] as string[],
    risks: [] as string[],
    bearCase: "",
    mustBeTrue: "",
    generatedAt: new Date().toISOString(),
  };

  if (evaluation.holdings.length === 0) {
    return { ...empty, thesis: "No holdings yet — add a position to generate a thesis.", source: "fallback" };
  }

  // The version prefix invalidates on any change to what a cached entry MEANS,
  // not just to its shape. v2 was the move from a single paragraph to five fields
  // — without it, old entries replayed as a thesis with no strengths, no risks
  // and no bear case, indistinguishable from a model that had nothing to say. v3
  // is the one-figure-one-direction rule: an entry generated before it can hold
  // exactly the self-contradicting Working/Watch pair the rule exists to stop, and
  // the cache key is content-hashed on holdings, so an unchanged portfolio would
  // otherwise keep serving the contradiction indefinitely.
  const cacheKey = `v3:${contentHash(evaluation)}`;
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as PortfolioThesis;
    } catch {
      // fall through and regenerate — a corrupted cache entry is not fatal
    }
  }

  const fb = fallbackStrengthsAndRisks(evaluation);
  const fallback: PortfolioThesis = {
    ...empty,
    thesis: fallbackThesis(evaluation),
    identity: fallbackIdentity(evaluation),
    strengths: fb.strengths,
    risks: fb.risks,
    source: "fallback",
  };

  let result: PortfolioThesis;
  try {
    // maxTokens raised from 500: the response now carries five fields rather than
    // two, and truncating it mid-JSON would fail the parse and silently fall back.
    const raw = await runPrompt("portfolio-intelligence", buildPrompt(evaluation, extra), {
      json: true,
      maxTokens: 900,
    });
    const parsed = extractJsonObject(raw, {
      thesis: "",
      identity: [] as unknown,
      strengths: [] as unknown,
      risks: [] as unknown,
      bearCase: "",
      mustBeTrue: "",
    });

    const thesis = cleanString(parsed.thesis);
    if (!thesis) {
      result = fallback;
    } else {
      const identity = cleanList(parsed.identity, 5);
      // Prompt rule 6 is enforced here as well as asked for there. A model that
      // reads 49%-of-movement as diversification in Working AND as dependence on
      // a few positions in Watch has produced a card that argues with itself, and
      // the fix cannot be only an instruction a 7B model is free to miss.
      const { strengths, risks } = resolveSectionConflicts(
        cleanList(parsed.strengths, 3),
        cleanList(parsed.risks, 3),
        groundTruthVerdicts(evaluation, extra),
      );
      result = {
        thesis,
        identity: identity.length > 0 ? identity : fallbackIdentity(evaluation),
        // Per-field fallback: a model that produced a good thesis but dropped the
        // strengths array should not lose the whole response.
        strengths: strengths.length > 0 ? strengths : fb.strengths,
        risks: risks.length > 0 ? risks : fb.risks,
        // Deliberately NOT back-filled. The prompt explicitly permits an empty bear
        // case, and substituting a generic one here would defeat the instruction —
        // "no substantive bear case" is a real and useful answer.
        bearCase: cleanString(parsed.bearCase),
        mustBeTrue: cleanString(parsed.mustBeTrue),
        generatedAt: new Date().toISOString(),
        source: "ai",
      };
    }
  } catch {
    result = fallback;
  }

  // Only cache a real AI result — caching the fallback would keep serving
  // "AI unavailable" for the TTL window even after Ollama comes back up.
  if (result.source === "ai") putScannerCache(cacheKey, JSON.stringify(result));
  return result;
}
