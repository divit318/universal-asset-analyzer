"use client";

import { useState } from "react";
import { Card, Button, DateInput, Input, Field } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { OBJECTIVES, type Objective, type ObjectiveConfig } from "@/lib/portfolio/engines/optimize";
import {
  PREFERENCE_QUESTIONS,
  type PreferenceTopic,
  type SimPreferences,
} from "@/lib/portfolio/simulator/preferences";
import { ChoiceQuestion } from "./choice-question";
import {
  drawdownForRiskAppetite,
  type SimHorizon,
  type SimProfile,
  type SimRole,
  type Simulation,
} from "@/lib/portfolio/simulator/types";

/** Raw form values; the server (parseSimProfile) is the validator of record. */
export interface IntakeFormValues {
  cash: number;
  currency: string;
  horizon: SimHorizon;
  targetDate: string | null;
  objective: Objective;
  riskAppetite: number;
  maxDrawdownPct: number;
  role: SimRole;
  complementRef: SimProfile["complementRef"];
  preferences: SimPreferences;
}

const HORIZON_OPTIONS: { id: SimHorizon; label: string; sub: string }[] = [
  { id: "short", label: "Short", sub: "< 2 years" },
  { id: "medium", label: "Medium", sub: "2–7 years" },
  { id: "long", label: "Long", sub: "7+ years" },
];

/**
 * Concrete anchors for the risk slider.
 *
 * The scale stays a slider because risk tolerance genuinely is a spectrum, but
 * "7/10" is not a thing anyone has an opinion about — a described drawdown is.
 * Each band names the loss the user is being asked to accept, in the terms they
 * would actually experience it.
 */
const RISK_ANCHORS: { max: number; text: string }[] = [
  { max: 2, text: "A 10% fall would make me want out. Cash-like stability." },
  { max: 4, text: "I can sit through a normal correction, but not a bear market." },
  { max: 6, text: "A 25% drawdown is the price of long-term growth — I'd hold." },
  { max: 8, text: "I'd keep buying through a 40% bear market." },
  { max: 10, text: "I accept losing half in a crash for the highest long-run return." },
];

function riskAnchor(risk: number): string {
  return RISK_ANCHORS.find((a) => risk <= a.max)?.text ?? RISK_ANCHORS[2].text;
}

/**
 * A large number, spelled out.
 *
 * `100000000` and `10000000` are one keystroke and one order of magnitude apart,
 * and neither is readable at a glance in a bare number input — a user who typed an
 * extra zero could only find out by waiting out a multi-minute generation priced
 * against ten times their money. Naming the magnitude makes the mistake visible
 * while the field still has focus. (Cancelling a bad run is the safety net; this is
 * the fix.)
 */
function magnitudeOf(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e12) return `${(n / 1e12).toFixed(n % 1e12 === 0 ? 0 : 2)} trillion`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2)} million`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)} thousand`;
  return null;
}

/** One selectable option chip — the same visual as the Optimize tab's objective
 * chips, so every mutually-exclusive choice in the form reads identically. */
function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-brand bg-brand/10 font-semibold text-foreground"
          : "border-border text-muted hover:border-brand/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Intake — the fixed form, always asked up front, in two steps.
 *
 * ## Why it grew from five questions to thirteen
 *
 * It used to ask five things and leave the rest to an AI interview that "asks only
 * the follow-ups it actually needs". In practice that interview asked ONE
 * open-ended question about asset allocation, the user skipped it, and the
 * portfolio was designed on a guessed default — having spent 25-195 seconds of
 * local inference to reach that outcome.
 *
 * Almost every topic that interview was told to probe (liquidity, income, tax,
 * exclusions, geography, concentration, rebalancing, instrument breadth) is
 * something every investor can answer up front from a list. Asking them here is
 * faster, cheaper, and produces a better portfolio than discovering them one
 * expensive open question at a time. The interview keeps only what a form
 * genuinely cannot ask: contradictions BETWEEN answers, which do not exist until
 * the answers do.
 *
 * ## Why two steps and not one, or thirteen
 *
 * The first five answers determine what the portfolio IS; the next eight constrain
 * how it is built. Splitting there means the "create" decision is not gated behind
 * eight preference questions, while all eight are still part of the form rather
 * than a "maybe the AI will ask" stage. Step 2 is one scroll rather than a
 * one-question-per-screen wizard: eight screens of a single question each reads as
 * an interrogation, and seeing the whole set makes it obvious how much is left.
 */
export function IntakeForm({
  initialName = "",
  initialProfile = null,
  simulations,
  excludeId = null,
  realPortfolioHasHoldings,
  saving,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName?: string;
  initialProfile?: SimProfile | null;
  /** Saved simulations offered as "complement" targets. */
  simulations: Simulation[];
  /** When editing, the simulation's own id — it cannot complement itself. */
  excludeId?: string | null;
  realPortfolioHasHoldings: boolean;
  saving: boolean;
  submitLabel: string;
  onSubmit: (name: string, values: IntakeFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [cash, setCash] = useState(initialProfile ? String(initialProfile.cash) : "");
  const [currency, setCurrency] = useState(initialProfile?.currency ?? "USD");
  const [horizon, setHorizon] = useState<SimHorizon>(initialProfile?.horizon ?? "long");
  const [targetDate, setTargetDate] = useState(initialProfile?.targetDate ?? "");
  const [objective, setObjective] = useState<Objective>(initialProfile?.objective ?? "balanced");
  const [riskAppetite, setRiskAppetite] = useState(initialProfile?.riskAppetite ?? 5);
  const [role, setRole] = useState<SimRole>(initialProfile?.role ?? "standalone");
  const [complementRef, setComplementRef] = useState<SimProfile["complementRef"]>(
    initialProfile?.complementRef ?? null,
  );
  const [preferences, setPreferences] = useState<SimPreferences>(initialProfile?.preferences ?? {});
  const [step, setStep] = useState<1 | 2>(1);

  const cashNum = Number(cash);
  const magnitude = magnitudeOf(cashNum);
  const answeredCount = PREFERENCE_QUESTIONS.filter((q) => {
    const a = preferences[q.topic];
    return !!a && (a.optionIds.length > 0 || !!a.other?.trim());
  }).length;
  const complementOptions = simulations.filter((s) => s.id !== excludeId);
  const complementValid =
    role === "standalone" ||
    (complementRef !== null &&
      (complementRef.kind === "real" || complementOptions.some((s) => s.id === complementRef.id)));
  const canSubmit =
    name.trim().length > 0 && Number.isFinite(cashNum) && cashNum > 0 && complementValid && !saving;

  const objectiveEntries = (Object.entries(OBJECTIVES) as [Objective, ObjectiveConfig][]).filter(
    // target_allocation is the Optimize tab's "custom target" mode; it is
    // meaningless as a mandate without a target spec, so it isn't offered here.
    ([id]) => id !== "target_allocation",
  );

  const submit = () =>
    onSubmit(name.trim(), {
      cash: cashNum,
      currency: currency.trim().toUpperCase() || "USD",
      horizon,
      targetDate: targetDate || null,
      objective,
      riskAppetite,
      maxDrawdownPct: drawdownForRiskAppetite(riskAppetite),
      role,
      complementRef,
      preferences,
    });

  /* ── Step 2: constraints and preferences ─────────────────────────────────── */
  if (step === 2) {
    return (
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">Constraints and preferences</h3>
          <p className="text-[11px] leading-relaxed text-muted">
            Eight questions that decide which instruments the portfolio can use. Every one is
            optional — the stated assumption is used for anything you leave blank — but each answer
            replaces a guess, and picking from the list is the whole point: nothing here needs
            writing out.
          </p>
          <p className="text-[11px] text-muted/60">
            {answeredCount} of {PREFERENCE_QUESTIONS.length} answered
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {PREFERENCE_QUESTIONS.map((q) => {
            const a = preferences[q.topic];
            return (
              <ChoiceQuestion
                key={q.topic}
                question={q.question}
                help={q.help}
                options={q.options.map((o) => ({ id: o.id, label: o.label }))}
                multi={q.multi}
                exclusiveId={q.exclusiveId}
                allowOther={q.allowOther}
                selectedIds={a?.optionIds ?? []}
                other={a?.other ?? null}
                defaultLabel={q.defaultLabel}
                disabled={saving}
                onChange={(next) =>
                  setPreferences((prev) => ({
                    ...prev,
                    [q.topic as PreferenceTopic]:
                      next.selectedIds.length === 0 && !next.other
                        ? null
                        : { optionIds: next.selectedIds, other: next.other },
                  }))
                }
              />
            );
          })}
        </div>

        <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-4">
          <Button variant="ghost" size="md" onClick={() => setStep(1)} disabled={saving}>
            ← Back to the mandate
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="md" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" size="md" disabled={!canSubmit} onClick={submit}>
              {saving ? "Saving…" : submitLabel}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  /* ── Step 1: the mandate ─────────────────────────────────────────────────── */
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">Describe the mandate</h3>
        <p className="text-[11px] leading-relaxed text-muted">
          What this portfolio is for. The next step asks eight multiple-choice questions about
          constraints — liquidity, income, tax, exclusions and the rest — so the AI does not have
          to guess at any of them.
        </p>
      </div>

      <Field label="Simulation name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Retirement 2045, Aggressive growth sleeve"
          maxLength={80}
          autoFocus
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Investable cash">
          <Input
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="100000"
          />
          {/* Read back in words. An extra zero is invisible in a number input and
              expensive to discover after a multi-minute generation. */}
          {magnitude && (
            <span className="mt-1 block text-[11px] text-muted/70">
              {formatCurrency(cashNum, currency.trim().toUpperCase() || "USD")} ·{" "}
              <strong className="font-medium text-foreground">{magnitude}</strong>
            </span>
          )}
        </Field>
        <Field label="Currency" hint="3-letter code">
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="USD"
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Time horizon</span>
        <div className="flex flex-wrap gap-1.5">
          {HORIZON_OPTIONS.map((h) => (
            <Chip key={h.id} active={h.id === horizon} onClick={() => setHorizon(h.id)}>
              {h.label}
              <span className="text-[10px] text-muted/70">{h.sub}</span>
            </Chip>
          ))}
        </div>
        <Field label="Exact target date (optional)">
          <DateInput
            value={targetDate}
            onChange={setTargetDate}
            className="sm:max-w-[220px]"
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Primary objective</span>
        <div className="flex flex-wrap gap-1.5">
          {objectiveEntries.map(([id, cfg]) => (
            <Chip key={id} active={id === objective} onClick={() => setObjective(id)} title={cfg.description}>
              <span aria-hidden>{cfg.icon}</span>
              {cfg.label}
            </Chip>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-muted/70">{OBJECTIVES[objective].description}</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Risk appetite</span>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={riskAppetite}
            onChange={(e) => setRiskAppetite(Number(e.target.value))}
            className="w-full max-w-xs accent-brand"
            aria-label="Risk appetite from 1 (conservative) to 10 (aggressive)"
          />
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {riskAppetite}/10
          </span>
        </div>
        {/* The described position, not just the number. "7/10" is not something
            anyone holds an opinion about; "I'd keep buying through a 40% bear
            market" is, and it is the same claim stated so it can be disagreed
            with. */}
        <p className="rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-[11px] leading-relaxed text-foreground">
          “{riskAnchor(riskAppetite)}”
        </p>
        <p className="text-[11px] leading-relaxed text-muted/70">
          Implies tolerating a drawdown of up to{" "}
          <strong className="text-foreground">{drawdownForRiskAppetite(riskAppetite)}%</strong> in a
          bad market. If this contradicts your objective, you&apos;ll be asked which takes priority.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Standalone or complement?</span>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "standalone", label: "Standalone portfolio" },
              { id: "complement", label: "Complements an existing one" },
            ] as { id: SimRole; label: string }[]
          ).map((r) => (
            <Chip
              key={r.id}
              active={r.id === role}
              onClick={() => {
                setRole(r.id);
                if (r.id === "standalone") setComplementRef(null);
              }}
            >
              {r.label}
            </Chip>
          ))}
        </div>
        {role === "complement" && (
          <div className="flex flex-wrap gap-1.5">
            {realPortfolioHasHoldings && (
              <Chip
                active={complementRef?.kind === "real"}
                onClick={() => setComplementRef({ kind: "real", id: "real" })}
              >
                Your real portfolio
              </Chip>
            )}
            {complementOptions.map((s) => (
              <Chip
                key={s.id}
                active={complementRef?.kind === "simulation" && complementRef.id === s.id}
                onClick={() => setComplementRef({ kind: "simulation", id: s.id })}
              >
                {s.name}
                {s.headline && (
                  <span className="text-[10px] text-muted/70">
                    {formatCurrency(s.headline.totalValue)}
                  </span>
                )}
              </Chip>
            ))}
            {!realPortfolioHasHoldings && complementOptions.length === 0 && (
              <p className="text-[11px] text-muted">
                Nothing to complement yet — your real portfolio is empty and there are no other
                saved simulations. Choose standalone instead.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
        <Button variant="ghost" size="md" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {/* Skipping straight to submit stays available. Step 2 is entirely
            optional by design — every question there has a stated default — and
            gating creation behind it would trade one kind of friction for another. */}
        <Button variant="ghost" size="md" disabled={!canSubmit} onClick={submit}>
          {saving ? "Saving…" : "Use defaults for the rest"}
        </Button>
        <Button variant="primary" size="md" disabled={!canSubmit} onClick={() => setStep(2)}>
          Constraints and preferences →
        </Button>
      </div>
    </Card>
  );
}
