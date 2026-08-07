/**
 * generateMarketSummary caching semantics.
 *
 * The failure this pins down (2026-08-07): when the AI provider was down, the
 * deterministic fallback (regime.summary — a one-line regime restatement) was
 * written to the cache under the same key a real synthesis would use, so the
 * thin line kept being served for the full TTL after the provider recovered.
 * Only a real synthesis may be cached.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketRegime } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));

const getCacheMock = vi.fn();
const putCacheMock = vi.fn();
vi.mock("@/lib/db", () => ({
  getScannerCache: (...args: unknown[]) => getCacheMock(...args),
  putScannerCache: (...args: unknown[]) => putCacheMock(...args),
}));

const { generateMarketSummary } = await import("@/lib/market-summary");

const regime: MarketRegime = {
  trend: "risk-on",
  breadthPct: 73,
  dominantSectors: ["Technology"],
  dominantThemes: [],
  summary: "Market is in risk-on mode. 73% of sectors advancing.",
};

describe("generateMarketSummary caching", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
    getCacheMock.mockReset().mockReturnValue(null);
    putCacheMock.mockReset();
  });

  it("caches a real synthesis", async () => {
    runPromptMock.mockResolvedValue("A full multi-sentence market synthesis.");
    const summary = await generateMarketSummary(regime, [], null);
    expect(summary).toBe("A full multi-sentence market synthesis.");
    expect(putCacheMock).toHaveBeenCalledTimes(1);
    expect(putCacheMock.mock.calls[0][1]).toBe("A full multi-sentence market synthesis.");
  });

  it("returns the deterministic fallback when the AI fails — and never caches it", async () => {
    runPromptMock.mockRejectedValue(new Error("quota exhausted"));
    const summary = await generateMarketSummary(regime, [], null);
    expect(summary).toBe(regime.summary);
    expect(putCacheMock).not.toHaveBeenCalled();
  });

  it("treats an empty AI answer as a failure — fallback returned, nothing cached", async () => {
    runPromptMock.mockResolvedValue("   ");
    const summary = await generateMarketSummary(regime, [], null);
    expect(summary).toBe(regime.summary);
    expect(putCacheMock).not.toHaveBeenCalled();
  });

  it("serves the cache when present without calling the AI", async () => {
    getCacheMock.mockReturnValue("cached synthesis");
    const summary = await generateMarketSummary(regime, [], null);
    expect(summary).toBe("cached synthesis");
    expect(runPromptMock).not.toHaveBeenCalled();
  });
});
