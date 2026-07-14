import type { ScoreResult } from "@/lib/types";

/**
 * Pulls the Risk-Adjusted Return + Drawdown Risk bucket factors out of an
 * already-computed score (lib/crypto-scoring.ts, lib/commodity-scoring.ts)
 * into a scannable grid, rather than re-deriving the same numbers a second
 * time. Works for any scorer that names its risk buckets these two things —
 * currently crypto and commodities, which share the same market-data-only
 * risk shape (volatility/drawdown/Sharpe, no fundamentals).
 */
export function RiskProfileCard({ score }: { score: ScoreResult }) {
  const riskBuckets = score.buckets.filter((b) => b.name === "Risk-Adjusted Return" || b.name === "Drawdown Risk");
  const factors = riskBuckets.flatMap((b) => b.factors).filter((f) => f.detail && f.detail !== "n/a" && f.detail !== "");

  if (factors.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
        Risk profile unavailable — insufficient price history.
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Risk Profile</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {factors.map((f) => (
          <div key={f.label} className="flex flex-col gap-1 bg-surface p-3">
            <dt className="text-caption uppercase tracking-wide text-muted">{f.label}</dt>
            <dd className="font-mono text-sm">{f.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
