/**
 * Simulator — AI-generated hypothetical portfolios.
 *
 * A Simulation is a *specification*, not a ledger: it stores the investor
 * profile gathered at intake plus the list of hypothetical holdings (real
 * tickers, real share counts). Everything analytical — valuation, allocation,
 * health, risk, stress tests — is recomputed live through the same engines the
 * real portfolio uses (lib/portfolio/engines/*), never persisted, so a saved
 * simulation can never show a stale price or a health score computed under a
 * different formula than the one currently shipping. Only headline numbers are
 * denormalized (for the list view) and refreshed on every evaluation.
 */

import type { Objective } from "@/lib/portfolio/engines/optimize";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";
import type { SimPreferences } from "./preferences";

export type SimulationStatus = "draft" | "complete" | "promoted";

export type SimHorizon = "short" | "medium" | "long";

export type SimRole = "standalone" | "complement";

/** One AI follow-up exchange from the intake chat (Step B). */
export interface SimFollowUp {
  question: string;
  /** null = the user skipped; `assumption` then records the stated default. */
  answer: string | null;
  assumption: string | null;
  /**
   * The choices the user was offered, when the question was multiple-choice.
   *
   * Persisted rather than recomputed because a follow-up is a record of an
   * exchange that happened: the options were the model's, for that turn, and a
   * later prompt revision must not silently rewrite what the user was actually
   * asked. Optional so rows written before follow-ups had options still parse.
   */
  options?: string[];
}

/** The investor mandate the portfolio is generated against. */
export interface SimProfile {
  /** Investable cash in `currency`. */
  cash: number;
  currency: string;
  horizon: SimHorizon;
  /** Exact target date, when the user gave one instead of a bucket. */
  targetDate: string | null;
  /** Shares the Optimize tab's taxonomy so scoring/targets can be reused. */
  objective: Objective;
  /** 1 (conservative) … 10 (aggressive). */
  riskAppetite: number;
  /** Max acceptable drawdown, derived from riskAppetite but user-editable. */
  maxDrawdownPct: number;
  role: SimRole;
  /** What this book is meant to complement, when role = "complement". */
  complementRef: { kind: "real" | "simulation"; id: string } | null;
  /**
   * Answers to the fixed multiple-choice questions (see ./preferences.ts).
   *
   * These were previously not asked at all — the AI interview discovered
   * whichever of them it happened to think of, one open-ended question at a
   * time. A missing topic here means skipped, and the documented default applies.
   */
  preferences: SimPreferences;
  /**
   * The AI interview transcript. Now exception handling only: `profileGaps`
   * resolves contradictions deterministically first, so a coherent profile
   * records none of these.
   */
  followUps: SimFollowUp[];
  /** Whether the AI considered the profile complete enough to generate. */
  intakeComplete: boolean;
}

/** One hypothetical position. Quantity is real shares priced off live quotes. */
export interface SimHolding {
  /** null only for the cash sleeve. */
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  currency: string;
  quantity: number;
  /** Target weight in % of total, as designed (actual weight drifts with price). */
  targetWeight: number;
  /** AI "why this holding / why this weight". Regenerated when edits change it. */
  rationale: string | null;
  addedBy: "ai" | "user";
  /**
   * Class-specific payload, forwarded verbatim to RawHolding.meta so a
   * simulated holding can express what a real ledger row can. The case that
   * motivated it: the cash adapter reads `meta.yieldPct` (a user-stated HYSA/
   * MMF APY) for income and quality, and without a meta channel a SIMULATED
   * cash sleeve was structurally forced to score as idle cash — the simulator
   * silently under-scored every book it evaluated relative to the same book
   * held for real. Optional; absent means what it means on a real row: nothing
   * stated, no favorable assumption made.
   */
  meta?: Record<string, unknown>;
}

/** AI summary blurb + strategy tags, mirroring the Dashboard thesis banner. */
export interface SimThesis {
  summary: string;
  tags: string[];
  generatedAt: string;
  source: "ai" | "fallback";
}

/** Denormalized list-view numbers, refreshed on every evaluation. */
export interface SimHeadline {
  totalValue: number;
  /**
   * Portfolio-alignment score against the investor's policy. Rows persisted
   * before the alignment engine carry the legacy `healthScore` instead —
   * normalizeStoredHeadline maps it across so old simulations keep a number
   * until their next evaluation refreshes the row.
   */
  alignmentScore: number | null;
  holdingCount: number;
  assetClassCount: number;
  annualIncome: number | null;
  asOf: string;
}

/**
 * Normalize a headline deserialized from storage. Same boundary pattern (and
 * same reason) as normalizeStoredProfile: rows written before a field change
 * yield shapes the type lies about, and the read boundary is the one place
 * that can fix the whole class. A legacy `healthScore` becomes the displayed
 * score — the two are different rulers, but for a stale list-view denorm that
 * is refreshed on next evaluation, showing the old number beats showing "—".
 */
export function normalizeStoredHeadline(stored: SimHeadline | null): SimHeadline | null {
  if (!stored) return null;
  const raw = stored as SimHeadline & { healthScore?: number | null };
  return {
    ...stored,
    alignmentScore: stored.alignmentScore ?? raw.healthScore ?? null,
  };
}

export interface Simulation {
  id: string;
  name: string;
  status: SimulationStatus;
  profile: SimProfile;
  holdings: SimHolding[];
  thesis: SimThesis | null;
  headline: SimHeadline | null;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Risk appetite (1–10) → max acceptable drawdown. Anchored so 1 ≈ cash-like
 * tolerance and 10 ≈ full-equity drawdowns; linear in between because the
 * scale is presented to the user as linear. */
export function drawdownForRiskAppetite(risk: number): number {
  const r = Math.min(10, Math.max(1, Math.round(risk)));
  return 5 + (r - 1) * 5; // 1 → 5%, 5 → 25%, 10 → 50%
}
