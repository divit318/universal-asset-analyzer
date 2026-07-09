import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveIntervalMs, startMonitorScheduler } from "@/lib/monitor";

describe("resolveIntervalMs", () => {
  it("defaults to 5 minutes when unset", () => {
    expect(resolveIntervalMs(undefined)).toBe(300_000);
  });

  it("defaults to 5 minutes for an empty string", () => {
    expect(resolveIntervalMs("")).toBe(300_000);
  });

  it("disables the scheduler on '0'", () => {
    expect(resolveIntervalMs("0")).toBe(0);
  });

  it("floors sub-minute values at 60s", () => {
    expect(resolveIntervalMs("30000")).toBe(60_000);
  });

  it("falls back to the default for non-numeric input", () => {
    expect(resolveIntervalMs("abc")).toBe(300_000);
  });

  it("falls back to the default for negative input", () => {
    expect(resolveIntervalMs("-5")).toBe(300_000);
  });

  it("passes through values already at or above the floor", () => {
    expect(resolveIntervalMs("120000")).toBe(120_000);
  });
});

describe("startMonitorScheduler", () => {
  const TICK_KEY = Symbol.for("uaa.monitor.interval");

  afterEach(() => {
    (globalThis as unknown as Record<symbol, unknown>)[TICK_KEY] = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is idempotent: calling twice only ever creates one interval", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startMonitorScheduler();
    startMonitorScheduler();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when UAA_MONITOR_INTERVAL_MS=0", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const prev = process.env.UAA_MONITOR_INTERVAL_MS;
    process.env.UAA_MONITOR_INTERVAL_MS = "0";

    startMonitorScheduler();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    if (prev === undefined) delete process.env.UAA_MONITOR_INTERVAL_MS;
    else process.env.UAA_MONITOR_INTERVAL_MS = prev;
  });
});
