/**
 * The detector registry — each detector answers ONE question a busy investor
 * would not think to ask, from data the engines already measured. All pure.
 *
 * Rules every detector obeys:
 *
 *   1. Emit nothing rather than guess. A detector whose inputs are missing or
 *      below coverage returns [] — the coverage disclosure says why, the finding
 *      list never contains a hedge-worded maybe.
 *   2. Every figure in the evidence is observed or derived, labelled per line.
 *   3. Behavioural language is confined to `blindSpot` and always "may indicate".
 *      The engine sees the portfolio, not the investor's psychology.
 *   4. Thresholds are calibrated to fire on genuinely unusual structure, not to
 *      guarantee output. An empty result IS a result (`allClear`).
 *
 * Adding a detector = one function here + one entry in DETECTORS. Nothing else.
 */

import { canonicalizeSector } from "../../gics-sectors";
import { FACTOR_LABEL, FACTOR_SHOCK_UNIT, FACTORS } from "../model/types";
import type { Holding } from "../model/types";
import type {
  EvidenceLine,
  IntelligenceFinding,
  IntelligenceInput,
  FindingSeverity,
} from "./types";
import { holdingLabel, isFundWrapper } from "./types";
import {
  computeEffectiveExposures,
  correlationClusters,
  fundPairOverlap,
  lookThroughSectors,
  pairCorrelation,
  type EffectiveExposure,
  type SectorLookThroughResult,
} from "./lookthrough";

/** Shared artifacts computed once per run so detectors never recompute them. */
export interface DetectorContext {
  exposures: EffectiveExposure[];
  sectors: SectorLookThroughResult;
}

export function buildDetectorContext(input: IntelligenceInput): DetectorContext {
  return {
    exposures: computeEffectiveExposures(input),
    sectors: lookThroughSectors(input),
  };
}

type Detector = (input: IntelligenceInput, ctx: DetectorContext) => IntelligenceFinding[];

const SEVERITY_BASE: Record<FindingSeverity, number> = { high: 300, medium: 200, low: 100 };

const rankOf = (severity: FindingSeverity, weightPct: number) =>
  SEVERITY_BASE[severity] + Math.min(99, Math.max(0, weightPct));

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const observed = (text: string): EvidenceLine => ({ basis: "observed", text });
const derived = (text: string): EvidenceLine => ({ basis: "derived", text });

const TOP10_CAVEAT =
  "Look-through sees only each fund's ten largest constituents (all the provider reports), so this figure is a lower bound — the true exposure can only be higher.";

/* ────────────────── 1. Hidden concentration (look-through) ────────────────── */

const hiddenConcentration: Detector = (input, ctx) => {
  const findings: IntelligenceFinding[] = [];
  for (const e of ctx.exposures) {
    if (e.indirectPct < 2) continue; // needs a material hidden component
    const meaningfulTotal = e.totalPct >= 5;
    const materialVsDirect = e.directPct > 0 ? e.totalPct >= e.directPct * 1.3 : e.totalPct >= 5;
    if (!meaningfulTotal || !materialVsDirect) continue;

    const severity: FindingSeverity =
      e.totalPct >= 12 || (e.totalPct >= 8 && e.directPct > 0 && e.totalPct >= e.directPct * 2)
        ? "high"
        : "medium";
    const viaFunds = e.sources.filter((s) => s.via !== "direct");
    const fundList = viaFunds.map((s) => `${s.via} adds ${pct1(s.pct)}`).join(", ");

    if (e.directPct > 0) {
      findings.push({
        id: `hidden-concentration:${e.symbol}`,
        detector: "hidden-concentration",
        severity,
        title: `You own more ${e.symbol} than you think`,
        headline: `Direct position ${pct1(e.directPct)}, but effective exposure is at least ${pct1(e.totalPct)} once ${viaFunds.length} fund${viaFunds.length === 1 ? "" : "s"} are looked through.`,
        evidence: [
          observed(`Direct ${e.symbol} position: ${pct1(e.directPct)} of portfolio.`),
          ...viaFunds.map((s) =>
            derived(`${s.via} contributes a further ${pct1(s.pct)} of portfolio value in ${e.symbol} through its holdings.`),
          ),
          derived(`Effective ${e.symbol} exposure: ≥ ${pct1(e.totalPct)} of portfolio (${fundList}).`),
        ],
        whyItMatters: `The portfolio's single-company bet on ${e.name} is ${(e.totalPct / Math.max(e.directPct, 0.01)).toFixed(1)}× the position that appears in the holdings list. A drawdown in this one name hits every wrapper at once.`,
        blindSpot: `Holding ${e.symbol} through funds can make the exposure feel diversified when economically it is still one company. Worth asking: does the direct position still add something the funds don't already provide?`,
        caveat: TOP10_CAVEAT,
        weightPct: e.totalPct,
        explore: { kind: "trace", target: e.symbol },
        rank: rankOf(severity, e.totalPct),
      });
    } else if (e.totalPct >= 5) {
      findings.push({
        id: `hidden-concentration:${e.symbol}`,
        detector: "hidden-concentration",
        severity,
        title: `A ${pct1(e.totalPct)} position you never bought: ${e.symbol}`,
        headline: `${e.name} is ≥ ${pct1(e.totalPct)} of the portfolio purely through ${viaFunds.length} fund${viaFunds.length === 1 ? "" : "s"} — with no direct position at all.`,
        evidence: [
          ...viaFunds.map((s) =>
            derived(`${s.via} contributes ${pct1(s.pct)} of portfolio value in ${e.symbol}.`),
          ),
          derived(`Combined: ≥ ${pct1(e.totalPct)} of the portfolio rides on ${e.name}.`),
        ],
        whyItMatters: `This is a top-of-book single-company exposure that never appears as a line item, so it is easy to size other positions as if it did not exist.`,
        caveat: TOP10_CAVEAT,
        weightPct: e.totalPct,
        explore: { kind: "trace", target: e.symbol },
        rank: rankOf(severity, e.totalPct),
      });
    }
  }
  return findings.sort((a, b) => b.rank - a.rank).slice(0, 3);
};

/* ────────────────── 2. Fund overlap / redundancy ────────────────── */

const fundOverlapDetector: Detector = (input) => {
  const held = input.holdings.filter((h) => isFundWrapper(h) && h.symbol && input.funds.has(h.symbol.toUpperCase()));
  const findings: IntelligenceFinding[] = [];

  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) {
      const a = held[i];
      const b = held[j];
      const overlap = fundPairOverlap(
        input.funds.get(a.symbol!.toUpperCase())!,
        input.funds.get(b.symbol!.toUpperCase())!,
      );
      const r =
        input.risk.correlation != null
          ? pairCorrelation(
              input.risk.correlation.symbols,
              input.risk.correlation.matrix,
              holdingLabel(a),
              holdingLabel(b),
            )
          : null;

      const redundant = overlap.overlapPct >= 25 || (overlap.sameCategory && (r ?? 0) >= 0.97);
      if (!redundant) continue;

      const combined = a.weight + b.weight;
      const severity: FindingSeverity = overlap.overlapPct >= 40 && combined >= 10 ? "high" : "medium";
      const sharedNames = overlap.shared.slice(0, 5).map((s) => s.symbol).join(", ");
      const evidence: EvidenceLine[] = [
        observed(`${overlap.a} is ${pct1(a.weight)} of the portfolio; ${overlap.b} is ${pct1(b.weight)}.`),
      ];
      if (overlap.shared.length > 0) {
        evidence.push(
          derived(
            `Their visible top-10 constituents overlap by ≥ ${pct1(overlap.overlapPct)} of fund value (${overlap.shared.length} shared names: ${sharedNames}).`,
          ),
        );
      }
      if (overlap.sameCategory && overlap.category) {
        evidence.push(observed(`Both are classified "${overlap.category}" (Morningstar category).`));
      }
      if (r != null) {
        evidence.push(derived(`Their daily returns have moved with r=${r.toFixed(2)} over the measured window.`));
      }

      findings.push({
        id: `fund-overlap:${[overlap.a, overlap.b].sort().join("+")}`,
        detector: "fund-overlap",
        severity,
        title: `${overlap.a} and ${overlap.b} are doing largely the same job`,
        headline: `${pct1(combined)} of the portfolio is split across two funds whose exposures substantially coincide.`,
        evidence,
        whyItMatters:
          "Two wrappers over one exposure add a line item, a spread and an expense ratio — not diversification. The position count overstates how many bets this portfolio is making.",
        blindSpot:
          "This pattern may indicate incremental buying — adding a fund that 'looks good' without checking what the existing funds already hold. If the duplication is deliberate (e.g. tax lots, fee arbitrage), it is worth being deliberate on purpose.",
        caveat: overlap.shared.length > 0 ? TOP10_CAVEAT : undefined,
        weightPct: combined,
        explore: { kind: "overlap", target: `${overlap.a}+${overlap.b}` },
        rank: rankOf(severity, combined),
      });
    }
  }
  return findings.sort((a, b) => b.rank - a.rank).slice(0, 2);
};

/* ────────────────── 3. Single names re-creating a held fund ────────────────── */

const etfRecreated: Detector = (input) => {
  const directBySymbol = new Map(
    input.holdings
      .filter((h) => h.symbol && (h.assetClass === "equity" || h.assetClass === "reit") && h.weight > 0)
      .map((h) => [h.symbol!.toUpperCase(), h]),
  );
  if (directBySymbol.size < 3) return [];

  const findings: IntelligenceFinding[] = [];
  for (const h of input.holdings) {
    if (!h.symbol || !isFundWrapper(h)) continue;
    const fund = input.funds.get(h.symbol.toUpperCase());
    if (!fund) continue;
    const echoed = fund.topHoldings
      .map((c) => directBySymbol.get(c.symbol.toUpperCase()))
      .filter((d): d is Holding => d != null);
    const directWeight = echoed.reduce((s, d) => s + d.weight, 0);
    if (echoed.length < 3 || directWeight < 5) continue;

    const severity: FindingSeverity = directWeight + h.weight >= 20 ? "high" : "medium";
    findings.push({
      id: `etf-recreated:${h.symbol.toUpperCase()}`,
      detector: "etf-recreated",
      severity,
      title: `Your single names re-create the top of ${h.symbol.toUpperCase()}`,
      headline: `${echoed.length} of your direct positions (${pct1(directWeight)} of portfolio) are also top-10 constituents of ${h.symbol.toUpperCase()} (${pct1(h.weight)}).`,
      evidence: [
        observed(
          `Direct positions also inside ${h.symbol.toUpperCase()}'s top 10: ${echoed.map((d) => `${holdingLabel(d)} ${pct1(d.weight)}`).join(", ")}.`,
        ),
        derived(
          `Combined, the fund plus these names put ${pct1(directWeight + h.weight)} of the portfolio behind one basket.`,
        ),
      ],
      whyItMatters:
        "The stock-picking sleeve and the index sleeve are the same trade. Whatever alpha the single names are meant to add is diluted by owning them again inside the fund — and the combined drawdown arrives as one event.",
      blindSpot:
        "Worth asking of each echoed name: what does holding it directly add that the fund doesn't already provide — higher conviction sizing, or just familiarity?",
      caveat: TOP10_CAVEAT,
      weightPct: directWeight + h.weight,
      explore: { kind: "position", target: h.symbol.toUpperCase() },
      rank: rankOf(severity, directWeight + h.weight),
    });
  }
  return findings.sort((a, b) => b.rank - a.rank).slice(0, 1);
};

/* ────────────────── 4. Correlation clusters (false diversification) ────────────────── */

const CLUSTER_R = 0.85;

const correlationCluster: Detector = (input) => {
  const corr = input.risk.correlation;
  if (!corr || corr.symbols.length < 3) return [];

  const weightByLabel = new Map(input.holdings.map((h) => [holdingLabel(h), h.weight]));
  const clusters = correlationClusters(corr.symbols, corr.matrix, CLUSTER_R)
    .map((members) => ({
      members,
      weight: members.reduce((s, m) => s + (weightByLabel.get(m) ?? 0), 0),
    }))
    .filter((c) => c.members.length >= 3 && c.weight >= 20)
    .sort((a, b) => b.weight - a.weight);

  return clusters.slice(0, 2).map((c) => {
    const severity: FindingSeverity = c.weight >= 40 ? "high" : "medium";
    const pairs = corr.highPairs
      .filter((p) => c.members.includes(p.a) && c.members.includes(p.b))
      .slice(0, 3)
      .map((p) => `${p.a}/${p.b} r=${p.r.toFixed(2)}`)
      .join(", ");
    return {
      id: `correlation-cluster:${[...c.members].sort().join("+")}`,
      detector: "correlation-cluster",
      severity,
      title: `${c.members.length} holdings, one trade`,
      headline: `${c.members.join(", ")} — ${pct1(c.weight)} of the portfolio — have moved as a single block (pairwise r ≥ ${CLUSTER_R}).`,
      evidence: [
        derived(`Every pair in this group correlated at r ≥ ${CLUSTER_R} over the measured window${pairs ? ` (${pairs})` : ""}.`),
        derived(`Combined weight: ${pct1(c.weight)} of portfolio value.`),
      ],
      whyItMatters:
        "Diversification that exists at the ticker level but not at the return level is the kind that fails exactly when it is needed. Whatever macro condition moves one of these moves all of them, on the same day.",
      blindSpot:
        "Counting these as separate positions may make the portfolio feel more spread out than its returns say it is. The honest position count treats this block as one.",
      weightPct: c.weight,
      explore: { kind: "cluster", target: [...c.members].sort().join("+") },
      rank: rankOf(severity, c.weight),
    } satisfies IntelligenceFinding;
  });
};

/* ────────────────── 5. Sector look-through bet ────────────────── */

const sectorBet: Detector = (input, ctx) => {
  const { sectors, classifiedPct } = ctx.sectors;
  if (classifiedPct < 40 || sectors.length === 0) return [];
  const top = sectors[0];
  if (top.pct < 30 || top.viaFundsPct < 5) return [];

  // What the allocation panel already says about this sector — only speak when
  // look-through reveals something the stated breakdown genuinely hides.
  const stated = input.allocation.bySector.slices.find((s) => s.label === top.sector)?.weight ?? 0;
  if (top.pct < stated + 8) return [];

  const severity: FindingSeverity = top.pct >= 45 ? "high" : "medium";

  /* Which single line contributes the most of this sector's hidden component.
     A sector is not an entity the exposure graph draws — its node types are
     positions, issuers and drivers — but the LINE delivering most of the
     surprise is, and opening it is what shows the reader where the bet came
     from. Without this the page's loudest finding is also its only dead end. */
  let biggestFund: { label: string; contribution: number } | null = null;
  for (const h of input.holdings) {
    if (!h.symbol || !isFundWrapper(h) || h.weight <= 0) continue;
    const fund = input.funds.get(h.symbol.toUpperCase());
    const sw = fund?.sectorWeights?.find(
      (s) => (canonicalizeSector(s.sector) ?? s.sector) === top.sector,
    );
    if (!sw) continue;
    const contribution = h.weight * (sw.weightPercent / 100);
    if (!biggestFund || contribution > biggestFund.contribution) {
      biggestFund = { label: holdingLabel(h), contribution };
    }
  }

  return [
    {
      id: `sector-bet:${top.sector}`,
      detector: "sector-bet",
      severity,
      title: `More ${top.sector} than any chart on this page shows`,
      headline: `True ${top.sector} exposure is ≥ ${pct1(top.pct)} once funds are looked through — the sector breakdown shows ${pct1(stated)}.`,
      evidence: [
        derived(`Look-through ${top.sector}: ${pct1(top.pct)} of portfolio (${pct1(top.viaDirectPct)} direct, ${pct1(top.viaFundsPct)} inside funds).`),
        observed(`The sector allocation panel attributes ${pct1(stated)} to ${top.sector}, because diversified funds are shown as one slice.`),
        derived(`Sector look-through could classify ${pct1(classifiedPct)} of portfolio value; the rest is bonds, cash, commodities or opaque funds and is not guessed.`),
      ],
      whyItMatters: `A ${top.sector.toLowerCase()} drawdown would reach through the funds and the single names simultaneously — the diversification between them is smaller than the holdings list suggests.`,
      blindSpot: `Spreading a sector bet across wrappers may make it feel like several decisions. Economically it is one view on ${top.sector.toLowerCase()}, and it deserves to be sized as one.`,
      caveat: "Fund sector weights are provider-reported for the equity sleeve of each fund; non-equity value is excluded rather than estimated.",
      weightPct: top.pct,
      explore: biggestFund ? { kind: "position", target: biggestFund.label } : undefined,
      rank: rankOf(severity, top.pct),
    },
  ];
};

/* ────────────────── 6. Hidden risk driver (small position, big movement) ────────────────── */

const hiddenRiskDriver: Detector = (input) => {
  const attr = input.attribution;
  if (!attr || attr.contributors.length < 4) return [];
  const findings: IntelligenceFinding[] = [];
  for (const c of attr.contributors) {
    if (c.weight >= 5 || c.shareOfMovementPct < 20) continue;
    const label = (c.symbol ?? c.name).toUpperCase();
    findings.push({
      id: `hidden-risk-driver:${label}`,
      detector: "hidden-risk-driver",
      severity: "medium",
      title: `A ${pct1(c.weight)} position is driving ${c.shareOfMovementPct.toFixed(0)}% of your movement`,
      headline: `${label} carries ${pct1(c.weight)} of value but has produced ${c.shareOfMovementPct.toFixed(0)}% of the portfolio's total movement.`,
      evidence: [
        observed(`${label}: ${pct1(c.weight)} of portfolio value${c.ownReturnPct != null ? `, ${c.ownReturnPct >= 0 ? "+" : ""}${c.ownReturnPct.toFixed(1)}% on its own cost` : ""}.`),
        derived(`Share of total gross movement: ${c.shareOfMovementPct.toFixed(0)}% (${c.contributionPct >= 0 ? "+" : ""}${c.contributionPct.toFixed(2)}pp of the total return).`),
      ],
      whyItMatters:
        "Risk lives where the movement is, not where the dollars are. A position this small moving the book this much is volatile enough that its true risk weight is a multiple of its capital weight.",
      weightPct: c.weight,
      rank: rankOf("medium", c.shareOfMovementPct / 2),
    });
  }
  return findings.sort((a, b) => b.rank - a.rank).slice(0, 1);
};

/* ────────────────── 7. Winner concentration (bias) ────────────────── */

const winnerConcentration: Detector = (input) => {
  const totalCost = input.holdings.reduce((s, h) => s + Math.max(h.costBasisBase, 0), 0);
  if (totalCost <= 0) return [];
  const findings: IntelligenceFinding[] = [];
  for (const h of input.holdings) {
    if (h.weight < 10 || h.costBasisBase <= 0 || h.unrealizedPct == null || h.unrealizedPct <= 0) continue;
    const costShare = (h.costBasisBase / totalCost) * 100;
    if (h.weight < costShare * 1.5) continue;
    const label = holdingLabel(h);
    findings.push({
      id: `winner-concentration:${label}`,
      detector: "winner-concentration",
      severity: "medium",
      title: `${label} grew into your largest bet — you never chose this size`,
      headline: `${label} is ${pct1(h.weight)} of the portfolio but only ${pct1(costShare)} of invested capital; gains, not decisions, set its current size.`,
      evidence: [
        observed(`${label}: ${pct1(h.weight)} of current value vs ${pct1(costShare)} of capital deployed (+${h.unrealizedPct.toFixed(0)}% unrealized).`),
        derived(`The market has ${(h.weight / costShare).toFixed(1)}× the position since purchase.`),
      ],
      whyItMatters:
        "Position size is the loudest risk decision in a portfolio, and this one was made by the market. The current weight expresses a conviction level that was never explicitly chosen.",
      blindSpot:
        "This pattern may indicate attachment to a winner — holding the size because trimming feels like betraying the position. The question is not whether it was a good buy, but whether you would buy THIS weight today.",
      weightPct: h.weight,
      rank: rankOf("medium", h.weight),
    });
  }
  return findings.sort((a, b) => b.rank - a.rank).slice(0, 1);
};

/* ────────────────── 8. Anchoring pattern (bias) ────────────────── */

const anchoringPattern: Detector = (input) => {
  const now = Date.now();
  const stale = input.holdings.filter((h) => {
    if (h.unrealizedPct == null || h.unrealizedPct > -25 || h.weight < 2) return false;
    const acquired = Date.parse(h.acquiredAt);
    return Number.isFinite(acquired) && now - acquired > 180 * 24 * 3600 * 1000;
  });
  if (stale.length === 0) return [];
  const weight = stale.reduce((s, h) => s + h.weight, 0);
  const list = stale
    .slice(0, 3)
    .map((h) => `${holdingLabel(h)} (${h.unrealizedPct!.toFixed(0)}%, ${pct1(h.weight)} of portfolio)`)
    .join(", ");
  return [
    {
      id: `anchoring:${stale.map(holdingLabel).sort().join("+")}`,
      detector: "anchoring",
      severity: "low",
      title: `${stale.length === 1 ? "A position" : `${stale.length} positions`} deep underwater and unchanged for 6+ months`,
      headline: `${pct1(weight)} of the portfolio sits in positions down ≥ 25% and held over six months: ${list}.`,
      evidence: [
        observed(`Positions down ≥ 25% held > 6 months: ${list}.`),
        derived(`Combined weight: ${pct1(weight)} of portfolio value.`),
      ],
      whyItMatters:
        "Capital parked in a losing thesis has a cost the P&L column never shows: everything it could have been doing instead. The purchase price is not information the market uses.",
      blindSpot:
        "This pattern may indicate anchoring — holding until it 'gets back to even'. A useful test: if this position were cash today, would you open it at this price?",
      weightPct: weight,
      rank: rankOf("low", weight),
    },
  ];
};

/* ────────────────── 9. Home bias ────────────────── */

const homeBias: Detector = (input) => {
  const geo = input.allocation.byGeography;
  if (geo.unclassifiedPct > 40 || geo.slices.length === 0) return [];
  const classified = 100 - geo.unclassifiedPct;
  const us = geo.slices.find((s) => /united states|^usa?$/i.test(s.label));
  if (!us || classified <= 0) return [];
  const usShare = (us.weight / classified) * 100;
  if (usShare < 85) return [];
  const severity: FindingSeverity = usShare >= 95 ? "medium" : "low";
  return [
    {
      id: "home-bias:US",
      detector: "home-bias",
      severity,
      title: "Everything answers to one economy",
      headline: `${usShare.toFixed(0)}% of classifiable value is United States — a single country's rates, politics and currency.`,
      evidence: [
        observed(`United States: ${pct1(us.weight)} of portfolio (${usShare.toFixed(0)}% of the ${pct1(classified)} that could be classified by geography).`),
        derived("US listings are roughly 60% of global investable market cap — this portfolio is well past that reference point."),
      ],
      whyItMatters:
        "Country concentration is invisible day to day because everything is priced in the same currency and moves on the same news cycle. It shows up only in the scenario where the one economy underperforms for years.",
      blindSpot:
        "This pattern may indicate home bias — overweighting what feels familiar. Deliberate US concentration is a defensible view; accidental US concentration is just unexamined.",
      caveat: "Geography here is the listing country of each holding or fund, not a revenue-based look-through — multinationals blur it.",
      weightPct: us.weight,
      rank: rankOf(severity, us.weight / 2),
    },
  ];
};

/* ────────────────── 10. Passenger positions (efficiency) ────────────────── */

const passengerPositions: Detector = (input) => {
  const corr = input.risk.correlation;
  if (!corr) return [];
  const byLabel = new Map(input.holdings.map((h) => [holdingLabel(h), h]));
  const passengers: { label: string; twin: string; r: number; weight: number }[] = [];

  for (const label of corr.symbols) {
    const h = byLabel.get(label);
    if (!h || h.weight > 1.5 || h.weight <= 0) continue;
    for (const other of corr.symbols) {
      if (other === label) continue;
      const oh = byLabel.get(other);
      if (!oh || oh.weight < h.weight * 5) continue;
      const r = pairCorrelation(corr.symbols, corr.matrix, label, other);
      if (r != null && r >= 0.92) {
        passengers.push({ label, twin: other, r, weight: h.weight });
        break;
      }
    }
  }
  if (passengers.length === 0) return [];
  const weight = passengers.reduce((s, p) => s + p.weight, 0);
  const list = passengers
    .slice(0, 4)
    .map((p) => `${p.label} (${pct1(p.weight)}, moves with ${p.twin} at r=${p.r.toFixed(2)})`)
    .join("; ");
  return [
    {
      id: `passengers:${passengers.map((p) => p.label).sort().join("+")}`,
      detector: "passengers",
      severity: "low",
      title: `${passengers.length === 1 ? "One position adds" : `${passengers.length} positions add`} complexity, not diversification`,
      headline: `${pct1(weight)} of the portfolio sits in small positions that track a much larger holding almost exactly.`,
      evidence: [derived(`Sub-1.5% positions moving in lockstep with a position ≥ 5× their size: ${list}.`)],
      whyItMatters:
        "A position too small to change outcomes and too correlated to diversify them contributes only line items. Each one is attention spent for nothing the bigger holding isn't already doing.",
      blindSpot:
        "This pattern may indicate accumulated buys that were never consolidated. The question for each: what does it do that the position it tracks doesn't?",
      weightPct: weight,
      rank: rankOf("low", weight),
    },
  ];
};

/* ────────────────── 11. Internal contradictions ────────────────── */

const internalHedge: Detector = (input) => {
  const findings: IntelligenceFinding[] = [];

  // Two material positions that reliably move AGAINST each other.
  const corr = input.risk.correlation;
  if (corr) {
    const byLabel = new Map(input.holdings.map((h) => [holdingLabel(h), h]));
    let best: { a: string; b: string; r: number; weight: number } | null = null;
    for (let i = 0; i < corr.symbols.length; i++) {
      for (let j = i + 1; j < corr.symbols.length; j++) {
        const r = corr.matrix[i]?.[j];
        if (r == null || !Number.isFinite(r) || r > -0.5) continue;
        const a = byLabel.get(corr.symbols[i]);
        const b = byLabel.get(corr.symbols[j]);
        if (!a || !b || a.weight < 5 || b.weight < 5) continue;
        const weight = a.weight + b.weight;
        if (!best || r < best.r) best = { a: corr.symbols[i], b: corr.symbols[j], r, weight };
      }
    }
    if (best) {
      findings.push({
        id: `internal-hedge:${[best.a, best.b].sort().join("+")}`,
        detector: "internal-hedge",
        severity: "medium",
        title: `${best.a} and ${best.b} are betting against each other`,
        headline: `Two material positions (${pct1(best.weight)} combined) have moved in opposite directions (r=${best.r.toFixed(2)}) — one is functioning as a hedge on the other.`,
        evidence: [
          derived(`${best.a} vs ${best.b}: r=${best.r.toFixed(2)} over the measured window.`),
          observed(`Combined weight: ${pct1(best.weight)} of portfolio value.`),
        ],
        whyItMatters:
          "If deliberate, this is a hedge and should be sized as one. If not, the portfolio is paying full risk on both legs of a trade whose net exposure is much smaller than either position suggests.",
        blindSpot:
          "Offsetting positions accumulated at different times may indicate two theses that were never reconciled — each made sense alone, together they partially cancel.",
        weightPct: best.weight,
        explore: { kind: "cluster", target: [best.a, best.b].sort().join("+") },
        rank: rankOf("medium", best.weight / 2),
      });
    }
  }

  // A macro factor the portfolio is long AND short in material size.
  for (const factor of FACTORS) {
    let pos = 0;
    let neg = 0;
    const posNames: string[] = [];
    const negNames: string[] = [];
    for (const h of input.holdings) {
      const s = h.factors[factor];
      if (s == null || h.weight <= 0) continue;
      const exposure = (h.weight / 100) * s;
      if (exposure > 0) {
        pos += exposure;
        if (posNames.length < 3) posNames.push(holdingLabel(h));
      } else if (exposure < 0) {
        neg += exposure;
        if (negNames.length < 3) negNames.push(holdingLabel(h));
      }
    }
    if (pos >= 2 && neg <= -2) {
      const unit = FACTOR_SHOCK_UNIT[factor];
      findings.push({
        id: `factor-tension:${factor}`,
        detector: "factor-tension",
        severity: "medium",
        title: `The portfolio is long and short ${FACTOR_LABEL[factor].toLowerCase()} at the same time`,
        headline: `One sleeve gains ${pos.toFixed(1)}% per ${unit === "pp" ? "1pp" : "unit"} ${FACTOR_LABEL[factor].toLowerCase()} shock while another loses ${Math.abs(neg).toFixed(1)}% — a two-sided bet on one variable.`,
        evidence: [
          derived(`Positive side (${posNames.join(", ")}): +${pos.toFixed(1)}% of portfolio per shock unit.`),
          derived(`Negative side (${negNames.join(", ")}): ${neg.toFixed(1)}% of portfolio per shock unit.`),
        ],
        whyItMatters:
          "Both sides carry full position risk while the net factor view is a fraction of either. Either this tension is a deliberate spread, or capital is deployed on two contradictory answers to one question.",
        weightPct: undefined,
        rank: rankOf("medium", Math.min(pos, Math.abs(neg)) * 4),
      });
      break; // one factor tension is a finding; four is noise
    }
  }

  return findings.slice(0, 2);
};

/* ────────────────── Registry ────────────────── */

/**
 * Ordered roughly by how structural the finding is — the rank sort decides the
 * final display order, so this order only breaks ties in stable-sort fashion.
 */
export const DETECTORS: Detector[] = [
  hiddenConcentration,
  fundOverlapDetector,
  etfRecreated,
  correlationCluster,
  sectorBet,
  hiddenRiskDriver,
  winnerConcentration,
  anchoringPattern,
  homeBias,
  passengerPositions,
  internalHedge,
];

export function runDetectors(input: IntelligenceInput): IntelligenceFinding[] {
  const ctx = buildDetectorContext(input);
  const findings = DETECTORS.flatMap((d) => {
    try {
      return d(input, ctx);
    } catch {
      // One detector must never take down the run — its absence is disclosed by
      // the finding simply not existing, which is the correct degraded state.
      return [];
    }
  });
  return findings.sort((a, b) => b.rank - a.rank);
}
