/**
 * Pure selectors over a loaded ExposureGraph.
 *
 * Everything the user does after the page paints — trace an issuer, reverse it
 * into a blast radius, fan a fund open, expand a driver, compare two names —
 * resolves through a function in this file, synchronously, against data already
 * in memory. No fetch, no route change, no spinner.
 *
 * That is the whole performance strategy, and it is also a UX strategy: the old
 * graph felt like a network app because it was one, and a click that costs
 * 300ms is a click the user stops making. Exploration has to be free or it does
 * not happen.
 *
 * Client-safe and dependency-free by construction — imported by both the API
 * layer and the page components.
 */

import type {
  DriverNode,
  ExposureGraph,
  IssuerNode,
  PositionNode,
} from "./types";

const round2 = (v: number) => Math.round(v * 100) / 100;

/* ────────────────────────────── Lookups ────────────────────────────── */

export interface GraphIndex {
  positionById: Map<string, PositionNode>;
  positionByLabel: Map<string, PositionNode>;
  issuerById: Map<string, IssuerNode>;
  issuerBySymbol: Map<string, IssuerNode>;
  driverById: Map<string, DriverNode>;
  /** issuer id → the drivers it participates in. */
  driversByIssuer: Map<string, DriverNode[]>;
}

export function indexGraph(graph: ExposureGraph): GraphIndex {
  const driversByIssuer = new Map<string, DriverNode[]>();
  for (const d of graph.drivers) {
    for (const iid of d.issuerIds) {
      const list = driversByIssuer.get(iid) ?? [];
      list.push(d);
      driversByIssuer.set(iid, list);
    }
  }
  return {
    positionById: new Map(graph.positions.map((p) => [p.id, p])),
    positionByLabel: new Map(graph.positions.map((p) => [p.label, p])),
    issuerById: new Map(graph.issuers.map((i) => [i.id, i])),
    issuerBySymbol: new Map(graph.issuers.map((i) => [i.symbol, i])),
    driverById: new Map(graph.drivers.map((d) => [d.id, d])),
    driversByIssuer,
  };
}

/* ────────────────────────────── Trace ────────────────────────────── */

/** One quantified path from the book to an issuer. */
export interface TraceRoute {
  kind: "direct" | "fund";
  positionId: string;
  positionLabel: string;
  /** The wrapper's own weight in the book, %. */
  positionWeightPct: number;
  /** The issuer's effective weight inside that wrapper, %. */
  innerPct: number;
  /** positionWeightPct × innerPct ÷ 100 — the contribution to book, %. */
  bookPct: number;
  /** Intermediate wrappers for a fund-of-funds chain, outermost first. */
  nested: string[];
  basis: "observed" | "derived";
  source: string;
}

export interface IssuerTrace {
  issuer: IssuerNode;
  routes: TraceRoute[];
  /** Sum of route contributions — equals issuer.effectivePct by construction. */
  totalPct: number;
  directPct: number;
  indirectPct: number;
  /** effectivePct − directPct: the part that arrived without being chosen. */
  hiddenPp: number;
  drivers: DriverNode[];
}

/**
 * Every route from the portfolio to one issuer, largest first.
 *
 * This is the function the whole feature exists for. The old graph could say
 * "AAPL is connected to Technology"; this says "6.10% direct, 1.45% through
 * VOO, 1.66% through VGT, 0.62% through SMH" with the arithmetic attached to
 * each band.
 */
export function traceIssuer(
  graph: ExposureGraph,
  index: GraphIndex,
  id: string,
): IssuerTrace | null {
  const issuer = index.issuerById.get(id);
  if (!issuer) return null;

  const routes: TraceRoute[] = [];
  for (const e of graph.edges) {
    if (e.to !== id) continue;
    if (e.kind !== "IS" && e.kind !== "CONTAINS") continue;
    const position = index.positionById.get(e.from);
    if (!position) continue;
    routes.push({
      kind: e.kind === "IS" ? "direct" : "fund",
      positionId: position.id,
      positionLabel: position.label,
      positionWeightPct: position.weightPct,
      innerPct: e.innerPct ?? 0,
      bookPct: e.bookPct ?? 0,
      nested: e.path,
      basis: e.basis,
      source: e.source,
    });
  }

  // Direct first (it is the route the user chose), then by size. Ordering the
  // bands this way makes the picture argue its own point: the chosen route sits
  // at the top and the unchosen ones stack up beneath it.
  routes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "direct" ? -1 : 1;
    return b.bookPct - a.bookPct;
  });

  return {
    issuer,
    routes,
    totalPct: round2(routes.reduce((s, r) => s + r.bookPct, 0)),
    directPct: issuer.directPct,
    indirectPct: issuer.indirectPct,
    hiddenPp: round2(issuer.effectivePct - issuer.directPct),
    drivers: index.driversByIssuer.get(id) ?? [],
  };
}

/* ────────────────────────── Blast radius ────────────────────────── */

export type BlastTrancheKind = "self" | "driver" | "co-movement";

export interface BlastMember {
  issuerId: string;
  symbol: string;
  name: string;
  bookPct: number;
  /** Why this name is in this tranche — the driver's label, or the measured r. */
  reason: string;
}

export interface BlastTranche {
  kind: BlastTrancheKind;
  label: string;
  /** What kind of claim this tranche is. Rendered next to the number, always. */
  claim: "ownership" | "shared exposure" | "estimated";
  bookPct: number;
  members: BlastMember[];
}

export interface BlastRadius {
  issuer: IssuerNode;
  tranches: BlastTranche[];
  /** Sum across tranches. Never presented as a single unqualified figure. */
  totalPct: number;
}

/**
 * The reverse question: if this issuer moves, what else in the book is on the
 * same side of the trade?
 *
 * Three tranches, deliberately never summed into one headline without their
 * labels. Ownership is a fact; a shared driver is a structural relationship; a
 * correlation is an estimate that was true over a past window. Presenting them
 * as one number is how a tool talks its user into believing a derived
 * relationship is a disclosed one — so each carries its `claim` everywhere it
 * is drawn, and each issuer lands in exactly one tranche (strongest wins).
 */
export function blastRadius(
  graph: ExposureGraph,
  index: GraphIndex,
  id: string,
): BlastRadius | null {
  const issuer = index.issuerById.get(id);
  if (!issuer) return null;

  const claimed = new Set<string>([id]);
  const tranches: BlastTranche[] = [
    {
      kind: "self",
      label: `${issuer.symbol} itself`,
      claim: "ownership",
      bookPct: issuer.effectivePct,
      members: [
        {
          issuerId: issuer.id,
          symbol: issuer.symbol,
          name: issuer.name,
          bookPct: issuer.effectivePct,
          reason: `${issuer.directPct > 0 ? `${issuer.directPct.toFixed(2)}% direct` : "no direct position"}, ${issuer.indirectPct.toFixed(2)}% through funds`,
        },
      ],
    },
  ];

  /* Shared drivers — a structural relationship with a named basis. */
  const driverMembers: BlastMember[] = [];
  for (const d of index.driversByIssuer.get(id) ?? []) {
    for (const other of d.issuerIds) {
      if (claimed.has(other)) continue;
      const node = index.issuerById.get(other);
      if (!node) continue;
      claimed.add(other);
      driverMembers.push({
        issuerId: node.id,
        symbol: node.symbol,
        name: node.name,
        bookPct: node.effectivePct,
        reason: `shares ${d.label}`,
      });
    }
  }
  if (driverMembers.length > 0) {
    driverMembers.sort((a, b) => b.bookPct - a.bookPct);
    tranches.push({
      kind: "driver",
      label: "Names sharing a driver",
      claim: "shared exposure",
      bookPct: round2(driverMembers.reduce((s, m) => s + m.bookPct, 0)),
      members: driverMembers,
    });
  }

  /* Measured co-movement — only for directly held lines (see drivers.ts). */
  const co = graph.coMovement;
  const coMembers: BlastMember[] = [];
  if (co && issuer.heldDirectly) {
    const self = co.labels.indexOf(issuer.symbol);
    if (self >= 0) {
      for (let j = 0; j < co.labels.length; j++) {
        if (j === self) continue;
        const r = co.matrix[self]?.[j];
        if (r == null || !Number.isFinite(r) || r < 0.7) continue;
        const node = index.issuerBySymbol.get(co.labels[j]);
        if (!node || claimed.has(node.id)) continue;
        claimed.add(node.id);
        coMembers.push({
          issuerId: node.id,
          symbol: node.symbol,
          name: node.name,
          bookPct: node.effectivePct,
          reason: `moved with ${issuer.symbol} at r=${r.toFixed(2)}`,
        });
      }
    }
  }
  if (coMembers.length > 0) {
    coMembers.sort((a, b) => b.bookPct - a.bookPct);
    tranches.push({
      kind: "co-movement",
      label: "Names that have moved with it",
      claim: "estimated",
      bookPct: round2(coMembers.reduce((s, m) => s + m.bookPct, 0)),
      members: coMembers,
    });
  }

  return {
    issuer,
    tranches,
    totalPct: round2(tranches.reduce((s, t) => s + t.bookPct, 0)),
  };
}

/* ────────────────────────── Position fan-out ────────────────────────── */

export interface FanConstituent {
  issuerId: string;
  symbol: string;
  name: string;
  /** Weight inside this wrapper, %. */
  innerPct: number;
  /** Contribution to the book, %. */
  bookPct: number;
}

export interface PositionOverlap {
  positionId: string;
  label: string;
  sharedCount: number;
  /** Combined book contribution of the names both lines reach. */
  sharedBookPct: number;
}

export interface PositionFan {
  position: PositionNode;
  constituents: FanConstituent[];
  /** % of the FUND covered by the constituents above. */
  disclosedPct: number;
  /** The rest of the fund. Drawn as a hatched band, never omitted. */
  undisclosedPct: number;
  /** Book contribution of the disclosed slice. */
  disclosedBookPct: number;
  /** Other lines that reach some of the same issuers. */
  overlaps: PositionOverlap[];
  /** Effective exposures this line is the largest contributor to. */
  dominates: { issuerId: string; symbol: string; bookPct: number; sharePct: number }[];
}

export function positionFan(
  graph: ExposureGraph,
  index: GraphIndex,
  id: string,
): PositionFan | null {
  const position = index.positionById.get(id);
  if (!position) return null;

  const constituents: FanConstituent[] = [];
  for (const e of graph.edges) {
    if (e.from !== id) continue;
    if (e.kind !== "CONTAINS" && e.kind !== "IS") continue;
    const issuer = index.issuerById.get(e.to);
    if (!issuer) continue;
    constituents.push({
      issuerId: issuer.id,
      symbol: issuer.symbol,
      name: issuer.name,
      innerPct: e.innerPct ?? 0,
      bookPct: e.bookPct ?? 0,
    });
  }
  constituents.sort((a, b) => b.bookPct - a.bookPct);

  const reached = new Set(constituents.map((c) => c.issuerId));

  /* Which other ledger lines reach the same companies. This is the fund-overlap
     finding, but reachable from any position rather than only when a detector
     fired on it. */
  const byPosition = new Map<string, { count: number; pct: number }>();
  for (const e of graph.edges) {
    if (e.from === id) continue;
    if (e.kind !== "CONTAINS" && e.kind !== "IS") continue;
    if (!reached.has(e.to)) continue;
    const acc = byPosition.get(e.from) ?? { count: 0, pct: 0 };
    acc.count++;
    acc.pct += e.bookPct ?? 0;
    byPosition.set(e.from, acc);
  }
  const overlaps: PositionOverlap[] = [...byPosition.entries()]
    .map(([pid, acc]) => ({
      positionId: pid,
      label: index.positionById.get(pid)?.label ?? pid,
      sharedCount: acc.count,
      sharedBookPct: round2(acc.pct),
    }))
    .sort((a, b) => b.sharedBookPct - a.sharedBookPct);

  /* Where this line is the dominant route — the sentence that reframes an index
     fund from "diversification" into "the biggest single source of my top
     exposures". */
  const dominates = constituents
    .map((c) => {
      const issuer = index.issuerById.get(c.issuerId);
      const total = issuer?.effectivePct ?? 0;
      return {
        issuerId: c.issuerId,
        symbol: c.symbol,
        bookPct: c.bookPct,
        sharePct: total > 0 ? round2((c.bookPct / total) * 100) : 0,
      };
    })
    .filter((d) => d.sharePct >= 50)
    .sort((a, b) => b.bookPct - a.bookPct);

  const lt = position.lookThrough;
  return {
    position,
    constituents,
    disclosedPct: lt?.disclosedPct ?? (position.isFund ? 0 : 100),
    undisclosedPct: lt?.undisclosedPct ?? 0,
    disclosedBookPct: round2(constituents.reduce((s, c) => s + c.bookPct, 0)),
    overlaps,
    dominates,
  };
}

/* ────────────────────────── Driver expansion ────────────────────────── */

export interface DriverMember {
  issuer: IssuerNode;
  /** How this issuer's exposure arrives — the route mix, largest first. */
  routes: TraceRoute[];
}

export interface DriverView {
  driver: DriverNode;
  members: DriverMember[];
  /** Ledger lines the driver's exposure flows through, largest contribution first. */
  positions: { positionId: string; label: string; bookPct: number }[];
}

export function driverView(
  graph: ExposureGraph,
  index: GraphIndex,
  id: string,
): DriverView | null {
  const driver = index.driverById.get(id);
  if (!driver) return null;

  const members: DriverMember[] = [];
  const byPosition = new Map<string, number>();
  for (const iid of driver.issuerIds) {
    const trace = traceIssuer(graph, index, iid);
    if (!trace) continue;
    members.push({ issuer: trace.issuer, routes: trace.routes });
    for (const r of trace.routes) {
      byPosition.set(r.positionId, round2((byPosition.get(r.positionId) ?? 0) + r.bookPct));
    }
  }
  members.sort((a, b) => b.issuer.effectivePct - a.issuer.effectivePct);

  return {
    driver,
    members,
    positions: [...byPosition.entries()]
      .map(([positionId, bookPct]) => ({
        positionId,
        label: index.positionById.get(positionId)?.label ?? positionId,
        bookPct,
      }))
      .sort((a, b) => b.bookPct - a.bookPct),
  };
}

/* ────────────────────────── Two-issuer comparison ────────────────────────── */

export interface SharedRoute {
  positionId: string;
  label: string;
  aPct: number;
  bPct: number;
}

export interface Comparison {
  a: IssuerNode;
  b: IssuerNode;
  sharedRoutes: SharedRoute[];
  sharedDrivers: DriverNode[];
  correlation: { r: number; window: string } | null;
  /** Combined effective exposure of the two names. */
  combinedPct: number;
  /** Book value arriving at either name through a line they share. */
  sharedRoutePct: number;
  /** False when nothing links them — a real answer, rendered as one. */
  related: boolean;
}

/**
 * Why are these two connected?
 *
 * A negative result is a genuine finding here, so this deliberately returns a
 * populated object with `related: false` rather than null. "These two names
 * share no route, no driver and no measurable co-movement" is worth knowing —
 * it means the diversification between them is real.
 */
export function compareIssuers(
  graph: ExposureGraph,
  index: GraphIndex,
  aId: string,
  bId: string,
): Comparison | null {
  const a = index.issuerById.get(aId);
  const b = index.issuerById.get(bId);
  if (!a || !b || a.id === b.id) return null;

  const routesOf = (id: string) => {
    const m = new Map<string, number>();
    for (const e of graph.edges) {
      if (e.to !== id) continue;
      if (e.kind !== "CONTAINS" && e.kind !== "IS") continue;
      m.set(e.from, round2((m.get(e.from) ?? 0) + (e.bookPct ?? 0)));
    }
    return m;
  };
  const ra = routesOf(aId);
  const rb = routesOf(bId);

  const sharedRoutes: SharedRoute[] = [];
  for (const [positionId, aPct] of ra) {
    const bPct = rb.get(positionId);
    if (bPct == null) continue;
    sharedRoutes.push({
      positionId,
      label: index.positionById.get(positionId)?.label ?? positionId,
      aPct,
      bPct,
    });
  }
  sharedRoutes.sort((x, y) => y.aPct + y.bPct - (x.aPct + x.bPct));

  const aDrivers = new Set((index.driversByIssuer.get(aId) ?? []).map((d) => d.id));
  const sharedDrivers = (index.driversByIssuer.get(bId) ?? []).filter((d) => aDrivers.has(d.id));

  let correlation: Comparison["correlation"] = null;
  const co = graph.coMovement;
  if (co) {
    const i = co.labels.indexOf(a.symbol);
    const j = co.labels.indexOf(b.symbol);
    if (i >= 0 && j >= 0) {
      const r = co.matrix[i]?.[j];
      if (r != null && Number.isFinite(r)) correlation = { r: round2(r), window: co.window };
    }
  }

  return {
    a,
    b,
    sharedRoutes,
    sharedDrivers,
    correlation,
    combinedPct: round2(a.effectivePct + b.effectivePct),
    sharedRoutePct: round2(sharedRoutes.reduce((s, r) => s + r.aPct + r.bPct, 0)),
    related: sharedRoutes.length > 0 || sharedDrivers.length > 0,
  };
}

/* ────────────────────────── Overlap between two funds ────────────────────────── */

export interface FundOverlapView {
  a: PositionNode;
  b: PositionNode;
  shared: { issuerId: string; symbol: string; name: string; aPct: number; bPct: number }[];
  /** Combined book value the two lines both route to the same companies. */
  sharedBookPct: number;
  combinedWeightPct: number;
}

export function fundOverlapView(
  graph: ExposureGraph,
  index: GraphIndex,
  aId: string,
  bId: string,
): FundOverlapView | null {
  const a = index.positionById.get(aId);
  const b = index.positionById.get(bId);
  if (!a || !b) return null;

  const reach = (id: string) => {
    const m = new Map<string, number>();
    for (const e of graph.edges) {
      if (e.from !== id) continue;
      if (e.kind !== "CONTAINS" && e.kind !== "IS") continue;
      m.set(e.to, round2((m.get(e.to) ?? 0) + (e.bookPct ?? 0)));
    }
    return m;
  };
  const ra = reach(aId);
  const rb = reach(bId);

  const shared: FundOverlapView["shared"] = [];
  for (const [issuerIdKey, aPct] of ra) {
    const bPct = rb.get(issuerIdKey);
    if (bPct == null) continue;
    const issuer = index.issuerById.get(issuerIdKey);
    if (!issuer) continue;
    shared.push({
      issuerId: issuer.id,
      symbol: issuer.symbol,
      name: issuer.name,
      aPct,
      bPct,
    });
  }
  shared.sort((x, y) => y.aPct + y.bPct - (x.aPct + x.bPct));

  return {
    a,
    b,
    shared,
    sharedBookPct: round2(shared.reduce((s, x) => s + x.aPct + x.bPct, 0)),
    combinedWeightPct: round2(a.weightPct + b.weightPct),
  };
}

/* ────────────────────────── Neighbourhood ────────────────────────── */

export interface Neighbour {
  id: string;
  label: string;
  kind: "position" | "issuer" | "driver";
  /** The magnitude that justifies showing it, % of book. */
  bookPct: number;
  /** One phrase naming the relationship. */
  relation: string;
}

/**
 * What the user can meaningfully click next, from wherever they are.
 *
 * This is what turns a set of views into a web: every node knows its onward
 * links, so exploration never dead-ends and the user is never returned to a
 * start screen to pick a new subject.
 */
export function neighboursOf(
  graph: ExposureGraph,
  index: GraphIndex,
  id: string,
  limit = 12,
): Neighbour[] {
  const out: Neighbour[] = [];

  if (id.startsWith("issuer:")) {
    const trace = traceIssuer(graph, index, id);
    if (!trace) return [];
    for (const r of trace.routes) {
      out.push({
        id: r.positionId,
        label: r.positionLabel,
        kind: "position",
        bookPct: r.bookPct,
        relation: r.kind === "direct" ? "held directly" : `${r.innerPct.toFixed(1)}% of this line`,
      });
    }
    for (const d of trace.drivers) {
      out.push({
        id: d.id,
        label: d.label,
        kind: "driver",
        bookPct: d.bookPct,
        relation: `${d.issuerIds.length} names share it`,
      });
    }
  } else if (id.startsWith("position:")) {
    const fan = positionFan(graph, index, id);
    if (!fan) return [];
    for (const c of fan.constituents) {
      out.push({
        id: c.issuerId,
        label: c.symbol,
        kind: "issuer",
        bookPct: c.bookPct,
        relation: `${c.innerPct.toFixed(1)}% of this line`,
      });
    }
    for (const o of fan.overlaps.slice(0, 4)) {
      out.push({
        id: o.positionId,
        label: o.label,
        kind: "position",
        bookPct: o.sharedBookPct,
        relation: `${o.sharedCount} names in common`,
      });
    }
  } else if (id.startsWith("driver:")) {
    const view = driverView(graph, index, id);
    if (!view) return [];
    for (const m of view.members) {
      out.push({
        id: m.issuer.id,
        label: m.issuer.symbol,
        kind: "issuer",
        bookPct: m.issuer.effectivePct,
        relation: `${m.routes.length} route${m.routes.length === 1 ? "" : "s"}`,
      });
    }
    for (const p of view.positions.slice(0, 4)) {
      out.push({
        id: p.positionId,
        label: p.label,
        kind: "position",
        bookPct: p.bookPct,
        relation: "carries this driver",
      });
    }
  }

  return out.sort((a, b) => b.bookPct - a.bookPct).slice(0, limit);
}

/** Resolve a finding's `explore` target to a node id + view the page can open. */
export function resolveExplore(
  index: GraphIndex,
  explore: { kind: string; target: string },
): { nodeId: string; view: string; secondaryId?: string } | null {
  if (explore.kind === "trace") {
    const issuer = index.issuerBySymbol.get(explore.target.toUpperCase());
    return issuer ? { nodeId: issuer.id, view: "trace" } : null;
  }
  if (explore.kind === "position") {
    const p = index.positionByLabel.get(explore.target.toUpperCase());
    return p ? { nodeId: p.id, view: "position" } : null;
  }
  if (explore.kind === "overlap") {
    const [a, b] = explore.target.split("+");
    const pa = index.positionByLabel.get((a ?? "").toUpperCase());
    const pb = index.positionByLabel.get((b ?? "").toUpperCase());
    return pa && pb ? { nodeId: pa.id, view: "overlap", secondaryId: pb.id } : null;
  }
  if (explore.kind === "cluster") {
    const members = explore.target.split("+");
    // A cluster of ledger lines: open the two largest as a comparison when both
    // resolve to issuers, else fall back to tracing the largest.
    const issuers = members
      .map((m) => index.issuerBySymbol.get(m.toUpperCase()))
      .filter((x): x is IssuerNode => x != null)
      .sort((a, b) => b.effectivePct - a.effectivePct);
    if (issuers.length >= 2) {
      return { nodeId: issuers[0].id, view: "compare", secondaryId: issuers[1].id };
    }
    if (issuers.length === 1) return { nodeId: issuers[0].id, view: "trace" };
    const p = index.positionByLabel.get((members[0] ?? "").toUpperCase());
    return p ? { nodeId: p.id, view: "position" } : null;
  }
  return null;
}
