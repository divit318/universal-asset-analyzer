/**
 * Portfolio Intelligence orchestration — assemble the input, run the detector
 * registry, diff against the previous persisted run, synthesize the executive
 * summary, and persist the new baseline.
 *
 * The expensive/uncertain parts are isolated: fund constituents come through
 * the same `getFundDetails` extractor the MarketContext already uses (platform
 * cached), and the only AI call is the synthesis in synthesis.ts. Everything
 * else is pure arithmetic over the report the page already computed.
 */

import { getFundDetails } from "@/lib/screener/universes/fund-shared";
import {
  getPortfolioIntelligenceSnapshot,
  putPortfolioIntelligenceSnapshot,
} from "@/lib/db";
import type { Holding } from "../model/types";
import type { PortfolioAllocation } from "../engines/allocation";
import type { UniversalRisk } from "../engines/risk";
import type { AlignmentReport } from "../alignment/engine";
import type { ReturnAttribution } from "../engines/attribution";
import { runDetectors } from "./detectors";
import { lookThroughCoverage } from "./lookthrough";
import { synthesizeIntelligence } from "./synthesis";
import type {
  FindingSeverity,
  FundLookThrough,
  IntelligenceInput,
  PortfolioIntelligence,
  WhatChanged,
} from "./types";
import { holdingLabel, isFundWrapper } from "./types";

/* ────────────────────────── Fund look-through fetch ────────────────────────── */

/**
 * Constituents for every fund-shaped holding. A fund Yahoo reports no
 * `topHoldings` for is simply ABSENT from the map — the coverage disclosure
 * names it, and every look-through detector treats absence as "cannot see",
 * never as "holds nothing".
 */
export async function fetchFundLookThrough(holdings: Holding[]): Promise<Map<string, FundLookThrough>> {
  const symbols = [...new Set(holdings.filter(isFundWrapper).map((h) => h.symbol!.toUpperCase()))];
  if (symbols.length === 0) return new Map();

  const details = await getFundDetails(symbols);
  const out = new Map<string, FundLookThrough>();
  for (const sym of symbols) {
    const d = details.get(sym);
    if (!d?.topHoldings || d.topHoldings.length === 0) continue;
    out.set(sym, {
      symbol: sym,
      topHoldings: d.topHoldings,
      top10Pct: d.top10Concentration,
      sectorWeights: d.sectorWeights,
      category: d.category,
      equityWeightPct: d.equityWeight,
    });
  }
  return out;
}

/* ────────────────────────── What changed ────────────────────────── */

interface IntelligenceSnapshot {
  generatedAt: string;
  /** label → weight, one decimal — the same rounding the resize threshold uses. */
  weights: Record<string, number>;
  findings: { id: string; title: string; severity: FindingSeverity }[];
}

const RESIZE_THRESHOLD_PP = 2;

export function snapshotOf(
  holdings: Holding[],
  findings: { id: string; title: string; severity: FindingSeverity }[],
  generatedAt: string,
): IntelligenceSnapshot {
  const weights: Record<string, number> = {};
  for (const h of holdings) {
    if (h.weight <= 0) continue;
    const label = holdingLabel(h);
    weights[label] = Math.round(((weights[label] ?? 0) + h.weight) * 10) / 10;
  }
  return {
    generatedAt,
    weights,
    findings: findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity })),
  };
}

export function diffSnapshots(
  current: IntelligenceSnapshot,
  prev: IntelligenceSnapshot | null,
): WhatChanged {
  if (!prev) {
    return {
      since: null,
      changed: false,
      holdingsAdded: [],
      holdingsRemoved: [],
      resized: [],
      newFindings: [],
      resolvedFindings: [],
    };
  }

  const holdingsAdded = Object.keys(current.weights).filter((k) => prev.weights[k] == null).sort();
  const holdingsRemoved = Object.keys(prev.weights).filter((k) => current.weights[k] == null).sort();
  const resized = Object.keys(current.weights)
    .filter(
      (k) =>
        prev.weights[k] != null &&
        Math.abs(current.weights[k] - prev.weights[k]) >= RESIZE_THRESHOLD_PP,
    )
    .map((k) => ({ label: k, fromPct: prev.weights[k], toPct: current.weights[k] }))
    .sort((a, b) => Math.abs(b.toPct - b.fromPct) - Math.abs(a.toPct - a.fromPct));

  const prevIds = new Set(prev.findings.map((f) => f.id));
  const currentIds = new Set(current.findings.map((f) => f.id));
  const newFindings = current.findings.filter((f) => !prevIds.has(f.id)).map((f) => f.title);
  const resolvedFindings = prev.findings.filter((f) => !currentIds.has(f.id)).map((f) => f.title);

  return {
    since: prev.generatedAt,
    changed:
      holdingsAdded.length > 0 ||
      holdingsRemoved.length > 0 ||
      resized.length > 0 ||
      newFindings.length > 0 ||
      resolvedFindings.length > 0,
    holdingsAdded,
    holdingsRemoved,
    resized,
    newFindings,
    resolvedFindings,
  };
}

/* ────────────────────────── Main ────────────────────────── */

export interface IntelligenceParts {
  holdings: Holding[];
  totalValue: number;
  allocation: PortfolioAllocation;
  risk: UniversalRisk;
  alignment: AlignmentReport;
  attribution: ReturnAttribution | null;
  baseCurrency: string;
}

/** The honest all-clear — names what was checked, so "fine" is a claim, not a shrug. */
function allClearSummary(holdingCount: number, opaque: string[]): string {
  const base =
    `Nothing here rises to a finding. Across ${holdingCount} holdings, this run checked look-through ` +
    `single-company concentration, fund overlap, single names re-creating a held fund, correlated ` +
    `clusters, hidden sector bets, offsetting positions, market-chosen position sizes and ` +
    `long-stagnant losers — none crossed the thresholds that would make it worth your attention.`;
  return opaque.length > 0
    ? `${base} One qualification: ${opaque.join(", ")} reported no constituent data, so exposure through ${opaque.length === 1 ? "that fund" : "those funds"} is unknown rather than clear.`
    : base;
}

export async function buildPortfolioIntelligence(parts: IntelligenceParts): Promise<PortfolioIntelligence> {
  const generatedAt = new Date().toISOString();

  const funds = await fetchFundLookThrough(parts.holdings);
  const input: IntelligenceInput = { ...parts, funds };

  const findings = runDetectors(input);
  const coverage = lookThroughCoverage(input);
  const allClear = !findings.some((f) => f.severity === "high" || f.severity === "medium");

  /* What changed vs the previous persisted run. An unchanged portfolio keeps its
     baseline, so "since" keeps pointing at the last run where something WAS
     different rather than at five minutes ago. */
  const current = snapshotOf(parts.holdings, findings, generatedAt);
  let prev: IntelligenceSnapshot | null = null;
  const stored = getPortfolioIntelligenceSnapshot();
  if (stored) {
    try {
      prev = JSON.parse(stored.data) as IntelligenceSnapshot;
    } catch {
      prev = null;
    }
  }
  const whatChanged = diffSnapshots(current, prev);
  if (!prev || whatChanged.changed) {
    putPortfolioIntelligenceSnapshot(JSON.stringify(current), generatedAt);
  }

  /* Synthesis. With zero findings there is nothing for a model to add — the
     all-clear is a measured statement, not an interpretation, and must not be
     dressed as one (or as an AI outage). */
  if (findings.length === 0) {
    return {
      executiveSummary: allClearSummary(parts.holdings.length, coverage.fundsOpaque),
      crossCurrents: "",
      findings,
      allClear,
      whatChanged,
      coverage,
      generatedAt,
      source: "measured",
    };
  }

  const synthesis = await synthesizeIntelligence(findings, whatChanged, {
    totalValue: parts.totalValue,
    holdingCount: parts.holdings.length,
    alignmentLine:
      parts.alignment.score != null
        ? `${parts.alignment.score}/100 (${parts.alignment.label})`
        : "not scorable on the available data",
  }, coverage);

  return {
    executiveSummary: synthesis.executiveSummary,
    crossCurrents: synthesis.crossCurrents,
    findings,
    allClear,
    whatChanged,
    coverage,
    generatedAt,
    source: synthesis.source,
  };
}
