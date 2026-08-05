/**
 * THE BOUNDARY: deterministic engines and the verification layer work with no
 * API key at all; only the narration disappears — and it disappears politely.
 *
 * This is the product's whole claim ("code computes, the model narrates"), so
 * it gets its own suite: every test here runs with NO ANTHROPIC_API_KEY and an
 * isolated, empty UAA_CONFIG_DIR. Nothing may throw uncaught, nothing may hit
 * the network, and every degraded surface must point at the one real fix
 * (Settings).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeScores } from "@/lib/composite";
import { verifyGrounding } from "@/lib/ai/grounding";
import { keyStatus } from "@/lib/ai/anthropic-key";
import { classifyAiError } from "@/lib/ai/errors";
import { AllModelsFailedError, route, resetProvidersForTests } from "@/lib/ai/router";
import { generateVerdict, offlineVerdict, type VerdictPlan } from "@/lib/ai/verdict";
import { AI_RECOVERY_HINT, aiAttribution } from "@/lib/ai/availability";

const dir = mkdtempSync(path.join(tmpdir(), "uaa-nokey-test-"));
let savedEnvKey: string | undefined;
let savedConfigDir: string | undefined;

beforeEach(() => {
  savedEnvKey = process.env.ANTHROPIC_API_KEY;
  savedConfigDir = process.env.UAA_CONFIG_DIR;
  delete process.env.ANTHROPIC_API_KEY; // no env key…
  process.env.UAA_CONFIG_DIR = dir; // …and an empty key-file directory
  resetProvidersForTests();
});

afterEach(() => {
  if (savedEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedEnvKey;
  if (savedConfigDir === undefined) delete process.env.UAA_CONFIG_DIR;
  else process.env.UAA_CONFIG_DIR = savedConfigDir;
  resetProvidersForTests();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PLAN: VerdictPlan = {
  kind: "equity",
  task: "investment-thesis",
  prompt: "irrelevant — must never reach a provider without a key",
  evidence: ["Company: Example Corp (EXMP)", "Forward P/E: 16.1", "Revenue growth: +85.2%"].join("\n"),
  fallback: {
    verdict: "neutral",
    name: "Example Corp",
    subject: "stock",
    reviewHint: "Review metrics and score below",
  },
};

describe("no key is configured (sanity)", () => {
  it("keyStatus reports unconfigured in this suite's isolated environment", () => {
    expect(keyStatus()).toEqual({ configured: false, source: null });
  });
});

describe("deterministic engines run without a key", () => {
  it("computes composite scores from metrics alone — no AI, no network", () => {
    const scores = computeScores({
      symbol: "EXMP",
      name: "Example Corp",
      price: 100,
      marketCap: 5e10,
      sector: "Technology",
      trailingPE: 18,
      forwardPE: 16.1,
      priceToBook: 4,
      priceToSales: 3,
      revenueGrowth: 0.12,
      earningsGrowth: 0.15,
      returnOnEquity: 0.28,
      profitMargins: 0.22,
      operatingMargins: 0.25,
      debtToEquity: 45,
      currentRatio: 1.8,
      freeCashflow: 8e9,
      dividendYield: 0.01,
      fiftyTwoWeekChange: 0.2,
      beta: 1.1,
    } as never);
    expect(scores.overall).not.toBeNull();
    expect(scores.overall!).toBeGreaterThan(0);
    expect(scores.overall!).toBeLessThanOrEqual(100);
  });
});

describe("the verification layer runs without a key", () => {
  it("verifyGrounding scores claims against evidence — pure, offline", () => {
    const evidence = "Revenue grew +16.4% year over year to $416.16B. Net margin 26.3%.";
    const grounded = verifyGrounding("Revenue grew +16.4% to $416.16B.", evidence);
    expect(grounded.groundingScore).toBeGreaterThan(0.9);

    const fabricated = verifyGrounding("Revenue grew +42.7% to $999.99B.", evidence);
    expect(fabricated.groundingScore).toBeLessThan(grounded.groundingScore);
    expect(fabricated.unsupportedNumbers.length).toBeGreaterThan(0);
    expect(fabricated.flags.length).toBeGreaterThan(0);
  });
});

describe("the AI path fails typed and polite, never blank", () => {
  it("route() throws AllModelsFailedError without a key — no hang, no network", async () => {
    await expect(
      route("company-research", { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toBeInstanceOf(AllModelsFailedError);
  });

  it("generateVerdict degrades to the offline verdict instead of throwing", async () => {
    const v = await generateVerdict(PLAN);
    expect(v.model).toBe("unavailable");
    expect(v.verdict).toBe("neutral"); // the score-derived fallback call survives
    expect(v.thesis).toMatch(/API key/i);
    expect(v.thesis).toMatch(/Settings/i);
  });

  it("the offline verdict itself carries the Settings affordance", () => {
    const v = offlineVerdict(PLAN);
    expect(v.thesis).toContain(AI_RECOVERY_HINT);
  });

  it("classifyAiError renders the no-key case with the Settings fix and marks it non-retryable", () => {
    const missing = Object.assign(new Error("no key"), { code: "anthropic_key_missing" });
    const c = classifyAiError(missing);
    expect(c.category).toBe("no_api_key");
    expect(c.retryable).toBe(false);
    expect(c.message).toMatch(/Settings/);
    expect(c.message).toMatch(/computed locally/i);
  });

  it("an invalid key is a distinct, non-retryable category pointing at Settings", () => {
    const invalid = Object.assign(new Error("rejected"), { code: "anthropic_key_invalid" });
    const c = classifyAiError(invalid);
    expect(c.category).toBe("bad_api_key");
    expect(c.retryable).toBe(false);
    expect(c.message).toMatch(/Settings/);
  });

  it("rate limiting and network failures are retryable and never blame the key", () => {
    const limited = classifyAiError(Object.assign(new Error("429"), { code: "rate_limited" }));
    expect(limited.category).toBe("rate_limited");
    expect(limited.retryable).toBe(true);
    expect(limited.message).not.toMatch(/add your key/i);

    const network = classifyAiError(Object.assign(new Error("fetch failed"), { code: "network" }));
    expect(network.category).toBe("network");
    expect(network.retryable).toBe(true);
  });

  it("attribution never claims locality, even with no model to attribute", () => {
    const a = aiAttribution(null);
    expect(a.badge).not.toMatch(/local/i);
    expect(a.title).toMatch(/Anthropic API/);
    expect(a.title).toMatch(/deterministic engines/);
  });
});
