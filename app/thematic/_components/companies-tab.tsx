"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { ThematicReport, TierCompany, UniverseCandidate, UniversePreview } from "@/lib/thematic-engine";
import { Badge, Card, DataTable, DataTableAction, type DataTableColumn } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { useToast } from "@/app/_components/toast";
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
      <div className="flex flex-col gap-4">
        <Empty>
          {report.integrity.universeTotal === 0
            ? "The screener universe is empty, so there is nothing to map this theme onto. Load the screener once to populate cached fundamentals, then re-run."
            : report.integrity.universeShortlisted === 0
              ? `None of the ${report.integrity.universeTotal} companies in the screener universe plausibly touch this theme — the coverage gap is real, not a failure. Try a broader theme, or one closer to listed industries.`
              : `${report.integrity.universeShortlisted} companies were in scope but the mapping stage couldn't place any of them into a tier. Re-run to try again.`}
        </Empty>
        {/* Precisely when the mapping came back empty, the eligible universe is
            the evidence an analyst needs to judge whether the gap is real. */}
        <UniverseSection preview={report.universePreview} universeTotal={report.integrity.universeTotal} />
      </div>
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
        const tierPE = median(rows.map((c) => c.forwardPE));
        const themePE = median(companies.map((c) => c.forwardPE));
        return (
          <Reveal key={t} index={i}>
            <Card padding="none">
              <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-4 py-2.5">
                <TierBadge tier={t} />
                <span className="text-sm font-semibold">{rows[0].tierLabel}</span>
                <span className="text-xs text-muted tabular-nums">{rows.length}</span>
                {/* The valuation read at a glance: is this tier the rich or the
                    cheap end of the theme? (PR-5) */}
                {tierPE != null && (
                  <span className="ml-auto text-xs text-muted tabular-nums">
                    median fwd P/E {tierPE.toFixed(1)}×
                    {themePE != null && ` · theme ${themePE.toFixed(1)}×`}
                  </span>
                )}
              </div>
              <CompanyTable companies={rows} theme={report.theme} />
            </Card>
          </Reveal>
        );
      })}

      {filtered.length === 0 && <Empty>No company matches the current filters.</Empty>}

      <UniverseSection preview={report.universePreview} universeTotal={report.integrity.universeTotal} />
    </div>
  );
}

/** Wording + tone for a candidate's fate — shared by the table and the legend. */
const CANDIDATE_STATUS = {
  prompt: { label: "shown to model", variant: "brand", rank: 2 },
  shortlist: { label: "shortlisted", variant: "neutral", rank: 1 },
  cut: { label: "cut by cap", variant: "warning", rank: 0 },
} as const;

/**
 * Constituent transparency: the eligible universe, not just the survivors.
 *
 * The first professional question about any theme list is "what was the
 * eligible universe and why these names". This section answers it: every
 * candidate the theme filter matched, the evidence for its inclusion (matched
 * industry hints / theme words and the relevance score), and what happened to
 * it — shown to the model, kept below the prompt cut, or discarded by the
 * shortlist cap. TH-01's silent truncation is now a visible, checkable
 * decision.
 */
function UniverseSection({ preview, universeTotal }: { preview: UniversePreview | undefined; universeTotal: number }) {
  const [open, setOpen] = useState(false);
  // Reports written before the preview existed (schema v2) can still arrive
  // via sessionStorage restores mid-deploy; degrade to nothing, not a crash.
  if (!preview || preview.candidates.length === 0) return null;

  const summary =
    `${preview.matched} of ${universeTotal} screener names matched · ` +
    `${preview.shownToModel} shown to the model` +
    (preview.shortlisted > preview.shownToModel ? ` · ${preview.shortlisted - preview.shownToModel} shortlisted below the prompt cut` : "") +
    (preview.cutTotal > 0 ? ` · ${preview.cutTotal} cut by the shortlist cap` : "");

  return (
    <Card padding="none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left outline-none transition-colors hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={2} />
        <span className="text-sm font-semibold">Universe</span>
        <span className="min-w-0 truncate text-xs text-muted tabular-nums">{summary}</span>
      </button>
      {open && (
        <div className="border-t border-border">
          <p className="px-4 pt-3 text-xs leading-relaxed text-muted">
            Every screener name the theme filter matched, with the evidence for its inclusion. The model can only map
            companies it was shown — anything cut by the cap was never analysed.
            {preview.cutTotal > preview.candidates.length - preview.shortlisted
              ? ` Showing the ${preview.candidates.length - preview.shortlisted} highest-ranked of the ${preview.cutTotal} cut names.`
              : ""}
          </p>
          <UniverseTable candidates={preview.candidates} />
        </div>
      )}
    </Card>
  );
}

function UniverseTable({ candidates }: { candidates: UniverseCandidate[] }) {
  const columns: DataTableColumn<UniverseCandidate>[] = [
    {
      key: "symbol",
      label: "Symbol",
      firstSortDir: "asc",
      sortValue: (c) => c.symbol,
      render: (c) => <span className="font-mono text-xs font-semibold">{c.symbol}</span>,
    },
    {
      key: "name",
      label: "Company",
      firstSortDir: "asc",
      sortValue: (c) => c.name,
      render: (c) => <span className="block max-w-[13rem] truncate text-muted">{c.name}</span>,
    },
    {
      key: "industry",
      label: "Industry",
      firstSortDir: "asc",
      sortValue: (c) => c.industry,
      render: (c) => <span className="block max-w-[12rem] truncate text-xs text-muted">{c.industry ?? "—"}</span>,
    },
    {
      key: "matched",
      label: "Matched on",
      help: "The lexicon industry hints and theme words this row matched",
      render: (c) => (
        <span className="block max-w-[14rem] truncate text-xs text-muted">{c.matched.join(", ") || "—"}</span>
      ),
    },
    {
      key: "score",
      label: "Relevance",
      help: "Deterministic relevance score from the shortlist — higher ranks earlier",
      numeric: true,
      sortValue: (c) => c.score,
      render: (c) => <span className="font-mono text-xs tabular-nums">{c.score}</span>,
    },
    {
      key: "status",
      label: "Outcome",
      help: "Shown to the model, shortlisted below the prompt cut, or cut by the shortlist cap",
      sortValue: (c) => CANDIDATE_STATUS[c.status]?.rank ?? 0,
      render: (c) => {
        const s = CANDIDATE_STATUS[c.status] ?? CANDIDATE_STATUS.cut;
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
  ];

  return (
    <DataTable
      rows={candidates}
      columns={columns}
      rowKey={(c) => c.symbol}
      label="Eligible universe for this theme"
      showDensityToggle={false}
    />
  );
}

/** Median over the non-null values; null when fewer than 2 carry data. */
function median(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length < 2) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
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
 * "Add to watchlist" with real provenance.
 *
 * lib/idea-source.ts has declared the "thematic" IdeaSource (detail: "the
 * theme and tier") since the Pipeline shipped, and nothing ever emitted it —
 * the classic shipped-but-unwired case. The watchlist API already accepts
 * source/sourceDetail, so acting on this research costs one POST; the
 * Pipeline board and Ledger then show where the idea came from for free.
 */
function useAddToWatchlist(theme: string) {
  const toast = useToast();
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const add = useCallback(
    async (c: TierCompany) => {
      try {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: c.symbol,
            name: c.name,
            source: "thematic",
            sourceDetail: `${theme} — T${c.tier} ${c.tierLabel}`.slice(0, 120),
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? `Request failed (${res.status})`);
        }
        setAdded((prev) => new Set(prev).add(c.symbol));
        toast(`${c.symbol} added to the watchlist`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't add to the watchlist", "error");
      }
    },
    [theme, toast],
  );
  return { add, added };
}

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
export function CompanyTable({
  companies,
  compact = false,
  theme,
}: {
  companies: TierCompany[];
  compact?: boolean;
  /** When provided, each row offers "Add to watchlist" with `${theme} — tier` provenance. */
  theme?: string;
}) {
  const { add, added } = useAddToWatchlist(theme ?? "");
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
    // Valuation + crowding (PR-5): a right theme and a rich theme used to
    // look identical — the engine discarded valuation entirely.
    {
      key: "forwardPE",
      label: "Fwd P/E",
      help: "Forward price/earnings from the fundamentals cache — the theme's valuation read",
      numeric: true,
      sortValue: (c) => c.forwardPE ?? null,
      render: (c) => (
        <span className="font-mono text-xs tabular-nums">{c.forwardPE != null ? c.forwardPE.toFixed(1) : "—"}</span>
      ),
    },
    ...(!compact
      ? [
          {
            key: "evToEbitda",
            label: "EV/EBITDA",
            numeric: true,
            sortValue: (c: TierCompany) => c.evToEbitda ?? null,
            render: (c: TierCompany) => (
              <span className="font-mono text-xs tabular-nums">{c.evToEbitda != null ? c.evToEbitda.toFixed(1) : "—"}</span>
            ),
          },
          {
            key: "vsHigh",
            label: "vs 52w high",
            help: "Distance from the 52-week high — a crowding proxy; near zero means the market already found it",
            numeric: true,
            sortValue: (c: TierCompany) => c.distanceFrom52WkHigh ?? null,
            render: (c: TierCompany) => (
              <span className={`font-mono text-xs tabular-nums ${toneClass(c.distanceFrom52WkHigh ?? null)}`}>
                {formatPercent(c.distanceFrom52WkHigh ?? null, 1)}
              </span>
            ),
          },
        ]
      : []),
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
      actions={
        theme
          ? (c) => (
              <>
                <DataTableAction onClick={() => void add(c)} disabled={added.has(c.symbol)}>
                  {added.has(c.symbol) ? "On the watchlist" : "Add to watchlist"}
                </DataTableAction>
                <DataTableAction href={`/research?symbol=${encodeURIComponent(c.symbol)}`}>
                  Open in Research
                </DataTableAction>
              </>
            )
          : undefined
      }
    />
  );
}
