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
    "No API key is configured for the AI provider. Connect a provider in Settings to enable AI narration — every figure on this page is computed locally and unaffected.",
  bad_api_key:
    "The AI provider rejected your API key (invalid or revoked). Replace it in Settings — every figure on this page is computed locally and unaffected.",
  rate_limited:
    "The AI provider is rate-limiting requests right now; automatic retries were exhausted. Try again in a moment — the computed figures are unaffected.",
  network:
    "Can't reach the AI service right now. The metric table above doesn't depend on it and is already complete.",
  model_missing: "The model this task needs isn't available.",
  all_models_failed:
    "The AI service failed to answer just now. The metric table above is unaffected — try again shortly.",
  invalid_response: "The model's response didn't come back in a usable format. Try again.",
  unknown: "AI analysis failed unexpectedly.",
};

/**
 * The provider a key error belongs to, for message copy. The generic keyed
 * providers (lib/ai/keys.ts) set a duck-typed `provider` field; the
 * AnthropicProvider's own errors carry anthropic_* codes instead.
 */
function providerLabelOf(err: unknown, code: string | undefined): string {
  const raw =
    typeof err === "object" && err !== null && "provider" in err
      ? (err as { provider?: unknown }).provider
      : undefined;
  const labels: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Google Gemini",
    openrouter: "OpenRouter",
  };
  if (typeof raw === "string" && labels[raw]) return labels[raw];
  return code?.startsWith("anthropic_") ? "Anthropic" : "AI provider";
}

function noKeyMessage(label: string): string {
  return `No ${label} API key is configured. Add your key in Settings to enable AI narration — every figure on this page is computed locally and unaffected.`;
}

function badKeyMessage(label: string): string {
  return `The ${label} API rejected your API key (invalid or revoked). Replace it in Settings — every figure on this page is computed locally and unaffected.`;
}

/**
 * The env-sourced variant of bad_api_key. "Replace it in Settings" is the one
 * fix that CANNOT work here: the provider's environment variable (e.g.
 * ANTHROPIC_API_KEY) takes precedence over the Settings-saved key file, so
 * the env var itself is what must be corrected (or unset) where the app was
 * launched.
 */
function badEnvKeyMessage(label: string): string {
  const envVar = label === "Anthropic" ? "the ANTHROPIC_API_KEY environment variable" : "its API-key environment variable";
  return `The ${label} API rejected your API key (invalid or revoked). The key comes from ${envVar}, which overrides any key saved in Settings — update or unset it where the app is launched, then restart. Every figure on this page is computed locally and unaffected.`;
}

/** Duck-typed error codes set by the provider and ./router — see the module comment for why this doesn't `instanceof` them directly. */
function codeOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: unknown }).code as string | undefined
    : undefined;
}

/** Duck-typed key source set by the provider's key errors (see AnthropicKeyInvalidError). */
function keySourceOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "source" in err
    ? (err as { source?: unknown }).source as string | undefined
    : undefined;
}

/** The original per-attempt errors an AllModelsFailedError wraps, when it carries them. */
function causesOf(err: unknown): unknown[] | null {
  if (typeof err === "object" && err !== null && "causes" in err) {
    const causes = (err as { causes?: unknown }).causes;
    if (Array.isArray(causes) && causes.length > 0) return causes;
  }
  return null;
}

/**
 * Categories worth promoting out of an exhausted-candidates wrapper when EVERY
 * attempt failed the same way. Each names a single actionable fix that the
 * generic "the AI service failed to answer just now — try again shortly" would
 * hide: a bad or missing key is not retryable at all, and telling the user to
 * retry it is advice that cannot work.
 */
const PROMOTABLE_CAUSES: ReadonlySet<AiErrorCategory> = new Set([
  "no_api_key",
  "bad_api_key",
  "rate_limited",
  "network",
]);

export function classifyAiError(err: unknown): ClassifiedAiError {
  const code = codeOf(err);
  let category: AiErrorCategory;
  if (isCallerAbort(err)) category = "cancelled";
  else if (isTimeout(err)) category = "timeout";
  // "anthropic_key_*" are the AnthropicProvider's own codes; "api_key_*" are
  // the provider-generic ones every other keyed provider throws (lib/ai/keys.ts).
  else if (code === "anthropic_key_missing" || code === "api_key_missing") category = "no_api_key";
  else if (code === "anthropic_key_invalid" || code === "api_key_invalid") category = "bad_api_key";
  else if (code === "rate_limited") category = "rate_limited";
  else if (code === "network") category = "network";
  else if (code === "model_missing") category = "model_missing";
  else if (code === "all_models_failed") category = "all_models_failed";
  else if (err instanceof SyntaxError) category = "invalid_response";
  else category = "unknown";

  // See through the wrapper when there is one true cause: "all models failed"
  // because every attempt hit the same rejected key is a key problem, not a
  // transient outage, and the user must be told the fix that actually works.
  if (category === "all_models_failed") {
    const causes = causesOf(err);
    if (causes) {
      const classified = causes.map((cause) => classifyAiError(cause));
      const first = classified[0];
      if (
        PROMOTABLE_CAUSES.has(first.category) &&
        classified.every((c) => c.category === first.category)
      ) {
        return first;
      }
    }
  }

  let message = USER_MESSAGE[category];
  if (category === "no_api_key") {
    message = noKeyMessage(providerLabelOf(err, code));
  } else if (category === "bad_api_key") {
    const label = providerLabelOf(err, code);
    message = keySourceOf(err) === "env" ? badEnvKeyMessage(label) : badKeyMessage(label);
  }

  return {
    category,
    message,
    retryable:
      category !== "cancelled" &&
      category !== "model_missing" &&
      category !== "no_api_key" &&
      category !== "bad_api_key",
  };
}
