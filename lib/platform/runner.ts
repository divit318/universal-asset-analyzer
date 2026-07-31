/**
 * Staged Pipeline Runner — shared execution engine for every long-running,
 * multi-stage flow (the Wire scan first; IC Report, Thematic, and friends
 * migrate onto it once the Wire is verified).
 *
 * What it guarantees, because each was a measured failure before it existed
 * (2026-07-31 Wire investigation):
 *
 *   REAL PROGRESS   pct derives from completed work units, never from a stage
 *                   index. A stage that makes 6 model calls declares 6 units
 *                   and ticks one per call, naming the in-flight item — the
 *                   bar moved 62% → 70% in one jump after 7.8 silent minutes.
 *
 *   TERMINATION     A stage that fails or times out records WHY and the
 *                   pipeline CONTINUES with partial input (unless the stage
 *                   is declared `critical`). A scan must always end; before,
 *                   a starved scan swallowed ten timeouts and delivered an
 *                   empty result labelled success.
 *
 *   STALL VISIBILITY  If no unit completes for `stallAfterMs`, a `stall`
 *                   event names the stage, the in-flight item, and how long
 *                   it has been waiting — the UI renders "still waiting on X,
 *                   90s" instead of a frozen bar.
 *
 *   CANCELLATION    One AbortSignal threads through every stage; stages pass
 *                   it into model calls and fetches, so Cancel aborts real
 *                   in-flight work server-side, not just the client's read.
 */

export interface StageFailure {
  stage: string;
  reason: string;
}

export type PipelineRunnerEvent =
  | {
      type: "progress";
      stage: string;
      message: string;
      /** 0-100, derived from completed work units across all stages. */
      pct: number;
      unitsDone: number;
      unitsTotal: number;
      /** The item currently being worked on ("Consumer Cyclical, 2 of 3"), when a stage reports one. */
      currentItem: string | null;
    }
  | { type: "stage_failed"; stage: string; reason: string }
  | { type: "stall"; stage: string; stalledMs: number; currentItem: string | null };

export interface StageApi {
  /** Combined job + per-stage-deadline signal. Pass into every external call. */
  signal: AbortSignal;
  /** Refine this stage's intra-stage granularity once the real item count is known. */
  setUnits(total: number): void;
  /** Mark one unit of work done; optionally name the next in-flight item. */
  tick(currentItem?: string): void;
  /** Name the in-flight item without completing a unit (e.g. before the first call). */
  item(label: string): void;
  /**
   * Record a non-fatal degradation without aborting the stage — for stages
   * that recover with a fallback (headline-prefix dedup, unclassified events)
   * but whose degraded output the user deserves to know about. Before this,
   * a scan could swallow ten timeouts and present the result as a clean run.
   */
  fail(reason: string): void;
}

export interface StageDef<C> {
  id: string;
  /** Human-facing label, present tense ("Identifying company opportunities"). */
  label: string;
  /**
   * Estimated work units, used as this stage's weight in the overall pct.
   * Estimate in comparable units across stages (≈ one model call each).
   */
  units?: number;
  /** Deadline for the whole stage. Omit for stages bounded by their own calls. */
  timeoutMs?: number;
  /** A critical stage's failure aborts the pipeline. Default: record and continue. */
  critical?: boolean;
  run(ctx: C, api: StageApi): Promise<void>;
}

export interface RunPipelineOptions {
  signal?: AbortSignal;
  onEvent?: (event: PipelineRunnerEvent) => void;
  /** Emit a `stall` event when no unit completes for this long. Default 45s. */
  stallAfterMs?: number;
}

const DEFAULT_STALL_AFTER_MS = 45_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

function abortError(): DOMException {
  return new DOMException("This operation was aborted", "AbortError");
}

/**
 * Run stages in order, emitting progress/stall/failure events, and return the
 * failures so the caller can surface degraded sections honestly. Throws only
 * on cancellation or a `critical` stage failure.
 */
export async function runStagedPipeline<C>(
  stages: StageDef<C>[],
  ctx: C,
  opts: RunPipelineOptions = {},
): Promise<{ failures: StageFailure[] }> {
  const { signal, onEvent } = opts;
  const stallAfterMs = opts.stallAfterMs ?? DEFAULT_STALL_AFTER_MS;

  const weights = stages.map((s) => Math.max(1, s.units ?? 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const failures: StageFailure[] = [];

  let completedWeight = 0;
  let currentStage: StageDef<C> | null = null;
  let currentItem: string | null = null;
  let stageDone = 0;
  let stageTotal = 1;
  let lastProgressAt = Date.now();

  function unitsDone(): number {
    if (!currentStage) return completedWeight;
    const w = Math.max(1, currentStage.units ?? 1);
    return completedWeight + Math.min(1, stageDone / Math.max(1, stageTotal)) * w;
  }

  function emitProgress(): void {
    lastProgressAt = Date.now();
    onEvent?.({
      type: "progress",
      stage: currentStage?.id ?? "done",
      message: currentStage?.label ?? "Complete",
      pct: Math.min(100, Math.round((unitsDone() / totalWeight) * 100)),
      unitsDone: Math.round(unitsDone() * 10) / 10,
      unitsTotal: totalWeight,
      currentItem,
    });
  }

  const stallTimer = setInterval(() => {
    if (!currentStage) return;
    const stalledMs = Date.now() - lastProgressAt;
    if (stalledMs >= stallAfterMs) {
      onEvent?.({ type: "stall", stage: currentStage.id, stalledMs, currentItem });
    }
  }, STALL_CHECK_INTERVAL_MS);
  stallTimer.unref?.();

  try {
    for (let i = 0; i < stages.length; i++) {
      if (signal?.aborted) throw abortError();

      const stage = stages[i];
      currentStage = stage;
      currentItem = null;
      stageDone = 0;
      stageTotal = Math.max(1, stage.units ?? 1);
      emitProgress();

      const deadline = stage.timeoutMs ? AbortSignal.timeout(stage.timeoutMs) : undefined;
      const stageSignal =
        signal && deadline ? AbortSignal.any([signal, deadline]) : (deadline ?? signal);

      const api: StageApi = {
        signal: stageSignal ?? new AbortController().signal,
        setUnits(total: number) {
          stageTotal = Math.max(1, total);
          emitProgress();
        },
        tick(item?: string) {
          stageDone = Math.min(stageTotal, stageDone + 1);
          if (item !== undefined) currentItem = item;
          emitProgress();
        },
        item(label: string) {
          currentItem = label;
          emitProgress();
        },
        fail(reason: string) {
          failures.push({ stage: stage.id, reason });
          onEvent?.({ type: "stage_failed", stage: stage.id, reason });
        },
      };

      try {
        await stage.run(ctx, api);
      } catch (err) {
        // The caller cancelling is not a stage failure — stop everything.
        if (signal?.aborted) throw abortError();
        const reason =
          deadline?.aborted && err instanceof DOMException
            ? `timed out after ${Math.round((stage.timeoutMs ?? 0) / 1000)}s`
            : err instanceof Error
              ? err.message
              : String(err);
        if (stage.critical) throw err;
        failures.push({ stage: stage.id, reason });
        onEvent?.({ type: "stage_failed", stage: stage.id, reason });
      }

      completedWeight += Math.max(1, stage.units ?? 1);
    }

    currentStage = null;
    currentItem = null;
    return { failures };
  } finally {
    clearInterval(stallTimer);
  }
}
