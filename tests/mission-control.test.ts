import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import type { Recommendation } from "@/lib/portfolio/engines/recommend";
import type { SectorRotationSnapshot, WatchlistAlert, Notification, Decision } from "@/lib/types";

const dbMocks = {
  getScannerSnapshot: vi.fn(),
  listDecisions: vi.fn(),
};
const putScannerSnapshotMock = vi.fn();
vi.mock("@/lib/db", () => ({
  getScannerSnapshot: (...args: unknown[]) => dbMocks.getScannerSnapshot(...args),
  putScannerSnapshot: (...args: unknown[]) => putScannerSnapshotMock(...args),
  listDecisions: (...args: unknown[]) => dbMocks.listDecisions(...args),
  listWatchlist: vi.fn().mockReturnValue([]),
  listNotifications: vi.fn().mockReturnValue([]),
  unreadNotificationCount: vi.fn().mockReturnValue(0),
  getScannerCache: vi.fn().mockReturnValue(null),
  putScannerCache: vi.fn(),
}));

const getQuotesMock = vi.fn();
vi.mock("@/lib/yahoo", () => ({ getQuotes: (...args: unknown[]) => getQuotesMock(...args) }));

const {
  buildActionQueue,
  buildSectorAttention,
  buildOpportunitySnapshot,
  buildCalibration,
} = await import("@/lib/mission-control");
const { getLatestScannerSnapshot, persistScannerSnapshot } = await import("@/lib/scanner/cache");

/**
 * The digest reads the UNIVERSAL report — there is one Portfolio engine. Portfolio
 * problems reach the queue through lib/home/threats.ts (the same threat model the
 * Home page and the Risk Lab use) rather than a second alert generator, so a
 * fixture that wants a threat states the risk that produces one.
 */
function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1", action: "ADD", title: "Add bonds", subject: "Bonds", symbol: "AAA",
    rationale: "r", confidence: 70, confidenceBasis: [], amount: 1000,
    priority: 1, alternatives: [], alternativesEvaluated: 0,
    ...overrides,
  } as Recommendation;
}

/** A report shaped just enough for the builders under test. */
function report(overrides: Record<string, unknown>): UniversalPortfolioReport {
  return {
    totalValue: 100_000,
    holdings: [],
    recommendations: [],
    risk: { illiquidPct: 0, topHoldingWeight: 0, topSectorWeight: 0, positionHhi: 0, correlation: null, maxDrawdown: null },
    allocation: { bySector: { slices: [] }, byAssetClass: { slices: [] } },
    scenarios: [],
    concentration: [],
    ...overrides,
  } as unknown as UniversalPortfolioReport;
}

function watchlistAlert(overrides: Partial<WatchlistAlert> = {}): WatchlistAlert {
  return { type: "breakout", severity: "medium", title: "t", description: "d", action: "a", symbol: "WWW", ...overrides };
}

function notification(overrides: Partial<Notification> = {}): Notification {
  return { id: 1, dedupKey: "k", symbol: null, kind: "alert", severity: "info", title: "t", body: "b", read: false, createdAt: "2026-01-01", ...overrides };
}

describe("buildActionQueue", () => {
  it("orders items by severity across all four sources and caps at 10", () => {
    const r = report({ recommendations: [recommendation({ priority: 4, title: "low priority rec" })] });
    const watchlistAlerts = [watchlistAlert({ severity: "high", title: "high watch" })];
    const notifications = [notification({ severity: "warning", title: "warn note" })];

    const result = buildActionQueue(r, watchlistAlerts, notifications);

    expect(result.status).toBe("ok");
    // The low-priority recommendation sinks below the high-severity watchlist and
    // notification items.
    expect(result.items.at(-1)!.title).toBe("low priority rec");
    expect(result.items.map((i) => i.severity)).toEqual([...result.items.map((i) => i.severity)].sort(
      (a, b) => ({ high: 0, medium: 1, low: 2 }[a] - { high: 0, medium: 1, low: 2 }[b]),
    ));
  });

  it("surfaces every recommendation the engine produced, ranked by its priority", () => {
    // The universal engine does not emit no-op advice — there is no HOLD to filter,
    // and filtering here would mean the digest and the Decision Center disagreed
    // about what is actionable.
    const result = buildActionQueue(
      report({ recommendations: [recommendation({ priority: 1, title: "first" }), recommendation({ id: "rec-2", priority: 5, title: "later" })] }),
      [], [],
    );
    expect(result.items.map((i) => i.title)).toEqual(["first", "later"]);
    expect(result.items[0].severity).toBe("high");
  });

  it("excludes already-read notifications", () => {
    const result = buildActionQueue(null, [], [notification({ read: true, title: "read one" })]);
    expect(result.items).toEqual([]);
  });

  it("excludes session-bound alerts whose session is stale (F-22d)", () => {
    // The pre-purge queue: a big_move row from five days ago still ranked as an
    // action titled "down -8.7%". Session-bound kinds leave the queue once
    // older than the previous session; other kinds are untouched.
    const old = notification({ id: 2, kind: "big_move", sessionDate: "2026-07-31", createdAt: "2026-07-31T13:31:00Z", title: "AAPL down 8.7%" });
    const fresh = notification({ id: 3, kind: "big_move", sessionDate: "2026-08-05", createdAt: "2026-08-05T14:10:00Z", title: "NEM up 7.1%" });
    const target = notification({ id: 4, kind: "price_target", createdAt: "2026-07-20T10:00:00Z", title: "APA crossed your target" });

    const realNow = Date.now;
    Date.now = () => Date.parse("2026-08-05T17:00:00Z");
    try {
      const result = buildActionQueue(null, [], [old, fresh, target]);
      expect(result.items.map((i) => i.title)).toContain("NEM up 7.1%");
      expect(result.items.map((i) => i.title)).toContain("APA crossed your target");
      expect(result.items.map((i) => i.title)).not.toContain("AAPL down 8.7%");
    } finally {
      Date.now = realNow;
    }
  });

  it("legacy session-bound rows without sessionDate age out by created date", () => {
    const legacy = notification({ id: 5, kind: "drop_alert", createdAt: "2026-07-28T10:00:00Z", title: "old drop" });
    const realNow = Date.now;
    Date.now = () => Date.parse("2026-08-05T17:00:00Z");
    try {
      expect(buildActionQueue(null, [], [legacy]).items).toEqual([]);
    } finally {
      Date.now = realNow;
    }
  });

  it("returns empty status with no sources", () => {
    const result = buildActionQueue(null, [], []);
    expect(result).toEqual({ status: "empty", items: [] });
  });
});

describe("buildSectorAttention", () => {
  function rotation(overrides: Partial<SectorRotationSnapshot> = {}): SectorRotationSnapshot {
    return {
      asOf: "2026-01-01", primaryWindow: "3m", sectors: [], leaders: [], laggards: [],
      leadershipChanges: [{ sector: "Technology", fromRank: 3, toRank: 1 }],
      ...overrides,
    };
  }

  it("only includes sectors the portfolio actually holds", () => {
    const r = report({ allocation: { bySector: { slices: [{ key: "Technology", label: "Technology", value: 1000, weight: 25, count: 2 }] }, byAssetClass: { slices: [] } } });
    const result = buildSectorAttention(r, rotation());
    expect(result.status).toBe("ok");
    expect(result.changes).toEqual([{ sector: "Technology", fromRank: 3, toRank: 1, portfolioWeightPct: 25 }]);
  });

  it("excludes a leadership change for a sector not held", () => {
    const r = report({ allocation: { bySector: { slices: [{ key: "Healthcare", label: "Healthcare", value: 500, weight: 10, count: 1 }] }, byAssetClass: { slices: [] } } });
    const result = buildSectorAttention(r, rotation());
    expect(result).toEqual({ status: "empty", changes: [] });
  });

  it("returns empty when there's no rotation snapshot", () => {
    expect(buildSectorAttention(null, null)).toEqual({ status: "empty", changes: [] });
  });
});

describe("scanner snapshot freshness (lib/scanner/cache.ts)", () => {
  beforeEach(() => {
    dbMocks.getScannerSnapshot.mockReset();
  });

  it("classifies a snapshot from 30 minutes ago as fresh", () => {
    const generatedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    dbMocks.getScannerSnapshot.mockReturnValue({ result: JSON.stringify({ scannedAt: generatedAt }), generatedAt });
    const snap = getLatestScannerSnapshot();
    expect(snap?.freshness.level).toBe("fresh");
  });

  it("classifies a snapshot from 3 hours ago as stale", () => {
    const generatedAt = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    dbMocks.getScannerSnapshot.mockReturnValue({ result: JSON.stringify({ scannedAt: generatedAt }), generatedAt });
    const snap = getLatestScannerSnapshot();
    expect(snap?.freshness.level).toBe("stale");
  });

  it("returns null when nothing has ever been persisted", () => {
    dbMocks.getScannerSnapshot.mockReturnValue(null);
    expect(getLatestScannerSnapshot()).toBeNull();
  });

  it("persistScannerSnapshot round-trips through putScannerSnapshot with the result's own scannedAt", () => {
    putScannerSnapshotMock.mockReset();
    const result = { scannedAt: "2026-05-01T00:00:00.000Z", foo: "bar" } as never;
    persistScannerSnapshot(result);
    expect(putScannerSnapshotMock).toHaveBeenCalledWith(JSON.stringify(result), "2026-05-01T00:00:00.000Z");
  });
});

describe("buildOpportunitySnapshot", () => {
  beforeEach(() => {
    dbMocks.getScannerSnapshot.mockReset();
  });

  it("returns empty status when no scanner snapshot has ever been produced", () => {
    dbMocks.getScannerSnapshot.mockReturnValue(null);
    const result = buildOpportunitySnapshot({ report: null, rotation: null, regime: null, watchlistAlerts: [], scannerFreshness: null });
    expect(result.status).toBe("empty");
    expect(result.scannerFreshness).toBeNull();
    expect(result.opportunities).toEqual([]);
  });

  it("marks the snapshot degraded when stale, but still returns ranked opportunities", () => {
    const staleAt = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const scannerResult = {
      scannedAt: staleAt,
      highConviction: [
        { id: "1", ticker: "NEW", quote: null, compositeScores: null, dividendYieldPct: null, opportunityScore: { composite: 80 } },
      ],
      developing: [],
    };
    dbMocks.getScannerSnapshot.mockReturnValue({ result: JSON.stringify(scannerResult), generatedAt: staleAt });

    const result = buildOpportunitySnapshot({ report: null, rotation: null, regime: null, watchlistAlerts: [], scannerFreshness: null });

    expect(result.status).toBe("degraded");
    expect(result.opportunities.map((o) => o.symbol)).toEqual(["NEW"]);
  });

  it("excludes opportunities already held in the portfolio", () => {
    const freshAt = new Date().toISOString();
    const scannerResult = {
      scannedAt: freshAt,
      highConviction: [
        { id: "1", ticker: "HELD", quote: null, compositeScores: null, dividendYieldPct: null, opportunityScore: { composite: 90 } },
        { id: "2", ticker: "NEW", quote: null, compositeScores: null, dividendYieldPct: null, opportunityScore: { composite: 80 } },
      ],
      developing: [],
    };
    dbMocks.getScannerSnapshot.mockReturnValue({ result: JSON.stringify(scannerResult), generatedAt: freshAt });

    const r = report({
      holdings: [{ symbol: "HELD", weight: 100, valuation: { valueBase: 10_000 }, metrics: {} }],
      holdingCount: 1,
      totalValue: 10_000,
      risk: { positionHhi: 5000, annualizedVolatility: 15, beta: 1, illiquidPct: 0, topHoldingWeight: 100, topSectorWeight: 0, correlation: null, maxDrawdown: null },
      alignment: { score: 70, scoreExact: 70, label: "Well aligned", status: "scored", confirmed: false, themes: [], mismatches: [], dataGaps: [], summary: "", evidencePct: 100 },
    });
    const result = buildOpportunitySnapshot({ report: r, rotation: null, regime: null, watchlistAlerts: [], scannerFreshness: null });

    expect(result.status).toBe("ok");
    expect(result.opportunities.map((o) => o.symbol)).toEqual(["NEW"]);
  });
});

describe("buildCalibration", () => {
  beforeEach(() => {
    dbMocks.listDecisions.mockReset();
    getQuotesMock.mockReset();
  });

  function decision(overrides: Partial<Decision> = {}): Decision {
    return {
      id: 1, symbol: "AAA", name: null, action: "buy", conviction: 3, thesis: null, priceAt: 100,
      currency: "USD", targetPrice: null, horizon: null, fitScore: null, fitTier: null,
      status: "closed", closePrice: 110, closedAt: "2026-01-01", createdAt: "2025-12-01", caseVersion: null,
      ...overrides,
    };
  }

  it("is not eligible below 5 logged decisions", async () => {
    dbMocks.listDecisions.mockReturnValue([decision(), decision({ id: 2 }), decision({ id: 3 }), decision({ id: 4 })]);
    const result = await buildCalibration(null);
    expect(result).toEqual({ status: "empty", trackRecord: null, eligible: false });
    expect(getQuotesMock).not.toHaveBeenCalled();
  });

  it("becomes eligible at exactly 5 logged decisions", async () => {
    dbMocks.listDecisions.mockReturnValue(Array.from({ length: 5 }, (_, i) => decision({ id: i + 1 })));
    const result = await buildCalibration(null);
    expect(result.eligible).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.trackRecord?.total).toBe(5);
  });
});
