/**
 * The provider chain: Devin first, Ollama as the offline fallback.
 *
 * These are the behaviours that were *documented* but not implemented before
 * the Devin provider landed. `route()` read `providers[0]` and ignored the
 * rest, so "no changes to the Router" was aspirational — a second provider
 * would have been silently unreachable. Each test below pins one half of the
 * contract the provider interface always claimed.
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

const hosted = () =>
  new ChainProvider("devin", [{ id: "claude-sonnet-5-low", sizeGb: 0 }], {
    "claude-sonnet-5-low": { content: "hosted answer", reasoning: "" },
  });

const local = () =>
  new ChainProvider("ollama", [{ id: "mistral:latest", sizeGb: 4.4 }], {
    "mistral:latest": { content: "local answer", reasoning: "" },
  });

const ask = (providers: AIProvider[]) =>
  route("explain-movement", { messages: [{ role: "user", content: "hi" }] }, { providers });

beforeEach(() => {
  resetHealth();
  process.env.AI_MAX_MODEL_GB = "12.75";
});

afterEach(() => {
  delete process.env.AI_MAX_MODEL_GB;
  delete process.env.AI_PROVIDER_ORDER;
});

describe("provider chain", () => {
  it("prefers the first provider and never touches the second", async () => {
    const devin = hosted();
    const ollama = local();
    const res = await ask([devin, ollama]);

    expect(res.content).toBe("hosted answer");
    expect(res.provider).toBe("devin");
    // Laziness matters for latency, not just tidiness: enumerating Ollama costs
    // an HTTP round trip with a 4s timeout, paid on EVERY request, for a daemon
    // that a working hosted setup never reaches.
    expect(ollama.listModelsCalls).toBe(0);
  });

  it("falls through to the local provider when the hosted one fails", async () => {
    const devin = new ChainProvider("devin", [{ id: "claude-sonnet-5-low", sizeGb: 0 }], {
      "claude-sonnet-5-low": new Error("not authenticated"),
    });
    const ollama = local();

    const res = await ask([devin, ollama]);
    expect(res.content).toBe("local answer");
    expect(res.provider).toBe("ollama");
    expect(res.errors).toEqual(["devin/claude-sonnet-5-low: not authenticated"]);
  });

  it("falls through when the hosted provider offers no models at all (offline)", async () => {
    const devin = new ChainProvider("devin", [], {});
    const ollama = local();

    const res = await ask([devin, ollama]);
    expect(res.content).toBe("local answer");
    expect(devin.completed).toEqual([]);
  });

  it("streams through the same chain, not just single-shot calls", async () => {
    const devin = new ChainProvider("devin", [{ id: "claude-sonnet-5-low", sizeGb: 0 }], {
      "claude-sonnet-5-low": new Error("down"),
    });
    const ollama = local();

    const chunks: string[] = [];
    const gen = routeStream("explain-movement", { messages: [{ role: "user", content: "hi" }] }, {
      providers: [devin, ollama],
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
    expect(chunks.join("")).toBe("local answer");
    expect(model).toBe("mistral:latest");
  });

  it("reports every provider's failure when the whole chain is down", async () => {
    const devin = new ChainProvider("devin", [{ id: "claude-sonnet-5-low", sizeGb: 0 }], {
      "claude-sonnet-5-low": new Error("no auth"),
    });
    const ollama = new ChainProvider("ollama", [{ id: "mistral:latest", sizeGb: 4.4 }], {
      "mistral:latest": new Error("connection refused"),
    });

    await expect(ask([devin, ollama])).rejects.toThrow(AllModelsFailedError);
    // Both failures must survive into the message: "everything is down" is far
    // less actionable than "the hosted one rejected your auth AND the daemon
    // is not running", which are two different fixes.
    await expect(ask([devin, ollama])).rejects.toThrow(/devin\/claude-sonnet-5-low: no auth/);
    await expect(ask([devin, ollama])).rejects.toThrow(/ollama\/mistral:latest: connection refused/);
  });

  it("throws rather than hanging when no provider offers anything", async () => {
    await expect(ask([new ChainProvider("devin", [], {}), new ChainProvider("ollama", [], {})])).rejects.toThrow(
      AllModelsFailedError,
    );
  });

  it("honors an explicit model against whichever provider actually has it", async () => {
    const devin = hosted();
    const ollama = local();
    const res = await route(
      "explain-movement",
      { messages: [{ role: "user", content: "hi" }] },
      { providers: [devin, ollama], model: "mistral:latest" },
    );
    expect(res.provider).toBe("ollama");
    expect(res.model).toBe("mistral:latest");
    // A pin is a pin: the hosted model must not be substituted for it.
    expect(devin.completed).toEqual([]);
  });

  it("picks the model without running anything, across the chain", async () => {
    expect(await pickModel("explain-movement", { providers: [hosted(), local()] })).toBe(
      "claude-sonnet-5-low",
    );
    expect(await pickModel("explain-movement", { providers: [new ChainProvider("devin", [], {}), local()] })).toBe(
      "mistral:latest",
    );
  });
});

describe("providerOrder", () => {
  it("defaults to hosted-first with local as the fallback", () => {
    expect(providerOrder()).toEqual(["devin", "ollama"]);
  });

  it("can be inverted, or reduced to a single provider, from the environment", () => {
    process.env.AI_PROVIDER_ORDER = "ollama,devin";
    expect(providerOrder()).toEqual(["ollama", "devin"]);
    process.env.AI_PROVIDER_ORDER = "ollama";
    expect(providerOrder()).toEqual(["ollama"]);
  });

  it("ignores unknown names instead of taking the platform down over a typo", () => {
    process.env.AI_PROVIDER_ORDER = "openai, ollama";
    expect(providerOrder()).toEqual(["ollama"]);
    process.env.AI_PROVIDER_ORDER = "nonsense";
    expect(providerOrder()).toEqual(["devin", "ollama"]);
  });
});
