/**
 * The Attention Queue engine — one deterministic score that ranks every kind of
 * thing that can need a decision (§4.2).
 *
 * This is the contract RC3 said never existed: a shared unit of importance.
 * Before it, `recommended-actions`, `threat-center`, `intelligence-feed`,
 * `timeline`, `upcoming-events`, and the alert half of `watchlist-intelligence`
 * each ranked their own output, and nothing could compare a severity-9 threat
 * to a routine catalyst. Now every feeder normalizes its output to an
 * `AttentionSeed` (impact / urgency / confidence, each 0–1), and *only this
 * module* turns those into a score, dedupes, filters dismissals, and sorts.
 *
 * Feeders are pure transforms of digest slices the home digest already built —
 * no fetching, no caching, no AI. That is what lets the queue paint in the
 * first eager digest pass (§18) and never block on the AI (§19.8).
 *
 * The scoring exponents, the per-kind TTLs, and the per-kind confidence/impact
 * defaults are all named constants so they are tunable in one place and pinned
 * by tests (tests/home-attention.test.ts).
 *
 * Pure — no I/O.
 */

import type {
  AttentionDismissal,
  AttentionItem,
  AttentionKind,
  AttentionQueue,
  AttentionSeed,
  OpportunitySnapshotItem,
  RecommendedAction,
  ThreatItem,
  UpcomingEventLite,
} from "./contracts";
import type { WatchlistAlert } from "../types";

/* ------------------------------------------------------------------ */
/* Tunable constants — the scoring model in one auditable place        */
/* ------------------------------------------------------------------ */

/**
 * `score = 100 × impact^0.5 × urgency^0.3 × confidence^0.2` (§4.2). Geometric:
 * a zero in any dimension sinks the item. The exponents are the starting point;
 * they live here (not inline) precisely so they can be tuned without hunting.
 */
export const SCORE_EXPONENTS = { impact: 0.5, urgency: 0.3, confidence: 0.2 } as const;

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long a dismissal suppresses a story, by kind (§12).
 * - threats: a week to re-raise a still-standing risk.
 * - events: until the date passes — modelled as a generous ceiling here; the
 *   dismissal's real expiry is the catalyst time (see `dismissalExpiresAt`).
 * - actions: short — the engine re-scores continuously, and a *material* change
 *   resurfaces immediately via the score band in the dedupe key regardless.
 * - signals: a month; a scanner idea you passed on stays passed for a while.
 * - alerts: a week, same rhythm as threats.
 */
export const KIND_TTL_MS: Record<AttentionKind, number> = {
  threat: 7 * DAY,
  event: 30 * DAY,
  action: 3 * DAY,
  signal: 30 * DAY,
  alert: 7 * DAY,
};

/**
 * The longest any user-chosen suppression may last (audit AG-04/AG-05/AG-06):
 * "done" and per-symbol mutes park a story for 90 days, and a snooze may not
 * reach past it — a never-revisited choice must not suppress forever. Band
 * resurfacing still applies throughout: a materially worse version of the
 * story carries a different dedupe key and bypasses any of these.
 */
export const MAX_SUPPRESS_MS = 90 * DAY;

/**
 * The user-facing form of a kind's dismissal TTL (audit AG-02): the plain
 * dismiss toast must SAY what the X did ("Dismissed for 7d"), because the
 * per-kind TTL is otherwise invisible and the affordance unpredictable.
 */
export function dismissalTtlLabel(kind: AttentionKind): string {
  return `${Math.round(KIND_TTL_MS[kind] / DAY)}d`;
}

/**
 * A per-symbol mute is a dismissal row with a reserved key shape (audit
 * AG-05): unlike a story dismissal it matches on the seed's SYMBOL, so it
 * survives dedupe-band rotation — that durability is exactly what makes it a
 * mute rather than a dismiss. Same table, same undo path (DELETE the key).
 */
export const MUTE_KEY_PREFIX = "mute:symbol:";

export function muteKeyForSymbol(symbol: string): string {
  return `${MUTE_KEY_PREFIX}${symbol.trim().toUpperCase()}`;
}

/**
 * Context-preserving navigation, outbound half (audit AG-10): every queue
 * link carries `from=today` so the destination can know the visit started at
 * the dashboard. Internal hrefs only, and never doubled.
 */
export function withFromToday(href: string): string {
  if (!href.startsWith("/")) return href;
  if (/[?&]from=/.test(href)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=today`;
}

/** Confidence when the feeder's source doesn't quantify one (§4.2). */
export const KIND_CONFIDENCE_DEFAULT: Record<AttentionKind, number> = {
  threat: 0.8,
  event: 1.0, // a dated calendar event either happens or it doesn't.
  action: 0.6,
  signal: 0.5,
  alert: 0.6,
};

/** Tie-break precedence when scores are equal (§12). Lower = ranked first. */
export const KIND_PRECEDENCE: Record<AttentionKind, number> = {
  threat: 0,
  action: 1,
  alert: 2,
  event: 3,
  signal: 4,
};

/** Urgency for items with no catalyst date (§4.2). */
export const UNDATED_URGENCY = 0.6;
/** ≤ this many hours to the catalyst ⇒ maximum urgency. */
export const URGENCY_RAMP_HOURS = 24;
/** ≥ this many hours to the catalyst ⇒ zero urgency. */
export const URGENCY_ZERO_HOURS = 7 * 24;
/**
 * When the market is closed, an event still more than a day out must not be
 * pushed toward maximum urgency purely by overnight hours ticking down — the
 * user can't act, so the ramp is capped until the market reopens (§11's
 * "urgency decay pauses via lib/market-hours.ts"). Intraday-imminent events are
 * unaffected: they cross the ≤24h ramp on their own.
 */
export const MARKET_CLOSED_URGENCY_CEIL = 0.85;
/**
 * Urgency of a catalyst whose time has already passed: review the outcome,
 * do not treat it as imminent (audit DU-06).
 */
export const PAST_EVENT_URGENCY = 0.5;

/** severity → an impact floor, used when the source gives no measured magnitude. */
const SEVERITY_IMPACT: Record<"high" | "medium" | "low", number> = {
  high: 0.8,
  medium: 0.5,
  low: 0.3,
};

/** % of portfolio at risk that counts as full impact for a threat. */
const THREAT_IMPACT_FULL_PCT = 25;
/**
 * Impact of a catalyst/alert on a name that is tracked but not owned.
 *
 * Was 0.3 — which OUTRANKED every real position under 30% of the book, so an
 * unheld name's routine ex-div scored five times a held 3% position's earnings
 * (audit DU-05). A watched-but-unowned name must rank below any meaningfully
 * held one.
 */
const UNHELD_IMPACT = 0.1;
/**
 * Book weight that counts as FULL impact for a held name's catalyst/alert.
 * Raw weights (0.02-0.15 for most books) lived on a different scale from the
 * severity floors (0.3-0.8), so held names systematically lost to everything
 * else. A 25% position is a whole-book concern — same anchor as
 * THREAT_IMPACT_FULL_PCT.
 */
const HELD_IMPACT_FULL_WEIGHT = 0.25;

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * The score's user-facing form (audit DU-01/DU-02): the raw 0-100 number is a
 * geometric blend whose 65-vs-67 differences carry almost no discriminating
 * information (most inputs are per-kind constants), so the UI renders BANDS
 * and keeps the number for the drill-through and the internal ranking. Bands
 * are named for what the user should do with the item, not fake precision.
 * Once telemetry lands (audit 13), the bands get re-anchored to measured
 * action rates.
 */
export interface PriorityBucket {
  id: "act-now" | "today" | "this-week" | "fyi";
  label: string;
}

export function priorityBucket(score: number): PriorityBucket {
  if (score >= 70) return { id: "act-now", label: "Act now" };
  if (score >= 55) return { id: "today", label: "Today" };
  if (score >= 40) return { id: "this-week", label: "This week" };
  return { id: "fyi", label: "FYI" };
}

/** The §4.2 formula. Exported so the score can be unit-tested directly. */
export function scoreSeed(seed: Pick<AttentionSeed, "impact" | "urgency" | "confidence">): number {
  const impact = clamp01(seed.impact);
  const urgency = clamp01(seed.urgency);
  const confidence = clamp01(seed.confidence);
  const raw =
    100 *
    impact ** SCORE_EXPONENTS.impact *
    urgency ** SCORE_EXPONENTS.urgency *
    confidence ** SCORE_EXPONENTS.confidence;
  return Math.round(raw * 10) / 10;
}

/**
 * Urgency from time-to-catalyst: 1 at ≤24h, linear to 0 at 7d, flat default for
 * undated items. Computed at render from timestamps, never stored (§12 clock
 * skew). `marketOpen` freezes the sub-ramp for still-distant events overnight.
 */
export function computeUrgency(
  occursAt: string | null,
  now: number,
  marketOpen: boolean,
): number {
  if (!occursAt) return UNDATED_URGENCY;
  const at = Date.parse(occursAt);
  if (Number.isNaN(at)) return UNDATED_URGENCY;

  const hours = (at - now) / (60 * 60 * 1000);
  // A catalyst that already happened is no longer urgent to PREPARE for — it
  // is worth reviewing, not racing to. The old `hours <= 0 → 1` kept
  // yesterday's macro print at maximum urgency all weekend (audit DU-06).
  if (hours <= 0) return PAST_EVENT_URGENCY;
  if (hours <= URGENCY_RAMP_HOURS) return 1;
  if (hours >= URGENCY_ZERO_HOURS) return 0;

  const ramp = 1 - (hours - URGENCY_RAMP_HOURS) / (URGENCY_ZERO_HOURS - URGENCY_RAMP_HOURS);
  const base = clamp01(ramp);
  return marketOpen ? base : Math.min(base, MARKET_CLOSED_URGENCY_CEIL);
}

/* ------------------------------------------------------------------ */
/* Dedupe-key banding — how a story keeps its identity, and loses it   */
/* ------------------------------------------------------------------ */

/** A 5-pt bucket of a magnitude, e.g. 27% → "25-30". Material worsening = new band. */
function magnitudeBand(pct: number): string {
  const m = Math.abs(pct);
  const lo = Math.floor(m / 5) * 5;
  return `${lo}-${lo + 5}`;
}

/** A 10-pt bucket of a 0–100 score, e.g. 76 → "70". Conviction drift changes it. */
function scoreBand(score: number): string {
  return String(Math.floor(score / 10) * 10);
}

/** Normalizes a subject line into a story-key slug: "USD Cash" → "usd-cash". */
function storySlug(subject: string): string {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * When two kinds tell one story, the more EXECUTABLE one survives (audit
 * DU-03: the informationless "USD Cash concentration" threat outranked the
 * fully-simulated "Trim USD Cash" action it restated, so the queue's
 * spotlight never showed the rich decision card). Lower = survives.
 */
const STORY_KIND_PREFERENCE: Record<AttentionKind, number> = {
  action: 0,
  alert: 1,
  threat: 2,
  event: 3,
  signal: 4,
};

/* ------------------------------------------------------------------ */
/* Feeders — pure transforms of already-built digest slices            */
/* ------------------------------------------------------------------ */

/** symbol (upper) → portfolio weight as a 0–1 fraction. */
export type WeightBySymbol = Map<string, number>;

function weightOf(symbol: string | null, weights: WeightBySymbol): number {
  if (!symbol) return 0;
  return clamp01(weights.get(symbol.toUpperCase()) ?? 0);
}

/**
 * Confidence multiplier for observation age (audit F-22d): a same-day
 * observation carries full weight, the previous session (weekend-tolerant)
 * half, and anything older contributes nothing — it should already have been
 * filtered upstream, but a zero confidence sinks it regardless (geometric
 * score). Items with no observation time are live-engine output: full weight.
 */
export function observationDecay(observedAt: string | null | undefined, now: number): number {
  if (!observedAt) return 1;
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return 0;
  const ageDays = (now - t) / DAY;
  if (ageDays <= 1) return 1;
  if (ageDays <= 3) return 0.5;
  return 0;
}

/** Portfolio-engine decisions / alert queue → `action` seeds. */
export function seedsFromActions(actions: RecommendedAction[], now: number = Date.now()): AttentionSeed[] {
  return actions.map((a) => {
    const impact = a.decisionScore != null ? a.decisionScore / 100 : SEVERITY_IMPACT[a.severity];
    const band = a.decisionScore != null ? scoreBand(a.decisionScore) : a.severity;
    const decay = observationDecay(a.observedAt, now);
    // A discovery ("worth a look") is a research opportunity, not a corrective
    // action — on Today it wears the SIGNAL kind (idea semantics, the 30-day
    // dismissal rhythm of a passed-on idea), never the ACT-NOW chip. The
    // act / research / watch / informational distinction is the page's
    // hierarchy; letting an INVESTIGATE card impersonate an ACTION blurs it.
    const isDiscovery = a.action === "INVESTIGATE";
    return {
      id: `action:${a.id}`,
      dedupeKey: `action:${a.symbol ?? "portfolio"}:${band}`,
      kind: isDiscovery ? "signal" : "action",
      symbol: a.symbol,
      headline: a.title.slice(0, 60),
      rationale: a.reason,
      impact,
      urgency: UNDATED_URGENCY,
      confidence: (a.confidence ?? KIND_CONFIDENCE_DEFAULT.action) * decay,
      occursAt: null,
      observedAt: a.observedAt ?? null,
      primaryAction: {
        label: isDiscovery
          ? `Research ${a.symbol ?? "the candidate"}`
          : a.source === "decision"
            ? "Open decision"
            : "Review",
        href: isDiscovery && a.symbol
          ? `/research?symbol=${encodeURIComponent(a.symbol)}`
          : a.source === "decision"
            ? "/portfolio?tab=decisions"
            : a.href,
      },
      source: "actions",
      // A trim/REDUCE decision is the executable form of a concentration
      // threat; the shared story key lets the engine collapse the pair.
      storyKey:
        a.action === "REDUCE" && (a.subject ?? a.symbol)
          ? `concentration:${storySlug(a.subject ?? (a.symbol as string))}`
          : null,
      // The decision thesis rides along so dismissing this story on Today
      // writes the SAME memory the Decisions tab reads (decision-memory.ts) —
      // one considered "no", every surface.
      thesis: a.thesis ?? null,
    } satisfies AttentionSeed;
  });
}

/** Portfolio vulnerabilities → `threat` seeds, impact-weighted by measured %. */
export function seedsFromThreats(threats: ThreatItem[]): AttentionSeed[] {
  return threats.map((t) => {
    const impact =
      t.impactPct != null
        ? clamp01(Math.abs(t.impactPct) / THREAT_IMPACT_FULL_PCT)
        : SEVERITY_IMPACT[t.severity];
    const band = t.impactPct != null ? magnitudeBand(t.impactPct) : t.severity;
    // Strip a trailing "-<n>" index so the same category keeps a stable key.
    const stableId = t.id.replace(/-\d+$/, "");
    return {
      id: `threat:${t.id}`,
      dedupeKey: `threat:${stableId}:${band}`,
      kind: "threat",
      symbol: null,
      headline: t.title.slice(0, 60),
      rationale: t.detail,
      impact,
      urgency: UNDATED_URGENCY,
      confidence: KIND_CONFIDENCE_DEFAULT.threat,
      occursAt: null,
      primaryAction: { label: "Review threat", href: t.href },
      source: "threats",
      // "<subject> concentration" threats share a story with the trim action
      // that executes them (see seedsFromActions).
      storyKey:
        t.category === "concentration" && t.title.endsWith(" concentration")
          ? `concentration:${storySlug(t.title.slice(0, -" concentration".length))}`
          : null,
    } satisfies AttentionSeed;
  });
}

/** Triggered watchlist alerts → `alert` seeds. */
export function seedsFromAlerts(alerts: WatchlistAlert[], weights: WeightBySymbol): AttentionSeed[] {
  return alerts.map((a) => {
    // Portfolio-weighted exposure: a held name's book weight scaled so a 25%
    // position reads as full impact (see HELD_IMPACT_FULL_WEIGHT); a
    // tracked-but-unheld name has no exposure, so it gets a small flat floor.
    // Severity drives the dedupe band (resurfacing), not the impact number.
    const held = weightOf(a.symbol, weights);
    const impact = held > 0 ? Math.max(held / HELD_IMPACT_FULL_WEIGHT, UNHELD_IMPACT) : UNHELD_IMPACT;
    return {
      id: `alert:${a.symbol}:${a.type}`,
      dedupeKey: `alert:${a.symbol.toUpperCase()}:${a.type}:${a.severity}`,
      kind: "alert",
      symbol: a.symbol.toUpperCase(),
      headline: a.title.slice(0, 60),
      rationale: a.description,
      impact: clamp01(impact),
      urgency: UNDATED_URGENCY,
      confidence: KIND_CONFIDENCE_DEFAULT.alert,
      occursAt: null,
      primaryAction: { label: "Open watchlist", href: `/research?symbol=${encodeURIComponent(a.symbol)}` },
      source: "alerts",
    } satisfies AttentionSeed;
  });
}

/** Catalysts ≤ 7 days (earnings, ex-div) → `event` seeds, time-decayed. */
export function seedsFromEvents(
  events: UpcomingEventLite[],
  weights: WeightBySymbol,
  now: number,
  marketOpen: boolean,
): AttentionSeed[] {
  const horizon = now + URGENCY_ZERO_HOURS * 60 * 60 * 1000;
  return events
    .filter((e) => {
      const at = Date.parse(e.date);
      return !Number.isNaN(at) && at >= now - DAY && at <= horizon;
    })
    .map((e) => {
      const sym = e.symbol ? e.symbol.toUpperCase() : null;
      const held = weightOf(sym, weights);
      const impact = held > 0 ? Math.max(held / HELD_IMPACT_FULL_WEIGHT, UNHELD_IMPACT) : UNHELD_IMPACT;
      return {
        id: `event:${e.id}`,
        dedupeKey: `${sym ?? "market"}:${e.type}:${e.date.slice(0, 10)}`,
        kind: "event",
        symbol: sym,
        headline: `${sym ? `${sym} ` : ""}${e.name}`.slice(0, 60),
        rationale: `${e.type} ${e.date.slice(0, 10)}`,
        impact: clamp01(impact),
        urgency: computeUrgency(e.date, now, marketOpen),
        confidence: KIND_CONFIDENCE_DEFAULT.event,
        occursAt: e.date,
        primaryAction: { label: "Open calendar", href: "/calendar" },
        source: "events",
      } satisfies AttentionSeed;
    });
}

/** High-signal scanner hits → `signal` seeds, ranked by fit. */
export function seedsFromSignals(opportunities: OpportunitySnapshotItem[]): AttentionSeed[] {
  return opportunities.map((o) => ({
    id: `signal:${o.symbol}`,
    dedupeKey: `signal:${o.symbol.toUpperCase()}:${scoreBand(o.combinedScore)}`,
    kind: "signal",
    symbol: o.symbol.toUpperCase(),
    headline: `${o.symbol} fits your book`.slice(0, 60),
    rationale: o.fitSummary,
    impact: clamp01(o.combinedScore / 100),
    urgency: UNDATED_URGENCY,
    confidence: KIND_CONFIDENCE_DEFAULT.signal,
    occursAt: null,
    primaryAction: { label: "Open research", href: `/research?symbol=${encodeURIComponent(o.symbol)}` },
    source: "signals",
  } satisfies AttentionSeed));
}

/* ------------------------------------------------------------------ */
/* Dismissal expiry — the API and the engine agree on the deadline     */
/* ------------------------------------------------------------------ */

/**
 * When a dismissal of `kind` should lapse. Events lapse when their catalyst
 * passes (a dismissed earnings item is gone for good once earnings happen);
 * everything else uses its per-kind TTL. Used by the dismiss API to stamp
 * `expires_at`, so the deadline is computed once, here.
 */
export function dismissalExpiresAt(
  kind: AttentionKind,
  occursAt: string | null,
  now: number = Date.now(),
): number {
  if (kind === "event" && occursAt) {
    const at = Date.parse(occursAt);
    if (!Number.isNaN(at)) return at;
  }
  return now + KIND_TTL_MS[kind];
}

/* ------------------------------------------------------------------ */
/* Assembly — score, dedupe, filter dismissals, sort                   */
/* ------------------------------------------------------------------ */

/** A feeder as the engine consumes it: an id and a thunk that may throw. */
export interface AttentionFeeder {
  id: string;
  run: () => AttentionSeed[];
}

export interface BuildAttentionInput {
  feeders: AttentionFeeder[];
  dismissals: AttentionDismissal[];
  now?: number;
}

/**
 * The whole pipeline: run each feeder in isolation (one throwing is a degraded
 * footer, never a blank zone — §19.5), score, filter active dismissals, dedupe
 * by story key (keep the highest score, merge siblings' hrefs — §12), and sort
 * by score with the kind→symbol tie-break (§12).
 */
export function buildAttentionQueue(input: BuildAttentionInput): AttentionQueue {
  const now = input.now ?? Date.now();
  const degradedFeeders: string[] = [];

  // 1. Collect seeds, isolating feeder failures.
  const seeds: AttentionSeed[] = [];
  for (const feeder of input.feeders) {
    try {
      seeds.push(...feeder.run());
    } catch {
      degradedFeeders.push(feeder.id);
    }
  }

  // 2. Drop stories with an active (unexpired) dismissal. A dismissal of a
  // merged story stores the storyKey too, so the absorbed twin stays gone.
  // A `mute:symbol:<SYM>` row (audit AG-05) matches on the seed's SYMBOL, not
  // its key, so it keeps suppressing across dedupe-band rotation.
  const activeDismissals = new Set(
    input.dismissals.filter((d) => d.expiresAt > now).map((d) => d.dedupeKey),
  );
  const mutedSymbols = new Set(
    [...activeDismissals]
      .filter((k) => k.startsWith(MUTE_KEY_PREFIX))
      .map((k) => k.slice(MUTE_KEY_PREFIX.length)),
  );
  const live = seeds.filter(
    (s) =>
      !activeDismissals.has(s.dedupeKey) &&
      !(s.storyKey && activeDismissals.has(s.storyKey)) &&
      !(s.symbol && mutedSymbols.has(s.symbol.toUpperCase())),
  );

  // 3. Score.
  const scored: AttentionItem[] = live.map((s) => ({ ...s, score: scoreSeed(s) }));

  // 4. Dedupe by story key: keep the sibling with the NEWEST observation, not
  // the highest score — max-score kept whichever print was most extreme, which
  // for a decaying story is provably the oldest one (audit F-22d: a five-day-
  // old "-8.7%" outranked the fresher "-7.4%" of the same story). Items with
  // no observation time (live engine output) sort as newest. Score breaks ties.
  const observedMs = (i: AttentionItem) => {
    if (!i.observedAt) return Number.POSITIVE_INFINITY;
    const t = Date.parse(i.observedAt);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const byKey = new Map<string, AttentionItem>();
  for (const item of scored) {
    const existing = byKey.get(item.dedupeKey);
    if (!existing) {
      byKey.set(item.dedupeKey, item);
      continue;
    }
    const a = observedMs(item);
    const b = observedMs(existing);
    const keepItem = a !== b ? a > b : item.score >= existing.score;
    const [keep, drop] = keepItem ? [item, existing] : [existing, item];
    const merged = keep.mergedHrefs ?? [];
    if (drop.primaryAction.href !== keep.primaryAction.href) merged.push(drop.primaryAction);
    keep.mergedHrefs = merged;
    byKey.set(item.dedupeKey, keep);
  }

  // 4b. Cross-kind story collapse (audit DU-03): when items of different
  // kinds share a storyKey, the most EXECUTABLE kind survives and absorbs the
  // others' links. Without this, a threat restating an action outranked the
  // action itself (the geometric score rewards the threat's constant inputs),
  // and the queue's spotlight showed the restatement instead of the decision.
  const byStory = new Map<string, AttentionItem>();
  const storyless: AttentionItem[] = [];
  for (const item of byKey.values()) {
    if (!item.storyKey) {
      storyless.push(item);
      continue;
    }
    const existing = byStory.get(item.storyKey);
    if (!existing) {
      byStory.set(item.storyKey, item);
      continue;
    }
    const keepItem = STORY_KIND_PREFERENCE[item.kind] < STORY_KIND_PREFERENCE[existing.kind];
    const [keep, drop] = keepItem ? [item, existing] : [existing, item];
    const merged = keep.mergedHrefs ?? [];
    if (drop.primaryAction.href !== keep.primaryAction.href) merged.push(drop.primaryAction);
    keep.mergedHrefs = merged;
    // The surviving item inherits the story's strongest score, so collapsing
    // the pair never DEMOTES the story below where the louder twin ranked.
    keep.score = Math.max(keep.score, drop.score);
    byStory.set(item.storyKey, keep);
  }

  // 5. Sort: score desc, then kind precedence, then symbol.
  const items = [...storyless, ...byStory.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (KIND_PRECEDENCE[a.kind] !== KIND_PRECEDENCE[b.kind])
      return KIND_PRECEDENCE[a.kind] - KIND_PRECEDENCE[b.kind];
    return (a.symbol ?? "").localeCompare(b.symbol ?? "");
  });

  const status = degradedFeeders.length > 0 ? "degraded" : items.length > 0 ? "ok" : "empty";

  return {
    status,
    items,
    openCount: items.length,
    degradedFeeders,
    reviewedAt: new Date(now).toISOString(),
  };
}
