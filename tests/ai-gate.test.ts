import { describe, expect, it } from "vitest";
import { acquireGenerationSlot, generationQueueDepth } from "@/lib/ai/gate";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("generation gate", () => {
  it("serializes concurrent acquisitions (limit 1)", async () => {
    const order: string[] = [];

    const releaseA = await acquireGenerationSlot();
    const b = acquireGenerationSlot().then((release) => {
      order.push("b");
      return release;
    });
    const c = acquireGenerationSlot().then((release) => {
      order.push("c");
      return release;
    });

    await tick();
    expect(order).toEqual([]); // both queued behind A
    expect(generationQueueDepth()).toBe(2);

    releaseA();
    const releaseB = await b;
    expect(order).toEqual(["b"]); // FIFO: b before c
    releaseB();
    const releaseC = await c;
    expect(order).toEqual(["b", "c"]);
    releaseC();
    expect(generationQueueDepth()).toBe(0);
  });

  it("rejects with AbortError when the caller aborts while queued", async () => {
    const release = await acquireGenerationSlot();
    const controller = new AbortController();
    const queued = acquireGenerationSlot(controller.signal);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(generationQueueDepth()).toBe(0);

    release();
    // The slot is still usable after an aborted waiter.
    const next = await acquireGenerationSlot();
    next();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(acquireGenerationSlot(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("release is idempotent — releasing twice frees exactly one slot", async () => {
    const releaseA = await acquireGenerationSlot();
    releaseA();
    releaseA(); // must not corrupt the active count

    const releaseB = await acquireGenerationSlot();
    let cAcquired = false;
    const c = acquireGenerationSlot().then((release) => {
      cAcquired = true;
      return release;
    });
    await tick();
    expect(cAcquired).toBe(false); // b still holds the only slot
    releaseB();
    (await c)();
  });
});
