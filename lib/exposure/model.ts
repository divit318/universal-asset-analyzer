/**
 * Stage 1 of the Exposure model: positions, issuers, and the routes between
 * them, assembled from the portfolio report and the provider's disclosed fund
 * constituents.
 *
 * This module is a CONSUMER of investment intelligence, not a second source of
 * it. Every figure here comes from an engine that already existed:
 *
 *   - weights, values, correlation      → lib/portfolio/report.ts
 *   - effective exposure + routes       → lib/portfolio/intelligence/lookthrough.ts
 *   - findings                          → lib/portfolio/intelligence/detectors.ts
 *   - fund constituents                 → lib/screener/universes/fund-shared.ts
 *
 * The old knowledge graph re-derived several of these (a second look-through, a
 * second concentration detector) and the two implementations disagreed. There is
 * one of each now, and this file does arithmetic on their output.
 *
 * Pure except for `fetchFundLookThrough`, which is platform-cached.
 */

import { fetchFundLookThrough } from "../portfolio/intelligence/engine";
import {
  computeEffectiveExposures,
  lookThroughCoverage,
  type EffectiveExposure,
} from "../portfolio/intelligence/lookthrough";
import { runDetectors } from "../portfolio/intelligence/detectors";
import { holdingLabel, isFundWrapper } from "../portfolio/intelligence/types";
import type { FundLookThrough, IntelligenceInput } from "../portfolio/intelligence/types";
import type { Holding } from "../portfolio/model/types";
import type { UniversalPortfolioReport } from "../portfolio/report";
import { canonicalizeSector } from "../gics-sectors";
import { MIN_ISSUER_BOOK_PCT } from "./reference";
import {
  LOOK_THROUGH_BASIS,
  issuerId,
  positionId,
  type CoMovement,
  type ConcentrationSummary,
  type ExposureCoverage,
  type ExposureEdge,
  type ExposureModel,
  type IssuerNode,
  type PositionNode,
} from "./types";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** How many issuers the concentration ribbon compares stated against effective. */
const RIBBON_TOP_N = 5;

/* ────────────────────────────── Positions ────────────────────────────── */

/**
 * One node per LEDGER LINE, aggregating lots the way the intelligence snapshot
 * does (by `holdingLabel`) so a position node and a look-through route key on
 * the same string. Two VOO lots are one VOO position; they are one bet.
 */
function buildPositions(
  holdings: Holding[],
  funds: Map<string, FundLookThrough>,
): PositionNode[] {
  const byLabel = new Map<string, PositionNode>();

  for (const h of holdings) {
    if (h.weight <= 0) continue;
    const label = holdingLabel(h);
    const existing = byLabel.get(label);
    if (existing) {
      existing.weightPct = round2(existing.weightPct + h.weight);
      existing.valueBase += h.valuation.valueBase;
      continue;
    }

    const symbol = h.symbol?.toUpperCase() ?? null;
    const fund = symbol ? funds.get(symbol) : undefined;
    const isFund = isFundWrapper(h);

    byLabel.set(label, {
      id: positionId(label),
      kind: "position",
      label,
      symbol,
      name: h.name,
      assetClass: h.assetClass,
      weightPct: round2(h.weight),
      valueBase: h.valuation.valueBase,
      unrealizedPct: h.unrealizedPct,
      isFund,
      lookThrough: fund
        ? {
            // top10Pct is what the provider says the disclosed slice adds to.
            // When it is missing we sum the constituent weights ourselves rather
            // than assume 100 — assuming 100 would erase the hatched band that
            // exists precisely to show what we cannot see.
            disclosedPct: round2(
              fund.top10Pct ?? fund.topHoldings.reduce((s, c) => s + c.weightPercent, 0),
            ),
            undisclosedPct: round2(
              Math.max(
                0,
                100 - (fund.top10Pct ?? fund.topHoldings.reduce((s, c) => s + c.weightPercent, 0)),
              ),
            ),
            category: fund.category,
            sectorWeights: fund.sectorWeights,
            equityWeightPct: fund.equityWeightPct,
          }
        : null,
      opaque: isFund && symbol != null && !fund,
      href: symbol ? `/research?symbol=${encodeURIComponent(symbol)}` : null,
    });
  }

  return [...byLabel.values()].sort((a, b) => b.weightPct - a.weightPct);
}

/* ────────────────────────────── Issuers ────────────────────────────── */

function buildIssuers(
  exposures: EffectiveExposure[],
  holdings: Holding[],
): { issuers: IssuerNode[]; excludedCount: number; excludedPct: number } {
  const directSectors = new Map<string, string | null>();
  for (const h of holdings) {
    if (!h.symbol) continue;
    directSectors.set(h.symbol.toUpperCase(), h.attributes.sector ?? null);
  }

  const issuers: IssuerNode[] = [];
  let excludedCount = 0;
  let excludedPct = 0;

  for (const e of exposures) {
    if (e.totalPct < MIN_ISSUER_BOOK_PCT) {
      excludedCount++;
      excludedPct += e.totalPct;
      continue;
    }
    const rawSector = directSectors.get(e.symbol) ?? null;
    issuers.push({
      id: issuerId(e.symbol),
      kind: "issuer",
      symbol: e.symbol,
      name: e.name,
      effectivePct: e.totalPct,
      directPct: e.directPct,
      indirectPct: e.indirectPct,
      routeCount: e.sources.length,
      // Resolved on the drivers pass; null here is honest, not a placeholder.
      industry: null,
      sector: rawSector ? canonicalizeSector(rawSector) : null,
      heldDirectly: e.directPct > 0,
      href: `/research?symbol=${encodeURIComponent(e.symbol)}`,
    });
  }

  return { issuers, excludedCount, excludedPct: round2(excludedPct) };
}

/* ────────────────────────────── Edges ────────────────────────────── */

/**
 * Four edge types, every one carrying the percentage of book that flows along
 * it. The rule that keeps this honest: if an edge cannot state a magnitude, it
 * does not get built. That single constraint is what deleted eleven of the old
 * graph's thirteen relation types.
 */
function buildEdges(
  positions: PositionNode[],
  issuers: IssuerNode[],
  exposures: EffectiveExposure[],
  asOf: string,
): ExposureEdge[] {
  const edges: ExposureEdge[] = [];
  const positionByLabel = new Map(positions.map((p) => [p.label, p]));
  const issuerSymbols = new Set(issuers.map((i) => i.symbol));

  for (const p of positions) {
    edges.push({
      id: `holds:${p.label}`,
      from: "portfolio",
      to: p.id,
      kind: "HOLDS",
      bookPct: p.weightPct,
      innerPct: null,
      path: [],
      basis: "observed",
      source: "Your ledger",
      asOf,
    });
  }

  for (const e of exposures) {
    if (!issuerSymbols.has(e.symbol)) continue;
    for (const s of e.sources) {
      if (s.via === "direct") {
        // The direct route: the ledger line IS the company. Keyed on the
        // issuer symbol because that is the label a direct equity line carries.
        const p = positionByLabel.get(e.symbol);
        if (!p) continue;
        edges.push({
          id: `is:${e.symbol}`,
          from: p.id,
          to: issuerId(e.symbol),
          kind: "IS",
          bookPct: s.pct,
          innerPct: 100,
          path: [],
          basis: "observed",
          source: "Your ledger",
          asOf,
        });
      } else {
        const p = positionByLabel.get(s.via);
        if (!p) continue;
        edges.push({
          id: `contains:${s.via}:${e.symbol}`,
          from: p.id,
          to: issuerId(e.symbol),
          kind: "CONTAINS",
          bookPct: s.pct,
          innerPct: s.innerPct,
          path: s.nested,
          // The constituent weight is observed; multiplying it by the ledger
          // weight to get a share of book is ours, hence derived.
          basis: "derived",
          source: `${s.via} disclosed holdings (Yahoo)`,
          asOf,
        });
      }
    }
  }

  return edges;
}

/* ────────────────────────────── Coverage ────────────────────────────── */

function buildCoverage(
  input: IntelligenceInput,
  positions: PositionNode[],
  issuers: IssuerNode[],
  asOf: string,
): ExposureCoverage {
  const base = lookThroughCoverage(input);

  // A position contributes to issuer space if it is a direct equity/REIT line or
  // a fund we could see inside. Everything else — cash, crypto, bullion, a bond
  // sleeve, a house — is real portfolio value with no issuer decomposition, and
  // the denominator has to say so or every percentage on the page is quoted
  // against a book the user does not recognise.
  const mapped = new Set<string>();
  for (const i of issuers) {
    if (i.directPct > 0) mapped.add(i.symbol);
  }
  let issuerMapped = 0;
  const unmapped: string[] = [];
  for (const p of positions) {
    const contributes =
      (p.isFund && p.lookThrough != null) ||
      (!p.isFund && mapped.has(p.label)) ||
      p.assetClass === "equity" ||
      p.assetClass === "reit";
    if (contributes) issuerMapped += p.weightPct;
    else unmapped.push(p.label);
  }

  return {
    fundsAnalyzed: base.fundsAnalyzed,
    fundsOpaque: base.fundsOpaque,
    lookThroughPct: base.lookThroughPct,
    issuerMappedPct: round2(issuerMapped),
    unmappedLabels: unmapped,
    basis: LOOK_THROUGH_BASIS,
    asOf,
  };
}

/* ────────────────────────────── Concentration ────────────────────────────── */

/**
 * The ribbon's one sentence: the same N names, stated against effective.
 *
 * Comparing the effective top five against the *stated* top five would be two
 * different name sets and therefore not a comparison at all. Holding the names
 * fixed is what makes the gap attributable.
 */
function buildConcentration(issuers: IssuerNode[]): ConcentrationSummary {
  const top = issuers.slice(0, RIBBON_TOP_N);
  const effectivePct = round2(top.reduce((s, i) => s + i.effectivePct, 0));
  const statedPct = round2(top.reduce((s, i) => s + i.directPct, 0));
  return {
    topIssuerIds: top.map((i) => i.id),
    effectivePct,
    statedPct,
    hiddenPp: round2(effectivePct - statedPct),
  };
}

/* ────────────────────────────── Co-movement ────────────────────────────── */

function buildCoMovement(report: UniversalPortfolioReport): CoMovement | null {
  const corr = report.risk.correlation;
  if (!corr) return null;
  return {
    labels: corr.symbols,
    matrix: corr.matrix,
    // The risk engine measures over the report's own history window; naming it
    // generically here beats inventing a precision the matrix does not carry.
    window: "the measured return window",
    excluded: corr.excluded,
  };
}

/* ────────────────────────────── Entry point ────────────────────────────── */

export async function buildExposureModel(
  report: UniversalPortfolioReport,
): Promise<ExposureModel> {
  const funds = await fetchFundLookThrough(report.holdings);

  const input: IntelligenceInput = {
    holdings: report.holdings,
    totalValue: report.totalValue,
    allocation: report.allocation,
    risk: report.risk,
    health: report.health,
    attribution: report.attribution,
    baseCurrency: report.baseCurrency,
    funds,
  };

  const exposures = computeEffectiveExposures(input);
  const positions = buildPositions(report.holdings, funds);
  const { issuers } = buildIssuers(exposures, report.holdings);
  const edges = buildEdges(positions, issuers, exposures, report.generatedAt);
  const coverage = buildCoverage(input, positions, issuers, report.generatedAt);

  return {
    generatedAt: new Date().toISOString(),
    baseCurrency: report.baseCurrency,
    portfolio: {
      id: "portfolio",
      kind: "portfolio",
      label: "Your portfolio",
      totalValue: report.totalValue,
      baseCurrency: report.baseCurrency,
      holdingCount: positions.length,
    },
    positions,
    issuers,
    edges,
    concentration: buildConcentration(issuers),
    coverage,
    coMovement: buildCoMovement(report),
    // The detectors are the findings engine. This page renders their evidence;
    // it does not detect anything of its own.
    findings: runDetectors(input),
  };
}
