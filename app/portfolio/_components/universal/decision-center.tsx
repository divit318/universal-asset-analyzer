"use client";

import { Card, Badge } from "@/app/_components/ui";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { formatCurrency } from "@/lib/format";
import { ImpactRow, StateRow } from "./impact-display";
import { healthGradeOf } from "@/lib/portfolio/engines/health";
import type { DecisionCard as Decision } from "@/lib/portfolio/engines/decision";
import type { HealthScore } from "@/lib/portfolio/engines/health";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";

/**
 * The Portfolio Decision Center — an investment-committee memo, not a report.
 *
 * Every number here is MEASURED, not asserted: "Expected health +6.2" is the
 * difference between two full portfolio evaluations, because the recommendation
 * engine built the post-trade portfolio and re-ran the real health/risk/allocation
 * engines on it (see lib/portfolio/engines/simulate.ts). The Decision Score is a
 * rescaling of that same measured impact, weighted by confidence — not a separate
 * heuristic. Where the underlying engines have no honest basis for a number (a
 * forward price-return forecast, a tax rate), the copy says so rather than
 * inventing one.
 *
 * A recommendation whose simulated impact was negligible was DISCARDED upstream.
 * An empty Decision Center is a real, honest answer: the portfolio is fine.
 */

const ACTION_TONE: Record<
  Decision["recommendation"]["action"],
  { badge: "positive" | "negative" | "warning" | "brand" | "neutral"; label: string }
> = {
  ADD: { badge: "positive", label: "Add" },
  INCREASE: { badge: "positive", label: "Increase" },
  REDUCE: { badge: "warning", label: "Reduce" },
  SELL: { badge: "negative", label: "Sell" },
  HOLD: { badge: "neutral", label: "Hold" },
  REALLOCATE: { badge: "brand", label: "Reallocate" },
};

const DIFFICULTY_LABEL: Record<Decision["implementationDifficulty"], string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
};

function scoreTone(score: number): "positive" | "warning" | "brand" | "neutral" {
  if (score >= 65) return "positive";
  if (score >= 45) return "neutral";
  return "warning";
}

function ExpectedPortfolioState({
  decision,
  health,
  risk,
  assetClassHhi,
  annualIncome,
}: {
  decision: Decision;
  health: HealthScore;
  risk: UniversalRisk;
  /** Asset-class HHI baseline — the denominator `impact.diversificationDelta` is measured on. */
  assetClassHhi: number;
  annualIncome: number;
}) {
  const impact = decision.recommendation.impact;
  return (
    <div className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
        Expected portfolio state if you make this change
      </span>
      <div className="mt-1 flex flex-col divide-y divide-border/40">
        <StateRow
          label="Portfolio health"
          before={health.total}
          after={health.total + impact.healthDelta}
          decimals={0}
          format={(v) => `${Math.round(v)} ${healthGradeOf(Math.round(v))}`}
        />
        <StateRow
          label="Annualized volatility"
          before={risk.annualizedVolatility}
          after={risk.annualizedVolatility != null ? risk.annualizedVolatility + (impact.riskDelta ?? 0) : null}
          suffix="%"
          higherIsBetter={false}
        />
        {/* ── One denominator on both sides ────────────────────────────────
            `impact.diversificationDelta` is measured as
            `after.allocation.byAssetClass.hhi − before...` (simulate.ts), so its
            baseline must be the ASSET-CLASS HHI. This row used to add it to
            `risk.positionHhi` — an HHI over individual holdings — and render the
            sum: on the real book, 688 + (−160) = 528, a number that was neither
            the post-trade position HHI (664) nor the post-trade asset-class HHI
            (3271), and that overstated the improvement 6.7x. Same rule the Risk
            Lab states for the same statistic: identical labels for different
            denominators make the tool look like it contradicts itself. */}
        <StateRow
          label="Asset-class HHI"
          before={assetClassHhi}
          after={assetClassHhi + impact.diversificationDelta}
          decimals={0}
          higherIsBetter={false}
        />
        <StateRow
          label="Illiquid share"
          before={risk.illiquidPct}
          after={risk.illiquidPct + impact.liquidityDelta}
          suffix="%"
          higherIsBetter={false}
        />
        {/* A dollar figure, formatted like every other dollar figure in the app.
            This rendered as a bare "91141" — the one unformatted number on a page
            of currency, which reads as a count of something rather than money. */}
        <StateRow
          label="Annual income"
          before={annualIncome}
          after={annualIncome + impact.incomeDelta}
          decimals={0}
          format={formatCurrency}
        />
      </div>
    </div>
  );
}

/**
 * The memo, minus "Why this".
 *
 * `why.why` IS `recommendation.rationale` — one string, by construction in
 * decision.ts — and every card already renders it as its own description. Printing
 * it again as the memo's first row (with the headline card's memo open by default,
 * three lines below the identical paragraph) was pure duplication, and it trained
 * the reader to skim the rest of the memo.
 */
function WhyMemo({ decision }: { decision: Decision }) {
  const { why } = decision;
  return (
    <dl className="flex flex-col gap-3 text-xs leading-relaxed">
      <div>
        <dt className="font-semibold text-foreground">Why now</dt>
        <dd className="text-muted">{why.whyNow}</dd>
      </div>
      <div>
        <dt className="font-semibold text-foreground">Why this amount</dt>
        <dd className="text-muted">{why.whyThisAmount}</dd>
      </div>
      <div>
        <dt className="font-semibold text-foreground">Why not a different allocation</dt>
        <dd className="text-muted">{why.whyNotAlternative}</dd>
      </div>
      <div>
        <dt className="font-semibold text-foreground">Why not do nothing</dt>
        <dd className="text-muted">{why.whyNotNothing}</dd>
      </div>
    </dl>
  );
}

function AlternativesList({ decision }: { decision: Decision }) {
  const { alternatives } = decision.recommendation;
  return (
    <div className="flex flex-col gap-2 text-xs leading-relaxed">
      <p className="text-muted">
        {decision.alternativesEvaluated} candidate portfolio modification{decision.alternativesEvaluated === 1 ? "" : "s"} were
        simulated while building this list. This decision alone considered {decision.alternativesConsidered}{" "}
        option{decision.alternativesConsidered === 1 ? "" : "s"} (including doing nothing).
      </p>
      {alternatives.length > 0 && (
        <ul className="flex flex-col gap-1">
          {alternatives.map((a) => (
            <li key={a.symbol} className="flex items-center justify-between gap-3 rounded-md bg-surface/40 px-2.5 py-1.5">
              <span className="text-foreground">{a.symbol} — {a.exposure}</span>
              <span className="font-mono text-[11px] text-muted">{a.healthDelta >= 0 ? "+" : ""}{a.healthDelta.toFixed(1)} health</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DecisionCardView({
  decision,
  health,
  risk,
  assetClassHhi,
  annualIncome,
}: {
  decision: Decision;
  health: HealthScore;
  risk: UniversalRisk;
  assetClassHhi: number;
  annualIncome: number;
}) {
  const rec = decision.recommendation;
  const tone = ACTION_TONE[rec.action];

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-mono text-[11px] font-bold tabular-nums text-muted">
            {decision.decisionPriority}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={tone.badge}>{tone.label}</Badge>
              <h3 className="truncate text-sm font-semibold text-foreground">{rec.title}</h3>
              <Badge variant={scoreTone(decision.decisionScore)}>Decision score {decision.decisionScore}</Badge>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{rec.rationale}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
            {formatCurrency(rec.amount)}
          </span>
          {/* One meaning across every card: the share of the evidence behind these
              numbers that was actually observed. The basis is deterministic, so it
              can be stated rather than hand-waved. */}
          <span
            className="cursor-help text-[11px] text-muted/70 underline decoration-dotted decoration-muted/30 underline-offset-2"
            title={`Confidence ${rec.confidence}% — how much of the evidence behind this card's numbers was observed rather than assumed. It does not measure how large the impact is or how urgent the change is.\n\n${decision.confidenceBasis.map((b) => `• ${b}`).join("\n")}`}
          >
            {rec.confidence}% evidenced
          </span>
        </div>
      </div>

      <ImpactRow impact={rec.impact} />

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="neutral">{DIFFICULTY_LABEL[decision.implementationDifficulty]} to execute</Badge>
        <Badge variant="neutral">{decision.executionTime}</Badge>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <span><strong className="text-foreground">Liquidity: </strong>{decision.liquidityImpact}</span>
        <span><strong className="text-foreground">Tax: </strong>{decision.taxImpact}</span>
        <span><strong className="text-foreground">Return: </strong>{decision.expectedReturnImpact}</span>
      </div>

      {/* Every real decision costs something. Stating the tradeoff is not a
          disclaimer — it is the part that makes the recommendation trustworthy. */}
      {rec.tradeoffs.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Tradeoffs
          </span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {rec.tradeoffs.map((t, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-muted">— {t}</li>
            ))}
          </ul>
        </div>
      )}

      {/* The quantified cost of inaction, on every card rather than only the
          headline one — it is the same question ("what does waiting cost?") for
          the fourth-ranked decision as for the first, and it is now stated only
          here instead of being duplicated into the Why-not-do-nothing row. */}
      <div className="rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <strong className="text-foreground">Cost of waiting: </strong>{decision.opportunityCost.description}
      </div>

      <ExpectedPortfolioState decision={decision} health={health} risk={risk} assetClassHhi={assetClassHhi} annualIncome={annualIncome} />

      <div className="flex flex-col gap-2">
        <CollapsibleSection title="Why this decision">
          <WhyMemo decision={decision} />
        </CollapsibleSection>
        <CollapsibleSection
          title="Alternatives considered"
          subtitle={`${decision.alternativesConsidered} option${decision.alternativesConsidered === 1 ? "" : "s"} evaluated`}
        >
          <AlternativesList decision={decision} />
        </CollapsibleSection>
      </div>
    </Card>
  );
}

export function DecisionCenter({
  decisions,
  health,
  risk,
  assetClassHhi,
  annualIncome,
}: {
  decisions: Decision[];
  health: HealthScore;
  risk: UniversalRisk;
  /**
   * `allocation.byAssetClass.hhi`. Passed in rather than derived from `risk`,
   * because `risk` carries the POSITION-level HHI and the two are not
   * interchangeable — see the note on the Asset-class HHI row below.
   */
  assetClassHhi: number;
  annualIncome: number;
}) {
  if (decisions.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <p className="text-sm font-semibold text-foreground">No changes worth making.</p>
        <p className="max-w-md text-xs leading-relaxed text-muted">
          Every candidate change was simulated through the portfolio engines and none
          measurably improved it. Doing nothing is the recommendation.
        </p>
      </Card>
    );
  }

  const top = decisions[0];
  const rest = decisions.slice(1);

  return (
    <div className="flex flex-col gap-4">
      {/* The single highest-ROI change — the mission's headline question. */}
      <Card className="flex flex-col gap-3 border-brand/30 bg-brand/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-brand">
            Highest-impact change available now — if you only make one change, make this one
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {/* The headline card showed no confidence at all, so the one change the
                page tells you to make was the one whose evidence quality you could
                not see. Same number, same meaning, same tooltip as every other card. */}
            <span
              className="cursor-help text-[11px] text-muted/70 underline decoration-dotted decoration-muted/30 underline-offset-2"
              title={`Confidence ${top.confidence}% — how much of the evidence behind this card's numbers was observed rather than assumed. It does not measure how large the impact is or how urgent the change is.\n\n${top.confidenceBasis.map((b) => `• ${b}`).join("\n")}`}
            >
              {top.confidence}% evidenced
            </span>
            <Badge variant={scoreTone(top.decisionScore)}>Decision score {top.decisionScore}</Badge>
          </div>
        </div>
        <p className="text-base font-semibold text-foreground">{top.recommendation.title}</p>
        <p className="text-xs leading-relaxed text-muted">{top.recommendation.rationale}</p>
        <ImpactRow impact={top.recommendation.impact} />
        <div className="rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <strong className="text-foreground">Cost of waiting: </strong>{top.opportunityCost.description}
        </div>
        <ExpectedPortfolioState decision={top} health={health} risk={risk} assetClassHhi={assetClassHhi} annualIncome={annualIncome} />
        <div className="flex flex-col gap-2">
          <CollapsibleSection title="Why this decision" defaultOpen>
            <WhyMemo decision={top} />
          </CollapsibleSection>
          <CollapsibleSection
            title="Alternatives considered"
            subtitle={`${top.alternativesConsidered} option${top.alternativesConsidered === 1 ? "" : "s"} evaluated`}
          >
            <AlternativesList decision={top} />
          </CollapsibleSection>
        </div>
      </Card>

      {rest.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted/70">
            Full priority queue ({decisions.length})
          </span>
          {rest.map((d) => (
            <DecisionCardView key={d.recommendation.id} decision={d} health={health} risk={risk} assetClassHhi={assetClassHhi} annualIncome={annualIncome} />
          ))}
        </div>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-muted/70">
        Impact figures are simulated: each change is applied to a copy of the portfolio
        and re-scored by the same allocation, risk and health engines that produce the
        analytics tabs. Decision scores rank that same measured impact — they are not a
        separate estimate. {top.alternativesEvaluated} candidate modification
        {top.alternativesEvaluated === 1 ? " was" : "s were"} evaluated in total to build this list.
      </p>
    </div>
  );
}
