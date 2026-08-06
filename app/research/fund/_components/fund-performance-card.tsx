import type { FundProfileData } from "@/lib/types";

const pct1 = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const pp1 = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp`);

export function FundPerformanceCard({ fund }: { fund: FundProfileData }) {
  const rows: [string, string][] = [
    ["YTD", pct1(fund.trailingReturns.ytd)],
    ["1 year", pct1(fund.trailingReturns.oneYear)],
    ["3 year", pct1(fund.trailingReturns.threeYear)],
    ["5 year", pct1(fund.trailingReturns.fiveYear)],
  ];

  // Yahoo carries no Morningstar category baseline for Indian mutual funds
  // (and some closed-end funds) — say so, rather than titling absolute
  // returns "vs Category" and rendering two dashes.
  const hasCategoryBaseline =
    fund.categoryRelativeReturns.oneYear != null || fund.categoryRelativeReturns.threeYear != null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">{hasCategoryBaseline ? "Performance vs Category" : "Performance"}</h3>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 bg-surface p-3">
            <dt className="text-caption uppercase tracking-wide text-muted">{label}</dt>
            <dd className="font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      {hasCategoryBaseline ? (
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span>1yr vs category: <span className="font-mono text-foreground">{pp1(fund.categoryRelativeReturns.oneYear)}</span></span>
          <span>3yr vs category: <span className="font-mono text-foreground">{pp1(fund.categoryRelativeReturns.threeYear)}</span></span>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Category comparison unavailable — our data source carries no category benchmark for this fund. Returns above are absolute.
        </p>
      )}

      {fund.risk ? (
        <div className="flex flex-wrap gap-4 border-t border-border/60 pt-3 text-xs text-muted">
          <span>Beta: <span className="font-mono text-foreground">{fund.risk.beta?.toFixed(2) ?? "—"}</span></span>
          <span>Alpha: <span className="font-mono text-foreground">{fund.risk.alpha?.toFixed(1) ?? "—"}</span></span>
          <span>Sharpe: <span className="font-mono text-foreground">{fund.risk.sharpeRatio?.toFixed(2) ?? "—"}</span></span>
          <span>Std dev: <span className="font-mono text-foreground">{fund.risk.stdDev?.toFixed(2) ?? "—"}</span></span>
        </div>
      ) : null}
    </section>
  );
}
