import { CHART_SERIES } from "@/app/_components/chart-theme";
import { MiniRadar, MiniPerformanceChart, MiniRankedVerdict, MiniMetricTable } from "./mini-charts";

const FAKE_TICKERS = [
  { label: "A", price: "412.85", change: "+1.8%", score: 82 },
  { label: "B", price: "128.40", change: "+0.6%", score: 67 },
  { label: "C", price: "94.12", change: "−0.4%", score: 58 },
];

/**
 * A blurred, non-interactive mockup of the real comparison view (header
 * cards, ranked verdict, radar + performance chart, metric table) shown in
 * place of a blank empty state. Purely illustrative — no data is fetched —
 * so the page feels alive before the user has added anything. Not
 * `pointer-events: none`-heavy chrome, just a quiet preview behind a caption.
 */
export function LivePreview() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface">
      <div aria-hidden className="pointer-events-none select-none p-5 opacity-[0.55] blur-[3px] grayscale-[10%]">
        <div className="grid grid-cols-3 gap-3">
          {FAKE_TICKERS.map((t, i) => (
            <div key={t.label} className="rounded-lg border border-border/70 bg-surface-2 p-3">
              <span className="font-mono text-sm font-bold" style={{ color: CHART_SERIES[i] }}>
                {t.label}
              </span>
              <div className="mt-1 font-mono text-base font-semibold">{t.price}</div>
              <div className={`text-[10px] font-mono ${t.change.startsWith("−") ? "text-negative" : "text-positive"}`}>
                {t.change}
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full" style={{ width: `${t.score}%`, backgroundColor: CHART_SERIES[i] }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-brand/20 bg-brand/5 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-brand">Ranked verdict</p>
          <MiniRankedVerdict />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/70 bg-surface-2 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/70">Performance</p>
            <MiniPerformanceChart width={140} height={64} />
          </div>
          <div className="flex flex-col items-center rounded-lg border border-border/70 bg-surface-2 p-3">
            <p className="mb-1 self-start text-[10px] font-semibold uppercase tracking-widest text-muted/70">Score radar</p>
            <MiniRadar size={96} />
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-border/70 bg-surface-2 p-3">
          <MiniMetricTable />
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-transparent via-surface/50 to-surface/85">
        <p className="max-w-xs px-4 text-center text-sm text-muted">
          This is what your comparison will look like.
          <span className="mt-0.5 block text-xs text-muted/70">Add two tickers to bring it to life.</span>
        </p>
      </div>
    </div>
  );
}
