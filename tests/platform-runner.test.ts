import { describe, expect, it } from "vitest";
import {
  runStagedPipeline,
  type PipelineRunnerEvent,
  type StageDef,
} from "@/lib/platform/runner";

function collectEvents() {
  const events: PipelineRunnerEvent[] = [];
  return { events, onEvent: (e: PipelineRunnerEvent) => events.push(e) };
}

describe("staged pipeline runner", () => {
  it("derives pct from completed work units, monotonically", async () => {
    const { events, onEvent } = collectEvents();
    const stages: StageDef<Record<string, never>>[] = [
      { id: "a", label: "A", units: 1, run: async () => {} },
      {
        id: "b",
        label: "B",
        units: 3,
        run: async (_ctx, api) => {
          api.setUnits(3);
          api.tick("item 1");
          api.tick("item 2");
          api.tick("item 3");
        },
      },
      { id: "c", label: "C", units: 1, run: async () => {} },
    ];

    const { failures } = await runStagedPipeline(stages, {}, { onEvent });
    expect(failures).toEqual([]);

    const progress = events.filter((e) => e.type === "progress");
    const pcts = progress.map((e) => e.pct);
    // Monotonic, ends at 100 only when everything completed.
    expect([...pcts].sort((x, y) => x - y)).toEqual(pcts);
    // Intra-stage ticks moved the bar between stage boundaries.
    const bTicks = progress.filter((e) => e.stage === "b");
    expect(new Set(bTicks.map((e) => e.pct)).size).toBeGreaterThan(1);
    expect(bTicks.some((e) => e.currentItem === "item 2")).toBe(true);
  });

  it("records a non-critical stage failure and continues", async () => {
    const { events, onEvent } = collectEvents();
    const ran: string[] = [];
    const stages: StageDef<Record<string, never>>[] = [
      {
        id: "broken",
        label: "Broken",
        run: async () => {
          throw new Error("model unavailable");
        },
      },
      {
        id: "after",
        label: "After",
        run: async () => {
          ran.push("after");
        },
      },
    ];

    const { failures } = await runStagedPipeline(stages, {}, { onEvent });
    expect(ran).toEqual(["after"]); // the pipeline continued
    expect(failures).toEqual([{ stage: "broken", reason: "model unavailable" }]);
    expect(events.some((e) => e.type === "stage_failed" && e.stage === "broken")).toBe(true);
  });

  it("a critical stage failure aborts the pipeline", async () => {
    const ran: string[] = [];
    const stages: StageDef<Record<string, never>>[] = [
      {
        id: "critical",
        label: "Critical",
        critical: true,
        run: async () => {
          throw new Error("boom");
        },
      },
      {
        id: "after",
        label: "After",
        run: async () => {
          ran.push("after");
        },
      },
    ];
    await expect(runStagedPipeline(stages, {})).rejects.toThrow("boom");
    expect(ran).toEqual([]);
  });

  it("api.fail records a degradation without aborting the stage", async () => {
    const { events, onEvent } = collectEvents();
    const stages: StageDef<Record<string, never>>[] = [
      {
        id: "degraded",
        label: "Degraded",
        run: async (_ctx, api) => {
          api.fail("fell back to headline dedup");
        },
      },
    ];
    const { failures } = await runStagedPipeline(stages, {}, { onEvent });
    expect(failures).toEqual([{ stage: "degraded", reason: "fell back to headline dedup" }]);
    expect(events.filter((e) => e.type === "stage_failed")).toHaveLength(1);
  });

  it("a stage timeout records the failure and the pipeline continues", async () => {
    const { onEvent } = collectEvents();
    const stages: StageDef<Record<string, never>>[] = [
      {
        id: "slow",
        label: "Slow",
        timeoutMs: 20,
        run: async (_ctx, api) =>
          new Promise((resolve, reject) => {
            // A well-behaved stage aborts its work when its signal fires.
            api.signal.addEventListener("abort", () =>
              reject(new DOMException("timed out", "TimeoutError")),
            );
            setTimeout(resolve, 5_000).unref?.();
          }),
      },
      { id: "after", label: "After", run: async () => {} },
    ];
    const { failures } = await runStagedPipeline(stages, {}, { onEvent });
    expect(failures).toHaveLength(1);
    expect(failures[0].stage).toBe("slow");
    expect(failures[0].reason).toMatch(/timed out/);
  });

  it("cancellation stops the pipeline between stages", async () => {
    const controller = new AbortController();
    const ran: string[] = [];
    const stages: StageDef<Record<string, never>>[] = [
      {
        id: "first",
        label: "First",
        run: async () => {
          ran.push("first");
          controller.abort();
        },
      },
      {
        id: "second",
        label: "Second",
        run: async () => {
          ran.push("second");
        },
      },
    ];
    await expect(
      runStagedPipeline(stages, {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(ran).toEqual(["first"]);
  });

  it("emits a stall event when no unit completes for stallAfterMs", async () => {
    const { events, onEvent } = collectEvents();
    const stages: StageDef<Record<string, never>>[] = [
      {
        id: "quiet",
        label: "Quiet",
        run: async (_ctx, api) => {
          api.item("waiting on the model");
          // Stall checks run every 5s; wait long enough for one to fire.
          await new Promise((r) => setTimeout(r, 5_200));
        },
      },
    ];
    await runStagedPipeline(stages, {}, { onEvent, stallAfterMs: 100 });
    const stalls = events.filter((e) => e.type === "stall");
    expect(stalls.length).toBeGreaterThan(0);
    expect(stalls[0]).toMatchObject({ stage: "quiet", currentItem: "waiting on the model" });
    expect(stalls[0].stalledMs).toBeGreaterThanOrEqual(100);
  }, 10_000);
});
