/**
 * Simulator intake — resolving what the quick form could not settle.
 *
 * ## What changed, and why
 *
 * This module used to drive the whole conversation: given the five quick-form
 * answers, the AI asked "the SINGLE next most valuable follow-up" from a list of
 * twelve suggested topics, three to six times over. That design put a small model
 * in charge of discovering facts that were knowable in advance, and it failed the
 * way you would expect:
 *
 *   - It asked an OPEN-ENDED question ("what is your preferred approach to asset
 *     allocation — a globally diversified 60/40 split, or a preference for
 *     regional or sector-specific tilts?"), which the user skipped rather than
 *     compose an answer to.
 *   - Each turn cost 25-195 seconds of local inference, and `estimatedRemaining`
 *     was measured returning `3` on every turn regardless of history — so the
 *     "Question 1 of ~2" the user saw was never a plan.
 *   - Its topic list was almost entirely things every investor can answer up
 *     front, so most of that latency bought information a form could have had for
 *     free.
 *
 * The standard topics are now fixed multiple-choice questions in the quick form
 * (./preferences.ts). What is left for this module is the genuinely conditional
 * residue: contradictions BETWEEN answers, which cannot be asked before the
 * answers exist.
 *
 * ## The order of resolution
 *
 * 1. `profileGaps` — deterministic contradiction checks, in code. Question text
 *    and options are written by us, cost nothing, and cannot hallucinate. A
 *    coherent profile produces none, so the common case is zero questions and
 *    zero waiting.
 * 2. The AI — consulted only once the deterministic gaps are exhausted, and told
 *    exactly what is already known so it cannot re-ask it. It must return
 *    CHOICES, not an open question, for the same reason the form does.
 *
 * The AI still gets the last word on "is this enough to design against", because
 * that judgement genuinely is a judgement. It just no longer gets to conduct the
 * interview.
 */

import { OBJECTIVES } from "@/lib/portfolio/engines/optimize";
import { extractJson } from "@/lib/json-extract";
import { describePreferences, profileGaps } from "./preferences";
import type { SimProfile } from "./types";

/** Hard ceiling on follow-ups. The AI is told to aim for 0-2; this is the
 * guard for a model that never says done, not the target. */
export const MAX_FOLLOW_UPS = 8;

/**
 * How long one interview turn may take.
 *
 * Previously unbounded, which is how a turn came to take 195 seconds behind a
 * pulsing "Deciding what to ask next" with no clock — long enough that pressing
 * "Finish now, use defaults" was the rational move. Generation already bounds its
 * calls at 300s; an interview turn is one short question and has no business
 * taking longer than this. Past the bound the interview ends with the stated
 * defaults, which is a worse answer than a real one and a far better one than an
 * indefinite wait.
 */
export const INTAKE_TIMEOUT_MS = 60_000;

/** How many options a multiple-choice follow-up must offer, and may at most. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export interface IntakeQuestion {
  done: false;
  question: string;
  /**
   * Concrete choices. Empty only when a model ignored the contract — the UI then
   * falls back to free text rather than presenting an unanswerable question.
   */
  options: string[];
  /** Concrete default the profile falls back to if the user skips. */
  assumptionIfSkipped: string;
  /** Questions still expected after this one, for "N of ~M". */
  estimatedRemaining: number;
  /** Whether this came from a deterministic gap check or from the model. */
  source: "gap" | "ai";
}

export interface IntakeDone {
  done: true;
}

export type IntakeStep = IntakeQuestion | IntakeDone;

/** True when the interview must end regardless of what the AI wants. */
export function intakeAtCap(profile: SimProfile): boolean {
  return profile.followUps.length >= MAX_FOLLOW_UPS;
}

const HORIZON_LABEL = { short: "short (< 2 years)", medium: "medium (2-7 years)", long: "long (7+ years)" } as const;

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The next deterministic contradiction, or null when there are none left.
 *
 * Gaps already put to the user are filtered out by question text, the same way
 * repeated AI questions are: a gap the user skipped has an assumption recorded
 * against it and is settled, not outstanding.
 */
export function nextGap(profile: SimProfile): IntakeQuestion | null {
  const asked = new Set(profile.followUps.map((f) => normalizeQuestion(f.question)));
  const gaps = profileGaps({
    objective: profile.objective,
    riskAppetite: profile.riskAppetite,
    horizon: profile.horizon,
    preferences: profile.preferences,
  }).filter((g) => !asked.has(normalizeQuestion(g.question)));

  const gap = gaps[0];
  if (!gap) return null;
  return {
    done: false,
    question: gap.question,
    options: gap.options,
    assumptionIfSkipped: gap.assumptionIfSkipped,
    // Known exactly, not estimated: these are counted, not guessed.
    estimatedRemaining: gaps.length - 1,
    source: "gap",
  };
}

export function buildIntakePrompt(profile: SimProfile): string {
  const objective = OBJECTIVES[profile.objective];
  const facts = [
    `Investable cash: ${profile.cash.toLocaleString("en-US")} ${profile.currency}`,
    `Time horizon: ${HORIZON_LABEL[profile.horizon]}${profile.targetDate ? `, target date ${profile.targetDate}` : ""}`,
    `Primary objective: ${objective.label} — ${objective.description}`,
    `Risk appetite: ${profile.riskAppetite}/10 (max acceptable drawdown ~${profile.maxDrawdownPct}%)`,
    profile.role === "complement"
      ? `This portfolio must COMPLEMENT an existing ${profile.complementRef?.kind === "real" ? "real portfolio" : "saved simulation"} (diversify against it, not duplicate it)`
      : "This is a standalone portfolio",
  ];

  const history =
    profile.followUps.length === 0
      ? "None."
      : profile.followUps
          .map((f, i) =>
            f.answer !== null
              ? `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`
              : `${i + 1}. Q: ${f.question}\n   A: (skipped — assume: ${f.assumption ?? "a sensible default"})`,
          )
          .join("\n");

  return `You are an investment advisor checking whether a client intake is complete enough to design a portfolio against.

MANDATE
${facts.map((f) => `- ${f}`).join("\n")}

ALREADY ASKED AND SETTLED — the client answered all of these in a structured form. Every one of these topics is CLOSED. Asking about any of them again, in any wording, is the single worst thing you can do here:
${describePreferences(profile.preferences)}

Additional questions already put to this client:
${history}

Your job: decide whether anything genuinely material is still unknown, and if so ask ONE multiple-choice question about it.

The bar is high, and "done" is the expected answer. Everything in the two blocks above is settled. A defensible portfolio does not require knowing the client's life story — it requires an amount, a horizon, an objective, a risk tolerance, and the constraints listed above, all of which you now have. Ask something only if a SPECIFIC, MATERIAL gap or contradiction remains that would change the actual instrument selection.

Do NOT ask about: anything in the settled block; the client's age, dependants, job, or personal circumstances; anything answerable by "it depends"; anything whose answer would not change which instruments you pick.

Rules for a question, if you ask one:
- MULTIPLE CHOICE. Provide ${MIN_OPTIONS}-${MAX_OPTIONS} concrete, mutually distinct options written in plain language, each a complete answer a client could pick as-is. Never ask an open-ended question — the client will skip it rather than compose prose, and a skipped question is a guessed portfolio.
- ONE topic per question. No compound multi-part questions.
- Plain language, one sentence.
- State the concrete default you will assume if the client skips it.

Respond with JSON only, exactly one of these two shapes:
{"done": true}
{"done": false, "question": "<one plain-language question>", "options": ["<option 1>", "<option 2>", "<option 3>"], "assumptionIfSkipped": "<concrete default>", "estimatedRemaining": <integer 0-2, questions you expect AFTER this one>}`;
}

/**
 * Validate one AI turn. Throws on unparseable/contract-breaking output (the
 * caller surfaces "try again"); returns `{done: true}` for the model
 * pathologies that shouldn't crash the interview — repeating a question it
 * already asked is treated as "nothing genuinely new to ask".
 */
export function parseIntakeResponse(raw: string, profile: SimProfile): IntakeStep {
  const parsed = extractJson<{
    done?: unknown;
    question?: unknown;
    options?: unknown;
    assumptionIfSkipped?: unknown;
    estimatedRemaining?: unknown;
  }>(raw);

  if (parsed.done === true) return { done: true };

  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
  if (!question) throw new Error("AI response contained neither done:true nor a question");
  if (question.length > 400) throw new Error("AI question exceeded the 400-character contract");

  // A repeated question means the model is looping, not that a gap remains.
  const asked = new Set(profile.followUps.map((f) => normalizeQuestion(f.question)));
  if (asked.has(normalizeQuestion(question))) return { done: true };

  const assumption =
    typeof parsed.assumptionIfSkipped === "string" && parsed.assumptionIfSkipped.trim()
      ? parsed.assumptionIfSkipped.trim()
      : "A sensible middle-of-the-road default for this mandate";

  const est = Number(parsed.estimatedRemaining);
  const estimatedRemaining = Number.isFinite(est) ? Math.min(5, Math.max(0, Math.round(est))) : 1;

  return {
    done: false,
    question,
    options: cleanOptions(parsed.options),
    assumptionIfSkipped: assumption,
    estimatedRemaining,
    source: "ai",
  };
}

/**
 * Coerce the model's options into a usable choice list.
 *
 * A short list is not a contract breach worth failing the turn over — one option
 * plus "Other" and "Skip" is still answerable, and the UI degrades to free text
 * when this comes back empty. Duplicates are dropped case-insensitively because a
 * choice list with the same answer twice reads as a rendering bug.
 */
export function cleanOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o !== "string") continue;
    const text = o.trim().replace(/\s+/g, " ");
    if (!text || text.length > 200) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}
