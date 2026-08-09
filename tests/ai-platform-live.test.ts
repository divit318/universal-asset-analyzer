/**
 * LIVE end-to-end verification against the real Anthropic API.
 *
 * Skipped unless LIVE_AI=1 AND an API key is configured — it spends real
 * money on the user's key, so it must never run implicitly:
 *
 *   LIVE_AI=1 npx vitest run tests/ai-platform-live.test.ts
 *
 * Every other test uses a fake provider; this one drives the real platform
 * and asserts the JSON tasks come back POPULATED rather than as the literal `{}`.
 */
import { describe, expect, it } from "vitest";
import { runTask } from "@/lib/ai/orchestrator";
import { pickModel } from "@/lib/ai/router";
import { keyStatus } from "@/lib/ai/anthropic-key";
import { extractJson } from "@/lib/json-extract";

const live = process.env.LIVE_AI === "1" && keyStatus().configured;

describe.skipIf(!live)("live: routing", () => {
  it("routes a light interactive task to the low tier, a deep task to the high one", async () => {
    expect(await pickModel("nl-screener")).toBe("claude-opus-5-low");
    expect(await pickModel("risk-review")).toBe("claude-opus-5-high");
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

    const parsed = extractJson<{ verdict?: string; score?: number }>(res.content);
    // The historical regression: a model in JSON mode returned `{}` — valid
    // JSON, parses fine, utterly empty. Assert the fields are really there.
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
    const parsed = extractJson<Record<string, unknown>>(res.content);
    expect(Object.keys(parsed ?? {}).length, "model returned an EMPTY object").toBeGreaterThan(0);
  }, 120_000);
});
