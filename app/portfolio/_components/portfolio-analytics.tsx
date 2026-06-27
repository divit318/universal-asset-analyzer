"use client";

import { useEffect, useState } from "react";
import type { PortfolioAnalytics } from "@/app/api/portfolio/analytics/route";
import { formatCurrency, formatPercent } from "@/lib/format";

function SectorBar({ sector, weight, value }: { sector: string; weight: number; value: number }) {
  const color =
    weight >= 40 ? "bg-negative" :
    weight >= 25 ? "bg-yellow-500" :
    "bg-accent";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{sector}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs text-muted">{formatCurrency(value)}</span>
          <span className="w-10 text-right font-mono text-xs font-semibold">{weight.toFixed(1)}%</span>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(weight, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function PortfolioAnalyticsSection({ positionCount }: { positionCount: number }) {
  const [data, setData] = useState<PortfolioAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (positionCount === 0) { setLoading(false); return; }
    setLoading(true);
    fetch("/api/portfolio/analytics")
      .then((r) => r.json())
      .then((d: PortfolioAnalytics) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Analytics failed"))
      .finally(() => setLoading(false));
  }, [positionCount]);

  if (positionCount === 0) return null;
  if (loading) return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <p className="text-sm text-muted">Loading analytics…</p>
    </div>
  );
  if (error || !data) return null;

  const spyLabel = data.spyReturn != null
    ? `SPY 1-yr: ${data.spyReturn >= 0 ? "+" : ""}${data.spyReturn.toFixed(1)}%`
    : null;
  const portfolioReturnColor = data.totalReturn >= 0 ? "text-positive" : "text-negative";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Portfolio Analytics</h2>

      {/* Return vs benchmark */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <StatCard label="Total invested" value={formatCurrency(data.totalCost)} />
        <StatCard label="Current value" value={formatCurrency(data.totalValue)} />
        <StatCard
          label="Total return"
          value={`${data.totalReturn >= 0 ? "+" : ""}${data.totalReturn.toFixed(1)}%`}
          sub={formatCurrency(data.totalReturnDollar)}
          valueClass={portfolioReturnColor}
        />
        {spyLabel ? (
          <StatCard
            label="vs SPY (1yr)"
            value={(() => {
              const diff = data.totalReturn - (data.spyReturn ?? 0);
              return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
            })()}
            sub={spyLabel}
            valueClass={data.totalReturn >= (data.spyReturn ?? 0) ? "text-positive" : "text-negative"}
          />
        ) : <StatCard label="Positions" value={String(data.positionCount)} />}
      </div>

      {/* Concentration warnings */}
      {data.concentrationWarnings.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">Concentration Warnings</p>
          <ul className="flex flex-col gap-1">
            {data.concentrationWarnings.map((w) => (
              <li key={w.label} className="text-sm text-muted">⚠ {w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sector allocation */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-4 text-sm font-semibold">Sector Allocation</h3>
          <div className="flex flex-col gap-3">
            {data.sectorAllocation.map((s) => (
              <SectorBar key={s.sector} sector={s.sector} weight={s.weight} value={s.value} />
            ))}
          </div>
          {data.sectorAllocation.some((s) => s.weight >= 40) ? (
            <p className="mt-3 text-xs text-negative">Red bars indicate sector concentration above 40%.</p>
          ) : null}
        </div>

        {/* Position weights */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-4 text-sm font-semibold">Position Weights</h3>
          <div className="flex flex-col gap-2">
            {data.positionWeights.map((p) => (
              <div key={p.symbol} className="flex items-center gap-3">
                <span className="w-14 shrink-0 font-mono text-xs font-semibold text-accent">{p.symbol}</span>
                <div className="min-w-0 flex-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${p.weight >= 25 ? "bg-negative" : "bg-accent"} transition-all`}
                      style={{ width: `${Math.min(p.weight, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-xs font-semibold">
                  {p.weight.toFixed(1)}%
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-xs text-muted">
                  {formatCurrency(p.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-4">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`font-mono text-lg font-semibold ${valueClass ?? ""}`}>{value}</dd>
      {sub ? <dd className="font-mono text-xs text-muted">{sub}</dd> : null}
    </div>
  );
}
