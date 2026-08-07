import { describe, it, expect } from "vitest";
import {
  captureFingerprint,
  diffFingerprints,
  buildChangeFeed,
  parseFingerprint,
  shouldPromoteBaseline,
  FINGERPRINT_VERSION,
  VISIT_GAP_MS,
  HEALTH_MATERIAL_PTS,
  OPP_SCORE_MATERIAL,
  ATTENTION_NEW_MIN_SCORE,
  type HomeFingerprint,
  type FingerprintSource,
} from "@/lib/home/changes";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function fingerprint(overrides: Partial<HomeFingerprint> = {}): HomeFingerprint {
  return {
    version: FINGERPRINT_VERSION,
    takenAt: "2026-07-25T14:00:00.000Z",
    healthScore: 72,
    healthGrade: "B",
    regimeTrend: "risk-on",
    sentimentLabel: "Neutral",
    sentimentScore: 52,
    attention: [
      { key: "action:AAPL:70", kind: "action", score: 71, headline: "Reduce AAPL", symbol: "AAPL" },
    ],
    opportunities: [{ symbol: "MSFT", score: 78, tier: "good" }],
    threats: [{ key: "concentration", severity: "medium", impactPct: -8, title: "Tech concentration" }],
    watchlistBuckets: { buy: [], nearBuy: ["NVDA"], highRisk: [] },
    largestDrift: null,
    ...overrides,
  };
}

function digestSource(overrides: Partial<FingerprintSource> = {}): FingerprintSource {
  return {
    generatedAt: "2026-07-26T09:00:00.000Z",
    attention: {
      status: "ok",
      items: [
        {
          id: "action:1",
          dedupeKey: "action:AAPL:70",
          kind: "action",
          symbol: "AAPL",
          headline: "Reduce AAPL",
          rationale: "Concentration",
          score: 71,
          impact: 0.7,
          urgency: 0.6,
          confidence: 0.8,
          occursAt: null,
          primaryAction: { label: "Open", href: "/portfolio" },
          source: "actions",
        },
      ],
      openCount: 1,
      degradedFeeders: [],
      reviewedAt: "2026-07-26T09:00:00.000Z",
    },
    marketIntelligence: {
      status: "ok",
      groups: [],
      breadthPct: 55,
      sentiment: { score: 52, label: "Neutral", components: [], confidence: "medium" },
      regime: { trend: "risk-on", summary: "", breadthPct: 55 },
      sectorAttention: [],
    },
    portfolioPulse: {
      status: "ok",
      healthScore: 72,
      healthGrade: "B",
      totalValue: 100_000,
      todayChangePct: 0.4,
      todayChangeDollar: 400,
      bestPerformer: null,
      worstPerformer: null,
      sessionNote: null,
      asOf: 0,
      sessionDate: null,
      largestRisk: null,
      largestOpportunity: null,
      cashPct: 5,
      diversificationScore: 60,
      largestDrift: { label: "Equity", driftPct: 4.2 },
      totalReturnOnCostPct: 3.1,
      marketPricedPct: 100,
      radar: [],
      biggestStrength: null,
      biggestWeakness: null,
      healthCoveragePct: 90,
      healthFactors: [],
      topContributors: [],
    },
    threats: {
      status: "ok",
      threats: [
        {
          id: "concentration-0",
          title: "Tech concentration",
          category: "concentration",
          severity: "medium",
          probability: null,
          impactPct: -8,
          detail: "",
          mitigation: "",
          href: "/portfolio",
        },
      ],
      worstCasePct: null,
    },
    opportunityFeed: {
      status: "ok",
      opportunities: [{ symbol: "msft", combinedScore: 78, fitTier: "good", fitSummary: "" }],
      scannerFreshness: null,
    },
    watchlistIntelligence: {
      status: "ok",
      total: 2,
      buckets: [
        { id: "buy", label: "Buy", symbols: [] },
        { id: "near-buy", label: "Near buy", symbols: ["nvda"] },
        { id: "high-risk", label: "High risk", symbols: [] },
      ],
      alerts: [],
      upcomingEarnings: [],
    },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* captureFingerprint                                                  */
/* ------------------------------------------------------------------ */

describe("captureFingerprint", () => {
  it("projects the digest slices into a versioned fingerprint", () => {
    const fp = captureFingerprint(digestSource());
    expect(fp.version).toBe(FINGERPRINT_VERSION);
    expect(fp.healthScore).toBe(72);
    expect(fp.regimeTrend).toBe("risk-on");
    expect(fp.attention).toHaveLength(1);
    expect(fp.attention[0].key).toBe("action:AAPL:70");
    // threat keys drop the trailing index so identity is stable across builds
    expect(fp.threats[0].key).toBe("concentration");
  });

  it("uppercases opportunity and watchlist symbols", () => {
    const fp = captureFingerprint(digestSource());
    expect(fp.opportunities[0].symbol).toBe("MSFT");
    expect(fp.watchlistBuckets.nearBuy).toEqual(["NVDA"]);
  });
});

/* ------------------------------------------------------------------ */
/* parseFingerprint / baseline promotion                               */
/* ------------------------------------------------------------------ */

describe("parseFingerprint", () => {
  it("round-trips a real fingerprint through JSON", () => {
    const fp = fingerprint();
    expect(parseFingerprint(JSON.parse(JSON.stringify(fp)))).toEqual(fp);
  });

  it("rejects garbage, wrong versions, and partial blobs", () => {
    expect(parseFingerprint(null)).toBeNull();
    expect(parseFingerprint("x")).toBeNull();
    expect(parseFingerprint({})).toBeNull();
    expect(parseFingerprint({ ...fingerprint(), version: 999 })).toBeNull();
    expect(parseFingerprint({ ...fingerprint(), attention: "nope" })).toBeNull();
  });
});

describe("shouldPromoteBaseline", () => {
  it("promotes only after the visit gap", () => {
    const now = Date.now();
    expect(shouldPromoteBaseline(now - VISIT_GAP_MS + 1000, now)).toBe(false);
    expect(shouldPromoteBaseline(now - VISIT_GAP_MS, now)).toBe(true);
    expect(shouldPromoteBaseline(now - VISIT_GAP_MS * 10, now)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* diffFingerprints                                                    */
/* ------------------------------------------------------------------ */

describe("diffFingerprints", () => {
  it("returns nothing when nothing material moved", () => {
    const a = fingerprint();
    // one point of health, one point of opportunity score: both sub-threshold
    const b = fingerprint({
      healthScore: a.healthScore! + HEALTH_MATERIAL_PTS - 1,
      opportunities: [{ symbol: "MSFT", score: 78 + OPP_SCORE_MATERIAL - 1, tier: "good" }],
    });
    expect(diffFingerprints(a, b)).toEqual([]);
  });

  it("reports a material health move with before → after in the detail", () => {
    const changes = diffFingerprints(fingerprint(), fingerprint({ healthScore: 77, healthGrade: "B+" }));
    const health = changes.find((c) => c.kind === "health");
    expect(health).toBeDefined();
    expect(health!.tone).toBe("improved");
    expect(health!.headline).toContain("77");
    expect(health!.detail).toContain("72");
  });

  it("reports a regime shift", () => {
    const changes = diffFingerprints(fingerprint(), fingerprint({ regimeTrend: "risk-off" }));
    expect(changes.some((c) => c.kind === "regime" && c.headline.includes("risk-off"))).toBe(true);
  });

  it("reports new threats as worsened and ranks them above informational changes", () => {
    const next = fingerprint({
      sentimentLabel: "Greed",
      threats: [
        ...fingerprint().threats,
        { key: "currency", severity: "high", impactPct: -15, title: "FX exposure" },
      ],
    });
    const changes = diffFingerprints(fingerprint(), next);
    const threat = changes.find((c) => c.kind === "threat-new");
    expect(threat).toBeDefined();
    expect(threat!.tone).toBe("worsened");
    // ranked first: a new 15%-at-risk threat outranks a sentiment band change
    expect(changes[0].kind).toBe("threat-new");
  });

  it("reports a threat severity escalation", () => {
    const next = fingerprint({
      threats: [{ key: "concentration", severity: "high", impactPct: -12, title: "Tech concentration" }],
    });
    const changes = diffFingerprints(fingerprint(), next);
    expect(changes.some((c) => c.kind === "threat-escalated")).toBe(true);
  });

  it("reports new attention stories above the score floor, and folds overflow", () => {
    const mk = (i: number, score: number) => ({
      key: `alert:S${i}`,
      kind: "alert" as const,
      score,
      headline: `Alert ${i}`,
      symbol: `S${i}`,
    });
    const next = fingerprint({
      attention: [
        ...fingerprint().attention,
        mk(1, 80), mk(2, 75), mk(3, 70), mk(4, 65), mk(5, 60),
        mk(6, ATTENTION_NEW_MIN_SCORE - 1), // below floor — never listed
      ],
    });
    const changes = diffFingerprints(fingerprint(), next);
    const listed = changes.filter((c) => c.kind === "attention-new" && c.id !== "attn-new:more");
    expect(listed).toHaveLength(4);
    expect(changes.some((c) => c.id === "attn-new:more")).toBe(true);
    expect(changes.some((c) => c.headline.includes("Alert 6"))).toBe(false);
  });

  it("reports resolved attention items as improvement", () => {
    const changes = diffFingerprints(fingerprint(), fingerprint({ attention: [] }));
    const resolved = changes.find((c) => c.kind === "attention-resolved");
    expect(resolved).toBeDefined();
    expect(resolved!.tone).toBe("improved");
    expect(resolved!.headline).toContain("1");
  });

  it("reports new opportunities and material fit-score moves", () => {
    const next = fingerprint({
      opportunities: [
        { symbol: "MSFT", score: 78 + OPP_SCORE_MATERIAL, tier: "good" },
        { symbol: "AMD", score: 82, tier: "excellent" },
      ],
    });
    const changes = diffFingerprints(fingerprint(), next);
    expect(changes.some((c) => c.kind === "opportunity-new" && c.symbol === "AMD")).toBe(true);
    const rescored = changes.find((c) => c.kind === "opportunity-score");
    expect(rescored?.symbol).toBe("MSFT");
    expect(rescored?.tone).toBe("improved");
  });

  it("reports a watchlist name entering the buy zone", () => {
    const next = fingerprint({ watchlistBuckets: { buy: ["NVDA"], nearBuy: [], highRisk: [] } });
    const changes = diffFingerprints(fingerprint(), next);
    expect(changes.some((c) => c.kind === "watchlist-move" && c.symbol === "NVDA")).toBe(true);
  });

  it("reports a new worst drift but not an unchanged one", () => {
    const drifted = fingerprint({ largestDrift: { label: "Equity", driftPct: 5 } });
    expect(diffFingerprints(fingerprint(), drifted).some((c) => c.kind === "drift")).toBe(true);
    // identical drift on both sides = state, not change
    expect(diffFingerprints(drifted, drifted).some((c) => c.kind === "drift")).toBe(false);
  });

  it("sorts by magnitude descending", () => {
    const next = fingerprint({
      healthScore: 60, // -12: big
      sentimentLabel: "Greed", // small
    });
    const changes = diffFingerprints(fingerprint(), next);
    const magnitudes = changes.map((c) => c.magnitude);
    expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
  });
});

/* ------------------------------------------------------------------ */
/* buildChangeFeed                                                     */
/* ------------------------------------------------------------------ */

describe("buildChangeFeed", () => {
  it("marks the first-ever build as firstVisit with no changes", () => {
    const feed = buildChangeFeed(null, fingerprint());
    expect(feed.firstVisit).toBe(true);
    expect(feed.changes).toEqual([]);
    expect(feed.baselineAt).toBeNull();
  });

  it("carries the baseline timestamp when diffing", () => {
    const base = fingerprint();
    const feed = buildChangeFeed(base, fingerprint({ healthScore: 77 }));
    expect(feed.firstVisit).toBe(false);
    expect(feed.baselineAt).toBe(base.takenAt);
    expect(feed.changes.length).toBeGreaterThan(0);
  });
});
