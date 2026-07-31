"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ThematicReport, TierCompany } from "@/lib/thematic-engine";
import { Badge, Card, DataTable, type DataTableColumn } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { formatPercent, toneClass } from "@/lib/format";
import { Empty, IMPORTANCE_VARIANT, QualityCell, TierBadge } from "./shared";

export function CompaniesTab({ report }: { report: ThematicReport }) {
  const companies = report.tierCompanies;
  const [filterTier, setFilterTier] = useState<number | null>(null);
  const [filterIndia, setFilterIndia] = useState(false);

  const tiers = useMemo(() => [...new Set(companies.map((c) => c.tier))].sort((a, b) => a - b), [companies]);
  // The India filter is only offered when the loaded universe actually contains
  // Indian listings. It was a permanent checkbox over a 100% US universe, so
  // ticking it always returned zero companies and looked like a bug.
  const hasIndia = useMemo(() => companies.some((c) => c.isIndia), [companies]);

  const filtered = useMemo(
    () => companies.filter((c) => (filterTier == null || c.tier === filterTier) && (!filterIndia || c.isIndia)),
    [companies, filterTier, filterIndia],
  );

  if (companies.length === 0) {
    return (
      <Empty>
        {report.integrity.universeTotal === 0
          ? "The screener universe is empty, so there is nothing to map this theme onto. Load the screener once to populate cached fundamentals, then re-run."
          : report.integrity.universeShortlisted === 0
            ? `None of the ${report.integrity.universeTotal} companies in the screener universe plausibly touch this theme — the coverage gap is real, not a failure. Try a broader theme, or one closer to listed industries.`
            : `${report.integrity.universeShortlisted} companies were in scope but the mapping stage couldn't place any of them into a tier. Re-run to try again.`}
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={filterTier == null} onClick={() => setFilterTier(null)}>
          All tiers
        </FilterChip>
        {tiers.map((t) => (
          <FilterChip key={t} active={filterTier === t} onClick={() => setFilterTier(filterTier === t ? null : t)}>
            Tier {t}
          </FilterChip>
        ))}
        {hasIndia && (
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={filterIndia} onChange={(e) => setFilterIndia(e.target.checked)} className="accent-brand" />
            India only
          </label>
        )}
        <span className="ml-auto text-xs text-muted tabular-nums">
          {filtered.length} of {companies.length} companies
        </span>
      </div>

      {tiers.map((t, i) => {
        const rows = filtered.filter((c) => c.tier === t);
        if (rows.length === 0) return null;
        return (
          <Reveal key={t} index={i}>
            <Card padding="none">
              <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-4 py-2.5">
                <TierBadge tier={t} />
                <span className="text-sm font-semibold">{rows[0].tierLabel}</span>
                <span className="text-xs text-muted tabular-nums">{rows.length}</span>
              </div>
              <CompanyTable companies={rows} />
            </Card>
          </Reveal>
        );
      })}

      {filtered.length === 0 && <Empty>No company matches the current filters.</Empty>}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
        active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:border-border-strong hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** Sortable ranking of the mapping's own vocabulary — "critical first". */
const IMPORTANCE_RANK = { critical: 4, high: 3, medium: 2, low: 1 } as const;

/**
 * The one company table — used by both the hero shortlist and the tier groups.
 *
 * Built on the shared DataTable rather than a hand-rolled `<table>`: an
 * analyst's first move on a companies list is to rank it by quality or by
 * leverage, and the private table offered six numeric columns and no way to
 * sort any of them (while Screener and Watchlist could). DataTable also
 * brings aria-sort, null-values-sink ordering, and the header tooltip that
 * used to be a touch-inaccessible `title` attribute.
 */
export function CompanyTable({ companies, compact = false }: { companies: TierCompany[]; compact?: boolean }) {
  const columns: DataTableColumn<TierCompany>[] = [
    {
      key: "symbol",
      label: "Symbol",
      firstSortDir: "asc",
      sortValue: (c) => c.symbol,
      render: (c) => (
        <Link
          href={`/stocks/${encodeURIComponent(c.symbol)}`}
          className="group inline-flex items-center gap-1 font-mono text-xs font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {c.symbol}
          <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
        </Link>
      ),
    },
    {
      key: "name",
      label: "Company",
      firstSortDir: "asc",
      sortValue: (c) => c.name,
      render: (c) => <span className="block max-w-[11rem] truncate text-muted">{c.name}</span>,
    },
    compact
      ? {
          key: "tier",
          label: "Tier",
          firstSortDir: "asc" as const,
          sortValue: (c: TierCompany) => c.tier,
          render: (c: TierCompany) => <TierBadge tier={c.tier} />,
        }
      : {
          key: "sector",
          label: "Sector",
          firstSortDir: "asc" as const,
          sortValue: (c: TierCompany) => c.sector,
          render: (c: TierCompany) => <span className="text-xs text-muted">{c.sector ?? "—"}</span>,
        },
    {
      key: "role",
      label: "Role",
      help: "Strategic importance the mapping stage assigned — critical sorts first",
      sortValue: (c) => IMPORTANCE_RANK[c.strategicImportance] ?? 0,
      render: (c) => <Badge variant={IMPORTANCE_VARIANT[c.strategicImportance]}>{c.strategicImportance}</Badge>,
    },
    {
      key: "moat",
      label: "Moat",
      firstSortDir: "asc",
      sortValue: (c) => c.moatType,
      render: (c) => <span className="text-xs capitalize text-muted">{c.moatType}</span>,
    },
    {
      key: "quality",
      label: "Quality",
      help: "Composite quality score from the screener (0–100)",
      numeric: true,
      sortValue: (c) => c.qualityScore,
      render: (c) => <QualityCell score={c.qualityScore} />,
    },
    {
      key: "roic",
      label: "ROIC",
      numeric: true,
      sortValue: (c) => c.roic,
      render: (c) => <span className="font-mono text-xs tabular-nums">{c.roic != null ? `${c.roic.toFixed(1)}%` : "—"}</span>,
    },
    ...(!compact
      ? [
          {
            key: "margin",
            label: "Margin",
            help: "Gross margin",
            numeric: true,
            sortValue: (c: TierCompany) => c.grossMargin,
            render: (c: TierCompany) => (
              <span className="font-mono text-xs tabular-nums">{c.grossMargin != null ? `${c.grossMargin.toFixed(1)}%` : "—"}</span>
            ),
          },
        ]
      : []),
    {
      key: "revGrowth",
      label: "Rev growth",
      help: "Revenue growth, year over year",
      numeric: true,
      sortValue: (c) => c.revenueGrowthYoY,
      render: (c) => (
        <span className={`font-mono text-xs tabular-nums ${toneClass(c.revenueGrowthYoY)}`}>
          {formatPercent(c.revenueGrowthYoY, 1)}
        </span>
      ),
    },
    {
      key: "debtToEquity",
      label: "D/E",
      help: "Debt to equity — lower is safer; sorting puts the most levered first",
      numeric: true,
      sortValue: (c) => c.debtToEquity,
      render: (c) => (
        <span className="font-mono text-xs tabular-nums text-muted">
          {c.debtToEquity != null ? c.debtToEquity.toFixed(2) : "—"}
        </span>
      ),
    },
    {
      key: "rationale",
      label: "Why it belongs here",
      render: (c) => <span className="block max-w-[16rem] text-xs leading-relaxed text-muted">{c.relevanceRationale || "—"}</span>,
    },
  ];

  return (
    <DataTable
      rows={companies}
      columns={columns}
      rowKey={(c) => c.symbol}
      label="Companies mapped to this theme"
      // The tier groups already order rows by the report's own ranking; a
      // caller-side sort would fight it, so sorting starts unsorted.
      showDensityToggle={false}
    />
  );
}
