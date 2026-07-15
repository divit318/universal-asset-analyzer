import { describe, it, expect, vi } from "vitest";
import type { InvestigativeQuestion, AgentDomain } from "@/lib/ic-questions";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));

const { runAgentNetwork, extractAgentJson } = await import("@/lib/ic-agents");

function question(domain: AgentDomain): InvestigativeQuestion {
  return {
    id: `${domain}-q`,
    question: `What about ${domain}?`,
    assignedAgents: [domain],
    sourceSignals: [],
    priority: "high",
  };
}

function baseInput(domains: AgentDomain[]) {
  const questionsByAgent = new Map<AgentDomain, InvestigativeQuestion[]>();
  for (const d of domains) questionsByAgent.set(d, [question(d)]);
  return {
    companyName: "Test Corp",
    symbol: "TEST",
    questionsByAgent,
    signals: [],
  };
}

describe("runAgentNetwork", () => {
  it("returns all findings and no failures when every agent succeeds", async () => {
    runPromptMock.mockResolvedValue(
      JSON.stringify({ findings: "ok", keyInsights: ["a"], confidence: "high", dataLimitations: null }),
    );

    const result = await runAgentNetwork(baseInput(["business", "risk"]));

    expect(result.findings).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it("collects a failure with its error message instead of dropping it silently", async () => {
    runPromptMock
      .mockResolvedValueOnce(
        JSON.stringify({ findings: "ok", keyInsights: [], confidence: "medium", dataLimitations: null }),
      )
      .mockRejectedValueOnce(new Error("Ollama request timed out"));

    const result = await runAgentNetwork(baseInput(["business", "risk"]));

    expect(result.findings).toHaveLength(1);
    expect(result.failures).toEqual([
      { agent: "risk", agentLabel: "Risk Analyst", error: "Ollama request timed out" },
    ]);
  });

  it("reports every agent as failed when all calls reject, without throwing", async () => {
    runPromptMock.mockRejectedValue(new Error("model too slow"));

    const result = await runAgentNetwork(baseInput(["business", "risk", "valuation"]));

    expect(result.findings).toHaveLength(0);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.every((f) => f.error === "model too slow")).toBe(true);
  });

  it("dispatches agents sequentially, not concurrently", async () => {
    const active = { count: 0, maxConcurrent: 0 };
    runPromptMock.mockImplementation(async () => {
      active.count++;
      active.maxConcurrent = Math.max(active.maxConcurrent, active.count);
      await new Promise((r) => setTimeout(r, 5));
      active.count--;
      return JSON.stringify({ findings: "ok", keyInsights: [], confidence: "high", dataLimitations: null });
    });

    await runAgentNetwork(baseInput(["business", "risk", "valuation"]));

    expect(active.maxConcurrent).toBe(1);
  });
});

describe("extractAgentJson", () => {
  it("defaults keyInsights/dataLimitations when a valid parse omits them", () => {
    const parsed = extractAgentJson('{"findings":"Strong pricing power.","confidence":"high"}');
    expect(parsed.findings).toBe("Strong pricing power.");
    expect(parsed.keyInsights).toEqual([]);
    expect(parsed.dataLimitations).toBeNull();
  });

  it("falls back to [] when keyInsights arrives as the wrong kind", () => {
    const parsed = extractAgentJson('{"findings":"ok","keyInsights":"not an array"}');
    expect(Array.isArray(parsed.keyInsights)).toBe(true);
    expect(parsed.keyInsights).toEqual([]);
  });

  it("normalizes an invented confidence variant to a valid enum value via substring match", () => {
    const parsed = extractAgentJson('{"findings":"ok","confidence":"Extremely High"}');
    expect(parsed.confidence).toBe("high");
  });

  it("falls back to low for a confidence value that matches no known substring", () => {
    const parsed = extractAgentJson('{"findings":"ok","confidence":"uncertain"}');
    expect(parsed.confidence).toBe("low");
  });

  it("falls through to prose-extraction strategy 2 on total garbage instead of throwing", () => {
    const parsed = extractAgentJson("The company shows strong fundamentals with no clear JSON structure.");
    expect(parsed.confidence).toBe("low");
    expect(parsed.dataLimitations).toBe("AI response format could not be fully parsed.");
  });
});
