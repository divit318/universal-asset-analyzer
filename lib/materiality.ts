/**
 * Materiality lens — the single judgment function behind the "N flagged"
 * control on /research and /portfolio.
 *
 * Every item the lens can flag is routed through `isMaterial(item, context)`.
 * The UI never re-derives "is this worth attention" locally: pages build a
 * list of MaterialityItems from data they already fetched, map them through
 * this function once (memoised), and the lens is pure presentation on top of
 * the verdicts. That is what keeps the count in the header, the faded/kept
 * state of each section, and the hover reason from ever disagreeing.
 *
 * Pure and client-safe: no db, no fetch, no Date.now() (callers pass `now`),
 * imports only the canonical recommendation bands. Deterministic by
 * construction so every branch is unit-testable.
 *
 * A verdict has THREE states, not two:
 *   - material            — keep at full contrast, show the reason
 *   - not material        — fade to the muted token while the lens is on
 *   - not APPLICABLE      — render as "not applicable" and NEVER fade.
 *     A bank with a null P/E is not "boring", it is unscoreable on that
 *     axis (composite dims return null by design), and fading it would
 *     present missing data as examined-and-fine. `applicable: false` is
 *     how the renderer tells those apart.
 */

import { scoreToRecommendation, RECOMMENDATION_LABEL } from "./recommendation";

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A metric framed against its peer group's dispersion by
 * lib/screener/universe-stats.ts. `percentile` is peer-group-relative
 * (100 = best), `peerGroupSize` is carried so the verdict can refuse to
 * claim an extreme off a 3-name group — the same rule universe-stats
 * documents for its own consumers.
 */
export interface DimensionItem {
  kind: "dimension";
  /** Human label, e.g. "FCF yield". */
  label: string;
  /** Peer-group percentile, 0-100, 100 = best. Null = metric unavailable. */
  percentile: number | null;
  /** Peer group label, e.g. "Financials". Null when unknown. */
  peerGroup: string | null;
  peerGroupSize: number | null;
}

/** A risk item from the research decision engine (lib/scoring.ts RiskItem). */
export interface RiskMaterialityItem {
  kind: "risk";
  category: string;
  level: "low" | "medium" | "high";
  detail?: string;
}

/** A dataset's freshness, from the as-of timestamps the page already renders. */
export interface FreshnessItem {
  kind: "freshness";
  /** What the data is, e.g. "Fundamentals", "SEC filings". */
  label: string;
  /** Epoch ms or ISO string. Null = as-of unknown. */
  asOf: number | string | null;
  /** The refresh window the platform registry promises for this dataset. */
  ttlHours: number;
}

/** Something that happened to this subject after the user's previous visit. */
export interface ChangeItem {
  kind: "change";
  label: string;
  /** ISO timestamp of the event. */
  at: string;
}

/** A concentration breach the portfolio allocation engine already computed. */
export interface ConcentrationItem {
  kind: "concentration";
  label: string;
  pct: number;
  severity: "high" | "medium";
  message: string;
}

/** A holding whose class score may have crossed a recommendation tier. */
export interface TierCrossingItem {
  kind: "tierCrossing";
  symbol: string;
  /** Current 0-100 score. Null = the class has no honest basis to score it. */
  currentScore: number | null;
}

export type MaterialityItem =
  | DimensionItem
  | RiskMaterialityItem
  | FreshnessItem
  | ChangeItem
  | ConcentrationItem
  | TierCrossingItem;

/* -------------------------------------------------------------------------- */
/* Context & verdict                                                           */
/* -------------------------------------------------------------------------- */

export interface MaterialityContext {
  /** Epoch ms "now" for freshness checks. Injected for determinism. */
  now: number;
  /**
   * Peer-percentile band outside which a dimension is material. The band is a
   * lens parameter over universe-stats percentiles — there are deliberately no
   * per-metric cutoffs here.
   */
  dimensionBand?: { low: number; high: number };
  /** Smallest peer group a percentile claim is allowed to stand on. */
  minPeerGroup?: number;
  /**
   * When the user last looked at this subject (ISO). Null/undefined = first
   * visit, and every `change` item is reported not-applicable rather than the
   * whole page lighting up.
   */
  priorVisitAt?: string | null;
  /**
   * Per-symbol scores captured at the previous visit. Null/undefined = no
   * baseline yet, and every `tierCrossing` item is not-applicable.
   */
  priorScores?: Record<string, number | null> | null;
}

export interface MaterialityVerdict {
  material: boolean;
  /** False = "not applicable": render as such, never fade as boring. */
  applicable: boolean;
  reason: string;
}

const DEFAULT_BAND = { low: 10, high: 90 };
const DEFAULT_MIN_PEER_GROUP = 8;

const notApplicable = (reason: string): MaterialityVerdict => ({ material: false, applicable: false, reason });
const quiet = (reason: string): MaterialityVerdict => ({ material: false, applicable: true, reason });
const flagged = (reason: string): MaterialityVerdict => ({ material: true, applicable: true, reason });

/* -------------------------------------------------------------------------- */
/* The one function                                                            */
/* -------------------------------------------------------------------------- */

export function isMaterial(item: MaterialityItem, ctx: MaterialityContext): MaterialityVerdict {
  switch (item.kind) {
    case "dimension": {
      if (item.percentile == null) {
        return notApplicable(`${item.label}: not applicable — no value for this name`);
      }
      const minGroup = ctx.minPeerGroup ?? DEFAULT_MIN_PEER_GROUP;
      if (item.peerGroupSize != null && item.peerGroupSize < minGroup) {
        return notApplicable(
          `${item.label}: peer group${item.peerGroup ? ` (${item.peerGroup})` : ""} has only ${item.peerGroupSize} names — too few to frame dispersion`,
        );
      }
      const band = ctx.dimensionBand ?? DEFAULT_BAND;
      const group = item.peerGroup ?? "its peer group";
      const pctl = Math.round(item.percentile);
      if (item.percentile <= band.low) {
        return flagged(`${item.label}: bottom of ${group}'s range (${pctl}th percentile)`);
      }
      if (item.percentile >= band.high) {
        return flagged(`${item.label}: top of ${group}'s range (${pctl}th percentile)`);
      }
      return quiet(`${item.label}: within ${group}'s normal range (${pctl}th percentile)`);
    }

    case "risk": {
      if (item.level === "high") {
        return flagged(`High risk — ${item.category}${item.detail ? `: ${item.detail}` : ""}`);
      }
      return quiet(`${item.category} risk is ${item.level}`);
    }

    case "freshness": {
      if (item.asOf == null) return notApplicable(`${item.label}: as-of unknown`);
      const asOfMs = typeof item.asOf === "number" ? item.asOf : Date.parse(item.asOf);
      if (!Number.isFinite(asOfMs)) return notApplicable(`${item.label}: as-of unknown`);
      const ageMs = ctx.now - asOfMs;
      const ttlMs = item.ttlHours * 3_600_000;
      if (ageMs > ttlMs) {
        return flagged(`${item.label}: stale — updated ${formatAge(ageMs)} ago, expected within ${formatAge(ttlMs)}`);
      }
      return quiet(`${item.label}: fresh (updated ${formatAge(Math.max(0, ageMs))} ago)`);
    }

    case "change": {
      if (!ctx.priorVisitAt) {
        return notApplicable("First visit — no earlier look to compare against");
      }
      if (item.at > ctx.priorVisitAt) {
        return flagged(`New since your last visit: ${item.label}`);
      }
      return quiet(`${item.label} — already seen`);
    }

    case "concentration":
      // The allocation engine only emits a finding when a threshold is
      // actually breached, so a finding's existence IS the materiality —
      // severity only shades the reason.
      return flagged(`${item.severity === "high" ? "High" : "Elevated"} concentration — ${item.message}`);

    case "tierCrossing": {
      if (ctx.priorScores == null) {
        return notApplicable("First visit — no baseline scores to compare against");
      }
      if (item.currentScore == null) {
        return notApplicable(`${item.symbol}: no current score — this asset class has no honest basis to score it`);
      }
      const prior = ctx.priorScores[item.symbol];
      if (prior == null) {
        return notApplicable(`${item.symbol}: no baseline score from your last visit`);
      }
      const prevTier = scoreToRecommendation(prior);
      const currTier = scoreToRecommendation(item.currentScore);
      if (prevTier !== currTier) {
        return flagged(
          `${item.symbol}: crossed a recommendation tier since your last visit — ${RECOMMENDATION_LABEL[prevTier]} (${Math.round(prior)}) → ${RECOMMENDATION_LABEL[currTier]} (${Math.round(item.currentScore)})`,
        );
      }
      return quiet(`${item.symbol}: still ${RECOMMENDATION_LABEL[currTier]} (${Math.round(prior)} → ${Math.round(item.currentScore)})`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers for the lens UI                                                     */
/* -------------------------------------------------------------------------- */

export function materialCount(verdicts: Iterable<MaterialityVerdict>): number {
  let n = 0;
  for (const v of verdicts) if (v.material) n++;
  return n;
}

/**
 * Collapse a group of verdicts into one section-level verdict for a fade
 * wrapper: a material verdict wins (and contributes its reason), else the
 * first applicable quiet one, else whatever is there. Undefined = the group
 * is empty and the section simply fades as within-range.
 */
export function pickVerdict(verdicts: (MaterialityVerdict | null | undefined)[]): MaterialityVerdict | undefined {
  const real = verdicts.filter((v): v is MaterialityVerdict => v != null);
  return real.find((v) => v.material) ?? real.find((v) => v.applicable) ?? real[0];
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
