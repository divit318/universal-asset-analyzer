/**
 * The Attention Queue engine (§4.2). Everything the queue's trust depends on is
 * pinned here: the scoring formula and its exponents, the geometric zero-sink,
 * the time-decay urgency, dedupe with href merging, the score/kind/symbol sort,
 * per-kind dismissal TTLs, and — the load-bearing one — band-resurfacing, where
 * a materially worse version of a dismissed story returns because its severity
 * band changed its dedupe key.
 */

import { describe, it, expect } from "vitest";
import {
  buildAttentionQueue,
  scoreSeed,
  computeUrgency,
  dismissalExpiresAt,
  seedsFromActions,
  seedsFromThreats,
  seedsFromAlerts,
  seedsFromEvents,
  seedsFromSignals,
  SCORE_EXPONENTS,
  KIND_TTL_MS,
  KIND_PRECEDENCE,
  UNDATED_URGENCY,
  MARKET_CLOSED_URGENCY_CEIL,
  PAST_EVENT_URGENCY,
  priorityBucket,
  type AttentionFeeder,
  type WeightBySymbol,
} from "@/lib/home/attention";
import type {
  AttentionDismissal,
  AttentionSeed,
  OpportunitySnapshotItem,
  RecommendedAction,
  ThreatItem,
  UpcomingEventLite,
} from "@/lib/home/contracts";
import type { WatchlistAlert } from "@/lib/types";

const NOW = Date.parse("2026-07-18T15:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function seed(partial: Partial<AttentionSeed>): AttentionSeed {
  return {
    id: partial.id ?? "id",
    dedupeKey: partial.dedupeKey ?? "k",
    kind: partial.kind ?? "signal",
    symbol: partial.symbol ?? null,
    headline: partial.headline ?? "headline",
    rationale: partial.rationale ?? "rationale",
    impact: partial.impact ?? 0.5,
    urgency: partial.urgency ?? 0.5,
    confidence: partial.confidence ?? 0.5,
    occursAt: partial.occursAt ?? null,
    observedAt: partial.observedAt ?? null,
    primaryAction: partial.primaryAction ?? { label: "Open", href: "/x" },
    source: partial.source ?? "signals",
    storyKey: partial.storyKey ?? null,
  };
}

const feeder = (id: string, seeds: AttentionSeed[]): AttentionFeeder => ({ id, run: () => seeds });

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

describe("scoreSeed", () => {
  it("uses the 0.5 / 0.3 / 0.2 geometric formula", () => {
    // A pinned constant so the exponents can't drift silently.
    expect(SCORE_EXPONENTS).toEqual({ impact: 0.5, urgency: 0.3, confidence: 0.2 });
    const s = scoreSeed({ impact: 1, urgency: 1, confidence: 1 });
    expect(s).toBe(100);
  });

  it("matches the closed-form value for a mixed item", () => {
    const expected = 100 * 0.8 ** 0.5 * 0.5 ** 0.3 * 0.6 ** 0.2;
    expect(scoreSeed({ impact: 0.8, urgency: 0.5, confidence: 0.6 })).toBeCloseTo(Math.round(expected * 10) / 10, 5);
  });

  it("sinks any item with a zero in any dimension (geometric mean)", () => {
    expect(scoreSeed({ impact: 0, urgency: 1, confidence: 1 })).toBe(0);
    expect(scoreSeed({ impact: 1, urgency: 0, confidence: 1 })).toBe(0);
    expect(scoreSeed({ impact: 1, urgency: 1, confidence: 0 })).toBe(0);
  });

  it("weights impact more than urgency more than confidence", () => {
    const boostImpact = scoreSeed({ impact: 0.9, urgency: 0.5, confidence: 0.5 });
    const boostUrgency = scoreSeed({ impact: 0.5, urgency: 0.9, confidence: 0.5 });
    const boostConfidence = scoreSeed({ impact: 0.5, urgency: 0.5, confidence: 0.9 });
    expect(boostImpact).toBeGreaterThan(boostUrgency);
    expect(boostUrgency).toBeGreaterThan(boostConfidence);
  });
});

describe("priorityBucket", () => {
  it("maps the score bands the UI renders in place of raw numbers", () => {
    expect(priorityBucket(85).id).toBe("act-now");
    expect(priorityBucket(70).id).toBe("act-now");
    expect(priorityBucket(60).id).toBe("today");
    expect(priorityBucket(45).id).toBe("this-week");
    expect(priorityBucket(20).id).toBe("fyi");
  });
});

describe("computeUrgency", () => {
  it("returns the flat default for undated items", () => {
    expect(computeUrgency(null, NOW, true)).toBe(UNDATED_URGENCY);
  });

  it("is 1 at ≤24h and 0 at ≥7d, linear between", () => {
    expect(computeUrgency(new Date(NOW + 12 * HOUR).toISOString(), NOW, true)).toBe(1);
    expect(computeUrgency(new Date(NOW + 24 * HOUR).toISOString(), NOW, true)).toBe(1);
    expect(computeUrgency(new Date(NOW + 7 * DAY).toISOString(), NOW, true)).toBe(0);
    // Midpoint of the 24h→7d ramp.
    const mid = computeUrgency(new Date(NOW + (24 * HOUR + 7 * DAY) / 2).toISOString(), NOW, true);
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
  });

  it("demotes an already-passed catalyst to review urgency, never imminent (audit DU-06)", () => {
    expect(computeUrgency(new Date(NOW - HOUR).toISOString(), NOW, true)).toBe(PAST_EVENT_URGENCY);
    // Still imminent right up to the catalyst itself.
    expect(computeUrgency(new Date(NOW + 1).toISOString(), NOW, true)).toBe(1);
  });

  it("caps the ramp for still-distant events while the market is closed", () => {
    // At 30h out the open ramp is ~0.96 — above the ceiling, so the clamp bites.
    const at = new Date(NOW + 30 * HOUR).toISOString();
    const open = computeUrgency(at, NOW, true);
    const closed = computeUrgency(at, NOW, false);
    expect(open).toBeGreaterThan(MARKET_CLOSED_URGENCY_CEIL);
    expect(closed).toBe(MARKET_CLOSED_URGENCY_CEIL);
  });
});

/* ------------------------------------------------------------------ */
/* Assembly: dedupe, sort, degraded isolation                          */
/* ------------------------------------------------------------------ */

describe("buildAttentionQueue", () => {
  it("scores, and sorts by score descending", () => {
    const q = buildAttentionQueue({
      feeders: [
        feeder("a", [seed({ dedupeKey: "low", impact: 0.2, urgency: 0.2, confidence: 0.2 })]),
        feeder("b", [seed({ dedupeKey: "high", impact: 0.9, urgency: 0.9, confidence: 0.9 })]),
      ],
      dismissals: [],
      now: NOW,
    });
    expect(q.items.map((i) => i.dedupeKey)).toEqual(["high", "low"]);
    expect(q.items[0].score).toBeGreaterThan(q.items[1].score);
    expect(q.openCount).toBe(2);
    expect(q.status).toBe("ok");
  });

  it("breaks score ties by kind precedence then symbol", () => {
    const common = { impact: 0.5, urgency: 0.5, confidence: 0.5 };
    const q = buildAttentionQueue({
      feeders: [
        feeder("s", [seed({ dedupeKey: "sig", kind: "signal", symbol: "AAA", ...common })]),
        feeder("t", [seed({ dedupeKey: "thr", kind: "threat", symbol: "ZZZ", ...common })]),
        feeder("a", [seed({ dedupeKey: "act", kind: "action", symbol: "MMM", ...common })]),
      ],
      dismissals: [],
      now: NOW,
    });
    // Equal scores → threat before action before signal.
    expect(q.items.map((i) => i.kind)).toEqual(["threat", "action", "signal"]);
    expect(KIND_PRECEDENCE.threat).toBeLessThan(KIND_PRECEDENCE.action);
    expect(KIND_PRECEDENCE.action).toBeLessThan(KIND_PRECEDENCE.signal);
  });

  it("dedupes by story key — score breaks ties between unstamped siblings, hrefs merge", () => {
    const q = buildAttentionQueue({
      feeders: [
        feeder("a", [seed({ id: "1", dedupeKey: "same", impact: 0.4, urgency: 0.5, confidence: 0.5, primaryAction: { label: "A", href: "/a" } })]),
        feeder("b", [seed({ id: "2", dedupeKey: "same", impact: 0.9, urgency: 0.5, confidence: 0.5, primaryAction: { label: "B", href: "/b" } })]),
      ],
      dismissals: [],
      now: NOW,
    });
    expect(q.items).toHaveLength(1);
    expect(q.items[0].primaryAction.href).toBe("/b"); // higher score wins the tie
    expect(q.items[0].mergedHrefs).toEqual([{ label: "A", href: "/a" }]);
  });

  it("dedupe keeps the NEWEST observation, not the most extreme print (F-22d)", () => {
    // The pre-purge homepage: a five-day-old "-8.7%" outscored the fresher
    // "-7.4%" of the same story and squatted at the top of the queue. Recency
    // must beat score for observation-backed siblings.
    const q = buildAttentionQueue({
      feeders: [
        feeder("a", [
          seed({ id: "old", dedupeKey: "same", impact: 0.9, urgency: 0.5, confidence: 0.5, observedAt: "2026-07-13T13:31:00Z", primaryAction: { label: "Old", href: "/old" } }),
          seed({ id: "new", dedupeKey: "same", impact: 0.6, urgency: 0.5, confidence: 0.5, observedAt: "2026-07-17T13:33:00Z", primaryAction: { label: "New", href: "/new" } }),
        ]),
      ],
      dismissals: [],
      now: NOW,
    });
    expect(q.items).toHaveLength(1);
    expect(q.items[0].id).toBe("new");
    expect(q.items[0].mergedHrefs).toEqual([{ label: "Old", href: "/old" }]);
  });

  it("live engine output (no observedAt) outranks any stamped observation in dedupe", () => {
    const q = buildAttentionQueue({
      feeders: [
        feeder("a", [
          seed({ id: "stamped", dedupeKey: "same", impact: 0.9, observedAt: "2026-07-18T14:00:00Z" }),
          seed({ id: "live", dedupeKey: "same", impact: 0.4 }),
        ]),
      ],
      dismissals: [],
      now: NOW,
    });
    expect(q.items[0].id).toBe("live");
  });

  it("isolates a throwing feeder — surviving items paint, feeder listed as degraded", () => {
    const q = buildAttentionQueue({
      feeders: [
        { id: "threats", run: () => { throw new Error("boom"); } },
        feeder("signals", [seed({ dedupeKey: "ok" })]),
      ],
      dismissals: [],
      now: NOW,
    });
    expect(q.items).toHaveLength(1);
    expect(q.degradedFeeders).toEqual(["threats"]);
    expect(q.status).toBe("degraded");
  });

  it("reaches an empty (clear) state when there is nothing to show", () => {
    const q = buildAttentionQueue({ feeders: [feeder("a", [])], dismissals: [], now: NOW });
    expect(q.items).toHaveLength(0);
    expect(q.openCount).toBe(0);
    expect(q.status).toBe("empty");
  });
});

/* ------------------------------------------------------------------ */
/* Dismissals: TTL and band-resurfacing                                */
/* ------------------------------------------------------------------ */

describe("dismissals", () => {
  const item = seed({ dedupeKey: "threat:threat-conc-holding:25-30", kind: "threat" });

  it("suppresses a story while its dismissal is active", () => {
    const dismissals: AttentionDismissal[] = [
      { dedupeKey: item.dedupeKey, dismissedAt: NOW, expiresAt: NOW + KIND_TTL_MS.threat },
    ];
    const q = buildAttentionQueue({ feeders: [feeder("t", [item])], dismissals, now: NOW });
    expect(q.items).toHaveLength(0);
  });

  it("lets a story back once its dismissal has expired", () => {
    const dismissals: AttentionDismissal[] = [
      { dedupeKey: item.dedupeKey, dismissedAt: NOW - 8 * DAY, expiresAt: NOW - DAY },
    ];
    const q = buildAttentionQueue({ feeders: [feeder("t", [item])], dismissals, now: NOW });
    expect(q.items).toHaveLength(1);
  });

  it("resurfaces a materially-worsened story despite a prior dismissal (band change)", () => {
    // Dismissed at the 25-30% band; the concentration worsens to the 30-35% band,
    // which is a different dedupe key, so the dismissal no longer matches.
    const dismissals: AttentionDismissal[] = [
      { dedupeKey: "threat:threat-conc-holding:25-30", dismissedAt: NOW, expiresAt: NOW + KIND_TTL_MS.threat },
    ];
    const worsened = seed({ dedupeKey: "threat:threat-conc-holding:30-35", kind: "threat" });
    const q = buildAttentionQueue({ feeders: [feeder("t", [worsened])], dismissals, now: NOW });
    expect(q.items).toHaveLength(1);
    expect(q.items[0].dedupeKey).toBe("threat:threat-conc-holding:30-35");
  });

  it("assigns per-kind TTLs, and expires events at their catalyst", () => {
    expect(dismissalExpiresAt("threat", null, NOW)).toBe(NOW + KIND_TTL_MS.threat);
    expect(dismissalExpiresAt("signal", null, NOW)).toBe(NOW + KIND_TTL_MS.signal);
    expect(KIND_TTL_MS.signal).toBeGreaterThan(KIND_TTL_MS.threat);
    // An event dismissal lapses exactly when the catalyst passes.
    const catalyst = new Date(NOW + 3 * DAY).toISOString();
    expect(dismissalExpiresAt("event", catalyst, NOW)).toBe(Date.parse(catalyst));
  });
});

/* ------------------------------------------------------------------ */
/* Feeders: normalization from digest slices                           */
/* ------------------------------------------------------------------ */

describe("feeders", () => {
  const weights: WeightBySymbol = new Map([["NVDA", 0.31]]);

  it("actions: impact from decisionScore, band in the dedupe key", () => {
    const actions: RecommendedAction[] = [
      {
        id: "d1", symbol: "MSFT", subject: "MSFT", action: "REDUCE", title: "Trim MSFT", reason: "conviction fell",
        decisionScore: 76, priority: 1, confidence: 0.7, expectedImpact: null, expectedImprovement: null,
        severity: "high", href: "/research?symbol=MSFT", source: "decision",
        why: null, impact: null, alternativesEvaluated: null,
      },
    ];
    const [s] = seedsFromActions(actions);
    expect(s.kind).toBe("action");
    expect(s.impact).toBeCloseTo(0.76);
    expect(s.confidence).toBe(0.7);
    expect(s.dedupeKey).toBe("action:MSFT:70");
    expect(s.primaryAction.href).toBe("/portfolio?tab=decisions");
  });

  it("actions: a 10-pt conviction move changes the band, so a prior dismissal lapses", () => {
    const base: RecommendedAction = {
      id: "d1", symbol: "MSFT", subject: "MSFT", action: "REDUCE", title: "Trim", reason: "x", decisionScore: 76,
      priority: 1, confidence: 0.7, expectedImpact: null, expectedImprovement: null, severity: "high",
      href: "/x", source: "decision", why: null, impact: null, alternativesEvaluated: null,
    };
    const before = seedsFromActions([base])[0].dedupeKey;
    const after = seedsFromActions([{ ...base, decisionScore: 64 }])[0].dedupeKey;
    expect(before).not.toBe(after);
  });

  it("actions: confidence decays with observation age and zeroes when stale (F-22d)", () => {
    const base: RecommendedAction = {
      id: "n1", symbol: "AAPL", subject: null, action: "REVIEW", title: "AAPL down 8.7%", reason: "x", decisionScore: null,
      priority: 1, confidence: null, expectedImpact: null, expectedImprovement: null, severity: "high",
      href: "/x", source: "queue", why: null, impact: null, alternativesEvaluated: null,
    };
    const fresh = seedsFromActions([{ ...base, observedAt: new Date(NOW - 2 * HOUR).toISOString() }], NOW)[0];
    const aging = seedsFromActions([{ ...base, observedAt: new Date(NOW - 2 * DAY).toISOString() }], NOW)[0];
    const stale = seedsFromActions([{ ...base, observedAt: new Date(NOW - 5 * DAY).toISOString() }], NOW)[0];
    expect(fresh.confidence).toBeCloseTo(0.6);
    expect(aging.confidence).toBeCloseTo(0.3);
    expect(stale.confidence).toBe(0);
    // Geometric score: zero confidence sinks the stale item entirely.
    expect(scoreSeed(stale)).toBe(0);
    // The stamp rides along for dedupe recency.
    expect(fresh.observedAt).toBe(new Date(NOW - 2 * HOUR).toISOString());
  });

  it("threats: impact scales with measured % at risk, and bands by magnitude", () => {
    const threats: ThreatItem[] = [
      {
        id: "threat-conc-holding-0", title: "NVDA concentration", category: "concentration", severity: "high",
        probability: null, impactPct: -31, detail: "31% of book", mitigation: "trim", href: "/portfolio?tab=risk",
      },
    ];
    const [s] = seedsFromThreats(threats);
    expect(s.kind).toBe("threat");
    expect(s.impact).toBeCloseTo(31 / 25 > 1 ? 1 : 31 / 25); // capped at 1
    expect(s.dedupeKey).toBe("threat:threat-conc-holding:30-35");
    expect(s.confidence).toBe(0.8);
  });

  it("alerts: a held name's weight scales to full impact at a 25% position (audit DU-05)", () => {
    const alerts: WatchlistAlert[] = [
      { type: "deteriorating", severity: "high", title: "NVDA deteriorating", description: "x", action: "review", symbol: "NVDA" },
      { type: "deteriorating", severity: "high", title: "UNHELD deteriorating", description: "x", action: "review", symbol: "UNHELD" },
    ];
    const [held, unheld] = seedsFromAlerts(alerts, weights);
    // 31% of the book is beyond the 25% full-impact anchor: saturates at 1.
    expect(held.impact).toBe(1);
    expect(held.dedupeKey).toBe("alert:NVDA:deteriorating:high");
    // A tracked-but-unheld name gets the small floor and must rank below any
    // meaningfully held one.
    expect(unheld.impact).toBeCloseTo(0.1);
    expect(unheld.impact).toBeLessThan(held.impact);
  });

  it("alerts: a small held position still outranks the unheld floor", () => {
    const smallWeights = new Map([["NVDA", 0.033]]);
    const alerts: WatchlistAlert[] = [
      { type: "deteriorating", severity: "high", title: "NVDA deteriorating", description: "x", action: "review", symbol: "NVDA" },
    ];
    const [s] = seedsFromAlerts(alerts, smallWeights);
    expect(s.impact).toBeCloseTo(0.033 / 0.25); // 0.132 > the 0.1 unheld floor
  });

  it("events: dated, time-decayed, held-name impact, and filtered to a 7d horizon", () => {
    const events: UpcomingEventLite[] = [
      { id: "e1", symbol: "NVDA", name: "Earnings", type: "earnings", date: new Date(NOW + 2 * DAY).toISOString() },
      { id: "e2", symbol: "FAR", name: "Earnings", type: "earnings", date: new Date(NOW + 30 * DAY).toISOString() },
    ];
    const seeds = seedsFromEvents(events, weights, NOW, true);
    expect(seeds).toHaveLength(1); // the 30-day-out event is beyond the horizon
    expect(seeds[0].kind).toBe("event");
    expect(seeds[0].confidence).toBe(1);
    expect(seeds[0].impact).toBe(1); // 31% held weight saturates the 25% anchor
    expect(seeds[0].dedupeKey).toBe(`NVDA:earnings:${new Date(NOW + 2 * DAY).toISOString().slice(0, 10)}`);
  });

  it("collapses a cross-kind story: the action survives, absorbs the threat's link and score (DU-03)", () => {
    const threat = seed({
      id: "t", dedupeKey: "threat:conc-holding:30-35", kind: "threat", storyKey: "concentration:usd-cash",
      impact: 0.8, urgency: 0.6, confidence: 0.8, primaryAction: { label: "Review threat", href: "/portfolio?tab=risk" },
    });
    const action = seed({
      id: "a", dedupeKey: "action:portfolio:60", kind: "action", storyKey: "concentration:usd-cash",
      impact: 0.62, urgency: 0.6, confidence: 0.6, primaryAction: { label: "Open decision", href: "/portfolio?tab=decisions" },
    });
    const q = buildAttentionQueue({ feeders: [feeder("threats", [threat]), feeder("actions", [action])], dismissals: [], now: NOW });

    expect(q.items).toHaveLength(1);
    expect(q.items[0].kind).toBe("action");
    expect(q.items[0].mergedHrefs?.some((h) => h.href === "/portfolio?tab=risk")).toBe(true);
    // The surviving action inherits the story's strongest score, so the
    // collapse never demotes the story below where the louder twin ranked.
    expect(q.items[0].score).toBe(scoreSeed(threat));
  });

  it("a story dismissal suppresses BOTH twins", () => {
    const twins = [
      seed({ id: "t", dedupeKey: "threat:x", kind: "threat", storyKey: "concentration:usd-cash" }),
      seed({ id: "a", dedupeKey: "action:x", kind: "action", storyKey: "concentration:usd-cash" }),
    ];
    const q = buildAttentionQueue({
      feeders: [feeder("f", twins)],
      dismissals: [{ dedupeKey: "concentration:usd-cash", dismissedAt: NOW - HOUR, expiresAt: NOW + DAY }],
      now: NOW,
    });
    expect(q.items).toHaveLength(0);
  });

  it("signals: impact from fit score, confidence default 0.5", () => {
    const opps: OpportunitySnapshotItem[] = [
      { symbol: "ASML", combinedScore: 82, fitTier: "excellent", fitSummary: "quality tilt" },
    ];
    const [s] = seedsFromSignals(opps);
    expect(s.kind).toBe("signal");
    expect(s.impact).toBeCloseTo(0.82);
    expect(s.confidence).toBe(0.5);
    expect(s.dedupeKey).toBe("signal:ASML:80");
  });
});
