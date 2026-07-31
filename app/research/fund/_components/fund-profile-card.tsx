import type { FundProfileData } from "@/lib/types";
import { formatCompact } from "@/lib/format";
import { Reveal } from "@/app/_components/reveal";
import { SegmentedBar } from "@/app/_components/value-bar";

const ALLOCATION_SLICES = [
  { key: "stock", label: "Stock", className: "bg-brand" },
  { key: "bond", label: "Bond", className: "bg-positive" },
  { key: "cash", label: "Cash", className: "bg-warning" },
  { key: "other", label: "Other", className: "bg-muted" },
] as const;

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
    <section className="card-lift flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Fund Profile</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {rows.map(([label, value], i) => (
          <Reveal key={label} index={i} className="flex flex-col gap-1 bg-surface p-3">
            <dt className="text-caption uppercase tracking-wide text-muted">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </Reveal>
        ))}
      </dl>

      {hasAllocation ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <span className="text-caption uppercase tracking-wide text-muted">Asset Allocation</span>
          <SegmentedBar
            segments={ALLOCATION_SLICES.map((s) => ({
              key: s.key,
              pct: allocation[s.key] ?? 0,
              className: s.className,
              title: `${s.label} ${(allocation[s.key] ?? 0).toFixed(0)}%`,
            }))}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
            {ALLOCATION_SLICES.map((s) =>
              allocation[s.key] != null ? (
                <span key={s.key}>{s.label} {allocation[s.key]!.toFixed(0)}%</span>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
