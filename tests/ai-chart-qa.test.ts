import { describe, expect, it, vi } from "vitest";
import type { ChartQAContext } from "@/lib/types";

const runPromptWithMetaMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPromptWithMeta: (...args: unknown[]) => runPromptWithMetaMock(...args) }));

const { buildChartQAPrompt, runChartQA } = await import("@/lib/ai-chart-qa");

function baseContext(overrides: Partial<ChartQAContext> = {}): ChartQAContext {
  return {
    symbol: "AAPL",
    periodKey: "6M",
    candleInterval: "1D",
    indicatorsEnabled: ["sma50"],
    visibleCandleCount: 120,
    visibleDateRange: { from: "2026-01-01", to: "2026-07-01" },
    visiblePriceRange: { low: 180, high: 220 },
    trendSummary: "+8.2% over the visible range; price above SMA50",
    volumeSummary: "latest bar 1.2x its 20-bar average volume",
    selection: { kind: "overview", label: "Chart Overview" },
    otherDrawings: [],
    nearbyNews: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* buildChartQAPrompt                                                         */
/* -------------------------------------------------------------------------- */

describe("buildChartQAPrompt", () => {
  it("includes the symbol, a general-question note when nothing is selected, and the user's question", () => {
    const prompt = buildChartQAPrompt(baseContext(), "Is this trendline valid?");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("nothing specific");
    expect(prompt).toContain('Is this trendline valid?');
  });

  it("describes a selected drawing's points and style", () => {
    const context = baseContext({
      selection: {
        kind: "drawing",
        label: "Trend Line",
        drawing: { type: "trend-line", points: [{ timestamp: 1, value: 100 }], style: { color: "#38bdf8", opacity: 1, thickness: 1.5, lineStyle: "solid", textSize: 12 } },
      },
    });
    const prompt = buildChartQAPrompt(context, "Is this valid?");
    expect(prompt).toContain("SELECTED DRAWING: Trend Line");
    expect(prompt).toContain("#38bdf8");
  });

  it("describes a selected pattern's confirmations", () => {
    const context = baseContext({
      selection: {
        kind: "pattern",
        label: "Pattern · Bullish Engulfing",
        signal: { name: "Bullish Engulfing", direction: "bullish", description: "d", date: "2026-07-01", confidence: 82, confirmations: [{ label: "Volume", detail: "1.6x avg" }] },
        candle: { date: "2026-07-01", open: 100, high: 105, low: 99, close: 104, volume: 1000 },
      },
    });
    const prompt = buildChartQAPrompt(context, "How reliable is this?");
    expect(prompt).toContain("Bullish Engulfing");
    expect(prompt).toContain("Volume (1.6x avg)");
  });

  it("lists nearby news headlines when present", () => {
    const context = baseContext({ nearbyNews: [{ headline: "Guidance cut", source: "Reuters", publishedAt: "2026-06-30" }] });
    const prompt = buildChartQAPrompt(context, "Why did this move?");
    expect(prompt).toContain("Guidance cut");
  });
});

/* -------------------------------------------------------------------------- */
/* runChartQA                                                                 */
/* -------------------------------------------------------------------------- */

describe("runChartQA", () => {
  it("returns the parsed answer, confidence, reasoning, and relatedContext on a clean response", async () => {
    runPromptWithMetaMock.mockResolvedValueOnce({
      text: JSON.stringify({
        answer: "This looks like a healthy consolidation.",
        confidence: "moderate",
        reasoning: { observation: "Three touches on the line.", bullCase: "A fourth bounce would confirm it." },
        relatedContext: [{ target: "analysis", label: "Analysis", reason: "News may explain the pullback." }],
      }),
      model: "llama3.1",
    });

    const result = await runChartQA(baseContext(), "Is this valid?");
    expect(result.answer).toBe("This looks like a healthy consolidation.");
    expect(result.confidence).toBe("moderate");
    expect(result.reasoning).toEqual({ observation: "Three touches on the line.", bullCase: "A fourth bounce would confirm it." });
    expect(result.relatedContext).toEqual([{ target: "analysis", label: "Analysis", reason: "News may explain the pullback." }]);
    expect(result.model).toBe("llama3.1");
  });

  it("drops an invalid confidence value instead of passing it through", async () => {
    runPromptWithMetaMock.mockResolvedValueOnce({
      text: JSON.stringify({ answer: "Volume increased 22%.", confidence: "very high" }),
      model: "llama3.1",
    });
    const result = await runChartQA(baseContext(), "What happened to volume?");
    expect(result.confidence).toBeUndefined();
  });

  it("omits reasoning entirely when the model returns no usable sub-fields", async () => {
    runPromptWithMetaMock.mockResolvedValueOnce({
      text: JSON.stringify({ answer: "Answer.", reasoning: { observation: "", bullCase: null } }),
      model: "llama3.1",
    });
    const result = await runChartQA(baseContext(), "q");
    expect(result.reasoning).toBeUndefined();
  });

  it("filters out a relatedContext entry with an invalid target and caps the list to 2", async () => {
    runPromptWithMetaMock.mockResolvedValueOnce({
      text: JSON.stringify({
        answer: "Answer.",
        relatedContext: [
          { target: "bogus", label: "X", reason: "Y" },
          { target: "earnings", label: "Earnings", reason: "r1" },
          { target: "analysis", label: "Analysis", reason: "r2" },
          { target: "copilot", label: "Copilot", reason: "r3" },
        ],
      }),
      model: "llama3.1",
    });
    const result = await runChartQA(baseContext(), "q");
    expect(result.relatedContext).toEqual([
      { target: "earnings", label: "Earnings", reason: "r1" },
      { target: "analysis", label: "Analysis", reason: "r2" },
    ]);
  });

  it("falls back to a deterministic answer built from context when the model returns no answer", async () => {
    runPromptWithMetaMock.mockResolvedValueOnce({ text: JSON.stringify({ confidence: "high" }), model: "llama3.1" });
    const result = await runChartQA(baseContext(), "q");
    expect(result.model).toBe("unavailable");
    expect(result.answer).toContain("Chart Overview");
  });

  it("falls back gracefully when the model call throws", async () => {
    runPromptWithMetaMock.mockRejectedValueOnce(new Error("AI unreachable"));
    const result = await runChartQA(baseContext(), "q");
    expect(result.model).toBe("unavailable");
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it("falls back gracefully when the model returns unparseable text", async () => {
    runPromptWithMetaMock.mockResolvedValueOnce({ text: "not json at all", model: "llama3.1" });
    const result = await runChartQA(baseContext(), "q");
    expect(result.model).toBe("unavailable");
  });
});
