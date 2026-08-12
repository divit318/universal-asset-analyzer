/**
 * Portfolio Intelligence — the portfolio critic.
 *
 * The deterministic engines each watch ONE dimension (allocation, risk, health,
 * attribution). This module watches the portfolio as a SYSTEM: what the wrappers
 * hide (an NVIDIA position spread across three ETFs), what the ticker count
 * overstates (ten securities, three economic bets), and what the investor's own
 * trading pattern may indicate about their blind spots.
 *
 * Design contract, same as lib/portfolio/thesis.ts: every FINDING is computed in
 * code from measured data — the AI never detects anything. It is handed the
 * settled findings and writes only the executive summary and the one observation
 * that spans several findings. A detector that cannot compute its evidence
 * reliably emits nothing rather than guessing (see `IntelligenceCoverage` for how
 * the gaps are disclosed instead of papered over).
 */

import type { Holding, PortfolioAssetClass } from "../model/types";
import type { PortfolioAllocation } from "../engines/allocation";
import type { UniversalRisk } from "../engines/risk";
import type { HealthScore } from "../engines/health";
import type { ReturnAttribution } from "../engines/attribution";
import type { FundHolding, FundSectorWeight } from "../../types";

/* ────────────────────────────── Input ────────────────────────────── */

/** What we know about the inside of one held fund. Absent = opaque wrapper. */
export interface FundLookThrough {
  symbol: string;
  /** Ten largest constituents, weight as % OF THE FUND. A lower bound on overlap. */
  topHoldings: FundHolding[];
  /** Combined weight of those ten, % of the fund. */
  top10Pct: number | null;
  /** Full sector distribution (% of fund), largest first. Equity funds only. */
  sectorWeights: FundSectorWeight[] | null;
  /** Morningstar category — two funds in one category are candidates for one job. */
  category: string | null;
  equityWeightPct: number | null;
}

export interface IntelligenceInput {
  holdings: Holding[];
  totalValue: number;
  allocation: PortfolioAllocation;
  risk: UniversalRisk;
  health: HealthScore;
  attribution: ReturnAttribution | null;
  baseCurrency: string;
  /** Upper-cased fund symbol → constituents. A held fund missing here is opaque. */
  funds: Map<string, FundLookThrough>;
}

/* ────────────────────────────── Findings ────────────────────────────── */

export type FindingSeverity = "high" | "medium" | "low";

/**
 * Every evidence line declares what kind of claim it is, and the UI renders the
 * label. "observed" came straight from a provider or the ledger; "derived" was
 * computed here from observed inputs. AI interpretation never appears in
 * evidence at all — it is confined to the executive summary, which is labelled
 * as interpretation wholesale.
 */
export interface EvidenceLine {
  basis: "observed" | "derived";
  text: string;
}

export interface IntelligenceFinding {
  /**
   * Stable identity for the what-changed diff: `detector:subject`. A finding
   * that fires on the same subject across runs is the SAME finding, whatever
   * its wording, so a re-rank or copy tweak never reads as "new finding".
   */
  id: string;
  detector: string;
  severity: FindingSeverity;
  /** Short and sharp — "You own more NVDA than you think", not a category name. */
  title: string;
  /** One sentence: what was detected, with its key figure. */
  headline: string;
  evidence: EvidenceLine[];
  whyItMatters: string;
  /**
   * The behavioural pattern this MAY indicate. Always hedged ("this pattern may
   * indicate…") — the engine sees the portfolio, not the investor's mind.
   */
  blindSpot?: string;
  /** Data limitation the reader must know: e.g. look-through covers top-10 only. */
  caveat?: string;
  /** % of portfolio value implicated — context chip in the UI. */
  weightPct?: number;
  /** Deterministic ordering key (severity band × magnitude). Never displayed. */
  rank: number;
}

/* ────────────────────────────── What changed ────────────────────────────── */

export interface HoldingResize {
  label: string;
  fromPct: number;
  toPct: number;
}

/**
 * The diff against the previous PERSISTED run (not the previous page load):
 * an unchanged portfolio keeps its baseline, so "since" always points at the
 * last time something was actually different.
 */
export interface WhatChanged {
  /** ISO timestamp of the run being compared against; null on the first run ever. */
  since: string | null;
  changed: boolean;
  holdingsAdded: string[];
  holdingsRemoved: string[];
  resized: HoldingResize[];
  /** Titles of findings that did not exist in the previous run. */
  newFindings: string[];
  /** Titles of previous findings no longer detected. */
  resolvedFindings: string[];
}

/* ────────────────────────────── Coverage ────────────────────────────── */

export interface IntelligenceCoverage {
  /** Held funds whose constituents Yahoo reports (look-through possible). */
  fundsAnalyzed: number;
  /** Held funds with NO constituent data — excluded from look-through, disclosed. */
  fundsOpaque: string[];
  /** % of the portfolio's fund-held value that look-through could see into. */
  lookThroughPct: number;
}

/* ────────────────────────────── Output ────────────────────────────── */

export interface PortfolioIntelligence {
  /**
   * The answer to "what are you missing?" — written by the AI from the settled
   * findings, or assembled deterministically when the AI is unavailable.
   */
  executiveSummary: string;
  /**
   * One observation that only exists ACROSS findings — the model's genuine job.
   * Empty when it had nothing non-generic to say; empty is a real answer.
   */
  crossCurrents: string;
  /** Ranked, most consequential first. Empty = genuinely nothing detected. */
  findings: IntelligenceFinding[];
  /** True when no medium/high finding fired — the honest "you're fine" state. */
  allClear: boolean;
  whatChanged: WhatChanged;
  coverage: IntelligenceCoverage;
  generatedAt: string;
  /**
   * "ai": summary written by the model. "fallback": AI unavailable, summary is
   * deterministic. "measured": no AI call was warranted (nothing material to
   * synthesize) — NOT a failure, so the UI must not render an offline notice.
   */
  source: "ai" | "fallback" | "measured";
}

/* ────────────────────────────── Shared helpers ────────────────────────────── */

/** The display label every cross-run structure keys on. */
export function holdingLabel(h: Holding): string {
  return (h.symbol ?? h.name).toUpperCase();
}

/** Asset classes that are fund wrappers — candidates for look-through. */
export const FUND_CLASSES: PortfolioAssetClass[] = ["etf", "bond", "commodity", "reit"];

export function isFundWrapper(h: Holding): boolean {
  return h.symbol != null && FUND_CLASSES.includes(h.assetClass);
}
