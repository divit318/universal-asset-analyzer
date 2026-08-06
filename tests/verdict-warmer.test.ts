import { afterEach, describe, expect, it } from "vitest";
import { resolveWarmIntervalMs, warmCandidates } from "@/lib/ai/verdict-warmer";

describe("resolveWarmIntervalMs", () => {
  const SIX_HOURS = 6 * 60 * 60_000;

  it("defaults to the aiVerdict fresh window", () => {
    expect(resolveWarmIntervalMs(undefined)).toBe(SIX_HOURS);
    expect(resolveWarmIntervalMs("")).toBe(SIX_HOURS);
  });

  it("treats 0 as disabled and floors positive values at 15 minutes", () => {
    expect(resolveWarmIntervalMs("0")).toBe(0);
    expect(resolveWarmIntervalMs("1000")).toBe(15 * 60_000);
    expect(resolveWarmIntervalMs(String(2 * 60 * 60_000))).toBe(2 * 60 * 60_000);
  });

  it("falls back to the default on garbage", () => {
    expect(resolveWarmIntervalMs("soon")).toBe(SIX_HOURS);
    expect(resolveWarmIntervalMs("-5")).toBe(SIX_HOURS);
  });
});

describe("warmCandidates", () => {
  afterEach(() => {
    delete process.env.AI_PROVIDER;
  });

  it("unions watchlist and portfolio, deduped and uppercased", () => {
    expect(
      warmCandidates(
        [{ symbol: "aapl" }, { symbol: "MSFT" }],
        [{ symbol: "AAPL" }, { symbol: "nvda" }],
      ),
    ).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("is empty when the user tracks nothing — the warmer must be a no-op", () => {
    expect(warmCandidates([], [])).toEqual([]);
  });
});
