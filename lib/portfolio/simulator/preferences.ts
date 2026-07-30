/**
 * The intake question catalogue — one declaration, four consumers.
 *
 * ## Why this file exists
 *
 * Intake used to be five form fields plus "the AI asks whatever else it thinks
 * it needs". In practice the model asked one open-ended question — "what is your
 * preferred approach to asset allocation, a globally diversified 60/40 split, or
 * a preference for regional or sector-specific tilts?" — the user skipped it, and
 * the portfolio was designed on a guessed default. Every part of that is a
 * failure of the intake, not of the user:
 *
 *   - The question was **askable in advance**. Geographic tilt is a standard
 *     topic every investor has an answer to; there is no reason to gamble a model
 *     call on discovering it.
 *   - It was **open-ended**, so answering it required composing prose about
 *     portfolio construction. Recognising your own view in a list is a far lower
 *     bar than writing it, and free text is what makes a question skippable.
 *   - It **cost 25-195 seconds** of local inference to produce.
 *
 * So the standard topics are declared here as fixed multiple-choice questions,
 * asked up front by the quick form, and the AI interview is demoted to exception
 * handling — contradictions and genuinely conditional gaps only (see
 * `profileGaps`). A coherent profile now generates with no interview at all.
 *
 * ## The four consumers, and why they must share this file
 *
 *   1. The form renders `PREFERENCE_QUESTIONS` (label, options, default).
 *   2. `parseSimPreferences` validates answers against the same option ids.
 *   3. The generation prompt describes them via `describePreferences`.
 *   4. `EXCLUSION_RULES` / `allowedClassesFor` enforce the two that are
 *      constraints rather than preferences.
 *
 * A second copy of any option list would let the form offer a choice the
 * validator rejects, or the prompt describe a constraint the enforcement does not
 * apply. Everything derives from the arrays below.
 *
 * ## Answers, defaults and skips
 *
 * `null` means "not answered" and is a first-class state, never coerced to the
 * default silently: `defaultLabel` is what the user is TOLD will be assumed, and
 * `ProfileSummary` renders assumptions as loudly as answers. The skip
 * transparency that already existed for AI follow-ups is preserved verbatim —
 * good MCQ options are meant to make skipping unnecessary, not impossible.
 */

import type { Objective } from "@/lib/portfolio/engines/optimize";
import type { GeneratableClass } from "./universe";
// `./types` imports SimPreferences from here. Both directions are `import type`
// and are erased at compile time, so this is a type-level reference, not a
// runtime require cycle — and one shared definition beats two drifting copies.
import type { SimHorizon } from "./types";

/* ────────────────────────────── The topics ──────────────────────────────── */

export const PREFERENCE_TOPICS = [
  "liquidity",
  "income",
  "tax",
  "exclusions",
  "geography",
  "concentration",
  "rebalancing",
  "breadth",
] as const;

export type PreferenceTopic = (typeof PREFERENCE_TOPICS)[number];

export interface PreferenceOption {
  /** Stable id. Persisted, so it must never be renamed without a migration. */
  id: string;
  label: string;
  /** How this answer changes the portfolio, stated to the model verbatim. */
  implication: string;
}

export interface PreferenceQuestion {
  topic: PreferenceTopic;
  /** The question, in the second person, as the user reads it. */
  question: string;
  /** One line of "why we're asking", shown under the question. */
  help: string;
  /** True for topics where several answers legitimately coexist. */
  multi: boolean;
  /**
   * Option id that means "none of the constraints apply". Selecting it clears
   * every other choice, because "No exclusions" plus "no tobacco" is not a
   * coherent answer and silently keeping both would apply a filter the user
   * believes they turned off.
   */
  exclusiveId?: string;
  /**
   * Whether a typed answer is offered. On by default — but it is genuinely
   * load-bearing only on `exclusions`, where the real answer is often a specific
   * name ("not my employer's stock") that no option list can anticipate.
   */
  allowOther: boolean;
  options: PreferenceOption[];
  /** What the profile assumes when the question is skipped, in the user's words. */
  defaultLabel: string;
  /** The same assumption, phrased for the model. */
  defaultImplication: string;
}

/**
 * Every option below is a position a real retail-to-HNW investor holds, written
 * so that recognising your own is a one-line read. Options within a question are
 * mutually distinct and ordered along a single axis (least → most), so the list
 * scans as a scale rather than as a menu to compare pairwise.
 */
export const PREFERENCE_QUESTIONS: PreferenceQuestion[] = [
  {
    topic: "liquidity",
    question: "How much of this might you need to reach on short notice?",
    help: "Decides the size of the cash sleeve and how much short-duration bond exposure is used.",
    multi: false,
    allowOther: true,
    options: [
      { id: "locked", label: "None of it — I can lock it away for the full horizon", implication: "No liquidity constraint. Cash may sit at the policy minimum and less-liquid instruments are acceptable." },
      { id: "small", label: "A small buffer — up to 5%, within a few days", implication: "Keep roughly 5% in cash or near-cash. Everything else may be fully invested." },
      { id: "moderate", label: "About 10–15% accessible within a week", implication: "Hold 10-15% across cash and short-duration instruments (e.g. SHY, VTIP)." },
      { id: "quarter", label: "A quarter or more must stay readily sellable", implication: "At least 25% in cash and short-duration treasuries. Avoid anything that is not daily-liquid." },
      { id: "all", label: "All of it — I need to exit the whole book within days", implication: "Every position must be daily-liquid, large-ETF or large-cap only. No single-name illiquidity, no niche funds." },
    ],
    defaultLabel: "About 5% kept in cash and short-duration instruments; the rest in daily-liquid public markets.",
    defaultImplication: "Assume a ~5% liquidity buffer and daily-liquid instruments throughout.",
  },
  {
    topic: "income",
    question: "Do you need this portfolio to pay you cash while you hold it?",
    help: "Decides whether the book is built for total return or for distributions, and how much yield is targeted.",
    multi: false,
    allowOther: true,
    options: [
      { id: "none", label: "No — reinvest everything, I want total return", implication: "No yield target. Prefer total-return instruments; dividend yield is irrelevant to selection." },
      { id: "secondary", label: "Nice to have, but growth comes first", implication: "Growth-first. A dividend tilt is acceptable only where it does not cost expected return." },
      { id: "steady", label: "Yes — a steady 2–4% a year, reinvested until I need it", implication: "Target 2-4% portfolio yield via quality dividend and investment-grade bond exposure (e.g. SCHD, VIG, BND)." },
      { id: "drawn", label: "Yes — 4%+ a year that I intend to draw and spend", implication: "Target 4%+ yield. Weight toward income instruments (LQD, SCHD, VNQ, O) and treat distributions as spending, not reinvestment." },
      { id: "predictable", label: "Yes, and it must be predictable — coupons and rent over variable dividends", implication: "Prioritise contractual income: bond coupons and net-lease REIT rent over discretionary dividends. Prefer bonds and O over dividend equity." },
    ],
    defaultLabel: "No income requirement — built for total return, with dividends reinvested.",
    defaultImplication: "Assume no income requirement; optimise for total return.",
  },
  {
    topic: "tax",
    question: "Which best describes the account this will sit in?",
    help: "Decides whether municipal bonds and tax-efficiency matter, or whether income can be taken freely.",
    multi: false,
    allowOther: true,
    options: [
      { id: "sheltered", label: "Tax-advantaged / retirement — gains and income are sheltered", implication: "No tax drag. Taxable income (corporate bonds, REITs, high-turnover funds) carries no penalty here." },
      { id: "taxable_us", label: "Taxable, US — sensitive to dividends and realized gains", implication: "Prefer tax-efficient, low-turnover instruments. Be sparing with high-dividend and REIT exposure in this account." },
      { id: "taxable_us_high", label: "Taxable, US, high bracket — prefer municipal and tax-efficient income", implication: "Use municipal bonds (MUB) in place of taxable credit for the fixed-income sleeve, and minimise distributing instruments." },
      { id: "taxable_intl", label: "Taxable, outside the US", implication: "Taxable account outside US jurisdiction: municipal bonds are NOT applicable. Prefer accumulating/low-distribution instruments and note US withholding on US dividends." },
      { id: "mixed", label: "A mix of sheltered and taxable", implication: "Mixed accounts: keep the book tax-aware but do not optimise hard for either regime." },
      { id: "na", label: "Not a consideration", implication: "Tax is explicitly not a design input." },
    ],
    defaultLabel: "Treated as a tax-advantaged account — no tax drag modelled, no municipal-bond preference.",
    defaultImplication: "Assume a tax-advantaged account; ignore tax efficiency.",
  },
  {
    topic: "exclusions",
    question: "Is there anything this portfolio must not hold?",
    help: "Applied as a hard filter — an excluded instrument is removed even if the model picks it.",
    multi: true,
    exclusiveId: "none",
    allowOther: true,
    options: [
      { id: "none", label: "No exclusions", implication: "No exclusions." },
      { id: "fossil", label: "Fossil fuels and high-carbon energy", implication: "Exclude oil, gas, coal and high-carbon energy instruments." },
      { id: "sin", label: "Tobacco, alcohol and gambling", implication: "Exclude tobacco, alcohol and gambling instruments." },
      { id: "weapons", label: "Weapons and defence", implication: "Exclude weapons and defence instruments." },
      { id: "crypto", label: "Crypto and digital assets", implication: "Exclude all crypto and digital-asset instruments." },
      { id: "single_names", label: "Individual single stocks — funds and ETFs only", implication: "Use only pooled instruments (ETFs and funds). No single-company positions of any kind." },
    ],
    defaultLabel: "No exclusions applied.",
    defaultImplication: "Assume no exclusions.",
  },
  {
    topic: "geography",
    question: "Where should the equity exposure sit?",
    help: "Decides the split between US, developed international and emerging markets.",
    multi: false,
    allowOther: true,
    options: [
      { id: "global", label: "Global market-cap weights — no view (≈60–65% US today)", implication: "Follow global market-cap weights: roughly 60-65% US, the rest developed and emerging ex-US (VTI + VXUS, or VT-style)." },
      { id: "us_tilt", label: "Home-biased US — 80% or more in the US", implication: "Deliberate US home bias: 80%+ of equity in US instruments, with a small ex-US sleeve." },
      { id: "us_only", label: "US only", implication: "US equity only. No ex-US equity instruments." },
      { id: "intl_tilt", label: "Deliberately more international than market weights", implication: "Overweight ex-US versus market-cap: raise VXUS/VEA above global weights and reduce US concentration." },
      { id: "em_tilt", label: "A meaningful emerging-market allocation", implication: "Include a deliberate emerging-market sleeve (VWO) above market-cap weight, accepting the higher volatility." },
    ],
    defaultLabel: "Global market-cap weights, which is roughly 60–65% US today.",
    defaultImplication: "Assume global market-cap weights (~60-65% US).",
  },
  {
    topic: "concentration",
    question: "What is the biggest single position you would be comfortable holding?",
    help: "Caps any one instrument's weight, and decides how many holdings the book needs.",
    multi: false,
    allowOther: true,
    options: [
      { id: "max2", label: "No more than 2% — as spread out as possible", implication: "No position above 2% of the portfolio. This implies a broad, fund-heavy book." },
      { id: "max5", label: "Up to 5% — diversified, with a few convictions", implication: "No position above 5% of the portfolio." },
      { id: "max10", label: "Up to 10% — normal for a focused book", implication: "No position above 10% of the portfolio." },
      { id: "max20", label: "Up to 20% — happy to concentrate on best ideas", implication: "Positions up to 20% are acceptable; a few high-conviction weights are wanted." },
      { id: "unlimited", label: "No limit — concentration is how you get returns", implication: "No concentration cap. Large single weights are explicitly acceptable." },
    ],
    defaultLabel: "No single position above 10% of the portfolio.",
    defaultImplication: "Assume no single position above 10%.",
  },
  {
    topic: "rebalancing",
    question: "How actively do you want to maintain this?",
    help: "Decides how many moving parts the design can justify — a buy-and-hold book should need less upkeep.",
    multi: false,
    allowOther: true,
    options: [
      { id: "never", label: "Buy and hold — ideally never touch it", implication: "Design for zero maintenance: few, broad, self-rebalancing instruments. Avoid anything needing active management." },
      { id: "yearly", label: "Check yearly, rebalance only if badly drifted", implication: "Annual, drift-triggered rebalancing. A moderate number of holdings is fine." },
      { id: "quarterly", label: "Rebalance quarterly back to target", implication: "Quarterly rebalancing to target weights; a more granular sleeve structure is supportable." },
      { id: "monthly", label: "Monthly, or whenever weights drift a few points", implication: "Tight rebalancing tolerance. A more precise, multi-sleeve design is justified." },
      { id: "active", label: "Actively — I'll trade around the targets", implication: "Active management intended: targets are a baseline the investor will deviate from deliberately." },
    ],
    defaultLabel: "Annual rebalancing back to target weights.",
    defaultImplication: "Assume annual rebalancing to target weights.",
  },
  {
    topic: "breadth",
    question: "Which of these may the portfolio use?",
    help: "Applied as a hard filter on asset classes — an unselected class is not allocated to at all.",
    multi: true,
    exclusiveId: "core_only",
    allowOther: false,
    options: [
      { id: "core_only", label: "Public stocks, ETFs and investment-grade bonds only", implication: "Restrict to equities, ETFs and investment-grade bonds. No REITs, commodities, crypto or high-yield credit." },
      { id: "reits", label: "Add listed real estate (REITs)", implication: "Listed REITs are permitted (VNQ, SCHH, O)." },
      { id: "commodities", label: "Add commodities and gold", implication: "Commodities and gold are permitted (GLD, IAU, DBC)." },
      { id: "crypto", label: "Add crypto — a small sleeve", implication: "A small crypto sleeve is permitted, sized as a satellite rather than a core holding." },
      { id: "high_yield", label: "Add high-yield / credit risk", implication: "High-yield credit is permitted (HYG) alongside investment grade." },
    ],
    defaultLabel: "Public equities, ETFs and investment-grade bonds, plus listed REITs.",
    defaultImplication: "Assume equities, ETFs, investment-grade bonds and listed REITs; no commodities, crypto or high-yield.",
  },
];

const BY_TOPIC = new Map(PREFERENCE_QUESTIONS.map((q) => [q.topic, q]));

export function preferenceQuestion(topic: PreferenceTopic): PreferenceQuestion {
  const q = BY_TOPIC.get(topic);
  if (!q) throw new Error(`Unknown preference topic: ${topic}`);
  return q;
}

/* ──────────────────────────── The stored answer ─────────────────────────── */

/**
 * One topic's answer. `null` for the whole topic means skipped.
 *
 * `optionIds` and `other` are both kept rather than collapsed to a single string
 * because the ids are what enforcement and the contradiction checks read, while
 * `other` is free text that only the prompt can interpret. Flattening them would
 * make a typed exclusion indistinguishable from a sentence about one.
 */
export interface PreferenceAnswer {
  optionIds: string[];
  /** Free text from "Other", or null. */
  other: string | null;
}

export type SimPreferences = Partial<Record<PreferenceTopic, PreferenceAnswer | null>>;

/** True when the topic was actually answered (an empty selection is not an answer). */
export function isAnswered(a: PreferenceAnswer | null | undefined): a is PreferenceAnswer {
  return !!a && (a.optionIds.length > 0 || !!a.other?.trim());
}

export function selectedOptions(topic: PreferenceTopic, a: PreferenceAnswer): PreferenceOption[] {
  const q = preferenceQuestion(topic);
  return a.optionIds
    .map((id) => q.options.find((o) => o.id === id))
    .filter((o): o is PreferenceOption => o !== undefined);
}

/** The user-facing answer text, for the profile summary and the prompt history. */
export function answerLabel(topic: PreferenceTopic, a: PreferenceAnswer): string {
  const parts = selectedOptions(topic, a).map((o) => o.label);
  if (a.other?.trim()) parts.push(a.other.trim());
  return parts.join("; ");
}

/* ───────────────────────── Rendering for the model ──────────────────────── */

/**
 * Every topic as a settled fact, answered or defaulted.
 *
 * Skipped topics are included with their default and labelled as an assumption
 * rather than omitted: the model must design against a complete mandate, and a
 * silently missing topic is what let it re-ask questions the form had already
 * covered.
 */
export function describePreferences(prefs: SimPreferences): string {
  return PREFERENCE_QUESTIONS.map((q) => {
    const a = prefs[q.topic];
    if (!isAnswered(a)) return `- ${q.question} (not answered; ASSUME: ${q.defaultImplication})`;
    const implications = selectedOptions(q.topic, a).map((o) => o.implication);
    if (a.other?.trim()) implications.push(`The client also specified: "${a.other.trim()}"`);
    return `- ${q.question}\n  ANSWER: ${answerLabel(q.topic, a)}\n  MEANS: ${implications.join(" ")}`;
  }).join("\n");
}

/* ──────────────────── The two that are hard constraints ─────────────────── */

/**
 * Substrings that identify an excluded instrument, per exclusion id.
 *
 * Deliberately matched against the curated universe's own `name` and `role`
 * text, which is why the terms are broad. This is a backstop, not the primary
 * mechanism: the prompt states every exclusion, and this catches the cases where
 * a 7B model states a constraint and then violates it anyway. A false positive
 * costs one candidate out of a curated list of a dozen per class; a false
 * negative puts a tobacco stock in the portfolio of someone who asked for none,
 * which is the failure that actually matters.
 */
export const EXCLUSION_RULES: Record<string, { terms: RegExp; label: string }> = {
  fossil: {
    terms: /\b(oil|gas|coal|energy|petroleum|exxon|chevron|shell|bp|conocophillips|pipeline|midstream|drill)\b/i,
    label: "fossil fuels and high-carbon energy",
  },
  sin: {
    terms: /\b(tobacco|cigarette|altria|philip morris|alcohol|brewer|brewing|distill|spirits|diageo|anheuser|gambling|casino|betting|wynn|caesars)\b/i,
    label: "tobacco, alcohol and gambling",
  },
  weapons: {
    terms: /\b(weapon|defen[cs]e|aerospace|arms|munition|lockheed|raytheon|rtx|northrop|general dynamics|bae)\b/i,
    label: "weapons and defence",
  },
  crypto: {
    terms: /\b(crypto|bitcoin|btc|ethereum|eth|solana|coin|digital asset|blockchain)\b/i,
    label: "crypto and digital assets",
  },
};

/** Asset classes each `breadth` option unlocks, beyond the always-allowed core. */
const BREADTH_CLASSES: Record<string, GeneratableClass[]> = {
  core_only: [],
  reits: ["reit"],
  commodities: ["commodity"],
  crypto: ["crypto"],
  high_yield: [], // a credit-quality preference within `bond`, not a class of its own
};

/** The core the generator may always use: equities, funds, bonds and the cash sleeve. */
const CORE_CLASSES: GeneratableClass[] = ["equity", "etf", "bond", "cash"];

/**
 * Which asset classes this mandate permits.
 *
 * A hard filter, not a hint. "Public stocks, ETFs and investment-grade bonds
 * only" is an instruction; a crypto sleeve appearing in that book is a defect,
 * not a creative interpretation, and the prompt alone cannot guarantee it won't
 * happen. The DEFAULT (topic skipped) is core + REITs, matching `defaultLabel`
 * — so the two can never disagree about what an unanswered question implies.
 */
export function allowedClassesFor(prefs: SimPreferences): Set<GeneratableClass> {
  const answer = prefs.breadth;
  const allowed = new Set<GeneratableClass>(CORE_CLASSES);
  if (!isAnswered(answer)) {
    allowed.add("reit");
    return withExclusionsApplied(allowed, prefs);
  }
  for (const id of answer.optionIds) for (const cls of BREADTH_CLASSES[id] ?? []) allowed.add(cls);
  return withExclusionsApplied(allowed, prefs);
}

/**
 * Exclusions that remove a whole class rather than individual instruments.
 *
 * Two of them do. `crypto` appears as both a breadth option and an exclusion, and
 * a user who ticks both is contradicting themselves across two questions — the
 * exclusion is the more explicit instruction, so it wins. And "funds and ETFs
 * only" empties the `equity` class outright, because the curated equity menu is
 * single-company names by construction; the equity exposure that mandate wants is
 * an ETF, and leaving `equity` allowed would have the generator try to fill a
 * budget from a menu where every candidate is forbidden.
 */
function withExclusionsApplied(
  allowed: Set<GeneratableClass>,
  prefs: SimPreferences,
): Set<GeneratableClass> {
  if (isExcluded("crypto", prefs)) allowed.delete("crypto");
  if (fundsOnly(prefs)) allowed.delete("equity");
  return allowed;
}

export function isExcluded(exclusionId: string, prefs: SimPreferences): boolean {
  const a = prefs.exclusions;
  return isAnswered(a) && a.optionIds.includes(exclusionId);
}

/** True when only pooled instruments (ETFs/funds) are acceptable. */
export function fundsOnly(prefs: SimPreferences): boolean {
  return isExcluded("single_names", prefs);
}

/**
 * Why a candidate is not allowed, or null when it is.
 *
 * Returns the reason rather than a boolean so a dropped pick can be reported to
 * the user — silently removing an instrument the model chose looks like a bug in
 * the generator rather than the constraint doing its job.
 */
export function exclusionReason(
  candidate: { symbol: string; name: string; assetClass: GeneratableClass; role?: string },
  prefs: SimPreferences,
): string | null {
  const allowed = allowedClassesFor(prefs);
  if (!allowed.has(candidate.assetClass)) {
    return `${candidate.assetClass} is outside the instrument types this mandate permits`;
  }

  const a = prefs.exclusions;
  if (!isAnswered(a)) return null;

  const haystack = `${candidate.symbol} ${candidate.name} ${candidate.role ?? ""}`;
  for (const id of a.optionIds) {
    const rule = EXCLUSION_RULES[id];
    if (rule && rule.terms.test(haystack)) return `matches the exclusion on ${rule.label}`;
  }

  // "Funds and ETFs only" is checked by class, not by name: an ETF is pooled by
  // definition and a single equity or REIT operating company is not.
  if (a.optionIds.includes("single_names") && (candidate.assetClass === "equity" || candidate.assetClass === "reit")) {
    // A REIT *fund* is pooled; only a single-name REIT is caught. The curated
    // universe distinguishes them by role, and everything else errs toward
    // allowing the pick and letting the prompt's instruction stand.
    const isFund = /\b(etf|fund|index|trust)\b/i.test(`${candidate.name} ${candidate.role ?? ""}`);
    if (!isFund) return "is a single-name holding, and this mandate is funds and ETFs only";
  }
  return null;
}

/* ─────────────────────── Where the AI is still needed ───────────────────── */

/**
 * A contradiction or conditional gap worth one model question.
 *
 * `question` and `options` are written HERE, deterministically, rather than left
 * to the model, for the same reason the topics above are: we already know what
 * the conflict is and what the two ways out of it are. The model's remaining job
 * is phrasing nothing and deciding nothing — it is only consulted when this list
 * is empty and something still feels underspecified.
 */
export interface ProfileGap {
  id: string;
  question: string;
  options: string[];
  assumptionIfSkipped: string;
}

/**
 * Deterministic contradictions in a completed profile, worst first.
 *
 * Checked in code before any model call, so a coherent profile costs zero
 * seconds of inference and asks zero follow-ups — the entire point of moving the
 * standard topics into the form. Each check compares two answers the user gave;
 * none of them guesses at anything.
 */
export function profileGaps(profile: {
  /**
   * Typed, not `string`. An earlier draft took `string` here and was written
   * against invented ids (`max_income`, `min_volatility`, `max_return`) that do
   * not exist in `OBJECTIVES` — every check that referenced one silently never
   * fired, which is the worst possible failure for a contradiction detector: it
   * reports a clean profile. The compiler catches that now.
   */
  objective: Objective;
  riskAppetite: number;
  horizon: SimHorizon;
  preferences: SimPreferences;
}): ProfileGap[] {
  const { objective, riskAppetite, horizon, preferences: p } = profile;
  const gaps: ProfileGap[] = [];
  const answerOf = (t: PreferenceTopic) => {
    const a = p[t];
    return isAnswered(a) ? a.optionIds : [];
  };

  const defensive = objective === "preserve_capital" || objective === "minimize_volatility";
  const aggressive = objective === "maximize_return" || objective === "growth";

  if (defensive && riskAppetite >= 7) {
    gaps.push({
      id: "objective-vs-risk-defensive",
      question: `Your objective is capital preservation, but your risk appetite is ${riskAppetite}/10 — which should win?`,
      options: [
        "Preserve capital — dial the risk down to match the objective",
        "The risk appetite — I want growth and mis-picked the objective",
        "Split it — a defensive core with a deliberately aggressive satellite",
      ],
      assumptionIfSkipped: "The stated objective wins; the portfolio is built defensively.",
    });
  }
  if (aggressive && riskAppetite <= 3) {
    gaps.push({
      id: "objective-vs-risk-aggressive",
      question: `Your objective is growth, but your risk appetite is ${riskAppetite}/10 — which should win?`,
      options: [
        "The risk appetite — keep drawdowns small even if it costs return",
        "Growth — I can tolerate more than the slider suggests",
        "Split it — a conservative core with a small growth sleeve",
      ],
      assumptionIfSkipped: "The risk appetite wins; expected return is reduced to keep drawdowns within tolerance.",
    });
  }
  if (objective === "maximize_income" && answerOf("income").includes("none")) {
    gaps.push({
      id: "income-contradiction",
      question: "Your objective is maximum income, but you said you don't need the portfolio to pay you cash — which is it?",
      options: [
        "I do want income — the objective is right",
        "I want total return — reinvest everything and ignore yield",
        "Build it for income but reinvest the distributions for now",
      ],
      assumptionIfSkipped: "Built for income, with distributions reinvested until you need them.",
    });
  }
  if (horizon === "short" && riskAppetite >= 7) {
    gaps.push({
      id: "horizon-vs-risk",
      question: `This is a horizon under two years with a risk appetite of ${riskAppetite}/10. A drawdown may not have time to recover — what takes priority?`,
      options: [
        "The short horizon — protect the money, it is needed soon",
        "The risk appetite — I accept I might have to sell at a loss",
        "The date is soft; treat it as a medium horizon",
      ],
      assumptionIfSkipped: "The short horizon wins; risk is reduced so the money is there when it is needed.",
    });
  }
  if (horizon === "long" && answerOf("liquidity").includes("all")) {
    gaps.push({
      id: "horizon-vs-liquidity",
      question: "You have a long horizon but need to be able to exit the whole book within days — which is the real constraint?",
      options: [
        "Full liquidity — everything must be daily-tradeable",
        "The long horizon — some of it can be less liquid",
        "Keep a liquid sleeve and let the rest be long-term",
      ],
      assumptionIfSkipped: "Full daily liquidity is treated as the binding constraint.",
    });
  }
  if (answerOf("exclusions").includes("single_names") && answerOf("concentration").includes("unlimited")) {
    gaps.push({
      id: "funds-vs-concentration",
      question: "You asked for funds and ETFs only but set no concentration limit. How concentrated should the fund positions be?",
      options: [
        "One or two broad funds is fine — simplicity over spread",
        "Cap any single fund at about 25%",
        "Spread across several funds despite the lack of a stated cap",
      ],
      assumptionIfSkipped: "No cap applied, but the book is spread across several broad funds.",
    });
  }
  if (answerOf("tax").includes("taxable_us_high") && objective === "maximize_income") {
    gaps.push({
      id: "tax-income-muni",
      question: "A high US bracket with an income objective — should the fixed-income sleeve be municipal (tax-exempt) rather than corporate?",
      options: [
        "Yes — municipals, even at a lower headline yield",
        "No — maximise pre-tax yield with corporate credit",
        "Split it between municipal and corporate",
      ],
      assumptionIfSkipped: "Municipal bonds are used for the fixed-income sleeve.",
    });
  }
  return gaps;
}
