/**
 * The new decision surfaces: Threat Center, Performance Attribution, and the
 * Timeline / Intelligence feeds.
 *
 * The through-line is the same no-fabrication rule the rest of the home engines
 * hold to: a threat carries a probability only where one is genuinely sourced
 * (the 95% VaR is a 5% tail by construction); attribution is derived from the
 * report's own per-holding P&L, not invented; and the two feeds are two views
 * of one merged stream, so the high-signal one is a strict subset.
 */

import { describe, it, expect } from "vitest";
import { buildThreats } from "@/lib/home/threats";
import { buildAttribution } from "@/lib/home/attribution";
import { buildTimelineFeeds } from "@/lib/home/timeline";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import type { Notification, WatchlistAlert } from "@/lib/types";
import type { ActivityEntry, UpcomingEventLite } from "@/lib/home/contracts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function holding(symbol: string, unrealizedPL: number, sector: string | null) {
  return { symbol, name: symbol, unrealizedPL, attributes: { sector } } as unknown as UniversalPortfolioReport["holdings"][number];
}

function report(over: Partial<UniversalPortfolioReport> = {}): UniversalPortfolioReport {
  return {
    holdingCount: 3,
    totalValue: 100_000,
    totalCost: 100_000,
    totalReturn: 12,
    totalReturnDollar: 12_000,
    holdings: [
      holding("AAPL", 6_000, "Technology"),
      holding("MSFT", 2_000, "Technology"),
      holding("XOM", -3_000, "Energy"),
    ],
    risk: {
      duration: 6.2,
      inflationSensitivity: -1.8,
      creditSensitivity: 0.2,
      foreignCurrencyPct: 22,
      illiquidPct: 4,
      var95Pct: 3.1,
      cvar95Pct: 4.4,
      correlation: { avgCorrelation: 0.7 },
    },
    concentration: [
      { type: "sector", label: "Technology", pct: 68, severity: "high", message: "68% in Technology." },
    ],
    scenarios: [
      { id: "s1", portfolioImpactPct: -8, portfolioImpactValue: -8000 },
      { id: "s2", portfolioImpactPct: -22, portfolioImpactValue: -22000 },
    ],
    allocation: {
      byAssetClass: { hhi: 2000, slices: [{ key: "cash", label: "Cash", weight: 8, value: 8_000 }] },
    },
    ...over,
  } as unknown as UniversalPortfolioReport;
}

/* ------------------------------------------------------------------ */
/* Threats                                                             */
/* ------------------------------------------------------------------ */

describe("buildThreats", () => {
  it("reports empty for no portfolio", () => {
    expect(buildThreats(null).status).toBe("empty");
    expect(buildThreats(report({ holdingCount: 0 })).threats).toEqual([]);
  });

  it("surfaces the harshest scenario as the worst case", () => {
    expect(buildThreats(report()).worstCasePct).toBe(-22);
  });

  it("attaches a 5% probability only to the VaR threat, null elsewhere", () => {
    const threats = buildThreats(report()).threats;
    const varThreat = threats.find((t) => t.category === "drawdown");
    expect(varThreat?.probability).toBe(0.05);
    const rates = threats.find((t) => t.category === "rates");
    expect(rates?.probability).toBeNull();
  });

  it("maps duration to a negative impact and flags high-duration books", () => {
    const rates = buildThreats(report()).threats.find((t) => t.category === "rates");
    expect(rates?.impactPct).toBe(-6.2);
    expect(rates?.severity).toBe("medium"); // 6.2 is between 4 and 7
  });

  it("ranks by severity — the high-severity concentration threat leads", () => {
    const threats = buildThreats(report()).threats;
    expect(threats[0].severity).toBe("high");
  });

  it("does not flag a benign rate/inflation profile", () => {
    const benign = report({
      risk: {
        duration: 0.3,
        inflationSensitivity: 0.1,
        creditSensitivity: 0,
        foreignCurrencyPct: 2,
        illiquidPct: 0,
        var95Pct: null,
        cvar95Pct: null,
        correlation: null,
      },
      concentration: [],
    } as unknown as Partial<UniversalPortfolioReport>);
    expect(buildThreats(benign).threats).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Attribution                                                         */
/* ------------------------------------------------------------------ */

describe("buildAttribution", () => {
  it("reports empty for no portfolio or no cost basis", () => {
    expect(buildAttribution(null, null).status).toBe("empty");
    expect(buildAttribution(report({ totalCost: 0 }), null).status).toBe("empty");
  });

  it("decomposes contribution by holding, ranked by magnitude", () => {
    const a = buildAttribution(report(), null);
    expect(a.byHolding[0].label).toBe("AAPL"); // +6000 is the biggest mover
    expect(a.byHolding[0].contributionPct).toBeCloseTo(6, 5); // 6000/100000
  });

  it("aggregates contribution by sector", () => {
    const a = buildAttribution(report(), null);
    const tech = a.bySector.find((r) => r.label === "Technology");
    expect(tech?.contributionDollar).toBe(8_000); // 6000 + 2000
  });

  it("computes cash drag as opportunity cost at the book's own rate", () => {
    const a = buildAttribution(report(), null);
    // 8000 cash × 12% book return, held back = −960.
    expect(a.cashDrag?.contributionDollar).toBeCloseTo(-960, 5);
  });

  it("passes the benchmark through", () => {
    const a = buildAttribution(report(), { symbol: "SPY", excessPct: 1.4 });
    expect(a.benchmark).toEqual({ symbol: "SPY", excessPct: 1.4 });
  });
});

/* ------------------------------------------------------------------ */
/* Timeline & Intelligence                                            */
/* ------------------------------------------------------------------ */

function notif(id: number, severity: "info" | "warning", title: string, createdAt: string): Notification {
  return { id, dedupKey: `k${id}`, symbol: "AAPL", kind: "alert", severity, title, body: "", read: false, createdAt };
}

describe("buildTimelineFeeds", () => {
  const activity: ActivityEntry[] = [
    { id: 1, kind: "research", ref: "nvda", label: "NVDA", href: "/research?symbol=NVDA", at: "2026-07-17T10:00:00.000Z" },
  ];
  const notifications = [
    notif(1, "warning", "NVDA entered overvalued zone", "2026-07-18T02:00:00.000Z"),
    notif(2, "info", "Dividend received from VZ", "2026-07-16T12:00:00.000Z"),
  ];
  const watchlistAlerts: WatchlistAlert[] = [
    { type: "price_target" as WatchlistAlert["type"], severity: "high", title: "hit target", description: "at $150", action: "review", symbol: "TSLA" },
  ];
  const upcomingEvents: UpcomingEventLite[] = [
    { id: "e1", symbol: "AAPL", name: "Earnings", type: "earnings", date: "2099-01-01" },
  ];

  it("puts upcoming events at the top with the upcoming flag set", () => {
    const { timeline } = buildTimelineFeeds({ activity, notifications, watchlistAlerts, upcomingEvents });
    expect(timeline.items[0].upcoming).toBe(true);
    expect(timeline.items[0].kind).toBe("event");
  });

  it("orders history newest-first after the upcoming block", () => {
    const { timeline } = buildTimelineFeeds({ activity, notifications, watchlistAlerts, upcomingEvents });
    const past = timeline.items.filter((i) => !i.upcoming);
    const times = past.map((i) => Date.parse(i.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("intelligence is a strict high-signal subset — warnings and alerts only", () => {
    const { intelligence } = buildTimelineFeeds({ activity, notifications, watchlistAlerts, upcomingEvents });
    expect(intelligence.items.every((i) => i.kind === "alert" || (i.kind === "notification" && i.tone === "warning"))).toBe(true);
    // The info-severity dividend notification and the research activity are excluded.
    expect(intelligence.items.some((i) => i.title.includes("Dividend"))).toBe(false);
  });
});
