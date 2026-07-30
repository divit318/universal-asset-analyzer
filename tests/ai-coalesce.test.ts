import { beforeEach, describe, expect, it } from "vitest";
import { runTask } from "@/lib/ai/orchestrator";
import { dedupStats, resetDedup } from "@/lib/platform/dedup";
import { resetHealth } from "@/lib/ai/health";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
} from "@/lib/ai/provider";

/**
 * Concurrent identical AI work must run ONCE.
 *
 * This is not a micro-optimization on this platform: Ollama serializes
 * generations, so a duplicate does not finish alongside the original — it
 * doubles the wall-clock wait for everything queued behind it. A single research
 * page load was measured firing duplicate movement and financial-insight
 * generations that the verdict then had to wait behind.
 */

/** A provider that counts generations and only resolves when told to. */
class GatedProvider implements AIProvider {
  readonly id = "gated";
  generations = 0;
  private release!: () => void;
  private gate = new Promise<void>((r) => { this.release = r; });

  constructor(private models: ProviderModelInfo[]) {}

  async listModels(): Promise<ProviderModelInfo[]> { return this.models; }
  async healthCheck(): Promise<ProviderHealth> {
    return { reachable: true, models: this.models.map((m) => m.id) };
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    this.generations += 1;
    await this.gate;
    return { content: `answer for ${request.messages.at(-1)?.content}`, reasoning: "" };
  }

  async *stream(_request: ProviderCompleteRequest): AsyncGenerator<string, void, unknown> {
    // Coalescing applies to the non-streaming path; streaming is not exercised
    // here, but the method must exist to satisfy the provider contract.
    yield "x";
  }

  open() { this.release(); }
}

const MODELS: ProviderModelInfo[] = [
  { id: "qwen3:14b", sizeGb: 9.3 },
  { id: "mistral:latest", sizeGb: 4.4 },
];

function provider() {
  return new GatedProvider(MODELS);
}

beforeEach(() => {
  resetDedup();
  resetHealth();
});

describe("runTask coalescing", () => {
  it("runs one generation for three concurrent identical requests", async () => {
    const p = provider();

    const all = Promise.all([
      runTask("company-research", "Why did AAPL move?", { providers: [p] }),
      runTask("company-research", "Why did AAPL move?", { providers: [p] }),
      runTask("company-research", "Why did AAPL move?", { providers: [p] }),
    ]);

    // Let the first request reach the provider before releasing it.
    await new Promise((r) => setTimeout(r, 10));
    p.open();
    const results = await all;

    expect(p.generations).toBe(1);
    // Every caller still gets a real answer — coalescing is invisible.
    expect(results).toHaveLength(3);
    for (const r of results) expect(r.content).toContain("Why did AAPL move?");
    expect(dedupStats().coalesced).toBe(2);
    expect(dedupStats().executed).toBe(1);
  });

  it("does NOT coalesce different prompts", async () => {
    const p = provider();
    const all = Promise.all([
      runTask("company-research", "Why did AAPL move?", { providers: [p] }),
      runTask("company-research", "Why did MSFT move?", { providers: [p] }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    p.open();
    await all;
    expect(p.generations).toBe(2);
  });

  it("does NOT coalesce the same prompt across different tasks", async () => {
    // Different tasks can route to different models, so the outputs differ.
    const p = provider();
    const all = Promise.all([
      runTask("company-research", "Summarize", { providers: [p] }),
      runTask("market-summary", "Summarize", { providers: [p] }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    p.open();
    await all;
    expect(p.generations).toBe(2);
  });

  it("does NOT coalesce when JSON mode differs", async () => {
    const p = provider();
    const all = Promise.all([
      runTask("company-research", "Same text", { providers: [p], json: true }),
      runTask("company-research", "Same text", { providers: [p], json: false }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    p.open();
    await all;
    expect(p.generations).toBe(2);
  });

  it("does NOT coalesce when a system prompt differs", async () => {
    const p = provider();
    const all = Promise.all([
      runTask("company-research", "Q", { providers: [p], system: "You are terse" }),
      runTask("company-research", "Q", { providers: [p], system: "You are verbose" }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    p.open();
    await all;
    expect(p.generations).toBe(2);
  });

  it("never coalesces requests that want reasoning deltas", async () => {
    // A reasoning sink is per-caller; sharing one generation would silently drop
    // the other caller's deltas.
    const p = provider();
    const all = Promise.all([
      runTask("company-research", "Q", { providers: [p], onReasoning: () => {} }),
      runTask("company-research", "Q", { providers: [p], onReasoning: () => {} }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    p.open();
    await all;
    expect(p.generations).toBe(2);
  });

  it("lets a later identical request execute again once the first has settled", async () => {
    const p1 = provider();
    const first = runTask("company-research", "Q", { providers: [p1] });
    await new Promise((r) => setTimeout(r, 10));
    p1.open();
    await first;

    // Sequential, not concurrent — coalescing must not behave like a cache.
    const p2 = provider();
    const second = runTask("company-research", "Q", { providers: [p2] });
    await new Promise((r) => setTimeout(r, 10));
    p2.open();
    await second;

    expect(p2.generations).toBe(1);
  });
});
