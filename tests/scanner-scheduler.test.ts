import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveScannerIntervalMs, startScannerScheduler } from "@/lib/scanner/scheduler";

describe("resolveScannerIntervalMs", () => {
  it("defaults to 1 hour when unset", () => {
    expect(resolveScannerIntervalMs(undefined)).toBe(3_600_000);
  });

  it("defaults to 1 hour for an empty string", () => {
    expect(resolveScannerIntervalMs("")).toBe(3_600_000);
  });

  it("disables the scheduler on '0'", () => {
    expect(resolveScannerIntervalMs("0")).toBe(0);
  });

  it("floors sub-5-minute values at 5 min", () => {
    expect(resolveScannerIntervalMs("60000")).toBe(300_000);
  });

  it("falls back to the default for non-numeric input", () => {
    expect(resolveScannerIntervalMs("abc")).toBe(3_600_000);
  });

  it("falls back to the default for negative input", () => {
    expect(resolveScannerIntervalMs("-5")).toBe(3_600_000);
  });

  it("passes through values already at or above the floor", () => {
    expect(resolveScannerIntervalMs("900000")).toBe(900_000);
  });
});

describe("startScannerScheduler", () => {
  const TICK_KEY = Symbol.for("uaa.scanner.scheduler");

  afterEach(() => {
    (globalThis as unknown as Record<symbol, unknown>)[TICK_KEY] = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is idempotent: calling twice only ever creates one interval", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startScannerScheduler();
    startScannerScheduler();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when UAA_SCANNER_INTERVAL_MS=0", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const prev = process.env.UAA_SCANNER_INTERVAL_MS;
    process.env.UAA_SCANNER_INTERVAL_MS = "0";

    startScannerScheduler();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    if (prev === undefined) delete process.env.UAA_SCANNER_INTERVAL_MS;
    else process.env.UAA_SCANNER_INTERVAL_MS = prev;
  });
});
