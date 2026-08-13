/**
 * Drivers — "these five apparently different holdings are the same bet".
 *
 * A driver is the one node type on this page that is not a thing the user
 * bought or a company they own, so it is the one with the greatest capacity to
 * be nonsense. The whole design of this module is a set of constraints against
 * that:
 *
 *   1. Three substrates, all deterministic and all checkable by the reader:
 *      an industry classification, a co-membership disclosure, and a measured
 *      correlation. Nothing else creates a driver.
 *   2. A driver must relate at least MIN_DRIVER_ISSUERS issuers and account for
 *      at least MIN_DRIVER_BOOK_PCT of book, or it is not drawn.
 *   3. Every basis records what it is, how many issuers it covers, and where it
 *      came from. The UI renders that verbatim under the driver's headline.
 *   4. AI may rename a cluster. It may never create one, join one, or move a
 *      number. See narrateDriverLabels in ./label.ts.
 *
 * The co-movement substrate has a structural limit worth stating rather than
 * hiding: correlation needs a return series, and the app has series for what
 * the user HOLDS — not for the sixty-odd issuers reached only through a
 * wrapper. So co-movement can relate two directly-held names and cannot relate
 * two names living inside VOO. It is disclosed on the driver, not papered over.
 */

import { getQuoteSummary } from "../yahoo";
import { getFundDetails } from "../screener/universes/fund-shared";
import { mapPool, withRetry } from "../screener/metrics-util";
import { canonicalIssuerSymbol } from "../portfolio/intelligence/lookthrough";
import { canonicalizeSector } from "../gics-sectors";
import {
  CO_MOVEMENT_R,
  MAX_PROFILED_ISSUERS,
  MIN_DRIVER_BOOK_PCT,
  MIN_DRIVER_ISSUERS,
  PROBE_SYMBOLS,
  THEME_PROBES,
} from "./reference";
import {
  driverId,
  issuerId,
  slugify,
  type DriverBasis,
  type DriverNode,
  type ExposureDrivers,
  type ExposureEdge,
  type ExposureModel,
  type IssuerNode,
} from "./types";

const round2 = (v: number) => Math.round(v * 100) / 100;

/* ────────────────────────── Industry resolution ────────────────────────── */

export interface IssuerProfile {
  industry: string | null;
  sector: string | null;
}

interface RawAssetProfile {
  assetProfile?: { industry?: string | null; sector?: string | null };
}

/**
 * Industry for the issuers that matter, ranked by effective weight.
 *
 * Bounded on purpose: the cut always falls on the names contributing least, and
 * the tail is returned as `unresolved` so the UI can say "12 smaller issuers
 * not classified" instead of quietly implying the classification is complete.
 * Each call is the platform-cached `quoteSummary` dataset (4h TTL, persisted),
 * so this is expensive exactly once.
 */
export async function fetchIssuerProfiles(
  issuers: IssuerNode[],
): Promise<{ profiles: Map<string, IssuerProfile>; unresolved: string[] }> {
  const ranked = [...issuers].sort((a, b) => b.effectivePct - a.effectivePct);
  const targets = ranked.slice(0, MAX_PROFILED_ISSUERS);
  const skipped = ranked.slice(MAX_PROFILED_ISSUERS).map((i) => i.symbol);

  const profiles = new Map<string, IssuerProfile>();
  const failed: string[] = [];

  await mapPool(targets, 6, async (issuer) => {
    const raw = await withRetry(
      () => getQuoteSummary(issuer.symbol, ["assetProfile"]) as Promise<RawAssetProfile>,
      2,
    );
    const industry = raw?.assetProfile?.industry?.trim() || null;
    const sector = raw?.assetProfile?.sector?.trim() || null;
    if (!industry && !sector) {
      failed.push(issuer.symbol);
      return;
    }
    profiles.set(issuer.symbol, {
      industry,
      sector: sector ? canonicalizeSector(sector) : null,
    });
  });

  return { profiles, unresolved: [...failed, ...skipped].sort() };
}

/* ────────────────────────── Co-membership probes ────────────────────────── */

export interface ProbeMembership {
  /** Probe fund symbol. */
  via: string;
  label: string;
  /** Canonical issuer symbol → its weight inside the probe fund, %. */
  members: Map<string, number>;
}

/** Disclosed top-ten membership for each reference fund. Platform-cached. */
export async function fetchProbeMemberships(): Promise<ProbeMembership[]> {
  const details = await getFundDetails(PROBE_SYMBOLS);
  const out: ProbeMembership[] = [];
  for (const probe of THEME_PROBES) {
    const d = details.get(probe.symbol);
    if (!d?.topHoldings || d.topHoldings.length === 0) continue;
    const members = new Map<string, number>();
    for (const h of d.topHoldings) {
      if (!h.symbol) continue;
      members.set(canonicalIssuerSymbol(h.symbol), h.weightPercent);
    }
    if (members.size > 0) out.push({ via: probe.symbol, label: probe.label, members });
  }
  return out;
}

/* ────────────────────────── Assembly ────────────────────────── */

interface Candidate {
  label: string;
  members: Set<string>; // issuer symbols
  basis: DriverBasis[];
}

/** How many ledger lines the exposure to this set of issuers arrives through. */
function positionsBehind(model: ExposureModel, symbols: Set<string>): number {
  const lines = new Set<string>();
  for (const e of model.edges) {
    if (e.kind !== "CONTAINS" && e.kind !== "IS") continue;
    const sym = e.to.slice("issuer:".length);
    if (symbols.has(sym)) lines.add(e.from);
  }
  return lines.size;
}

function bookPctOf(bySymbol: Map<string, IssuerNode>, symbols: Set<string>): number {
  let total = 0;
  for (const s of symbols) total += bySymbol.get(s)?.effectivePct ?? 0;
  return round2(total);
}

/**
 * Merge candidates that describe the same bet.
 *
 * Without this, a group of semiconductor names produces an "industry:
 * Semiconductors" driver AND a "co-membership in SMH" driver AND a co-movement
 * driver — three nodes, one bet, and a page that looks like it is padding.
 * Worse, the first two carry the SAME LABEL, so the reader sees "Semiconductors
 * 23.4%" directly above "Semiconductors 20.4%" and has no way to tell what the
 * difference is meant to mean. (Both were true on a real book; this is measured,
 * not hypothetical.)
 *
 * Two candidates merge when they carry the same label, or when their
 * memberships overlap heavily — the substrates rarely agree name-for-name (an
 * industry classifier catches a semi the reference fund's top ten misses), and
 * demanding exact equality is what let the duplicate through. The merged driver
 * takes the UNION of members and keeps BOTH bases with their own coverage
 * counts, which is the strongest thing this page can say: two independent
 * sources, neither of them a model, put these names together.
 */
const MERGE_JACCARD = 0.5;

function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const c of candidates) {
    const twin = merged.find(
      (m) =>
        m.label.toLowerCase() === c.label.toLowerCase() ||
        jaccard(m.members, c.members) >= MERGE_JACCARD,
    );
    if (!twin) {
      merged.push({ ...c, members: new Set(c.members), basis: [...c.basis] });
      continue;
    }
    for (const x of c.members) twin.members.add(x);
    for (const b of c.basis) {
      // One basis per (kind, source): re-merging never inflates the evidence.
      if (!twin.basis.some((existing) => existing.kind === b.kind && existing.via === b.via)) {
        twin.basis.push(b);
      }
    }
    // Prefer the label from the more specific substrate: a disclosure-backed
    // theme name ("Semiconductors" from SMH) reads better than a raw industry
    // string, and both beat a list of tickers.
    if (rankLabel(c) > rankLabel(twin)) twin.label = c.label;
  }
  return merged;
}

/** |A ∩ B| / |A ∪ B| — 1 when the two describe exactly the same names. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

const LABEL_RANK: Record<DriverBasis["kind"], number> = {
  "co-membership": 3,
  industry: 2,
  "co-movement": 1,
};

const rankLabel = (c: Candidate) => Math.max(...c.basis.map((b) => LABEL_RANK[b.kind]));

/**
 * Drop a candidate wholly contained in a bigger one that shares a basis kind.
 *
 * "Semiconductors" (6 names, 17.4%) and "Semiconductors ∩ co-moving" (3 of
 * those names, 9.1%) are the same insight at two resolutions, and the smaller
 * one earns its place only by being separately actionable — which a strict
 * subset never is.
 */
function dropSubsets(drivers: Candidate[]): Candidate[] {
  return drivers.filter(
    (c) =>
      !drivers.some(
        (other) =>
          other !== c &&
          other.members.size > c.members.size &&
          [...c.members].every((m) => other.members.has(m)),
      ),
  );
}

export interface DriverInputs {
  profiles: Map<string, IssuerProfile>;
  memberships: ProbeMembership[];
  unresolved: string[];
}

/**
 * Pure: assemble drivers from the model plus the fetched substrates. Separated
 * from the I/O above so the admission rules are unit-testable against fixtures.
 */
export function assembleDrivers(model: ExposureModel, inputs: DriverInputs): ExposureDrivers {
  const bySymbol = new Map(model.issuers.map((i) => [i.symbol, i]));
  const candidates: Candidate[] = [];

  /* 1. Industry — structural, near-complete coverage, and far more useful than
        sector: "Semiconductors" is an economic exposure, "Technology" is a
        filing category that also contains Adobe and Visa. */
  const byIndustry = new Map<string, Set<string>>();
  for (const issuer of model.issuers) {
    const industry = inputs.profiles.get(issuer.symbol)?.industry;
    if (!industry) continue;
    const set = byIndustry.get(industry) ?? new Set<string>();
    set.add(issuer.symbol);
    byIndustry.set(industry, set);
  }
  for (const [industry, members] of byIndustry) {
    if (members.size < MIN_DRIVER_ISSUERS) continue;
    candidates.push({
      label: industry,
      members,
      basis: [
        {
          kind: "industry",
          detail: "Yahoo industry classification",
          n: members.size,
          strength: null,
          window: null,
          via: null,
        },
      ],
    });
  }

  /* 2. Co-membership — the substrate that produces a THEME rather than a
        taxonomy bucket, and does it from a disclosure the reader can check. */
  for (const probe of inputs.memberships) {
    const members = new Set<string>();
    for (const symbol of probe.members.keys()) {
      if (bySymbol.has(symbol)) members.add(symbol);
    }
    if (members.size < MIN_DRIVER_ISSUERS) continue;
    candidates.push({
      label: probe.label,
      members,
      basis: [
        {
          kind: "co-membership",
          detail: `Disclosed top-ten constituents of ${probe.via}`,
          n: members.size,
          strength: null,
          window: null,
          via: probe.via,
        },
      ],
    });
  }

  /* 3. Co-movement — measured, and available only for directly held lines
        (see the module header). Union-find over pairs at or above the
        threshold; an unmeasurable pair never joins, because unknown
        correlation is not high correlation. */
  const co = model.coMovement;
  if (co) {
    const heldIssuers = new Set(model.issuers.filter((i) => i.heldDirectly).map((i) => i.symbol));
    const idx = co.labels
      .map((label, i) => ({ symbol: canonicalIssuerSymbol(label), i }))
      .filter((x) => heldIssuers.has(x.symbol));

    const parent = new Map<string, string>(idx.map((x) => [x.symbol, x.symbol]));
    const find = (s: string): string => {
      const p = parent.get(s)!;
      if (p === s) return s;
      const root = find(p);
      parent.set(s, root);
      return root;
    };
    const rSum = new Map<string, { sum: number; n: number }>();

    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const r = co.matrix[idx[a].i]?.[idx[b].i];
        if (r == null || !Number.isFinite(r) || r < CO_MOVEMENT_R) continue;
        const ra = find(idx[a].symbol);
        const rb = find(idx[b].symbol);
        if (ra !== rb) parent.set(ra, rb);
        const key = find(idx[a].symbol);
        const acc = rSum.get(key) ?? { sum: 0, n: 0 };
        rSum.set(key, { sum: acc.sum + r, n: acc.n + 1 });
      }
    }

    const groups = new Map<string, Set<string>>();
    for (const { symbol } of idx) {
      const root = find(symbol);
      const g = groups.get(root) ?? new Set<string>();
      g.add(symbol);
      groups.set(root, g);
    }
    for (const [root, members] of groups) {
      if (members.size < MIN_DRIVER_ISSUERS) continue;
      // Re-key the accumulated r onto the settled root: union-find compresses
      // paths as it goes, so the key an r was filed under may no longer be one.
      let sum = 0;
      let n = 0;
      for (const [key, acc] of rSum) {
        if (find(key) !== root) continue;
        sum += acc.sum;
        n += acc.n;
      }
      candidates.push({
        label: `${[...members].sort().join(" · ")}`,
        members,
        basis: [
          {
            kind: "co-movement",
            detail: `Measured daily-return correlation at or above r=${CO_MOVEMENT_R}`,
            n: members.size,
            strength: n > 0 ? round2(sum / n) : null,
            window: co.window,
            via: null,
          },
        ],
      });
    }
  }

  /* Admission. */
  const surviving = dropSubsets(mergeCandidates(candidates)).filter((c) => {
    if (c.members.size < MIN_DRIVER_ISSUERS) return false;
    return bookPctOf(bySymbol, c.members) >= MIN_DRIVER_BOOK_PCT;
  });

  const drivers: DriverNode[] = surviving
    .map((c) => {
      const members = [...c.members].sort(
        (a, b) => (bySymbol.get(b)?.effectivePct ?? 0) - (bySymbol.get(a)?.effectivePct ?? 0),
      );
      return {
        id: driverId(slugify(c.label)),
        kind: "driver" as const,
        label: c.label,
        basis: c.basis.sort((a, b) => LABEL_RANK[b.kind] - LABEL_RANK[a.kind]),
        issuerIds: members.map(issuerId),
        bookPct: bookPctOf(bySymbol, c.members),
        positionCount: positionsBehind(model, c.members),
        labelFromAi: false,
      };
    })
    .sort((a, b) => b.bookPct - a.bookPct);

  const edges: ExposureEdge[] = [];
  for (const d of drivers) {
    for (const iid of d.issuerIds) {
      const symbol = iid.slice("issuer:".length);
      const issuer = bySymbol.get(symbol);
      const primary = d.basis[0];
      edges.push({
        id: `shares:${d.id}:${symbol}`,
        from: iid,
        to: d.id,
        kind: "SHARES",
        // SHARES describes co-participation, not a flow of money — but the
        // issuer's own contribution to the driver's total IS a magnitude, and
        // an edge without one has no business existing.
        bookPct: issuer?.effectivePct ?? null,
        innerPct: null,
        path: [],
        basis: primary.kind === "co-movement" ? "derived" : "observed",
        source: primary.detail,
        asOf: null,
      });
    }
  }

  const industries: Record<string, string> = {};
  for (const [symbol, profile] of inputs.profiles) {
    if (profile.industry) industries[symbol] = profile.industry;
  }

  return {
    generatedAt: new Date().toISOString(),
    drivers,
    edges,
    unresolved: inputs.unresolved,
    probes: inputs.memberships.map((m) => m.via),
    industries,
  };
}

/** Fetch both substrates and assemble. The drivers pass, end to end. */
export async function buildExposureDrivers(model: ExposureModel): Promise<ExposureDrivers> {
  const [{ profiles, unresolved }, memberships] = await Promise.all([
    fetchIssuerProfiles(model.issuers),
    fetchProbeMemberships(),
  ]);
  return assembleDrivers(model, { profiles, memberships, unresolved });
}
