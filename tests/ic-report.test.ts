import { describe, it, expect, vi } from "vitest";

const runAgentNetworkMock = vi.fn();
vi.mock("@/lib/ic-agents", () => ({ runAgentNetwork: (...args: unknown[]) => runAgentNetworkMock(...args) }));
vi.mock("@/lib/ai/router", () => ({ pickModel: vi.fn().mockResolvedValue("test-model") }));

const { generateICReport } = await import("@/lib/ic-report");

describe("generateICReport", () => {
  it("throws instead of forming a thesis from zero agent findings", async () => {
    runAgentNetworkMock.mockResolvedValue({
      findings: [],
      failures: [
        { agent: "business", agentLabel: "Business Analyst", error: "Ollama request timed out" },
      ],
    });

    await expect(
      generateICReport({ symbol: "TEST", companyName: "Test Corp" }),
    ).rejects.toThrow(/all.*investigation agents failed/i);
  });
});
