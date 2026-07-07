import { DATA_SOURCES, freshness, type DataSourceId, type FreshnessLevel } from "@/lib/provenance";

const DOT: Record<FreshnessLevel, string> = {
  fresh: "bg-positive",
  aging: "bg-warning",
  stale: "bg-negative",
};

/**
 * Inline "where this came from & how fresh it is" badge — a colored dot,
 * the source, and the age. Shared so provenance reads identically on every
 * surface (Screener, research, compare…). Presentational only.
 */
export function DataProvenance({
  source,
  asOf,
  ttlHours = 24,
  className = "",
}: {
  source: DataSourceId;
  asOf: string | number | null | undefined;
  /** Expected refresh window; drives the fresh/aging/stale color. */
  ttlHours?: number;
  className?: string;
}) {
  const meta = DATA_SOURCES[source];
  const f = freshness(asOf, ttlHours);
  const age = f.label === "unknown" ? "as-of unknown" : `updated ${f.label}`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-muted ${className}`}
      title={`Source: ${meta.name} · ${age}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[f.level]}`} aria-hidden />
      <span className="font-medium text-foreground/80">{meta.short}</span>
      <span className="text-faint">· {age}</span>
    </span>
  );
}
