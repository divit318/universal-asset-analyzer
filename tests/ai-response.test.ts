import { describe, expect, it } from "vitest";
import { normalizeResponse } from "@/lib/ai/response";

describe("normalizeResponse", () => {
  it("marks empty content as low confidence", () => {
    const res = normalizeResponse({
      content: "",
      reasoning: "",
      model: "qwen3",
      provider: "ollama",
      startedAt: Date.now(),
    });
    expect(res.confidence).toBe("low");
    expect(res.errors).toEqual([]);
  });

  it("marks a substantive answer with reasoning as high confidence", () => {
    const res = normalizeResponse({
      content: "This company has strong fundamentals across every metric we checked.",
      reasoning: "Let me consider the P/E, ROE, and revenue growth in turn...",
      model: "deepseek-r1",
      provider: "ollama",
      startedAt: Date.now(),
    });
    expect(res.confidence).toBe("high");
    expect(res.reasoningSummary).not.toBeNull();
  });

  it("downgrades confidence to medium when a fallback occurred, even with a good answer", () => {
    const res = normalizeResponse({
      content: "This company has strong fundamentals across every metric we checked.",
      reasoning: "Reasoning trace here.",
      model: "llama3.1",
      provider: "ollama",
      startedAt: Date.now(),
      fallbackErrors: ["qwen3: timeout"],
    });
    expect(res.confidence).toBe("medium");
    expect(res.errors).toEqual(["qwen3: timeout"]);
  });

  it("returns null reasoningSummary when no reasoning was produced", () => {
    const res = normalizeResponse({
      content: "Short answer.",
      reasoning: "",
      model: "mistral",
      provider: "ollama",
      startedAt: Date.now(),
    });
    expect(res.reasoningSummary).toBeNull();
  });

  it("records execution time and echoes model/provider/metadata", () => {
    const startedAt = Date.now() - 50;
    const res = normalizeResponse({
      content: "Answer.",
      reasoning: "",
      model: "qwen3",
      provider: "ollama",
      startedAt,
      metadata: { taskType: "company-research" },
    });
    expect(res.model).toBe("qwen3");
    expect(res.provider).toBe("ollama");
    expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(res.metadata).toEqual({ taskType: "company-research" });
  });
});
