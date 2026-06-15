import type { MomentumSignal, Recommendation, ScoreResult } from "@/lib/types";

const REC_STYLE: Record<Recommendation, string> = {
  STRONG_BUY: "text-positive border-positive/50 bg-positive/15",
  BUY: "text-positive border-positive/40 bg-positive/10",
  HOLD: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  SELL: "text-negative border-negative/40 bg-negative/10",
  STRONG_SELL: "text-negative border-negative/50 bg-negative/15",
};

const REC_LABEL: Record<Recommendation, string> = {
  STRONG_BUY: "STRONG BUY",
  BUY: "BUY",
  HOLD: "HOLD",
  SELL: "SELL",
  STRONG_SELL: "STRONG SELL",
};

const pct1 = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export function ScoreCard({
  score,
  momentum,
}: {
  score: ScoreResult;
  momentum?: MomentumSignal | null;
}) {
  const signalRows: [string, number | null, string][] = [
    ["Fundamentals", score.signals.fundamentals, "Valuation, quality, growth & balance sheet"],
    ["Analyst consensus", score.signals.analysts, "Ratings mix, price-target upside, revisions"],
    [
      "Price momentum",
      score.signals.momentum,
      momentum
        ? `Trend ${momentum.trend}, ${pct1(momentum.vsSma200)} vs 200d SMA`
        : "Technical trend vs moving averages",
    ],
  ];

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 border-border">
            <span className="text-2xl font-semibold leading-none">{score.composite}</span>
            <span className="text-[10px] text-muted">/ 100</span>
          </div>
          <div className="flex flex-col gap-1">
            <span
              className={`w-fit rounded-md border px-3 py-1 text-lg font-semibold ${REC_STYLE[score.recommendation]}`}
            >
              {REC_LABEL[score.recommendation]}
            </span>
            <span className="text-sm text-muted">{score.confidence}% confidence</span>
          </div>
        </div>
      </div>

      {/* Decision signals — the three independent inputs to the call. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {signalRows.map(([label, value, detail]) => (
          <div key={label} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
              <span className="font-mono text-sm">{value != null ? value : "n/a"}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
              <div
                className={`h-full rounded-full ${value == null ? "bg-border" : value >= 60 ? "bg-positive" : value >= 42 ? "bg-amber-400" : "bg-negative"}`}
                style={{ width: `${value ?? 0}%` }}
              />
            </div>
            <span className="text-[11px] leading-4 text-muted">{detail}</span>
          </div>
        ))}
      </div>

      {/* Fundamental factor breakdown. */}
      <div className="flex flex-col gap-4">
        {score.buckets.map((b) => (
          <div key={b.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{b.name}</span>
              <span className="font-mono text-muted">
                {b.points}/{b.max}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(b.points / b.max) * 100}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              {b.factors.map((f) => (
                <span key={f.label}>{f.detail === "n/a" ? `${f.label}: n/a` : f.detail}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm leading-6">
        {score.rationale}
      </p>
    </section>
  );
}
