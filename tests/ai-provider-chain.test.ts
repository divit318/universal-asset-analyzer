/**
 * The provider chain contract, tested with fake providers.
 *
 * Only one provider (anthropic) is registered today, but the Router still
 * walks a list — these tests pin the multi-provider semantics (lazy
 * enumeration, fall-through, aggregated failures, strict model pins) so that
 * adding a second provider later is a config change, not a Router rewrite.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetHealth } from "@/lib/ai/health";
import { AllModelsFailedError, route, routeStream, pickModel } from "@/lib/ai/router";
import { providerOrder } from "@/lib/ai/config";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
} from "@/lib/ai/provider";

/** Records whether it was ever asked for its model list — laziness is a feature here. */
class ChainProvider implements AIProvider {
  listModelsCalls = 0;
  completed: string[] = [];

  constructor(
    readonly id: string,
    private installed: ProviderModelInfo[],
    private behavior: Record<string, ProviderCompleteResult | Error>,
  ) {}

  async listModels(): Promise<ProviderModelInfo[]> {
    this.listModelsCalls += 1;
    return this.installed;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { reachable: this.installed.length > 0, models: this.installed.map((m) => m.id) };
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    this.completed.push(request.model);
    const outcome = this.behavior[request.model];
    if (outcome === undefined) throw new Error(`unscripted model ${request.model}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }

  async *stream(request: ProviderCompleteRequest): AsyncGenerator<string, void, unknown> {
    const { content } = await this.complete(request);
    yield content;
  }
}

const primary = () =>
  new ChainProvider("primary", [{ id: "alpha-model", sizeGb: 0 }], {
    "alpha-model": { content: "primary answer", reasoning: "" },
  });

const secondary = () =>
  new ChainProvider("secondary", [{ id: "beta-model", sizeGb: 0 }], {
    "beta-model": { content: "secondary answer", reasoning: "" },
  });

const ask = (providers: AIProvider[]) =>
  route("explain-movement", { messages: [{ role: "user", content: "hi" }] }, { providers });

beforeEach(() => {
  resetHealth();
});

afterEach(() => {
  delete process.env.AI_MAX_MODEL_GB;
});

describe("provider chain", () => {
  it("prefers the first provider and never touches the second", async () => {
    const first = primary();
    const second = secondary();
    const res = await ask([first, second]);

    expect(res.content).toBe("primary answer");
    expect(res.provider).toBe("primary");
    // Laziness matters for latency, not just tidiness: enumerating a provider
    // can cost a round trip, paid on EVERY request, for a backend that a
    // working setup never reaches.
    expect(second.listModelsCalls).toBe(0);
  });

  it("falls through to the second provider when the first one fails", async () => {
    const first = new ChainProvider("primary", [{ id: "alpha-model", sizeGb: 0 }], {
      "alpha-model": new Error("not authenticated"),
    });
    const second = secondary();

    const res = await ask([first, second]);
    expect(res.content).toBe("secondary answer");
    expect(res.provider).toBe("secondary");
    expect(res.errors).toEqual(["primary/alpha-model: not authenticated"]);
  });

  it("falls through when the first provider offers no models at all (no key / offline)", async () => {
    const first = new ChainProvider("primary", [], {});
    const second = secondary();

    const res = await ask([first, second]);
    expect(res.content).toBe("secondary answer");
    expect(first.completed).toEqual([]);
  });

  it("streams through the same chain, not just single-shot calls", async () => {
    const first = new ChainProvider("primary", [{ id: "alpha-model", sizeGb: 0 }], {
      "alpha-model": new Error("down"),
    });
    const second = secondary();

    const chunks: string[] = [];
    const gen = routeStream("explain-movement", { messages: [{ role: "user", content: "hi" }] }, {
      providers: [first, second],
    });
    let model = "";
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        model = next.value;
        break;
      }
      chunks.push(next.value);
    }
    expect(chunks.join("")).toBe("secondary answer");
    expect(model).toBe("beta-model");
  });

  it("reports every provider's failure when the whole chain is down", async () => {
    const first = new ChainProvider("primary", [{ id: "alpha-model", sizeGb: 0 }], {
      "alpha-model": new Error("no auth"),
    });
    const second = new ChainProvider("secondary", [{ id: "beta-model", sizeGb: 0 }], {
      "beta-model": new Error("connection refused"),
    });

    await expect(ask([first, second])).rejects.toThrow(AllModelsFailedError);
    // Both failures must survive into the message: "everything is down" is far
    // less actionable than two named causes, which are two different fixes.
    await expect(ask([first, second])).rejects.toThrow(/primary\/alpha-model: no auth/);
    await expect(ask([first, second])).rejects.toThrow(/secondary\/beta-model: connection refused/);
  });

  it("throws rather than hanging when no provider offers anything", async () => {
    await expect(
      ask([new ChainProvider("primary", [], {}), new ChainProvider("secondary", [], {})]),
    ).rejects.toThrow(AllModelsFailedError);
  });

  it("honors an explicit model against whichever provider actually has it", async () => {
    const first = primary();
    const second = secondary();
    const res = await route(
      "explain-movement",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [first, second], model: "beta-model" },
    );
    expect(res.provider).toBe("secondary");
    expect(res.model).toBe("beta-model");
    // A pin is a pin: the first provider's model must not be substituted for it.
    expect(first.completed).toEqual([]);
  });

  it("picks the model without running anything, across the chain", async () => {
    expect(await pickModel("explain-movement", { providers: [primary(), secondary()] })).toBe(
      "alpha-model",
    );
    expect(
      await pickModel("explain-movement", {
        providers: [new ChainProvider("primary", [], {}), secondary()],
      }),
    ).toBe("beta-model");
  });
});

describe("providerOrder", () => {
  it("defaults to the full chain, Devin (no API key) first", () => {
    expect(providerOrder()).toEqual([
      "devin",
      "anthropic",
      "openai",
      "gemini",
      "openrouter",
      "ollama",
    ]);
  });

  it("honors AI_PROVIDER_ORDER, preserving the given order", () => {
    process.env.AI_PROVIDER_ORDER = "anthropic,devin";
    try {
      expect(providerOrder()).toEqual(["anthropic", "devin"]);
    } finally {
      delete process.env.AI_PROVIDER_ORDER;
    }
  });

  it("drops unknown names rather than throwing, and falls back to the default when nothing valid remains", () => {
    process.env.AI_PROVIDER_ORDER = "ollama, definitely-not-a-provider";
    try {
      expect(providerOrder()).toEqual(["ollama"]);
      process.env.AI_PROVIDER_ORDER = "nonsense,also-nonsense";
      expect(providerOrder()).toEqual([
        "devin",
        "anthropic",
        "openai",
        "gemini",
        "openrouter",
        "ollama",
      ]);
    } finally {
      delete process.env.AI_PROVIDER_ORDER;
    }
  });
});
