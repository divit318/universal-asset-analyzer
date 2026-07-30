/**
 * Portfolio generation — mandate → complete, live-priced hypothetical book.
 *
 * Five stages, each with a deterministic guard around the AI:
 *
 *  1. allocate — AI designs asset-class weights (the objective's strategic
 *     target is the prior); falls back to that target verbatim if the AI
 *     fails. Weights are normalized to 100 with the policy cash floor.
 *  2. select  — AI picks instruments per class from the curated menu plus
 *     free-form satellites, each with a one-line rationale.
 *  3. size    — every pick is validated against a LIVE quote (an invented
 *     ticker dies here), then converted to real share counts against the
 *     stated cash; the un-investable residual becomes the cash sleeve.
 *  4. evaluate — the same engines as the real portfolio (see ./evaluate.ts).
 *  5. narrate — thesis + strategy tags via the shared thesis builder.
 *
 * The AI proposes; validation disposes. Nothing an AI invents can reach the
 * persisted holdings without a live price behind it.
 */

import { runPromptWithMeta } from "@/lib/ai";
import { extractJson } from "@/lib/json-extract";
import { DEFAULT_CONSTRAINTS, OBJECTIVES } from "@/lib/portfolio/engines/optimize";
import { buildMarketContext } from "@/lib/portfolio/context";
import { buildPortfolioThesis } from "@/lib/portfolio/thesis";
import type { MarketContext } from "@/lib/portfolio/model/types";
import { evaluateSimHoldings, simHoldingsToRaw, type SimEvaluation } from "./evaluate";
import {
  GENERATABLE_CLASSES,
  fallbackCandidate,
  universeForPrompt,
  type CandidateFilter,
  type GeneratableClass,
} from "./universe";
import {
  allowedClassesFor,
  describePreferences,
  exclusionReason,
  type SimPreferences,
} from "./preferences";
import type { SimHolding, SimProfile, SimThesis } from "./types";

/**
 * The mandate's hard constraints, as a candidate filter.
 *
 * Exclusions and permitted instrument types are the two answers that are
 * instructions rather than preferences: "no tobacco" and "funds and ETFs only"
 * are not tradeoffs the model may weigh against expected return. The prompt
 * states them, and this enforces them — because a 7B model has been observed
 * asserting a constraint and then violating it in the same response, and an
 * excluded holding in a generated portfolio is the kind of error that makes the
 * whole tool untrustworthy.
 *
 * Concentration and geography are deliberately NOT enforced here. Both are
 * genuine tradeoffs against the objective's own targets, and a hard cap applied
 * after the fact would silently unbalance a book the model had balanced.
 */
export function candidateFilterFor(prefs: SimPreferences): CandidateFilter {
  return (c) => exclusionReason(c, prefs) === null;
}

const AI_TIMEOUT_MS = 300_000; // generation is watched, not waited on — quality first
const SYMBOL_RE = /^[A-Z0-9.\-=^]{1,12}$/;

export type GenerationStage = "allocate" | "select" | "size" | "evaluate" | "narrate";

export interface GenerationProgress {
  stage: GenerationStage;
  message: string;
  pct: number;
}

export interface GenerationResult {
  holdings: SimHolding[];
  thesis: SimThesis;
  evaluation: SimEvaluation;
  /** Stages where the AI failed and a deterministic fallback was used. */
  fallbacks: GenerationStage[];
  /**
   * Symbols the model picked that the mandate's exclusions forbade.
   *
   * Reported rather than swallowed: a book that came back thinner than the
   * budgets asked for needs to read as the client's own constraint being honoured,
   * not as the generator losing positions.
   */
  excluded: string[];
}

/* ────────────────────────── Stage 1: allocation ────────────────────────── */

export type ClassAllocation = Partial<Record<GeneratableClass, number>>;

const INVESTABLE = GENERATABLE_CLASSES.filter((c): c is Exclude<GeneratableClass, "cash"> => c !== "cash");

/** Normalize any proposed weights: known classes only, negatives dropped, the
 * whole thing scaled to exactly 100 — with the policy cash floor applied to
 * the FINAL percentages, so an over-proposed book (e.g. 60+60+0 cash) cannot
 * squeeze cash below the floor during scaling. */
export function normalizeAllocation(
  proposed: Record<string, unknown>,
  /** Classes this mandate permits. Omitted = every generatable class. */
  allowed?: Set<GeneratableClass>,
): ClassAllocation {
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const minCash = DEFAULT_CONSTRAINTS.minCashPct;

  const investable: [GeneratableClass, number][] = [];
  let cashProposed = 0;
  for (const cls of GENERATABLE_CLASSES) {
    // A forbidden class is dropped BEFORE scaling, so its weight is
    // redistributed across what the mandate does allow rather than deleted from
    // the book — an excluded 5% commodity sleeve must not become 5% unexplained
    // cash drag.
    if (allowed && !allowed.has(cls)) continue;
    const v = Number(proposed[cls]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (cls === "cash") cashProposed = v;
    else investable.push([cls, v]);
  }
  const invSum = investable.reduce((s, [, v]) => s + v, 0);
  if (invSum <= 0) return { cash: 100 }; // nothing investable proposed

  // Cash keeps its proposed share of the book, floored at policy minimum;
  // the investable classes split the remainder pro-rata.
  const naiveCashPct = (cashProposed / (invSum + cashProposed)) * 100;
  const cashPct = Math.max(minCash, round1(naiveCashPct));
  const scale = (100 - cashPct) / invSum;

  const out: ClassAllocation = {};
  for (const [cls, v] of investable) out[cls] = round1(v * scale);
  // Rounding drift lands in cash so the book always sums to exactly 100.
  const sum = Object.values(out).reduce((s, v) => s + (v ?? 0), 0);
  out.cash = round1(100 - sum);
  return out;
}

/** The objective's strategic target, restricted to generatable classes —
 * the prior for the AI and the verbatim fallback when it fails. */
export function fallbackAllocation(profile: SimProfile): ClassAllocation {
  const target = OBJECTIVES[profile.objective].target;
  const proposed: Record<string, number> = {};
  for (const [cls, v] of Object.entries(target)) {
    if ((GENERATABLE_CLASSES as readonly string[]).includes(cls) && typeof v === "number") {
      proposed[cls] = v;
    }
  }
  // The objective's strategic target is a house view; the client's permitted
  // instrument types are an instruction. Inflation Protection targets 20%
  // commodities, but if the client said public equities and bonds only, the
  // fallback must honour that rather than the template.
  return normalizeAllocation(proposed, allowedClassesFor(profile.preferences));
}

function profileFacts(profile: SimProfile): string {
  const objective = OBJECTIVES[profile.objective];
  const followUps =
    profile.followUps.length === 0
      ? "None."
      : profile.followUps
          .map((f) =>
            f.answer !== null
              ? `- ${f.question} → ${f.answer}`
              : `- ${f.question} → (skipped; assume: ${f.assumption ?? "sensible default"})`,
          )
          .join("\n");
  return `Mandate:
- Investable cash: ${profile.cash.toLocaleString("en-US")} ${profile.currency}
- Horizon: ${profile.horizon}${profile.targetDate ? ` (target date ${profile.targetDate})` : ""}
- Objective: ${objective.label} — ${objective.description}
- Risk appetite: ${profile.riskAppetite}/10, max acceptable drawdown ~${profile.maxDrawdownPct}%
- ${profile.role === "complement" ? "Must COMPLEMENT an existing portfolio (diversify against it)" : "Standalone portfolio"}

Client constraints and preferences (each with what it MEANS for the design — these
are answers the client actually gave, not inferences; honour every one):
${describePreferences(profile.preferences)}

Additional answers from the intake interview:
${followUps}`;
}

export function buildAllocationPrompt(profile: SimProfile): string {
  const prior = fallbackAllocation(profile);
  const allowed = [...allowedClassesFor(profile.preferences)];
  return `You are a portfolio architect. Design the asset-class allocation for this mandate.

${profileFacts(profile)}

The strategic prior for a "${OBJECTIVES[profile.objective].label}" mandate is: ${JSON.stringify(prior)}. Adjust it for THIS client's answers (risk appetite, drawdown tolerance, liquidity/income needs, exclusions, horizon) — or keep it if no answer justifies a change.

Available asset classes: ${allowed.join(", ")}. This list is the client's own instruction about what the portfolio may hold — any class NOT listed is forbidden and a weight for it will be discarded. Weights are percentages of total portfolio value and must sum to 100. Keep at least ${DEFAULT_CONSTRAINTS.minCashPct}% cash.

Respond with JSON only:
{"allocation": {"etf": 40, "bond": 30, "equity": 15, "reit": 5, "commodity": 5, "cash": 5}, "strategy": "<one sentence describing the design>"}`;
}

/* ────────────────────────── Stage 2: selection ─────────────────────────── */

export interface SelectionPick {
  symbol: string;
  assetClass: Exclude<GeneratableClass, "cash">;
  name: string;
  /** Designed weight, % of TOTAL portfolio value. */
  weightPct: number;
  why: string;
}

export function buildSelectionPrompt(profile: SimProfile, allocation: ClassAllocation): string {
  const budgets = (Object.entries(allocation) as [GeneratableClass, number][])
    .filter(([cls, v]) => cls !== "cash" && v > 0)
    .map(([cls, v]) => `- ${cls}: ${v}% of the portfolio`)
    .join("\n");
  const classes = (Object.keys(allocation) as GeneratableClass[]).filter(
    (c): c is Exclude<GeneratableClass, "cash"> => c !== "cash" && (allocation[c] ?? 0) > 0,
  );

  return `You are a portfolio architect selecting the actual instruments for this mandate.

${profileFacts(profile)}

Class budgets to fill (cash is handled separately — do NOT pick cash instruments):
${budgets}

Curated menu (prefer these for core positions; you may add other instruments you are certain are real, liquid tickers — anything invalid will be discarded). This menu has ALREADY had the client's exclusions applied, so everything on it is permitted:
${universeForPrompt(classes, candidateFilterFor(profile.preferences))}

Rules:
- 8 to 16 holdings total. For a class with a budget ≥ 20%, use 2-5 instruments; smaller classes 1-2.
- weightPct is the percentage of the TOTAL portfolio; a class's picks must sum to that class's budget.
- No position under 2%.
- Honor every exclusion or constraint from the client's answers. Any pick that breaches one is discarded automatically, which leaves the portfolio thinner than intended — so do not spend a pick on one.
- "why" is one concrete sentence (≤ 140 chars) explaining why THIS instrument at THIS weight for THIS client — advice-grade, not generic filler.

Respond with JSON only:
{"picks": [{"symbol": "VOO", "assetClass": "etf", "name": "Vanguard S&P 500 ETF", "weightPct": 25, "why": "..."}]}`;
}

/** Validate the AI's picks and renormalize each class's weights to exactly
 * its budget. Classes the AI left empty get their curated fallback. */
export function parseSelectionResponse(
  raw: string,
  allocation: ClassAllocation,
  /** Mandate constraints. Omitted = no exclusions (used by callers with no profile). */
  allow?: CandidateFilter,
): { picks: SelectionPick[]; dropped: string[] } {
  const parsed = extractJson<{ picks?: unknown }>(raw);
  const arr = Array.isArray(parsed.picks) ? parsed.picks : [];
  const picks: SelectionPick[] = [];
  const dropped: string[] = [];
  for (const p of arr) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const symbol = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
    const assetClass = o.assetClass as Exclude<GeneratableClass, "cash">;
    const weightPct = Number(o.weightPct);
    if (!SYMBOL_RE.test(symbol)) continue;
    if (!INVESTABLE.includes(assetClass)) continue;
    if (!Number.isFinite(weightPct) || weightPct <= 0) continue;
    if (picks.some((x) => x.symbol === symbol)) continue;
    const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : symbol;

    // Enforcement, not a hint. The model is told the exclusions and still
    // sometimes picks against them; `dropped` is surfaced to the user so a
    // thinner book reads as the constraint working rather than as a bug.
    if (allow && !allow({ symbol, name, role: "", assetClass })) {
      dropped.push(symbol);
      continue;
    }

    picks.push({
      symbol,
      assetClass,
      name,
      weightPct,
      why: typeof o.why === "string" && o.why.trim() ? o.why.trim().slice(0, 200) : "",
    });
  }
  return { picks: rebalanceToBudgets(picks, allocation, allow), dropped };
}

/** Deterministic selection when the AI fails outright: one core permitted
 * instrument per budgeted class, honest generic rationale. */
export function fallbackSelection(allocation: ClassAllocation, allow?: CandidateFilter): SelectionPick[] {
  const picks: SelectionPick[] = [];
  for (const cls of INVESTABLE) {
    const budget = allocation[cls] ?? 0;
    if (budget <= 0) continue;
    const c = fallbackCandidate(cls, allow);
    if (!c) continue; // the mandate forbids everything in this class
    picks.push({
      symbol: c.symbol,
      assetClass: cls,
      name: c.name,
      weightPct: budget,
      why: `Core ${cls} exposure via ${c.name} — chosen deterministically because the AI selector was unavailable.`,
    });
  }
  return picks;
}

/** Scale each class's picks to sum to exactly the class budget; fill classes
 * with no (surviving) picks from the curated fallback. */
export function rebalanceToBudgets(
  picks: SelectionPick[],
  allocation: ClassAllocation,
  allow?: CandidateFilter,
): SelectionPick[] {
  const out: SelectionPick[] = [];
  for (const cls of INVESTABLE) {
    const budget = allocation[cls] ?? 0;
    if (budget <= 0) continue;
    const inClass = picks.filter((p) => p.assetClass === cls);
    if (inClass.length === 0) {
      const c = fallbackCandidate(cls, allow);
      // No permitted candidate: the class goes unfilled and its budget lands in
      // the cash sleeve. Backfilling with an excluded instrument to hit a target
      // weight would break the one promise these answers make.
      if (!c) continue;
      out.push({
        symbol: c.symbol,
        assetClass: cls,
        name: c.name,
        weightPct: budget,
        why: `Core ${cls} exposure via ${c.name}.`,
      });
      continue;
    }
    const sum = inClass.reduce((s, p) => s + p.weightPct, 0);
    for (const p of inClass) {
      out.push({ ...p, weightPct: Math.round((p.weightPct / sum) * budget * 100) / 100 });
    }
  }
  return out;
}

/* ────────────────────────── Stage 3: sizing ────────────────────────────── */

/** Convert validated picks into real share counts against the stated cash.
 * Share-denominated assets buy whole shares; crypto buys fractional coins.
 * Whatever cannot be invested (rounding residual, dropped picks) is the cash
 * sleeve — value is conserved to the cent. */
export function sizeHoldings(
  picks: SelectionPick[],
  quoteFor: (symbol: string) => { price: number; currency: string | null; name: string | null } | null,
  fx: Record<string, number>,
  cash: number,
  currency: string,
  cashTargetPct: number,
): SimHolding[] {
  const holdings: SimHolding[] = [];
  let invested = 0;

  for (const p of picks) {
    const q = quoteFor(p.symbol);
    if (!q || !Number.isFinite(q.price) || q.price <= 0) continue; // invented or unquotable → dies here
    const quoteCurrency = q.currency ?? "USD";
    const priceBase = q.price * (quoteCurrency === currency ? 1 : (fx[quoteCurrency] ?? 1));
    const budget = (cash * p.weightPct) / 100;

    const fractional = p.assetClass === "crypto";
    const quantity = fractional
      ? Math.floor((budget / priceBase) * 1e6) / 1e6
      : Math.floor(budget / priceBase);
    if (quantity <= 0) continue; // price exceeds the position budget

    invested += quantity * priceBase;
    holdings.push({
      symbol: p.symbol,
      name: q.name ?? p.name,
      assetClass: p.assetClass,
      currency: quoteCurrency,
      quantity,
      targetWeight: p.weightPct,
      rationale: p.why || null,
      addedBy: "ai",
    });
  }

  const sleeve = Math.max(0, Math.round((cash - invested) * 100) / 100);
  if (sleeve > 0) {
    holdings.push({
      symbol: null,
      name: `Cash (${currency})`,
      assetClass: "cash",
      currency,
      quantity: sleeve,
      targetWeight: Math.max(cashTargetPct, Math.round((sleeve / cash) * 1000) / 10),
      rationale: "Liquidity sleeve — the designed cash floor plus whole-share rounding residue.",
      addedBy: "ai",
    });
  }
  return holdings;
}

/* ────────────────────────── The pipeline ───────────────────────────────── */

export async function generatePortfolio(
  profile: SimProfile,
  opts: { onProgress?: (p: GenerationProgress) => void; signal?: AbortSignal } = {},
): Promise<GenerationResult> {
  const emit = (stage: GenerationStage, message: string, pct: number) =>
    opts.onProgress?.({ stage, message, pct });
  const fallbacks: GenerationStage[] = [];
  // The mandate's hard constraints, resolved once and applied at every stage
  // that can introduce an instrument: the allocation, the menu the model sees,
  // its picks, and the deterministic fallbacks behind all three.
  const allow = candidateFilterFor(profile.preferences);
  const allowedClasses = allowedClassesFor(profile.preferences);

  // 1. Allocation
  emit("allocate", "Designing the asset-class allocation…", 5);
  let allocation: ClassAllocation;
  try {
    const { text } = await runPromptWithMeta("portfolio-construction", buildAllocationPrompt(profile), {
      json: true,
      timeoutMs: AI_TIMEOUT_MS,
      signal: opts.signal,
    });
    const parsed = extractJson<{ allocation?: Record<string, unknown> }>(text);
    allocation = normalizeAllocation(parsed.allocation ?? {}, allowedClasses);
    if (Object.keys(allocation).length <= 1) throw new Error("empty allocation");
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    allocation = fallbackAllocation(profile);
    fallbacks.push("allocate");
  }

  // 2. Selection
  emit("select", "Selecting instruments for each class…", 25);
  let picks: SelectionPick[];
  let excluded: string[] = [];
  try {
    const { text } = await runPromptWithMeta("portfolio-construction", buildSelectionPrompt(profile, allocation), {
      json: true,
      timeoutMs: AI_TIMEOUT_MS,
      signal: opts.signal,
    });
    const selection = parseSelectionResponse(text, allocation, allow);
    picks = selection.picks;
    excluded = selection.dropped;
    if (picks.length === 0) throw new Error("no valid picks");
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    picks = fallbackSelection(allocation, allow);
    fallbacks.push("select");
  }

  // 3. Live validation + sizing. One market context serves validation, sizing
  // AND evaluation — everything prices against the same snapshot. Curated
  // fallbacks ride along as candidates so a class whose picks all die at
  // validation can be refilled without a second fetch.
  emit("size", "Validating tickers against live quotes and sizing positions…", 45);
  const fallbackSymbols = INVESTABLE.map((cls) => fallbackCandidate(cls, allow)?.symbol).filter(
    (s): s is string => s !== undefined,
  );
  const probeRaws = simHoldingsToRaw(
    picks.map((p) => ({
      symbol: p.symbol,
      name: p.name,
      assetClass: p.assetClass,
      currency: profile.currency,
      quantity: 1,
      targetWeight: p.weightPct,
      rationale: null,
      addedBy: "ai" as const,
    })),
  );
  const ctx: MarketContext = await buildMarketContext(probeRaws, {
    baseCurrency: profile.currency,
    candidateSymbols: fallbackSymbols,
  });

  const survivors = picks.filter((p) => ctx.quotes.has(p.symbol));
  const validated = rebalanceToBudgets(survivors, allocation, allow).filter((p) => ctx.quotes.has(p.symbol));
  const holdings = sizeHoldings(
    validated,
    (s) => ctx.quotes.get(s) ?? null,
    ctx.fx,
    profile.cash,
    profile.currency,
    allocation.cash ?? DEFAULT_CONSTRAINTS.minCashPct,
  );
  if (holdings.filter((h) => h.assetClass !== "cash").length === 0) {
    throw new Error(
      "No holding survived live-quote validation — market data is unavailable right now. Try again.",
    );
  }

  // 4. Evaluation through the real engines
  emit("evaluate", "Scoring health, risk and stress scenarios…", 65);
  const evaluation = await evaluateSimHoldings(holdings, profile.currency, ctx);

  // 5. Narrate
  emit("narrate", "Writing the strategy summary…", 85);
  const thesis = await buildPortfolioThesis({
    holdings: evaluation.holdings,
    totalValue: evaluation.totalValue,
    allocation: evaluation.allocation,
    risk: evaluation.risk,
    health: evaluation.health,
  });

  emit("narrate", "Done", 100);
  return {
    holdings,
    thesis: {
      summary: thesis.thesis,
      tags: thesis.identity,
      generatedAt: thesis.generatedAt,
      source: thesis.source,
    },
    evaluation,
    fallbacks,
    excluded,
  };
}
