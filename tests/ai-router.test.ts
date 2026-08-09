import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyAiError } from "@/lib/ai/errors";
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

/**
 * A scriptable fake provider: each model id maps to a canned result or an
 * error to throw. Its id is "fake" — an UNRECOGNISED provider id — so the
 * Router gives it the conservative LOCAL treatment (generation gate, warm
 * probe, cold-start budget). That is deliberate: the local machinery is
 * dormant in production (the only registered provider is hosted) but it is
 * still the contract a future local runtime gets, and these tests keep it
 * honest.
 */
class FakeProvider implements AIProvider {
  readonly id = "fake";
  calls: string[] = [];
  /** Every request the router issued — lets us assert on generation settings, not just model choice. */
  requests: ProviderCompleteRequest[] = [];

  constructor(
    private installed: ProviderModelInfo[],
    private behavior: Record<string, ProviderCompleteResult | Error>,
    /** Which models are "resident" per isModelWarm — defaults to warm (true) for anything not listed, matching a provider that can't tell (the Router's own fallback). */
    private warm: Record<string, boolean> = {},
  ) {}

  async listModels(): Promise<ProviderModelInfo[]> {
    return this.installed;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { reachable: this.installed.length > 0, models: this.installed.map((m) => m.id) };
  }

  async isModelWarm(model: string): Promise<boolean> {
    return this.warm[model] ?? true;
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

/** The three Claude effort tiers — everything the anthropic provider offers. */
const TIERS: ProviderModelInfo[] = [
  { id: "claude-opus-5-high", sizeGb: 0 },
  { id: "claude-opus-5-medium", sizeGb: 0 },
  { id: "claude-opus-5-low", sizeGb: 0 },
];

/**
 * Unknown model ids (genericSpec: no capabilities, 120s timeout, no measured
 * cold budget) served by the local-treated FakeProvider — the stand-ins the
 * cold-start and health tests use. `derivatives-research` is the one task
 * with no TASK_MODEL_PINS entry, so it reaches the scorer rather than a pin.
 */
const SIM_A: ProviderModelInfo = { id: "sim-model-a", sizeGb: 0 };
const SIM_B: ProviderModelInfo = { id: "sim-model-b", sizeGb: 0 };
const UNPINNED_TASK = "derivatives-research" as const;

beforeEach(() => {
  resetHealth();
});

afterEach(() => {
  delete process.env.AI_MAX_MODEL_GB;
  delete process.env.AI_DISABLED_MODELS;
  delete process.env.AI_TASK_NL_SCREENER;
});

describe("memory feasibility gate", () => {
  it("never gates a hosted model, however tiny the budget", () => {
    // The gate exists for local weights competing for RAM. The hosted tiers
    // load nothing here — even an absurd budget must not exclude them.
    process.env.AI_MAX_MODEL_GB = "0.001";
    const candidates = candidateModels(
      "investment-thesis",
      TASK_REGISTRY["investment-thesis"],
      TIERS,
    );
    expect(candidates[0]).toBe("claude-opus-5-high");
  });
});

describe("scoring", () => {
  it("prefers the fastest tier for a light, interactive task", () => {
    // nl-screener parses a search box. There is no research quality to
    // protect, and a human is watching a spinner.
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], TIERS);
    expect(candidates[0]).toBe("claude-opus-5-low");
  });

  it("prefers the deepest tier for a deep, background task", () => {
    // An IC risk review is the product. It runs in the background, so paying
    // the latency for the largest reasoning budget is the right trade.
    const candidates = candidateModels("risk-review", TASK_REGISTRY["risk-review"], TIERS);
    expect(candidates[0]).toBe("claude-opus-5-high");
  });

  it("the scorer itself ranks quality-first for deep work and speed-first for standard interactive work", () => {
    const specs = TIERS.map((m) => specForInstalled(m.id));
    expect(scoreModels(TASK_REGISTRY["risk-review"], specs)[0].id).toBe("claude-opus-5-high");
    expect(scoreModels(TASK_REGISTRY[UNPINNED_TASK], specs)[0].id).toBe("claude-opus-5-low");
  });

  it("is deterministic — identical inputs always produce identical order", () => {
    const specs = TIERS.map((m) => specForInstalled(m.id));
    const a = scoreModels(TASK_REGISTRY["company-research"], specs).map((s) => s.id);
    const b = scoreModels(TASK_REGISTRY["company-research"], [...specs].reverse()).map((s) => s.id);
    expect(a).toEqual(b);
  });
});

describe("capability gates", () => {
  it("never prefers an unknown model, which the registry cannot vouch for", () => {
    // An unknown model gets no capabilities, so a capable known model always
    // wins — the registry must vouch for anything the Router prefers.
    const candidates = candidateModels(UNPINNED_TASK, TASK_REGISTRY[UNPINNED_TASK], [
      { id: "claude-opus-5-low", sizeGb: 0 },
      { id: "some-unknown-model", sizeGb: 0 },
    ]);
    expect(candidates[0]).toBe("claude-opus-5-low");
  });

  it("still offers an unknown model as a last resort rather than failing outright", () => {
    const candidates = candidateModels(UNPINNED_TASK, TASK_REGISTRY[UNPINNED_TASK], [SIM_A]);
    expect(candidates).toEqual(["sim-model-a"]);
  });

  it("returns nothing when nothing at all is installed", () => {
    expect(candidateModels("coding", TASK_REGISTRY.coding, [])).toHaveLength(0);
  });
});

describe("configuration", () => {
  it("honors an env pin, overriding the static pin and the scorer", () => {
    process.env.AI_TASK_NL_SCREENER = "claude-opus-5-high";
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], TIERS);
    expect(candidates[0]).toBe("claude-opus-5-high"); // pin/scorer would have said low
  });

  it("a pin cannot conjure a model the provider does not offer", () => {
    process.env.AI_TASK_NL_SCREENER = "claude-opus-9-max";
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], TIERS);
    expect(candidates).not.toContain("claude-opus-9-max");
    expect(candidates[0]).toBe("claude-opus-5-low"); // falls through to normal routing
  });

  it("removes a disabled model from routing entirely", () => {
    process.env.AI_DISABLED_MODELS = "claude-opus-5-low";
    const candidates = candidateModels("nl-screener", TASK_REGISTRY["nl-screener"], TIERS);
    expect(candidates).not.toContain("claude-opus-5-low");
  });
});

describe("thinking control", () => {
  it("does not send a thinking flag to a model with no per-request toggle", async () => {
    // The Claude effort tiers carry depth in the model id; there is no think
    // flag to send, and sending one anyway would be a wire error.
    const provider = new FakeProvider([{ id: "claude-opus-5-low", sizeGb: 0 }], {
      "claude-opus-5-low": { content: "{}", reasoning: "" },
    });
    await route(
      "nl-screener",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(provider.requests[0].thinking).toBeUndefined();
    expect(provider.requests[0].json).toBe(true);
  });
});

describe("native structured outputs pass-through", () => {
  it("hands the caller's JSON Schema to the provider unchanged", async () => {
    const provider = new FakeProvider([{ id: "claude-opus-5-low", sizeGb: 0 }], {
      "claude-opus-5-low": { content: "{}", reasoning: "" },
    });
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    await route(
      "nl-screener",
      { messages: [{ role: "user", content: "hi" }], jsonSchema: schema },
      { providers: [provider] },
    );
    expect(provider.requests[0].jsonSchema).toEqual(schema);
  });

  it("sends no schema when the caller supplied none", async () => {
    const provider = new FakeProvider([{ id: "claude-opus-5-low", sizeGb: 0 }], {
      "claude-opus-5-low": { content: "{}", reasoning: "" },
    });
    await route(
      "nl-screener",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(provider.requests[0].jsonSchema).toBeUndefined();
  });
});

describe("route", () => {
  it("returns a normalized response from the first successful candidate", async () => {
    const provider = new FakeProvider([{ id: "claude-opus-5-medium", sizeGb: 0 }], {
      "claude-opus-5-medium": { content: "answer", reasoning: "" },
    });
    const res = await route(
      "company-research",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("answer");
    expect(res.model).toBe("claude-opus-5-medium");
    expect(res.provider).toBe("fake");
    expect(res.errors).toEqual([]);
  });

  it("falls back to the next candidate when the first fails, without surfacing the failure", async () => {
    // explain-movement's pin is medium → low: a failing high-effort attempt
    // degrades to a shallower tier of the same model rather than to nothing.
    const provider = new FakeProvider(TIERS, {
      "claude-opus-5-medium": new Error("overloaded"),
      "claude-opus-5-low": { content: "fallback answer", reasoning: "" },
    });
    const res = await route(
      "explain-movement",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("fallback answer");
    expect(res.model).toBe("claude-opus-5-low");
    // Errors are prefixed with the provider that produced them.
    expect(res.errors).toEqual(["fake/claude-opus-5-medium: overloaded"]);
    expect(provider.calls).toEqual(["claude-opus-5-medium", "claude-opus-5-low"]);
  });

  it("throws AllModelsFailedError when every candidate fails", async () => {
    const provider = new FakeProvider(TIERS, {
      "claude-opus-5-high": new Error("overloaded"),
      "claude-opus-5-medium": new Error("overloaded"),
      "claude-opus-5-low": new Error("connection refused"),
    });
    await expect(
      route(
        "company-research",
        { messages: [{ role: "user", content: "hi" }] },
        { providers: [provider] },
      ),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
  });

  it("stops walking a provider's candidates once its key is rejected — same credential, same outcome", async () => {
    const invalid = Object.assign(new Error("rejected"), { code: "anthropic_key_invalid" });
    const provider = new FakeProvider(TIERS, {
      "claude-opus-5-medium": invalid,
      // Must never be reached: the low tier presents the same key.
      "claude-opus-5-low": { content: "should never be generated", reasoning: "" },
    });
    const err = await route(
      "explain-movement",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllModelsFailedError);
    expect(provider.calls).toEqual(["claude-opus-5-medium"]);
    // The wrapper stays classifiable as the real failure: a bad key, not "try again".
    expect(classifyAiError(err).category).toBe("bad_api_key");
    expect(classifyAiError(err).retryable).toBe(false);
  });

  it("throws AllModelsFailedError immediately when nothing is available (no key)", async () => {
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
    const provider = new FakeProvider(TIERS, {
      "claude-opus-5-low": new Error("overloaded"),
    });
    await expect(
      route(
        "company-research",
        { messages: [{ role: "user", content: "hi" }] },
        { providers: [provider], model: "claude-opus-5-low" },
      ),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
    expect(provider.calls).toEqual(["claude-opus-5-low"]);
  });

  it("deprioritizes a model after repeated failures on a later route() call", async () => {
    const provider = new FakeProvider([SIM_A, SIM_B], {
      "sim-model-a": new Error("overloaded"),
      "sim-model-b": { content: "ok", reasoning: "" },
    });
    // Two failures trip the health cooldown for sim-model-a.
    for (const q of ["1", "2"]) {
      await route(
        UNPINNED_TASK,
        { messages: [{ role: "user", content: q }] },
        { providers: [provider] },
      );
    }
    provider.calls = [];

    const res = await route(
      UNPINNED_TASK,
      { messages: [{ role: "user", content: "3" }] },
      { providers: [provider] },
    );
    expect(res.model).toBe("sim-model-b");
    expect(provider.calls[0]).toBe("sim-model-b"); // the cooling model is no longer tried first
  });
});

describe("pickModel", () => {
  it("returns the top candidate for the task without running anything", async () => {
    const provider = new FakeProvider(TIERS, {});
    const model = await pickModel("company-research", { providers: [provider] });
    expect(model).toBe("claude-opus-5-medium");
    expect(provider.calls).toEqual([]); // pickModel never calls complete()
  });

  it("uses a pre-fetched installed list when provided, skipping listModels()", async () => {
    const model = await pickModel("company-research", {
      installed: [{ id: "claude-opus-5-low", sizeGb: 0 }],
    });
    expect(model).toBe("claude-opus-5-low");
  });
});

/**
 * A blown deadline is a fact about the HOST, not about the model — the rule
 * the local path enforces (FakeProvider gets the local treatment). A caller
 * abort is worse still: nobody is waiting for the answer, so the chain must
 * stop rather than spend on candidates nobody will read.
 */
describe("route: deliberate aborts stop the fallback chain", () => {
  it("does NOT try the next candidate after a deadline expires", async () => {
    const provider = new FakeProvider([SIM_A, SIM_B], {
      "sim-model-a": new DOMException("timed out", "TimeoutError"),
      "sim-model-b": { content: "should never be reached", reasoning: "" },
    });
    await expect(
      route(UNPINNED_TASK, { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] }),
    ).rejects.toThrow(/timed out/);
    expect(provider.calls).toEqual(["sim-model-a"]);
  });

  it("does NOT try the next candidate after the caller aborts", async () => {
    const provider = new FakeProvider([SIM_A, SIM_B], {
      "sim-model-a": new DOMException("aborted", "AbortError"),
      "sim-model-b": { content: "should never be reached", reasoning: "" },
    });
    await expect(
      route(UNPINNED_TASK, { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] }),
    ).rejects.toThrow(/aborted/);
    expect(provider.calls).toEqual(["sim-model-a"]);
  });

  it("still falls back on an ordinary model failure", async () => {
    const provider = new FakeProvider([SIM_A, SIM_B], {
      "sim-model-a": new Error("model exploded"),
      "sim-model-b": { content: "fallback answer", reasoning: "" },
    });
    const res = await route(
      UNPINNED_TASK,
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("fallback answer");
    expect(provider.calls).toEqual(["sim-model-a", "sim-model-b"]);
  });
});

/**
 * A COLD model timing out earns the chain exactly one extra candidate — the
 * exception to "never fall back after a timeout" that a cold load deserves.
 * Local-provider machinery: dormant in production (the hosted provider has no
 * load phase), exercised here through the local-treated FakeProvider.
 */
describe("route: cold-start timeout recovery", () => {
  it("falls back once when the COLD first candidate times out", async () => {
    const provider = new FakeProvider(
      [SIM_A, SIM_B],
      {
        "sim-model-a": new DOMException("timed out", "TimeoutError"),
        "sim-model-b": { content: "warm fallback answer", reasoning: "" },
      },
      { "sim-model-a": false }, // cold; sim-model-b defaults to warm
    );
    const res = await route(
      UNPINNED_TASK,
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [provider] },
    );
    expect(res.content).toBe("warm fallback answer");
    expect(res.model).toBe("sim-model-b");
    expect(provider.calls).toEqual(["sim-model-a", "sim-model-b"]);
  });

  it("still gives up after the ONE cold-start fallback is exhausted, rather than walking every candidate", async () => {
    const SIM_C: ProviderModelInfo = { id: "sim-model-c", sizeGb: 0 };
    const provider = new FakeProvider(
      [SIM_A, SIM_B, SIM_C],
      {
        "sim-model-a": new DOMException("timed out", "TimeoutError"),
        "sim-model-b": new DOMException("timed out", "TimeoutError"),
        "sim-model-c": { content: "should never be reached", reasoning: "" },
      },
      { "sim-model-a": false, "sim-model-b": false },
    );
    // The second timeout throws the raw TimeoutError directly (exactly like
    // the plain "deadline expires" case above) rather than wrapping it in
    // AllModelsFailedError — the fallback budget is spent.
    await expect(
      route(UNPINNED_TASK, { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] }),
    ).rejects.toThrow(/timed out/);
    expect(provider.calls).toEqual(["sim-model-a", "sim-model-b"]);
  });

  it("widens the timeout budget for a detected cold start (generic multiplier for an unmeasured model)", async () => {
    const provider = new FakeProvider(
      [SIM_A],
      { "sim-model-a": { content: "ok", reasoning: "" } },
      { "sim-model-a": false },
    );
    await route(UNPINNED_TASK, { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] });
    // genericSpec's base timeout is 120_000ms; an unmeasured model gets the
    // 1.5x generic multiplier for a detected cold start.
    expect(provider.requests[0].timeoutMs).toBe(180_000);
  });

  it("trusts a very recent local success over a probe that (now) says cold", async () => {
    const provider = new FakeProvider(
      [SIM_A],
      { "sim-model-a": { content: "ok", reasoning: "" } },
      { "sim-model-a": false },
    );
    await route(UNPINNED_TASK, { messages: [{ role: "user", content: "1" }] }, { providers: [provider] });
    expect(provider.requests[0].timeoutMs).toBe(180_000); // cold: first call, no local success yet

    await route(UNPINNED_TASK, { messages: [{ role: "user", content: "2" }] }, { providers: [provider] });
    // Second call: the probe still says cold, but we just succeeded against
    // this exact model a moment ago — that overrides the probe.
    expect(provider.requests[1].timeoutMs).toBe(120_000);
  });

  it("does not widen the timeout when the model is already warm", async () => {
    const provider = new FakeProvider(
      [SIM_A],
      { "sim-model-a": { content: "ok", reasoning: "" } },
      { "sim-model-a": true },
    );
    await route(UNPINNED_TASK, { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] });
    expect(provider.requests[0].timeoutMs).toBe(120_000);
  });
});

/**
 * A caller cancelling is withdrawal, not a verdict on the model — it must
 * never trip the health cooldown that repeated real failures do.
 */
describe("route: cancellation does not penalize model health", () => {
  it("does not mark the model unhealthy when the caller aborts", async () => {
    const provider = new FakeProvider([SIM_A], {
      "sim-model-a": new DOMException("aborted", "AbortError"),
    });
    for (let i = 0; i < 3; i++) {
      await expect(
        route(UNPINNED_TASK, { messages: [{ role: "user", content: String(i) }] }, { providers: [provider] }),
      ).rejects.toThrow(/aborted/);
    }
    // Three consecutive "failures" would normally trip the cooldown (see the
    // "deprioritizes a model" test above, which needs only two) — but these
    // were all caller aborts, so the model must still be tried FIRST.
    const provider2 = new FakeProvider([SIM_A, SIM_B], {
      "sim-model-a": { content: "still first choice", reasoning: "" },
      "sim-model-b": { content: "n/a", reasoning: "" },
    });
    const res = await route(
      UNPINNED_TASK,
      { messages: [{ role: "user", content: "final" }] },
      { providers: [provider2] },
    );
    expect(res.model).toBe("sim-model-a");
  });
});

/**
 * keepAlive is a hint for LOCAL runtimes (how long to keep weights resident
 * after answering). The policy — interactive holds longer than background —
 * is still computed per task and passed through the provider interface; the
 * hosted provider simply ignores it.
 */
describe("route: keepAlive", () => {
  it("holds the model for tasks a human is waiting on", async () => {
    const provider = new FakeProvider([{ id: "claude-opus-5-low", sizeGb: 0 }], {
      "claude-opus-5-low": { content: "{}", reasoning: "" },
    });
    await route("app-assistant", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] });
    expect(provider.requests[0].keepAlive).toBe("30m");
  });

  it("holds the model briefly for background work — pipelines call back-to-back", async () => {
    const provider = new FakeProvider([{ id: "claude-opus-5-high", sizeGb: 0 }], {
      "claude-opus-5-high": { content: "{}", reasoning: "" },
    });
    await route("investment-thesis", { messages: [{ role: "user", content: "hi" }] }, { providers: [provider] });
    expect(provider.requests[0].keepAlive).toBe("10m");
  });
});
