/**
 * AI Error Classification — turns any caught error into one of a small,
 * closed set of categories that the rest of the platform can branch on:
 * retry policy, structured logging ({@link import("./log").AiLogCategory}),
 * and — the point of this module — what to actually TELL the user.
 *
 * Before this, every AI failure surfaced through call-site-specific ad hoc
 * text. The compare route's fallback message, for example, hardcoded one
 * fix regardless of why the model didn't answer. Telling a user to fix a
 * thing that was never broken is the confusing-error problem this exists to
 * end.
 *
 * Classifies by duck-typed `.code`/`.name` rather than `instanceof` against
 * the error classes in the provider and ./router, so this module has no import
 * edge back to either of them (avoiding a cycle: ./router already imports
 * this module to classify the error it's about to throw).
 */

import { isCallerAbort, isTimeout } from "./aborts";

export type AiErrorCategory =
  | "cancelled"
  | "timeout"
  | "no_api_key"
  | "bad_api_key"
  | "rate_limited"
  | "network"
  | "model_missing"
  | "all_models_failed"
  | "invalid_response"
  | "unknown";

export interface ClassifiedAiError {
  category: AiErrorCategory;
  /** Short, user-safe explanation — no stack traces, no internal ids, safe to render directly. */
  message: string;
  /** Whether trying again later is likely to help, as opposed to needing a fix (e.g. adding an API key). */
  retryable: boolean;
}

const USER_MESSAGE: Record<AiErrorCategory, string> = {
  cancelled: "Cancelled.",
  timeout:
    "The AI request took longer than its time budget. The metric table above is already complete either way; try re-running the analysis in a moment.",
  no_api_key:
    "No Anthropic API key is configured. Add your key in Settings to enable AI narration — every figure on this page is computed locally and unaffected.",
  bad_api_key:
    "The Anthropic API rejected your API key (invalid or revoked). Replace it in Settings — every figure on this page is computed locally and unaffected.",
  rate_limited:
    "The Anthropic API is rate-limiting requests right now; automatic retries were exhausted. Try again in a moment — the computed figures are unaffected.",
  network:
    "Can't reach the AI service right now. The metric table above doesn't depend on it and is already complete.",
  model_missing: "The model this task needs isn't available.",
  all_models_failed:
    "The AI service failed to answer just now. The metric table above is unaffected — try again shortly.",
  invalid_response: "The model's response didn't come back in a usable format. Try again.",
  unknown: "AI analysis failed unexpectedly.",
};

/** Duck-typed error codes set by the provider and ./router — see the module comment for why this doesn't `instanceof` them directly. */
function codeOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: unknown }).code as string | undefined
    : undefined;
}

export function classifyAiError(err: unknown): ClassifiedAiError {
  let category: AiErrorCategory;
  if (isCallerAbort(err)) category = "cancelled";
  else if (isTimeout(err)) category = "timeout";
  else if (codeOf(err) === "anthropic_key_missing") category = "no_api_key";
  else if (codeOf(err) === "anthropic_key_invalid") category = "bad_api_key";
  else if (codeOf(err) === "rate_limited") category = "rate_limited";
  else if (codeOf(err) === "network") category = "network";
  else if (codeOf(err) === "model_missing") category = "model_missing";
  else if (codeOf(err) === "all_models_failed") category = "all_models_failed";
  else if (err instanceof SyntaxError) category = "invalid_response";
  else category = "unknown";

  return {
    category,
    message: USER_MESSAGE[category],
    retryable:
      category !== "cancelled" &&
      category !== "model_missing" &&
      category !== "no_api_key" &&
      category !== "bad_api_key",
  };
}
