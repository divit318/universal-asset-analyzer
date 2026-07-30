/**
 * How well-calibrated the user's own growth assumptions are.
 *
 * The Decision Journal already grades *decisions* — did the call make money.
 * This grades the *reasoning underneath them*: across every case where the user
 * personally set a growth rate, how far has that rate sat from what the business
 * went on to deliver, and in which direction. Deliberately a separate, pure
 * module that the Journal can render alongside `computeTrackRecord` rather than a
 * second track-record engine, because the two answer different questions and
 * merging them would blur both.
 *
 * Only user-authored assumptions count. Grading a seeded or AI-authored number
 * would tell the user nothing about their own judgment, which is the entire point.
 *
 * Pure: no fetch, no database.
 */

import {
  ASSUMPTION_LABEL,
  type AssumptionKey,
  type AssumptionSet,
  type ValuationCase,
} from "./case";
import type { DeliveredGrowth } from "./prefill";

/** The rates worth grading. Facts like share count are not judgments. */
const GRADED_KEYS: readonly AssumptionKey[] = ["growthRate1"];

export interface CalibrationEntry {
  symbol: string;
  key: AssumptionKey;
  /** What the user assumed, percent. */
  assumed: number;
  /** What the record shows, percent. */
  delivered: number;
  /** How that delivered figure was measured. */
  deliveredLabel: string;
  /** assumed − delivered, in percentage points. Positive is optimistic. */
  biasPp: number;
  /** When the user last set this assumption. */
  assumedAt: string;
}

export type CalibrationVerdict =
  | "insufficient"
  | "well_calibrated"
  | "optimistic"
  | "pessimistic"
  | "inconsistent";

export interface CalibrationReport {
  entries: CalibrationEntry[];
  /** Cases with a user-authored rate and a delivered figure to compare against. */
  sampleSize: number;
  /** Mean signed bias, percentage points. Positive means habitually optimistic. */
  meanBiasPp: number | null;
  medianBiasPp: number | null;
  /** Mean *absolute* bias — how far off, ignoring direction. */
  meanAbsBiasPp: number | null;
  optimisticCount: number;
  pessimisticCount: number;
  verdict: CalibrationVerdict;
  /** One sentence, safe to show verbatim. */
  summary: string;
}

/** Below this there is no signal, only noise. */
const MIN_SAMPLE = 3;
/** Within this the user is effectively unbiased. */
const CALIBRATED_PP = 1.5;
/** A consistent lean needs most of the sample pointing the same way. */
const CONSISTENCY_SHARE = 0.65;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** One case's contribution, or null when there is nothing to grade. */
export function calibrationEntriesFor(
  vcase: Pick<ValuationCase, "symbol"> & { assumptions: AssumptionSet },
  delivered: DeliveredGrowth,
): CalibrationEntry[] {
  if (delivered.value == null || !Number.isFinite(delivered.value)) return [];
  return GRADED_KEYS.flatMap((key) => {
    const a = vcase.assumptions[key];
    // Only the user's own numbers are graded.
    if (!a?.locked || !Number.isFinite(a.value)) return [];
    return [{
      symbol: vcase.symbol,
      key,
      assumed: a.value,
      delivered: delivered.value!,
      deliveredLabel: delivered.label,
      biasPp: a.value - delivered.value!,
      assumedAt: a.updatedAt,
    }];
  });
}

function verdictOf(
  entries: CalibrationEntry[],
  meanBias: number | null,
  optimistic: number,
  pessimistic: number,
): CalibrationVerdict {
  if (entries.length < MIN_SAMPLE || meanBias == null) return "insufficient";
  if (Math.abs(meanBias) <= CALIBRATED_PP) return "well_calibrated";

  const leaning = meanBias > 0 ? optimistic : pessimistic;
  // A large mean driven by one outlier is not a habit.
  if (leaning / entries.length < CONSISTENCY_SHARE) return "inconsistent";
  return meanBias > 0 ? "optimistic" : "pessimistic";
}

function summarize(report: Omit<CalibrationReport, "summary">): string {
  const { entries, meanBiasPp, verdict, optimisticCount } = report;
  const label = ASSUMPTION_LABEL[GRADED_KEYS[0]].toLowerCase();

  switch (verdict) {
    case "insufficient":
      return entries.length === 0
        ? `No calibration yet — set a ${label} yourself on a few companies and this will start grading it against what they deliver.`
        : `Only ${entries.length} of your own ${label} assumptions can be graded so far; ${MIN_SAMPLE} is the minimum before a pattern means anything.`;
    case "well_calibrated":
      return `Across ${entries.length} of your own ${label} assumptions you average ${meanBiasPp! >= 0 ? "+" : ""}${meanBiasPp!.toFixed(1)}pp versus what those businesses delivered — effectively unbiased.`;
    case "optimistic":
      return `Across ${entries.length} of your own ${label} assumptions you average ${meanBiasPp!.toFixed(1)}pp above what those businesses delivered. ${optimisticCount} of ${entries.length} lean high — worth a haircut on the next one.`;
    case "pessimistic":
      return `Across ${entries.length} of your own ${label} assumptions you average ${Math.abs(meanBiasPp!).toFixed(1)}pp below what those businesses delivered — you have been consistently conservative.`;
    case "inconsistent":
      return `Across ${entries.length} of your own ${label} assumptions the average gap is ${meanBiasPp! >= 0 ? "+" : ""}${meanBiasPp!.toFixed(1)}pp, but the direction is inconsistent — the average is driven by a few large misses rather than a habit.`;
  }
}

/** Grade every gradeable assumption across a set of cases. */
export function calibrateAssumptions(entries: CalibrationEntry[]): CalibrationReport {
  const biases = entries.map((e) => e.biasPp);
  const meanBiasPp = biases.length > 0
    ? biases.reduce((sum, b) => sum + b, 0) / biases.length
    : null;
  const meanAbsBiasPp = biases.length > 0
    ? biases.reduce((sum, b) => sum + Math.abs(b), 0) / biases.length
    : null;
  const optimisticCount = biases.filter((b) => b > 0).length;
  const pessimisticCount = biases.filter((b) => b < 0).length;

  const partial: Omit<CalibrationReport, "summary"> = {
    entries,
    sampleSize: entries.length,
    meanBiasPp,
    medianBiasPp: median(biases),
    meanAbsBiasPp,
    optimisticCount,
    pessimisticCount,
    verdict: verdictOf(entries, meanBiasPp, optimisticCount, pessimisticCount),
  };

  return { ...partial, summary: summarize(partial) };
}
