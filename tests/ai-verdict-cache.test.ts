import { beforeEach, describe, expect, it } from "vitest";
import { personalizationParams, stableVerdictIdentity } from "@/lib/ai/verdict-params";
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
      verdictCacheParams("AAPL", "equity", stableVerdictIdentity({ fitScore: "78", fitTier: "good" })),
    );
    expect(generic).not.toBe(personal);
  });

  it("gives two MATERIALLY different portfolio contexts different keys", () => {
    const a = cacheKey(
      "aiVerdict",
      verdictCacheParams("AAPL", "equity", stableVerdictIdentity({ fitTier: "good", action: "add" })),
    );
    const b = cacheKey(
      "aiVerdict",
      verdictCacheParams("AAPL", "equity", stableVerdictIdentity({ fitTier: "poor", action: "avoid" })),
    );
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
      verdictCacheParams("MSFT", "equity", stableVerdictIdentity(personalizationParams(url("symbol=MSFT&fitScore=74&fitTier=good")))),
    );
    const second = cacheKey(
      "aiVerdict",
      verdictCacheParams("msft", "equity", stableVerdictIdentity(personalizationParams(url("symbol=msft&fitTier=good&fitScore=74")))),
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

describe("stableVerdictIdentity", () => {
  it("keeps every dimension that materially changes the conclusion", () => {
    expect(
      stableVerdictIdentity({
        fitTier: "good",
        action: "add",
        isInPortfolio: "true",
        objective: "maximize_growth",
        missingSectors: "Healthcare, Energy",
        suggestedPct: "4.5",
      }),
    ).toEqual({
      fitTier: "good",
      action: "add",
      isInPortfolio: "true",
      objective: "maximize_growth",
      missingSectors: "Energy,Healthcare",
      suggestedPct: "5",
    });
  });

  it("drops the volatile details that forked the cache on every market tick", () => {
    // Phase 1 evidence: three AAPL entries at fitScore 59/60/61 — three full
    // Opus generations of the same thesis. These fields stay in the PROMPT
    // (a miss still generates with live numbers) but not in the KEY.
    const identity = stableVerdictIdentity({
      fitScore: "78",
      reasons: "Fills your Healthcare gap; strong fundamentals",
      actionReason: "Research 72/100 (Buy) with good portfolio fit (65/100).",
      fitTier: "good",
    });
    expect(identity).toEqual({ fitTier: "good" });
  });

  it("gives the same key to fit scores in the same tier", () => {
    const at59 = stableVerdictIdentity({ fitScore: "59", fitTier: "neutral", action: "starter" });
    const at61 = stableVerdictIdentity({ fitScore: "61", fitTier: "neutral", action: "starter" });
    expect(at59).toEqual(at61);
  });

  it("normalizes sector-gap ordering so it cannot fork the cache", () => {
    const a = stableVerdictIdentity({ missingSectors: "Energy, Healthcare" });
    const b = stableVerdictIdentity({ missingSectors: "Healthcare,Energy" });
    expect(a).toEqual(b);
  });

  it("buckets the suggested allocation to a whole percent, preserving 0 vs non-zero", () => {
    expect(stableVerdictIdentity({ suggestedPct: "4.5" }).suggestedPct).toBe("5");
    expect(stableVerdictIdentity({ suggestedPct: "4.6" }).suggestedPct).toBe("5");
    expect(stableVerdictIdentity({ suggestedPct: "0.0" }).suggestedPct).toBe("0");
  });

  it("returns {} for a generic request, sharing the unpersonalized key", () => {
    expect(stableVerdictIdentity({})).toEqual({});
  });
});

describe("stableRequestIdentity (client request key)", () => {
  // The client-side mirror of stableVerdictIdentity: the hook keys the stream
  // on this, so live-data drift in the volatile params can never abort an
  // in-flight generation and pay for a second one (measured live 2026-08-12:
  // a background portfolio-report revalidation re-keyed the stream and killed
  // a generation 6.3s in).
  it("ignores the volatile params that drift with live data", async () => {
    const { stableRequestIdentity } = await import("@/lib/ai/client/use-verdict-stream");
    const before = stableRequestIdentity({
      fitScore: "68",
      fitTier: "good",
      isInPortfolio: "true",
      objective: "ai_optimized",
      reasons: "5.0% allocation fits comfortably within your limits",
      actionReason: "Research 72/100 (Buy) with good portfolio fit (65/100).",
    });
    const afterTick = stableRequestIdentity({
      fitScore: "69", // moved a point on a market tick
      fitTier: "good",
      isInPortfolio: "true",
      objective: "ai_optimized",
      reasons: "5.1% allocation fits comfortably within your limits",
      actionReason: "Research 73/100 (Buy) with good portfolio fit (66/100).",
    });
    expect(before).toBe(afterTick);
  });

  it("changes when a dimension that materially changes the verdict changes", async () => {
    const { stableRequestIdentity } = await import("@/lib/ai/client/use-verdict-stream");
    const good = stableRequestIdentity({ fitTier: "good", action: "add" });
    const poor = stableRequestIdentity({ fitTier: "poor", action: "avoid" });
    expect(good).not.toBe(poor);
  });

  it("mirrors the server identity's normalization (sector order, whole-percent sizing)", async () => {
    const { stableRequestIdentity } = await import("@/lib/ai/client/use-verdict-stream");
    const a = stableRequestIdentity({ missingSectors: "Energy, Healthcare", suggestedPct: "4.5" });
    const b = stableRequestIdentity({ missingSectors: "Healthcare,Energy", suggestedPct: "4.6" });
    expect(a).toBe(b);
  });

  it("returns the empty identity for a generic request", async () => {
    const { stableRequestIdentity } = await import("@/lib/ai/client/use-verdict-stream");
    expect(stableRequestIdentity(null)).toBe("");
    expect(stableRequestIdentity({})).toBe("");
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
