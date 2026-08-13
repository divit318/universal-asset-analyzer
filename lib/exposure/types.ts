/**
 * The Exposure model — "what do I actually own, how did I end up owning it,
 * and what else moves with it?"
 *
 * The governing distinction, and the reason this module replaced the old
 * knowledge graph wholesale:
 *
 *   A POSITION is a line the user bought. An ISSUER is a company the user
 *   ultimately owns. They are different node types.
 *
 * The previous model had a single `company` node for both, so "I own NVDA
 * through VOO" could only ever be a string on an edge — the converging routes
 * that make this domain graph-shaped collapsed into one undifferentiated blob.
 * Splitting them is what makes every view in app/exposure/ expressible.
 *
 * Everything here is DERIVED from measured inputs (ledger weights, the
 * provider's disclosed fund constituents, measured return series). Nothing in
 * this module invents a relationship, and no edge exists without a magnitude:
 * an edge that cannot state its contribution in percent of book is not an edge,
 * it is taxonomy, and taxonomy is what made the old graph useless.
 *
 * Client-safe: pure types + pure helpers, no I/O, no node: imports. The page
 * components import from here directly.
 */

import type { IntelligenceFinding } from "../portfolio/intelligence/types";
import type { PortfolioAssetClass } from "../portfolio/model/types";
import type { FundSectorWeight } from "../types";

/* ────────────────────────────── Nodes ────────────────────────────── */

export type NodeKind = "portfolio" | "position" | "issuer" | "driver";

/** The book. Exactly one, and the source or sink of every trace. */
export interface PortfolioNode {
  id: "portfolio";
  kind: "portfolio";
  label: string;
  totalValue: number;
  baseCurrency: string;
  holdingCount: number;
}

/** What the fund discloses about its own inside. Absent = opaque wrapper. */
export interface PositionLookThrough {
  /** Combined weight of the disclosed constituents, % OF THE FUND. */
  disclosedPct: number;
  /**
   * 100 − disclosedPct. Rendered as a hatched band rather than a footnote:
   * the provider shows ten names, and a picture that silently omits the other
   * 70% of a fund is the single most misleading thing this page could draw.
   */
  undisclosedPct: number;
  category: string | null;
  sectorWeights: FundSectorWeight[] | null;
  equityWeightPct: number | null;
}

/** A line in the ledger — what the user actually bought. */
export interface PositionNode {
  id: string; // `position:LABEL`
  kind: "position";
  /** Ledger label: symbol when there is one, else the name. Uppercased. */
  label: string;
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  /** % of book value. */
  weightPct: number;
  valueBase: number;
  unrealizedPct: number | null;
  /** True for wrappers that can be looked through (etf/bond/commodity/reit). */
  isFund: boolean;
  /** Non-null only for funds whose constituents the provider disclosed. */
  lookThrough: PositionLookThrough | null;
  /** A fund wrapper the provider reported nothing for — named, never estimated. */
  opaque: boolean;
  href: string | null;
}

/** A company the book ultimately owns, reached directly, through funds, or both. */
export interface IssuerNode {
  id: string; // `issuer:SYMBOL`
  kind: "issuer";
  symbol: string;
  name: string;
  /** directPct + indirectPct. A FLOOR — see ExposureCoverage.basis. */
  effectivePct: number;
  directPct: number;
  indirectPct: number;
  /** Distinct ways the book reaches this issuer; direct counts as one. */
  routeCount: number;
  /** Yahoo `assetProfile.industry`. Null until the drivers pass resolves it. */
  industry: string | null;
  /** Canonical GICS-11 when known. */
  sector: string | null;
  /** True when the book holds this issuer as its own line. */
  heldDirectly: boolean;
  href: string;
}

/**
 * Why a driver exists. A driver with no basis is a hunch, and this page does
 * not render hunches — every substrate below is checkable against a source the
 * user can go read.
 */
export type DriverBasisKind = "industry" | "co-membership" | "co-movement";

export interface DriverBasis {
  kind: DriverBasisKind;
  /** Human sentence naming the source: "Yahoo industry classification". */
  detail: string;
  /** How many issuers this substrate accounts for. */
  n: number;
  /** Mean pairwise r, for co-movement only. */
  strength: number | null;
  /** The measurement window, for co-movement only. */
  window: string | null;
  /** The reference fund, for co-membership only. */
  via: string | null;
}

/**
 * A shared exposure across issuers that look unrelated in a holdings list.
 *
 * Admission is deliberately strict (see drivers.ts): a named basis, at least
 * two issuers, and at least MIN_DRIVER_BOOK_PCT of book. A "driver" that
 * describes 0.4% of the portfolio is a fact about the market, not about this
 * user, and it belongs on some other page.
 */
export interface DriverNode {
  id: string; // `driver:slug`
  kind: "driver";
  label: string;
  /** Non-empty by construction. */
  basis: DriverBasis[];
  issuerIds: string[];
  /** Combined effective exposure of the member issuers, % of book. */
  bookPct: number;
  /** Distinct ledger lines the exposure arrives through. */
  positionCount: number;
  /**
   * True when a model supplied the display label over a deterministic cluster.
   * The membership and the arithmetic are never AI's; only the words are, and
   * the UI says so.
   */
  labelFromAi: boolean;
}

export type ExposureNode = PortfolioNode | PositionNode | IssuerNode | DriverNode;

/* ────────────────────────────── Edges ────────────────────────────── */

/**
 * HOLDS    portfolio → position   the ledger line's weight
 * IS       position  → issuer     a direct equity: the line IS the company
 * CONTAINS position  → issuer     disclosed fund constituent, contribution
 * SHARES   issuer    → driver     participation in a shared exposure
 *
 * Four types, down from thirteen. Everything deleted (OPERATES_IN, WATCHES,
 * ROTATES_TO, CONSTITUENT…) restated a lookup the user could do faster in the
 * holdings table, which is what made a graph of them feel like a demo.
 */
export type EdgeKind = "HOLDS" | "IS" | "CONTAINS" | "SHARES";

export interface ExposureEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /**
   * Percentage points of BOOK value flowing along this edge. Null ONLY for
   * SHARES, which describes co-participation rather than a flow of money.
   */
  bookPct: number | null;
  /** For CONTAINS: the issuer's weight INSIDE the wrapper, %. */
  innerPct: number | null;
  /** The intermediate wrappers, outermost first — non-empty for nested funds. */
  path: string[];
  /** "observed" came from a provider or the ledger; "derived" was computed here. */
  basis: "observed" | "derived";
  /** Where the fact came from, named so the reader can go check it. */
  source: string;
  asOf: string | null;
}

/* ────────────────────────────── Coverage ────────────────────────────── */

/**
 * What the model could NOT see. Rendered at the top of the page, not in a
 * footnote — a look-through number without its coverage is a claim about the
 * whole fund made from a tenth of it.
 */
export interface ExposureCoverage {
  /** Fund lines whose constituents the provider disclosed. */
  fundsAnalyzed: number;
  /** Fund lines the provider reported nothing for. Named, never estimated. */
  fundsOpaque: string[];
  /** % of fund-held value the look-through could see into. */
  lookThroughPct: number;
  /** % of book that maps to at least one issuer (equities, REITs, equity funds). */
  issuerMappedPct: number;
  /** Positions with no issuer decomposition — cash, crypto, commodities, bonds. */
  unmappedLabels: string[];
  /** The floors-not-totals sentence, rendered verbatim wherever a total appears. */
  basis: string;
  /** Quote/valuation timestamp of the underlying report. */
  asOf: string;
}

/* ────────────────────────── Measured co-movement ────────────────────────── */

/**
 * Pairwise return correlation, restricted to DIRECTLY HELD lines.
 *
 * A structural limit worth stating plainly: correlation needs a return series,
 * and the app has series for what the user holds — not for the 60-odd issuers
 * reached only through a wrapper. So co-movement can relate NVDA to AMD when
 * both are held, and cannot relate two names that live only inside VOO. The UI
 * says which pairs are measurable rather than filling the gap with zeroes.
 */
export interface CoMovement {
  /** Position labels, index-aligned with `matrix`. */
  labels: string[];
  /** Pairwise r; NaN where the overlap was too short to measure. */
  matrix: number[][];
  window: string;
  /** Holdings with no honest return series — excluded, never zero-filled. */
  excluded: string[];
}

/* ────────────────────────────── The model ────────────────────────────── */

/** Headline arithmetic for the concentration ribbon. */
export interface ConcentrationSummary {
  /** The top issuers by effective exposure. */
  topIssuerIds: string[];
  /** Their combined effective weight, % of book. */
  effectivePct: number;
  /** What the SAME names show as direct positions, % of book. */
  statedPct: number;
  /** effectivePct − statedPct, in percentage points. */
  hiddenPp: number;
}

/**
 * Stage 1: everything computable from the (already cached) portfolio report
 * plus fund constituents. Fast, and complete enough to trace, inspect any
 * position, run a blast radius and read every finding.
 */
export interface ExposureModel {
  generatedAt: string;
  baseCurrency: string;
  portfolio: PortfolioNode;
  positions: PositionNode[];
  issuers: IssuerNode[];
  edges: ExposureEdge[];
  concentration: ConcentrationSummary;
  coverage: ExposureCoverage;
  coMovement: CoMovement | null;
  /** From the Portfolio Intelligence detectors — this page does not detect. */
  findings: IntelligenceFinding[];
}

/**
 * Stage 2: drivers, loaded separately because they need per-issuer industry
 * profiles and a set of reference-fund probes — tens of provider calls that
 * have no business blocking the first paint. Merged client-side.
 */
export interface ExposureDrivers {
  generatedAt: string;
  drivers: DriverNode[];
  /** SHARES edges only. */
  edges: ExposureEdge[];
  /** Issuers whose industry could not be resolved — shown as unresolved. */
  unresolved: string[];
  /** Reference funds probed for co-membership, so the basis is checkable. */
  probes: string[];
  /**
   * issuer symbol → industry, back-filled onto IssuerNode once this lands.
   * Carried here rather than re-fetched by the client: the drivers pass already
   * paid for these, and an inspector that has to fetch a company profile to
   * print one word is exactly the per-click round-trip this design avoids.
   */
  industries: Record<string, string>;
}

/** The merged view the UI actually renders. */
export interface ExposureGraph extends ExposureModel {
  drivers: DriverNode[];
  driverEdges: ExposureEdge[];
  driversState: "pending" | "ready" | "unavailable";
  unresolvedIssuers: string[];
  probes: string[];
}

/* ────────────────────────────── Helpers ────────────────────────────── */

export const positionId = (label: string) => `position:${label.toUpperCase()}`;
export const issuerId = (symbol: string) => `issuer:${symbol.toUpperCase()}`;
export const driverId = (slug: string) => `driver:${slug}`;

export function nodeKindOf(id: string): NodeKind | null {
  if (id === "portfolio") return "portfolio";
  if (id.startsWith("position:")) return "position";
  if (id.startsWith("issuer:")) return "issuer";
  if (id.startsWith("driver:")) return "driver";
  return null;
}

/** Stable, URL-safe id for a driver label. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export const LOOK_THROUGH_BASIS =
  "Computed from each fund's top disclosed holdings (the provider reports ten). " +
  "The undisclosed remainder is never attributed, so every effective exposure here " +
  "is a floor, not a total — the true figure can only be higher.";
