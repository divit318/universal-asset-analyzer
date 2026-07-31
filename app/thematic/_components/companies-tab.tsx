"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ThematicReport, TierCompany } from "@/lib/thematic-engine";
import { Badge, Card } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { Empty, IMPORTANCE_VARIANT, QualityCell, TierBadge, changeTone, pct } from "./shared";

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

/** The one company table — used by both the hero shortlist and the tier groups. */
export function CompanyTable({ companies, compact = false }: { companies: TierCompany[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-label uppercase tracking-widest text-muted/70">
            <th className="px-4 py-2 font-semibold">Symbol</th>
            <th className="px-4 py-2 font-semibold">Company</th>
            {compact && <th className="px-4 py-2 font-semibold">Tier</th>}
            {!compact && <th className="px-4 py-2 font-semibold">Sector</th>}
            <th className="px-4 py-2 font-semibold">Role</th>
            <th className="px-4 py-2 font-semibold">Moat</th>
            <th className="px-4 py-2 text-right font-semibold" title="Composite quality score from the screener (0–100)">Quality</th>
            <th className="px-4 py-2 text-right font-semibold">ROIC</th>
            {!compact && <th className="px-4 py-2 text-right font-semibold">Margin</th>}
            <th className="px-4 py-2 text-right font-semibold">Rev growth</th>
            <th className="px-4 py-2 text-right font-semibold">D/E</th>
            <th className="px-4 py-2 font-semibold">Why it belongs here</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {companies.map((c) => (
            <tr key={c.symbol} className="transition-colors hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <Link
                  href={`/stocks/${encodeURIComponent(c.symbol)}`}
                  className="group inline-flex items-center gap-1 font-mono text-xs font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {c.symbol}
                  <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
                </Link>
              </td>
              <td className="max-w-[11rem] truncate px-4 py-2.5 text-muted">{c.name}</td>
              {compact && <td className="px-4 py-2.5"><TierBadge tier={c.tier} /></td>}
              {!compact && <td className="px-4 py-2.5 text-xs text-muted">{c.sector ?? "—"}</td>}
              <td className="px-4 py-2.5">
                <Badge variant={IMPORTANCE_VARIANT[c.strategicImportance]}>{c.strategicImportance}</Badge>
              </td>
              <td className="px-4 py-2.5 text-xs capitalize text-muted">{c.moatType}</td>
              <td className="px-4 py-2.5 text-right"><QualityCell score={c.qualityScore} /></td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                {c.roic != null ? `${c.roic.toFixed(1)}%` : "—"}
              </td>
              {!compact && (
                <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                  {c.grossMargin != null ? `${c.grossMargin.toFixed(1)}%` : "—"}
                </td>
              )}
              <td className={`px-4 py-2.5 text-right font-mono text-xs tabular-nums ${changeTone(c.revenueGrowthYoY)}`}>
                {pct(c.revenueGrowthYoY)}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
                {c.debtToEquity != null ? c.debtToEquity.toFixed(2) : "—"}
              </td>
              <td className="max-w-[16rem] px-4 py-2.5 text-xs leading-relaxed text-muted">{c.relevanceRationale || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
