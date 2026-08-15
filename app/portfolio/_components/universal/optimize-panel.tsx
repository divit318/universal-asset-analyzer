"use client";

import { Fragment, useCallback, useRef, useState } from "react";
import { Card, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { useToast } from "@/app/_components/toast";
import type { OptimizationResult, Objective, ObjectiveConfig, TargetWeight } from "@/lib/portfolio/engines/optimize";
import type { ImpactEstimate } from "@/lib/portfolio/engines/simulate";
import { ObjectivePicker } from "./objective-picker";
import { useTradeSelection } from "./optimize/use-trade-selection";
import { SelectionToolbar } from "./optimize/selection-toolbar";
import { usePreview } from "./optimize/use-preview";
import { LivePreviewPanel } from "./optimize/live-preview-panel";
import { PortfolioDiffChart } from "./optimize/portfolio-diff-chart";
import { WarningsPanel } from "./optimize/warnings-panel";
import { FundingSummary } from "./optimize/funding-summary";
import { ImplementationBar } from "./optimize/implementation-bar";
import { ConfirmationModal } from "./optimize/confirmation-modal";
import { SnapshotHistory } from "./optimize/snapshot-history";
import { TradeDetailsDrawer } from "./optimize/trade-details-drawer";

/**
 * The Optimization Engine, in two stages — because that is how the problem is shaped.
 *
 *  1. ASSET ALLOCATION: what fraction belongs in each class. This is where the real
 *     risk/return decision is made, and it is the decision the old optimizer could not
 *     express at all — it was equal-weight ± a score premium, capped at 18% per name,
 *     with no concept of an asset class.
 *  2. WITHIN-CLASS SIZING: distribute each class's budget across its holdings by
 *     CONFIDENCE-WEIGHTED score, so a holding we know little about drifts toward
 *     neutral weight rather than being sized on a score we don't trust.
 *
 * Trades are now SELECTABLE (Feature 1): every trade row carries a checkbox, and the
 * whole row toggles it. Selection state and bulk actions live in useTradeSelection();
 * per-trade measured impact (for the evidence-based "Select Highest Impact" etc.
 * buttons) is fetched separately from /api/portfolio/optimize/trade-impacts — never
 * folded into the main report, which loads on every tab regardless of Optimize.
 */

export function OptimizePanel({
  optimization,
  objective,
  onObjectiveChange,
  objectives,
  loading,
  totalPortfolioValue,
  baseCurrency,
  atEquilibrium,
  onExecuted,
}: {
  optimization: OptimizationResult;
  objective: Objective;
  onObjectiveChange: (o: Objective) => void;
  objectives: Record<Objective, ObjectiveConfig>;
  loading: boolean;
  totalPortfolioValue: number;
  baseCurrency: string;
  /** True when BOTH engines agree nothing is left to do (no trades AND no recommendations). */
  atEquilibrium: boolean;
  /** Called after a successful implementation so the parent can refresh the report + thesis. */
  onExecuted: () => void;
}) {
  const entries = Object.entries(objectives) as [Objective, ObjectiveConfig][];
  const toast = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snapshotRefreshSignal, setSnapshotRefreshSignal] = useState(0);
  const [detailsTrade, setDetailsTrade] = useState<TargetWeight | null>(null);
  const submittingRef = useRef(false); // belt-and-suspenders against a double click racing the setState below

  const impactsFetcher = useCallback(
    async (signal: AbortSignal) => {
      const res = await fetch(`/api/portfolio/optimize/trade-impacts?objective=${objective}`, { signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load trade impacts");
      return new Map(Object.entries(json.impacts as Record<string, ImpactEstimate>));
    },
    [objective],
  );
  const { data: impacts, refresh: refreshImpacts } = useDataset<Map<string, ImpactEstimate>>("optimizeTradeImpacts", objective, impactsFetcher);

  const selection = useTradeSelection(
    optimization.trades,
    totalPortfolioValue,
    impacts ?? null,
    optimization.funding.cashAvailable,
  );
  const { preview, loading: previewLoading, error: previewError } = usePreview(selection.selectedTrades, objective);

  async function handleConfirmedExecute() {
    if (submittingRef.current) return; // rapid double-click / double-submit guard
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch("/api/portfolio/optimize/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective,
          trades: selection.selectedTrades.map((t) => ({ holdingId: t.holdingId, partialPct: t.partialPct })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to implement trades");

      setShowConfirm(false);
      selection.clearAll();
      onExecuted();
      refreshImpacts();
      setSnapshotRefreshSignal((n) => n + 1);

      // The executor never fabricates negative cash: if the batch bought more
      // than its sells plus the cash balance could cover, it drew what existed and
      // the rest landed as tracked value out of nothing. Rare, and impossible to
      // notice later — so it is said out loud, not folded into a success message.
      const unfunded = typeof json.unfunded === "number" ? json.unfunded : 0;
      if (unfunded > 0) {
        toast(
          `${formatCurrency(unfunded, baseCurrency)} of these buys could not be funded from sells or cash. Portfolio value now overstates the book by that amount — undo, or record a deposit.`,
          "error",
        );
      }

      const snapshotId = json.snapshotId as string;
      toast(`${json.executedCount} trade${json.executedCount === 1 ? "" : "s"} implemented successfully.`, "success", {
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
              onExecuted();
              refreshImpacts();
              setSnapshotRefreshSignal((n) => n + 1);
              toast("Trades reverted.", "info");
            } catch {
              toast("Undo failed — the trades are still applied.", "error");
            }
          },
        },
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to implement trades", "error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Objective ── */}
      <ObjectivePicker
        entries={entries.filter(([id]) => id !== "target_allocation")}
        active={objective}
        onChange={onObjectiveChange}
        description={objectives[objective].description}
        disabled={loading}
      />

      {/* ── Warnings: what the plan CANNOT do ─────────────────────────────────
          An optimizer that hands you a plan you physically cannot execute (sell 30%
          of a house) is worse than one that admits the constraint. Illiquid holdings
          are frozen at their current weight and the rest is allocated around them. */}
      {optimization.warnings.length > 0 && (
        <Card className="flex flex-col gap-1.5 border-warning/25 bg-warning/[0.04] p-4">
          {optimization.warnings.map((w, i) => (
            <p key={i} className="text-[11px] leading-relaxed text-muted">— {w}</p>
          ))}
        </Card>
      )}

      {/* ── Stage 1: asset-class targets ── */}
      <Card className="flex flex-col gap-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Target asset allocation
        </h3>

        <ul className="flex flex-col gap-2">
          {optimization.classTargets.map((t) => {
            // ANY nonzero change, not `> 1`. `t.delta` is already rounded to a
            // tenth by the engine, so `!== 0` means "there is a real change at the
            // resolution being displayed" — while the old 1pp threshold silently
            // dropped the annotation on Forex (0.1% → 0.0%, −0.1) and on Cash
            // (13.5% → 13.0%, −0.5), leaving rows that visibly changed with no
            // delta beside them, identical in treatment to rows that genuinely did
            // not change at all (Alternatives, Private Markets, Real Estate).
            const moving = t.delta !== 0;
            return (
              <li key={t.assetClass} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-foreground">{t.label}</span>
                  <span className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-muted">{t.currentWeight.toFixed(1)}%</span>
                    <span className="text-muted/50">→</span>
                    <span className="font-semibold text-foreground">{t.targetWeight.toFixed(1)}%</span>
                    {moving && (
                      <span className={t.delta > 0 ? "text-positive" : "text-negative"}>
                        ({t.delta > 0 ? "+" : ""}{t.delta.toFixed(1)})
                      </span>
                    )}
                  </span>
                </div>

                {/* Current (solid) vs target (outlined) on one track. */}
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-brand/40"
                    style={{ width: `${Math.min(t.currentWeight, 100)}%` }}
                  />
                  <div
                    className="absolute inset-y-0 w-0.5 rounded-full bg-foreground"
                    style={{ left: `${Math.min(t.targetWeight, 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ── Stage 2: the trades ── */}
      {optimization.trades.length > 0 ? (
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Rebalancing trades
            </h3>
            <span className="text-[11px] text-muted/70">
              {optimization.trades.length} {optimization.trades.length === 1 ? "trade" : "trades"}
            </span>
          </div>

          {/* Funding FIRST, before the selection tools: whether the plan pays for
              itself is the question a reader has about the whole list, and it is
              not answerable by adding up the Amount column (the sub-materiality
              rows and the cash residual are deliberately not in it). */}
          <FundingSummary funding={optimization.funding} baseCurrency={baseCurrency} />

          <SelectionToolbar state={selection} totalTrades={optimization.trades.length} impactsLoaded={impacts != null} />

          <LivePreviewPanel
            preview={preview}
            loading={previewLoading}
            error={previewError}
            selectedCount={selection.selected.size}
          />

          {preview && (
            <WarningsPanel
              summary={selection.summary}
              impact={preview.impact}
              estimatedRealizedGainLoss={preview.estimatedRealizedGainLoss}
            />
          )}

          <PortfolioDiffChart preview={preview} />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted/70">
                  <th className="w-8 py-2 pr-1" />
                  <th className="py-2 text-left font-semibold">Holding</th>
                  <th className="px-2 py-2 text-left font-semibold">Action</th>
                  <th className="px-2 py-2 text-right font-semibold">Weight</th>
                  <th className="px-2 py-2 text-right font-semibold">Amount</th>
                  <th className="py-2 pl-2 text-left font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {optimization.trades.map((t) => {
                  const checked = selection.isSelected(t.holdingId);
                  const pct = selection.pctOf(t.holdingId);
                  return (
                    // The key belongs on the element the map RETURNS. A bare
                    // <> is keyless no matter what its children carry, so React
                    // saw this whole list as unkeyed and could not match rows
                    // across renders — which is what the reconciler needs to
                    // keep the checkbox/slider state attached to the right trade.
                    <Fragment key={t.holdingId}>
                      <tr
                        role="row"
                        tabIndex={0}
                        onClick={() => selection.toggle(t.holdingId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selection.toggle(t.holdingId);
                          }
                        }}
                        className={`cursor-pointer border-b border-border/50 outline-none transition-colors hover:bg-surface-2/40 focus-visible:bg-surface-2/60 ${
                          checked ? "bg-brand/[0.06]" : ""
                        }`}
                      >
                        <td className="py-2 pr-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => selection.toggle(t.holdingId)}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-brand"
                            aria-label={`Select trade: ${t.action} ${t.symbol ?? t.name}`}
                          />
                        </td>
                        <td className="py-2 text-xs font-medium text-foreground">
                          {t.symbol ?? t.name}
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant={t.action === "BUY" ? "positive" : "negative"}>{t.action}</Badge>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-muted">
                          {t.currentWeight.toFixed(1)}% → {t.targetWeight.toFixed(1)}%
                        </td>
                        <td className={`px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums ${
                          t.dollarDelta > 0 ? "text-positive" : "text-negative"
                        }`}>
                          {t.dollarDelta > 0 ? "+" : "−"}{formatCurrency(Math.abs(t.dollarDelta) * (checked ? pct / 100 : 1))}
                          {checked && pct < 100 && <span className="ml-1 text-[10px] text-muted/70">({pct}%)</span>}
                        </td>
                        <td className="py-2 pl-2 text-[11px] leading-snug text-muted">
                          <div className="flex items-start justify-between gap-2">
                            <span>{t.reason}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDetailsTrade(t); }}
                              className="shrink-0 whitespace-nowrap text-brand hover:underline"
                            >
                              Details
                            </button>
                          </div>
                        </td>
                      </tr>
                      {checked && (
                        <tr className="border-b border-border/50 bg-surface/20">
                          <td />
                          <td colSpan={5} className="px-2 py-2">
                            <div className="flex items-center gap-3">
                              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted/70">
                                Partial implementation
                              </span>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={5}
                                value={pct}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => selection.setPct(t.holdingId, Number(e.target.value))}
                                className="h-1 flex-1 accent-brand"
                                aria-label={`Percent of ${t.symbol ?? t.name} trade to implement`}
                              />
                              <span className="w-10 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                                {pct}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Measured, by simulating the whole plan through the real engines. */}
          <div className="flex flex-wrap gap-3 border-t border-border pt-3 text-[11px]">
            <span className="text-muted/70">Full plan impact:</span>
            {/* Null when either side is unscorable — omitted rather than shown as 0. */}
            {optimization.impact.alignmentDelta != null && (
              <span>
                <span className="text-muted/70">Alignment: </span>
                <span className={`font-mono font-semibold tabular-nums ${
                  optimization.impact.alignmentDelta >= 0 ? "text-positive" : "text-negative"
                }`}>
                  {optimization.impact.alignmentDelta >= 0 ? "+" : ""}
                  {optimization.impact.alignmentDelta.toFixed(1)} pts
                </span>
              </span>
            )}
            {optimization.impact.riskDelta != null && (
              <span>
                <span className="text-muted/70">Volatility: </span>
                <span className={`font-mono font-semibold tabular-nums ${
                  optimization.impact.riskDelta <= 0 ? "text-positive" : "text-negative"
                }`}>
                  {optimization.impact.riskDelta >= 0 ? "+" : ""}
                  {optimization.impact.riskDelta.toFixed(1)}pp
                </span>
              </span>
            )}
            {optimization.impact.incomeDelta !== 0 && (
              <span>
                <span className="text-muted/70">Income: </span>
                <span className={`font-mono font-semibold tabular-nums ${
                  optimization.impact.incomeDelta > 0 ? "text-positive" : "text-negative"
                }`}>
                  {optimization.impact.incomeDelta > 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(optimization.impact.incomeDelta))}/yr
                </span>
              </span>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-foreground">
            {atEquilibrium ? "At equilibrium — nothing left to do." : "Already at target."}
          </p>
          <p className="mt-1 text-xs text-muted">
            {atEquilibrium
              ? `The portfolio matches the ${objectives[objective].label} allocation and the Decision Center has no material improvement to suggest. Re-optimizing produces no further trades.`
              : `The portfolio matches the ${objectives[objective].label} allocation within tolerance.`}
          </p>
        </Card>
      )}

      <SnapshotHistory refreshSignal={snapshotRefreshSignal} />

      <ImplementationBar selection={selection} onImplement={() => setShowConfirm(true)} />

      <ConfirmationModal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmedExecute}
        selection={selection}
        preview={preview}
        submitting={submitting}
      />

      <TradeDetailsDrawer
        trade={detailsTrade}
        impact={detailsTrade ? impacts?.get(detailsTrade.holdingId) ?? null : null}
        open={detailsTrade != null}
        onClose={() => setDetailsTrade(null)}
      />
    </div>
  );
}
