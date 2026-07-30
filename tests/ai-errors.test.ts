import { describe, expect, it } from "vitest";
import { classifyAiError } from "@/lib/ai/errors";
import { ModelMissingError, OllamaUnavailableError } from "@/lib/ai/ollama";
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
    expect(c.message).toMatch(/cold start|loading/i);
  });

  it("classifies an unreachable daemon as network, with actionable advice", () => {
    const c = classifyAiError(new OllamaUnavailableError());
    expect(c.category).toBe("network");
    expect(c.message).toMatch(/ollama serve/i);
  });

  it("classifies a missing model as model_missing, and marks it non-retryable", () => {
    const c = classifyAiError(new ModelMissingError("qwen3:99b"));
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

  it("never returns an empty user-facing message", () => {
    for (const err of [
      new DOMException("x", "AbortError"),
      new DOMException("x", "TimeoutError"),
      new OllamaUnavailableError(),
      new ModelMissingError("m"),
      new AllModelsFailedError("comparison", []),
      new SyntaxError("x"),
      new Error("x"),
    ]) {
      expect(classifyAiError(err).message.length).toBeGreaterThan(0);
    }
  });
});
