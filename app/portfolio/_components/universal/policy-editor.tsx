"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { Button } from "@/app/_components/ui";
import { computeAlignment, detectPolicyConflicts, growthBandFor, type AlignmentReport } from "@/lib/portfolio/alignment/engine";
import {
  ALIGNMENT_THEMES,
  answersFromPolicy,
  applyPolicyPatch,
  derivePolicy,
  priorityShares,
  type AlignmentThemeId,
  type InvestorPolicy,
  type PolicyAnswers,
  type PolicyPatch,
  type PriorityLevel,
} from "@/lib/portfolio/alignment/policy";
import type { PortfolioAllocation } from "@/lib/portfolio/engines/allocation";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { Holding } from "@/lib/portfolio/model/types";

/**
 * The investor-policy editor — where the user tells UAA what THEY are
 * optimizing for, instead of being graded against universal weights.
 *
 * Two registers, deliberately not twelve sliders:
 *
 *   SIMPLE — eight recognition-over-composition questions (the intake lesson
 *   from simulator/preferences.ts). Every option states its consequence in
 *   real units on the chip itself, so deriving the policy never smuggles in a
 *   number the user can't see.
 *
 *   ADVANCED — the derived policy laid bare and LIVE against the actual book:
 *   per-theme priority levels with the score share each carries and the score
 *   that theme reads under the DRAFT policy right now; numeric limits with the
 *   book's measured value printed beside each one ("largest position today:
 *   25.4%"), so a limit is set against a fact instead of into a void; and a
 *   running "score with this policy: 66 → 74" preview computed by the REAL
 *   alignment engine on every edit. That last part is what makes Advanced
 *   genuinely advanced: the engine is pure and the page already holds the
 *   facts, so the editor can afford to answer "what would this setting change?"
 *   with a measurement instead of a description — the same engine, the same
 *   number the panel will show after saving, never a second scorer.
 *
 * One draft object is the single source of truth; both registers render it.
 */

/** The measured book, straight off the already-loaded report — never refetched. */
export interface PolicyEditorFacts {
  holdings: Holding[];
  totalValue: number;
  allocation: PortfolioAllocation;
  risk: UniversalRisk;
}

interface Option<V extends string> {
  value: V;
  label: string;
  /** The consequence, stated in real units. Shown on the chip. */
  detail: string;
}

const GOAL_OPTIONS: Option<PolicyAnswers["goal"]>[] = [
  { value: "growth", label: "Long-term growth", detail: "Compounding first; volatility is the price of admission" },
  { value: "balanced", label: "Balanced", detail: "Growth and stability in roughly equal measure" },
  { value: "income", label: "Income", detail: "The book should pay cash while held" },
  { value: "preservation", label: "Capital preservation", detail: "Not losing it matters more than growing it" },
];

const HORIZON_OPTIONS: Option<PolicyAnswers["horizon"]>[] = [
  { value: "short", label: "Under 3 years", detail: "Less time to recover a drawdown" },
  { value: "medium", label: "3–10 years", detail: "" },
  { value: "long", label: "10+ years", detail: "Time to sit through full cycles" },
];

const DRAWDOWN_OPTIONS: Option<PolicyAnswers["drawdown"]>[] = [
  { value: "shallow", label: "Shallow", detail: "≤15% — I'd sell into a deep decline" },
  { value: "moderate", label: "Moderate", detail: "≤30% — a bear market, held" },
  { value: "deep", label: "Deep", detail: "≤45% — 2008-scale, held" },
  { value: "severe", label: "Severe", detail: "≤60% — nothing shakes me out" },
];

const CONCENTRATION_OPTIONS: Option<PolicyAnswers["concentration"]>[] = [
  { value: "spread", label: "Spread out", detail: "No position above 5%" },
  { value: "diversified", label: "Diversified", detail: "No position above 10%" },
  { value: "focused", label: "Focused", detail: "Up to 20% in a best idea" },
  { value: "conviction", label: "High conviction", detail: "Up to 35% in one position" },
];

const LIQUIDITY_OPTIONS: Option<PolicyAnswers["liquidity"]>[] = [
  { value: "locked", label: "Locked away", detail: "I won't need it before the horizon" },
  { value: "buffer", label: "A buffer", detail: "~10% reachable within days" },
  { value: "quarter", label: "A quarter", detail: "25% must stay sellable" },
  { value: "half", label: "Half or more", detail: "50% must stay sellable" },
];

const INCOME_OPTIONS: Option<PolicyAnswers["income"]>[] = [
  { value: "no", label: "No", detail: "Total return; yield is irrelevant" },
  { value: "some", label: "Nice to have", detail: "~1.5%/yr, growth still first" },
  { value: "steady", label: "Steady", detail: "~3%/yr, reinvested until needed" },
  { value: "living", label: "Living on it", detail: "4.5%+/yr, drawn and spent" },
];

const INFLATION_OPTIONS: Option<PolicyAnswers["inflation"]>[] = [
  { value: "no", label: "Not a priority", detail: "Reported as a fact, not scored" },
  { value: "aware", label: "Aware", detail: "Flag heavy exposure to a surprise" },
  { value: "hedged", label: "Want a hedge", detail: "Real assets should cushion it" },
];

const EXPOSURE_OPTIONS: Option<PolicyAnswers["exposure"]>[] = [
  { value: "home", label: "Home market is fine", detail: "Deliberate — reported, not scored" },
  { value: "tilted", label: "Some spread", detail: "≤85% in one region" },
  { value: "global", label: "Global", detail: "≤72% in one region, real FX mix" },
];

const PRIORITY_LABEL: Record<PriorityLevel, string> = { 0: "Off", 1: "Low", 2: "Medium", 3: "High" };

const THEME_LABEL: Record<AlignmentThemeId, string> = {
  structure: "Structure",
  resilience: "Downside",
  concentration: "Concentration",
  liquidity: "Liquidity",
  income: "Income",
  inflation: "Inflation",
  exposure: "Geography & currency",
};

function ChipGroup<V extends string>({
  legend,
  help,
  options,
  active,
  onChange,
}: {
  legend: string;
  help?: string;
  options: Option<V>[];
  active: V;
  onChange: (v: V) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-semibold text-foreground">{legend}</legend>
      {help && <p className="text-[11px] leading-snug text-muted">{help}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const isActive = o.value === active;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={isActive}
              className={`flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                isActive
                  ? "border-brand bg-brand/10"
                  : "border-border hover:border-brand/40"
              }`}
            >
              <span className={`text-xs ${isActive ? "font-semibold text-foreground" : "text-muted"}`}>{o.label}</span>
              {o.detail && <span className="text-[10px] text-muted">{o.detail}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix = "%",
  fact,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  /** The book's measured value for this limit ("largest position today: 25.4%") — a fact to set the preference against. */
  fact?: string | null;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted">
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {fact && <span className="font-mono text-[10px] tabular-nums text-muted">{fact}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        />
        <span className="text-muted">{suffix}</span>
      </span>
    </label>
  );
}

/** Status tone for a theme chip in the advanced list — same semantics as the panel. */
const THEME_STATUS_TONE: Record<string, string> = {
  aligned: "text-positive",
  tension: "text-warning",
  mismatch: "text-negative",
};

export function PolicyEditor({
  open,
  onClose,
  policy,
  facts,
  onSaved,
  portfolioId = 1,
}: {
  open: boolean;
  onClose: () => void;
  /** The current policy (assumed defaults when unset). */
  policy: InvestorPolicy;
  /**
   * The measured book, for the live "score with this policy" preview and the
   * facts printed beside each limit. Optional — without it the editor still
   * works, it just describes instead of measuring.
   */
  facts?: PolicyEditorFacts | null;
  onSaved: (policy: InvestorPolicy) => void;
  portfolioId?: number;
}) {
  const [draft, setDraft] = useState<InvestorPolicy>(policy);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-arm from the saved policy each time the dialog opens — an abandoned
  // draft must not survive into the next session's edit. Adjusted during
  // render (the "you might not need an effect" pattern) rather than in an
  // effect, so there is no post-commit cascade.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(policy);
      setError(null);
    }
  }

  const answers = useMemo(() => answersFromPolicy(draft), [draft]);
  const shares = useMemo(() => priorityShares(draft), [draft]);
  const anyPriority = ALIGNMENT_THEMES.some((t) => draft.priorities[t] > 0);

  // The live previews: the SAME pure engine the report runs, on the SAME facts
  // the page already fetched — so "66 → 74" here is exactly what the panel
  // will read after saving, not an estimate of it. Memoized per edit; the
  // engine is a few milliseconds of arithmetic on a normal book.
  const currentReport: AlignmentReport | null = useMemo(
    () => (open && facts ? computeAlignment(facts.holdings, facts.totalValue, facts.allocation, facts.risk, policy) : null),
    [open, facts, policy],
  );
  const draftReport: AlignmentReport | null = useMemo(
    () => (open && facts ? computeAlignment(facts.holdings, facts.totalValue, facts.allocation, facts.risk, draft) : null),
    [open, facts, draft],
  );
  const draftThemeById = useMemo(
    () => new Map((draftReport?.themes ?? []).map((t) => [t.id, t])),
    [draftReport],
  );

  // Measured values beside each limit — restatements of the report's own
  // numbers (never recomputed): the fact the preference is being set against.
  const limitFacts = useMemo(() => {
    if (!facts) return null;
    const cashPct = facts.allocation.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0;
    const annualIncome = facts.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
    const yieldPct = facts.totalValue > 0 ? (annualIncome / facts.totalValue) * 100 : 0;
    const stressFact = draftThemeById.get("resilience")?.facts.find((f) => f.label === "Stress estimate")?.value ?? null;
    return {
      maxPosition: `largest position today: ${facts.risk.topHoldingWeight.toFixed(1)}%`,
      drawdown: stressFact ? `plausible worst loss today: ${stressFact}` : null,
      liquidity: `sellable within days today: ${(100 - facts.risk.illiquidPct).toFixed(0)}%`,
      cash: `cash today: ${cashPct.toFixed(1)}%`,
      income: `yield today: ${yieldPct.toFixed(2)}%`,
    };
  }, [facts, draftThemeById]);

  /**
   * A simple-mode answer re-derives the wizard-owned fields from the full
   * answer set — while CARRYING the advanced-mode state (named exceptions,
   * confirmed statements, an explicit band override). A chip click must never
   * silently erase an exception the investor wrote down.
   */
  const answer = <K extends keyof PolicyAnswers>(key: K, value: PolicyAnswers[K]) => {
    setDraft((d) => {
      const derived = derivePolicy({ ...answersFromPolicy(d), [key]: value });
      return {
        ...derived,
        tolerances: { ...derived.tolerances, growthBandPct: d.tolerances.growthBandPct },
        exceptions: d.exceptions,
        statements: d.statements,
      };
    });
  };

  const setPriority = (theme: AlignmentThemeId, level: PriorityLevel) => {
    setDraft((d) => ({ ...d, priorities: { ...d.priorities, [theme]: level } }));
  };

  const setTolerance = (patch: Partial<InvestorPolicy["tolerances"]>) => {
    setDraft((d) => ({ ...d, tolerances: { ...d.tolerances, ...patch } }));
  };

  /* ── Intentional exceptions (advanced) ─────────────────────────────────── */
  const [exceptionSymbol, setExceptionSymbol] = useState("");
  const [exceptionCap, setExceptionCap] = useState(30);
  const [exceptionNote, setExceptionNote] = useState("");
  const heldSymbols = useMemo(
    () => [...new Set((facts?.holdings ?? []).map((h) => h.symbol).filter((s): s is string => !!s))].sort(),
    [facts],
  );
  const addException = () => {
    const symbol = exceptionSymbol.trim().toUpperCase();
    if (!symbol) return;
    setDraft((d) => ({
      ...d,
      exceptions: [
        ...d.exceptions.filter((e) => e.symbol !== symbol),
        { symbol, maxPositionPct: Math.min(100, Math.max(2, Math.round(exceptionCap))), note: exceptionNote.trim() || null },
      ],
    }));
    setExceptionSymbol("");
    setExceptionNote("");
  };
  const removeException = (symbol: string) => {
    setDraft((d) => ({ ...d, exceptions: d.exceptions.filter((e) => e.symbol !== symbol) }));
  };

  /* ── In your own words → reviewed interpretation ───────────────────────── */
  const [freeText, setFreeText] = useState("");
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    patch: PolicyPatch;
    effects: string[];
    summary: string;
    unmappable: string[];
  } | null>(null);

  const interpret = async () => {
    setInterpreting(true);
    setInterpretError(null);
    setProposal(null);
    try {
      const res = await fetch("/api/portfolio/policy/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: freeText, portfolioId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Interpretation failed (${res.status})`);
      setProposal(body);
    } catch (err) {
      setInterpretError(err instanceof Error ? err.message : "Interpretation failed");
    } finally {
      setInterpreting(false);
    }
  };

  /** The explicit approval step: merge the reviewed patch into the DRAFT (saving is still a separate act). */
  const applyProposal = () => {
    if (!proposal) return;
    setDraft((d) => ({
      ...applyPolicyPatch(d, proposal.patch),
      statements: [
        ...d.statements,
        { text: freeText.trim().slice(0, 500), summary: proposal.effects.join("; ").slice(0, 300) || proposal.summary, appliedAt: new Date().toISOString() },
      ].slice(-20),
    }));
    setProposal(null);
    setFreeText("");
  };
  const removeStatement = (idx: number) => {
    setDraft((d) => ({ ...d, statements: d.statements.filter((_, i) => i !== idx) }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/policy?portfolioId=${portfolioId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: draft }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`);
      onSaved(body.policy as InvestorPolicy);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Your investment policy"
      description="What this portfolio is for, in your words. The alignment score measures the book against these — nothing else."
      className="max-w-2xl"
    >
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
        <ChipGroup legend="What are you primarily optimizing for?" options={GOAL_OPTIONS} active={answers.goal} onChange={(v) => answer("goal", v)} />
        <ChipGroup legend="How long until you expect to need this money?" options={HORIZON_OPTIONS} active={answers.horizon} onChange={(v) => answer("horizon", v)} />
        <ChipGroup
          legend="The deepest loss you could sit through without selling"
          help="Sets the downside tolerance the book is stress-tested against."
          options={DRAWDOWN_OPTIONS}
          active={answers.drawdown}
          onChange={(v) => answer("drawdown", v)}
        />
        <ChipGroup
          legend="The biggest single position you would deliberately run"
          help="Deliberate concentration inside this cap is your call and scores as aligned. Correlated names that move as one trade are counted as one bet."
          options={CONCENTRATION_OPTIONS}
          active={answers.concentration}
          onChange={(v) => answer("concentration", v)}
        />
        <ChipGroup
          legend="How much might you need to reach on short notice?"
          options={LIQUIDITY_OPTIONS}
          active={answers.liquidity}
          onChange={(v) => answer("liquidity", v)}
        />
        <ChipGroup
          legend="Does the book need to pay you cash while you hold it?"
          help="If not, a low yield never counts against you."
          options={INCOME_OPTIONS}
          active={answers.income}
          onChange={(v) => answer("income", v)}
        />
        <ChipGroup
          legend="Do you want explicit inflation protection?"
          options={INFLATION_OPTIONS}
          active={answers.inflation}
          onChange={(v) => answer("inflation", v)}
        />
        <ChipGroup
          legend="Where should the risk be domiciled?"
          help="Home-market concentration is a legitimate choice — it only scores if you opt in."
          options={EXPOSURE_OPTIONS}
          active={answers.exposure}
          onChange={(v) => answer("exposure", v)}
        />

        {/* ── What this means, live ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              How your score will be weighted
            </span>
            {/* Measured, not estimated: the same engine, the same facts, so this
                arrow is exactly what the panel will read after saving. */}
            {currentReport && draftReport && (
              <span className="font-mono text-[11px] tabular-nums text-foreground">
                Score with this policy:{" "}
                <span className="text-muted">{currentReport.score ?? "—"}</span>
                {" → "}
                <span className="font-semibold">{draftReport.score ?? "—"}</span>
                {draftReport.label && <span className="ml-1 text-[10px] font-normal text-muted">({draftReport.label})</span>}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {ALIGNMENT_THEMES.map((t) =>
              draft.priorities[t] > 0 ? (
                <span key={t} className="font-mono tabular-nums text-foreground">
                  {THEME_LABEL[t]} {(shares[t] * 100).toFixed(0)}%
                </span>
              ) : (
                <span key={t} className="text-muted">{THEME_LABEL[t]} — fact only</span>
              ),
            )}
          </div>
        </div>

        {/* ── Advanced ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
            className="self-start rounded-sm text-[11px] font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {advanced ? "Hide advanced ▲" : "Advanced: adjust weights and limits directly ▼"}
          </button>
          {advanced && (
            <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-surface/30 p-3">
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Theme priorities — Off means &quot;show the fact, don&apos;t score it&quot;
                </span>
                {ALIGNMENT_THEMES.map((t) => {
                  const liveTheme = draftThemeById.get(t);
                  return (
                    <div key={t} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-2 text-[11px] text-muted">
                        <span>{THEME_LABEL[t]}</span>
                        {/* What this theme reads on YOUR book under the draft —
                            the setting and its consequence on one line. */}
                        {liveTheme && (
                          <span className="font-mono text-[10px] tabular-nums">
                            {liveTheme.score != null ? (
                              <>
                                <span className={THEME_STATUS_TONE[liveTheme.status ?? ""] ?? "text-muted"}>
                                  {liveTheme.score}
                                </span>
                                <span className="text-muted"> · {(shares[t] * 100).toFixed(0)}% of score</span>
                              </>
                            ) : (
                              <span className="text-muted">
                                {liveTheme.unratedReason === "opted_out" ? "fact only" : "insufficient data"}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={`${THEME_LABEL[t]} priority`}>
                        {([0, 1, 2, 3] as PriorityLevel[]).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            role="radio"
                            aria-checked={draft.priorities[t] === lvl}
                            onClick={() => setPriority(t, lvl)}
                            className={`rounded-md border px-2 py-0.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                              draft.priorities[t] === lvl
                                ? "border-brand bg-brand/10 font-semibold text-foreground"
                                : "border-border text-muted hover:border-brand/40"
                            }`}
                          >
                            {PRIORITY_LABEL[lvl]}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Hard limits &amp; ranges{limitFacts ? " — the book's measured value is shown under each" : ""}
                </span>
                <NumberField label="Max single position" fact={limitFacts?.maxPosition} value={draft.tolerances.maxPositionPct} min={2} max={100} onChange={(v) => setTolerance({ maxPositionPct: v })} />
                <NumberField label="Max drawdown you can sit through" fact={limitFacts?.drawdown} value={draft.tolerances.maxDrawdownPct} min={5} max={95} onChange={(v) => setTolerance({ maxDrawdownPct: v })} />
                <NumberField label="Must stay sellable within days" fact={limitFacts?.liquidity} value={draft.tolerances.liquidityFloorPct} min={0} max={100} onChange={(v) => setTolerance({ liquidityFloorPct: v })} />
                <NumberField label="Cash band, low end" fact={limitFacts?.cash} value={draft.tolerances.cashRangePct[0]} min={0} max={draft.tolerances.cashRangePct[1]} onChange={(v) => setTolerance({ cashRangePct: [v, draft.tolerances.cashRangePct[1]] })} />
                <NumberField label="Cash band, high end" value={draft.tolerances.cashRangePct[1]} min={draft.tolerances.cashRangePct[0]} max={100} onChange={(v) => setTolerance({ cashRangePct: [draft.tolerances.cashRangePct[0], v] })} />
                {draft.priorities.income > 0 && (
                  <NumberField label="Required income yield" fact={limitFacts?.income} value={draft.tolerances.incomeYieldPct} min={0} max={15} suffix="%/yr" onChange={(v) => setTolerance({ incomeYieldPct: v })} />
                )}
              </div>

              {/* ── Growth band as a RANGE — override or derive ── */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Growth-engine band — a range, because targets usually are
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setTolerance({ growthBandPct: draft.tolerances.growthBandPct ? null : growthBandFor(draft) })
                    }
                    className="rounded-sm text-[10px] font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    {draft.tolerances.growthBandPct ? "Use goal-derived band" : "Set my own range"}
                  </button>
                </div>
                {draft.tolerances.growthBandPct ? (
                  <>
                    <NumberField label="Band floor (growth-engine share)" value={draft.tolerances.growthBandPct[0]} min={0} max={Math.max(0, draft.tolerances.growthBandPct[1] - 5)} onChange={(v) => setTolerance({ growthBandPct: [v, draft.tolerances.growthBandPct![1]] })} />
                    <NumberField label="Band ceiling" value={draft.tolerances.growthBandPct[1]} min={Math.min(100, draft.tolerances.growthBandPct[0] + 5)} max={100} onChange={(v) => setTolerance({ growthBandPct: [draft.tolerances.growthBandPct![0], v] })} />
                  </>
                ) : (
                  <p className="text-[11px] text-muted">
                    Derived from your goal and horizon: {growthBandFor(draft)[0].toFixed(0)}–{growthBandFor(draft)[1].toFixed(0)}% growth engine.
                  </p>
                )}
              </div>

              {/* ── Intentional exceptions — deliberate is not accidental ── */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Intentional exceptions — a position you deliberately allow above the general cap
                </span>
                {draft.exceptions.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {draft.exceptions.map((e) => (
                      <li key={e.symbol} className="flex items-center justify-between gap-2 rounded-md bg-surface/40 px-2.5 py-1.5 text-[11px]">
                        <span className="min-w-0 text-foreground">
                          <span className="font-mono font-semibold">{e.symbol}</span> up to{" "}
                          <span className="font-mono tabular-nums">{e.maxPositionPct}%</span>
                          {e.note && <span className="text-muted"> — “{e.note}”</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeException(e.symbol)}
                          className="shrink-0 rounded-sm text-[10px] text-muted hover:text-negative hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    list="policy-exception-symbols"
                    value={exceptionSymbol}
                    onChange={(e) => setExceptionSymbol(e.target.value)}
                    placeholder="Symbol"
                    aria-label="Exception symbol"
                    className="w-24 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs uppercase text-foreground placeholder:normal-case placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  />
                  <datalist id="policy-exception-symbols">
                    {heldSymbols.map((s) => <option key={s} value={s} />)}
                  </datalist>
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    up to
                    <input
                      type="number"
                      value={exceptionCap}
                      min={2}
                      max={100}
                      onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setExceptionCap(n); }}
                      aria-label="Exception cap percent"
                      className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    />
                    %
                  </span>
                  <input
                    value={exceptionNote}
                    onChange={(e) => setExceptionNote(e.target.value)}
                    placeholder="Why (optional — shown wherever it applies)"
                    aria-label="Exception reason"
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  />
                  <Button variant="ghost" onClick={addException} disabled={!exceptionSymbol.trim()}>
                    Add
                  </Button>
                </div>
                <p className="text-[10px] leading-snug text-muted">
                  The general cap keeps binding everything else. Correlated clusters are still measured — blessing one
                  position&apos;s size is not the same as accepting four names that move as one trade.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── In your own words — interpreted, reviewed, then applied ───────── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-surface/30 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            None of these fit? Describe what you actually want
          </span>
          {draft.statements.length > 0 && (
            <ul className="flex flex-col gap-1">
              {draft.statements.map((s, i) => (
                <li key={`${s.appliedAt}-${i}`} className="flex items-start justify-between gap-2 rounded-md bg-surface/40 px-2.5 py-1.5 text-[11px]">
                  <span className="min-w-0">
                    <span className="text-foreground">“{s.text}”</span>
                    <span className="block text-muted">Applied as: {s.summary}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStatement(i)}
                    className="shrink-0 rounded-sm text-[10px] text-muted hover:text-negative hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-start gap-1.5">
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder='e.g. "I run a high-conviction book — QQQM is deliberate up to 30%. I can stomach a 40% drawdown but I want a year of spending sellable at all times."'
              className="min-w-0 flex-1 resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            <Button variant="ghost" onClick={interpret} disabled={interpreting || freeText.trim().length < 8}>
              {interpreting ? "Interpreting…" : "Interpret"}
            </Button>
          </div>
          {interpretError && <p className="text-[11px] text-negative">{interpretError}</p>}
          {proposal && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-brand/30 bg-brand/[0.05] p-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-brand">
                Here is the policy UAA believes you are describing — do you agree?
              </span>
              {proposal.effects.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {proposal.effects.map((e, i) => (
                    <li key={i} className="text-[11px] text-foreground">— {e}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted">No measurable settings were found in that text.</p>
              )}
              {proposal.unmappable.length > 0 && (
                <p className="text-[10px] leading-snug text-warning">
                  Could not be turned into a measurable rule (kept out rather than guessed):{" "}
                  {proposal.unmappable.join(" · ")}
                </p>
              )}
              <div className="flex items-center gap-2 pt-0.5">
                <Button variant="primary" onClick={applyProposal} disabled={proposal.effects.length === 0}>
                  Apply to draft
                </Button>
                <Button variant="ghost" onClick={() => setProposal(null)}>
                  Discard
                </Button>
                <span className="text-[10px] text-muted">Nothing is saved until you save the policy below.</span>
              </div>
            </div>
          )}
          <p className="text-[10px] leading-snug text-muted">
            Your words never change the score directly. They are interpreted into the explicit settings above, you
            approve them, and the deterministic engine reads only the settings.
          </p>
        </div>

        {/* ── Policy coherence — measured against itself ── */}
        {detectPolicyConflicts(draft).map((c, i) => (
          <p key={i} className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-[11px] leading-relaxed text-warning">
            {c}
          </p>
        ))}

        {error && <p className="text-xs text-negative">{error}</p>}
        {!anyPriority && (
          <p className="text-xs text-warning">
            Every theme is off — there is nothing to score against. Turn at least one priority on.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/40 pt-3">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={saving || !anyPriority}>
          {saving ? "Saving…" : "Save policy"}
        </Button>
      </div>
    </Dialog>
  );
}
