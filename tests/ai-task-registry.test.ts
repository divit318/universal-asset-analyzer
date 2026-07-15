import { describe, expect, it } from "vitest";
import { TASK_REGISTRY, taskForAgentDomain, type TaskType } from "@/lib/ai/task-registry";

const tasks = Object.entries(TASK_REGISTRY) as [TaskType, (typeof TASK_REGISTRY)[TaskType]][];

describe("TASK_REGISTRY", () => {
  it("declares requirements for every task, and names no models at all", () => {
    // The registry describes what a task NEEDS; the Router decides what runs it.
    // A model id appearing here would be the old duplication creeping back —
    // 30 hand-maintained preference lists is how it drifted out of sync with the
    // models that were actually installed.
    for (const [task, config] of tasks) {
      expect(config.complexity, `task "${task}" has no complexity`).toBeTruthy();
      expect(config.latency, `task "${task}" has no latency sensitivity`).toBeTruthy();
      expect(config, `task "${task}" names a model`).not.toHaveProperty("preferredModels");
    }
  });

  it("never combines JSON output with thinking", () => {
    // Not a preference — a correctness invariant. qwen3 under format:"json" with
    // thinking on returns the literal `{}` (0/3 valid vs 3/3 with it off), and
    // `{}` parses, so the failure is silent. The Router enforces this too; this
    // catches a bad config at the source.
    for (const [task, config] of tasks) {
      if (config.jsonMode) {
        expect(config.thinking ?? false, `task "${task}" enables thinking under jsonMode`).toBe(
          false,
        );
      }
    }
  });

  it("keeps the institutional-research tasks on the deep path", () => {
    for (const task of [
      "investment-thesis",
      "sec-filing-analysis",
      "risk-review",
      "accounting-red-flags",
      "scenario-analysis",
      "ic-agent-analysis",
    ] as const) {
      expect(TASK_REGISTRY[task].complexity).toBe("deep");
    }
  });

  it("keeps the short, user-facing tasks on the fast path", () => {
    // These are what the user watches a spinner for, and none of them carry
    // research quality worth 2x the latency.
    for (const task of ["nl-screener", "quick-summary", "calendar-brief"] as const) {
      expect(TASK_REGISTRY[task].complexity).toBe("light");
      expect(TASK_REGISTRY[task].latency).toBe("interactive");
    }
  });

  it("separates the prose audit memo from the JSON portfolio tasks", () => {
    // One task cannot declare two output shapes: the CIO panel streams markdown
    // while the brief/new-position callers parse JSON.
    expect(TASK_REGISTRY["portfolio-intelligence"].jsonMode).toBe(true);
    expect(TASK_REGISTRY["portfolio-audit"].jsonMode).toBeUndefined();
  });
});

describe("taskForAgentDomain", () => {
  it("routes accounting/valuation/risk domains to their reasoning-specific tasks", () => {
    expect(taskForAgentDomain("accounting")).toBe("accounting-red-flags");
    expect(taskForAgentDomain("valuation")).toBe("scenario-analysis");
    expect(taskForAgentDomain("risk")).toBe("risk-review");
  });

  it("falls back to the generic IC agent task for other domains", () => {
    for (const domain of [
      "business",
      "industry",
      "competition",
      "management",
      "capitalAllocation",
      "governance",
    ] as const) {
      expect(taskForAgentDomain(domain)).toBe("ic-agent-analysis");
    }
  });
});
