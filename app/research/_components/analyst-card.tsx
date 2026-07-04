import type { AnalystConsensus } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";

/* Use CSS custom properties so the chart palette stays in one place */
const DIST = [
  { label: "Strong buy",  color: "var(--positive)"  },
  { label: "Buy",         color: "color-mix(in srgb, var(--positive) 60%, transparent)" },
  { label: "Hold",        color: "var(--warning)"   },
  { label: "Sell",        color: "color-mix(in srgb, var(--negative) 60%, transparent)" },
  { label: "Strong sell", color: "var(--negative)"  },
];

export function AnalystCard({ analyst }: { analyst: AnalystConsensus }) {
  const counts = [analyst.strongBuy, analyst.buy, analyst.hold, analyst.sell, analyst.strongSell];
  const total  = counts.reduce((s, v) => s + v, 0);
  const up     = analyst.epsRevisionsUp30d   ?? 0;
  const down   = analyst.epsRevisionsDown30d ?? 0;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Analyst Consensus</h3>
        {analyst.recommendationKey ? (
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted">
            {analyst.recommendationKey.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>

      {/* Price target + upside */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs uppercase tracking-wide text-muted">Mean target</span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatCurrency(analyst.targetMean)}
          </span>
          <span className="text-xs text-muted">
            {formatCurrency(analyst.targetLow)} – {formatCurrency(analyst.targetHigh)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs uppercase tracking-wide text-muted">Upside</span>
          <span
            className={`text-2xl font-semibold tabular-nums ${
              (analyst.upsidePercent ?? 0) >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {formatPercent(analyst.upsidePercent)}
          </span>
          <span className="text-xs text-muted">
            {analyst.numberOfOpinions ?? "—"} analyst{analyst.numberOfOpinions !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Rating distribution bar */}
      {total > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
            {DIST.map((d, i) =>
              counts[i] > 0 ? (
                <div
                  key={d.label}
                  style={{ width: `${(counts[i] / total) * 100}%`, background: d.color }}
                  title={`${d.label}: ${counts[i]}`}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
            {DIST.map((d, i) =>
              counts[i] > 0 ? (
                <span key={d.label} className="flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: d.color }}
                  />
                  {d.label} · {counts[i]}
                </span>
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      {/* EPS revisions + surprises */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted">EPS revisions (30d)</span>
          <span className="font-mono text-positive">↑{up}</span>
          <span className="font-mono text-negative">↓{down}</span>
        </div>
        {analyst.epsSurprises.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-muted">Surprises</span>
            <div className="flex gap-1.5">
              {analyst.epsSurprises.slice(0, 4).map((s, i) => (
                <span
                  key={i}
                  className={`rounded border px-1.5 py-0.5 font-mono text-xs tabular-nums ${
                    s >= 0
                      ? "border-positive/30 bg-positive/10 text-positive"
                      : "border-negative/30 bg-negative/10 text-negative"
                  }`}
                >
                  {s >= 0 ? "+" : ""}{(s * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
