import { describe, expect, it } from "vitest";
import { deadlineSignal, isDeliberateAbort } from "@/lib/ai/aborts";
import { AllModelsFailedError } from "@/lib/ai/router";
import { AnthropicKeyMissingError } from "@/lib/ai/providers/anthropic-provider";
import { failureAnswer } from "@/lib/ai-app-assistant";

/**
 * A task's declared `timeoutMs` has to be a bound, not a suggestion — see
 * lib/ai/aborts.ts for the deadline/caller-abort distinction the Router's
 * fallback policy and error classification both depend on.
 */
describe("deadlineSignal", () => {
  it("returns the caller's signal untouched when no deadline is set", () => {
    const ctrl = new AbortController();
    expect(deadlineSignal(ctrl.signal, undefined)).toBe(ctrl.signal);
  });

  it("returns undefined when there is neither signal nor deadline", () => {
    expect(deadlineSignal(undefined, undefined)).toBeUndefined();
  });

  // Real (short) deadlines, not fake timers: AbortSignal.timeout schedules on a
  // libuv timer that vi.advanceTimersByTime does not drive, so a faked clock
  // reports `aborted === false` forever and the test would pass vacuously.
  const aborted = (signal: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      if (signal.aborted) return resolve(true);
      signal.addEventListener("abort", () => resolve(true), { once: true });
      setTimeout(() => resolve(signal.aborted), 200);
    });

  it("produces a signal that aborts on the deadline when there is no caller signal", async () => {
    const signal = deadlineSignal(undefined, 20);
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    expect(await aborted(signal!)).toBe(true);
  });

  it("aborts on the deadline even when the caller never aborts", async () => {
    const ctrl = new AbortController();
    const signal = deadlineSignal(ctrl.signal, 20)!;
    expect(signal.aborted).toBe(false);
    expect(await aborted(signal)).toBe(true);
  });

  it("aborts immediately when the caller aborts first, without waiting out the deadline", () => {
    const ctrl = new AbortController();
    const signal = deadlineSignal(ctrl.signal, 600_000)!;
    expect(signal.aborted).toBe(false);
    ctrl.abort();
    expect(signal.aborted).toBe(true);
  });
});

/**
 * The keystone historical bug: a retry loop that only recognised `AbortError`
 * retried every `TimeoutError` expiry, multiplying a task's declared budget by
 * the attempt count and then by the Router's candidate count.
 */
describe("isDeliberateAbort", () => {
  it("treats a deadline expiry as deliberate, so it is never retried", () => {
    // Exactly what AbortSignal.timeout() rejects with — verified against Node.
    expect(isDeliberateAbort(new DOMException("timed out", "TimeoutError"))).toBe(true);
  });

  it("treats a caller abort as deliberate", () => {
    expect(isDeliberateAbort(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("still retries a genuine connection failure", () => {
    expect(isDeliberateAbort(new TypeError("fetch failed"))).toBe(false);
    expect(isDeliberateAbort(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("does not mistake a same-named plain Error for an abort", () => {
    const impostor = new Error("timed out");
    impostor.name = "TimeoutError";
    expect(isDeliberateAbort(impostor)).toBe(false);
  });
});

/**
 * The assistant panel must name the actual failure class — a missing key gets
 * the Settings hint, a timeout does not blame configuration it can't see.
 */
describe("failureAnswer", () => {
  it("points at Settings when the API key is missing", () => {
    const answer = failureAnswer(new AnthropicKeyMissingError());
    expect(answer).toMatch(/settings/i);
    expect(answer).toMatch(/API key/i);
  });

  it("does NOT mention the key when the model merely timed out", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const answer = failureAnswer(timeout);
    expect(answer).not.toMatch(/API key/i);
    expect(answer).toContain("too long");
  });

  it("treats exhausted candidates like a transient failure, not a config error", () => {
    const answer = failureAnswer(new AllModelsFailedError("app-assistant", ["timed out"]));
    expect(answer).not.toMatch(/API key/i);
    expect(answer).toContain("too long");
  });

  it("falls back to a generic message for an unrecognised failure", () => {
    const answer = failureAnswer(new Error("empty answer"));
    expect(answer).toContain("⌘K");
  });

  it("always leaves the user a way forward", () => {
    const errors: unknown[] = [
      new AnthropicKeyMissingError(),
      new AllModelsFailedError("app-assistant", ["timed out"]),
      new Error("empty answer"),
      "not an error at all",
    ];
    for (const err of errors) expect(failureAnswer(err)).toContain("⌘K");
  });
});
