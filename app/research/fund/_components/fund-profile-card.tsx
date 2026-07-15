import type { FundProfileData } from "@/lib/types";
import { formatCompact } from "@/lib/format";

export function FundProfileCard({ fund }: { fund: FundProfileData }) {
  const rows: [string, string][] = [
    ["Category", fund.category ?? "—"],
    ["Family", fund.family ?? "—"],
    ["Legal type", fund.legalType ?? "—"],
    ["Expense ratio", fund.expenseRatio != null ? `${(fund.expenseRatio * 100).toFixed(2)}%` : "—"],
    ["Portfolio turnover", fund.turnoverPercent != null ? `${(fund.turnoverPercent * 100).toFixed(0)}%` : "—"],
    ["Total net assets", fund.totalNetAssets != null ? `$${formatCompact(fund.totalNetAssets)}` : "—"],
  ];

  const allocation = fund.assetAllocation;
  const hasAllocation = [allocation.stock, allocation.bond, allocation.cash, allocation.other].some((v) => v != null);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Fund Profile</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 bg-surface p-3">
            <dt className="text-caption uppercase tracking-wide text-muted">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      {hasAllocation ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <span className="text-caption uppercase tracking-wide text-muted">Asset Allocation</span>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
            {allocation.stock != null && allocation.stock > 0 ? (
              <div className="h-full bg-brand" style={{ width: `${allocation.stock}%` }} title={`Stock ${allocation.stock.toFixed(0)}%`} />
            ) : null}
            {allocation.bond != null && allocation.bond > 0 ? (
              <div className="h-full bg-positive" style={{ width: `${allocation.bond}%` }} title={`Bond ${allocation.bond.toFixed(0)}%`} />
            ) : null}
            {allocation.cash != null && allocation.cash > 0 ? (
              <div className="h-full bg-warning" style={{ width: `${allocation.cash}%` }} title={`Cash ${allocation.cash.toFixed(0)}%`} />
            ) : null}
            {allocation.other != null && allocation.other > 0 ? (
              <div className="h-full bg-muted" style={{ width: `${allocation.other}%` }} title={`Other ${allocation.other.toFixed(0)}%`} />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
            {allocation.stock != null ? <span>Stock {allocation.stock.toFixed(0)}%</span> : null}
            {allocation.bond != null ? <span>Bond {allocation.bond.toFixed(0)}%</span> : null}
            {allocation.cash != null ? <span>Cash {allocation.cash.toFixed(0)}%</span> : null}
            {allocation.other != null ? <span>Other {allocation.other.toFixed(0)}%</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
