import { beforeEach, describe, expect, it } from "vitest";
import { resetHealth } from "@/lib/ai/health";
import { AllModelsFailedError, candidateModels, pickModel, route } from "@/lib/ai/router";
import { TASK_REGISTRY } from "@/lib/ai/task-registry";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
} from "@/lib/ai/provider";

/** A scriptable fake provider: each model id maps to a canned result or an error to throw. */
class FakeProvider implements AIProvider {
  readonly id = "fake";
  calls: string[] = [];

  constructor(
    private installed: string[],
    private behavior: Record<string, ProviderCompleteResult | Error>,
  ) {}

  async listModels(): Promise<string[]> {
    return this.installed;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { reachable: this.installed.length > 0, models: this.installed };
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    this.calls.push(request.model);
    const outcome = this.behavior[request.model];
    if (outcome === undefined) throw new Error(`unscripted model ${request.model}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }

  async *stream(): AsyncGenerator<string, void, unknown> {
    yield "unused";
  }
}

beforeEach(() => {
  resetHealth();
});

describe("candidateModels", () => {
  it("prefix-matches a preferred registry id against a tagged installed model", () => {
    const candidates = candidateModels(TASK_REGISTRY["company-research"], ["qwen3:30b-a3b", "mistral:latest"]);
    expect(candidates[0]).toBe("qwen3:30b-a3b");
  });

  it("falls back to any installed model when nothing preferred is installed", () => {
    const candidates = candidateModels(TASK_REGISTRY["company-research"], ["mistral:7b"]);
    expect(candidates).toContain("mistral:7b");
  });

  it("does not match an unrelated model that merely shares a text prefix with a preferred one", () => {
    // Regression: "qwen3-coder" is a different, coding-specialized model —
    // it must not satisfy a "qwen3" preference just because the string
    // starts the same. Only devstral/qwen2.5-coder/mistral are installed
    // (real repro case), so this should land in the ungoverned fallback tier.
    const candidates = candidateModels(TASK_REGISTRY["comparison"], [
      "devstral:24b",
      "qwen2.5-coder:14b",
      "qwen3-coder:latest",
      "mistral:latest",
    ]);
    expect(candidates).not.toContain("qwen3-coder:latest");
  });

  it("falls back to an installed model the registry has never heard of, rather than failing", () => {
    // Regression: e.g. "devstral" doesn't fuzzy-match any MODEL_REGISTRY id.
    const candidates = candidateModels(TASK_REGISTRY["company-research"], ["devstral:latest"]);
    expect(candidates).toEqual(["devstral:latest"]);
  });

  it("prefers a capability-matching model over one that lacks the required capability", () => {
    const candidates = candidateModels(TASK_REGISTRY.coding, ["qwen2.5-coder:7b", "mistral:7b"]);
    expect(candidates[0]).toBe("qwen2.5-coder:7b");
  });

  it("still offers a non-matching installed model as a last resort rather than failing outright", () => {
    // Only mistral is installed — it isn't coding-capable, but graceful
    // degradation means the task still gets a candidate to try.
    const candidates = candidateModels(TASK_REGISTRY.coding, ["mistral:7b"]);
    expect(candidates).toContain("mistral:7b");
  });

  it("returns nothing when nothing at all is installed", () => {
    const candidates = candidateModels(TASK_REGISTRY.coding, []);
    expect(candidates).toHaveLength(0);
  });
});

describe("route", () => {
  it("returns a normalized response from the first successful candidate", async () => {
    const provider = new FakeProvider(["qwen3:8b"], {
      "qwen3:8b": { content: "answer", reasoning: "" },
    });
    const res = await route(
      "company-research",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("answer");
    expect(res.model).toBe("qwen3:8b");
    expect(res.provider).toBe("fake");
    expect(res.errors).toEqual([]);
  });

  it("falls back to the next preferred model when the first fails, without surfacing the failure", async () => {
    const provider = new FakeProvider(["qwen3:8b", "deepseek-r1:7b"], {
      "qwen3:8b": new Error("timeout"),
      "deepseek-r1:7b": { content: "fallback answer", reasoning: "" },
    });
    const res = await route(
      "company-research",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("fallback answer");
    expect(res.model).toBe("deepseek-r1:7b");
    expect(res.errors).toEqual(["qwen3:8b: timeout"]);
    expect(provider.calls).toEqual(["qwen3:8b", "deepseek-r1:7b"]);
  });

  it("throws AllModelsFailedError when every candidate fails", async () => {
    const provider = new FakeProvider(["qwen3:8b", "deepseek-r1:7b"], {
      "qwen3:8b": new Error("timeout"),
      "deepseek-r1:7b": new Error("connection refused"),
    });
    await expect(
      route("company-research", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] }),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
  });

  it("throws AllModelsFailedError immediately when nothing is installed", async () => {
    const provider = new FakeProvider([], {});
    await expect(
      route("company-research", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] }),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
  });

  it("honors an explicit model override and does not substitute another model on failure", async () => {
    const provider = new FakeProvider(["qwen3:8b", "deepseek-r1:7b"], {
      "deepseek-r1:7b": new Error("timeout"),
    });
    await expect(
      route(
        "company-research",
        { messages: [{ role: "user", content: "hi" }] },
        { providers: [provider], model: "deepseek-r1:7b" },
      ),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
    expect(provider.calls).toEqual(["deepseek-r1:7b"]);
  });

  it("deprioritizes a model after repeated failures on a later route() call", async () => {
    const provider = new FakeProvider(["qwen3:8b", "deepseek-r1:7b"], {
      "qwen3:8b": new Error("timeout"),
      "deepseek-r1:7b": { content: "ok", reasoning: "" },
    });
    // Two failures trip the health cooldown for qwen3:8b.
    await route("company-research", { messages: [{ role: "user", content: "1" }] }, { providers: [provider] });
    provider.calls = [];
    await route("company-research", { messages: [{ role: "user", content: "2" }] }, { providers: [provider] });
    provider.calls = [];

    const res = await route(
      "company-research",
      { messages: [{ role: "user", content: "3" }] },
      { providers: [provider] },
    );
    // Unhealthy qwen3:8b is tried last now, but deepseek-r1:7b still answers.
    expect(res.model).toBe("deepseek-r1:7b");
  });
});

describe("pickModel", () => {
  it("returns the top candidate for the task without running anything", async () => {
    const provider = new FakeProvider(["mistral:7b", "qwen3:8b"], {});
    const model = await pickModel("company-research", { providers: [provider] });
    expect(model).toBe("qwen3:8b");
    expect(provider.calls).toEqual([]); // pickModel never calls complete()
  });

  it("uses a pre-fetched installed list when provided, skipping listModels()", async () => {
    const model = await pickModel("company-research", { installed: ["deepseek-r1:7b"] });
    expect(model).toBe("deepseek-r1:7b");
  });
});
