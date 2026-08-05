/**
 * The analysis façade: cache read/write on the ai_result table, provider
 * dispatch, single-flight coalescing, and the durable job path. Uses an
 * isolated on-disk SQLite (DB_PATH) and mock providers — no live backend.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "uaa-ai-test-")), "test.db");

import { z } from "zod";
import { runAnalysis, enqueueAnalysis } from "@/lib/ai/analysis";
import type { AnalysisProvider, AnalysisRequest } from "@/lib/ai/analysis-provider";
import { getAiJob } from "@/lib/db";
import { resetDedup } from "@/lib/platform/dedup";

const schema = z.object({ answer: z.string() });

function makeRequest(overrides: Partial<AnalysisRequest<{ answer: string }>> = {}): AnalysisRequest<{ answer: string }> {
  return {
    taskType: "explain-movement",
    subjectKey: "symbol:TEST",
    prompt: `dossier ${Math.random()}`,
    schema,
    schemaVersion: 1,
    ...overrides,
  };
}

function mockProvider(id: "chain" | "sessions", impl?: () => Promise<{ answer: string }>): AnalysisProvider & { calls: number } {
  const p = {
    id,
    calls: 0,
    async run() {
      p.calls++;
      const data = impl ? await impl() : { answer: `from-${id}` };
      return { data, provider: id, meta: { durationMs: 1 } };
    },
    async healthCheck() {
      return { reachable: true };
    },
  };
  return p as AnalysisProvider & { calls: number };
}

beforeEach(() => resetDedup());
afterAll(() => rmSync(path.dirname(process.env.DB_PATH!), { recursive: true, force: true }));

describe("runAnalysis", () => {
  it("runs the resolved provider and validates through the schema", async () => {
    const provider = mockProvider("chain");
    const res = await runAnalysis(makeRequest(), { providers: { chain: provider } });
    expect(res.data.answer).toBe("from-chain");
    expect(provider.calls).toBe(1);
  });

  it("serves the second identical request from the ai_result cache", async () => {
    const provider = mockProvider("chain");
    const req = makeRequest();
    await runAnalysis(req, { providers: { chain: provider }, maxAgeMs: 60_000 });
    const second = await runAnalysis(req, { providers: { chain: provider }, maxAgeMs: 60_000 });
    expect(second.data.answer).toBe("from-chain");
    expect(provider.calls).toBe(1);
  });

  it("a different dossier misses the cache (input_hash keying)", async () => {
    const provider = mockProvider("chain");
    await runAnalysis(makeRequest({ prompt: "dossier A" }), { providers: { chain: provider }, maxAgeMs: 60_000 });
    await runAnalysis(makeRequest({ prompt: "dossier B" }), { providers: { chain: provider }, maxAgeMs: 60_000 });
    expect(provider.calls).toBe(2);
  });

  it("a schemaVersion bump misses the cache", async () => {
    const provider = mockProvider("chain");
    const req = makeRequest({ prompt: "fixed dossier" });
    await runAnalysis(req, { providers: { chain: provider }, maxAgeMs: 60_000 });
    await runAnalysis({ ...req, schemaVersion: 2 }, { providers: { chain: provider }, maxAgeMs: 60_000 });
    expect(provider.calls).toBe(2);
  });

  it("coalesces concurrent identical requests into one provider call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider = mockProvider("chain", async () => {
      await gate;
      return { answer: "slow" };
    });
    const req = makeRequest({ prompt: "concurrent dossier" });
    const [a, b] = [
      runAnalysis(req, { providers: { chain: provider } }),
      runAnalysis(req, { providers: { chain: provider } }),
    ];
    release();
    expect((await a).data.answer).toBe("slow");
    expect((await b).data.answer).toBe("slow");
    expect(provider.calls).toBe(1);
  });
});

describe("text mode", () => {
  it("wraps a mock provider's text answer as { text } through the schema", async () => {
    const { TextAnalysisSchema } = await import("@/lib/ai/schemas/text");
    // Direct provider-shape test: the façade passes output:"text" through; the
    // chain adapter wraps raw content. Here we assert the seam accepts
    // a text-mode request and validates through TextAnalysisSchema.
    const res = await runAnalysis(
      {
        taskType: "quick-summary",
        subjectKey: "text:TEST",
        prompt: `text dossier ${Math.random()}`,
        schema: TextAnalysisSchema as never,
        schemaVersion: 1,
        output: "text",
      },
      { providers: { chain: {
        id: "chain",
        async run() { return { data: { text: "plain prose answer" }, provider: "chain" as const, meta: { durationMs: 1 } }; },
        async healthCheck() { return { reachable: true }; },
      } as AnalysisProvider } },
    );
    expect((res.data as { text: string }).text).toBe("plain prose answer");
  });
});

describe("enqueueAnalysis", () => {
  it("records a durable job row and completes it", async () => {
    const provider = mockProvider("chain");
    const handle = enqueueAnalysis(makeRequest({ prompt: "job dossier" }), { providers: { chain: provider } });
    expect(["pending", "running"]).toContain(handle.status);
    await new Promise((r) => setTimeout(r, 50));
    const job = getAiJob(handle.jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.taskType).toBe("explain-movement");
  });

  it("marks the job failed (with the error) when the provider throws", async () => {
    const provider = mockProvider("chain", async () => {
      throw new Error("model exploded");
    });
    const handle = enqueueAnalysis(makeRequest({ prompt: "failing dossier" }), { providers: { chain: provider } });
    await new Promise((r) => setTimeout(r, 50));
    const job = getAiJob(handle.jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("model exploded");
  });

  it("returns succeeded immediately on a fresh cache hit without re-running", async () => {
    const provider = mockProvider("chain");
    const req = makeRequest({ prompt: "cached job dossier" });
    await runAnalysis(req, { providers: { chain: provider }, maxAgeMs: 60_000 });
    const handle = enqueueAnalysis(req, { providers: { chain: provider }, maxAgeMs: 60_000 });
    expect(handle.status).toBe("succeeded");
    expect(provider.calls).toBe(1);
  });
});
