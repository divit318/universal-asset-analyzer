/**
 * Abort/deadline helpers — provider-agnostic signal plumbing.
 *
 * Formerly lived in the Ollama service layer; extracted when that provider was
 * removed because nothing here is provider-specific: the Router's fallback
 * policy, error classification, and any transport that takes an AbortSignal
 * all need the same two distinctions.
 */

/**
 * Combine a caller's abort signal with a deadline. Returns whichever of the two
 * exists, or a signal that fires on the first of them when both do.
 *
 * Both matter and neither subsumes the other: the caller's signal carries
 * client disconnects (so an abandoned request stops consuming a provider),
 * while the deadline is what stops a stuck generation running unbounded.
 */
export function deadlineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (timeoutMs == null) return signal;
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/**
 * Did a DEADLINE expire, as opposed to the caller cancelling?
 *
 * `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError" —
 * distinct from a caller's own `AbortController.abort()`, which defaults to
 * "AbortError". The distinction matters for two different reasons downstream:
 * a timeout says something about the model/host (worth a health-cooldown
 * ding, worth logging as `timeout` rather than `cancelled`), while a caller
 * abort says nothing about the model at all (see {@link isCallerAbort}).
 */
export function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

/**
 * Did the CALLER deliberately cancel this request (e.g. the user navigated
 * away, changed symbols, or re-triggered a re-analysis before the first one
 * finished)? Nobody is waiting for this answer any more — it must never be
 * retried, never count against the model's health, and never be reported to
 * the user as a failure.
 */
export function isCallerAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Did this rejection come from us cancelling the request, rather than from the
 * connection failing? Covers both {@link isTimeout} and {@link isCallerAbort} —
 * kept for call sites that only need to know "don't retry this", not which of
 * the two happened. Call sites that need to tell them apart (the Router's
 * fallback and health-tracking policy, error classification for the UI) use
 * the two specific predicates instead.
 */
export function isDeliberateAbort(err: unknown): boolean {
  return isTimeout(err) || isCallerAbort(err);
}
