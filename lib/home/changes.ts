/**
 * Change detection — the "since your last visit" engine.
 *
 * Two pure halves:
 *
 *   1. `captureFingerprint(digest)` compresses a built digest into the compact,
 *      versioned state the diff needs: scores, story keys, opportunity ranks,
 *      threat severities, watchlist buckets. Every number in the fingerprint is
 *      *read* from a slice an engine already computed — capturing adds no
 *      scoring of its own.
 *
 *   2. `diffFingerprints(prev, next)` turns two fingerprints into ranked,
 *      typed `HomeChange`s with materiality thresholds. Sub-threshold movement
 *      is noise and produces nothing: an honest empty diff ("nothing material
 *      changed") is a real, useful answer, not a failure to find content.
 *
 * The baseline discipline lives in `shouldPromoteBaseline`: "last visit" means
 * the end of the previous *session*, not the previous request. A digest refresh
 * 30 seconds after the last one is the same sitting; only a gap of
 * `VISIT_GAP_MS` or more starts a new visit and freezes the old state as the
 * new comparison point. Persistence (the two fingerprint slots in SQLite) is
 * the digest's job — this module never touches I/O.
 *
 * Pure — unit-tested in tests/home-changes.test.ts.
 */

import type {
  AttentionKind,
  ChangeFeed,
  HomeChange,
  HomeChangeTone,
  HomeDigest,
} from "./contracts";

export const FINGERPRINT_VERSION = 1;

/** A digest build this long after the previous one starts a new "visit". */
export const VISIT_GAP_MS = 45 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Materiality thresholds — all tunable in one place                   */
/* ------------------------------------------------------------------ */

/** Health-score moves under this many points are jitter, not news. */
export const HEALTH_MATERIAL_PTS = 2;
/** Opportunity-fit moves under this many points don't resurface an idea. */
export const OPP_SCORE_MATERIAL = 5;
/** Drift must worsen by at least this many pp to be re-raised as a change. */
export const DRIFT_MATERIAL_PP = 2;
/** New attention stories below this score are visible in the queue anyway. */
export const ATTENTION_NEW_MIN_SCORE = 50;
/** Individually-listed caps; anything beyond folds into an aggregate line. */
const MAX_NEW_ATTENTION_LISTED = 4;
const MAX_NEW_OPPORTUNITIES_LISTED = 3;

const SEVERITY_RANK: Record<"high" | "medium" | "low", number> = { high: 2, medium: 1, low: 0 };

/* ------------------------------------------------------------------ */
/* Fingerprint                                                         */
/* ------------------------------------------------------------------ */

export interface HomeFingerprint {
  version: number;
  takenAt: string;
  healthScore: number | null;
  healthGrade: string | null;
  regimeTrend: string | null;
  sentimentLabel: string | null;
  sentimentScore: number | null;
  attention: { key: string; kind: AttentionKind; score: number; headline: string; symbol: string | null }[];
  opportunities: { symbol: string; score: number; tier: string }[];
  threats: { key: string; severity: "high" | "medium" | "low"; impactPct: number | null; title: string }[];
  watchlistBuckets: { buy: string[]; nearBuy: string[]; highRisk: string[] };
  largestDrift: { label: string; driftPct: number } | null;
}

/**
 * The slices the fingerprint reads. A Pick rather than the whole digest so the
 * builder can capture *before* the change feed itself exists (the feed is part
 * of the digest, and diffing it against itself would be circular).
 */
export type FingerprintSource = Pick<
  HomeDigest,
  "generatedAt" | "attention" | "marketIntelligence" | "portfolioPulse" | "threats" | "opportunityFeed" | "watchlistIntelligence"
>;

/** The digest → the compact state the diff compares. Pure projection. */
export function captureFingerprint(digest: FingerprintSource, takenAt: string = digest.generatedAt): HomeFingerprint {
  const buckets = digest.watchlistIntelligence.buckets;
  const bucket = (id: string) => buckets.find((b) => b.id === id)?.symbols.map((s) => s.toUpperCase()) ?? [];

  return {
    version: FINGERPRINT_VERSION,
    takenAt,
    healthScore: digest.portfolioPulse.healthScore,
    healthGrade: digest.portfolioPulse.healthGrade,
    regimeTrend: digest.marketIntelligence.regime?.trend ?? null,
    sentimentLabel: digest.marketIntelligence.sentiment?.label ?? null,
    sentimentScore: digest.marketIntelligence.sentiment?.score ?? null,
    attention: digest.attention.items.map((i) => ({
      key: i.dedupeKey,
      kind: i.kind,
      score: i.score,
      headline: i.headline,
      symbol: i.symbol,
    })),
    opportunities: digest.opportunityFeed.opportunities.map((o) => ({
      symbol: o.symbol.toUpperCase(),
      score: o.combinedScore,
      tier: o.fitTier,
    })),
    threats: digest.threats.threats.map((t) => ({
      // Strip a trailing index the same way the attention feeder does, so a
      // category keeps a stable identity across builds.
      key: t.id.replace(/-\d+$/, ""),
      severity: t.severity,
      impactPct: t.impactPct,
      title: t.title,
    })),
    watchlistBuckets: { buy: bucket("buy"), nearBuy: bucket("near-buy"), highRisk: bucket("high-risk") },
    largestDrift: digest.portfolioPulse.largestDrift,
  };
}

/**
 * Coerce a stored (JSON-parsed) blob back into a fingerprint. A corrupt or
 * version-mismatched blob yields null — the diff then reports first-visit
 * rather than diffing against garbage.
 */
export function parseFingerprint(raw: unknown): HomeFingerprint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const fp = raw as Partial<HomeFingerprint>;
  if (fp.version !== FINGERPRINT_VERSION || typeof fp.takenAt !== "string") return null;
  if (!Array.isArray(fp.attention) || !Array.isArray(fp.opportunities) || !Array.isArray(fp.threats)) return null;
  return fp as HomeFingerprint;
}

/** True when enough time has passed since the last build to call it a new visit. */
export function shouldPromoteBaseline(lastBuildAtMs: number, nowMs: number): boolean {
  return nowMs - lastBuildAtMs >= VISIT_GAP_MS;
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

const researchHref = (symbol: string) => `/research?symbol=${encodeURIComponent(symbol)}`;

function change(
  kind: HomeChange["kind"],
  tone: HomeChangeTone,
  id: string,
  headline: string,
  detail: string,
  magnitude: number,
  symbol: string | null = null,
  href: string | null = null,
): HomeChange {
  return { id, kind, tone, headline: headline.slice(0, 70), detail, symbol, href, magnitude };
}

/**
 * Compare the previous visit's state against the current one and produce
 * ranked changes. Every `detail` states the before → after, so the delta is
 * auditable rather than asserted.
 */
export function diffFingerprints(prev: HomeFingerprint, next: HomeFingerprint): HomeChange[] {
  const out: HomeChange[] = [];

  /* ---- portfolio health ---- */
  if (prev.healthScore != null && next.healthScore != null) {
    const delta = next.healthScore - prev.healthScore;
    if (Math.abs(delta) >= HEALTH_MATERIAL_PTS) {
      const up = delta > 0;
      out.push(change(
        "health",
        up ? "improved" : "worsened",
        "health",
        `Portfolio health ${up ? "rose" : "fell"} to ${next.healthGrade ?? "?"} (${next.healthScore})`,
        `Was ${prev.healthScore}${prev.healthGrade ? ` (${prev.healthGrade})` : ""} at your last visit — a ${up ? "+" : ""}${delta}-point move.`,
        Math.abs(delta) * 4,
        null,
        "/portfolio",
      ));
    }
  }

  /* ---- market regime ---- */
  if (prev.regimeTrend && next.regimeTrend && prev.regimeTrend !== next.regimeTrend) {
    out.push(change(
      "regime",
      "neutral",
      "regime",
      `Market regime shifted to ${next.regimeTrend}`,
      `Was "${prev.regimeTrend}" at your last visit. Regime drives the brief's recommendations — re-read them in the new context.`,
      30,
    ));
  }

  /* ---- sentiment band ---- */
  if (prev.sentimentLabel && next.sentimentLabel && prev.sentimentLabel !== next.sentimentLabel) {
    out.push(change(
      "sentiment",
      "neutral",
      "sentiment",
      `Sentiment moved to ${next.sentimentLabel}`,
      `The UAA sentiment gauge moved from ${prev.sentimentLabel} (${prev.sentimentScore ?? "?"}) to ${next.sentimentLabel} (${next.sentimentScore ?? "?"}).`,
      12,
    ));
  }

  /* ---- threats: new and escalated ---- */
  const prevThreats = new Map(prev.threats.map((t) => [t.key, t]));
  for (const t of next.threats) {
    const was = prevThreats.get(t.key);
    if (!was) {
      out.push(change(
        "threat-new",
        "worsened",
        `threat-new:${t.key}`,
        `New risk: ${t.title}`,
        t.impactPct != null
          ? `A ${t.severity}-severity vulnerability measuring ${Math.abs(t.impactPct).toFixed(1)}% of portfolio value at risk appeared since your last visit.`
          : `A ${t.severity}-severity vulnerability appeared since your last visit.`,
        40 + (t.impactPct != null ? Math.abs(t.impactPct) : SEVERITY_RANK[t.severity] * 8),
        null,
        "/portfolio",
      ));
    } else if (SEVERITY_RANK[t.severity] > SEVERITY_RANK[was.severity]) {
      out.push(change(
        "threat-escalated",
        "worsened",
        `threat-esc:${t.key}`,
        `Risk escalated: ${t.title}`,
        `Severity moved from ${was.severity} to ${t.severity} since your last visit.`,
        35 + SEVERITY_RANK[t.severity] * 8,
        null,
        "/portfolio",
      ));
    }
  }

  /* ---- attention stories: new and resolved ---- */
  const prevKeys = new Set(prev.attention.map((a) => a.key));
  const nextKeys = new Set(next.attention.map((a) => a.key));

  const fresh = next.attention
    .filter((a) => !prevKeys.has(a.key) && a.score >= ATTENTION_NEW_MIN_SCORE)
    // Threats already get their own richer change rows above.
    .filter((a) => a.kind !== "threat")
    .sort((a, b) => b.score - a.score);

  for (const a of fresh.slice(0, MAX_NEW_ATTENTION_LISTED)) {
    out.push(change(
      "attention-new",
      "new",
      `attn-new:${a.key}`,
      `New in your queue: ${a.headline}`,
      `A ${a.kind} scoring ${Math.round(a.score)} entered the Attention Queue since your last visit.`,
      a.score * 0.5,
      a.symbol,
      a.symbol ? researchHref(a.symbol) : null,
    ));
  }
  if (fresh.length > MAX_NEW_ATTENTION_LISTED) {
    const extra = fresh.length - MAX_NEW_ATTENTION_LISTED;
    out.push(change(
      "attention-new",
      "new",
      "attn-new:more",
      `${extra} more new item${extra === 1 ? "" : "s"} in your queue`,
      `${fresh.length} attention items are new since your last visit; the highest-scoring are listed above.`,
      10,
    ));
  }

  const resolved = prev.attention.filter((a) => !nextKeys.has(a.key)).length;
  if (resolved > 0) {
    out.push(change(
      "attention-resolved",
      "improved",
      "attn-resolved",
      `${resolved} queue item${resolved === 1 ? "" : "s"} cleared`,
      `${resolved} of the ${prev.attention.length} attention item${prev.attention.length === 1 ? "" : "s"} from your last visit no longer need${resolved === 1 ? "s" : ""} a decision.`,
      8,
    ));
  }

  /* ---- opportunities: new ideas and material re-scores ---- */
  const prevOpps = new Map(prev.opportunities.map((o) => [o.symbol, o]));
  const freshOpps = next.opportunities.filter((o) => !prevOpps.has(o.symbol));
  for (const o of freshOpps.slice(0, MAX_NEW_OPPORTUNITIES_LISTED)) {
    out.push(change(
      "opportunity-new",
      "new",
      `opp-new:${o.symbol}`,
      `New idea: ${o.symbol} fits your book (${Math.round(o.score)})`,
      `${o.symbol} entered the Radar as a ${o.tier}-fit idea since your last visit.`,
      o.score * 0.4,
      o.symbol,
      researchHref(o.symbol),
    ));
  }
  for (const o of next.opportunities) {
    const was = prevOpps.get(o.symbol);
    if (!was) continue;
    const delta = o.score - was.score;
    if (Math.abs(delta) >= OPP_SCORE_MATERIAL) {
      const up = delta > 0;
      out.push(change(
        "opportunity-score",
        up ? "improved" : "worsened",
        `opp-score:${o.symbol}`,
        `${o.symbol} fit ${up ? "rose" : "fell"} ${Math.round(was.score)} → ${Math.round(o.score)}`,
        `The Scanner's fit score for ${o.symbol} moved ${up ? "+" : ""}${Math.round(delta)} points since your last visit.`,
        Math.abs(delta) * 1.5,
        o.symbol,
        researchHref(o.symbol),
      ));
    }
  }

  /* ---- watchlist: names entering the buy zone ---- */
  const prevBuy = new Set(prev.watchlistBuckets.buy);
  for (const sym of next.watchlistBuckets.buy) {
    if (!prevBuy.has(sym)) {
      out.push(change(
        "watchlist-move",
        "new",
        `wl-buy:${sym}`,
        `${sym} moved into your Buy zone`,
        `${sym} crossed into the watchlist's buy bucket since your last visit.`,
        22,
        sym,
        researchHref(sym),
      ));
    }
  }

  /* ---- allocation drift ---- */
  const pd = prev.largestDrift;
  const nd = next.largestDrift;
  if (nd && (!pd || pd.label !== nd.label || Math.abs(nd.driftPct) - Math.abs(pd.driftPct) >= DRIFT_MATERIAL_PP)) {
    // Only a NEW worst-offender or a materially worse one is a change; the same
    // drift sitting still is state, and the Book already shows state.
    if (!pd || pd.label !== nd.label || Math.abs(nd.driftPct) > Math.abs(pd.driftPct)) {
      out.push(change(
        "drift",
        "worsened",
        "drift",
        `Allocation drift: ${nd.label} ${nd.driftPct > 0 ? "+" : ""}${nd.driftPct.toFixed(1)}pp`,
        pd && pd.label === nd.label
          ? `${nd.label} drifted from ${pd.driftPct > 0 ? "+" : ""}${pd.driftPct.toFixed(1)}pp to ${nd.driftPct > 0 ? "+" : ""}${nd.driftPct.toFixed(1)}pp off target since your last visit.`
          : `${nd.label} is now the largest deviation from your target allocation.`,
        18 + Math.abs(nd.driftPct),
        null,
        "/portfolio?tab=decisions",
      ));
    }
  }

  return out.sort((a, b) => b.magnitude - a.magnitude);
}

/* ------------------------------------------------------------------ */
/* Feed assembly                                                       */
/* ------------------------------------------------------------------ */

/** Wrap a diff (or its absence) in the slice contract the UI consumes. */
export function buildChangeFeed(baseline: HomeFingerprint | null, current: HomeFingerprint): ChangeFeed {
  if (!baseline) {
    return { status: "ok", baselineAt: null, firstVisit: true, changes: [] };
  }
  return {
    status: "ok",
    baselineAt: baseline.takenAt,
    firstVisit: false,
    changes: diffFingerprints(baseline, current),
  };
}
