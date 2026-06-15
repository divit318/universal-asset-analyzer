import type { AnalystConsensus } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";

export function AnalystCard({ analyst }: { analyst: AnalystConsensus }) {
  const dist = [
    { label: "Strong buy", value: analyst.strongBuy, color: "#22c55e" },
    { label: "Buy", value: analyst.buy, color: "#4ade80" },
    { label: "Hold", value: analyst.hold, color: "#fbbf24" },
    { label: "Sell", value: analyst.sell, color: "#f87171" },
    { label: "Strong sell", value: analyst.strongSell, color: "#ef4444" },
  ];
  const total = dist.reduce((s, d) => s + d.value, 0);
  const up = analyst.epsRevisionsUp30d ?? 0;
  const down = analyst.epsRevisionsDown30d ?? 0;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Analyst consensus</h3>
        {analyst.recommendationKey ? (
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs uppercase text-muted">
            {analyst.recommendationKey.replace("_", " ")}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-xs text-muted">Price target</div>
          <div className="text-2xl font-semibold">{formatCurrency(analyst.targetMean)}</div>
          <div className="text-xs text-muted">
            {formatCurrency(analyst.targetLow)} – {formatCurrency(analyst.targetHigh)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Upside</div>
          <div
            className={`text-2xl font-semibold ${(analyst.upsidePercent ?? 0) >= 0 ? "text-positive" : "text-negative"}`}
          >
            {formatPercent(analyst.upsidePercent)}
          </div>
          <div className="text-xs text-muted">{analyst.numberOfOpinions ?? "—"} analysts</div>
        </div>
      </div>

      {total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full">
            {dist.map((d) =>
              d.value > 0 ? (
                <div
                  key={d.label}
                  style={{ width: `${(d.value / total) * 100}%`, background: d.color }}
                  title={`${d.label}: ${d.value}`}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted">
            {dist.map((d) => (
              <span key={d.label}>
                {d.label} {d.value}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-3 text-sm">
        <div>
          <span className="text-muted">EPS revisions (30d): </span>
          <span className="text-positive">↑{up}</span>{" "}
          <span className="text-negative">↓{down}</span>
        </div>
        {analyst.epsSurprises.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Surprises:</span>
            {analyst.epsSurprises.slice(0, 4).map((s, i) => (
              <span
                key={i}
                className={`font-mono text-xs ${s >= 0 ? "text-positive" : "text-negative"}`}
              >
                {s >= 0 ? "+" : ""}
                {(s * 100).toFixed(1)}%
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
