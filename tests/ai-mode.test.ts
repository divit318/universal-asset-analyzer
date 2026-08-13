import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAiMode, resetAiModeCacheForTests, resolveAiMode, saveAiMode } from "@/lib/ai/mode";
import { pinnedModels } from "@/lib/ai/config";

/**
 * The Fast/Balanced/Deep depth mode: persistence, env precedence, and the
 * routing overlay's guarantees — a mode can only change pins for the surfaces
 * whose candidates passed their eval gates, and it participates in the
 * verdict cache identity (asserted in ai-verdict-cache tests via
 * stableVerdictIdentity; here we pin the routing side).
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "uaa-mode-"));
  process.env.UAA_CONFIG_DIR = dir;
  delete process.env.UAA_AI_MODE;
  resetAiModeCacheForTests();
});

afterEach(() => {
  delete process.env.UAA_CONFIG_DIR;
  delete process.env.UAA_AI_MODE;
  resetAiModeCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveAiMode", () => {
  it("defaults to balanced when nothing is configured", () => {
    expect(resolveAiMode()).toBe("balanced");
  });

  it("round-trips a saved mode through the config dir", () => {
    saveAiMode("fast");
    expect(resolveAiMode()).toBe("fast");
    saveAiMode("deep");
    expect(resolveAiMode()).toBe("deep");
  });

  it("lets the env var override the saved file (demo/CI)", () => {
    saveAiMode("deep");
    process.env.UAA_AI_MODE = "fast";
    expect(resolveAiMode()).toBe("fast");
  });

  it("rejects junk values", () => {
    expect(isAiMode("turbo")).toBe(false);
    process.env.UAA_AI_MODE = "turbo";
    expect(resolveAiMode()).toBe("balanced");
  });
});

describe("mode → pin overlay", () => {
  it("balanced serves the eval-gated defaults", () => {
    expect(pinnedModels("investment-verdict")?.[0]).toBe("claude-opus-5-high-fast");
    expect(pinnedModels("portfolio-intelligence")?.[0]).toBe("claude-opus-5-medium-fast");
    expect(pinnedModels("wire-thesis")?.[0]).toBe("claude-sonnet-5-low");
    // The IC pipeline keeps its deep pin — depth is its product.
    expect(pinnedModels("investment-thesis")?.[0]).toBe("claude-opus-5-high");
  });

  it("fast drops the verdict one effort tier, never below the gate", () => {
    saveAiMode("fast");
    expect(pinnedModels("investment-verdict")?.[0]).toBe("claude-opus-5-medium-fast");
    expect(pinnedModels("comparison")?.[0]).toBe("claude-sonnet-5-low");
  });

  it("deep never trades effort down, even on fallback", () => {
    saveAiMode("deep");
    const pins = pinnedModels("investment-verdict") ?? [];
    expect(pins[0]).toBe("claude-opus-5-high-fast");
    expect(pins.every((id) => id.includes("high"))).toBe(true);
  });

  it("does NOT let a mode touch un-audited tasks", () => {
    const before = pinnedModels("nl-screener");
    saveAiMode("fast");
    expect(pinnedModels("nl-screener")).toEqual(before);
    saveAiMode("deep");
    expect(pinnedModels("nl-screener")).toEqual(before);
    expect(pinnedModels("ic-agent-analysis")?.[0]).toBe("claude-opus-5-high");
  });

  it("env task pins still beat the mode overlay (operator wins)", () => {
    saveAiMode("fast");
    process.env.AI_TASK_INVESTMENT_VERDICT = "claude-opus-5-high";
    try {
      expect(pinnedModels("investment-verdict")).toEqual(["claude-opus-5-high"]);
    } finally {
      delete process.env.AI_TASK_INVESTMENT_VERDICT;
    }
  });
});
