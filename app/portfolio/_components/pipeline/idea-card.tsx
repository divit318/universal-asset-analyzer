"use client";

/**
 * One idea, as a decision rather than a row.
 *
 * The card answers "should I own more of this, less of this, or something else
 * instead?" in three layers, so 30+ ideas stay readable while none of them is a
 * black box:
 *
 *   collapsed  — verdict, expected impact, fit, and the ONE primary reason;
 *   expanded   — the five rationale questions, trade-offs, supporting dimensions
 *                and provenance;
 *   popover    — the impact formula and its factor decomposition, through the
 *                same `ExplainableValue` primitive the home dashboard uses.
 *
 * Every string on it comes from `buildIdeaAssessments` (deterministic, from
 * measured values). Nothing here is model-generated, and nothing is computed in
 * this file — a component that calculates is a second source of truth.
 *
 * Low-relevance ideas are dimmed, never hidden: `deprioritize` reduces opacity
 * and drops the card to the bottom of its column. Silently removing an idea the
 * user chose to track would make the column a lie.
 */

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SymbolTag } from "@/app/_home/_atmosphere/symbol-link";
import { ExplainableValue } from "@/app/_home/_atmosphere/explain-popover";
import { PORTFOLIO_CLASS_LABEL } from "@/lib/portfolio/model/types";
import { STAGE_LABEL } from "@/lib/idea-stage";
import { VERDICT_LABEL, type IdeaAssessment } from "@/lib/portfolio/engines/idea-relevance";
import type { FitTier } from "@/lib/ios/types";
import type { IdeaStage } from "@/lib/types";
import type { PipelineRow } from "@/app/api/pipeline/route";

const TIER_TONE: Record<FitTier, string> = {
  excellent: "text-positive",
  good: "text-brand",
  neutral: "text-muted",
  poor: "text-warning",
  avoid: "text-negative",
};

const TIER_LABEL: Record<FitTier, string> = {
  excellent: "Excellent fit",
  good: "Good fit",
  neutral: "Neutral fit",
  poor: "Poor fit",
  avoid: "Avoid",
};

/** Verdict chrome. Only the two that ask for action carry colour. */
const VERDICT_TONE: Record<IdeaAssessment["verdict"], string> = {
  research: "border-brand/40 text-brand",
  decide: "border-brand/40 text-brand",
  "trade-proposed": "border-warning/40 text-warning",
  "review-sizing": "border-warning/40 text-warning",
  hold: "border-border text-muted",
  "no-case": "border-border text-faint",
  deprioritize: "border-border text-faint",
};

function RationaleRow({ q, a }: { q: string; a: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{q}</dt>
      <dd className="text-[11px] leading-snug text-muted">{a}</dd>
    </div>
  );
}

function DimensionBar({
  label,
  score,
  weight,
  message,
  impact,
  evidenced,
}: {
  label: string;
  score: number;
  weight: number;
  message: string;
  impact: "positive" | "neutral" | "negative";
  evidenced: boolean;
}) {
  const tone =
    impact === "positive" ? "bg-positive/70" : impact === "negative" ? "bg-negative/70" : "bg-foreground/30";
  return (
    <li className={`flex flex-col gap-1 ${evidenced ? "" : "opacity-50"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium text-foreground/90">{label}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
          {evidenced ? `${score}/100` : "no data"} · w {(weight * 100).toFixed(0)}%
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${evidenced ? score : 0}%` }} />
      </div>
      <p className="text-[10px] leading-snug text-faint">{message}</p>
    </li>
  );
}

export function IdeaCard({
  row,
  assessment,
  onMove,
  stages,
}: {
  row: PipelineRow;
  assessment: IdeaAssessment | null;
  onMove: (symbol: string, name: string, to: IdeaStage) => void;
  stages: IdeaStage[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const fit = assessment?.fit ?? null;
  // Deprioritized visually, never removed — and restored to full opacity on
  // hover, so a dimmed card is still a readable card.
  const dimmed = assessment?.verdict === "deprioritize" || assessment?.verdict === "no-case";

  return (
    <li
      className={`rounded-control border border-border bg-surface-2/40 transition-opacity ${dimmed ? "opacity-60 hover:opacity-100" : ""}`}
    >
      {/* ── Collapsed: identity, verdict, the one number that orders the column ── */}
      <div className="uaa-linkable flex items-start gap-2 px-2.5 py-2">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {row.held ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-positive" title="Currently held" />
            ) : null}
            <SymbolTag symbol={row.symbol} className="font-mono text-[13px] font-semibold text-foreground">
              {row.symbol}
            </SymbolTag>
            {row.assetClass ? (
              <span className="shrink-0 rounded-sm border border-border px-1 text-[9px] uppercase tracking-wide text-faint">
                {PORTFOLIO_CLASS_LABEL[row.assetClass]}
              </span>
            ) : null}
            {assessment ? (
              <span
                className={`shrink-0 rounded-sm border px-1 text-[9px] font-semibold uppercase tracking-wide ${VERDICT_TONE[assessment.verdict]}`}
              >
                {VERDICT_LABEL[assessment.verdict]}
              </span>
            ) : null}
          </span>

          <span className="truncate text-[11px] text-muted">{row.name}</span>

          {/* Fit + impact. Both are explainable in place; neither is a bare number. */}
          {fit && assessment ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
              <ExplainableValue explanation={assessment.explanation} className="text-[10px]">
                <span className="font-mono tabular-nums text-foreground">
                  {assessment.impactPct != null ? `${assessment.impactPct.toFixed(1)}%` : "—"}
                </span>
                <span className="ml-1 text-faint">impact</span>
              </ExplainableValue>
              <span className={TIER_TONE[fit.fitTier]}>
                {TIER_LABEL[fit.fitTier]} · <span className="font-mono tabular-nums">{fit.fitScore}</span>
              </span>
              <span className="text-faint">{Math.round(fit.confidence)}% evidenced</span>
              <span className="text-faint">#{assessment.priority}</span>
            </span>
          ) : (
            <span className="text-[10px] text-faint">
              {assessment ? "Not assessable — no fundamentals for this symbol" : "Assessing relevance…"}
            </span>
          )}

          {/* The primary reason, always visible: a card with no stated reason is
              the thing this whole feature exists to fix. */}
          {assessment ? (
            <span className="text-[11px] leading-snug text-foreground/80">{assessment.headline}</span>
          ) : null}
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-right text-[10px] text-faint">
            {row.daysInStage}d
            {!row.tracked ? (
              <span className="block text-[9px] uppercase tracking-wide text-faint">untracked</span>
            ) : null}
          </span>
          <select
            value={row.stage}
            onChange={(e) => onMove(row.symbol, row.name, e.target.value as IdeaStage)}
            aria-label={`Stage for ${row.symbol}`}
            className="rounded-control border border-border bg-surface-2 px-1.5 py-1 text-[11px] text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </span>
      </div>

      {/* ── Expander ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="flex w-full items-center justify-between gap-2 border-t border-hairline px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-faint outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span>{open ? "Hide reasoning" : "Why this, why now"}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-hairline px-2.5 py-2.5">
          {assessment ? (
            <>
              {/* The trade engine's own words, when it has any. One authority per claim. */}
              {assessment.linkedTrade ? (
                <div className="rounded-control border border-warning/30 bg-warning/5 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-warning">
                    The Decisions tab has a simulated trade for this
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-foreground/90">
                    {assessment.linkedTrade.title}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-muted">
                    {assessment.linkedTrade.rationale}
                  </p>
                  <p className="mt-1 font-mono text-[10px] tabular-nums text-muted">
                    {assessment.linkedTrade.healthDelta != null
                      ? `measured health ${assessment.linkedTrade.healthDelta >= 0 ? "+" : ""}${assessment.linkedTrade.healthDelta.toFixed(1)}`
                      : "health impact not measured"}
                    {" · "}
                    {assessment.linkedTrade.confidence}% confidence
                    {" · "}
                    {assessment.linkedTrade.alternativesEvaluated} alternatives simulated
                  </p>
                </div>
              ) : null}

              <dl className="flex flex-col gap-2">
                <RationaleRow q="Why am I seeing this?" a={assessment.rationale.whySeeing} />
                <RationaleRow q="What problem does it solve?" a={assessment.rationale.whatProblem} />
                <RationaleRow q="Why now?" a={assessment.rationale.whyNow} />
                <RationaleRow q="Why this and not another?" a={assessment.rationale.whyThisOne} />
                <RationaleRow q="What if I ignore it?" a={assessment.rationale.ifIgnored} />
              </dl>

              {assessment.expected ? (
                <div className="rounded-control border border-hairline bg-surface/40 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                    Expected effect at the suggested size
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted">{assessment.expected.summary}</p>
                </div>
              ) : null}

              {assessment.secondaryReasons.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Also in favour</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {assessment.secondaryReasons.map((r) => (
                      <li key={r} className="text-[11px] leading-snug text-muted">
                        · {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {assessment.tradeoffs.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Trade-offs</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {assessment.tradeoffs.map((t) => (
                      <li key={t} className="text-[11px] leading-snug text-warning/90">
                        · {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {fit ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                    Supporting dimensions
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-2">
                    {Object.values(fit.dimensions).map((d) => (
                      <DimensionBar
                        key={d.label}
                        label={d.label}
                        score={d.score}
                        weight={d.weight}
                        message={d.message}
                        impact={d.impact}
                        evidenced={(d.confidence ?? 1) > 0}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-muted">
              Relevance is still loading. The column, the stage and the provenance below are already final.
            </p>
          )}

          <p className="border-t border-hairline pt-2 text-[10px] leading-snug text-faint">
            {row.originLabel}
          </p>
        </div>
      ) : null}
    </li>
  );
}
