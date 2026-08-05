/**
 * The pure homepage engines: pulse, actions, watchlist buckets.
 *
 * The through-line in these tests is the no-fabrication rule. A queue item has
 * no decision score and must report null rather than a made-up number; an empty
 * portfolio has no health and must report "empty" rather than zeros; a
 * watchlist name with no alert belongs in no bucket rather than a default one.
 * Each of those is a place where the easy implementation lies to the user, so
 * each gets a test.
 */

import { describe, it, expect } from "vitest";
import { buildPortfolioPulse, diversificationFromHhi } from "@/lib/home/pulse";
import { buildRecommendedActions } from "@/lib/home/actions";
import { buildWatchlistIntelligence } from "@/lib/home/watchlist-intel";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import type { WatchlistAlert, WatchlistItem, Notification } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function holding(symbol: string, unrealizedPct: number, unrealizedPL: number) {
  return { symbol, name: symbol, unrealizedPct, unrealizedPL } as UniversalPortfolioReport["holdings"][number];
}

const PULSE_NOW = Date.parse("2026-07-26T15:00:00");

/** A stamped day-move fixture: current session unless a date is given. */
function dayMove(symbol: string, dayPct: number, dayDollar: number, sessionDate = "2026-07-26", sinceCostPct: number | null = null) {
  return {
    symbol,
    dayChange: { value: dayPct, basis: "day" as const, asOf: PULSE_NOW, source: "yahoo" as const, sessionDate },
    sinceCost: sinceCostPct != null ? { value: sinceCostPct, basis: "sinceCost" as const, asOf: PULSE_NOW, source: "yahoo" as const } : null,
    dayDollar,
    plDollar: null,
  };
}

function report(over: Partial<UniversalPortfolioReport> = {}): UniversalPortfolioReport {
  return {
    holdingCount: 3,
    totalValue: 100_000,
    totalReturn: 12,
    totalReturnDollar: 12_000,
    todayChangePct: 0.8,
    todayChangeDollar: 800,
    marketPricedPct: 100,
    holdings: [holding("AAPL", 40, 4000), holding("MSFT", 10, 1000), holding("XYZ", -15, -1500)],
    generatedAt: new Date(PULSE_NOW).toISOString(),
    dayMoves: [dayMove("AAPL", 2.1, 2100), dayMove("MSFT", 0.4, 400), dayMove("XYZ", -1.5, -1500)],
    health: { total: 72, grade: "B" },
    concentration: [
      { type: "sector", label: "Technology", pct: 68, severity: "high", message: "68% in Technology." },
      { type: "holding", label: "AAPL", pct: 30, severity: "medium", message: "30% in AAPL." },
    ],
    recommendations: [{ action: "ADD", symbol: "BND", rationale: "No bond exposure." }],
    decisions: [],
    allocation: {
      byAssetClass: { hhi: 2000, slices: [{ key: "cash", label: "Cash", weight: 8 }] },
    },
    optimization: { classTargets: [{ assetClass: "bond", label: "Bonds", currentWeight: 0, targetWeight: 15, delta: -15 }] },
    ...over,
  } as unknown as UniversalPortfolioReport;
}

/* ------------------------------------------------------------------ */
/* Pulse                                                               */
/* ------------------------------------------------------------------ */

describe("buildPortfolioPulse", () => {
  it("reports empty — not zeros — when there is no portfolio", () => {
    const p = buildPortfolioPulse(null);
    expect(p.status).toBe("empty");
    expect(p.healthScore).toBeNull();
    expect(p.bestPerformer).toBeNull();
  });

  it("treats a zero-holding report as empty", () => {
    expect(buildPortfolioPulse(report({ holdingCount: 0 })).status).toBe("empty");
  });

  it("ranks movers on the DAY's move, not since-cost P&L (F-22g)", () => {
    const p = buildPortfolioPulse(report(), PULSE_NOW);
    // AAPL has the biggest since-cost gain (+40%) but only +2.1% today; the
    // ranking must read the day metric.
    expect(p.bestPerformer?.symbol).toBe("AAPL");
    expect(p.bestPerformer?.dayChange?.value).toBe(2.1);
    expect(p.bestPerformer?.dayChange?.basis).toBe("day");
    expect(p.worstPerformer?.symbol).toBe("XYZ");
    expect(p.worstPerformer?.dayChange?.value).toBe(-1.5);
    expect(p.worstPerformer?.dayDollar).toBe(-1500);
  });

  it("does not report a worst performer when there is only one mover", () => {
    const p = buildPortfolioPulse(report({ dayMoves: [dayMove("AAPL", 2.1, 2100)] }), PULSE_NOW);
    expect(p.bestPerformer?.symbol).toBe("AAPL");
    expect(p.worstPerformer).toBeNull();
  });

  it("disqualifies stale sessions from the movers strip entirely (F-22d)", () => {
    const p = buildPortfolioPulse(
      report({ dayMoves: [dayMove("AAPL", -8.7, -8700, "2026-07-20"), dayMove("MSFT", 0.4, 400)] }),
      PULSE_NOW,
    );
    // The week-old -8.7% print cannot be "Weakest" on a Sunday two weeks later.
    expect(p.bestPerformer?.symbol).toBe("MSFT");
    expect(p.worstPerformer).toBeNull();
    expect(p.sessionNote).toBeNull(); // MSFT's session is current
  });

  it("labels a fully-closed market once, deliberately (amendment 2)", () => {
    // Saturday: every mover describes Friday's finished session.
    const saturday = Date.parse("2026-07-25T11:00:00");
    const p = buildPortfolioPulse(
      report({ dayMoves: [dayMove("AAPL", 1.2, 1200, "2026-07-24"), dayMove("XYZ", -0.8, -800, "2026-07-24")] }),
      saturday,
    );
    expect(p.sessionNote).toBe("Markets closed · Fri, Jul 24 close");
    expect(p.bestPerformer?.symbol).toBe("AAPL");
    expect(p.worstPerformer?.symbol).toBe("XYZ");
  });

  it("surfaces the highest-severity concentration finding as the largest risk", () => {
    expect(buildPortfolioPulse(report()).largestRisk?.title).toBe("Technology");
  });

  it("reads health, cash and drift straight from the engines", () => {
    const p = buildPortfolioPulse(report());
    expect(p.healthScore).toBe(72);
    expect(p.healthGrade).toBe("B");
    expect(p.cashPct).toBe(8);
    expect(p.largestDrift).toEqual({ label: "Bonds", driftPct: -15 });
  });

  it("suppresses sub-1pp drift as noise", () => {
    const p = buildPortfolioPulse(
      report({
        optimization: {
          classTargets: [{ assetClass: "bond", label: "Bonds", currentWeight: 15, targetWeight: 15.4, delta: -0.4 }],
        },
      } as Partial<UniversalPortfolioReport>),
    );
    expect(p.largestDrift).toBeNull();
  });

  it("maps HHI onto the engine's own diversified/concentrated bands", () => {
    expect(diversificationFromHhi(1000)).toBe(100); // diversified
    expect(diversificationFromHhi(1500)).toBe(100); // band edge
    expect(diversificationFromHhi(2500)).toBe(0); // concentrated
    expect(diversificationFromHhi(2000)).toBe(50); // midpoint
    expect(diversificationFromHhi(9000)).toBe(0); // clamped
  });
});

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const decision = (id: string, score: number, priority: number) =>
  ({
    recommendation: {
      id, action: "ADD", symbol: "BND", title: `Add ${id}`, rationale: "No bond exposure.",
      impact: { healthDelta: 3.2, riskDelta: -0.5, diversificationDelta: -150, incomeDelta: 200, liquidityDelta: 0 },
    },
    decisionScore: score,
    decisionPriority: priority,
    confidence: 80,
    expectedBenefit: "+6 health points",
    expectedReturnImpact: "+0.4% expected return",
    why: { why: "w", whyNow: "n", whyThisAmount: "a", whyNotAlternative: "alt", whyNotNothing: "z" },
    alternativesEvaluated: 7,
  }) as unknown as UniversalPortfolioReport["decisions"][number];

describe("buildRecommendedActions", () => {
  it("prefers the decision engine and preserves its ranking", () => {
    const r = buildRecommendedActions(
      report({ decisions: [decision("b", 60, 2), decision("a", 90, 1)] }),
      [],
      [],
    );
    expect(r.fromDecisionEngine).toBe(true);
    expect(r.actions.map((a) => a.id)).toEqual(["a", "b"]);
    expect(r.actions[0].decisionScore).toBe(90);
    // Engine states confidence 0-100; the contract is 0-1.
    expect(r.actions[0].confidence).toBe(0.8);
    // The IC memo and the simulated before → after are carried through, not flattened.
    expect(r.actions[0].why?.whyNow).toBe("n");
    expect(r.actions[0].alternativesEvaluated).toBe(7);
    expect(r.actions[0].impact?.healthDelta).toBe(3.2);
  });

  it("derives severity from the decision score", () => {
    const r = buildRecommendedActions(report({ decisions: [decision("a", 85, 1), decision("b", 40, 2)] }), [], []);
    expect(r.actions[0].severity).toBe("high");
    expect(r.actions[1].severity).toBe("low");
  });

  it("caps the homepage at five actions", () => {
    const decisions = Array.from({ length: 9 }, (_, i) => decision(`d${i}`, 90 - i, i + 1));
    expect(buildRecommendedActions(report({ decisions }), [], []).actions).toHaveLength(5);
  });

  it("falls back to the alert queue with NO fabricated score when there is no portfolio", () => {
    const alert: WatchlistAlert = {
      type: "new_opportunity",
      severity: "high",
      title: "NVDA looks attractive",
      description: "Score improved to 78.",
      action: "Review",
      symbol: "NVDA",
    };

    const r = buildRecommendedActions(null, [alert], []);
    expect(r.fromDecisionEngine).toBe(false);
    expect(r.actions).toHaveLength(1);
    // The queue never scored this. It must say so rather than invent a number.
    expect(r.actions[0].decisionScore).toBeNull();
    expect(r.actions[0].confidence).toBeNull();
    expect(r.actions[0].severity).toBe("high");
  });

  it("is empty, not errored, when there is nothing to do", () => {
    const r = buildRecommendedActions(null, [], []);
    expect(r.status).toBe("empty");
    expect(r.actions).toEqual([]);
  });

  // Observed live: an 18-holding portfolio for which the engine produced zero
  // decisions (nothing was worth trading). Reporting that as "no portfolio"
  // told the user to "add holdings" while they held eighteen of them.
  it("distinguishes 'no portfolio' from 'a portfolio with no trade worth making'", () => {
    const noPortfolio = buildRecommendedActions(null, [], []);
    expect(noPortfolio.hasPortfolio).toBe(false);
    expect(noPortfolio.fromDecisionEngine).toBe(false);

    const nothingToDo = buildRecommendedActions(report({ decisions: [] }), [], []);
    expect(nothingToDo.hasPortfolio).toBe(true);
    expect(nothingToDo.fromDecisionEngine).toBe(false);
  });

  it("ignores read notifications", () => {
    const notifications = [
      { id: 1, title: "Read one", body: "x", severity: "warning", read: true, symbol: null },
      { id: 2, title: "Unread one", body: "y", severity: "warning", read: false, symbol: null },
    ] as unknown as Notification[];

    const r = buildRecommendedActions(null, [], notifications);
    expect(r.actions.map((a) => a.title)).toEqual(["Unread one"]);
  });
});

/* ------------------------------------------------------------------ */
/* Watchlist                                                           */
/* ------------------------------------------------------------------ */

const item = (symbol: string) => ({ symbol, name: symbol }) as WatchlistItem;
const wlAlert = (symbol: string, type: WatchlistAlert["type"], severity: WatchlistAlert["severity"] = "medium"): WatchlistAlert => ({
  type,
  severity,
  title: `${symbol} ${type}`,
  description: "…",
  action: "Review",
  symbol,
});

describe("buildWatchlistIntelligence", () => {
  it("is empty when nothing is tracked", () => {
    expect(buildWatchlistIntelligence([], [], []).status).toBe("empty");
  });

  it("buckets on the alert the engine already raised", () => {
    const w = buildWatchlistIntelligence(
      [item("NVDA"), item("INTC"), item("AMD")],
      [wlAlert("NVDA", "new_opportunity"), wlAlert("INTC", "deteriorating"), wlAlert("AMD", "breakout")],
      [],
    );
    const byId = Object.fromEntries(w.buckets.map((b) => [b.id, b.symbols]));
    expect(byId["buy"]).toEqual(["NVDA"]);
    expect(byId["high-risk"]).toEqual(["INTC"]);
    expect(byId["near-buy"]).toEqual(["AMD"]);
  });

  it("leaves a quiet name in no bucket rather than inventing one for it", () => {
    const w = buildWatchlistIntelligence([item("KO")], [], []);
    expect(w.status).toBe("ok");
    expect(w.total).toBe(1);
    expect(w.buckets).toEqual([]);
  });

  it("ignores alerts for symbols that aren't on the watchlist", () => {
    const w = buildWatchlistIntelligence([item("KO")], [wlAlert("NVDA", "new_opportunity")], []);
    expect(w.buckets).toEqual([]);
    expect(w.alerts).toEqual([]);
  });

  it("picks up only earnings for watched symbols", () => {
    const events = [
      { id: "1", symbol: "NVDA", name: "NVDA earnings", type: "earnings", date: "2026-08-01" },
      { id: "2", symbol: "TSLA", name: "TSLA earnings", type: "earnings", date: "2026-08-02" },
      { id: "3", symbol: "NVDA", name: "NVDA dividend", type: "dividend", date: "2026-08-03" },
    ];
    const w = buildWatchlistIntelligence([item("NVDA")], [], events);
    expect(w.upcomingEarnings).toEqual([{ symbol: "NVDA", date: "2026-08-01" }]);
  });

  it("dedupes a symbol that raised two alerts of the same kind", () => {
    const w = buildWatchlistIntelligence(
      [item("NVDA")],
      [wlAlert("NVDA", "new_opportunity"), wlAlert("NVDA", "valuation")],
      [],
    );
    expect(w.buckets.find((b) => b.id === "buy")?.symbols).toEqual(["NVDA"]);
  });
});
