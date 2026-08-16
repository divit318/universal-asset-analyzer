/**
 * The idea evidence model — what UAA can PROVE about a tracked idea, and the
 * workflow state that follows from it.
 *
 * This replaces the manually-curated pipeline stages (the 2026-08 audit found
 * the manual middle of that funnel had literally never been used: 0 rows ever
 * marked "researching" or "thesis", while every "surfaced" idea had recorded
 * research activity the board ignored). The rules here are the fix:
 *
 *  1. **Evidence is observed, never declared.** Research recency, valuation
 *     cases, notes and journal entries are read from the stores that already
 *     record them. There is no "mark as researched" anywhere.
 *  2. **Workflow is derived from evidence + the ledger.** The only states a
 *     user sets by hand are the judgments no system can make: passing on an
 *     idea, and the thesis itself (writing it IS the transition).
 *  3. **The app must never claim "no research" when research exists.** An
 *     absent artifact renders as an em-dash chip, never as a verdict about
 *     the user's diligence.
 *
 * Threshold choice, stated out loud: opening a symbol in the Research Hub is
 * counted as research activity. The hub records a visit only once the quote
 * resolves, and opening a dedicated research workstation for a ticker is a
 * deliberate act — but it is WEAK evidence, so the trail labels it by recency
 * ("researched 3d ago") while durable artifacts (AI sessions, valuation cases,
 * notes, a written thesis) carry their own explicit chips. Erring toward
 * counting a shallow visit is deliberate: the failure mode this module exists
 * to prevent is claiming work doesn't exist when it does.
 *
 * Pure and synchronous — no React, no database, no fetching. The DB join that
 * feeds it lives in lib/db.ts (`getIdeaEvidence`); tests pin the derivation in
 * tests/idea-evidence.test.ts.
 */

import type { Conviction, IdeaStage, TargetDirection, WatchlistItem } from "../types";

/* -------------------------------------------------------------------------- */
/* Evidence — what actually happened, per symbol                               */
/* -------------------------------------------------------------------------- */

/** Observed research artifacts for one symbol, joined from the app's own stores. */
export interface IdeaEvidence {
  /**
   * Most recent research activity: the later of the durable per-row stamp
   * (watchlist.last_researched_at), the visit log, and the latest AI research
   * session. Null = the app has no record of this symbol being researched.
   */
  lastResearchedAt: string | null;
  /** Persisted AI research copilot sessions (research_session). */
  aiSessions: number;
  /** Saved research notes (research_notes). */
  noteCount: number;
  lastNoteAt: string | null;
  /** DCF/valuation cases (valuation_case). */
  valuationCases: number;
  lastValuationAt: string | null;
  /** Institutional IC reports (ic_report) — the deepest artifact UAA produces. */
  icReports: number;
  lastIcReportAt: string | null;
  /** Journal entries (decision table). */
  journalDecisions: number;
  lastDecisionAt: string | null;
  /** The latest journal entry's action + thesis — how a pass reason survives. */
  lastDecisionAction: string | null;
  lastDecisionThesis: string | null;
}

export const EMPTY_EVIDENCE: IdeaEvidence = {
  lastResearchedAt: null,
  aiSessions: 0,
  noteCount: 0,
  lastNoteAt: null,
  valuationCases: 0,
  lastValuationAt: null,
  icReports: 0,
  lastIcReportAt: null,
  journalDecisions: 0,
  lastDecisionAt: null,
  lastDecisionAction: null,
  lastDecisionThesis: null,
};

/* -------------------------------------------------------------------------- */
/* Workflow — where the DECISION stands                                        */
/* -------------------------------------------------------------------------- */

/**
 * The derived workflow state. Four active states + three outcomes.
 *
 * Active (the funnel):
 *  - `new`      tracked, no meaningful work exists yet
 *  - `working`  research evidence exists, no written investment view
 *  - `ready`    a thesis exists — the remaining step is a decision
 *  - `waiting`  a conditional plan exists (thesis + armed trigger/target)
 *
 * Outcomes (off the funnel):
 *  - `owned`    held in the ledger (fact, never stored opinion)
 *  - `passed`   deliberately declined (the one manual state)
 *  - `exited`   previously owned, position closed (ledger fact)
 */
export type IdeaWorkflow = "new" | "working" | "ready" | "waiting" | "owned" | "passed" | "exited";

export const ACTIVE_WORKFLOWS: IdeaWorkflow[] = ["new", "working", "ready", "waiting"];
export const OUTCOME_WORKFLOWS: IdeaWorkflow[] = ["owned", "passed", "exited"];

export const WORKFLOW_LABEL: Record<IdeaWorkflow, string> = {
  new: "New",
  working: "In work",
  ready: "Ready to decide",
  waiting: "Waiting",
  owned: "Owned",
  passed: "Passed",
  exited: "Exited",
};

/** The question each active state asks — column subtitles on the board. */
export const WORKFLOW_QUESTION: Record<IdeaWorkflow, string> = {
  new: "Worth my time?",
  working: "What's my view?",
  ready: "Act, wait, or pass?",
  waiting: "Has the condition hit?",
  owned: "Managed in Portfolio",
  passed: "Declined, with a reason",
  exited: "Position closed",
};

export const WORKFLOW_HELP: Record<IdeaWorkflow, string> = {
  new: "Tracked, but no research evidence exists yet. Opening it in Research moves it to In work.",
  working: "Research evidence exists; no investment view has been written. Writing the thesis makes it Ready.",
  ready: "A thesis exists — the remaining step is a decision: buy, arm a trigger, or pass.",
  waiting: "A thesis plus an armed trigger or price level — decided conditionally, monitoring itself.",
  owned: "Held in the portfolio — derived from the ledger, never set by hand.",
  passed: "Deliberately declined. Kept for the record; can be reconsidered.",
  exited: "Previously owned; the ledger shows the position closed.",
};

/** Funnel order, for sorting a table column. */
export const WORKFLOW_ORDER: Record<IdeaWorkflow, number> = {
  new: 0,
  working: 1,
  ready: 2,
  waiting: 3,
  owned: 4,
  passed: 5,
  exited: 6,
};

/** The thesis fields, as one predicate: has the user written an investment view? */
export function hasThesis(item: Pick<WatchlistItem, "notes" | "buyTrigger" | "sellTrigger">): boolean {
  return Boolean(item.notes?.trim() || item.buyTrigger?.trim() || item.sellTrigger?.trim());
}

/** An armed condition: a price target or a written buy trigger. */
export function hasTrigger(item: Pick<WatchlistItem, "targetPrice" | "buyTrigger">): boolean {
  return item.targetPrice != null || Boolean(item.buyTrigger?.trim());
}

/** Any observed research at all — the predicate that kills "Research: None". */
export function hasResearchEvidence(ev: IdeaEvidence): boolean {
  return (
    ev.lastResearchedAt != null ||
    ev.aiSessions > 0 ||
    ev.noteCount > 0 ||
    ev.valuationCases > 0 ||
    ev.icReports > 0 ||
    ev.journalDecisions > 0
  );
}

/**
 * Deep research: an AI research session or an IC report — artifacts that only
 * exist because the user worked the name, as opposed to a page visit, whose
 * depth the app cannot measure. Drives LABELING only ("Researched" vs
 * "Opened"), never the workflow: a visit still counts as work, because the
 * worse failure is claiming work doesn't exist when it does.
 */
export function hasDeepResearch(ev: IdeaEvidence): boolean {
  return ev.aiSessions > 0 || ev.icReports > 0;
}

/**
 * Derive the workflow state. Precedence, and why:
 *
 *  1. The ledger wins in both directions (`owned`, and stored-owned → `exited`)
 *     — a column that claims to show what you own must be derived from what
 *     you own (kept verbatim from the pipeline's one honest rule).
 *  2. `passed` is the stored judgment; evidence never overrides a deliberate no.
 *  3. Then evidence: thesis + trigger → `waiting`; thesis → `ready`;
 *     any research → `working`; else `new`.
 *
 * The legacy stored stages (`surfaced`/`researching`/`thesis`) are deliberately
 * ignored: in real data they were never maintained, and honoring them would
 * re-introduce the stale manual state this model replaces.
 */
export function deriveWorkflow(input: {
  /** Currently held in the ledger. */
  held: boolean;
  /** The stored stage — consulted only for `passed` and legacy `owned`. */
  stage: IdeaStage;
  item: Pick<WatchlistItem, "notes" | "buyTrigger" | "sellTrigger" | "targetPrice">;
  evidence: IdeaEvidence;
}): IdeaWorkflow {
  if (input.held) return "owned";
  if (input.stage === "passed") return "passed";
  if (input.stage === "owned" || input.stage === "exited") return "exited";
  if (hasThesis(input.item)) return hasTrigger(input.item) ? "waiting" : "ready";
  if (hasResearchEvidence(input.evidence)) return "working";
  return "new";
}

/* -------------------------------------------------------------------------- */
/* Time — last activity, idleness, staleness                                   */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function epoch(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const t = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** The most recent thing that happened to this idea, as epoch ms. */
export function lastActivityAt(
  item: Pick<WatchlistItem, "addedAt" | "stageChangedAt" | "lastReviewedAt">,
  evidence: IdeaEvidence,
): number {
  const candidates = [
    epoch(item.addedAt),
    epoch(item.stageChangedAt),
    epoch(item.lastReviewedAt),
    epoch(evidence.lastResearchedAt),
    epoch(evidence.lastNoteAt),
    epoch(evidence.lastValuationAt),
    epoch(evidence.lastIcReportAt),
    epoch(evidence.lastDecisionAt),
  ].filter((t): t is number => t != null);
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

/** Whole days since the last recorded activity. */
export function idleDays(
  item: Pick<WatchlistItem, "addedAt" | "stageChangedAt" | "lastReviewedAt">,
  evidence: IdeaEvidence,
  now: number = Date.now(),
): number {
  const last = lastActivityAt(item, evidence);
  if (last === 0) return 0;
  return Math.max(0, Math.floor((now - last) / DAY_MS));
}

/**
 * Idle-day thresholds after which an active idea is stale. Judgment calls,
 * stated once: a new idea untouched for two weeks was a passing thought; work
 * that stopped for three weeks has stalled; a thesis that has waited two weeks
 * for a decision IS the decision being avoided.
 */
export const STALE_AFTER_DAYS: Record<"new" | "working" | "ready", number> = {
  new: 14,
  working: 21,
  ready: 14,
};

/** A waiting idea isn't time-stale (it waits on price), but its thesis can age out. */
export const THESIS_RECHECK_DAYS = 90;

export function isStale(
  workflow: IdeaWorkflow,
  item: Pick<WatchlistItem, "addedAt" | "stageChangedAt" | "lastReviewedAt">,
  evidence: IdeaEvidence,
  now: number = Date.now(),
): boolean {
  if (workflow !== "new" && workflow !== "working" && workflow !== "ready") return false;
  return idleDays(item, evidence, now) >= STALE_AFTER_DAYS[workflow];
}

/**
 * New research landed after the thesis was last reviewed — the thesis may not
 * reflect what the user now knows. 48h of slack so the research session that
 * PRODUCED the thesis doesn't flag it.
 */
export function evidenceNewerThanThesis(
  item: Pick<WatchlistItem, "lastReviewedAt">,
  evidence: IdeaEvidence,
): boolean {
  const reviewed = epoch(item.lastReviewedAt);
  if (reviewed == null) return false;
  const newest = Math.max(
    epoch(evidence.lastResearchedAt) ?? 0,
    epoch(evidence.lastValuationAt) ?? 0,
    epoch(evidence.lastNoteAt) ?? 0,
    epoch(evidence.lastIcReportAt) ?? 0,
  );
  return newest > reviewed + 2 * 24 * 60 * 60 * 1000;
}

/* -------------------------------------------------------------------------- */
/* Target proximity                                                            */
/* -------------------------------------------------------------------------- */

export interface TargetProximity {
  /** The armed level has been crossed in the stated direction. */
  reached: boolean;
  /** Absolute % distance from price to target. */
  distancePct: number;
}

/** Null when there is no target or no live price to compare it against. */
export function targetProximity(
  item: Pick<WatchlistItem, "targetPrice" | "targetDirection">,
  price: number | null | undefined,
): TargetProximity | null {
  if (item.targetPrice == null || price == null || !(price > 0)) return null;
  const direction: TargetDirection = item.targetDirection ?? (item.targetPrice < price ? "below" : "above");
  const reached = direction === "below" ? price <= item.targetPrice : price >= item.targetPrice;
  const distancePct = Math.abs((price - item.targetPrice) / price) * 100;
  return { reached, distancePct };
}

/* -------------------------------------------------------------------------- */
/* Next action — the one thing that moves this idea forward                    */
/* -------------------------------------------------------------------------- */

/**
 * What kind of act the primary CTA performs. The UI maps kinds to affordances
 * (a link into Research, the thesis editor, the decide dialog, …); this module
 * only states WHAT should happen next and why.
 */
export type NextActionKind =
  | "research" // open the Research Hub — no meaningful work yet
  | "thesis" // write the investment view — evidence exists, view doesn't
  | "decide" // thesis exists: buy, arm a trigger, or pass
  | "monitor" // waiting on an armed condition; nothing to do today
  | "review" // something changed: trigger hit, or evidence postdates the thesis
  | "triage" // stale: continue working it, or pass
  | "portfolio" // owned — managed in Portfolio/Decisions, not here
  | "reconsider" // passed — can be reopened if circumstances changed
  | "none"; // exited — history, no action asked

export interface NextAction {
  kind: NextActionKind;
  /** Verb-first CTA label, ≤3 words. */
  label: string;
  /** One sentence of grounds — always a measured fact, never a market call. */
  detail: string;
}

const money = (v: number) => (v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`);

function agoPhrase(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (!Number.isFinite(days) || days < 0) return "today";
  return days === 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
}

/**
 * Compact list of the durable artifacts that exist, for "why this CTA" copy.
 * A visit-only trail says WHEN it was opened rather than a generic "activity
 * exists" — five cards reading the identical sentence tell the user nothing.
 */
function artifactPhrase(ev: IdeaEvidence, now: number): string {
  const parts: string[] = [];
  if (ev.icReports > 0) parts.push("an IC report");
  if (ev.aiSessions > 0) parts.push("AI research");
  if (ev.valuationCases > 0) parts.push("a valuation case");
  if (ev.noteCount > 0) parts.push("notes");
  if (parts.length === 0) {
    const when = agoPhrase(ev.lastResearchedAt, now);
    return when ? `Opened in Research ${when}` : "Research activity exists";
  }
  if (parts.length === 1) return `${parts[0][0].toUpperCase()}${parts[0].slice(1)} exists`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]} exist`;
}

/**
 * The single next action for an idea. Deterministic; every branch states its
 * evidence in `detail` so the CTA never reads as an unexplained instruction.
 */
export function nextActionFor(input: {
  workflow: IdeaWorkflow;
  item: Pick<
    WatchlistItem,
    | "addedAt"
    | "stageChangedAt"
    | "lastReviewedAt"
    | "targetPrice"
    | "targetDirection"
    | "buyTrigger"
  >;
  evidence: IdeaEvidence;
  /** Live price, when the caller has one — enables trigger-hit detection. */
  price?: number | null;
  now?: number;
}): NextAction {
  const { workflow, item, evidence } = input;
  const now = input.now ?? Date.now();
  const idle = idleDays(item, evidence, now);

  switch (workflow) {
    case "new":
      if (idle >= STALE_AFTER_DAYS.new) {
        return { kind: "triage", label: "Work or pass", detail: `Untouched for ${idle}d — research it or let it go.` };
      }
      return { kind: "research", label: "Research", detail: "No research evidence yet." };

    case "working":
      if (idle >= STALE_AFTER_DAYS.working) {
        return { kind: "triage", label: "Work or pass", detail: `No new work in ${idle}d — continue or let it go.` };
      }
      return { kind: "thesis", label: "Write thesis", detail: `${artifactPhrase(evidence, now)}; no investment view yet.` };

    case "ready": {
      if (evidenceNewerThanThesis(item, evidence)) {
        return { kind: "review", label: "Review thesis", detail: "New research landed after your last thesis review." };
      }
      const waited = idle >= STALE_AFTER_DAYS.ready ? ` It has waited ${idle}d.` : "";
      return { kind: "decide", label: "Decide", detail: `Thesis exists — buy, arm a trigger, or pass.${waited}` };
    }

    case "waiting": {
      const prox = targetProximity(item, input.price);
      if (prox?.reached && item.targetPrice != null) {
        return { kind: "review", label: "Trigger hit", detail: `Price crossed your ${money(item.targetPrice)} level — act or re-arm.` };
      }
      if (evidenceNewerThanThesis(item, evidence)) {
        return { kind: "review", label: "Review thesis", detail: "New research landed after your last thesis review." };
      }
      const reviewed = epoch(item.lastReviewedAt);
      if (reviewed != null && now - reviewed >= THESIS_RECHECK_DAYS * DAY_MS) {
        return { kind: "review", label: "Re-check thesis", detail: `Thesis last reviewed ${Math.floor((now - reviewed) / DAY_MS)}d ago.` };
      }
      if (item.targetPrice != null && prox != null) {
        const dir = item.targetDirection === "above" ? "above" : "below";
        return { kind: "monitor", label: "Monitor", detail: `Waiting: ${dir} ${money(item.targetPrice)} — ${prox.distancePct.toFixed(1)}% away.` };
      }
      if (item.targetPrice != null) {
        const dir = item.targetDirection === "above" ? "above" : "below";
        return { kind: "monitor", label: "Monitor", detail: `Waiting: ${dir} ${money(item.targetPrice)}.` };
      }
      return { kind: "monitor", label: "Monitor", detail: `Waiting on: ${item.buyTrigger?.trim() ?? "your trigger"}.` };
    }

    case "owned":
      return { kind: "portfolio", label: "Manage", detail: "Held — sizing and trades live in Portfolio → Decisions." };

    case "passed":
      return { kind: "reconsider", label: "Reconsider", detail: passReason(evidence) ?? "Passed. Reopen if circumstances changed." };

    case "exited":
      return { kind: "none", label: "—", detail: "Position closed. Kept for the record." };
  }
}

/** The recorded pass reason, when the journal has one. */
export function passReason(ev: IdeaEvidence): string | null {
  if (ev.lastDecisionAction !== "avoid" || !ev.lastDecisionThesis) return null;
  return ev.lastDecisionThesis;
}

/* -------------------------------------------------------------------------- */
/* Evidence trail — the chips                                                  */
/* -------------------------------------------------------------------------- */

export interface EvidenceChip {
  key: "research" | "valuation" | "ic" | "notes" | "thesis" | "journal";
  /** Short chip text, e.g. "Researched 3d ago", "DCF ✓", "Thesis —". */
  label: string;
  present: boolean;
  /** Hover text stating exactly what the chip is derived from. */
  title: string;
}

function agoDays(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (!Number.isFinite(days) || days < 0) return "today";
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

/**
 * The per-idea evidence trail, in fixed order so rows scan vertically. Absent
 * artifacts are RENDERED (as "—") rather than omitted: "no thesis yet" is
 * information, and hiding it would make the trail unscannable.
 */
export function evidenceTrail(
  item: Pick<WatchlistItem, "notes" | "buyTrigger" | "sellTrigger" | "conviction">,
  evidence: IdeaEvidence,
  now: number = Date.now(),
): EvidenceChip[] {
  const thesis = hasThesis(item);
  // Depth is labeled, never inflated: "Researched" is reserved for deep
  // artifacts (AI sessions, IC reports); a bare page visit reads "Opened".
  // Both count as work — the distinction is honesty about how much.
  const deep = hasDeepResearch(evidence);
  return [
    {
      key: "research",
      present: evidence.lastResearchedAt != null || deep,
      label: evidence.lastResearchedAt
        ? `${deep ? "Researched" : "Opened"} ${agoDays(evidence.lastResearchedAt, now)}`
        : "Research —",
      title: evidence.lastResearchedAt
        ? deep
          ? `Last research activity ${agoDays(evidence.lastResearchedAt, now)} · ${[
              evidence.aiSessions > 0 ? `${evidence.aiSessions} AI session${evidence.aiSessions === 1 ? "" : "s"}` : null,
              evidence.icReports > 0 ? `${evidence.icReports} IC report${evidence.icReports === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}`
          : `Opened in the Research Hub ${agoDays(evidence.lastResearchedAt, now)}. No deeper artifact (AI session, IC report) yet.`
        : "No recorded research activity for this symbol.",
    },
    {
      key: "valuation",
      present: evidence.valuationCases > 0,
      label: evidence.valuationCases > 0 ? "DCF ✓" : "DCF —",
      title: evidence.valuationCases > 0 ? "A valuation case exists for this symbol." : "No valuation case yet.",
    },
    {
      key: "ic",
      present: evidence.icReports > 0,
      label: evidence.icReports > 0 ? "IC ✓" : "IC —",
      title: evidence.icReports > 0
        ? `${evidence.icReports} institutional report${evidence.icReports === 1 ? "" : "s"} on file.`
        : "No IC report yet.",
    },
    {
      key: "notes",
      present: evidence.noteCount > 0,
      label: evidence.noteCount > 0 ? "Notes ✓" : "Notes —",
      title: evidence.noteCount > 0 ? `${evidence.noteCount} saved research note${evidence.noteCount === 1 ? "" : "s"}.` : "No saved research notes.",
    },
    {
      key: "thesis",
      present: thesis,
      label: thesis ? "Thesis ✓" : "Thesis —",
      title: thesis
        ? `An investment view is written${convictionSuffix(item.conviction)}.`
        : "No investment view written yet.",
    },
    {
      key: "journal",
      present: evidence.journalDecisions > 0,
      label: evidence.journalDecisions > 0 ? "Journal ✓" : "Journal —",
      title: evidence.journalDecisions > 0
        ? `${evidence.journalDecisions} journal entr${evidence.journalDecisions === 1 ? "y" : "ies"} for this symbol.`
        : "No journal entries for this symbol.",
    },
  ];
}

function convictionSuffix(conviction: Conviction | null): string {
  return conviction ? ` · ${conviction} conviction` : "";
}

/* -------------------------------------------------------------------------- */
/* Needs You — the attention queue over workflow state                         */
/* -------------------------------------------------------------------------- */

/**
 * Which action kinds ask for the user, and in what order. Market events
 * (targets crossed, alerts fired, new filings) are deliberately NOT here —
 * the Pulse brief above the table already owns "what happened"; this queue
 * owns "what decision is open". Two strips must never report the same fact.
 */
const NEEDS_YOU_RANK: Partial<Record<NextActionKind, number>> = {
  review: 0, // trigger hit / evidence conflicts with thesis
  decide: 1, // thesis waiting on a decision
  thesis: 2, // research done, view unwritten
  triage: 3, // stale — work or pass
};

export interface NeedsYouInput {
  symbol: string;
  name: string;
  workflow: IdeaWorkflow;
  action: NextAction;
  idle: number;
  /** Impact rank from the relevance engine (1 = highest), when assessed. */
  priority: number | null;
}

/**
 * Rank the open asks. Kind first (a hit trigger outranks a stale idea),
 * relevance-engine priority second, idleness third — the longer something has
 * sat, the louder it reads. Capped by the caller.
 */
export function rankNeedsYou<T extends NeedsYouInput>(rows: T[]): T[] {
  return rows
    .filter((r) => NEEDS_YOU_RANK[r.action.kind] != null)
    .sort((a, b) => {
      const kind = (NEEDS_YOU_RANK[a.action.kind] ?? 9) - (NEEDS_YOU_RANK[b.action.kind] ?? 9);
      if (kind !== 0) return kind;
      if (a.priority != null && b.priority != null && a.priority !== b.priority) return a.priority - b.priority;
      if (a.priority != null && b.priority == null) return -1;
      if (a.priority == null && b.priority != null) return 1;
      return b.idle - a.idle || a.symbol.localeCompare(b.symbol);
    });
}
