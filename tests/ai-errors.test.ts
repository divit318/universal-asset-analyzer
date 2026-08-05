import { describe, expect, it } from "vitest";
import { classifyAiError } from "@/lib/ai/errors";
import { AnthropicKeyMissingError } from "@/lib/ai/providers/anthropic-provider";
import { AllModelsFailedError } from "@/lib/ai/router";

describe("classifyAiError", () => {
  it("classifies a caller abort as cancelled, never as a failure", () => {
    const c = classifyAiError(new DOMException("aborted", "AbortError"));
    expect(c.category).toBe("cancelled");
    expect(c.retryable).toBe(false);
  });

  it("classifies a deadline expiry as timeout, and marks it retryable", () => {
    const c = classifyAiError(new DOMException("timed out", "TimeoutError"));
    expect(c.category).toBe("timeout");
    expect(c.retryable).toBe(true);
  });

  it("classifies a missing API key as no_api_key, pointing at Settings, non-retryable", () => {
    const c = classifyAiError(new AnthropicKeyMissingError());
    expect(c.category).toBe("no_api_key");
    expect(c.retryable).toBe(false);
    expect(c.message).toMatch(/settings/i);
    expect(c.message).toMatch(/computed locally/i);
  });

  it("classifies a missing model as model_missing, and marks it non-retryable", () => {
    const err = Object.assign(new Error("no such model"), { code: "model_missing" });
    const c = classifyAiError(err);
    expect(c.category).toBe("model_missing");
    expect(c.retryable).toBe(false);
  });

  it("classifies exhausted candidates as all_models_failed", () => {
    const c = classifyAiError(new AllModelsFailedError("comparison", ["m1: timeout", "m2: connection refused"]));
    expect(c.category).toBe("all_models_failed");
  });

  it("classifies a bad JSON parse as invalid_response", () => {
    const c = classifyAiError(new SyntaxError("Unexpected token"));
    expect(c.category).toBe("invalid_response");
  });

  it("falls back to unknown for anything else, without throwing", () => {
    expect(classifyAiError(new Error("something else")).category).toBe("unknown");
    expect(classifyAiError("a plain string").category).toBe("unknown");
    expect(classifyAiError(undefined).category).toBe("unknown");
  });

  it("never returns an empty user-facing message, and never leaks the key", () => {
    for (const err of [
      new DOMException("x", "AbortError"),
      new DOMException("x", "TimeoutError"),
      new AnthropicKeyMissingError(),
      new AllModelsFailedError("comparison", []),
      new SyntaxError("x"),
      new Error("x"),
    ]) {
      const c = classifyAiError(err);
      expect(c.message.length).toBeGreaterThan(0);
      expect(c.message).not.toMatch(/sk-ant-/);
    }
  });
});
