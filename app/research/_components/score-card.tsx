import type { MomentumSignal, Recommendation, ScoreResult } from "@/lib/types";

const REC_STYLE: Record<Recommendation, string> = {
  STRONG_BUY:  "text-positive  border-positive/50  bg-positive/15",
  BUY:         "text-positive  border-positive/35  bg-positive/10",
  HOLD:        "text-amber-400 border-amber-400/40 bg-amber-400/10",
  SELL:        "text-negative  border-negative/35  bg-negative/10",
  STRONG_SELL: "text-negative  border-negative/50  bg-negative/15",
};

const REC_LABEL: Record<Recommendation, string> = {
  STRONG_BUY:  "Strong Buy",
  BUY:         "Buy",
  HOLD:        "Hold",
  SELL:        "Sell",
  STRONG_SELL: "Strong Sell",
};

/** Border color for the composite score ring */
const RING_COLOR: Record<Recommendation, string> = {
  STRONG_BUY:  "border-positive",
  BUY:         "border-positive/60",
  HOLD:        "border-amber-400/70",
  SELL:        "border-negative/60",
  STRONG_SELL: "border-negative",
};

/** Track bar color based on a 0-100 value */
function barColor(v: number | null) {
  if (v == null) return "bg-border";
  if (v >= 60)   return "bg-positive";
  if (v >= 42)   return "bg-amber-400";
  return "bg-negative";
}

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
    ["Fundamentals",     score.signals.fundamentals, "Valuation, quality, growth & balance sheet"],
    ["Analyst consensus",score.signals.analysts,     "Ratings mix, price-target upside, revisions"],
    [
      "Price momentum",
      score.signals.momentum,
      momentum
        ? `Trend ${momentum.trend} · ${pct1(momentum.vsSma200)} vs 200d SMA`
        : "Technical trend vs moving averages",
    ],
  ];

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6">
      {/* Header row: ring + label + confidence */}
      <div className="flex flex-wrap items-center gap-5">
        {/* Composite score ring */}
        <div
          className={`relative flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center rounded-full border-2 ${RING_COLOR[score.recommendation]}`}
        >
          <span className="text-[1.6rem] font-bold leading-none tabular-nums">
            {score.composite}
          </span>
          <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-muted">
            / 100
          </span>
        </div>

        {/* Recommendation + confidence */}
        <div className="flex flex-col gap-2">
          <span
            className={`inline-flex w-fit items-center rounded-lg border px-3 py-1 text-sm font-semibold tracking-wide ${REC_STYLE[score.recommendation]}`}
          >
            {REC_LABEL[score.recommendation]}
          </span>
          <div className="flex items-center gap-2">
            <div className="h-1 w-20 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent/60"
                style={{ width: `${score.confidence}%` }}
              />
            </div>
            <span className="text-xs text-muted">{score.confidence}% confidence</span>
          </div>
        </div>
      </div>

      {/* Three independent signal scores */}
      <div className="grid gap-3 sm:grid-cols-3">
        {signalRows.map(([label, value, detail]) => (
          <div
            key={label}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                {label}
              </span>
              <span className="font-mono text-sm font-medium tabular-nums">
                {value != null ? value : "—"}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor(value)}`}
                style={{ width: `${value ?? 0}%` }}
              />
            </div>
            <span className="text-[11px] leading-4 text-muted/80">{detail}</span>
          </div>
        ))}
      </div>

      {/* Fundamental factor buckets */}
      <div className="flex flex-col gap-3.5">
        {score.buckets.map((b) => {
          const pct = (b.points / b.max) * 100;
          return (
            <div key={b.name} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{b.name}</span>
                <span className="font-mono text-xs text-muted tabular-nums">
                  {b.points}<span className="text-muted/50">/{b.max}</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${pct >= 60 ? "bg-accent" : pct >= 42 ? "bg-amber-400" : "bg-negative"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {b.factors.some((f) => f.detail !== "n/a") ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {b.factors.map((f) =>
                    f.detail !== "n/a" ? (
                      <span key={f.label} className="text-[11px] text-muted">
                        {f.detail}
                      </span>
                    ) : null,
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Rationale */}
      <div className="rounded-lg border border-border/60 bg-surface-2 px-4 py-3 text-sm leading-6 text-muted">
        {score.rationale}
      </div>
    </section>
  );
}
