import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY } from "@/lib/ai/models";
import { TASK_REGISTRY, taskForAgentDomain, type TaskType } from "@/lib/ai/task-registry";

const registryModelIds = new Set(MODEL_REGISTRY.map((m) => m.id));

describe("TASK_REGISTRY", () => {
  it("gives every task at least one preferred model that resolves in the registry", () => {
    for (const [task, config] of Object.entries(TASK_REGISTRY) as [TaskType, (typeof TASK_REGISTRY)[TaskType]][]) {
      expect(config.preferredModels.length, `task "${task}" has no preferred models`).toBeGreaterThan(0);
      for (const modelId of config.preferredModels) {
        expect(registryModelIds.has(modelId), `task "${task}" references unknown model "${modelId}"`).toBe(true);
      }
    }
  });

  it("routes reasoning-heavy financial-analysis tasks to DeepSeek R1 first, per the routing brief", () => {
    expect(TASK_REGISTRY["sec-filing-analysis"].preferredModels[0]).toBe("deepseek-r1");
    expect(TASK_REGISTRY["risk-review"].preferredModels[0]).toBe("deepseek-r1");
    expect(TASK_REGISTRY["accounting-red-flags"].preferredModels[0]).toBe("deepseek-r1");
    expect(TASK_REGISTRY["scenario-analysis"].preferredModels[0]).toBe("deepseek-r1");
    expect(TASK_REGISTRY["stress-testing"].preferredModels[0]).toBe("deepseek-r1");
  });

  it("routes general research/intelligence tasks to Qwen3 first, per the routing brief", () => {
    expect(TASK_REGISTRY["company-research"].preferredModels[0]).toBe("qwen3");
    expect(TASK_REGISTRY["portfolio-intelligence"].preferredModels[0]).toBe("qwen3");
    expect(TASK_REGISTRY["watchlist-intelligence"].preferredModels[0]).toBe("qwen3");
    expect(TASK_REGISTRY["opportunity-engine"].preferredModels[0]).toBe("qwen3");
    expect(TASK_REGISTRY["investment-thesis"].preferredModels[0]).toBe("qwen3");
  });

  it("routes coding tasks to the coder model and requires the coding capability", () => {
    expect(TASK_REGISTRY.coding.preferredModels[0]).toBe("qwen2.5-coder");
    expect(TASK_REGISTRY.coding.requiredCapabilities).toContain("coding");
  });
});

describe("taskForAgentDomain", () => {
  it("routes accounting/valuation/risk domains to their reasoning-specific tasks", () => {
    expect(taskForAgentDomain("accounting")).toBe("accounting-red-flags");
    expect(taskForAgentDomain("valuation")).toBe("scenario-analysis");
    expect(taskForAgentDomain("risk")).toBe("risk-review");
  });

  it("falls back to the generic IC agent task for other domains", () => {
    expect(taskForAgentDomain("business")).toBe("ic-agent-analysis");
    expect(taskForAgentDomain("industry")).toBe("ic-agent-analysis");
    expect(taskForAgentDomain("competition")).toBe("ic-agent-analysis");
    expect(taskForAgentDomain("management")).toBe("ic-agent-analysis");
    expect(taskForAgentDomain("capitalAllocation")).toBe("ic-agent-analysis");
    expect(taskForAgentDomain("governance")).toBe("ic-agent-analysis");
  });
});
