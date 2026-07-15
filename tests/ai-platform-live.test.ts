/**
 * LIVE end-to-end verification against a running Ollama daemon.
 *
 * Skipped unless LIVE_AI=1, so it never gates CI or a machine without Ollama:
 *
 *   LIVE_AI=1 npx vitest run tests/ai-platform-live.test.ts
 *
 * This is the check that actually matters. Every other test uses a fake
 * provider; this one drives the real platform against real models and asserts
 * the JSON tasks come back POPULATED rather than as the literal `{}`.
 */
import { describe, expect, it } from "vitest";
import { runTask } from "@/lib/ai/orchestrator";
import { pickModel } from "@/lib/ai/router";
import { extractJson } from "@/lib/json-extract";
import { appendFileSync } from "node:fs";

const LOG = "/private/tmp/claude-501/-Users-divit/f5806322-a547-4843-b3e6-84e4cd134ded/scratchpad/live.txt";
const log = (s: string) => appendFileSync(LOG, s + "\n");

const live = process.env.LIVE_AI === "1";

describe.skipIf(!live)("live: routing", () => {
  it("sends a light interactive task to the fast model, a deep task to the strong one", async () => {
    expect(await pickModel("nl-screener")).toBe("mistral:latest");
    expect(await pickModel("risk-review")).toBe("qwen3:14b");
    // The 18.6GB model must never be selected on this 17GB host — it thrashes.
    expect(await pickModel("investment-thesis")).not.toBe("qwen3:30b-a3b");
  }, 60_000);
});

describe.skipIf(!live)("live: the `{}` bug", () => {
  it("returns POPULATED json for a deep jsonMode task", async () => {
    const res = await runTask(
      "investment-thesis",
      `Score AAPL. P/E 32, revenue growth 4%, gross margin 45%, net cash $50B, DOJ antitrust suit.
Return ONLY valid JSON:
{"verdict":"BUY|HOLD|SELL","score":0-100,"bull":["..."],"bear":["..."]}`,
    );
    log(`[thesis] model=${res.model} ${res.executionTimeMs}ms\n${res.content}`);

    const parsed = extractJson<{ verdict?: string; score?: number }>(res.content);
    // The regression that started this project: qwen3 + format:json + thinking
    // returned `{}` — valid JSON, parses fine, utterly empty. Assert the fields
    // are really there, because `toBeTruthy()` on `{}` would have passed.
    expect(Object.keys(parsed ?? {}).length, "model returned an EMPTY object").toBeGreaterThan(0);
    expect(parsed?.verdict, "no verdict field").toBeTruthy();
    expect(typeof parsed?.score, "no score field").toBe("number");
  }, 300_000);

  it("returns populated json for the interactive screener task too", async () => {
    const res = await runTask(
      "nl-screener",
      `Convert to filters: "profitable tech stocks under 20 P/E".
Return ONLY valid JSON: {"sector":"...","maxPe":number,"minRoe":number}`,
    );
    log(`[screener] model=${res.model} ${res.executionTimeMs}ms\n${res.content}`);
    const parsed = extractJson<Record<string, unknown>>(res.content);
    expect(Object.keys(parsed ?? {}).length, "model returned an EMPTY object").toBeGreaterThan(0);
  }, 120_000);
});
