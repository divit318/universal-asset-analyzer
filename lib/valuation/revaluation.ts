/**
 * Re-running a case against what the company actually reported.
 *
 * This is the loop that makes the whole architecture worth having. Because a case
 * is a persisted, versioned object rather than a form in a tab, it can be checked
 * against reality: when new figures land, the *facts* the case rests on move while
 * the user's *judgments* stay put, and the difference is a verdict on the case.
 *
 * The rule that makes it trustworthy is the same one AI obeys: a locked
 * assumption is never overwritten. If the user typed their own starting FCF, a
 * new filing does not silently replace it — it is reported as a disagreement
 * instead. Facts the user has not claimed are refreshed, because leaving a case
 * anchored on two-year-old cash flow is not "respecting" anything.
 *
 * Pure: no fetch, no database.
 */

import {
  ASSUMPTION_LABEL,
  computeCaseResult,
  diffAssumptions,
  type AssumptionChange,
  type AssumptionKey,
  type AssumptionSet,
  type CaseResult,
  type ValuationCase,
} from "./case";
import type { DeliveredGrowth } from "./prefill";

/** Facts as most recently reported. Shaped from `ValuationFacts`. */
export interface ReportedFacts {
  baseFcf: number | null;
  sharesOutstanding: number | null;
  netDebt: number | null;
  price: number | null;
  delivered: DeliveredGrowth;
}

/**
 * How badly reality has diverged from the case.
 *
 * `broken` is deliberately reserved for the two things that change a decision: a
 * margin of safety that has gone negative, or a fair value that has fallen far
 * enough that the thesis is a different thesis. Everything else is `watch` — a
 * valuation that moves 5% on a quarter is a valuation working normally, and
 * crying wolf on it would train the user to ignore the signal.
 */
export type CaseSeverity = "intact" | "watch" | "broken";

/** Facts get refreshed; judgments never do. */
const FACT_KEYS: readonly AssumptionKey[] = ["baseFcf", "sharesOutstanding", "netDebt"];

const BROKEN_DROP = 0.2;
const WATCH_DROP = 0.1;
const WATCH_GROWTH_GAP_PP = 2;

export interface RevaluationOutcome {
  symbol: string;
  /** True when at least one unclaimed fact moved, i.e. a new version is warranted. */
  changed: boolean;
  /** The case as it stood. */
  before: CaseResult;
  /** The case after refreshing unclaimed facts against the reported figures. */
  after: CaseResult;
  /** Which facts moved, and by how much. */
  factChanges: AssumptionChange[];
  /** Facts the report contradicts but the user owns, so they were left alone. */
  contradictedByReport: AssumptionKey[];
  /** The growth this case assumes for years 1–5. */
  assumedGrowth: number;
  /** What the company has now actually delivered. */
  delivered: DeliveredGrowth;
  /**
   * Assumed minus delivered, in percentage points. Positive means the case is
   * more optimistic than the record — the direction calibration cares about.
   */
  growthGap: number | null;
  /** Fractional change in fair value, e.g. -0.21 for a 21% fall. */
  fairValueChange: number | null;
  /** True when a positive margin of safety has gone negative. */
  marginFlipped: boolean;
  severity: CaseSeverity;
  /** One sentence, written to be read in a notification. */
  headline: string;
  /** The refreshed assumptions, ready to persist when `changed`. */
  assumptions: AssumptionSet;
}

function refreshFacts(
  set: AssumptionSet,
  facts: ReportedFacts,
  now: string,
): { assumptions: AssumptionSet; contradicted: AssumptionKey[] } {
  const next: AssumptionSet = { ...set };
  const contradicted: AssumptionKey[] = [];

  const reported: Partial<Record<AssumptionKey, number | null>> = {
    baseFcf: facts.baseFcf,
    sharesOutstanding: facts.sharesOutstanding,
    netDebt: facts.netDebt,
  };

  for (const key of FACT_KEYS) {
    const value = reported[key];
    if (value == null || !Number.isFinite(value)) continue;
    // A share count of zero is bad data, not news: writing it would make the
    // case unvaluable on the strength of a feed glitch. Free cash flow and net
    // debt are unconstrained — negative values are real and meaningful there.
    if (key === "sharesOutstanding" && value <= 0) continue;
    const prior = next[key];
    if (prior.value === value) continue;

    if (prior.locked) {
      // The user set this themselves. Record that the report disagrees; do not
      // overwrite it.
      contradicted.push(key);
      continue;
    }
    next[key] = {
      ...prior,
      value,
      source: "yahoo",
      rationale: `Refreshed from the latest reported figures (was ${prior.value.toPrecision(4)}).`,
      critique: null,
      updatedAt: now,
    };
  }

  return { assumptions: next, contradicted };
}

function severityOf(
  fairValueChange: number | null,
  marginFlipped: boolean,
  growthGap: number | null,
  nowUnvaluable: boolean,
): CaseSeverity {
  if (nowUnvaluable) return "broken";
  if (marginFlipped) return "broken";
  if (fairValueChange != null && fairValueChange <= -BROKEN_DROP) return "broken";
  if (fairValueChange != null && fairValueChange <= -WATCH_DROP) return "watch";
  if (growthGap != null && growthGap >= WATCH_GROWTH_GAP_PP) return "watch";
  return "intact";
}

function buildHeadline(o: Omit<RevaluationOutcome, "headline">, currency: string): string {
  const money = (v: number | null) => (v == null ? "—" : `${currency}${v.toFixed(2)}`);
  const parts: string[] = [];

  if (o.severity === "broken") parts.push(`${o.symbol} — your case is broken.`);
  else if (o.severity === "watch") parts.push(`${o.symbol} — your case has weakened.`);
  else parts.push(`${o.symbol} — your case still holds.`);

  if (o.growthGap != null && o.delivered.value != null && o.growthGap >= 0.5) {
    parts.push(
      `You assume ${o.assumedGrowth.toFixed(1)}% growth; the record now shows ${o.delivered.value.toFixed(1)}% (${o.delivered.label}).`,
    );
  }

  if (o.fairValueChange != null && Math.abs(o.fairValueChange) >= 0.01) {
    parts.push(
      `Fair value ${money(o.before.fairValue)} → ${money(o.after.fairValue)}.`,
    );
  }

  if (o.marginFlipped) {
    parts.push("Your margin of safety is now negative.");
  } else if (o.after.marginOfSafety != null) {
    parts.push(`Margin of safety ${o.after.marginOfSafety >= 0 ? "+" : ""}${o.after.marginOfSafety.toFixed(1)}%.`);
  }

  if (o.contradictedByReport.length > 0) {
    parts.push(
      `The report disagrees with your own ${o.contradictedByReport.map((k) => ASSUMPTION_LABEL[k].toLowerCase()).join(" and ")}, which was left untouched.`,
    );
  }

  return parts.join(" ");
}

/**
 * Re-run a case against reported figures.
 *
 * Never mutates the case. Returns the refreshed assumption set so the caller
 * decides whether to persist — and it should only persist when `changed`, because
 * an event that records nothing changing is noise in an audit trail.
 */
export function revalueCase(
  vcase: ValuationCase,
  facts: ReportedFacts,
  now: string = new Date().toISOString(),
): RevaluationOutcome {
  const price = facts.price ?? vcase.priceAt;
  const { assumptions, contradicted } = refreshFacts(vcase.assumptions, facts, now);
  const factChanges = diffAssumptions(vcase.assumptions, assumptions);

  // Both sides are priced at the same price, so the comparison isolates the
  // effect of the new figures rather than mixing in whatever the market did.
  const before = computeCaseResult(vcase.assumptions, price);
  const after = computeCaseResult(assumptions, price);

  const assumedGrowth = assumptions.growthRate1.value;
  const growthGap = facts.delivered.value != null ? assumedGrowth - facts.delivered.value : null;

  const fairValueChange =
    before.fairValue != null && before.fairValue !== 0 && after.fairValue != null
      ? (after.fairValue - before.fairValue) / Math.abs(before.fairValue)
      : null;

  const marginFlipped =
    before.marginOfSafety != null && before.marginOfSafety >= 0 &&
    after.marginOfSafety != null && after.marginOfSafety < 0;

  const nowUnvaluable = before.invalidReason === null && after.invalidReason !== null;

  const partial: Omit<RevaluationOutcome, "headline"> = {
    symbol: vcase.symbol,
    changed: factChanges.length > 0,
    before,
    after,
    factChanges,
    contradictedByReport: contradicted,
    assumedGrowth,
    delivered: facts.delivered,
    growthGap,
    fairValueChange,
    marginFlipped,
    severity: severityOf(fairValueChange, marginFlipped, growthGap, nowUnvaluable),
    assumptions,
  };

  return { ...partial, headline: buildHeadline(partial, vcase.currency === "INR" ? "₹" : "$") };
}
