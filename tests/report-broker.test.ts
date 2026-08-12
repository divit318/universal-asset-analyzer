import { afterEach, describe, expect, it } from "vitest";
import {
  isGenerationActive,
  refreshGeneration,
  resetBrokerForTests,
  subscribeGeneration,
  type BrokerFrame,
} from "@/lib/ai/report-broker";

/**
 * The verdict generation broker: one model generation per cache identity,
 * shared by every concurrent consumer (Phase 2 fix 7), with refcounted
 * cancellation and a no-consumer background-refresh mode (fix 8).
 */

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function collect(
  gen: AsyncGenerator<BrokerFrame & { attach: string }, void, unknown>,
): Promise<Array<BrokerFrame & { attach: string }>> {
  const out: Array<BrokerFrame & { attach: string }> = [];
  for await (const frame of gen) out.push(frame);
  return out;
}

afterEach(() => resetBrokerForTests());

describe("subscribeGeneration", () => {
  it("runs the producer exactly once for concurrent identical subscribers", async () => {
    let producerRuns = 0;
    const producer = async (emit: (f: BrokerFrame) => void) => {
      producerRuns += 1;
      emit({ type: "section", id: "headline", data: "h" });
      await tick();
      emit({ type: "done", verdict: { headline: "h" } });
    };

    const [a, b, c] = await Promise.all([
      collect(subscribeGeneration("k1", producer)),
      collect(subscribeGeneration("k1", producer)),
      collect(subscribeGeneration("k1", producer)),
    ]);

    expect(producerRuns).toBe(1);
    for (const frames of [a, b, c]) {
      expect(frames.map((f) => f.type)).toEqual(["section", "done"]);
    }
  });

  it("labels the starter and the attached consumers distinctly", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const producer = async (emit: (f: BrokerFrame) => void) => {
      emit({ type: "section", id: "headline", data: "h" });
      await gate;
      emit({ type: "done" });
    };

    const first = collect(subscribeGeneration("k2", producer));
    await tick();
    const second = collect(subscribeGeneration("k2", producer));
    await tick();
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a[0].attach).toBe("started");
    expect(b[0].attach).toBe("attached");
  });

  it("replays frames already emitted before a late subscriber attached", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const producer = async (emit: (f: BrokerFrame) => void) => {
      emit({ type: "section", id: "headline", data: "h" });
      emit({ type: "section", id: "thesis", data: "t" });
      await gate;
      emit({ type: "done" });
    };

    const early = collect(subscribeGeneration("k3", producer));
    await tick();
    const late = collect(subscribeGeneration("k3", producer));
    await tick();
    release();

    const [a, b] = await Promise.all([early, late]);
    expect(b.map((f) => f.id)).toEqual(a.map((f) => f.id));
  });

  it("one consumer aborting does NOT abort work another consumer is streaming", async () => {
    let aborted = false;
    const producer = async (emit: (f: BrokerFrame) => void, signal: AbortSignal) => {
      signal.addEventListener("abort", () => (aborted = true));
      emit({ type: "section", id: "headline", data: "h" });
      await wait(30);
      emit({ type: "done" });
    };

    const stayer = collect(subscribeGeneration("k4", producer));
    await tick();
    const leaverController = new AbortController();
    const leaver = collect(subscribeGeneration("k4", producer, { signal: leaverController.signal }));
    await tick();
    leaverController.abort();

    await expect(leaver).rejects.toThrow(/abort/i);
    const frames = await stayer;
    expect(frames.at(-1)?.type).toBe("done");
    expect(aborted).toBe(false);
  });

  it("aborts the underlying generation when the LAST consumer leaves", async () => {
    let aborted = false;
    const producer = async (emit: (f: BrokerFrame) => void, signal: AbortSignal) => {
      signal.addEventListener("abort", () => (aborted = true));
      emit({ type: "section", id: "headline", data: "h" });
      await wait(60);
      emit({ type: "done" });
    };

    const controller = new AbortController();
    const only = collect(subscribeGeneration("k5", producer, { signal: controller.signal }));
    await tick();
    controller.abort();
    await expect(only).rejects.toThrow(/abort/i);
    await tick();
    expect(aborted).toBe(true);
    expect(isGenerationActive("k5")).toBe(false);
  });

  it("delivers a terminal error frame when the producer throws without emitting one", async () => {
    const frames = await collect(
      subscribeGeneration("k6", async (emit) => {
        emit({ type: "section", id: "headline", data: "h" });
        throw new Error("model exploded");
      }),
    );
    expect(frames.at(-1)?.type).toBe("error");
    expect(frames.at(-1)?.error).toMatch(/model exploded/);
  });
});

describe("refreshGeneration", () => {
  it("runs the producer in the background with no consumer", async () => {
    let ran = false;
    refreshGeneration("k7", async (emit) => {
      ran = true;
      emit({ type: "done" });
    });
    await wait(10);
    expect(ran).toBe(true);
    expect(isGenerationActive("k7")).toBe(false);
  });

  it("is a no-op while a generation for the key is already active", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const producer = async (emit: (f: BrokerFrame) => void) => {
      runs += 1;
      await gate;
      emit({ type: "done" });
    };

    const live = collect(subscribeGeneration("k8", producer));
    await tick();
    refreshGeneration("k8", producer);
    refreshGeneration("k8", producer);
    await tick();
    release();
    await live;
    expect(runs).toBe(1);
  });

  it("survives every human consumer leaving — the refresh still completes", async () => {
    let completed = false;
    refreshGeneration("k9", async (emit) => {
      await wait(20);
      completed = true;
      emit({ type: "done" });
    });
    await wait(40);
    expect(completed).toBe(true);
  });
});
