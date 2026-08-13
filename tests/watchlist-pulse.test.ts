/**
 * The watchlist attention model — every threshold pinned, every level boundary
 * exercised. These constants ARE the product ("needs attention" is a claim),
 * so a change to any of them should fail here and be made deliberately.
 */
import { describe, expect, it } from "vitest";
import {
  computeAttention,
  computeThesisSignal,
  computeWatchlistHealth,
  daysUntil,
  isStaleReview,
  summarizeSinceVisit,
  BIG_MOVE_PCT,
  SINCE_VISIT_MOVE_PCT,
  TARGET_NEAR_PCT,
  STALE_REVIEW_DAYS,
  type AttentionInput,
  type PulseDevelopment,
  type SymbolPulse,
} from "@/lib/watchlist-pulse";

const NOW = Date.parse("2026-08-10T12:00:00Z");

function pulse(o: Partial<SymbolPulse> = {}): SymbolPulse {
  return {
    baselinePrice: null,
    developments: [],
    notifications: [],
    earningsDate: null,
    thesisSignal: null,
    developmentsCheckedAt: null,
    ...o,
  };
}

function input(o: Partial<AttentionInput> = {}): AttentionInput {
  return {
    price: 100,
    changePercent: 0,
    targetPrice: null,
    direction: "above",
    pulse: pulse(),
    now: NOW,
    ...o,
  };
}

function dev(o: Partial<PulseDevelopment> = {}): PulseDevelopment {
  return {
    id: "e1",
    title: "Something happened",
    timestamp: new Date(NOW - 3_600_000).toISOString(),
    impact: "neutral",
    importance: 70,
    category: "earnings",
    url: null,
    sourceKind: "news",
    sinceBaseline: true,
    ...o,
  };
}

describe("computeAttention — targets", () => {
  it("is quiet with no signals at all", () => {
    const r = computeAttention(input());
    expect(r.level).toBe("quiet");
    expect(r.signals).toHaveLength(0);
  });

  it("fires target_crossed at act level when a buy limit is hit", () => {
    const r = computeAttention(input({ price: 95, targetPrice: 96, direction: "below" }));
    expect(r.level).toBe("act");
    const s = r.signals.find((x) => x.kind === "target_crossed")!;
    expect(s.tone).toBe("positive"); // the moment the user was waiting for
  });

  it("treats a crossed exit target as a decision point, not good news", () => {
    const r = computeAttention(input({ price: 105, targetPrice: 100, direction: "above" }));
    expect(r.signals.find((x) => x.kind === "target_crossed")!.tone).toBe("warning");
  });

  it("reports approaching inside the near band, and not outside it", () => {
    const near = computeAttention(input({ price: 100, targetPrice: 100 * (1 + (TARGET_NEAR_PCT - 0.5) / 100) }));
    expect(near.signals.some((s) => s.kind === "target_approaching")).toBe(true);
    const far = computeAttention(input({ price: 100, targetPrice: 110 }));
    expect(far.signals.some((s) => s.kind === "target_approaching")).toBe(false);
  });

  it("never reports both crossed and approaching for one target", () => {
    const r = computeAttention(input({ price: 101, targetPrice: 100, direction: "above" }));
    expect(r.signals.filter((s) => s.kind.startsWith("target_"))).toHaveLength(1);
  });
});

describe("computeAttention — price as information", () => {
  it(`ignores a move under ${BIG_MOVE_PCT}% and reports one over it`, () => {
    expect(computeAttention(input({ changePercent: BIG_MOVE_PCT - 0.1 })).signals).toHaveLength(0);
    const r = computeAttention(input({ changePercent: -(BIG_MOVE_PCT + 0.1) }));
    expect(r.signals[0].kind).toBe("big_move");
    expect(r.signals[0].tone).toBe("negative");
  });

  it("reports a since-visit drift once it exceeds the threshold", () => {
    const r = computeAttention(
      input({ price: 100 * (1 - (SINCE_VISIT_MOVE_PCT + 1) / 100), pulse: pulse({ baselinePrice: 100 }) }),
    );
    expect(r.signals.some((s) => s.kind === "moved_since_visit")).toBe(true);
  });

  it("suppresses since-visit drift when it is just today's move re-reported", () => {
    // Down 9% today, baseline was yesterday's close: one event, not two.
    const r = computeAttention(
      input({ price: 91, changePercent: -9, pulse: pulse({ baselinePrice: 100 }) }),
    );
    expect(r.signals.filter((s) => s.kind === "big_move" || s.kind === "moved_since_visit")).toHaveLength(1);
  });
});

describe("computeAttention — events", () => {
  it("promotes a fired alert to act level and carries its title as evidence", () => {
    const r = computeAttention(
      input({
        pulse: pulse({
          notifications: [{ id: 1, title: "NVDA fell to your $100 target", kind: "price_target", severity: "info", createdAt: new Date(NOW).toISOString() }],
        }),
      }),
    );
    expect(r.level).toBe("act");
    expect(r.signals[0].detail).toContain("NVDA");
  });

  it("counts only material since-baseline developments", () => {
    const r = computeAttention(
      input({
        pulse: pulse({
          developments: [
            dev({ id: "a", importance: 80 }),
            dev({ id: "b", importance: 40 }), // below the bar
            dev({ id: "c", importance: 80, sinceBaseline: false }), // old news
          ],
        }),
      }),
    );
    const s = r.signals.find((x) => x.kind === "development")!;
    expect(s.label).toBe("New development");
  });

  it("honours threshold overrides from the view settings", () => {
    // A 4% move is noise at the default 5% bar but information at a 3% bar.
    const move = input({ changePercent: 4 });
    expect(computeAttention(move).signals).toHaveLength(0);
    expect(computeAttention({ ...move, thresholds: { bigMovePct: 3 } }).signals[0].kind).toBe("big_move");

    // Earnings in 10 days registers only under a widened horizon.
    const at = new Date(NOW + 10 * 86_400_000).toISOString().slice(0, 10);
    const earnings = input({ pulse: pulse({ earningsDate: at }) });
    expect(computeAttention(earnings).signals).toHaveLength(0);
    expect(computeAttention({ ...earnings, thresholds: { earningsSoonDays: 14 } }).signals[0].kind).toBe(
      "earnings_soon",
    );
  });

  it("weights earnings by proximity", () => {
    const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString().slice(0, 10);
    const soon = computeAttention(input({ pulse: pulse({ earningsDate: at(1) }) }));
    const later = computeAttention(input({ pulse: pulse({ earningsDate: at(6) }) }));
    const far = computeAttention(input({ pulse: pulse({ earningsDate: at(30) }) }));
    expect(soon.signals[0].weight).toBeGreaterThan(later.signals[0].weight);
    expect(far.signals).toHaveLength(0);
  });

  it("surfaces a one-sided thesis signal and ignores mixed/quiet ones", () => {
    const strengthening = computeAttention(
      input({ pulse: pulse({ thesisSignal: { status: "strengthening", bullish: ["Beat"], bearish: [], eventCount: 3, windowDays: 30 } }) }),
    );
    expect(strengthening.signals[0].kind).toBe("thesis_signal");
    const mixed = computeAttention(
      input({ pulse: pulse({ thesisSignal: { status: "mixed", bullish: ["A"], bearish: ["B"], eventCount: 2, windowDays: 30 } }) }),
    );
    expect(mixed.signals).toHaveLength(0);
  });
});

describe("computeAttention — levels and ranking", () => {
  it("one strong signal outranks accumulated weak ones", () => {
    const crossed = computeAttention(input({ price: 101, targetPrice: 100, direction: "above" }));
    expect(crossed.level).toBe("act");
    const weak = computeAttention(input({ changePercent: BIG_MOVE_PCT + 0.1 }));
    expect(weak.level).toBe("watch");
  });

  it("sorts signals strongest first", () => {
    const r = computeAttention(
      input({ price: 101, targetPrice: 100, direction: "above", changePercent: 6 }),
    );
    expect(r.signals[0].kind).toBe("target_crossed");
    expect(r.signals.map((s) => s.weight)).toEqual([...r.signals.map((s) => s.weight)].sort((a, b) => b - a));
  });

  it("returns quiet when the pulse has not loaded and nothing is live", () => {
    expect(computeAttention(input({ pulse: null })).level).toBe("quiet");
  });
});

describe("computeThesisSignal", () => {
  const ev = (impact: "bullish" | "bearish" | "neutral", importance = 70, hoursAgo = 24) => ({
    title: `${impact} event`,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    impact,
    importance,
  });

  it("is quiet with no material events", () => {
    expect(computeThesisSignal([ev("neutral"), ev("bullish", 30)], NOW - 30 * 86_400_000, NOW).status).toBe("quiet");
  });

  it("needs at least two events to leave mixed", () => {
    expect(computeThesisSignal([ev("bullish")], NOW - 30 * 86_400_000, NOW).status).toBe("mixed");
  });

  it("calls a 2:1 weighted lean, and mixed otherwise", () => {
    const since = NOW - 30 * 86_400_000;
    expect(computeThesisSignal([ev("bullish"), ev("bullish")], since, NOW).status).toBe("strengthening");
    expect(computeThesisSignal([ev("bearish"), ev("bearish"), ev("bullish", 90)], since, NOW).status).toBe("mixed");
    expect(computeThesisSignal([ev("bearish", 90), ev("bearish", 90), ev("bullish", 50)], since, NOW).status).toBe("weakening");
  });

  it("ignores events before the review, and caps the window", () => {
    const since = NOW - 5 * 86_400_000;
    const r = computeThesisSignal([ev("bearish", 90, 24 * 10), ev("bullish"), ev("bullish")], since, NOW);
    expect(r.status).toBe("strengthening"); // the old bearish event predates the review
    expect(r.windowDays).toBe(5);
  });
});

describe("summarizeSinceVisit", () => {
  it("tallies levels and signal kinds", () => {
    const act = computeAttention(input({ price: 95, targetPrice: 96, direction: "below" }));
    const quiet = computeAttention(input());
    const s = summarizeSinceVisit([act, quiet, quiet]);
    expect(s).toMatchObject({ act: 1, quiet: 2, targetsCrossed: 1, alertsFired: 0 });
  });
});

describe("watchlist health", () => {
  const item = (o: Partial<Parameters<typeof isStaleReview>[0]> = {}) => ({
    notes: "a thesis",
    targetPrice: 100,
    lastReviewedAt: NOW - 86_400_000,
    addedAt: new Date(NOW - 10 * 86_400_000).toISOString(),
    ...o,
  });

  it("counts missing theses, missing targets, and stale reviews", () => {
    const stale = NOW - (STALE_REVIEW_DAYS + 1) * 86_400_000;
    const h = computeWatchlistHealth(
      [item(), item({ notes: null }), item({ targetPrice: null }), item({ lastReviewedAt: stale })],
      NOW,
    );
    expect(h).toEqual({ total: 4, noThesis: 1, noTarget: 1, staleReview: 1 });
  });

  it("an empty row is noThesis, never staleReview", () => {
    const old = new Date(NOW - 400 * 86_400_000).toISOString();
    expect(isStaleReview({ notes: null, targetPrice: null, lastReviewedAt: null, addedAt: old }, NOW)).toBe(false);
  });

  it("a never-reviewed thesis goes stale from its added date", () => {
    const old = new Date(NOW - (STALE_REVIEW_DAYS + 1) * 86_400_000).toISOString();
    expect(isStaleReview({ notes: "t", targetPrice: null, lastReviewedAt: null, addedAt: old }, NOW)).toBe(true);
  });
});

describe("daysUntil", () => {
  it("counts calendar days, not 24h windows", () => {
    expect(daysUntil("2026-08-10", NOW)).toBe(0);
    expect(daysUntil("2026-08-11", NOW)).toBe(1);
    expect(daysUntil("2026-08-09", NOW)).toBe(-1);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("not a date", NOW)).toBeNull();
  });
});
