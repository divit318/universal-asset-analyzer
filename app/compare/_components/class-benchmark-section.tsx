import type { ClassCompareEntry } from "@/lib/compare/types";

const pctSigned = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * ETF benchmark tracking — "is the fund actually doing its job." Fund
 * 1-Year Return is real, already-computed data. Benchmark Index identity,
 * Tracking Difference and Tracking Error all need a per-fund benchmark index
 * feed no free provider exposes (see lib/assets/etf.ts `trackingError`) — so
 * rather than fabricate them, this section is honest about the gap while
 * still surfacing the one real number that speaks to the same question.
 */
export function BenchmarkSection({ entries, colors }: { entries: ClassCompareEntry[]; colors: readonly string[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="bg-surface-2 px-4 py-3">
        <span className="text-sm font-semibold">Benchmark</span>
        <span className="ml-2 text-caption text-muted">is the fund tracking what it&apos;s supposed to?</span>
      </div>
      <div className="border-t border-border bg-surface p-4">
        <div className="flex flex-wrap gap-4">
          {entries.map((e, i) => {
            const ret = e.metrics.oneYearReturn;
            return (
              <div key={e.symbol} className="flex flex-col gap-0.5">
                <span className="font-mono text-xs font-bold" style={{ color: colors[i % colors.length] }}>{e.symbol}</span>
                <span className="text-label text-muted">Fund 1Y Return</span>
                <span className={`font-mono text-sm font-semibold ${ret == null ? "text-muted" : ret >= 0 ? "text-positive" : "text-negative"}`}>
                  {ret == null ? "—" : pctSigned(ret)}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-5 text-muted">
          <span className="font-semibold text-foreground/80">Benchmark Index, Tracking Difference, and Tracking Error aren&apos;t shown: </span>
          they need a per-fund benchmark index feed (Morningstar/FactSet, or the issuer&apos;s own index data) that isn&apos;t wired up yet — see the <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">trackingError</code> metric in <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">lib/assets/etf.ts</code>. Fund 1-Year Return above is real.
        </p>
      </div>
    </div>
  );
}
