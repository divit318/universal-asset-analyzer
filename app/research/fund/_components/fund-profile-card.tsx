import type { FundProfileData } from "@/lib/types";
import { formatCompactCurrency, formatDate } from "@/lib/format";
import { Reveal } from "@/app/_components/reveal";
import { SegmentedBar } from "@/app/_components/value-bar";

const ALLOCATION_SLICES = [
  { key: "stock", label: "Stock", className: "bg-brand" },
  { key: "bond", label: "Bond", className: "bg-positive" },
  { key: "cash", label: "Cash", className: "bg-warning" },
  { key: "other", label: "Other", className: "bg-muted" },
] as const;

/**
 * `perShareClass`: Morningstar reports a mutual fund's net assets per share
 * class (the plan/option being viewed), not per scheme — the label must say
 * so or the figure reads ~10x low against scheme-level AUM on AMFI/Groww.
 */
export function FundProfileCard({ fund, perShareClass = false }: { fund: FundProfileData; perShareClass?: boolean }) {
  const rows: [string, string][] = [
    ["Category", fund.category ?? "—"],
    ["Family", fund.family ?? "—"],
    // Net assets travel in the fund's own reporting currency (₹ for Indian
    // funds) — a hardcoded "$" would mislabel them by the FX rate.
    [perShareClass ? "Net assets (this plan)" : "Total net assets", formatCompactCurrency(fund.totalNetAssets, fund.currency)],
    // TER recovered from AMFI's official monthly table is badged, because it
    // has a different provenance from the rest of this (Yahoo-sourced) card.
    [
      "Expense ratio",
      fund.expenseRatio != null
        ? `${(fund.expenseRatio * 100).toFixed(2)}%${fund.expenseRatioSource === "amfi" ? " · AMFI" : ""}`
        : "—",
    ],
    ["Portfolio turnover", fund.turnoverPercent != null ? `${(fund.turnoverPercent * 100).toFixed(0)}%` : "—"],
    ["Morningstar rating", fund.morningstarRating != null ? "★".repeat(fund.morningstarRating) : "—"],
    ["Inception", fund.inceptionDate != null ? formatDate(fund.inceptionDate) : "—"],
    ["Legal type", fund.legalType ?? "—"],
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
