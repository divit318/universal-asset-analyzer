/**
 * Investor Policy — the investor's own definition of what their portfolio is for.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * The Portfolio Health score this replaces assigned twelve universal weights
 * (Asset Allocation 16%, Liquidity 9%, Income 8%, …) to every investor. That
 * encodes a claim UAA has no right to make: that there is one definition of a
 * healthy portfolio. There is not. A 26% single-position book is a failure for a
 * retiree drawing income and a deliberate choice for a high-conviction investor;
 * a 0.4% yield is a defect only if the investor needs income at all.
 *
 * So the evaluation is split into the two things the old score conflated:
 *
 *   OBJECTIVE FACTS   — measured from the book (engines/allocation, engines/risk).
 *   INVESTOR POLICY   — stated by the investor. THIS FILE.
 *
 * The alignment engine (./engine.ts) evaluates facts AGAINST policy. UAA never
 * again asserts what a perfect portfolio looks like; it measures how far this
 * book sits from what its owner said they want.
 *
 * ── Shape (v2) ────────────────────────────────────────────────────────────────
 *
 * A policy distinguishes four different kinds of statement an investor makes,
 * because they behave differently and conflating them was the v1 limitation:
 *
 *   OBJECTIVE     — goal + horizon (and optionally an explicit growth-band
 *                   RANGE): what the book is for.
 *   PREFERENCES   — per-theme priorities, 0-3: how much each verdict MATTERS.
 *                   Soft weights, never limits.
 *   CONSTRAINTS   — tolerances in real units (cap %, drawdown %, floor %,
 *                   cash band [lo,hi]): where "aligned" ENDS. Hard numbers.
 *   EXCEPTIONS    — deliberate, named departures ("QQQM may be 30% — this is
 *                   conviction"): a per-holding allowance that does NOT weaken
 *                   the general rule for everything else. The v1 model forced
 *                   an investor to raise the global cap to bless one position,
 *                   which is exactly backwards.
 *
 * Plus STATEMENTS — the investor's own words, kept as provenance after an
 * explicit, reviewed interpretation step has merged their effect into the
 * structured fields above. Free text NEVER reaches the scorer directly; the
 * engine reads structured fields only, so the score stays deterministic and
 * the investor can always see exactly which rule produced which judgment.
 *
 * Persisted per portfolio in `portfolio_policy` (lib/db.ts) as versioned JSON;
 * `parseInvestorPolicy` is the single boundary where stored/user input becomes a
 * trusted object (same pattern as simulator/profile.ts). v1 blobs parse cleanly
 * — the new fields default to empty/off.
 */

import { MAX_SINGLE_HOLDING_PCT } from "../policy";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

export const ALIGNMENT_THEMES = [
  "structure",
  "resilience",
  "concentration",
  "liquidity",
  "income",
  "inflation",
  "exposure",
] as const;

export type AlignmentThemeId = (typeof ALIGNMENT_THEMES)[number];

/**
 * 0 = opted out: the theme is reported as a FACT and carries no weight in the
 * score. 1-3 = how much of the score this theme earns relative to the others.
 * Levels rather than free-percentage sliders: a share is only meaningful
 * relative to the other themes, and levels stay meaningful as themes toggle.
 */
export type PriorityLevel = 0 | 1 | 2 | 3;

export type InvestorGoal = "growth" | "balanced" | "income" | "preservation";
export type PolicyHorizon = "short" | "medium" | "long";

export interface InvestorTolerances {
  /** Largest single position the investor is comfortable holding, % of book. */
  maxPositionPct: number;
  /** Deepest peak-to-trough loss the investor says they can sit through, %. */
  maxDrawdownPct: number;
  /** Share of the book that must be sellable within days, %. */
  liquidityFloorPct: number;
  /** Cash band the investor wants to run, % [min, max]. */
  cashRangePct: [number, number];
  /** Required annual income yield, %. Only read when the income theme is on. */
  incomeYieldPct: number;
  /**
   * Explicit growth-engine band override, % [lo, hi] — a RANGE, because "how
   * much growth engine" is naturally a range, not a threshold. Null = derive
   * the band from goal + horizon as before. Advanced-mode only.
   */
  growthBandPct: [number, number] | null;
}

/**
 * A deliberate, named departure from the general concentration rule. The
 * general cap still binds every other position; the excepted symbol is judged
 * against ITS OWN stated allowance instead. An exception is a statement of
 * intent, so the alignment report shows it as "within your stated exception",
 * never as a silent pass.
 */
export interface PolicyException {
  symbol: string;
  /** The allowance for this specific position, % of book. */
  maxPositionPct: number;
  /** Why — the investor's own words, shown wherever the exception applies. */
  note: string | null;
}

/**
 * The investor's own words, retained as provenance AFTER their effect was
 * explicitly reviewed and merged into the structured fields. Never an input
 * to the scorer — the fields are.
 */
export interface PolicyStatement {
  /** What the investor wrote. */
  text: string;
  /** The one-line restatement of what was applied ("QQQM exception ≤30%; Downside priority High"). */
  summary: string;
  appliedAt: string;
}

export interface InvestorPolicy {
  version: 2;
  goal: InvestorGoal;
  horizon: PolicyHorizon;
  priorities: Record<AlignmentThemeId, PriorityLevel>;
  tolerances: InvestorTolerances;
  /** Deliberate per-holding departures from the concentration rule. */
  exceptions: PolicyException[];
  /** Confirmed free-text provenance. Display + AI context only, never scored. */
  statements: PolicyStatement[];
  /**
   * False until the investor has actually saved a policy. An unconfirmed policy
   * is a set of ASSUMPTIONS, and every surface that shows the score while this
   * is false must say so — scoring someone against defaults they never chose,
   * silently, is the old universal-weights bug wearing new clothes.
   */
  confirmed: boolean;
  updatedAt: string | null;
}

/**
 * The cap that actually applies to one holding: its exception's allowance if
 * the investor named it, the general cap otherwise. THE single source for
 * per-holding concentration judgment — the alignment engine, the trim loop and
 * the concentration flags all call this, so "one limit, everywhere" survives
 * exceptions.
 */
export function effectiveCapPct(policy: InvestorPolicy, symbol: string | null): number {
  if (symbol) {
    const ex = policy.exceptions.find((e) => e.symbol.toUpperCase() === symbol.toUpperCase());
    if (ex) return Math.max(ex.maxPositionPct, policy.tolerances.maxPositionPct);
  }
  return policy.tolerances.maxPositionPct;
}

export const GOAL_LABEL: Record<InvestorGoal, string> = {
  growth: "Long-term growth",
  balanced: "Balanced",
  income: "Income",
  preservation: "Capital preservation",
};

export const HORIZON_LABEL: Record<PolicyHorizon, string> = {
  short: "Under 3 years",
  medium: "3–10 years",
  long: "10+ years",
};

/* -------------------------------------------------------------------------- */
/* Goal presets                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Base priorities per goal. These are STARTING POINTS the wizard derives from,
 * not hidden universal weights: the derived policy is shown to the user in
 * full, every level is editable, and themes at 0 are facts rather than scores.
 *
 * Income, inflation and exposure default to 0 for goals that do not imply
 * them — the exact factors the old health score charged every investor for
 * (a growth investor lost points for a 0.4% yield; a US household lost points
 * for holding USD). They turn on when the investor says they matter.
 */
const GOAL_PRIORITIES: Record<InvestorGoal, Record<AlignmentThemeId, PriorityLevel>> = {
  growth: { structure: 3, resilience: 2, concentration: 2, liquidity: 1, income: 0, inflation: 0, exposure: 0 },
  balanced: { structure: 2, resilience: 2, concentration: 2, liquidity: 2, income: 0, inflation: 1, exposure: 1 },
  income: { structure: 1, resilience: 2, concentration: 2, liquidity: 2, income: 3, inflation: 1, exposure: 0 },
  preservation: { structure: 1, resilience: 3, concentration: 2, liquidity: 2, income: 0, inflation: 2, exposure: 1 },
};

/* -------------------------------------------------------------------------- */
/* Simple-mode derivation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The wizard's answers. Every option is a position a real investor holds,
 * phrased so recognising your own is a one-line read (the lesson of
 * simulator/preferences.ts: recognising beats composing). Each maps to explicit
 * tolerances and priority bumps — the mapping is stated on the option itself in
 * the UI, so deriving a policy never smuggles in a number the user can't see.
 */
export interface PolicyAnswers {
  goal: InvestorGoal;
  horizon: PolicyHorizon;
  /** Deepest loss you could sit through without selling. */
  drawdown: "shallow" | "moderate" | "deep" | "severe";
  /** Largest single position you would deliberately run. */
  concentration: "spread" | "diversified" | "focused" | "conviction";
  /** How much of the book you might need on short notice. */
  liquidity: "locked" | "buffer" | "quarter" | "half";
  /** Does the book need to pay you cash while you hold it? */
  income: "no" | "some" | "steady" | "living";
  /** Do you want explicit inflation protection? */
  inflation: "no" | "aware" | "hedged";
  /** Where should the risk be domiciled? */
  exposure: "home" | "tilted" | "global";
}

export const DRAWDOWN_TOLERANCE_PCT: Record<PolicyAnswers["drawdown"], number> = {
  shallow: 15,
  moderate: 30,
  deep: 45,
  severe: 60,
};

export const CONCENTRATION_CAP_PCT: Record<PolicyAnswers["concentration"], number> = {
  spread: 5,
  diversified: 10,
  focused: MAX_SINGLE_HOLDING_PCT, // 20 — the optimizer/trim policy's own cap
  conviction: 35,
};

const LIQUIDITY_FLOOR_PCT: Record<PolicyAnswers["liquidity"], number> = {
  locked: 0,
  buffer: 10,
  quarter: 25,
  half: 50,
};

const CASH_RANGE_PCT: Record<PolicyAnswers["liquidity"], [number, number]> = {
  locked: [0, 25],
  buffer: [1, 25],
  quarter: [3, 40],
  half: [5, 60],
};

const INCOME_REQUIREMENT_PCT: Record<PolicyAnswers["income"], number> = {
  no: 0,
  some: 1.5,
  steady: 3,
  living: 4.5,
};

const INCOME_PRIORITY: Record<PolicyAnswers["income"], PriorityLevel> = {
  no: 0,
  some: 1,
  steady: 2,
  living: 3,
};

const INFLATION_PRIORITY: Record<PolicyAnswers["inflation"], PriorityLevel> = {
  no: 0,
  aware: 1,
  hedged: 2,
};

const EXPOSURE_PRIORITY: Record<PolicyAnswers["exposure"], PriorityLevel> = {
  home: 0,
  tilted: 1,
  global: 2,
};

const lvl = (n: number): PriorityLevel => Math.max(0, Math.min(3, Math.round(n))) as PriorityLevel;

/** Derive a full policy from the wizard's answers. Pure; the wizard previews its output live. */
export function derivePolicy(a: PolicyAnswers, now = new Date().toISOString()): InvestorPolicy {
  const p = { ...GOAL_PRIORITIES[a.goal] };

  // The explicit answer always beats the goal preset — an income investor who
  // says "no income requirement" means it.
  p.income = INCOME_PRIORITY[a.income];
  p.inflation = INFLATION_PRIORITY[a.inflation];
  p.exposure = EXPOSURE_PRIORITY[a.exposure];

  // A short horizon makes downside and access matter more: less time to recover
  // a drawdown, more chance the money is actually needed.
  if (a.horizon === "short") {
    p.resilience = lvl(p.resilience + 1);
    p.liquidity = lvl(p.liquidity + 1);
  }
  if (a.liquidity === "quarter" || a.liquidity === "half") p.liquidity = 3;

  return {
    version: 2,
    goal: a.goal,
    horizon: a.horizon,
    priorities: p,
    tolerances: {
      maxPositionPct: CONCENTRATION_CAP_PCT[a.concentration],
      maxDrawdownPct: DRAWDOWN_TOLERANCE_PCT[a.drawdown],
      liquidityFloorPct: LIQUIDITY_FLOOR_PCT[a.liquidity],
      cashRangePct: CASH_RANGE_PCT[a.liquidity],
      incomeYieldPct: INCOME_REQUIREMENT_PCT[a.income],
      growthBandPct: null,
    },
    // Pure derivation from the eight answers: exceptions, statements and the
    // band override are advanced-mode state the EDITOR carries across answer
    // changes — a wizard click must never silently wipe a named exception.
    exceptions: [],
    statements: [],
    confirmed: true,
    updatedAt: now,
  };
}

/** Nearest option for a numeric tolerance — the inverse of the tables above. */
function nearest<K extends string>(table: Record<K, number>, value: number): K {
  let best: K | null = null;
  let bestDist = Infinity;
  for (const key of Object.keys(table) as K[]) {
    const d = Math.abs(table[key] - value);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return best as K;
}

/**
 * The wizard answers that best describe an existing policy — the (lossy)
 * inverse of derivePolicy, so re-opening the editor highlights the choices the
 * saved policy is closest to instead of resetting to defaults. Advanced-mode
 * edits may sit between options; the nearest one is highlighted, and saving
 * simple-mode answers over them is an explicit user action, never silent.
 */
export function answersFromPolicy(p: InvestorPolicy): PolicyAnswers {
  const incomeByPriority: Record<number, PolicyAnswers["income"]> = { 0: "no", 1: "some", 2: "steady", 3: "living" };
  const inflationByPriority: Record<number, PolicyAnswers["inflation"]> = { 0: "no", 1: "aware", 2: "hedged", 3: "hedged" };
  const exposureByPriority: Record<number, PolicyAnswers["exposure"]> = { 0: "home", 1: "tilted", 2: "global", 3: "global" };
  const liquidityFloors: Record<PolicyAnswers["liquidity"], number> = { locked: 0, buffer: 10, quarter: 25, half: 50 };
  return {
    goal: p.goal,
    horizon: p.horizon,
    drawdown: nearest(DRAWDOWN_TOLERANCE_PCT, p.tolerances.maxDrawdownPct),
    concentration: nearest(CONCENTRATION_CAP_PCT, p.tolerances.maxPositionPct),
    liquidity: nearest(liquidityFloors, p.tolerances.liquidityFloorPct),
    income: incomeByPriority[p.priorities.income] ?? "no",
    inflation: inflationByPriority[p.priorities.inflation] ?? "no",
    exposure: exposureByPriority[p.priorities.exposure] ?? "home",
  };
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The assumed policy for an investor who has not set one.
 *
 * Deliberately minimal: it judges only the four things close to universal —
 * a sane structure for a balanced goal, downside within a common tolerance,
 * concentration against the optimizer's own 20% cap, and basic access to the
 * money. Income, inflation and geography are reported as facts, NOT scored,
 * because defaulting them on is precisely the arbitrary-universal-standard bug
 * this system replaces. `confirmed: false` is what the UI keys "these are
 * assumptions — set yours" messaging off.
 */
export const DEFAULT_POLICY: InvestorPolicy = {
  version: 2,
  goal: "balanced",
  horizon: "medium",
  priorities: { structure: 2, resilience: 2, concentration: 2, liquidity: 2, income: 0, inflation: 0, exposure: 0 },
  tolerances: {
    maxPositionPct: MAX_SINGLE_HOLDING_PCT,
    maxDrawdownPct: 30,
    liquidityFloorPct: 10,
    cashRangePct: [1, 25],
    incomeYieldPct: 0,
    growthBandPct: null,
  },
  exceptions: [],
  statements: [],
  confirmed: false,
  updatedAt: null,
};

/* -------------------------------------------------------------------------- */
/* Validation boundary                                                         */
/* -------------------------------------------------------------------------- */

const GOALS: InvestorGoal[] = ["growth", "balanced", "income", "preservation"];
const HORIZONS: PolicyHorizon[] = ["short", "medium", "long"];

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * The one place raw JSON (from storage or the API) becomes an InvestorPolicy.
 *
 * Lenient by design, like normalizeStoredProfile: an unknown field is dropped,
 * an out-of-range number is clamped, a missing theme falls back to the default
 * — a stale or partial blob is a policy the user has partially stated, not a
 * broken portfolio page. Only a payload that isn't an object at all is an error.
 */
export function parseInvestorPolicy(input: unknown): { policy: InvestorPolicy } | { error: string } {
  if (input === undefined || input === null) return { policy: DEFAULT_POLICY };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "policy must be an object" };
  const raw = input as Record<string, unknown>;

  const goal = GOALS.includes(raw.goal as InvestorGoal) ? (raw.goal as InvestorGoal) : DEFAULT_POLICY.goal;
  const horizon = HORIZONS.includes(raw.horizon as PolicyHorizon)
    ? (raw.horizon as PolicyHorizon)
    : DEFAULT_POLICY.horizon;

  const priorities = { ...DEFAULT_POLICY.priorities };
  if (raw.priorities && typeof raw.priorities === "object" && !Array.isArray(raw.priorities)) {
    for (const t of ALIGNMENT_THEMES) {
      const v = (raw.priorities as Record<string, unknown>)[t];
      if (v !== undefined) priorities[t] = lvl(clampNum(v, 0, 3, priorities[t]));
    }
  }

  const t = (raw.tolerances ?? {}) as Record<string, unknown>;
  const d = DEFAULT_POLICY.tolerances;
  const rawRange = Array.isArray(t.cashRangePct) ? (t.cashRangePct as unknown[]) : d.cashRangePct;
  let cashMin = clampNum(rawRange[0], 0, 100, d.cashRangePct[0]);
  let cashMax = clampNum(rawRange[1], 0, 100, d.cashRangePct[1]);
  if (cashMin > cashMax) [cashMin, cashMax] = [cashMax, cashMin];

  // The growth-band override is a RANGE with a minimum honest width — a
  // zero-width "range" is a threshold wearing a costume, and a band the
  // engine's edge-easing cannot operate inside produces jumpy scores.
  let growthBandPct: [number, number] | null = null;
  if (Array.isArray(t.growthBandPct) && (t.growthBandPct as unknown[]).length === 2) {
    let lo = clampNum((t.growthBandPct as unknown[])[0], 0, 100, 0);
    let hi = clampNum((t.growthBandPct as unknown[])[1], 0, 100, 100);
    if (lo > hi) [lo, hi] = [hi, lo];
    if (hi - lo < 5) hi = Math.min(100, lo + 5);
    growthBandPct = [lo, hi];
  }

  const tolerances: InvestorTolerances = {
    maxPositionPct: clampNum(t.maxPositionPct, 2, 100, d.maxPositionPct),
    maxDrawdownPct: clampNum(t.maxDrawdownPct, 5, 95, d.maxDrawdownPct),
    liquidityFloorPct: clampNum(t.liquidityFloorPct, 0, 100, d.liquidityFloorPct),
    cashRangePct: [cashMin, cashMax],
    incomeYieldPct: clampNum(t.incomeYieldPct, 0, 15, d.incomeYieldPct),
    growthBandPct,
  };

  // An income theme that is ON needs a target to score against. 2% is the
  // documented floor for "income matters but I didn't say how much" — stated
  // here once rather than invented downstream.
  if (priorities.income > 0 && tolerances.incomeYieldPct <= 0) tolerances.incomeYieldPct = 2;

  // Exceptions: symbol-keyed, deduped (last wins), bounded — a stored blob can
  // never smuggle in an unbounded list or a nonsense allowance. v1 blobs have
  // none; that is the whole migration.
  const exceptions: PolicyException[] = [];
  if (Array.isArray(raw.exceptions)) {
    for (const e of raw.exceptions as unknown[]) {
      if (!e || typeof e !== "object") continue;
      const ex = e as Record<string, unknown>;
      const symbol = typeof ex.symbol === "string" ? ex.symbol.trim().toUpperCase().slice(0, 12) : "";
      if (!symbol) continue;
      const idx = exceptions.findIndex((x) => x.symbol === symbol);
      const entry: PolicyException = {
        symbol,
        maxPositionPct: clampNum(ex.maxPositionPct, 2, 100, tolerances.maxPositionPct),
        note: typeof ex.note === "string" && ex.note.trim() ? ex.note.trim().slice(0, 200) : null,
      };
      if (idx >= 0) exceptions[idx] = entry;
      else exceptions.push(entry);
      if (exceptions.length >= 20) break;
    }
  }

  const statements: PolicyStatement[] = [];
  if (Array.isArray(raw.statements)) {
    for (const s of raw.statements as unknown[]) {
      if (!s || typeof s !== "object") continue;
      const st = s as Record<string, unknown>;
      const text = typeof st.text === "string" ? st.text.trim().slice(0, 500) : "";
      const summary = typeof st.summary === "string" ? st.summary.trim().slice(0, 300) : "";
      if (!text || !summary) continue;
      statements.push({
        text,
        summary,
        appliedAt: typeof st.appliedAt === "string" ? st.appliedAt : new Date(0).toISOString(),
      });
      if (statements.length >= 20) break;
    }
  }

  return {
    policy: {
      version: 2,
      goal,
      horizon,
      priorities,
      tolerances,
      exceptions,
      statements,
      confirmed: raw.confirmed === true,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Structured patches (the reviewed-interpretation contract)                   */
/* -------------------------------------------------------------------------- */

/**
 * A structured, human-reviewable set of policy changes — the ONLY form in which
 * an interpretation of free text may touch the policy. The AI proposes one of
 * these; the UI renders every field of it in plain language; nothing merges
 * until the investor explicitly applies it. `unmappable` carries the parts of
 * the text that could NOT be turned into a measurable rule, stated rather than
 * silently dropped.
 */
export interface PolicyPatch {
  goal?: InvestorGoal;
  horizon?: PolicyHorizon;
  priorities?: Partial<Record<AlignmentThemeId, PriorityLevel>>;
  tolerances?: Partial<InvestorTolerances>;
  addExceptions?: PolicyException[];
  removeExceptionSymbols?: string[];
}

/**
 * Apply a reviewed patch deterministically. The result goes back through
 * `parseInvestorPolicy`, so a patch cannot construct a policy the normal
 * validation boundary would reject — one boundary, no side door.
 */
export function applyPolicyPatch(policy: InvestorPolicy, patch: PolicyPatch): InvestorPolicy {
  const removed = new Set((patch.removeExceptionSymbols ?? []).map((s) => s.trim().toUpperCase()));
  const merged = {
    ...policy,
    goal: patch.goal ?? policy.goal,
    horizon: patch.horizon ?? policy.horizon,
    priorities: { ...policy.priorities, ...(patch.priorities ?? {}) },
    tolerances: { ...policy.tolerances, ...(patch.tolerances ?? {}) },
    exceptions: [
      ...policy.exceptions.filter(
        (e) => !removed.has(e.symbol) && !(patch.addExceptions ?? []).some((a) => a.symbol.toUpperCase() === e.symbol.toUpperCase()),
      ),
      ...(patch.addExceptions ?? []),
    ],
  };
  const parsed = parseInvestorPolicy(merged);
  return "policy" in parsed ? { ...parsed.policy, confirmed: policy.confirmed, updatedAt: policy.updatedAt } : policy;
}

/** A patch in plain language, one line per effect — what the user approves. */
export function describePolicyPatch(patch: PolicyPatch): string[] {
  const out: string[] = [];
  if (patch.goal) out.push(`Goal → ${GOAL_LABEL[patch.goal]}`);
  if (patch.horizon) out.push(`Horizon → ${HORIZON_LABEL[patch.horizon]}`);
  const priorityName: Record<PriorityLevel, string> = { 0: "Off (fact only)", 1: "Low", 2: "Medium", 3: "High" };
  for (const [theme, level] of Object.entries(patch.priorities ?? {})) {
    if (level != null) out.push(`${theme[0].toUpperCase()}${theme.slice(1)} priority → ${priorityName[level as PriorityLevel]}`);
  }
  const t = patch.tolerances ?? {};
  if (t.maxPositionPct != null) out.push(`Max single position → ${t.maxPositionPct}%`);
  if (t.maxDrawdownPct != null) out.push(`Drawdown tolerance → ${t.maxDrawdownPct}%`);
  if (t.liquidityFloorPct != null) out.push(`Liquidity floor → ${t.liquidityFloorPct}% sellable within days`);
  if (t.cashRangePct != null) out.push(`Cash band → ${t.cashRangePct[0]}–${t.cashRangePct[1]}%`);
  if (t.incomeYieldPct != null) out.push(`Required income yield → ${t.incomeYieldPct}%/yr`);
  if (t.growthBandPct != null) out.push(`Growth-engine band → ${t.growthBandPct[0]}–${t.growthBandPct[1]}%`);
  else if (t.growthBandPct === null && "growthBandPct" in t) out.push("Growth-engine band → derived from goal again");
  for (const e of patch.addExceptions ?? []) {
    out.push(`Exception: ${e.symbol} may be up to ${e.maxPositionPct}%${e.note ? ` (${e.note})` : ""}`);
  }
  for (const s of patch.removeExceptionSymbols ?? []) out.push(`Remove exception for ${s.toUpperCase()}`);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Shares                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Each theme's share of the alignment score, normalized over the themes the
 * investor turned on. Sums to 1 (or is all zeros for the degenerate policy
 * with every priority at 0, which the engine reports as unscorable rather
 * than inventing a judgment nobody asked for).
 */
export function priorityShares(policy: InvestorPolicy): Record<AlignmentThemeId, number> {
  const total = ALIGNMENT_THEMES.reduce((s, t) => s + policy.priorities[t], 0);
  const shares = {} as Record<AlignmentThemeId, number>;
  for (const t of ALIGNMENT_THEMES) shares[t] = total > 0 ? policy.priorities[t] / total : 0;
  return shares;
}

/** The policy as settled facts for an AI prompt (interpretation/challenge only — never scoring). */
export function describePolicy(policy: InvestorPolicy): string {
  const p = policy.priorities;
  const t = policy.tolerances;
  const on = (id: AlignmentThemeId, text: string) => (p[id] > 0 ? text : null);
  const lines = [
    `Goal: ${GOAL_LABEL[policy.goal]}. Horizon: ${HORIZON_LABEL[policy.horizon]}.${policy.confirmed ? "" : " (ASSUMED DEFAULTS — the investor has not confirmed this policy.)"}`,
    `Max single position tolerated: ${t.maxPositionPct}%.`,
    `Max drawdown tolerated: ${t.maxDrawdownPct}%.`,
    `Liquidity floor: ${t.liquidityFloorPct}% sellable within days; cash band ${t.cashRangePct[0]}–${t.cashRangePct[1]}%.`,
    on("income", `Income requirement: ${t.incomeYieldPct}%/yr.`) ?? "Income: explicitly not a goal.",
    on("inflation", "Inflation protection: wanted.") ?? "Inflation protection: not a stated priority.",
    on("exposure", "Geographic/currency diversification: wanted.") ?? "Home-market concentration: accepted as deliberate.",
  ];
  if (t.growthBandPct) lines.push(`Explicit growth-engine band: ${t.growthBandPct[0]}–${t.growthBandPct[1]}% (overrides the goal-derived band).`);
  for (const e of policy.exceptions) {
    lines.push(`Intentional exception: ${e.symbol} may be up to ${e.maxPositionPct}% of the book${e.note ? ` — investor's reason: "${e.note}"` : ""}. This is deliberate, not an oversight.`);
  }
  for (const s of policy.statements) lines.push(`In the investor's own words: "${s.text}" (applied as: ${s.summary}).`);
  return lines.join("\n");
}
