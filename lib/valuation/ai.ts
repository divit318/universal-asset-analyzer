/**
 * The one AI path that touches valuation numbers.
 *
 * AI proposes *structured assumptions* — value, rationale, and nothing else —
 * which flow into the ValuationCase through `applyAiProposals`. It never emits a
 * fair value: the fair value is whatever the case's assumptions imply when run
 * through lib/valuation/dcf.ts. That inversion is the point. Before this, the IC
 * report's valuation stage narrated eight independent price targets that nothing
 * could check, persist, or correct.
 *
 * The second rule is asymmetry. For an assumption the user has locked, AI may
 * only object — it returns a critique, never a replacement. That is enforced
 * twice: here, by routing locked keys away from `proposals`, and again in
 * `applyAiProposals`, which cannot overwrite a locked value even if asked. An AI
 * that keeps offering numbers trains the user to stop thinking.
 */

import { runPrompt } from "../ai";
import { extractJsonObject } from "../json-extract";
import {
  ASSUMPTION_KEYS,
  ASSUMPTION_LABEL,
  RATE_ASSUMPTIONS,
  isAssumptionKey,
  type AiAssumptionProposal,
  type AssumptionKey,
  type AssumptionSet,
} from "./case";

/* -------------------------------------------------------------------------- */
/* Plausibility bounds                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A proposal outside these bounds is discarded rather than clamped.
 *
 * Clamping would silently turn an implausible suggestion into a plausible-looking
 * one with an AI rationale attached, which is worse than having no suggestion:
 * the user would see a confident number whose stated reasoning no longer matches
 * its value. Facts (base FCF, shares) are bounded only by sign, because their
 * scale is company-specific.
 */
const BOUNDS: Record<AssumptionKey, { min: number; max: number }> = {
  baseFcf: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  growthRate1: { min: -50, max: 100 },
  growthRate2: { min: -50, max: 100 },
  terminalGrowth: { min: 0, max: 6 },
  discountRate: { min: 3, max: 25 },
  sharesOutstanding: { min: 1, max: Number.MAX_SAFE_INTEGER },
  netDebt: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
};

function withinBounds(key: AssumptionKey, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const b = BOUNDS[key];
  return value >= b.min && value <= b.max;
}

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export interface AssumptionCritique {
  key: AssumptionKey;
  critique: string;
}

export interface AssumptionRefinement {
  /** Values for assumptions the user has not claimed. */
  proposals: AiAssumptionProposal[];
  /** Objections to assumptions the user owns. Never accompanied by a value. */
  critiques: AssumptionCritique[];
  /** Where AI agrees with the case overall, and where it does not. */
  assessment: string;
  /** Assumptions AI considers least supported by evidence, weakest first. */
  weakest: AssumptionKey[];
}

export const EMPTY_REFINEMENT: AssumptionRefinement = {
  proposals: [],
  critiques: [],
  assessment: "",
  weakest: [],
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Turn a model response into a refinement, discarding anything unusable.
 *
 * `lockedKeys` is what makes the asymmetry structural: a locked key's suggestion
 * is demoted to a critique here, before it can reach the case. Pure and exported
 * so the routing rules are unit-testable without a model.
 */
export function parseAssumptionRefinement(
  raw: string,
  lockedKeys: ReadonlySet<AssumptionKey>,
): AssumptionRefinement {
  const parsed = extractJsonObject(raw, {
    assumptions: [] as unknown[],
    assessment: "",
    weakest: [] as unknown[],
  });

  const proposals: AiAssumptionProposal[] = [];
  const critiques: AssumptionCritique[] = [];
  const seen = new Set<AssumptionKey>();

  for (const item of parsed.assumptions) {
    if (item == null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!isAssumptionKey(row.key)) continue;
    const key = row.key;
    if (seen.has(key)) continue; // first mention wins; ignore contradictions
    seen.add(key);

    const rationale = typeof row.rationale === "string" ? row.rationale.trim() : "";
    const objection = typeof row.critique === "string" ? row.critique.trim() : "";

    if (lockedKeys.has(key)) {
      // The user owns this. Keep only the objection, and never the value.
      const text = objection || rationale;
      if (text) critiques.push({ key, critique: text });
      continue;
    }

    // Models do emit numbers as strings, so coerce from those — but only from
    // those. A blanket `Number(x)` turns null into 0, which for a growth rate is
    // a silent, plausible-looking assumption the model never actually made.
    const rawValue = row.value;
    let value: number;
    if (typeof rawValue === "number") value = rawValue;
    else if (typeof rawValue === "string" && rawValue.trim() !== "") value = Number(rawValue);
    else continue;

    if (!withinBounds(key, value)) continue;
    if (!rationale) continue; // a number with no reasoning is not worth storing
    proposals.push({ key, value, rationale, critique: objection || null });
  }

  const weakest = parsed.weakest
    .filter(isAssumptionKey)
    .filter((k, i, arr) => arr.indexOf(k) === i);

  return {
    proposals,
    critiques,
    assessment: typeof parsed.assessment === "string" ? parsed.assessment.trim() : "",
    weakest,
  };
}

/* -------------------------------------------------------------------------- */
/* Prompt                                                                      */
/* -------------------------------------------------------------------------- */

export interface EnginePrior {
  /** Monte Carlo intrinsic value percentiles, per share. */
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** The WACC the engine discounted at. */
  wacc: number | null;
}

export interface RefineInput {
  symbol: string;
  companyName: string;
  currency: string;
  assumptions: AssumptionSet;
  price: number | null;
  /**
   * Growth that would justify today's price, percent — conditional on the case's
   * own WACC and terminal growth, not a market observation.
   */
  impliedGrowth: number | null;
  /** Growth the business delivered, percent, and over what window. */
  deliveredGrowth: number | null;
  deliveredWindow: string;
  /** Free-form supporting facts (margins, leverage, peers) already gathered. */
  evidence?: string | null;
  enginePrior?: EnginePrior | null;
  model?: string;
}

function formatValue(key: AssumptionKey, value: number, currency: string): string {
  if (RATE_ASSUMPTIONS.has(key)) return `${value.toFixed(1)}%`;
  if (key === "sharesOutstanding") return value.toExponential(3);
  return `${currency} ${value.toExponential(3)}`;
}

/** The current case, rendered so the model can only react to it. */
function renderCase(input: RefineInput): string {
  const lines = ASSUMPTION_KEYS.map((key) => {
    const a = input.assumptions[key];
    const anchors = Object.entries(a.anchors)
      .map(([label, v]) => `${label}=${typeof v === "number" ? v.toFixed(1) : v}`)
      .join(", ");
    return [
      `- ${key} (${ASSUMPTION_LABEL[key]}): ${formatValue(key, a.value, input.currency)}`,
      `source=${a.source}`,
      a.locked ? "OWNED BY USER" : "unclaimed",
      a.rationale ? `reason="${a.rationale}"` : null,
      anchors ? `anchors: ${anchors}` : null,
    ].filter(Boolean).join(" · ");
  });
  return lines.join("\n");
}

function buildPrompt(input: RefineInput): string {
  const locked = ASSUMPTION_KEYS.filter((k) => input.assumptions[k].locked);
  const unlocked = ASSUMPTION_KEYS.filter((k) => !input.assumptions[k].locked);

  const marketLine = input.impliedGrowth != null
    ? `Given this case's discount rate and terminal growth, today's price would be justified by ${input.impliedGrowth.toFixed(1)}% FCF growth over Y1–5. That figure is conditional on those assumptions — it is not a market forecast.`
    : "Market-implied growth could not be solved for this symbol.";
  const deliveredLine = input.deliveredGrowth != null
    ? `The business delivered ${input.deliveredGrowth.toFixed(1)}% (${input.deliveredWindow}).`
    : "No growth history is available.";
  const engineLine = input.enginePrior?.p50 != null
    ? `An independent 50,000-path Monte Carlo DCF puts intrinsic value at ${input.currency} ${input.enginePrior.p50.toFixed(2)} per share (p10 ${input.enginePrior.p10?.toFixed(2) ?? "n/a"}, p90 ${input.enginePrior.p90?.toFixed(2) ?? "n/a"}), discounting at ${input.enginePrior.wacc != null ? (input.enginePrior.wacc * 100).toFixed(1) + "%" : "n/a"}. Treat it as a systematic prior, not a target.`
    : "";

  return `You are a valuation analyst reviewing an existing valuation case for ${input.companyName} (${input.symbol}).

You do NOT produce a fair value or a price target. The fair value is whatever this case's assumptions imply once discounted. Your job is to make the assumptions better, and to say plainly where you disagree.

CURRENT CASE
${renderCase(input)}

CONTEXT
Price: ${input.price != null ? `${input.currency} ${input.price.toFixed(2)}` : "unknown"}
${marketLine}
${deliveredLine}
${engineLine}
${input.evidence ? `\nEVIDENCE\n${input.evidence}` : ""}

RULES
1. Assumptions marked OWNED BY USER are the user's judgment. You must NOT propose a value for them. For those, write a "critique" only — a specific, evidence-backed objection, or omit the key entirely if you agree.${locked.length > 0 ? ` Owned right now: ${locked.join(", ")}.` : ""}
2. For unclaimed assumptions you may propose a value, and every value needs a rationale citing the data above.${unlocked.length > 0 ? ` Unclaimed: ${unlocked.join(", ")}.` : ""}
3. Only include a key if you would actually change it or object to it. Silence means agreement.
4. Rates are percentages (8.1 means 8.1%). Terminal growth must stay below the discount rate.
5. Ground every claim in the numbers above. Do not invent data.

Return ONLY raw JSON:
{
  "assumptions": [
    { "key": "growthRate1", "value": 7.4, "rationale": "why, citing the data", "critique": "" },
    { "key": "discountRate", "critique": "objection to a user-owned value, with evidence" }
  ],
  "assessment": "2-3 sentences: where you agree with this case and where you do not, referencing actual numbers.",
  "weakest": ["key of the least-supported assumption", "next"]
}`;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ask AI to refine a case. Never throws: a failed refinement returns an empty
 * one, because AI being unavailable must not stop the user valuing a company.
 */
export async function refineAssumptions(input: RefineInput): Promise<AssumptionRefinement> {
  const locked = new Set(ASSUMPTION_KEYS.filter((k) => input.assumptions[k].locked));
  try {
    const raw = await runPrompt("scenario-analysis", buildPrompt(input), {
      maxTokens: 1200,
      json: true,
      model: input.model,
    });
    return parseAssumptionRefinement(raw, locked);
  } catch {
    return EMPTY_REFINEMENT;
  }
}
