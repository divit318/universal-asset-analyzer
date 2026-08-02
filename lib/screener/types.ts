/**
 * The normalized screening model. Every asset class collapses into this one
 * shape before the filter, ranking and explanation layers ever see it — which
 * is the whole reason those layers can be written once instead of seven times,
 * and why the results table can be registry-driven rather than a hardcoded
 * table per class.
 *
 * The split between `metrics` (numeric) and `attributes` (categorical) is the
 * only structural distinction the pipeline makes. Everything else — what a
 * given key *means*, how to format it, whether higher is better — is looked up
 * in the Asset Registry, not encoded here.
 */

import type { AssetClassId, FilterValues, SoftPreferences } from "../assets/types";
import type { BindingConstraint, FilterDiagnostic } from "./filter-engine";
import type { FundHolding } from "../types";

/** One asset, normalized. Produced by a universe provider, consumed by everything downstream. */
export interface ScreenerCandidate {
  symbol: string;
  name: string;
  assetClass: AssetClassId;
  price: number | null;
  changePercent: number | null;
  /** Numeric metrics, keyed by MetricDef.key. Missing/unknown is `null`, never 0. */
  metrics: Record<string, number | null>;
  /** Categorical metrics, keyed by MetricDef.key. */
  attributes: Record<string, string | null>;
  /**
   * A fund's top-10 holdings by name+weight. Deliberately outside the
   * metrics/attributes scalar maps — the filter/ranking/column pipeline has no
   * use for a list, so this is a display-only field a row's detail view can
   * render when present. `undefined`/`null`/`[]` all mean "not applicable or
   * not available"; only ETFs (and eventually bond funds) ever populate it.
   */
  topHoldings?: FundHolding[] | null;
}

/** Why a candidate passed, and what to watch out for. Deterministic — no AI involved. */
export interface MatchExplanation {
  /** One entry per active filter the candidate cleared, with its actual value. */
  passed: { label: string; detail: string }[];
  /** Metrics where it ranks in the top quartile of the universe on a factor that counts toward its score. */
  strengths: { label: string; detail: string }[];
  /** Registry-defined risk flags that fired. */
  warnings: string[];
}

export interface RankedCandidate extends ScreenerCandidate {
  /**
   * The active filter this row came closest to failing. Present only for rows in
   * the returned page — computing it for a whole 1,540-name universe would be
   * work for rows nobody is looking at.
   */
  binding?: BindingConstraint;
  /** 1-based position in the result set. */
  rank: number;
  /** 0-100 composite, from the class's (or template's) RankFactors. */
  rankScore: number;
  /**
   * Share of the ranking weight that had data behind it, 0-100. A name scored
   * on two of five factors is not as trustworthy as one scored on all five,
   * and the UI says so rather than hiding it.
   */
  confidence: number;
  /** Percentile (0-100) of this candidate within the universe, per metric. */
  percentiles: Record<string, number>;
  match: MatchExplanation;
}

export interface ScreenerRequest {
  assetClass: AssetClassId;
  templateId: string | null;
  filters: FilterValues;
  /**
   * Metrics the user would *prefer*, without excluding anything that misses.
   * Folded into the ranking for this run only — see pipeline.ts#withPreferences.
   */
  preferences?: SoftPreferences;
  sortKey: string;
  sortDir: "asc" | "desc";
  size: number;
  offset: number;
}

/** Progress of a universe provider's background build. Mirrors the existing DatasetStatus contract. */
export interface UniverseStatus {
  stage: "empty" | "building" | "ready" | "error";
  total: number;
  ready: number;
  builtAt: string | null;
  error?: string;
}

export interface ScreenerResponse {
  assetClass: AssetClassId;
  status: UniverseStatus;
  /** How many candidates the filters matched (before pagination). */
  total: number;
  /** How many candidates were evaluated — i.e. the size of the universe that was ready. */
  universeReady: number;
  offset: number;
  rows: RankedCandidate[];
  /**
   * Present only when the screen matched nothing: which filter is responsible,
   * and how far it would have to move to admit a name. An empty result is the
   * one outcome where spending CPU on an explanation is obviously worth it.
   */
  diagnostics?: FilterDiagnostic[];
}
