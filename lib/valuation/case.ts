/**
 * The ValuationCase — valuation as a persisted object rather than a page.
 *
 * One case per symbol. It is seeded automatically from the reverse DCF (so every
 * symbol has one from first sight), refined by AI, and owned by the user. Every
 * other surface reads it and none of them compute their own intrinsic value —
 * that is the whole point, and it is why there is now exactly one answer to
 * "what is this worth" anywhere in the app.
 *
 * Two ideas make it more than a saved form:
 *
 *   1. An assumption is not a number. It is a value plus where it came from,
 *      why, and what the alternatives are (`anchors`). The number is worthless
 *      in twelve months; the reasoning is the entire asset.
 *   2. `locked`. Once the user has set an assumption, AI may *critique* it but
 *      must never overwrite it. Enforced here, in the data layer, rather than
 *      trusted to a prompt — because an AI that keeps proposing numbers trains
 *      the user to stop thinking.
 *
 * Pure: no fetch, no database, no React. Persistence lives in lib/db.ts.
 */

import type { DataSourceId } from "../provenance";
import { freshness, type Freshness } from "../provenance";
import {
  buildScenarios,
  dcfInvalidReason,
  impliedUpside,
  marginOfSafety,
  runDcf,
  type DcfAssumptions,
  type DcfInvalidReason,
} from "./dcf";
import { solveImpliedGrowth, STAGE_TWO_FADE } from "./reverse";

/* -------------------------------------------------------------------------- */
/* Assumptions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Note that the "facts" (base FCF, shares, net debt) are assumptions too. Yahoo's
 * free cash flow is frequently wrong and the user must be able to override it —
 * so treating facts and judgments uniformly, each carrying its own provenance,
 * is what makes the audit trail complete.
 */
export const ASSUMPTION_KEYS = [
  "baseFcf",
  "growthRate1",
  "growthRate2",
  "terminalGrowth",
  "discountRate",
  "sharesOutstanding",
  "netDebt",
] as const;

export type AssumptionKey = (typeof ASSUMPTION_KEYS)[number];

export const ASSUMPTION_LABEL: Record<AssumptionKey, string> = {
  baseFcf: "Trailing FCF",
  growthRate1: "FCF growth Y1–5",
  growthRate2: "FCF growth Y6–10",
  terminalGrowth: "Terminal growth",
  discountRate: "WACC",
  sharesOutstanding: "Shares outstanding",
  netDebt: "Net debt",
};

/** Which assumptions are rates (percent) rather than amounts or counts. */
export const RATE_ASSUMPTIONS: ReadonlySet<AssumptionKey> = new Set<AssumptionKey>([
  "growthRate1",
  "growthRate2",
  "terminalGrowth",
  "discountRate",
]);

/**
 * Where a value came from. Reuses `DataSourceId` for real feeds so provenance
 * badges render identically to the rest of the app, and extends it only for
 * things UAA derives itself.
 */
export type AssumptionSource =
  | DataSourceId
  | "reverse_dcf"
  | "ai"
  | "user"
  | "peer_median"
  | "history"
  | "default";

/** Comparators shown beside an assumption so a number is never context-free. */
export interface AssumptionAnchors {
  /** What the business actually delivered over five years. */
  hist5y?: number;
  peerMedian?: number;
  /** What today's price is paying for — the reverse DCF. */
  impliedByMarket?: number;
  /** The quant engine's Monte Carlo median, when the symbol was in the run. */
  engineP50?: number;
}

export interface Assumption {
  value: number;
  source: AssumptionSource;
  /** Why this value. The thing worth reading in a year. */
  rationale: string | null;
  anchors: AssumptionAnchors;
  /** Set once the user has authored this value. AI must not overwrite it. */
  locked: boolean;
  /** AI's objection to a locked value. Cleared whenever the user edits again. */
  critique: string | null;
  updatedAt: string;
}

export type AssumptionSet = Record<AssumptionKey, Assumption>;

/* -------------------------------------------------------------------------- */
/* The case and its log                                                        */
/* -------------------------------------------------------------------------- */

export type CaseAuthor = "reverse" | "ai" | "user" | "engine" | "system";

/**
 * Which valuation methodology a case uses.
 *
 * Only one exists today, and it is deliberately narrow: a discounted free cash
 * flow model applies to cash-generating operating companies and to nothing else.
 * Naming it on the case — rather than leaving "DCF" as an unstated assumption of
 * the whole system — is what lets the Register say plainly what it covers, and
 * what lets a dividend-discount or NAV method arrive later without a migration
 * or a second parallel object.
 */
export type ValuationMethod = "dcf_fcf";

export const DEFAULT_VALUATION_METHOD: ValuationMethod = "dcf_fcf";

export const VALUATION_METHOD_LABEL: Record<ValuationMethod, string> = {
  dcf_fcf: "Discounted free cash flow",
};

export const VALUATION_METHOD_SCOPE: Record<ValuationMethod, string> = {
  dcf_fcf: "Cash-generating operating companies. Funds, bonds, commodities and crypto have no free cash flow of their own and are covered by Compare.",
};

export function isValuationMethod(value: unknown): value is ValuationMethod {
  return value === "dcf_fcf";
}

/**
 * Identifies one event in the log. Lives here rather than beside the query that
 * uses it because the Judgment Ledger builds these keys in the browser (to look
 * up the snapshot behind a decision) while `lib/db.ts` builds them on the server
 * to fill the map — and `db.ts` imports `node:sqlite`, so a client component
 * reaching for its version of this helper would pull the driver into the bundle.
 */
export function versionKeyOf(symbol: string, version: number): string {
  return `${symbol.toUpperCase()}@${version}`;
}

/**
 * Every kind is defined now, including the two only Phase 4 writes
 * (`earnings_revaluation`, `decision_committed`), so the append-only log never
 * needs migrating.
 */
export type CaseEventKind =
  | "seeded"
  | "ai_refresh"
  | "assumption_changed"
  | "earnings_revaluation"
  | "decision_committed"
  | "note";

export interface CaseResult {
  fairValue: number | null;
  fairValueBear: number | null;
  fairValueBull: number | null;
  /** Discount of price to fair value, percent. */
  marginOfSafety: number | null;
  /** Return implied from today's price, percent. */
  impliedUpside: number | null;
  /**
   * The FCF growth rate that would justify today's price, percent.
   *
   * Conditional on this case's own discount rate, terminal growth, share count
   * and net debt — raise the WACC and this rises with it. See
   * `IMPLIED_GROWTH_CAVEAT`; never present it as a market observation.
   */
  impliedGrowth: number | null;
  /** Share of enterprise value resting on the perpetuity, 0–1. */
  terminalValueShare: number;
  invalidReason: DcfInvalidReason | null;
}

/**
 * Market-implied growth is *conditional*, and every label for it must say so.
 *
 * It is the growth rate that makes this case's own discount rate, terminal growth,
 * share count and net debt reproduce today's price. Change the WACC and the
 * implied growth moves, even though the market has not. Presented bare it reads
 * like an objective market statistic, which is the single most misleading thing
 * this system could show — so the caveat lives here and is reused verbatim.
 */
export const IMPLIED_GROWTH_LABEL = "Priced-in growth";

export const IMPLIED_GROWTH_CAVEAT =
  "The FCF growth rate that would justify today's price given your WACC and terminal growth. It is conditional on those two assumptions, not a market observation — raise your WACC and this rises with it.";

export const IMPLIED_GROWTH_SHORT_CAVEAT = "given your WACC & terminal growth";

export interface ValuationCase {
  symbol: string;
  currency: string;
  /** The methodology this case uses. See `ValuationMethod`. */
  method: ValuationMethod;
  /** Monotonic per symbol; equals the version of the latest event. */
  version: number;
  /** Author of the most recent event. */
  author: CaseAuthor;
  assumptions: AssumptionSet;
  result: CaseResult;
  /** Market price when the case was last recomputed. */
  priceAt: number | null;
  createdAt: string;
  updatedAt: string;
  /** When the user last touched it. Null means never — an untouched AI case. */
  lastUserEventAt: string | null;
}

export interface ValuationEvent {
  id: number;
  symbol: string;
  version: number;
  author: CaseAuthor;
  kind: CaseEventKind;
  /** Full snapshot, never a delta — diffing any two versions stays trivial. */
  assumptions: AssumptionSet;
  result: CaseResult;
  /** Price at write time. Without this, "what did you believe when you decided?" is unanswerable. */
  priceAt: number | null;
  /** What caused the write, e.g. "ic_report", "FY25Q4 earnings". */
  trigger: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * A case should be revisited every quarter, so ninety days is the point at which
 * it stops being current. Feeds the same freshness badges as every other figure.
 */
export const VALUATION_TTL_HOURS = 24 * 90;

export function caseFreshness(updatedAt: string | null, now?: number): Freshness {
  return freshness(updatedAt, VALUATION_TTL_HOURS, now);
}

/* -------------------------------------------------------------------------- */
/* Computation                                                                 */
/* -------------------------------------------------------------------------- */

export function assumptionsToDcf(set: AssumptionSet): DcfAssumptions {
  return {
    baseFcf: set.baseFcf.value,
    growthRate1: set.growthRate1.value,
    growthRate2: set.growthRate2.value,
    terminalGrowth: set.terminalGrowth.value,
    discountRate: set.discountRate.value,
    sharesOutstanding: set.sharesOutstanding.value,
    netDebt: set.netDebt.value,
  };
}

/** Value the case at a price. Everything the strip, register and report display. */
export function computeCaseResult(set: AssumptionSet, price: number | null): CaseResult {
  const dcf = assumptionsToDcf(set);
  const invalidReason = dcfInvalidReason(dcf);
  const base = runDcf(dcf);
  const scenarios = invalidReason === null ? buildScenarios(dcf) : null;

  const implied =
    price != null
      ? solveImpliedGrowth({
          baseFcf: dcf.baseFcf,
          terminalGrowth: dcf.terminalGrowth,
          discountRate: dcf.discountRate,
          sharesOutstanding: dcf.sharesOutstanding,
          netDebt: dcf.netDebt,
          price,
        }).impliedGrowth
      : null;

  return {
    fairValue: base.fairValuePerShare,
    fairValueBear: scenarios?.bear.fairValuePerShare ?? null,
    fairValueBull: scenarios?.bull.fairValuePerShare ?? null,
    marginOfSafety: marginOfSafety(base.fairValuePerShare, price),
    impliedUpside: impliedUpside(base.fairValuePerShare, price),
    impliedGrowth: implied,
    terminalValueShare: base.terminalValueShare,
    invalidReason,
  };
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

export interface SeedInput {
  baseFcf: number;
  sharesOutstanding: number;
  netDebt: number;
  price: number | null;
  /** WACC in percent, from lib/valuation/wacc.ts. */
  discountRate: number;
  /** Terminal growth in percent. */
  terminalGrowth: number;
  /** Growth the business actually delivered, in percent. */
  deliveredGrowth: number | null;
  /**
   * What that figure measures, e.g. "FCF CAGR FY2021→FY2025" or
   * "TTM revenue growth (proxy)". Written into the seeded rationale so the case
   * records which basis it was built on rather than implying measured cash-flow
   * growth it may not have had.
   */
  deliveredGrowthLabel?: string | null;
  now?: string;
}

function makeAssumption(
  value: number,
  source: AssumptionSource,
  updatedAt: string,
  rationale: string | null = null,
  anchors: AssumptionAnchors = {},
): Assumption {
  return { value, source, rationale, anchors, locked: false, critique: null, updatedAt };
}

/**
 * Build the opening assumption set for a symbol.
 *
 * The growth assumption is seeded from what the business *delivered*, not from
 * what the price implies. That distinction matters: seeding at the price-implied
 * number would make fair value equal price and margin of safety zero by
 * construction, so every untouched case would be silent noise in the register.
 * Seeding at history gives an immediately meaningful, defensible default and
 * keeps the market's number beside it as an anchor — which is exactly the
 * sentence worth reading: "today's price needs 11.4%; they delivered 8.1%."
 *
 * When there is no growth history, the market-implied rate is used instead and
 * labelled as such. That is honest: with no independent evidence we have no
 * independent view, and a zero margin of safety says so.
 */
export function seedAssumptions(input: SeedInput): AssumptionSet {
  const now = input.now ?? new Date().toISOString();

  const implied =
    input.price != null
      ? solveImpliedGrowth({
          baseFcf: input.baseFcf,
          terminalGrowth: input.terminalGrowth,
          discountRate: input.discountRate,
          sharesOutstanding: input.sharesOutstanding,
          netDebt: input.netDebt,
          price: input.price,
        }).impliedGrowth
      : null;

  const anchors: AssumptionAnchors = {};
  if (implied != null) anchors.impliedByMarket = implied;
  if (input.deliveredGrowth != null) anchors.hist5y = input.deliveredGrowth;

  const hasHistory = input.deliveredGrowth != null && Number.isFinite(input.deliveredGrowth);
  const growth1 = hasHistory ? input.deliveredGrowth! : implied ?? 0;
  const growthSource: AssumptionSource = hasHistory ? "history" : implied != null ? "reverse_dcf" : "default";
  const basis = input.deliveredGrowthLabel?.trim();
  const growthRationale = hasHistory
    ? `Seeded from what the business delivered: ${basis || "trailing growth"}.`
    : implied != null
      ? "No usable growth history — seeded at the rate today's price would justify."
      : "No growth history and no price — seeded flat.";

  return {
    baseFcf: makeAssumption(input.baseFcf, "yahoo", now, "Trailing twelve-month free cash flow."),
    growthRate1: makeAssumption(growth1, growthSource, now, growthRationale, anchors),
    growthRate2: makeAssumption(
      growth1 * STAGE_TWO_FADE,
      growthSource,
      now,
      "Faded to half the stage-one rate by year ten.",
    ),
    terminalGrowth: makeAssumption(
      input.terminalGrowth,
      "default",
      now,
      "Long-run perpetuity growth.",
    ),
    discountRate: makeAssumption(
      input.discountRate,
      "platform",
      now,
      "CAPM: levered beta, region risk-free rate and ERP, after-tax cost of debt.",
    ),
    sharesOutstanding: makeAssumption(input.sharesOutstanding, "yahoo", now, "Shares outstanding as reported."),
    netDebt: makeAssumption(input.netDebt, "yahoo", now, "Total debt less cash and equivalents."),
  };
}

/* -------------------------------------------------------------------------- */
/* Edits                                                                       */
/* -------------------------------------------------------------------------- */

export interface AssumptionEdit {
  key: AssumptionKey;
  value: number;
  /** The user's reason. Optional, but it is the part worth keeping. */
  rationale?: string | null;
}

/**
 * Apply the user's edits. Each edited assumption becomes user-authored and
 * locked, and any AI critique of the previous value is dropped — it was an
 * objection to a number that no longer exists.
 */
export function applyUserEdits(
  set: AssumptionSet,
  edits: readonly AssumptionEdit[],
  now: string = new Date().toISOString(),
): AssumptionSet {
  const next: AssumptionSet = { ...set };
  for (const edit of edits) {
    if (!Number.isFinite(edit.value)) continue;
    const prior = next[edit.key];
    next[edit.key] = {
      ...prior,
      value: edit.value,
      source: "user",
      rationale: edit.rationale !== undefined ? edit.rationale : prior.rationale,
      locked: true,
      critique: null,
      updatedAt: now,
    };
  }
  return next;
}

export interface AiAssumptionProposal {
  key: AssumptionKey;
  value: number;
  rationale: string;
  /** Objection to raise if the user has locked this assumption. */
  critique?: string | null;
}

export interface AiRefreshOutcome {
  assumptions: AssumptionSet;
  /** Keys AI wanted to change but could not, because the user owns them. */
  respected: AssumptionKey[];
}

/**
 * Apply AI proposals, honouring `locked`.
 *
 * A locked assumption keeps the user's value and takes AI's objection into
 * `critique` instead — which is what turns the workspace's disagreement block
 * from a feature into a by-product. This is the enforcement point for the rule
 * that AI critiques but never re-suggests.
 */
export function applyAiProposals(
  set: AssumptionSet,
  proposals: readonly AiAssumptionProposal[],
  now: string = new Date().toISOString(),
): AiRefreshOutcome {
  const next: AssumptionSet = { ...set };
  const respected: AssumptionKey[] = [];

  for (const proposal of proposals) {
    if (!Number.isFinite(proposal.value)) continue;
    const prior = next[proposal.key];
    if (prior.locked) {
      respected.push(proposal.key);
      const objection = proposal.critique ?? proposal.rationale;
      // Only the objection is recorded. The value stays the user's.
      next[proposal.key] = { ...prior, critique: objection, updatedAt: prior.updatedAt };
      continue;
    }
    next[proposal.key] = {
      ...prior,
      value: proposal.value,
      source: "ai",
      rationale: proposal.rationale,
      critique: null,
      updatedAt: now,
    };
  }

  return { assumptions: next, respected };
}

/* -------------------------------------------------------------------------- */
/* Diffing                                                                     */
/* -------------------------------------------------------------------------- */

export interface AssumptionChange {
  key: AssumptionKey;
  label: string;
  from: number;
  to: number;
  delta: number;
  isRate: boolean;
}

/** What changed between two versions. Powers the case history and the "your case is broken" diff. */
export function diffAssumptions(before: AssumptionSet, after: AssumptionSet): AssumptionChange[] {
  const changes: AssumptionChange[] = [];
  for (const key of ASSUMPTION_KEYS) {
    const from = before[key]?.value;
    const to = after[key]?.value;
    if (from == null || to == null || from === to) continue;
    changes.push({
      key,
      label: ASSUMPTION_LABEL[key],
      from,
      to,
      delta: to - from,
      isRate: RATE_ASSUMPTIONS.has(key),
    });
  }
  return changes;
}

/** Assumptions the user personally owns — the ones calibration can grade. */
export function userAuthoredKeys(set: AssumptionSet): AssumptionKey[] {
  return ASSUMPTION_KEYS.filter((key) => set[key]?.locked);
}

/**
 * Render a case as plain text for an AI prompt or an export.
 *
 * One formatter, shared by the IC report's valuation stage and its valuation
 * agent, so every consumer describes the case identically — and so a change to
 * what the case contains reaches all of them at once.
 */
export function summarizeCase(vcase: ValuationCase): string {
  const cur = vcase.currency;
  const rate = (v: number) => `${v.toFixed(1)}%`;
  const money = (v: number) => `${cur} ${v.toExponential(3)}`;

  const rows = ASSUMPTION_KEYS.map((key) => {
    const a = vcase.assumptions[key];
    const value = RATE_ASSUMPTIONS.has(key)
      ? rate(a.value)
      : key === "sharesOutstanding" ? a.value.toExponential(3) : money(a.value);
    const owner = a.locked ? "user-owned" : a.source;
    const why = a.rationale ? ` — ${a.rationale}` : "";
    return `  ${ASSUMPTION_LABEL[key]}: ${value} [${owner}]${why}`;
  }).join("\n");

  const r = vcase.result;
  const lines = [
    `VALUATION CASE v${vcase.version} (${vcase.symbol}), last changed ${vcase.updatedAt}`,
    "Assumptions:",
    rows,
    `Implied fair value: ${r.fairValue != null ? `${cur} ${r.fairValue.toFixed(2)}` : "not computable"}`,
    r.fairValueBear != null && r.fairValueBull != null
      ? `Range (bear–bull): ${cur} ${r.fairValueBear.toFixed(2)} – ${cur} ${r.fairValueBull.toFixed(2)}`
      : null,
    r.marginOfSafety != null ? `Margin of safety: ${r.marginOfSafety.toFixed(1)}%` : null,
    r.impliedGrowth != null
      ? `Growth that would justify today's price, given this case's WACC and terminal growth: ${rate(r.impliedGrowth)} (this case assumes ${rate(vcase.assumptions.growthRate1.value)})`
      : null,
    `Share of value from the terminal period: ${(r.terminalValueShare * 100).toFixed(0)}%`,
  ].filter(Boolean);

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const VALID_SOURCES: ReadonlySet<string> = new Set<AssumptionSource>([
  "yahoo", "screener_in", "sec_edgar", "quant_engine", "platform", "rentcast",
  "reverse_dcf", "ai", "user", "peer_median", "history", "default",
]);

export function isAssumptionKey(value: unknown): value is AssumptionKey {
  return typeof value === "string" && (ASSUMPTION_KEYS as readonly string[]).includes(value);
}

function coerceAnchors(raw: unknown): AssumptionAnchors {
  if (raw == null || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: AssumptionAnchors = {};
  for (const key of ["hist5y", "peerMedian", "impliedByMarket", "engineP50"] as const) {
    const v = src[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/**
 * Parse an assumption set out of stored JSON, defensively. Returns null when a
 * key is missing or unusable so the caller re-seeds rather than valuing a
 * half-built model — a wrong number is worse than no number.
 */
export function coerceAssumptionSet(raw: unknown): AssumptionSet | null {
  if (raw == null || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out = {} as AssumptionSet;

  for (const key of ASSUMPTION_KEYS) {
    const entry = src[key];
    if (entry == null || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.value !== "number" || !Number.isFinite(e.value)) return null;
    const source = typeof e.source === "string" && VALID_SOURCES.has(e.source)
      ? (e.source as AssumptionSource)
      : "default";
    out[key] = {
      value: e.value,
      source,
      rationale: typeof e.rationale === "string" ? e.rationale : null,
      anchors: coerceAnchors(e.anchors),
      locked: e.locked === true,
      critique: typeof e.critique === "string" ? e.critique : null,
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date(0).toISOString(),
    };
  }
  return out;
}
