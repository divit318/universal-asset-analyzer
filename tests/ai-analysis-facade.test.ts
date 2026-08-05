/**
 * The analysis façade: cache read/write on the ai_result table, provider
 * dispatch, single-flight coalescing, and the durable job path. Uses an
 * isolated on-disk SQLite (DB_PATH) and mock providers — no Ollama, no Devin.
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

function mockProvider(id: "ollama" | "devin", impl?: () => Promise<{ answer: string }>): AnalysisProvider & { calls: number } {
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
    const ollama = mockProvider("ollama");
    const res = await runAnalysis(makeRequest(), { providers: { ollama } });
    expect(res.data.answer).toBe("from-ollama");
    expect(ollama.calls).toBe(1);
  });

  it("serves the second identical request from the ai_result cache", async () => {
    const ollama = mockProvider("ollama");
    const req = makeRequest();
    await runAnalysis(req, { providers: { ollama }, maxAgeMs: 60_000 });
    const second = await runAnalysis(req, { providers: { ollama }, maxAgeMs: 60_000 });
    expect(second.data.answer).toBe("from-ollama");
    expect(ollama.calls).toBe(1);
  });

  it("a different dossier misses the cache (input_hash keying)", async () => {
    const ollama = mockProvider("ollama");
    await runAnalysis(makeRequest({ prompt: "dossier A" }), { providers: { ollama }, maxAgeMs: 60_000 });
    await runAnalysis(makeRequest({ prompt: "dossier B" }), { providers: { ollama }, maxAgeMs: 60_000 });
    expect(ollama.calls).toBe(2);
  });

  it("a schemaVersion bump misses the cache", async () => {
    const ollama = mockProvider("ollama");
    const req = makeRequest({ prompt: "fixed dossier" });
    await runAnalysis(req, { providers: { ollama }, maxAgeMs: 60_000 });
    await runAnalysis({ ...req, schemaVersion: 2 }, { providers: { ollama }, maxAgeMs: 60_000 });
    expect(ollama.calls).toBe(2);
  });

  it("coalesces concurrent identical requests into one provider call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ollama = mockProvider("ollama", async () => {
      await gate;
      return { answer: "slow" };
    });
    const req = makeRequest({ prompt: "concurrent dossier" });
    const [a, b] = [
      runAnalysis(req, { providers: { ollama } }),
      runAnalysis(req, { providers: { ollama } }),
    ];
    release();
    expect((await a).data.answer).toBe("slow");
    expect((await b).data.answer).toBe("slow");
    expect(ollama.calls).toBe(1);
  });
});

describe("text mode", () => {
  it("wraps a mock provider's text answer as { text } through the schema", async () => {
    const { TextAnalysisSchema } = await import("@/lib/ai/schemas/text");
    // Direct provider-shape test: the façade passes output:"text" through; the
    // OllamaAnalysisProvider wraps raw content. Here we assert the seam accepts
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
      { providers: { ollama: {
        id: "ollama",
        // The mock always returns the text shape; the runtime request's T here
        // IS { text: string }, but a generic-position mock can't prove that to
        // the checker, hence the cast (same convention as `schema: … as never`
        // above).
        async run<T>() { return { data: { text: "plain prose answer" } as T, provider: "ollama" as const, meta: { durationMs: 1 } }; },
        async healthCheck() { return { reachable: true }; },
      } } },
    );
    expect((res.data as { text: string }).text).toBe("plain prose answer");
  });
});

describe("enqueueAnalysis", () => {
  it("records a durable job row and completes it", async () => {
    const ollama = mockProvider("ollama");
    const handle = enqueueAnalysis(makeRequest({ prompt: "job dossier" }), { providers: { ollama } });
    expect(["pending", "running"]).toContain(handle.status);
    await new Promise((r) => setTimeout(r, 50));
    const job = getAiJob(handle.jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.taskType).toBe("explain-movement");
  });

  it("marks the job failed (with the error) when the provider throws", async () => {
    const ollama = mockProvider("ollama", async () => {
      throw new Error("model exploded");
    });
    const handle = enqueueAnalysis(makeRequest({ prompt: "failing dossier" }), { providers: { ollama } });
    await new Promise((r) => setTimeout(r, 50));
    const job = getAiJob(handle.jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("model exploded");
  });

  it("returns succeeded immediately on a fresh cache hit without re-running", async () => {
    const ollama = mockProvider("ollama");
    const req = makeRequest({ prompt: "cached job dossier" });
    await runAnalysis(req, { providers: { ollama }, maxAgeMs: 60_000 });
    const handle = enqueueAnalysis(req, { providers: { ollama }, maxAgeMs: 60_000 });
    expect(handle.status).toBe("succeeded");
    expect(ollama.calls).toBe(1);
  });
});
