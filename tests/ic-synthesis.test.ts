import { describe, it, expect, vi } from "vitest";
import type { AgentFinding } from "@/lib/ic-agents";

// Migrated to the analysis seam (tranche 6). The mock keeps the old
// runPromptMock recording surface — (taskType, prompt) — and wraps its JSON
// string in the seam's AnalysisResult envelope, so every existing assertion
// (including prompt-content checks) runs unchanged.
const runPromptMock = vi.fn();
vi.mock("@/lib/ai/analysis", () => ({
  runAnalysis: async (req: { taskType: string; prompt: string }) => {
    const raw = await runPromptMock(req.taskType, req.prompt);
    return {
      data: JSON.parse(String(raw)) as Record<string, unknown>,
      provider: "ollama" as const,
      meta: { durationMs: 1 },
    };
  },
}));

const { dedupeInsights, insightSimilarity, collectDataGaps, synthesiseFindings } = await import("@/lib/ic-synthesis");

function finding(agentLabel: string, keyInsights: string[], dataLimitations: string | null = null): AgentFinding {
  return {
    agent: "business",
    agentLabel,
    questionsAnswered: 1,
    questionsAssigned: 1,
    findings: `${agentLabel} findings text about margins and growth.`,
    keyInsights,
    confidence: "medium",
    confidenceDowngraded: null,
    dataLimitations,
    promptVersion: "test",
  };
}

describe("insightSimilarity", () => {
  it("scores near-identical statements high and unrelated ones low", () => {
    const a = "Gross margin of 74.1% shows exceptional pricing power";
    const b = "Exceptional pricing power shown by the 74.1% gross margin";
    const c = "FII holding dropped 2.1pp over the last quarter";
    expect(insightSimilarity(a, b)).toBeGreaterThan(0.6);
    expect(insightSimilarity(a, c)).toBeLessThan(0.2);
  });
});

describe("dedupeInsights", () => {
  it("folds repeated facts across agents into one with attribution", () => {
    const findings = [
      finding("Business Analyst", ["Gross margin of 74.1% shows exceptional pricing power"]),
      finding("Competitive Intelligence Analyst", ["Exceptional pricing power shown by the 74.1% gross margin"]),
      finding("Risk Analyst", ["Leverage is minimal with net cash of $40B"]),
    ];
    const { deduped, removed } = dedupeInsights(findings);
    expect(removed).toBe(1);
    expect(deduped).toHaveLength(2);
    const first = deduped.find((d) => d.insight.includes("74.1%"))!;
    expect(first.agent).toBe("Business Analyst");
    expect(first.alsoStatedBy).toEqual(["Competitive Intelligence Analyst"]);
  });
});

describe("collectDataGaps", () => {
  it("collects only real limitation strings", () => {
    const gaps = collectDataGaps([
      finding("A", [], "Missing segment data"),
      finding("B", [], null),
      finding("C", [], "null"),
    ]);
    expect(gaps).toEqual([{ agent: "A", limitation: "Missing segment data" }]);
  });
});

describe("synthesiseFindings", () => {
  it("validates disagreements against the agents that actually ran", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      disagreements: [
        {
          topic: "Margin sustainability",
          positions: [
            { agent: "Business Analyst", position: "sustainable" },
            { agent: "Risk Analyst", position: "cyclical peak" },
          ],
        },
        {
          topic: "Fabricated",
          positions: [
            { agent: "Nonexistent Agent", position: "x" },
            { agent: "Business Analyst", position: "y" },
          ],
        },
      ],
      crossAgentSummary: "The network established a real tension between margin quality and cyclicality.",
    }));

    const r = await synthesiseFindings("Test Corp", "TEST", [
      finding("Business Analyst", ["a"]),
      finding("Risk Analyst", ["b"]),
    ]);
    expect(r.disagreements).toHaveLength(1);
    expect(r.disagreements[0].topic).toBe("Margin sustainability");
    expect(r.crossAgentSummary).toContain("tension");
    expect(r.modelUnavailable).toBe(false);
  });

  it("degrades gracefully to deterministic outputs when the model fails", async () => {
    runPromptMock.mockRejectedValue(new Error("no model"));
    const r = await synthesiseFindings("Test Corp", "TEST", [
      finding("Business Analyst", ["a"], "thin data"),
      finding("Risk Analyst", ["b"]),
    ]);
    expect(r.modelUnavailable).toBe(true);
    expect(r.dedupedInsights).toHaveLength(2);
    expect(r.dataGapAgents).toEqual([{ agent: "Business Analyst", limitation: "thin data" }]);
  });
});
