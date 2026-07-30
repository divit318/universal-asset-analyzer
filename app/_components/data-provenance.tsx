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
  liveLabel = false,
  className = "",
}: {
  source: DataSourceId;
  asOf: string | number | null | undefined;
  /** Expected refresh window; drives the fresh/aging/stale color. */
  ttlHours?: number;
  /** Show the literal word "Live" instead of "updated Xs ago" while the value is within its TTL — for data that's refetched on every request (a quote) rather than periodically refreshed. */
  liveLabel?: boolean;
  className?: string;
}) {
  const meta = DATA_SOURCES[source];
  const f = freshness(asOf, ttlHours);
  const age = f.label === "unknown" ? "as-of unknown" : liveLabel && f.level === "fresh" ? "Live" : `updated ${f.label}`;
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 text-xs text-muted ${className}`}
      title={`Source: ${meta.name} · ${age}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[f.level]}`} aria-hidden />
      <span className="shrink-0 font-medium text-foreground/80">{meta.short}</span>
      {/* min-w-0 + truncate: when a caller crams this badge alongside other
          content on one line (e.g. Compare's "FY2025 · Yahoo · updated..."
          row in a narrow, 5-way-comparison card), the age text is the part
          that should give way — it ellipsizes instead of word-wrapping onto
          a second line and leaving a stray "·" dangling at the start of it.
          The full text is still available via the title tooltip above. */}
      <span className="min-w-0 truncate text-faint">· {age}</span>
    </span>
  );
}
