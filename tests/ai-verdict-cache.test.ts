import { beforeEach, describe, expect, it } from "vitest";
import { personalizationParams } from "@/lib/ai/verdict-params";
import { verdictCacheParams } from "@/lib/ai/verdict";
import { cacheKey } from "@/lib/platform/registry";

/**
 * Cache-key correctness for the AI verdict.
 *
 * A verdict is the most expensive artifact the platform produces, so caching it
 * is the single largest latency win available (measured: 115s -> 0.04s on a
 * repeat view). But it is also *personalized* — the prompt instructs the model to
 * size the position against the user's policy and to name their sector gaps — so
 * a key collision would not merely serve something stale, it would serve one
 * context's advice under another's. These tests pin the key's identity rules.
 */

function url(query: string): URL {
  return new URL(`http://localhost/api/ai/report?${query}`);
}

beforeEach(() => {});

describe("personalizationParams", () => {
  it("returns an empty object for an unpersonalized request", () => {
    expect(personalizationParams(url("symbol=AAPL"))).toEqual({});
  });

  it("extracts every personalization dimension that shapes the prompt", () => {
    const params = personalizationParams(
      url(
        "symbol=AAPL&fitScore=78&fitTier=good&reasons=Fills+gap&isInPortfolio=false" +
          "&suggestedPct=5.0&missingSectors=Utilities&objective=ai_optimized",
      ),
    );
    expect(params).toEqual({
      fitScore: "78",
      fitTier: "good",
      reasons: "Fills gap",
      isInPortfolio: "false",
      suggestedPct: "5.0",
      missingSectors: "Utilities",
      objective: "ai_optimized",
    });
  });

  it("ignores params that do not participate in the prompt", () => {
    const params = personalizationParams(url("symbol=AAPL&refresh=1&utm_source=x"));
    expect(params).toEqual({});
  });

  it("omits empty values rather than keying on an empty string", () => {
    expect(personalizationParams(url("symbol=AAPL&fitTier="))).toEqual({});
  });
});

describe("verdictCacheParams", () => {
  it("normalizes the symbol so case cannot fork the cache", () => {
    expect(verdictCacheParams("aapl", "equity")).toEqual({ symbol: "AAPL", kind: "equity" });
  });

  it("includes the asset class, so a reclassified asset cannot read the wrong prompt's output", () => {
    const equity = cacheKey("aiVerdict", verdictCacheParams("BTC-USD", "equity"));
    const crypto = cacheKey("aiVerdict", verdictCacheParams("BTC-USD", "crypto"));
    expect(equity).not.toBe(crypto);
  });

  it("gives a generic and a personalized request DIFFERENT keys", () => {
    const generic = cacheKey("aiVerdict", verdictCacheParams("AAPL", "equity"));
    const personal = cacheKey(
      "aiVerdict",
      verdictCacheParams("AAPL", "equity", { fitScore: "78", fitTier: "good" }),
    );
    expect(generic).not.toBe(personal);
  });

  it("gives two DIFFERENT portfolio contexts different keys", () => {
    const a = cacheKey("aiVerdict", verdictCacheParams("AAPL", "equity", { fitScore: "78" }));
    const b = cacheKey("aiVerdict", verdictCacheParams("AAPL", "equity", { fitScore: "42" }));
    expect(a).not.toBe(b);
  });

  it("gives the SAME key for the same context regardless of param order", () => {
    // cacheKey sorts params, so callers cannot accidentally fork the cache by
    // building the object in a different order.
    const a = cacheKey("aiVerdict", { symbol: "AAPL", kind: "equity", fitScore: "78", fitTier: "good" });
    const b = cacheKey("aiVerdict", { fitTier: "good", fitScore: "78", kind: "equity", symbol: "AAPL" });
    expect(a).toBe(b);
  });

  it("shares one key across repeat views of the same company and context", () => {
    const first = cacheKey(
      "aiVerdict",
      verdictCacheParams("MSFT", "equity", personalizationParams(url("symbol=MSFT&fitScore=74&fitTier=good"))),
    );
    const second = cacheKey(
      "aiVerdict",
      verdictCacheParams("msft", "equity", personalizationParams(url("symbol=msft&fitTier=good&fitScore=74"))),
    );
    expect(first).toBe(second);
  });

  it("does not let the refresh flag fork the cache", () => {
    // `refresh=1` must bypass the read, not write to a different slot — otherwise
    // a forced refresh would never replace the entry it was meant to replace.
    const normal = cacheKey("aiVerdict", verdictCacheParams("AAPL", "equity", personalizationParams(url("symbol=AAPL"))));
    const refreshed = cacheKey("aiVerdict", verdictCacheParams("AAPL", "equity", personalizationParams(url("symbol=AAPL&refresh=1"))));
    expect(normal).toBe(refreshed);
  });
});

describe("aiVerdict cache policy", () => {
  it("is persisted and long-lived, and is invalidated by the analytical chain", async () => {
    const { DATASETS, dependencyClosure } = await import("@/lib/platform/registry");
    const policy = DATASETS.aiVerdict;

    expect(policy.persist).toBe(true);
    expect(policy.ttlMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(policy.swrMs).toBeGreaterThan(policy.ttlMs);

    // A new filing is exactly the event that should discard a cached thesis.
    expect(dependencyClosure("filings")).toContain("aiVerdict");
    expect(dependencyClosure("statements")).toContain("aiVerdict");
    expect(dependencyClosure("fundamentals")).toContain("aiVerdict");

    // Invalidation stays scoped: another company's chain never reaches this one,
    // and unrelated reference data never discards a verdict.
    expect(dependencyClosure("profile")).not.toContain("aiVerdict");
    expect(dependencyClosure("search")).not.toContain("aiVerdict");
    expect(dependencyClosure("macro")).not.toContain("aiVerdict");
  });
});
