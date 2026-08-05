import { describe, it, expect, vi } from "vitest";
import type { CanonicalInput } from "@/lib/ic/canonical";

const runAgentNetworkMock = vi.fn();
vi.mock("@/lib/ic-agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ic-agents")>();
  return { ...actual, runAgentNetwork: (...args: unknown[]) => runAgentNetworkMock(...args) };
});
vi.mock("@/lib/ai/router", () => ({ pickModel: vi.fn().mockResolvedValue("test-model") }));
vi.mock("@/lib/ai", () => ({ runPrompt: vi.fn().mockRejectedValue(new Error("no model in tests")) }));
vi.mock("@/lib/yahoo", () => ({ getHistory: vi.fn().mockResolvedValue([]) }));

const { generateICReport } = await import("@/lib/ic-report");

const canonical: CanonicalInput = {
  symbol: "TEST",
  quote: {
    symbol: "TEST", name: "Test Corp", price: 100, previousClose: 99, change: 1, changePercent: 1,
    currency: "USD", marketCap: 1e12, peRatio: 25, dayHigh: null, dayLow: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, volume: null, exchange: "NMS",
  },
  snapshot: null,
  analyst: null,
  insider: null,
  statements: null,
  screenerIn: null,
};

const wacc = { value: 0.10, components: "test WACC" };

describe("generateICReport", () => {
  it("throws instead of forming a thesis from zero agent findings", async () => {
    runAgentNetworkMock.mockResolvedValue({
      findings: [],
      failures: [
        { agent: "business", agentLabel: "Business Analyst", error: "AI request timed out", retryable: true },
      ],
    });

    await expect(
      generateICReport({ symbol: "TEST", canonical, wacc }),
    ).rejects.toThrow(/all.*investigation agents failed/i);
  });

  it("deterministic mode (skipModelCalls) produces a complete report with no model", async () => {
    const events: string[] = [];
    const report = await generateICReport(
      { symbol: "TEST", canonical, wacc, skipModelCalls: true },
      (e) => events.push(e.stage),
    );
    expect(report.schemaVersion).toBe(2);
    expect(report.facts.symbol).toBe("TEST");
    expect(report.signalChecks.length).toBeGreaterThan(0);
    expect(report.questions.length).toBeGreaterThan(0);
    expect(report.valuation).toBeTruthy();
    expect(report.model).toContain("deterministic");
    expect(events).toContain("signals");
    expect(events).toContain("valuation");
    expect(events).toContain("done");
    // every stage event ordered before done
    expect(events.at(-1)).toBe("done");
  });

  it("stamps prompt versions and timings for reproducibility", async () => {
    const report = await generateICReport({ symbol: "TEST", canonical, wacc, skipModelCalls: true });
    expect(report.promptVersions.agents).toBeTruthy();
    expect(report.promptVersions.thesis).toBeTruthy();
    expect(report.promptVersions.valuationInputs).toBeTruthy();
    expect(report.timings.length).toBeGreaterThan(0);
  });
});
