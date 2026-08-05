/**
 * AI telemetry — cost estimation (pure), aggregation (pure), and the ledger
 * writes the Router makes on success and failure. Isolated on-disk SQLite
 * (DB_PATH) and fake providers — no live backend. Recording is opt-in for
 * tests (AI_TELEMETRY_IN_TESTS) precisely so every OTHER suite that exercises
 * the Router cannot write to a developer's real database.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "uaa-ai-telemetry-")), "test.db");
process.env.AI_TELEMETRY_IN_TESTS = "1";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetHealth } from "@/lib/ai/health";
import { route, routeStream } from "@/lib/ai/router";
import { estimateCostUsd, summarizeRows } from "@/lib/ai/telemetry";
import { listAiCalls, type AiCallRecord } from "@/lib/db";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
} from "@/lib/ai/provider";

afterAll(() => {
  rmSync(path.dirname(process.env.DB_PATH!), { recursive: true, force: true });
  delete process.env.AI_TELEMETRY_IN_TESTS;
});

beforeEach(() => {
  resetHealth();
});

/* ────────────────────────── estimateCostUsd (pure) ─────────────────────── */

describe("estimateCostUsd", () => {
  it("prices an opus-5 tier from registry pricing ($5/$25 per MTok)", () => {
    // 1M prompt + 1M completion = $5 + $25 = $30.
    expect(
      estimateCostUsd("claude-opus-5-medium", { promptTokens: 1_000_000, completionTokens: 1_000_000 }),
    ).toBeCloseTo(30, 6);
  });

  it("prices cache writes at 1.25x input and cache reads at 0.1x input", () => {
    // 1M cache write = $6.25; 1M cache read = $0.50.
    expect(estimateCostUsd("claude-opus-5-high", { cacheCreationTokens: 1_000_000 })).toBeCloseTo(6.25, 6);
    expect(estimateCostUsd("claude-opus-5-high", { cacheReadTokens: 1_000_000 })).toBeCloseTo(0.5, 6);
  });

  it("is null for a model with no registry pricing, missing usage, or zero tokens", () => {
    expect(estimateCostUsd("some-unknown-model", { promptTokens: 100 })).toBeNull();
    expect(estimateCostUsd("claude-opus-5-low", undefined)).toBeNull();
    expect(estimateCostUsd("claude-opus-5-low", {})).toBeNull();
  });
});

/* ────────────────────────── summarizeRows (pure) ───────────────────────── */

function row(partial: Partial<AiCallRecord>): AiCallRecord {
  return {
    at: Date.now(),
    taskType: "quick-summary",
    provider: "anthropic",
    model: "claude-opus-5-low",
    outcome: "success",
    streamed: false,
    attempt: 1,
    ...partial,
  };
}

describe("summarizeRows", () => {
  it("computes cache hit rate as reads over all input tokens", () => {
    const summary = summarizeRows(
      [row({ promptTokens: 100, cacheReadTokens: 900 }), row({ promptTokens: 500, cacheCreationTokens: 500 })],
      1000,
    );
    // reads 900 / (100 + 900 + 500 + 500) = 0.45
    expect(summary.totals.cacheHitRate).toBeCloseTo(0.45, 6);
  });

  it("computes percentiles, failure counts, and fallback rate", () => {
    const rows = [
      row({ durationMs: 100 }),
      row({ durationMs: 200 }),
      row({ durationMs: 300, outcome: "timeout", message: "too slow" }),
      row({ durationMs: 400, attempt: 2 }),
    ];
    const s = summarizeRows(rows, 1000);
    expect(s.totals.calls).toBe(4);
    expect(s.totals.failures).toBe(1);
    expect(s.totals.p50Ms).toBe(200);
    expect(s.totals.p95Ms).toBe(400);
    expect(s.fallbackRate).toBeCloseTo(0.25, 6);
    expect(s.recentFailures).toHaveLength(1);
    expect(s.recentFailures[0].message).toBe("too slow");
  });

  it("takes TTFT percentiles from streamed attempts only", () => {
    const s = summarizeRows(
      [row({ streamed: true, ttftMs: 800 }), row({ streamed: false, ttftMs: 5 })],
      1000,
    );
    expect(s.totals.p50TtftMs).toBe(800);
  });

  it("is well-defined on an empty window", () => {
    const s = summarizeRows([], 1000);
    expect(s.totals.calls).toBe(0);
    expect(s.totals.cacheHitRate).toBeNull();
    expect(s.fallbackRate).toBeNull();
  });
});

/* ─────────────────── router → ledger integration (fake) ────────────────── */

class LedgerFake implements AIProvider {
  readonly id = "fake";
  constructor(
    private behavior: Record<string, ProviderCompleteResult | Error>,
    private streamScript?: { deltas: string[]; usage?: { promptTokens: number; completionTokens: number; cacheReadTokens?: number } },
  ) {}
  async listModels(): Promise<ProviderModelInfo[]> {
    return Object.keys(this.behavior).map((id) => ({ id, sizeGb: 0 }));
  }
  async healthCheck(): Promise<ProviderHealth> {
    return { reachable: true, models: Object.keys(this.behavior) };
  }
  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    const outcome = this.behavior[request.model];
    if (outcome === undefined) throw new Error(`unscripted model ${request.model}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
  async *stream(request: ProviderCompleteRequest): AsyncGenerator<string, void, unknown> {
    const outcome = this.behavior[request.model];
    if (outcome instanceof Error) throw outcome;
    for (const d of this.streamScript?.deltas ?? ["hello"]) yield d;
    if (this.streamScript?.usage) request.onUsage?.(this.streamScript.usage);
  }
}

describe("router writes the call ledger", () => {
  it("records a success row with usage and estimated cost", async () => {
    const provider = new LedgerFake({
      "claude-opus-5-medium": {
        content: "answer",
        reasoning: "",
        tokenUsage: { promptTokens: 2000, completionTokens: 1000, cacheReadTokens: 8000 },
      },
      "claude-opus-5-low": { content: "unused", reasoning: "" },
    });
    const before = listAiCalls().length;
    await route("company-research", { messages: [{ role: "user", content: "q" }] }, { providers: [provider] });

    const rows = listAiCalls();
    expect(rows.length).toBe(before + 1);
    const r = rows[0];
    expect(r.outcome).toBe("success");
    expect(r.taskType).toBe("company-research");
    expect(r.model).toBe("claude-opus-5-medium");
    expect(r.streamed).toBe(false);
    expect(r.attempt).toBe(1);
    expect(r.promptTokens).toBe(2000);
    expect(r.cacheReadTokens).toBe(8000);
    // 2000×$5 + 1000×$25 + 8000×$0.50 per MTok = 0.01 + 0.025 + 0.004
    expect(r.costUsd).toBeCloseTo(0.039, 6);
  });

  it("records the failed attempt AND the fallback success, with attempt depth", async () => {
    const provider = new LedgerFake({
      "claude-opus-5-medium": new Error("boom"),
      "claude-opus-5-low": { content: "rescued", reasoning: "", tokenUsage: { promptTokens: 10, completionTokens: 5 } },
    });
    const before = listAiCalls().length;
    await route("company-research", { messages: [{ role: "user", content: "q" }] }, { providers: [provider] });

    const rows = listAiCalls().slice(0, 2);
    expect(rows.length + before - before).toBe(2);
    const success = rows.find((r) => r.outcome === "success");
    const failure = rows.find((r) => r.outcome !== "success");
    expect(failure?.model).toBe("claude-opus-5-medium");
    expect(failure?.message).toContain("boom");
    expect(success?.model).toBe("claude-opus-5-low");
    expect(success?.attempt).toBe(2);
  });

  it("records a streamed success with TTFT and end-of-stream usage", async () => {
    const provider = new LedgerFake(
      { "claude-opus-5-medium": { content: "", reasoning: "" }, "claude-opus-5-low": { content: "", reasoning: "" } },
      { deltas: ["a", "b"], usage: { promptTokens: 100, completionTokens: 50, cacheReadTokens: 400 } },
    );
    const chunks: string[] = [];
    const gen = routeStream("company-research", { messages: [{ role: "user", content: "q" }] }, { providers: [provider] });
    for await (const d of gen) chunks.push(d);

    expect(chunks.join("")).toBe("ab");
    const r = listAiCalls()[0];
    expect(r.streamed).toBe(true);
    expect(r.outcome).toBe("success");
    expect(r.ttftMs).toBeTypeOf("number");
    expect(r.promptTokens).toBe(100);
    expect(r.cacheReadTokens).toBe(400);
  });
});
