import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetHealth } from "@/lib/ai/health";
import {
  AllModelsFailedError,
  candidateModels,
  pickModel,
  route,
  scoreModels,
} from "@/lib/ai/router";
import { TASK_REGISTRY } from "@/lib/ai/task-registry";
import { specForInstalled } from "@/lib/ai/models";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
} from "@/lib/ai/provider";

/** A scriptable fake provider: each model id maps to a canned result or an error to throw. */
class FakeProvider implements AIProvider {
  readonly id = "fake";
  calls: string[] = [];
  /** Every request the router issued — lets us assert on generation settings, not just model choice. */
  requests: ProviderCompleteRequest[] = [];

  constructor(
    private installed: ProviderModelInfo[],
    private behavior: Record<string, ProviderCompleteResult | Error>,
  ) {}

  async listModels(): Promise<ProviderModelInfo[]> {
    return this.installed;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { reachable: this.installed.length > 0, models: this.installed.map((m) => m.id) };
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    this.calls.push(request.model);
    this.requests.push(request);
    const outcome = this.behavior[request.model];
    if (outcome === undefined) throw new Error(`unscripted model ${request.model}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }

  async *stream(): AsyncGenerator<string, void, unknown> {
    yield "unused";
  }
}

/** The models actually installed on the dev machine, with their real sizes. */
const INSTALLED: ProviderModelInfo[] = [
  { id: "qwen3:30b-a3b", sizeGb: 18.6 },
  { id: "qwen3:14b", sizeGb: 9.3 },
  { id: "mistral:latest", sizeGb: 4.4 },
  { id: "qwen2.5-coder:14b", sizeGb: 9.0 },
];

beforeEach(() => {
  resetHealth();
  // A 17GB-class machine: 12.75GB budget. Pinned so these tests assert routing
  // policy rather than the size of whatever box CI happens to run on.
  process.env.AI_MAX_MODEL_GB = "12.75";
});

afterEach(() => {
  delete process.env.AI_MAX_MODEL_GB;
  delete process.env.AI_DISABLED_MODELS;
  delete process.env.AI_TASK_NL_SCREENER;
});

describe("memory feasibility gate", () => {
  it("excludes a model whose weights exceed the memory budget", () => {
    // qwen3:30b-a3b is the highest-quality model in the registry, so a purely
    // quality-driven scorer would pick it for a deep task. It is 18.6GB on a
    // 12.75GB budget: it cannot stay resident, and measured at 0.9 tok/s (302s
    // for one answer). Eligibility, not ranking — it must not appear at all.
    const candidates = candidateModels(
      "investment-thesis",
      TASK_REGISTRY["investment-thesis"],
      INSTALLED,
    );
    expect(candidates).not.toContain("qwen3:30b-a3b");
    expect(candidates[0]).toBe("qwen3:14b");
  });

  it("admits the big model when the machine actually has the memory for it", () => {
    process.env.AI_MAX_MODEL_GB = "48"; // a 64GB workstation
    const candidates = candidateModels(
      "investment-thesis",
      TASK_REGISTRY["investment-thesis"],
      INSTALLED,
    );
    // Same registry, same code — the better model becomes routable purely because
    // the hardware can hold it.
    expect(candidates[0]).toBe("qwen3:30b-a3b");
  });

  it("falls back to an over-budget model rather than failing when nothing else is installed", () => {
    const candidates = candidateModels("company-research", TASK_REGISTRY["company-research"], [
      { id: "qwen3:30b-a3b", sizeGb: 18.6 },
    ]);
    expect(candidates).toEqual(["qwen3:30b-a3b"]);
  });
});

describe("scoring", () => {
  it("prefers the faster model for a light, interactive task", () => {
    // nl-screener parses a search box. There is no research quality to protect,
    // and a human is watching a spinner — mistral answers in ~7s vs ~17s.
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], INSTALLED);
    expect(candidates[0]).toBe("mistral:latest");
  });

  it("prefers the stronger model for a deep, background task", () => {
    // An IC risk review is the product. It runs in the background, so paying 2x
    // the latency for materially better reasoning is the right trade.
    const candidates = candidateModels("risk-review", TASK_REGISTRY["risk-review"], INSTALLED);
    expect(candidates[0]).toBe("qwen3:14b");
  });

  it("is deterministic — identical inputs always produce identical order", () => {
    const specs = INSTALLED.map((m) => specForInstalled(m.id));
    const a = scoreModels(TASK_REGISTRY["company-research"], specs).map((s) => s.id);
    const b = scoreModels(TASK_REGISTRY["company-research"], [...specs].reverse()).map((s) => s.id);
    expect(a).toEqual(b);
  });
});

describe("capability gates", () => {
  it("routes a coding task only to a coding-capable model", () => {
    const candidates = candidateModels("coding", TASK_REGISTRY.coding, INSTALLED);
    expect(candidates[0]).toBe("qwen2.5-coder:14b");
  });

  it("never prefers an unknown model, which the registry cannot vouch for", () => {
    // Regression: the old genericSpec() inferred capabilities from the model's
    // NAME, which tagged devstral (23.6B, dense, coding) as "fast". An unknown
    // model now gets no capabilities, so a capable known model always wins.
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], [
      { id: "mistral:latest", sizeGb: 4.4 },
      { id: "some-unknown-model:latest", sizeGb: 5 },
    ]);
    expect(candidates[0]).toBe("mistral:latest");
  });

  it("still offers an unknown model as a last resort rather than failing outright", () => {
    const candidates = candidateModels("company-research", TASK_REGISTRY["company-research"], [
      { id: "some-unknown-model:latest", sizeGb: 5 },
    ]);
    expect(candidates).toEqual(["some-unknown-model:latest"]);
  });

  it("returns nothing when nothing at all is installed", () => {
    expect(candidateModels("coding", TASK_REGISTRY.coding, [])).toHaveLength(0);
  });

  it("still leaves a deep task a degraded fallback behind its capable model", () => {
    // Only qwen3:14b carries the `reasoning` capability on this host. If the
    // candidate list were capability-only, every deep task would have exactly
    // ONE model and no recovery — a single timeout would hard-fail an IC report
    // instead of degrading to a weaker but working answer.
    const candidates = candidateModels("risk-review", TASK_REGISTRY["risk-review"], INSTALLED);
    expect(candidates[0]).toBe("qwen3:14b"); // capable model still wins
    expect(candidates.length).toBeGreaterThan(1); // ...but it is not alone
    expect(candidates).toContain("mistral:latest");
  });
});

describe("configuration", () => {
  it("honors an env pin, overriding the scorer", () => {
    process.env.AI_TASK_NL_SCREENER = "qwen3:14b";
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], INSTALLED);
    expect(candidates[0]).toBe("qwen3:14b"); // scorer would have said mistral
  });

  it("does not let a pin smuggle a model past the memory gate", () => {
    process.env.AI_TASK_NL_SCREENER = "qwen3:30b-a3b";
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], INSTALLED);
    expect(candidates).not.toContain("qwen3:30b-a3b");
    expect(candidates[0]).toBe("mistral:latest"); // falls through to normal scoring
  });

  it("removes a disabled model from routing entirely", () => {
    process.env.AI_DISABLED_MODELS = "mistral:latest";
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], INSTALLED);
    expect(candidates).not.toContain("mistral:latest");
  });
});

describe("thinking control", () => {
  it("forces thinking OFF for a JSON task", async () => {
    // The platform's worst bug: qwen3 under format:"json" WITH thinking on
    // returns the literal two-token string `{}` — 0/3 valid across trials vs 3/3
    // with thinking off. `{}` parses cleanly, so every JSON task silently
    // received an empty object and rendered its fallback.
    const provider = new FakeProvider([{ id: "qwen3:14b", sizeGb: 9.3 }], {
      "qwen3:14b": { content: '{"verdict":"BUY"}', reasoning: "" },
    });
    await route(
      "investment-thesis",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(provider.requests[0].json).toBe(true);
    expect(provider.requests[0].thinking).toBe(false);
  });

  it("does not send a thinking flag to a model with no reasoning channel", async () => {
    const provider = new FakeProvider([{ id: "mistral:latest", sizeGb: 4.4 }], {
      "mistral:latest": { content: "{}", reasoning: "" },
    });
    await route(
      "nl-screener",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(provider.requests[0].thinking).toBeUndefined();
  });
});

describe("route", () => {
  it("returns a normalized response from the first successful candidate", async () => {
    const provider = new FakeProvider([{ id: "qwen3:14b", sizeGb: 9.3 }], {
      "qwen3:14b": { content: "answer", reasoning: "" },
    });
    const res = await route(
      "company-research",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("answer");
    expect(res.model).toBe("qwen3:14b");
    expect(res.provider).toBe("fake");
    expect(res.errors).toEqual([]);
  });

  it("falls back to the next candidate when the first fails, without surfacing the failure", async () => {
    const provider = new FakeProvider(
      [
        { id: "qwen3:14b", sizeGb: 9.3 },
        { id: "mistral:latest", sizeGb: 4.4 },
      ],
      {
        "qwen3:14b": new Error("timeout"),
        "mistral:latest": { content: "fallback answer", reasoning: "" },
      },
    );
    const res = await route(
      "explain-movement",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("fallback answer");
    expect(res.model).toBe("mistral:latest");
    expect(res.errors).toEqual(["qwen3:14b: timeout"]);
    expect(provider.calls).toEqual(["qwen3:14b", "mistral:latest"]);
  });

  it("throws AllModelsFailedError when every candidate fails", async () => {
    const provider = new FakeProvider(
      [
        { id: "qwen3:14b", sizeGb: 9.3 },
        { id: "mistral:latest", sizeGb: 4.4 },
      ],
      {
        "qwen3:14b": new Error("timeout"),
        "mistral:latest": new Error("connection refused"),
      },
    );
    await expect(
      route(
        "company-research",
        { messages: [{ role: "user", content: "hi" }] },
        { providers: [provider] },
      ),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
  });

  it("throws AllModelsFailedError immediately when nothing is installed", async () => {
    const provider = new FakeProvider([], {});
    await expect(
      route(
        "company-research",
        { messages: [{ role: "user", content: "hi" }] },
        { providers: [provider] },
      ),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
  });

  it("honors an explicit model override and does not substitute another model on failure", async () => {
    const provider = new FakeProvider(
      [
        { id: "qwen3:14b", sizeGb: 9.3 },
        { id: "mistral:latest", sizeGb: 4.4 },
      ],
      { "mistral:latest": new Error("timeout") },
    );
    await expect(
      route(
        "company-research",
        { messages: [{ role: "user", content: "hi" }] },
        { providers: [provider], model: "mistral:latest" },
      ),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
    expect(provider.calls).toEqual(["mistral:latest"]);
  });

  it("deprioritizes a model after repeated failures on a later route() call", async () => {
    const provider = new FakeProvider(
      [
        { id: "qwen3:14b", sizeGb: 9.3 },
        { id: "mistral:latest", sizeGb: 4.4 },
      ],
      {
        "qwen3:14b": new Error("timeout"),
        "mistral:latest": { content: "ok", reasoning: "" },
      },
    );
    // Two failures trip the health cooldown for qwen3:14b.
    for (const q of ["1", "2"]) {
      await route(
        "company-research",
        { messages: [{ role: "user", content: q }] },
        { providers: [provider] },
      );
    }
    provider.calls = [];

    const res = await route(
      "explain-movement",
      { messages: [{ role: "user", content: "3" }] },
      { providers: [provider] },
    );
    expect(res.model).toBe("mistral:latest");
    expect(provider.calls[0]).toBe("mistral:latest"); // the cooling model is no longer tried first
  });
});

describe("pickModel", () => {
  it("returns the top candidate for the task without running anything", async () => {
    const provider = new FakeProvider(INSTALLED, {});
    const model = await pickModel("company-research", { providers: [provider] });
    expect(model).toBe("qwen3:14b");
    expect(provider.calls).toEqual([]); // pickModel never calls complete()
  });

  it("uses a pre-fetched installed list when provided, skipping listModels()", async () => {
    const model = await pickModel("company-research", {
      installed: [{ id: "mistral:latest", sizeGb: 4.4 }],
    });
    expect(model).toBe("mistral:latest");
  });
});

/**
 * A blown deadline is a fact about the HOST, not about the model.
 *
 * `route()` treated it like any other model failure and tried the remaining
 * candidates, so one 45s budget became a 2m15s wait across three models — and
 * every one of those attempts was doomed for the same reason the first was.
 * A caller abort is worse still: nobody is waiting for the answer, yet the chain
 * kept occupying Ollama, which serializes generations and so delays every other
 * queued request.
 */
describe("route: deliberate aborts stop the fallback chain", () => {
  const twoModels: ProviderModelInfo[] = [
    { id: "qwen3:14b", sizeGb: 9.3 },
    { id: "mistral:latest", sizeGb: 4.4 },
  ];

  it("does NOT try the next candidate after a deadline expires", async () => {
    const provider = new FakeProvider(twoModels, {
      "qwen3:14b": new DOMException("timed out", "TimeoutError"),
      "mistral:latest": { content: "should never be reached", reasoning: "" },
    });
    await expect(
      route("explain-movement", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] }),
    ).rejects.toThrow(/timed out/);
    expect(provider.calls).toEqual(["qwen3:14b"]);
  });

  it("does NOT try the next candidate after the caller aborts", async () => {
    const provider = new FakeProvider(twoModels, {
      "qwen3:14b": new DOMException("aborted", "AbortError"),
      "mistral:latest": { content: "should never be reached", reasoning: "" },
    });
    await expect(
      route("explain-movement", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] }),
    ).rejects.toThrow(/aborted/);
    expect(provider.calls).toEqual(["qwen3:14b"]);
  });

  it("still falls back on an ordinary model failure", async () => {
    const provider = new FakeProvider(twoModels, {
      "qwen3:14b": new Error("model exploded"),
      "mistral:latest": { content: "fallback answer", reasoning: "" },
    });
    const res = await route(
      "explain-movement",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("fallback answer");
    expect(provider.calls).toEqual(["qwen3:14b", "mistral:latest"]);
  });
});

/**
 * Cold load, not generation, is what makes a local model feel broken: 69.6s to
 * load a 4.4GB model vs 0.4s to answer, measured. At Ollama's 5-minute default
 * an occasional user pays that load almost every time.
 */
describe("route: keepAlive", () => {
  const installed: ProviderModelInfo[] = [{ id: "mistral:latest", sizeGb: 4.4 }];
  const ok = { "mistral:latest": { content: "{}", reasoning: "" } };

  it("holds the model for tasks a human is waiting on", async () => {
    const provider = new FakeProvider(installed, ok);
    await route("app-assistant", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] });
    expect(provider.requests[0].keepAlive).toBe("30m");
  });

  it("does not pin memory for background work", async () => {
    const provider = new FakeProvider(installed, ok);
    await route("investment-thesis", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] });
    expect(provider.requests[0].keepAlive).toBeUndefined();
  });
});
