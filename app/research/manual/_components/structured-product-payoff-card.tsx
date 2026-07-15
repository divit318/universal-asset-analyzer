"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatTile } from "@/app/_components/ui";
import { useChartTheme } from "@/app/_components/chart-theme";
import { formatPercent } from "@/lib/format";
import type { ManualAsset, StructuredProductType } from "@/lib/types";
import type { StructuredProductMetrics } from "@/lib/manual-asset-analysis";

const PRODUCT_TYPE_LABEL: Record<StructuredProductType, string> = {
  barrier_reverse_convertible: "Barrier Reverse Convertible",
  principal_protected_note: "Principal Protected Note",
  autocallable: "Autocallable",
  other: "Other",
};

export function StructuredProductPayoffCard({
  asset,
  metrics,
}: {
  asset: ManualAsset & { category: "structured_product" };
  metrics: StructuredProductMetrics;
}) {
  const ct = useChartTheme();
  const d = asset.details;
  const barrierBreached = metrics.distanceToBarrierPercent != null && metrics.distanceToBarrierPercent < 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Worst-of Level"
          value={metrics.worstOfLevelPercent != null ? `${metrics.worstOfLevelPercent.toFixed(1)}%` : "—"}
        />
        <StatTile
          label="Distance to Barrier"
          value={metrics.distanceToBarrierPercent != null ? `${metrics.distanceToBarrierPercent >= 0 ? "+" : ""}${metrics.distanceToBarrierPercent.toFixed(1)}pp` : "—"}
          tone={metrics.distanceToBarrierPercent != null ? (barrierBreached ? "negative" : metrics.distanceToBarrierPercent < 10 ? "warning" : "positive") : "default"}
        />
        <StatTile label="Years to Maturity" value={metrics.yearsToMaturity.toFixed(2)} />
        <StatTile label="Product Type" value={PRODUCT_TYPE_LABEL[d.productType]} />
      </div>

      {barrierBreached && (
        <p className="rounded-lg border border-negative/30 bg-negative/8 px-3 py-2 text-xs text-negative">
          The worst-performing underlying has breached the barrier — principal is no longer protected at current levels.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 p-4 text-xs sm:grid-cols-4">
        {Object.entries(metrics.currentLevelsPercent).map(([symbol, pct]) => (
          <div key={symbol}>
            <dt className="text-muted">{symbol}</dt>
            <dd className="mt-0.5 font-medium">{pct.toFixed(1)}% of initial</dd>
          </div>
        ))}
        {d.barrierPercent != null && (
          <div>
            <dt className="text-muted">Barrier</dt>
            <dd className="mt-0.5 font-medium">{d.barrierPercent}%</dd>
          </div>
        )}
        {d.couponRatePercent != null && (
          <div>
            <dt className="text-muted">Coupon Rate</dt>
            <dd className="mt-0.5 font-medium">{d.couponRatePercent}%/yr</dd>
          </div>
        )}
        {d.participationRatePercent != null && (
          <div>
            <dt className="text-muted">Participation Rate</dt>
            <dd className="mt-0.5 font-medium">{d.participationRatePercent}%</dd>
          </div>
        )}
        {d.principalProtectionPercent != null && (
          <div>
            <dt className="text-muted">Principal Protection</dt>
            <dd className="mt-0.5 font-medium">{d.principalProtectionPercent}%</dd>
          </div>
        )}
      </dl>

      {metrics.payoffScenarios ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="text-sm font-medium">Payoff at Maturity vs. Underlying Move</h3>
          <p className="mb-2 text-xs text-muted">Hypothetical scenarios — payoff as % of principal at maturity, at maturity date value ({d.maturityDate})</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={metrics.payoffScenarios.map((s) => ({ move: s.finalLevelPercent - 100, payoff: +s.payoffPercent.toFixed(1) }))}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid stroke={ct.grid} vertical={false} />
              <XAxis dataKey="move" stroke={ct.axis} tick={{ fontSize: 11 }} tickFormatter={(v) => formatPercent(v, 0)} />
              <YAxis stroke={ct.axis} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={ct.tooltip} formatter={(v) => [`${v}%`, "Payoff"]} labelFormatter={(v) => `Underlying move: ${formatPercent(Number(v), 0)}`} />
              <ReferenceLine y={100} stroke={ct.axis} strokeDasharray="4 3" />
              <Line type="monotone" dataKey="payoff" stroke={ct.brand} dot={{ r: 3 }} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-[11px] text-muted/70">
          Payoff scenarios aren&apos;t modeled for {PRODUCT_TYPE_LABEL[d.productType]} — autocallable/other structures depend on multi-date observation logic not implemented here.
        </p>
      )}
    </div>
  );
}
