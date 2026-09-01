"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/app/_components/ui";
import { askAi } from "@/app/_components/ask-ai";
import { describePolicy, GOAL_LABEL, HORIZON_LABEL, type InvestorPolicy } from "@/lib/portfolio/alignment/policy";
import type { AlignmentReport, AlignmentTheme } from "@/lib/portfolio/alignment/engine";
import { alignmentToneOf } from "@/lib/portfolio/alignment/tone";
import type { Tab } from "./dashboard-nav";

/**
 * Portfolio Alignment — the panel that replaced Portfolio Health.
 *
 * The health panel triaged twelve universally-weighted dimensions. This panel
 * renders a different claim entirely: how far the book sits from what ITS OWNER
 * said they want. Three consequences for the UI:
 *
 *  1. THE PRIORITIES ARE PART OF THE NUMBER. The score is meaningless without
 *     "weighted by what you said matters", so the stated priorities render
 *     directly under the score, each with the share it actually carried — and
 *     an unconfirmed policy shows a set-your-priorities banner instead of
 *     passing defaults off as the user's own words.
 *
 *  2. MISMATCHES LEAD, IN REAL UNITS. "Concentration 54" invites guessing;
 *     "NVDA is 26.2% against your 15% cap (+11.2pp)" states the disagreement in
 *     the investor's own units and makes the follow-up actions obvious. The
 *     stated / actual / excess triptych is the panel's signature.
 *
 *  3. UNRATED IS A FIRST-CLASS STATE, TWICE OVER. A theme the investor opted
 *     out of renders as a fact with no judgment attached; a theme the data
 *     cannot support says "insufficient evidence" — neither is folded into the
 *     score, and both say which they are.
 */

const STATUS_META = {
  mismatch: { label: "Mismatch", bar: "bg-negative", text: "text-negative" },
  tension: { label: "Close to your limit", bar: "bg-warning", text: "text-warning" },
  aligned: { label: "Aligned", bar: "bg-positive", text: "text-positive" },
} as const;

/** Canonical alignment severity (lib/portfolio/alignment/tone.ts) — previously
 *  a private 70/55 table here. */
function scoreTone(score: number | null): string {
  if (score == null) return "text-muted";
  const tone = alignmentToneOf(score);
  return tone === "positive" ? "text-positive" : tone === "warning" ? "text-warning" : "text-foreground";
}

/* ── Where each theme can actually be worked on ────────────────────────────
   At most TWO destinations per theme — the direct fix first, one analysis
   alternative second. Three action links plus "Ask AI" under every expanded
   theme read as a menu, and two of them were slower routes to the same
   Optimize simulation. */
const THEME_ACTIONS: Record<string, { label: string; tab: Tab }[]> = {
  structure: [{ label: "Rebalance in Optimize", tab: "optimize" }],
  resilience: [{ label: "Stress-test in Risk Lab", tab: "risk" }],
  concentration: [
    { label: "Rebalance in Optimize", tab: "optimize" },
    { label: "See clusters in Intelligence", tab: "intelligence" },
  ],
  liquidity: [
    { label: "Review illiquid holdings", tab: "holdings" },
    { label: "Allocate cash in Decisions", tab: "decisions" },
  ],
  income: [{ label: "Simulate income alternatives", tab: "simulator" }],
  inflation: [{ label: "Simulate adding real assets", tab: "simulator" }],
  exposure: [{ label: "Simulate international exposure", tab: "simulator" }],
};

/** The AI-challenge prompt: the model stress-tests the POLICY, never the score. */
function challengeQuestion(alignment: AlignmentReport, policy: InvestorPolicy): string {
  const themeLines = alignment.themes
    .map((t) => `- ${t.label}: ${t.score != null ? `${t.score}/100 (${t.status})` : t.unratedReason === "opted_out" ? "opted out" : "insufficient data"} — ${t.finding}`)
    .join("\n");
  return (
    `Challenge my portfolio policy against the measured facts below. Do NOT recompute or second-guess the scores — they are deterministic. ` +
    `Your job is to stress-test MY stated assumptions: where a tolerance I set looks inconsistent with the book I actually hold, with my goal and horizon, or with the measured downside, say so concretely and quantitatively. ` +
    `If my policy is coherent, say that too. End with the one question I most need to answer.\n\n` +
    `MY POLICY\n${describePolicy(policy)}\n\n` +
    `MEASURED ALIGNMENT (score ${alignment.score ?? "n/a"}${alignment.label ? `, ${alignment.label}` : ""})\n${themeLines}`
  );
}

function ThemeRow({
  theme,
  expandedByDefault,
  onNavigate,
}: {
  theme: AlignmentTheme;
  expandedByDefault: boolean;
  onNavigate?: (tab: Tab, anchor?: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(expandedByDefault);
  const rated = theme.score != null;
  const meta = theme.status ? STATUS_META[theme.status] : null;

  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-1 flex w-[calc(100%+8px)] items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span aria-hidden className={`shrink-0 text-[8px] text-muted/50 transition-transform ${open ? "rotate-90" : ""}`}>
            ▶
          </span>
          <span className="truncate text-xs font-medium text-foreground">{theme.label}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          {rated ? (
            <>
              {/* The share of the score this theme carried — the investor's own
                  priority, renormalized. Weights are theirs, not ours. */}
              <span
                className="font-mono text-[10px] tabular-nums text-muted"
                title={`Carried ${(theme.weightShare * 100).toFixed(0)}% of your alignment score, from your stated priority.`}
              >
                {(theme.weightShare * 100).toFixed(0)}%
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{theme.score}</span>
            </>
          ) : (
            <span className="text-[10px] text-muted">
              {theme.unratedReason === "opted_out" ? "fact only" : "insufficient data"}
            </span>
          )}
        </span>
      </button>
      {rated && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${meta?.bar ?? "bg-muted"}`} style={{ width: `${theme.score}%` }} />
        </div>
      )}
      {/* The measured finding is the actionable sentence — always visible for
          anything out of line, on demand for the rest. */}
      {(expandedByDefault || open) && <p className="text-[11px] leading-snug text-muted">{theme.finding}</p>}
      {open && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/40 p-2.5 text-[11px] leading-relaxed text-muted">
          {theme.facts.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {theme.facts.map((f) => (
                <p key={f.label}>
                  <span className="font-medium text-muted">{f.label}:</span>{" "}
                  <span className="font-mono tabular-nums text-foreground">{f.value}</span>
                  {f.holdings && f.holdings.length > 0 && (
                    <span className="text-muted"> — {f.holdings.join(", ")}</span>
                  )}
                </p>
              ))}
            </div>
          )}
          <p>
            <span className="font-medium text-muted">How it&apos;s judged:</span> {theme.basis}
          </p>
          {theme.evidencePct < 100 && (
            <p className="text-[10px] text-muted">
              The facts behind this theme cover {theme.evidencePct}% of portfolio value — disclosed, never blended
              into the score.
            </p>
          )}
          {onNavigate && rated && theme.status !== "aligned" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/40 pt-1.5">
              {(THEME_ACTIONS[theme.id] ?? []).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => onNavigate(a.tab)}
                  className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {a.label} →
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  askAi(router, {
                    source: "app",
                    question: `My portfolio's "${theme.label}" alignment theme reads ${theme.score}/100 against my own policy. The engine measured: "${theme.finding}" The ruler: "${theme.basis}" Is closing this gap worth prioritising, and what are my realistic options?`,
                  })
                }
                className="rounded-sm text-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Ask AI about this
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function AlignmentPanel({
  alignment,
  policy,
  onNavigate,
  onEditPolicy,
}: {
  alignment: AlignmentReport;
  /** Enables the priorities strip, the edit action and the AI challenge. */
  policy?: InvestorPolicy;
  /** Tab navigation for the theme actions. Omitted on view-only surfaces. */
  onNavigate?: (tab: Tab, anchor?: string) => void;
  /** Opens the policy editor. Omitted on view-only surfaces (simulator). */
  onEditPolicy?: () => void;
}) {
  const router = useRouter();
  const [showAligned, setShowAligned] = useState(false);

  const rated = alignment.themes.filter((t) => t.score != null);
  const mismatched = rated.filter((t) => t.status === "mismatch").sort((a, b) => a.score! - b.score!);
  const tension = rated.filter((t) => t.status === "tension").sort((a, b) => a.score! - b.score!);
  const aligned = rated.filter((t) => t.status === "aligned").sort((a, b) => a.score! - b.score!);
  const factOnly = alignment.themes.filter((t) => t.unratedReason === "opted_out");
  const gaps = alignment.themes.filter((t) => t.unratedReason === "insufficient_data");
  const biggest = alignment.mismatches[0] ?? null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      {/* Verdict-led: the LABEL is the judgment ("Mixed" — fit with your own
          policy), the number is its supporting metric. A 73 rendered huge
          reads as a grade against some hidden standard; "Mixed · 73/100
          supporting" reads as what it is. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Portfolio alignment</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{alignment.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className={`text-xl font-bold leading-none ${scoreTone(alignment.score)}`}>
            {alignment.label ?? "—"}
          </span>
          {alignment.score != null && (
            <span className="font-mono text-[11px] tabular-nums text-muted">{alignment.score}/100 supporting</span>
          )}
        </div>
      </div>

      {/* ── The policy contradicting itself is said out loud, never resolved
            silently in either statement's favour ── */}
      {alignment.policyConflicts.map((c, i) => (
        <p key={i} className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-[11px] leading-relaxed text-warning">
          <strong className="font-semibold">Your policy conflicts with itself: </strong>
          {c}
        </p>
      ))}

      {/* ── The policy this was scored against ─────────────────────────────── */}
      {policy && (
        <div
          className={`flex flex-col gap-2 rounded-lg border p-3 ${
            alignment.confirmed ? "border-border/60 bg-surface/30" : "border-brand/30 bg-brand/[0.05]"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {alignment.confirmed ? "Scored against your priorities" : "Scored against assumed defaults"}
            </span>
            {onEditPolicy && (
              <Button size="sm" variant={alignment.confirmed ? "ghost" : "primary"} onClick={onEditPolicy}>
                {alignment.confirmed ? "Edit priorities" : "Set your priorities"}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>
              {GOAL_LABEL[policy.goal]} · {HORIZON_LABEL[policy.horizon]}
            </span>
            {rated.map((t) => (
              <span key={t.id} className="font-mono tabular-nums text-muted">
                {t.label} {(t.weightShare * 100).toFixed(0)}%
              </span>
            ))}
          </div>
          {/* Intentional exceptions and the investor's own words are PART of
              the policy — showing them here is what "UAA understood you" looks
              like, and omitting them is how exceptions become invisible magic. */}
          {(policy.exceptions.length > 0 || policy.statements.length > 0) && (
            <div className="flex flex-col gap-0.5 text-[11px] text-muted">
              {policy.exceptions.length > 0 && (
                <span>
                  Exceptions you set:{" "}
                  {policy.exceptions.map((e) => `${e.symbol} ≤ ${e.maxPositionPct}%`).join(" · ")}
                </span>
              )}
              {policy.statements.map((s, i) => (
                <span key={i}>In your words: “{s.text}” → {s.summary}</span>
              ))}
            </div>
          )}
          {!alignment.confirmed && (
            <p className="text-[11px] leading-snug text-muted">
              UAA doesn&apos;t know what a perfect portfolio looks like — only you do. These are conservative
              assumptions; the score means more once the limits are yours.
            </p>
          )}
        </div>
      )}

      {/* ── Where the points went — every deduction traced to YOUR setting ── */}
      {alignment.score != null && alignment.score < 100 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Where the points went — 100 − {(100 - alignment.score)} = {alignment.score}
          </span>
          {/* Arithmetic only. The finding sentences are deliberately NOT
              repeated here — the summary states the worst one and each theme
              row below carries its own; this box exists so the score's math
              can be checked, not to diagnose a third time. */}
          <ul className="flex flex-col gap-1">
            {rated
              .map((t) => ({ t, lost: (100 - (t.scoreExact ?? 100)) * t.weightShare }))
              .filter(({ lost }) => lost >= 0.5)
              .sort((a, b) => b.lost - a.lost)
              .map(({ t, lost }) => (
                <li key={t.id} className="flex items-baseline justify-between gap-3 text-[11px] leading-snug">
                  <span className="min-w-0 text-muted">
                    <span className="font-semibold text-foreground">{t.label}</span>
                    <span className="font-mono tabular-nums"> {t.score}/100</span> at{" "}
                    <span className="font-mono tabular-nums">{(t.weightShare * 100).toFixed(0)}%</span> weight
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-negative">−{lost.toFixed(1)} pts</span>
                </li>
              ))}
          </ul>
          <p
            className="text-[10px] leading-snug text-muted"
            title="Change a setting and the deduction changes with it — nothing here comes from a universal standard."
          >
            Each deduction is (100 − theme score) × the weight your priorities give that theme.
          </p>
        </div>
      )}

      {/* ── Biggest mismatch: your number vs the book's number ───────────────
          The triptych only. Its sentence used to render here too, making the
          same diagnosis appear four times in one panel (summary, points-went,
          this card, the theme row). The numbers ARE the card; the sentence
          lives in the panel summary above and the theme row below. */}
      {biggest && (
        <div className="flex flex-col gap-2 rounded-lg border border-negative/25 bg-negative/[0.04] p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-negative">
            Biggest mismatch — {biggest.themeLabel}
          </span>
          <div className="grid grid-cols-3 gap-2 rounded-md border border-border/40 bg-surface/40 px-3 py-2">
            <div className="flex flex-col">
              <span className="text-[10px] text-muted">You said</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{biggest.stated}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted">The book</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{biggest.actual}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted">Gap</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-negative">{biggest.excess}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Mismatches ── */}
      {mismatched.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-negative/25 bg-negative/[0.03] p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-negative">
            Out of line with your policy ({mismatched.length})
          </span>
          <ul className="flex flex-col gap-2.5">
            {mismatched.map((t) => (
              <ThemeRow key={t.id} theme={t} expandedByDefault onNavigate={onNavigate} />
            ))}
          </ul>
        </div>
      )}

      {/* ── Tension ── */}
      {tension.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/25 bg-warning/[0.03] p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">
            Close to your limits ({tension.length})
          </span>
          <ul className="flex flex-col gap-2.5">
            {tension.map((t) => (
              <ThemeRow key={t.id} theme={t} expandedByDefault onNavigate={onNavigate} />
            ))}
          </ul>
        </div>
      )}

      {/* ── Aligned: one line, expandable — "inside your limits" needs no essay ── */}
      {aligned.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowAligned((v) => !v)}
            aria-expanded={showAligned}
            className="flex items-baseline justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-positive">
              Inside your limits ({aligned.length}) {showAligned ? "▲" : "▼"}
            </span>
            {!showAligned && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
                {aligned.map((t) => t.label).join(" · ")}
              </span>
            )}
          </button>
          {showAligned && (
            <ul className="flex flex-col gap-2.5">
              {aligned.map((t) => (
                <ThemeRow key={t.id} theme={t} expandedByDefault={false} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Aligned ≠ safe: the magnitudes your policy accepts, kept visible ── */}
      {alignment.objectiveNotes.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Aligned with your policy — and worth knowing
          </span>
          <ul className="flex flex-col gap-1">
            {alignment.objectiveNotes.map((n, i) => (
              <li key={i} className="text-[11px] leading-snug text-muted">— {n}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Facts, not judgments ── */}
      {(factOnly.length > 0 || gaps.length > 0) && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Not scored — {factOnly.length > 0 && gaps.length > 0
              ? "by your choice, or unmeasurable"
              : factOnly.length > 0
                ? "you said these don't matter to you"
                : "insufficient evidence"}
          </span>
          <ul className="flex flex-col gap-1">
            {[...factOnly, ...gaps].map((t) => (
              <li key={t.id} className="text-[11px] leading-snug">
                <span className="text-foreground">{t.label}</span>
                <span className="text-muted"> — {t.finding}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {alignment.score != null && <Badge variant="neutral">{alignment.evidencePct}% of value evidenced</Badge>}
          {alignment.status === "insufficient" && <Badge variant="warning">Insufficient evidence to score</Badge>}
        </div>
        {policy && (
          <button
            type="button"
            onClick={() => askAi(router, { source: "app", question: challengeQuestion(alignment, policy) })}
            className="rounded-sm text-[11px] text-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            title="The AI stress-tests your stated tolerances against the measured facts. It never sets the score."
          >
            Challenge my assumptions →
          </button>
        )}
      </div>
    </Card>
  );
}
