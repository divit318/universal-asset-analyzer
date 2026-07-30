"use client";

import { useState } from "react";
import { Card, Button, Input, Field, Badge } from "@/app/_components/ui";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/app/_components/toast";
import { OBJECTIVES, type Objective, type ObjectiveConfig } from "@/lib/portfolio/engines/optimize";
import { PORTFOLIO_ASSET_CLASSES, PORTFOLIO_CLASS_LABEL, type PortfolioAssetClass } from "@/lib/portfolio/model/types";
import { useCashPreview } from "./cash/use-cash-preview";
import { useCashSelection } from "./cash/use-cash-selection";
import { RecommendationRow } from "./cash/recommendation-row";
import { MarginalBenefitChart } from "./cash/marginal-benefit-chart";
import { AnalysisPanel } from "./cash/analysis-panel";
import { CashConfirmationModal } from "./cash/cash-confirmation-modal";
import { SnapshotHistory } from "./optimize/snapshot-history";
import { deployBlockedReason } from "./cash/deploy-guard";
import type { CashPlanResponse } from "./cash/types";

/**
 * The Capital Allocation Engine — "How should I deploy new cash?"
 *
 * Pick an objective (the same strategic-target table the Optimize tab uses —
 * "Income" means the same thing in both places), enter an amount, and a
 * fine-grained greedy simulation finds where each dollar does the most good,
 * across the entire investable universe: existing holdings, every candidate
 * exposure, and cash itself. This engine only ever ADDS — it never sells what
 * you already hold; that is the Optimize tab's job.
 *
 * Every number below — the ranking, the alternatives considered, the
 * diminishing-returns curve, the reasons a candidate was rejected — is read
 * directly off the same simulation that built the plan, never asserted.
 */
export function CashPanel({ onExecuted }: { onExecuted?: () => void }) {
  const [amountInput, setAmountInput] = useState("");
  const [objective, setObjective] = useState<Objective>("maximize_sharpe");
  const [customTarget, setCustomTarget] = useState<Partial<Record<PortfolioAssetClass, number>>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snapshotRefreshSignal, setSnapshotRefreshSignal] = useState(0);
  const toast = useToast();

  const amount = Number(amountInput);
  const validAmount = Number.isFinite(amount) && amount > 0;
  const customTargetSum = Object.values(customTarget).reduce((s, v) => s + (v ?? 0), 0);
  const customTargetReady = objective !== "target_allocation" || customTargetSum > 0;

  const { plan, loading, error } = useCashPreview(
    validAmount && customTargetReady ? amount : 0,
    objective,
    objective === "target_allocation" ? customTarget : undefined,
  );

  const selection = useCashSelection(plan?.items ?? []);
  const objectiveEntries = Object.entries(OBJECTIVES) as [Objective, ObjectiveConfig][];

  /** The exact plan object already written to the ledger — see deployBlockedReason(). */
  const [executedPlan, setExecutedPlan] = useState<CashPlanResponse | null>(null);
  const blocked = deployBlockedReason(plan, executedPlan, loading);
  const alreadyExecuted = blocked === "already-executed";

  async function handleConfirmedExecute() {
    if (!plan || blocked) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/portfolio/allocate-cash/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: plan.cashAmount,
          objective,
          customTarget: objective === "target_allocation" ? customTarget : undefined,
          selected: selection.selectedItems.map((i) => i.symbol),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to deploy cash");

      // Before onExecuted(), so the plan is marked spent even if the parent's
      // refresh throws — the guard must not depend on a refetch succeeding.
      setExecutedPlan(plan);
      setShowConfirm(false);
      setSnapshotRefreshSignal((n) => n + 1);
      onExecuted?.();

      const snapshotId = json.snapshotId as string;
      toast(
        `${formatCurrency(plan.cashAmount)} deployed — ${json.executedCount} position${json.executedCount === 1 ? "" : "s"} bought.`,
        "success",
        {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                const undoRes = await fetch("/api/portfolio/optimize/undo", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ snapshotId }),
                });
                if (!undoRes.ok) throw new Error("Undo failed");
                // The write has been reverted, so this plan is no longer spent
                // and may legitimately be deployed again. Leaving it flagged as
                // executed would be a different lie than the one this guard fixes.
                setExecutedPlan(null);
                setSnapshotRefreshSignal((n) => n + 1);
                onExecuted?.();
                toast("Deployment reverted.", "info");
              } catch {
                toast("Undo failed — the deployment is still applied.", "error");
              }
            },
          },
        },
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to deploy cash", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Allocate new cash</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Pick an objective and an amount — the optimizer finds where the next dollar does the most good
            across your entire portfolio, every candidate exposure, and cash itself.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Objective</h4>
          <div className="flex flex-wrap gap-1.5">
            {objectiveEntries.map(([id, cfg]) => {
              const active = id === objective;
              return (
                <button
                  key={id}
                  onClick={() => setObjective(id)}
                  title={cfg.description}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? "border-brand bg-brand/10 font-semibold text-foreground"
                      : "border-border text-muted hover:border-brand/40 hover:text-foreground"
                  }`}
                >
                  <span aria-hidden>{cfg.icon}</span>
                  {cfg.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed text-muted/70">{OBJECTIVES[objective].description}</p>
        </div>

        {objective === "target_allocation" && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface/40 p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Custom target allocation
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PORTFOLIO_ASSET_CLASSES.map((cls) => (
                <label key={cls} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-muted">{PORTFOLIO_CLASS_LABEL[cls]}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={customTarget[cls] ?? ""}
                    onChange={(e) =>
                      setCustomTarget((prev) => ({ ...prev, [cls]: e.target.value === "" ? undefined : Number(e.target.value) }))
                    }
                    className="w-16 rounded border border-border bg-surface-2 px-1.5 py-1 text-right font-mono text-xs outline-none focus:border-brand"
                  />
                </label>
              ))}
            </div>
            {customTargetSum === 0 && (
              <p className="text-[11px] text-warning">Enter at least one target percentage.</p>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Amount">
              <Input
                type="number"
                step="any"
                min="0"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="50000"
              />
            </Field>
          </div>
        </div>

        {error && <p className="text-xs text-negative">{error}</p>}
      </Card>

      {loading && !plan && <Card className="p-8 text-center text-xs text-muted">Simulating…</Card>}

      {plan && (
        <>
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-xs leading-relaxed text-muted">{plan.summary}</p>
          </Card>

          {plan.items.length > 0 && (
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Recommended allocations
                </h3>
                <span className="text-[11px] text-muted/70">
                  {plan.items.length} {plan.items.length === 1 ? "position" : "positions"} · ranked by measured impact
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {plan.items.map((item) => (
                  <RecommendationRow
                    key={item.symbol ?? item.name}
                    item={item}
                    selected={item.symbol ? selection.isSelected(item.symbol) : false}
                    onToggle={() => item.symbol && selection.toggle(item.symbol)}
                  />
                ))}
              </ul>
            </Card>
          )}

          {/* Holding cash is a legitimate outcome, rendered with a real reason —
              never a bare "Hold as Cash" label. */}
          {plan.heldAsCash > 0 && (
            <Card className="flex items-center justify-between gap-3 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-foreground">Held as cash</span>
                <p className="text-[11px] leading-relaxed text-muted">{plan.heldAsCashSentence}</p>
              </div>
              <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-foreground">
                {formatCurrency(plan.heldAsCash)}
              </span>
            </Card>
          )}

          <MarginalBenefitChart points={plan.marginalBenefit} />

          {plan.rejectedOpportunities.length > 0 && (
            <CollapsibleSection
              title="Opportunities not selected"
              subtitle={`${plan.rejectedOpportunities.length} candidate${plan.rejectedOpportunities.length === 1 ? "" : "s"} considered and rejected — why`}
            >
              <ul className="flex flex-col gap-1.5">
                {plan.rejectedOpportunities.map((r) => (
                  <li
                    key={r.symbol ?? r.subject}
                    className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-surface/30 p-2.5 text-[11px]"
                  >
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {r.symbol && <span className="font-mono">{r.symbol}</span>}
                      <span>{r.subject}</span>
                      <Badge variant="neutral">{r.reasonLabel}</Badge>
                    </span>
                    <span className="text-muted">{r.sentence}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          )}

          <CollapsibleSection title="Why this plan" subtitle="The optimizer's full reasoning">
            <div className="flex flex-col gap-2 text-[11px] leading-relaxed text-muted">
              <p><span className="font-semibold text-foreground">Why: </span>{plan.why.why}</p>
              <p><span className="font-semibold text-foreground">Why now: </span>{plan.why.whyNow}</p>
              <p><span className="font-semibold text-foreground">Why this amount: </span>{plan.why.whyThisAmount}</p>
              <p><span className="font-semibold text-foreground">Why not an alternative: </span>{plan.why.whyNotAlternative}</p>
              <p><span className="font-semibold text-foreground">Why not nothing: </span>{plan.why.whyNotNothing}</p>
            </div>
          </CollapsibleSection>

          <AnalysisPanel plan={plan} />

          <SnapshotHistory refreshSignal={snapshotRefreshSignal} />

          {/* The footer states what this plan IS, and the button is live only
              while the plan is both current and unspent. It used to keep reading
              "$X of $X deployed" beside an enabled button after the deployment
              had already been written — the one piece of UI that could double-
              spend the ledger on a single stray click. */}
          <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-foreground">
                {alreadyExecuted
                  ? `Deployed — ${formatCurrency(selection.totalSelected)} across ${selection.selectedItems.length} position${selection.selectedItems.length === 1 ? "" : "s"}`
                  : `${selection.selectedItems.length} position${selection.selectedItems.length === 1 ? "" : "s"} selected`}
              </span>
              <span className="text-[11px] text-muted">
                {alreadyExecuted
                  ? "This plan has been executed. Change the amount or objective to plan another deployment."
                  : blocked === "recomputing"
                    ? "Recomputing for the new inputs — the plan below is the previous one."
                    : `${formatCurrency(selection.totalSelected)} of ${formatCurrency(plan.cashAmount)} to deploy`}
              </span>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowConfirm(true)}
              disabled={blocked != null}
            >
              {alreadyExecuted ? "Deployed" : blocked === "recomputing" ? "Recomputing…" : "Deploy Cash"}
            </Button>
          </div>

          <CashConfirmationModal
            open={showConfirm}
            onClose={() => setShowConfirm(false)}
            onConfirm={handleConfirmedExecute}
            plan={plan}
            selectedItems={selection.selectedItems}
            totalSelected={selection.totalSelected}
            submitting={submitting}
          />
        </>
      )}
    </div>
  );
}
