import { describe, expect, it } from "vitest";
import { hasRunningJob, startOrAttachJob } from "@/lib/platform/jobs";

const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let keyCounter = 0;
const uniqueKey = () => `test:job-${Date.now().toString(36)}-${keyCounter++}`;

function makeResult(result: unknown) {
  return { type: "result", data: result };
}
function makeError(message: string, cancelled: boolean) {
  return cancelled ? { type: "cancelled" } : { type: "error", message };
}

describe("job registry", () => {
  it("single-flight: a second start with the same key attaches to the running job", async () => {
    const key = uniqueKey();
    let runs = 0;
    let releaseJob: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseJob = r));

    const run = async (_signal: AbortSignal, emit: (e: unknown) => void) => {
      runs += 1;
      emit({ type: "progress", pct: 10 });
      await gate;
      return "done";
    };

    const first = startOrAttachJob(key, run, makeResult, makeError);
    await tick();
    const second = startOrAttachJob(key, run, makeResult, makeError);

    expect(first.attached).toBe(false);
    expect(second.attached).toBe(true);
    expect(second.id).toBe(first.id);
    expect(runs).toBe(1);

    // The attacher replays history: it sees the progress event emitted
    // before it subscribed, then the final result.
    const seen: unknown[] = [];
    second.subscribe((e) => seen.push(e));
    expect(seen).toContainEqual({ type: "progress", pct: 10 });

    releaseJob();
    await first.settled;
    expect(seen).toContainEqual({ type: "result", data: "done" });
  });

  it("a subscriber attaching after settle still receives the terminal event", async () => {
    const key = uniqueKey();
    const job = startOrAttachJob(key, async () => 42, makeResult, makeError, { detached: true });
    await job.settled;

    const seen: unknown[] = [];
    job.subscribe((e) => seen.push(e));
    expect(seen).toContainEqual({ type: "result", data: 42 });
  });

  it("cancel() aborts the run and emits a cancelled event", async () => {
    const key = uniqueKey();
    const job = startOrAttachJob(
      key,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      makeResult,
      makeError,
      { detached: true },
    );

    const seen: unknown[] = [];
    job.subscribe((e) => seen.push(e));
    job.cancel();
    await job.settled;
    expect(seen).toContainEqual({ type: "cancelled" });
  });

  it("aborts a client job after its last subscriber detaches (grace window)", async () => {
    const key = uniqueKey();
    let aborted = false;
    const job = startOrAttachJob(
      key,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      makeResult,
      makeError,
      { graceMs: 20 },
    );

    const detach = job.subscribe(() => {});
    detach();
    expect(aborted).toBe(false); // not yet — grace window
    await sleep(60);
    expect(aborted).toBe(true);
    await job.settled;
  });

  it("re-attaching within the grace window keeps the job alive", async () => {
    const key = uniqueKey();
    let aborted = false;
    let finish: () => void = () => {};
    const job = startOrAttachJob(
      key,
      (signal) =>
        new Promise<string>((resolve) => {
          finish = () => resolve("ok");
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      makeResult,
      makeError,
      { graceMs: 50 },
    );

    const detach = job.subscribe(() => {});
    detach();
    // Strict-mode style: re-attach immediately after detaching.
    const seen: unknown[] = [];
    job.subscribe((e) => seen.push(e));
    await sleep(80);
    expect(aborted).toBe(false);

    finish();
    await job.settled;
    expect(seen).toContainEqual({ type: "result", data: "ok" });
  });

  it("detached jobs never auto-abort and are visible to hasRunningJob", async () => {
    const key = uniqueKey();
    let finish: () => void = () => {};
    let aborted = false;
    const job = startOrAttachJob(
      key,
      (signal) =>
        new Promise<string>((resolve) => {
          finish = () => resolve("ok");
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      makeResult,
      makeError,
      { detached: true, graceMs: 10 },
    );

    expect(hasRunningJob("test:")).toBe(true);
    const detach = job.subscribe(() => {});
    detach();
    await sleep(40);
    expect(aborted).toBe(false);

    finish();
    await job.settled;
    expect(hasRunningJob(key)).toBe(false);
  });

  it("a failing job emits an error event and clears the registry", async () => {
    const key = uniqueKey();
    const job = startOrAttachJob(
      key,
      async () => {
        throw new Error("provider exploded");
      },
      makeResult,
      makeError,
      { detached: true },
    );
    const seen: unknown[] = [];
    job.subscribe((e) => seen.push(e));
    await job.settled;
    expect(seen).toContainEqual({ type: "error", message: "provider exploded" });
    expect(hasRunningJob(key)).toBe(false);
  });
});
