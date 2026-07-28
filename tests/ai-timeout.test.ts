import { describe, expect, it } from "vitest";
import { deadlineSignal, isDeliberateAbort, OllamaUnavailableError, ModelMissingError } from "@/lib/ai/ollama";
import { AllModelsFailedError } from "@/lib/ai/router";
import { failureAnswer } from "@/lib/ai-app-assistant";

/**
 * A task's declared `timeoutMs` has to be a bound, not a suggestion.
 *
 * `generate()` honoured it, but `ChatOptions` had no field to receive it, so
 * `streamChat` ran unbounded — and `ollama-provider.complete()` sends every
 * MULTI-TURN request down that path. Any conversation with history therefore
 * escaped its own deadline: `app-assistant` declares 45s and was observed
 * taking 4.7 and 6.8 minutes, because the Router then retried each candidate
 * model in turn.
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
 * The keystone bug. `withRetry` skipped retrying "an aborted request" but only
 * recognised `AbortError`. `AbortSignal.timeout()` rejects with `TimeoutError`,
 * so every expiry was retried: each attempt waited out the full deadline, and
 * exhausting them threw `OllamaUnavailableError`.
 *
 * That one mismatch produced BOTH reported symptoms — 45s x 3 attempts x 3
 * candidate models = 405s (6m40s measured), and a "start Ollama" message for a
 * daemon that was up the whole time.
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
 * The panel used to answer every failure with "start Ollama with `ollama
 * serve`". The failure actually observed was Ollama up and answering, just
 * past the deadline — so the one instruction shown was the one that could not
 * help.
 */
describe("failureAnswer", () => {
  it("only says 'start Ollama' when Ollama is genuinely unreachable", () => {
    expect(failureAnswer(new OllamaUnavailableError())).toContain("ollama serve");
  });

  it("does NOT blame the daemon when the model merely timed out", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const answer = failureAnswer(timeout);
    expect(answer).not.toContain("ollama serve");
    expect(answer).toContain("took too long");
    expect(answer).toContain("AI_MAX_MODEL_GB");
  });

  it("does NOT blame the daemon when every candidate model failed", () => {
    const answer = failureAnswer(new AllModelsFailedError("app-assistant", ["timed out"]));
    expect(answer).not.toContain("ollama serve");
    expect(answer).toContain("took too long");
  });

  it("tells the user which model to pull when one is missing", () => {
    const answer = failureAnswer(new ModelMissingError("qwen3:14b"));
    expect(answer).toContain("ollama pull qwen3:14b");
    expect(answer).not.toContain("ollama serve");
  });

  it("falls back to a generic message for an unrecognised failure", () => {
    const answer = failureAnswer(new Error("empty answer"));
    expect(answer).not.toContain("ollama serve");
    expect(answer).toContain("⌘K");
  });

  it("always leaves the user a way forward", () => {
    const errors: unknown[] = [
      new OllamaUnavailableError(),
      new ModelMissingError("qwen3:14b"),
      new AllModelsFailedError("app-assistant", ["timed out"]),
      new Error("empty answer"),
      "not an error at all",
    ];
    for (const err of errors) expect(failureAnswer(err)).toContain("⌘K");
  });
});
