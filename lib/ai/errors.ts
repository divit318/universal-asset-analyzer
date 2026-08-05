/**
 * AI Error Classification — turns any caught error into one of a small,
 * closed set of categories that the rest of the platform can branch on:
 * retry policy, structured logging ({@link import("./log").AiLogCategory}),
 * and — the point of this module — what to actually TELL the user.
 *
 * Before this, every AI failure surfaced through call-site-specific ad hoc
 * text. The compare route's fallback message, for example, hardcoded
 * "AI analysis unavailable — run `ollama serve`" regardless of why the model
 * didn't answer — including when Ollama was running fine and the real cause
 * was a model still cold-loading under memory pressure. Telling a user to
 * restart a daemon that was never down is the confusing-error problem this
 * exists to end.
 *
 * Classifies by duck-typed `.code`/`.name` rather than `instanceof` against
 * the error classes in ./ollama and ./router, so this module has no import
 * edge back to either of them (avoiding a cycle: ./router already imports
 * this module to classify the error it's about to throw).
 */

import { isCallerAbort, isTimeout } from "./ollama";

export type AiErrorCategory =
  | "cancelled"
  | "timeout"
  | "network"
  | "model_missing"
  | "all_models_failed"
  | "invalid_response"
  | "unknown";

export interface ClassifiedAiError {
  category: AiErrorCategory;
  /** Short, user-safe explanation — no stack traces, no internal ids, safe to render directly. */
  message: string;
  /** Whether trying again later is likely to help, as opposed to needing a fix (e.g. `ollama pull <model>`). */
  retryable: boolean;
}

const USER_MESSAGE: Record<AiErrorCategory, string> = {
  cancelled: "Cancelled.",
  timeout:
    "The local model is taking longer than expected — it may still be loading (cold start) or the machine is under heavy load. The metric table above is already complete either way; try re-running the analysis in a moment.",
  network:
    "Can't reach Ollama. Make sure it's running (`ollama serve`) — the metric table above doesn't depend on it and is already complete.",
  model_missing: "The model this task needs isn't installed locally yet.",
  all_models_failed:
    "Every available local model failed to answer just now. The metric table above is unaffected — try again shortly.",
  invalid_response: "The model's response didn't come back in a usable format. Try again.",
  unknown: "AI analysis failed unexpectedly.",
};

/** Duck-typed error codes set by ./ollama and ./router — see the module comment for why this doesn't `instanceof` them directly. */
function codeOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: unknown }).code as string | undefined
    : undefined;
}

/**
 * DevinAnalysisError (lib/ai/providers/devin/provider.ts) carries its own
 * category field whose four values are already members of this union. Read
 * by name + duck-typed field for the same no-import-cycle reason as codeOf.
 */
function devinCategoryOf(err: unknown): AiErrorCategory | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { name?: unknown; category?: unknown };
  if (e.name !== "DevinAnalysisError") return undefined;
  const c = e.category;
  return c === "cancelled" || c === "timeout" || c === "invalid_response" || c === "unknown"
    ? c
    : "unknown";
}

export function classifyAiError(err: unknown): ClassifiedAiError {
  let category: AiErrorCategory;
  const devin = devinCategoryOf(err);
  if (devin) category = devin;
  else if (isCallerAbort(err)) category = "cancelled";
  else if (isTimeout(err)) category = "timeout";
  else if (codeOf(err) === "ollama_unavailable") category = "network";
  else if (codeOf(err) === "model_missing") category = "model_missing";
  else if (codeOf(err) === "all_models_failed") category = "all_models_failed";
  else if (err instanceof SyntaxError) category = "invalid_response";
  else category = "unknown";

  return {
    category,
    message: USER_MESSAGE[category],
    retryable: category !== "cancelled" && category !== "model_missing",
  };
}
