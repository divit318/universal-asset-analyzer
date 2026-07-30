import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Model health persistence — survives a process restart, and (best-effort)
 * would be shared across multiple server processes pointed at the same file.
 *
 * This module computes its persistence path and on/off switch from
 * `process.env.AI_HEALTH_PATH` at IMPORT time, so each test here resets the
 * module registry and re-imports fresh rather than reusing the module-level
 * singleton the rest of the suite shares — otherwise this file's behavior
 * would depend on import order relative to tests/ai-router.test.ts.
 */
describe("AI model health persistence", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ai-health-test-"));
    file = path.join(dir, "ai-health.json");
    process.env.AI_HEALTH_PATH = file;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.AI_HEALTH_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes health state to disk on failure", async () => {
    const { markFailure } = await import("@/lib/ai/health");
    markFailure("qwen3:14b");
    markFailure("qwen3:14b"); // trips the cooldown threshold
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk["qwen3:14b"].consecutiveFailures).toBe(2);
    expect(onDisk["qwen3:14b"].unhealthyUntil).toBeGreaterThan(0);
  });

  it("survives a simulated process restart", async () => {
    const first = await import("@/lib/ai/health");
    first.markFailure("qwen3:14b");
    first.markFailure("qwen3:14b");
    expect(first.isHealthy("qwen3:14b")).toBe(false);

    // Simulate a fresh process: reset the module registry and re-import.
    // The new instance's module-level `loadPersisted()` should pick up
    // exactly what the first instance wrote.
    vi.resetModules();
    const second = await import("@/lib/ai/health");
    expect(second.isHealthy("qwen3:14b")).toBe(false);
  });

  it("survives a restart for a lastSuccessAt-based warmth check too", async () => {
    const first = await import("@/lib/ai/health");
    first.markSuccess("mistral:latest");
    expect(first.recentSuccessWithinMs("mistral:latest", 60_000)).toBe(true);

    vi.resetModules();
    const second = await import("@/lib/ai/health");
    expect(second.recentSuccessWithinMs("mistral:latest", 60_000)).toBe(true);
  });

  it("degrades to a clean in-memory state when the file is corrupt, rather than throwing", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "{ not valid json");
    const { isHealthy } = await import("@/lib/ai/health");
    expect(isHealthy("qwen3:14b")).toBe(true); // clean slate, no throw
  });

  it("never throws when the persistence directory can't be created (read-only-ish path)", async () => {
    process.env.AI_HEALTH_PATH = "/nonexistent-root-only-path/ai-health.json";
    vi.resetModules();
    const { markFailure, isHealthy } = await import("@/lib/ai/health");
    expect(() => markFailure("qwen3:14b")).not.toThrow();
    // In-memory tracking still works even though the write failed.
    markFailure("qwen3:14b");
    expect(isHealthy("qwen3:14b")).toBe(false);
  });
});
