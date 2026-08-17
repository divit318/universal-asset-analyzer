"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Badge, Button } from "@/app/_components/ui";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { askAi } from "@/app/_components/ask-ai";
import { formatCurrency } from "@/lib/format";
import { ImpactRow, StateRow } from "./impact-display";
import { resolveDecisionExecution, executionLabel, type DecisionExecution } from "./decision-action";
import { thesisKeyOf } from "@/lib/portfolio/engines/decision-memory";
import { BuyDecisionDialog, type BuyDecisionContext } from "./buy-decision-dialog";
import { ManageHoldingModal, type TxMode } from "./manage-holding-modal";
import type { Tab } from "./dashboard-nav";
import type { DecisionCard as Decision } from "@/lib/portfolio/engines/decision";
import type { AlignmentReport } from "@/lib/portfolio/alignment/engine";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { Holding } from "@/lib/portfolio/model/types";

/**
 * The Portfolio Decision Center — an investment-committee memo, not a report.
 *
 * Every number here is MEASURED, not asserted: "Expected alignment +6.2" is the
 * difference between two full portfolio evaluations, because the recommendation
 * engine built the post-trade portfolio and re-ran the real alignment/risk/
 * allocation engines on it (see lib/portfolio/engines/simulate.ts). The Decision
 * Score is a rescaling of that same measured impact, weighted by confidence — not
 * a separate heuristic. Where the underlying engines have no honest basis for a
 * number (a forward price-return forecast, a tax rate), the copy says so rather
 * than inventing one.
 *
 * A recommendation whose simulated impact was negligible was DISCARDED upstream.
 * An empty Decision Center is a real, honest answer: the portfolio is fine.
 *
 * And every card ENDS in an action, not a conclusion: the recommendation's own
 * `change` object (the exact trade the engine simulated) is handed to the same
 * write paths the Holdings and Watchlist flows already use — prefilled, with
 * the decision carried along, reversible via the transaction snapshot. Insight →
 * decision → execution without leaving the tab or re-typing what UAA already
 * knows.
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
  // Deliberately brand, not positive: an opportunity to research, never a
  // green-lit trade.
  INVESTIGATE: { badge: "brand", label: "Worth a look" },
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
  alignment,
  risk,
  assetClassHhi,
  annualIncome,
}: {
  decision: Decision;
  alignment: AlignmentReport;
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
        {/* Both sides nullable: an unscorable book has no alignment score, and a
            null delta means "unknown", not 0 — StateRow drops the row rather than
            projecting a number from a non-number. */}
        <StateRow
          label="Portfolio alignment"
          before={alignment.score}
          after={
            alignment.score != null && impact.alignmentDelta != null
              ? alignment.score + impact.alignmentDelta
              : null
          }
          decimals={0}
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
              <span className="font-mono text-[11px] text-muted">{a.alignmentDelta >= 0 ? "+" : ""}{a.alignmentDelta.toFixed(1)} alignment</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Execution flows ──────────────────────────────────────────────────────
   Owned by DecisionCenter, not by each card: a refresh() after an executed
   trade re-orders (or empties) the decision list and unmounts cards, and a
   dialog scoped to a card would vanish mid-success-screen — the same lesson
   HoldingsPanel's managingHolding state already encodes. */
type Flow =
  | { type: "buy_new"; context: BuyDecisionContext }
  | { type: "manage"; holding: Holding; mode: TxMode; amount?: number; title: string };

/** The decision, restated inside the trade dialog so context travels with the action. */
function DecisionContextNote({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-brand/25 bg-brand/[0.05] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-brand/80">Executing decision</p>
      <p className="mt-1 text-xs leading-relaxed text-foreground">{title}</p>
    </div>
  );
}

/**
 * The card's action row: one primary, truthful next step (execute the exact
 * trade the engine simulated), plus the supporting moves — open the asset's
 * research, jump to the holding, challenge the reasoning with the AI.
 */
function DecisionActions({
  decision,
  execution,
  onLaunch,
  onNavigate,
  onDismiss,
}: {
  decision: Decision;
  execution: DecisionExecution;
  onLaunch: (flow: Flow) => void;
  onNavigate?: (tab: Tab, anchor?: string, opts?: { holdingsFilter?: string }) => void;
  /** Record "I considered this — stop repeating it" in the shared decision memory. */
  onDismiss?: (decision: Decision) => void;
}) {
  const router = useRouter();
  const rec = decision.recommendation;
  const label = executionLabel(execution);

  const launch = () => {
    switch (execution.kind) {
      case "buy_new":
        onLaunch({
          type: "buy_new",
          context: {
            symbol: execution.symbol,
            name: execution.name,
            amount: execution.amount,
            title: rec.title,
            recommendationId: rec.id,
            cashHolding: null, // filled by DecisionCenter, which knows the cash position
          },
        });
        break;
      case "buy_existing":
        onLaunch({ type: "manage", holding: execution.holding, mode: "buy", amount: execution.amount, title: rec.title });
        break;
      case "sell":
        onLaunch({
          type: "manage",
          holding: execution.holding,
          mode: execution.full ? "sell_all" : "sell",
          amount: execution.full ? undefined : execution.amount,
          title: rec.title,
        });
        break;
      case "rebalance":
        onNavigate?.("optimize");
        break;
      case "investigate":
        // Research first, always — a discovery card's primary step opens the
        // research hub; any eventual buy goes through the normal flow there.
        router.push(`/research?symbol=${encodeURIComponent(execution.symbol)}`);
        break;
      case "manual_partial":
      case "stale":
        break;
    }
  };

  const holdingSymbolOrName =
    execution.kind === "sell" || execution.kind === "buy_existing" || execution.kind === "manual_partial"
      ? execution.holding.symbol ?? execution.holding.name
      : null;

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
      {execution.kind === "manual_partial" && (
        <p className="text-[11px] leading-relaxed text-muted">
          {execution.holding.name} is a manually-valued asset with no share ledger, so a partial
          sale can&apos;t be executed here — the trim stands as advice. Adjust its valuation in the
          Research Hub, or sell the whole position from Holdings.
        </p>
      )}
      {execution.kind === "stale" && (
        <p className="text-[11px] leading-relaxed text-muted">
          The position this decision concerns is no longer in the portfolio — the list refreshes on
          the next report load.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {label && (
          <Button variant="primary" size="sm" onClick={launch}>
            {label}
            {(execution.kind === "buy_new" || execution.kind === "buy_existing") &&
              ` · ${formatCurrency(execution.amount)}`}
            {execution.kind === "sell" &&
              ` · ${formatCurrency(execution.full ? execution.holding.valuation.valueBase : execution.amount)}`}
          </Button>
        )}
        {rec.symbol && (
          <Link
            href={`/research?symbol=${encodeURIComponent(rec.symbol)}`}
            className="rounded-sm text-[11px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Research {rec.symbol} →
          </Link>
        )}
        {holdingSymbolOrName && onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate("holdings", undefined, { holdingsFilter: holdingSymbolOrName })}
            className="rounded-sm text-[11px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            View holding
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            askAi(router, {
              source: "app",
              question:
                `My Portfolio Decision Center recommends: "${rec.title}" (${formatCurrency(rec.amount)}, ` +
                `decision score ${decision.decisionScore}, ${rec.confidence}% evidenced). It is driven by ${decision.policyNote}. ` +
                `Rationale: ${rec.rationale}` +
                (decision.themeTradeoff ? ` Measured tradeoff: ${decision.themeTradeoff}` : "") +
                ` What would you challenge about this recommendation — or about the policy setting behind it — before I execute it?`,
            })
          }
          className="rounded-sm text-[11px] text-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Ask AI to challenge this
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(decision)}
            title="I've considered this — don't show this idea again unless my policy changes or the situation gets materially worse. The engine will look for different actions instead."
            className="ml-auto rounded-sm text-[11px] text-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Dismiss — I&apos;ve considered this
          </button>
        )}
      </div>
    </div>
  );
}

function DecisionCardView({
  decision,
  alignment,
  risk,
  assetClassHhi,
  annualIncome,
  holdings,
  onLaunch,
  onNavigate,
  onDismiss,
}: {
  decision: Decision;
  alignment: AlignmentReport;
  risk: UniversalRisk;
  assetClassHhi: number;
  annualIncome: number;
  holdings: Holding[];
  onLaunch: (flow: Flow) => void;
  onNavigate?: (tab: Tab, anchor?: string, opts?: { holdingsFilter?: string }) => void;
  onDismiss?: (decision: Decision) => void;
}) {
  const rec = decision.recommendation;
  const tone = ACTION_TONE[rec.action];
  const execution = resolveDecisionExecution(decision, holdings);

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
            {/* The rule this serves — the investor's own words, same phrasing as
                the Alignment panel, so the two surfaces read as one system. */}
            <p className="mt-1 text-[11px] leading-snug text-brand/90">
              Driven by {decision.policyNote}.
            </p>
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

      <DecisionActions decision={decision} execution={execution} onLaunch={onLaunch} onNavigate={onNavigate} onDismiss={onDismiss} />

      <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <span><strong className="text-foreground">Liquidity: </strong>{decision.liquidityImpact}</span>
        <span><strong className="text-foreground">Tax: </strong>{decision.taxImpact}</span>
        <span><strong className="text-foreground">Return: </strong>{decision.expectedReturnImpact}</span>
      </div>

      {/* Every real decision costs something. Stating the tradeoff is not a
          disclaimer — it is the part that makes the recommendation trustworthy.
          When the trade moves the investor's own themes in OPPOSITE directions,
          that measured tension leads the list — a decision that helps Downside
          by hurting Structure must never be presented as universally good. */}
      {(rec.tradeoffs.length > 0 || decision.themeTradeoff) && (
        <div className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Tradeoffs
          </span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {decision.themeTradeoff && (
              <li className="text-[11px] leading-relaxed text-warning">— {decision.themeTradeoff}</li>
            )}
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

      <ExpectedPortfolioState decision={decision} alignment={alignment} risk={risk} assetClassHhi={assetClassHhi} annualIncome={annualIncome} />

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
  suppressedDecisions = [],
  policyUpdatedAt = null,
  portfolioId = 1,
  alignment,
  risk,
  assetClassHhi,
  annualIncome,
  holdings,
  baseCurrency,
  onExecuted,
  onNavigate,
}: {
  decisions: Decision[];
  /** Theses the investor already declined — rendered as restorable memory, never as cards. */
  suppressedDecisions?: { thesisKey: string; title: string; dismissedAt: string; reviveWhen: string }[];
  policyUpdatedAt?: string | null;
  portfolioId?: number;
  alignment: AlignmentReport;
  risk: UniversalRisk;
  /**
   * `allocation.byAssetClass.hhi`. Passed in rather than derived from `risk`,
   * because `risk` carries the POSITION-level HHI and the two are not
   * interchangeable — see the note on the Asset-class HHI row below.
   */
  assetClassHhi: number;
  annualIncome: number;
  /** The report's holdings — what the execute flows resolve trades against. */
  holdings: Holding[];
  baseCurrency: string;
  /** The ledger changed (execution or undo) — refetch the report. */
  onExecuted: () => void;
  onNavigate?: (tab: Tab, anchor?: string, opts?: { holdingsFilter?: string }) => void;
}) {
  const [flow, setFlow] = useState<Flow | null>(null);

  // The largest base-currency cash position — the honest funding source a
  // gap-fill buy offers to draw from. Computed once here, not per card.
  const cashHolding = holdings
    .filter((h) => h.assetClass === "cash" && h.currency.toUpperCase() === baseCurrency.toUpperCase())
    .sort((a, b) => b.valuation.valueBase - a.valuation.valueBase)[0] ?? null;

  const launch = (f: Flow) => {
    if (f.type === "buy_new") {
      f = { ...f, context: { ...f.context, cashHolding: cashHolding ? { id: cashHolding.id, valueBase: cashHolding.valuation.valueBase } : null } };
    }
    setFlow(f);
  };

  // "I've considered this" — recorded against the UNDERLYING thesis with the
  // context revival is judged on, then the report rebuilds without it and the
  // engine surfaces different work (or researched discoveries) instead.
  const dismiss = (decision: Decision) => {
    const rec = decision.recommendation;
    const theme = rec.theme ? alignment.themes.find((t) => t.id === rec.theme) : null;
    const holding = rec.symbol
      ? holdings.find((h) => h.symbol?.toUpperCase() === rec.symbol!.toUpperCase())
      : null;
    fetch("/api/portfolio/decisions/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolioId,
        thesisKey: thesisKeyOf(rec),
        title: rec.title,
        policyUpdatedAt,
        themeId: rec.theme,
        themeScore: theme?.score ?? null,
        subjectWeightPct: holding ? Math.round(holding.weight * 10) / 10 : null,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        onExecuted();
      })
      .catch(() => {});
  };

  const restore = (thesisKey: string) => {
    fetch("/api/portfolio/decisions/dismiss", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolioId, thesisKey }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        onExecuted();
      })
      .catch(() => {});
  };

  // The restorable memory — rendered under the queue AND on the empty state,
  // because "nothing to do" plus an invisible pile of dismissed ideas would
  // read as the engine having gone quiet rather than having listened.
  const suppressedList = suppressedDecisions.length > 0 && (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        Considered and set aside ({suppressedDecisions.length})
      </span>
      <ul className="flex flex-col gap-1">
        {suppressedDecisions.map((s) => (
          <li key={s.thesisKey} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]">
            <span className="min-w-0 text-muted">
              <span className="text-foreground">{s.title}</span>
              {" — dismissed "}{new Date(s.dismissedAt).toLocaleDateString()}
              <span className="text-muted"> · {s.reviveWhen}</span>
            </span>
            <button
              type="button"
              onClick={() => restore(s.thesisKey)}
              className="shrink-0 rounded-sm text-[11px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const dialogs: ReactNode = flow && (
    flow.type === "buy_new" ? (
      <BuyDecisionDialog
        context={flow.context}
        onClose={() => setFlow(null)}
        onExecuted={onExecuted}
      />
    ) : (
      <ManageHoldingModal
        holding={flow.holding}
        initialTxMode={flow.mode}
        initialAmount={flow.amount}
        context={<DecisionContextNote title={flow.title} />}
        onClose={() => setFlow(null)}
        onSuccess={onExecuted}
      />
    )
  );

  if (decisions.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-foreground">
          {suppressedDecisions.length > 0 ? "Nothing new worth making." : "No changes worth making."}
        </p>
        <p className="max-w-md text-xs leading-relaxed text-muted">
          {suppressedDecisions.length > 0
            ? "You've already considered the remaining candidate changes (listed below), and no different action measurably improves alignment with your policy right now. The engine keeps searching each build — including your watchlist for researched opportunities — rather than repeating what you declined."
            : alignment.confirmed
            ? "The book sits inside the limits you set. Every candidate change was simulated against your own policy and none measurably improved alignment with it — a concentration or income level you explicitly accepted is not second-guessed here. Doing nothing is the recommendation."
            : "Every candidate change was simulated against the assumed default policy and none measurably improved alignment with it. Doing nothing is the recommendation — and setting your own priorities on the Alignment panel may change what counts as worth doing."}
        </p>
        {suppressedList && <div className="w-full max-w-md text-left">{suppressedList}</div>}
        {/* "Do nothing" still deserves a next move — monitoring and exploration,
            never a manufactured trade. */}
        {onNavigate && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-1 text-[11px]">
            <button
              type="button"
              onClick={() => onNavigate("risk")}
              className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Stress-test the portfolio →
            </button>
            <button
              type="button"
              onClick={() => onNavigate("simulator")}
              className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Explore a hypothetical
            </button>
            <button
              type="button"
              onClick={() => onNavigate("intelligence")}
              className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              What am I missing?
            </button>
          </div>
        )}
      </Card>
    );
  }

  const top = decisions[0];
  const rest = decisions.slice(1);
  const topExecution = resolveDecisionExecution(top, holdings);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Whose rules these decisions serve ────────────────────────────────
          The single line that makes this a personalized decision engine rather
          than a generic optimizer sitting next to a personalized score. When
          the policy is still the assumed defaults, saying so (with the path to
          fix it) matters more than pretending the investor chose them. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
          alignment.confirmed ? "border-border/60 bg-surface/30" : "border-brand/30 bg-brand/[0.05]"
        }`}
      >
        <p className="text-[11px] leading-snug text-muted">
          {alignment.confirmed
            ? "Every decision below is measured against your own policy — a limit you set is respected, and a theme you turned off never generates one."
            : "These decisions are measured against assumed default priorities — not limits you chose."}
        </p>
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate("dashboard", "panel-alignment")}
            className="shrink-0 rounded-sm text-[11px] font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {alignment.confirmed ? "Review your policy →" : "Set your priorities →"}
          </button>
        )}
      </div>

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
        <p className="text-[11px] leading-snug text-brand/90">Driven by {top.policyNote}.</p>
        {top.themeTradeoff && (
          <p className="text-[11px] leading-snug text-warning">— {top.themeTradeoff}</p>
        )}
        <ImpactRow impact={top.recommendation.impact} />
        <DecisionActions decision={top} execution={topExecution} onLaunch={launch} onNavigate={onNavigate} onDismiss={dismiss} />
        <div className="rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <strong className="text-foreground">Cost of waiting: </strong>{top.opportunityCost.description}
        </div>
        <ExpectedPortfolioState decision={top} alignment={alignment} risk={risk} assetClassHhi={assetClassHhi} annualIncome={annualIncome} />
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
            <DecisionCardView
              key={d.recommendation.id}
              decision={d}
              alignment={alignment}
              risk={risk}
              assetClassHhi={assetClassHhi}
              annualIncome={annualIncome}
              holdings={holdings}
              onLaunch={launch}
              onNavigate={onNavigate}
              onDismiss={dismiss}
            />
          ))}
        </div>
      )}

      {suppressedList}

      <p className="px-1 text-[11px] leading-relaxed text-muted/70">
        Impact figures are simulated: each change is applied to a copy of the portfolio
        and re-scored by the same allocation, risk and alignment engines that produce the
        analytics tabs. Decision scores rank that same measured impact — they are not a
        separate estimate. {top.alternativesEvaluated} candidate modification
        {top.alternativesEvaluated === 1 ? " was" : "s were"} evaluated in total to build this list.
        Executing a decision records the trade in your tracked portfolio — it does not place
        an order at a broker.
      </p>

      {dialogs}
    </div>
  );
}
