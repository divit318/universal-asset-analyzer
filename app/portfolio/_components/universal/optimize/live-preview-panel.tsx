"use client";

import { Card, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { ImpactRow, StateRow } from "../impact-display";
import type { PreviewResponse } from "./use-preview";

/**
 * Live Portfolio Preview (Feature 3) — the sticky panel that shows the
 * currently-selected trades' simulated effect, without touching the real
 * portfolio. Pure display: the debounced fetch lives in usePreview(), shared
 * with the Warnings Panel so both read one request instead of two.
 *
 * "Expected Return" is deliberately not shown: this app has no forward
 * price-return forecast for any asset class (see lib/portfolio/engines/
 * decision.ts's same discipline) — showing one here would be exactly the
 * kind of fabricated precision the rest of the app goes out of its way to
 * avoid. What's shown is everything the engines actually measure.
 */
export function LivePreviewPanel({
  preview,
  loading,
  error,
  selectedCount,
}: {
  preview: PreviewResponse | null;
  loading: boolean;
  error: string | null;
  selectedCount: number;
}) {
  if (selectedCount === 0) return null;

  return (
    <Card className="sticky top-4 z-10 flex flex-col gap-3 border-brand/25 bg-surface/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-brand">
          Live preview — {selectedCount} trade{selectedCount === 1 ? "" : "s"} selected
        </span>
        {loading && <span className="text-[10px] text-muted/70">Simulating…</span>}
      </div>

      {error && <p className="text-xs text-negative">{error}</p>}

      {preview && (
        <>
          <ImpactRow impact={preview.impact} />

          <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-surface/40 px-3 py-1">
            <StateRow label="Portfolio health" before={preview.before.health.total} after={preview.after.health.total} decimals={0} />
            <StateRow
              label="Annualized volatility"
              before={preview.before.risk.annualizedVolatility}
              after={preview.after.risk.annualizedVolatility}
              suffix="%"
              higherIsBetter={false}
            />
            <StateRow label="Sharpe ratio" before={preview.before.risk.sharpeRatio} after={preview.after.risk.sharpeRatio} decimals={2} />
            <StateRow
              label="Max drawdown"
              before={preview.before.risk.maxDrawdown}
              after={preview.after.risk.maxDrawdown}
              suffix="%"
              higherIsBetter={false}
            />
            {/* Position HHI on BOTH sides — two evaluations of the same statistic,
                so this subtraction is sound. Labelled by its denominator per the
                rule in risk-lab.tsx: a bare "HHI" is ambiguous on a page that also
                shows asset-class HHI, and reads as a contradiction. */}
            <StateRow label="Position HHI" before={preview.before.risk.positionHhi} after={preview.after.risk.positionHhi} decimals={0} higherIsBetter={false} />
            <StateRow
              label="Illiquid share"
              before={preview.before.risk.illiquidPct}
              after={preview.after.risk.illiquidPct}
              suffix="%"
              higherIsBetter={false}
            />
            <StateRow
              label="Income yield"
              before={preview.before.totalValue > 0 ? (preview.before.annualIncome / preview.before.totalValue) * 100 : null}
              after={preview.after.totalValue > 0 ? (preview.after.annualIncome / preview.after.totalValue) * 100 : null}
              suffix="%"
              decimals={2}
            />
          </div>

          {preview.skippedHoldingIds.length > 0 && (
            <Badge variant="warning">
              {preview.skippedHoldingIds.length} selected trade{preview.skippedHoldingIds.length === 1 ? "" : "s"} could not be simulated
            </Badge>
          )}

          <p className="text-[10px] leading-relaxed text-muted/60">
            This app does not forecast price returns for any asset class, so no expected-return
            number is shown — only what the engines actually measure. Net portfolio value change:{" "}
            <span className="font-mono font-semibold text-foreground">
              {formatCurrency(Math.abs(preview.after.totalValue - preview.before.totalValue))}
            </span>
          </p>
        </>
      )}
    </Card>
  );
}
