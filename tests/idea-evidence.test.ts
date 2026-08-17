/**
 * The evidence-derived workflow (lib/ideas/evidence.ts) — the model that
 * replaced the manually-curated pipeline stages.
 *
 * The one property everything here defends: THE APP NEVER CLAIMS WORK DOESN'T
 * EXIST WHEN IT DOES. The 2026-08 audit found every "Surfaced" idea in the
 * real database had recorded Research Hub visits while the board called them
 * unworked; the first test pins that exact case forever.
 */

import { describe, expect, it } from "vitest";
import {
  deriveWorkflow,
  EMPTY_EVIDENCE,
  evidenceNewerThanThesis,
  evidenceTrail,
  hasDeepResearch,
  hasResearchEvidence,
  idleDays,
  isStale,
  nextActionFor,
  passReason,
  rankNeedsYou,
  STALE_AFTER_DAYS,
  targetProximity,
  THESIS_RECHECK_DAYS,
  type IdeaEvidence,
  type NeedsYouInput,
} from "@/lib/ideas/evidence";
import type { WatchlistItem } from "@/lib/types";

const NOW = Date.parse("2026-08-15T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function wl(over: Partial<WatchlistItem> & { symbol: string }): WatchlistItem {
  return {
    name: over.symbol,
    addedAt: daysAgo(10),
    targetPrice: null,
    targetDirection: null,
    alertPctDrop: null,
    notes: null,
    buyTrigger: null,
    sellTrigger: null,
    conviction: null,
    horizon: null,
    lastReviewedAt: null,
    lastResearchedAt: null,
    stage: "surfaced",
    stageChangedAt: null,
    source: null,
    sourceDetail: null,
    ...over,
  };
}

const ev = (over: Partial<IdeaEvidence> = {}): IdeaEvidence => ({ ...EMPTY_EVIDENCE, ...over });

/* ------------------------------------------------------------------ */
/* Workflow derivation                                                 */
/* ------------------------------------------------------------------ */

describe("deriveWorkflow", () => {
  it("THE bug case: a researched name is never called unworked, even though nobody ever picked a stage", () => {
    // SOFI in the audited database: stage 'surfaced' (the default, untouched),
    // one Research Hub visit on record. The old board showed it as not yet
    // worked; the derivation must read the evidence instead.
    const item = wl({ symbol: "SOFI" });
    const evidence = ev({ lastResearchedAt: daysAgo(3) });
    expect(deriveWorkflow({ held: false, stage: "surfaced", item, evidence })).toBe("working");
  });

  it("research but no thesis → working", () => {
    const evidence = ev({ aiSessions: 2, valuationCases: 1 });
    expect(deriveWorkflow({ held: false, stage: "surfaced", item: wl({ symbol: "A" }), evidence })).toBe("working");
  });

  it("thesis but no trigger → ready (a decision is open)", () => {
    const item = wl({ symbol: "A", notes: "Wide moat, priced for no growth." });
    expect(deriveWorkflow({ held: false, stage: "surfaced", item, evidence: ev() })).toBe("ready");
  });

  it("thesis + armed target → waiting", () => {
    const item = wl({ symbol: "A", notes: "Buy the drawdown.", targetPrice: 850 });
    expect(deriveWorkflow({ held: false, stage: "surfaced", item, evidence: ev() })).toBe("waiting");
  });

  it("a written buy trigger is both thesis and trigger → waiting", () => {
    const item = wl({ symbol: "A", buyTrigger: "Below 20x forward earnings" });
    expect(deriveWorkflow({ held: false, stage: "surfaced", item, evidence: ev() })).toBe("waiting");
  });

  it("a bare target with no written view is NOT a decision → stays new/working", () => {
    const item = wl({ symbol: "A", targetPrice: 100 });
    expect(deriveWorkflow({ held: false, stage: "surfaced", item, evidence: ev() })).toBe("new");
    expect(
      deriveWorkflow({ held: false, stage: "surfaced", item, evidence: ev({ lastResearchedAt: daysAgo(1) }) }),
    ).toBe("working");
  });

  it("held wins over everything — even a passed idea the user re-bought", () => {
    const item = wl({ symbol: "A", notes: "thesis" });
    expect(deriveWorkflow({ held: true, stage: "passed", item, evidence: ev() })).toBe("owned");
  });

  it("passed is the stored judgment; evidence never overrides a deliberate no", () => {
    const item = wl({ symbol: "A", notes: "great company, wrong price" });
    const evidence = ev({ aiSessions: 3, valuationCases: 1 });
    expect(deriveWorkflow({ held: false, stage: "passed", item, evidence })).toBe("passed");
  });

  it("stored owned for a name the ledger no longer holds → exited", () => {
    expect(deriveWorkflow({ held: false, stage: "owned", item: wl({ symbol: "A" }), evidence: ev() })).toBe("exited");
  });

  it("no activity at all → new", () => {
    expect(deriveWorkflow({ held: false, stage: "surfaced", item: wl({ symbol: "A" }), evidence: ev() })).toBe("new");
  });

  it("the legacy manual stages are ignored — a stale 'researching' label cannot fake evidence", () => {
    expect(
      deriveWorkflow({ held: false, stage: "researching", item: wl({ symbol: "A" }), evidence: ev() }),
    ).toBe("new");
    expect(deriveWorkflow({ held: false, stage: "thesis", item: wl({ symbol: "A" }), evidence: ev() })).toBe("new");
  });
});

describe("hasResearchEvidence", () => {
  it("any artifact counts: visit, session, note, valuation, IC report, journal", () => {
    expect(hasResearchEvidence(ev())).toBe(false);
    expect(hasResearchEvidence(ev({ lastResearchedAt: daysAgo(1) }))).toBe(true);
    expect(hasResearchEvidence(ev({ aiSessions: 1 }))).toBe(true);
    expect(hasResearchEvidence(ev({ noteCount: 1 }))).toBe(true);
    expect(hasResearchEvidence(ev({ valuationCases: 1 }))).toBe(true);
    expect(hasResearchEvidence(ev({ icReports: 1 }))).toBe(true);
    expect(hasResearchEvidence(ev({ journalDecisions: 1 }))).toBe(true);
  });

  it("an IC report alone puts an idea In work", () => {
    const evidence = ev({ icReports: 1, lastIcReportAt: daysAgo(2) });
    expect(deriveWorkflow({ held: false, stage: "surfaced", item: wl({ symbol: "A" }), evidence })).toBe("working");
  });

  it("depth is a labeling distinction, never a workflow one", () => {
    // A bare visit and an AI session both derive "working"…
    expect(hasDeepResearch(ev({ lastResearchedAt: daysAgo(1) }))).toBe(false);
    expect(hasDeepResearch(ev({ aiSessions: 1 }))).toBe(true);
    expect(hasDeepResearch(ev({ icReports: 1 }))).toBe(true);
    // …the difference is only how the trail names it (see evidenceTrail tests).
  });
});

/* ------------------------------------------------------------------ */
/* Time: idleness, staleness, thesis drift                             */
/* ------------------------------------------------------------------ */

describe("idleness and staleness", () => {
  it("idleDays reads the most recent of any recorded activity", () => {
    const item = wl({ symbol: "A", addedAt: daysAgo(30), lastReviewedAt: NOW - 20 * 86_400_000 });
    expect(idleDays(item, ev({ lastResearchedAt: daysAgo(5) }), NOW)).toBe(5);
    expect(idleDays(item, ev(), NOW)).toBe(20);
  });

  it("stales new at 14d, working at 21d, ready at 14d — and never the others", () => {
    const at = (d: number) => wl({ symbol: "A", addedAt: daysAgo(d) });
    expect(isStale("new", at(STALE_AFTER_DAYS.new), ev(), NOW)).toBe(true);
    expect(isStale("new", at(STALE_AFTER_DAYS.new - 1), ev(), NOW)).toBe(false);
    expect(isStale("working", at(STALE_AFTER_DAYS.working), ev(), NOW)).toBe(true);
    expect(isStale("ready", at(STALE_AFTER_DAYS.ready), ev(), NOW)).toBe(true);
    expect(isStale("waiting", at(400), ev(), NOW)).toBe(false);
    expect(isStale("owned", at(400), ev(), NOW)).toBe(false);
  });

  it("flags evidence newer than the thesis, with 48h of slack for the session that produced it", () => {
    const item = wl({ symbol: "A", lastReviewedAt: NOW - 10 * 86_400_000 });
    expect(evidenceNewerThanThesis(item, ev({ lastResearchedAt: daysAgo(1) }))).toBe(true);
    expect(evidenceNewerThanThesis(item, ev({ lastResearchedAt: daysAgo(9) }))).toBe(false);
    expect(evidenceNewerThanThesis(item, ev({ lastIcReportAt: daysAgo(1) }))).toBe(true);
    expect(evidenceNewerThanThesis(wl({ symbol: "A" }), ev({ lastResearchedAt: daysAgo(1) }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Target proximity                                                    */
/* ------------------------------------------------------------------ */

describe("targetProximity", () => {
  it("a buy-below level is reached when price falls to or below it", () => {
    expect(targetProximity(wl({ symbol: "A", targetPrice: 100, targetDirection: "below" }), 99)?.reached).toBe(true);
    expect(targetProximity(wl({ symbol: "A", targetPrice: 100, targetDirection: "below" }), 101)?.reached).toBe(false);
  });

  it("an exit-above target is reached when price rises to or above it", () => {
    expect(targetProximity(wl({ symbol: "A", targetPrice: 100, targetDirection: "above" }), 101)?.reached).toBe(true);
  });

  it("null without a target or a usable price", () => {
    expect(targetProximity(wl({ symbol: "A" }), 100)).toBeNull();
    expect(targetProximity(wl({ symbol: "A", targetPrice: 100 }), null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Next action                                                         */
/* ------------------------------------------------------------------ */

describe("nextActionFor", () => {
  it("new → research, with the grounds stated", () => {
    const a = nextActionFor({ workflow: "new", item: wl({ symbol: "A" }), evidence: ev(), now: NOW });
    expect(a.kind).toBe("research");
    expect(a.detail).toContain("No research evidence");
  });

  it("working → write the thesis, naming the artifacts that exist", () => {
    const a = nextActionFor({
      workflow: "working",
      item: wl({ symbol: "A" }),
      evidence: ev({ valuationCases: 1, lastResearchedAt: daysAgo(2) }),
      now: NOW,
    });
    expect(a.kind).toBe("thesis");
    expect(a.detail).toContain("valuation case");
    expect(a.detail).toContain("no investment view");
  });

  it("a visit-only trail states WHEN it was opened, not a generic 'activity exists'", () => {
    const a = nextActionFor({
      workflow: "working",
      item: wl({ symbol: "A" }),
      evidence: ev({ lastResearchedAt: daysAgo(5) }),
      now: NOW,
    });
    expect(a.detail).toContain("Opened in Research 5d ago");
  });

  it("ready → decide", () => {
    const item = wl({ symbol: "A", notes: "thesis", lastReviewedAt: NOW - 86_400_000 });
    const a = nextActionFor({ workflow: "ready", item, evidence: ev(), now: NOW });
    expect(a.kind).toBe("decide");
  });

  it("stale new/working → triage (work or pass)", () => {
    const item = wl({ symbol: "A", addedAt: daysAgo(30) });
    expect(nextActionFor({ workflow: "new", item, evidence: ev(), now: NOW }).kind).toBe("triage");
    expect(nextActionFor({ workflow: "working", item, evidence: ev(), now: NOW }).kind).toBe("triage");
  });

  it("waiting → monitor, restating the armed level and its distance", () => {
    const item = wl({
      symbol: "A",
      notes: "thesis",
      targetPrice: 90,
      targetDirection: "below",
      lastReviewedAt: NOW - 86_400_000,
    });
    const a = nextActionFor({ workflow: "waiting", item, evidence: ev(), price: 100, now: NOW });
    expect(a.kind).toBe("monitor");
    expect(a.detail).toContain("below");
    expect(a.detail).toContain("10.0%");
  });

  it("waiting with the trigger HIT → review, loudly", () => {
    const item = wl({
      symbol: "A",
      notes: "thesis",
      targetPrice: 110,
      targetDirection: "below",
      lastReviewedAt: NOW - 86_400_000,
    });
    const a = nextActionFor({ workflow: "waiting", item, evidence: ev(), price: 100, now: NOW });
    expect(a.kind).toBe("review");
    expect(a.label).toBe("Trigger hit");
  });

  it("evidence newer than the thesis → review the thesis", () => {
    const item = wl({ symbol: "A", notes: "thesis", lastReviewedAt: NOW - 10 * 86_400_000 });
    const a = nextActionFor({
      workflow: "ready",
      item,
      evidence: ev({ lastResearchedAt: daysAgo(1) }),
      now: NOW,
    });
    expect(a.kind).toBe("review");
    expect(a.detail).toContain("after your last thesis review");
  });

  it("a waiting thesis ages out for a re-check", () => {
    const item = wl({
      symbol: "A",
      notes: "thesis",
      buyTrigger: "below 20x",
      lastReviewedAt: NOW - (THESIS_RECHECK_DAYS + 1) * 86_400_000,
      addedAt: daysAgo(200),
    });
    const a = nextActionFor({ workflow: "waiting", item, evidence: ev(), now: NOW });
    expect(a.kind).toBe("review");
  });

  it("owned defers to the Portfolio; exited asks nothing", () => {
    expect(nextActionFor({ workflow: "owned", item: wl({ symbol: "A" }), evidence: ev(), now: NOW }).kind).toBe("portfolio");
    expect(nextActionFor({ workflow: "exited", item: wl({ symbol: "A" }), evidence: ev(), now: NOW }).kind).toBe("none");
  });

  it("passed surfaces the journaled reason", () => {
    const evidence = ev({
      journalDecisions: 1,
      lastDecisionAction: "avoid",
      lastDecisionThesis: "Passed: Too risky — levered balance sheet",
    });
    const a = nextActionFor({ workflow: "passed", item: wl({ symbol: "A" }), evidence, now: NOW });
    expect(a.kind).toBe("reconsider");
    expect(a.detail).toContain("Too risky");
    expect(passReason(evidence)).toContain("Too risky");
    // A later BUY decision means the latest word is no longer the pass.
    expect(passReason(ev({ lastDecisionAction: "buy", lastDecisionThesis: "x" }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Evidence trail                                                      */
/* ------------------------------------------------------------------ */

describe("evidenceTrail", () => {
  it("renders absent artifacts as explicit dashes, never omitting them", () => {
    const chips = evidenceTrail(wl({ symbol: "A" }), ev(), NOW);
    expect(chips.map((c) => c.key)).toEqual(["research", "valuation", "ic", "notes", "thesis", "journal"]);
    expect(chips.every((c) => !c.present)).toBe(true);
    expect(chips.find((c) => c.key === "thesis")!.label).toBe("Thesis —");
  });

  it("labels a bare visit 'Opened', reserving 'Researched' for deep artifacts", () => {
    const shallow = evidenceTrail(wl({ symbol: "A" }), ev({ lastResearchedAt: daysAgo(3) }), NOW);
    expect(shallow.find((c) => c.key === "research")!.label).toBe("Opened 3d ago");
    // Still PRESENT — a visit is work; only the word changes.
    expect(shallow.find((c) => c.key === "research")!.present).toBe(true);

    const deep = evidenceTrail(wl({ symbol: "A" }), ev({ lastResearchedAt: daysAgo(3), aiSessions: 2 }), NOW);
    expect(deep.find((c) => c.key === "research")!.label).toBe("Researched 3d ago");

    const ic = evidenceTrail(wl({ symbol: "A" }), ev({ lastResearchedAt: daysAgo(1), icReports: 1 }), NOW);
    expect(ic.find((c) => c.key === "research")!.label).toBe("Researched 1d ago");
    expect(ic.find((c) => c.key === "ic")!.label).toBe("IC ✓");
  });

  it("marks the thesis chip from the written fields, with conviction in the title", () => {
    const chips = evidenceTrail(wl({ symbol: "A", notes: "view", conviction: "high" }), ev(), NOW);
    const thesis = chips.find((c) => c.key === "thesis")!;
    expect(thesis.present).toBe(true);
    expect(thesis.title).toContain("high conviction");
  });
});

/* ------------------------------------------------------------------ */
/* Needs You ranking                                                   */
/* ------------------------------------------------------------------ */

describe("rankNeedsYou", () => {
  const entry = (over: Partial<NeedsYouInput> & { symbol: string }): NeedsYouInput => ({
    name: over.symbol,
    workflow: "working",
    action: { kind: "thesis", label: "Write thesis", detail: "" },
    idle: 0,
    priority: null,
    ...over,
  });

  it("drops routine kinds and ranks review > decide > thesis > triage", () => {
    const ranked = rankNeedsYou([
      entry({ symbol: "T", action: { kind: "triage", label: "", detail: "" } }),
      entry({ symbol: "M", action: { kind: "monitor", label: "", detail: "" } }),
      entry({ symbol: "D", action: { kind: "decide", label: "", detail: "" } }),
      entry({ symbol: "R", action: { kind: "review", label: "", detail: "" } }),
      entry({ symbol: "W", action: { kind: "thesis", label: "", detail: "" } }),
    ]);
    expect(ranked.map((r) => r.symbol)).toEqual(["R", "D", "W", "T"]);
  });

  it("breaks kind ties by engine priority, then by idleness (stalest loudest)", () => {
    const ranked = rankNeedsYou([
      entry({ symbol: "B", priority: 2 }),
      entry({ symbol: "A", priority: 1 }),
      entry({ symbol: "NOPRIO-YOUNG", idle: 3 }),
      entry({ symbol: "NOPRIO-OLD", idle: 30 }),
    ]);
    expect(ranked.map((r) => r.symbol)).toEqual(["A", "B", "NOPRIO-OLD", "NOPRIO-YOUNG"]);
  });
});
