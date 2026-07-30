"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * The shared data grid for scanning surfaces.
 *
 * ## Why this exists
 *
 * UAA's list surfaces were built as card lists. Measured on /watchlist with 57
 * names: each row was ~113px tall with a vertically stacked four-button action
 * column and roughly 600px of empty space in the middle, so the list ran ~6,400px
 * — six screens — to show two data points per name. Sorting offered exactly two
 * options ("Recent", "Portfolio Fit") and there were no aligned columns, so the
 * one thing a watchlist is for (rank 57 names by distance to target, or by
 * today's move, and act on the top few) was impossible.
 *
 * A comparable Koyfin watchlist shows the same 57 rows in about two screens with
 * ten sortable columns. The difference is entirely presentational, which is why it
 * belongs in one component rather than in each page.
 *
 * ## What it guarantees
 *
 * - **Sortable columns** with nulls always sinking to the bottom regardless of
 *   direction. A missing value is not a small value.
 * - **Right-aligned tabular numerals** for numeric columns, so digits line up
 *   and magnitudes are comparable by eye without reading every figure.
 * - **A sticky header**, so the columns are still legible 50 rows down.
 * - **A density toggle.** Compact is the default for data; comfortable exists for
 *   people who want air. Remembered by the caller if it wants to persist it.
 * - **One overflow action menu per row** instead of N inline buttons. The
 *   repeated four-link cross-nav (Research / DCF / IC Report / Compare) rendered
 *   on every row of the watchlist AND every calendar event card was hundreds of
 *   duplicate controls competing with the data for attention.
 */

export type SortDir = "asc" | "desc";

export interface DataTableColumn<T> {
  /** Stable key, also used as the sort key. */
  key: string;
  /** Header text. Keep it short — the tooltip carries the detail. */
  label: string;
  /** Longer explanation, shown on header hover. */
  help?: string;
  align?: "left" | "right";
  /** Cell content. Return a string for text, or a node for a chip/badge. */
  render: (row: T) => ReactNode;
  /**
   * Comparable value for sorting. Return null for "no value" — those rows sink.
   * Omit to make the column unsortable.
   */
  sortValue?: (row: T) => number | string | null;
  /** Numeric columns get tabular numerals and right alignment by default. */
  numeric?: boolean;
  /** Hide below this breakpoint, e.g. "sm" keeps it off phones. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

export interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  /** Stable identity per row. */
  rowKey: (row: T) => string;
  /** Sort key; omit for uncontrolled sorting. */
  sortKey?: string;
  sortDir?: SortDir;
  onSortChange?: (key: string, dir: SortDir) => void;
  /** Initial sort when uncontrolled. */
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  /** Per-row overflow menu contents. */
  actions?: (row: T) => ReactNode;
  /** Optional expanded detail panel, shown when the row is clicked. */
  renderDetail?: (row: T) => ReactNode;
  /** Emphasis for a row (e.g. an alert firing). */
  rowTone?: (row: T) => "default" | "alert" | "positive";
  density?: Density;
  onDensityChange?: (d: Density) => void;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  /** Caption above the table (count, filters). */
  toolbar?: ReactNode;
  className?: string;
}

export type Density = "compact" | "comfortable";

const CELL_PAD: Record<Density, string> = {
  compact: "px-2.5 py-1.5",
  comfortable: "px-3 py-3",
};

const HIDE_BELOW: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

const ROW_TONE: Record<string, string> = {
  default: "",
  alert: "bg-negative/[0.06]",
  positive: "bg-positive/[0.05]",
};

/**
 * Nulls sink to the bottom in BOTH directions.
 *
 * Sorting "worst first" must not surface every row whose value is simply
 * unknown — that turns a missing data point into a finding.
 */
function compare(a: number | string | null, b: number | string | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
  return String(a).localeCompare(String(b)) * sign;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  sortKey,
  sortDir,
  onSortChange,
  defaultSortKey,
  defaultSortDir = "desc",
  actions,
  renderDetail,
  rowTone,
  density,
  onDensityChange,
  empty,
  toolbar,
  className = "",
}: DataTableProps<T>) {
  const [ownSortKey, setOwnSortKey] = useState(defaultSortKey ?? "");
  const [ownSortDir, setOwnSortDir] = useState<SortDir>(defaultSortDir);
  const [ownDensity, setOwnDensity] = useState<Density>("compact");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const activeKey = sortKey ?? ownSortKey;
  const activeDir = sortDir ?? ownSortDir;
  const activeDensity = density ?? ownDensity;

  function setSort(key: string) {
    // Clicking the active column flips direction; a new column starts descending,
    // which is "best first" for every score and magnitude in this app.
    const nextDir: SortDir = key === activeKey && activeDir === "desc" ? "asc" : "desc";
    if (onSortChange) onSortChange(key, nextDir);
    else {
      setOwnSortKey(key);
      setOwnSortDir(nextDir);
    }
  }

  function setDensity(d: Density) {
    if (onDensityChange) onDensityChange(d);
    else setOwnDensity(d);
  }

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === activeKey);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => compare(get(a), get(b), activeDir));
  }, [rows, columns, activeKey, activeDir]);

  const pad = CELL_PAD[activeDensity];
  const colSpan = columns.length + (actions ? 1 : 0);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-xs text-muted">{toolbar}</div>
        <div className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-widest text-muted">
          {(["compact", "comfortable"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              aria-pressed={activeDensity === d}
              className={`rounded-control px-2 py-1 transition-colors ${
                activeDensity === d
                  ? "bg-surface-2 text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {d === "compact" ? "Dense" : "Roomy"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface-2 text-xs text-muted">
            <tr>
              {columns.map((col) => {
                const sortable = Boolean(col.sortValue);
                const right = col.align === "right" || col.numeric;
                return (
                  <th
                    key={col.key}
                    title={col.help}
                    className={`${pad} font-medium ${right ? "text-right" : "text-left"} ${
                      col.hideBelow ? HIDE_BELOW[col.hideBelow] : ""
                    }`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => setSort(col.key)}
                        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                      >
                        {col.label}
                        <span className="text-[9px] text-muted/70">
                          {activeKey === col.key ? (activeDir === "desc" ? "▼" : "▲") : ""}
                        </span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
              {actions && <th className={`${pad} text-right font-medium`}>Actions</th>}
            </tr>
          </thead>

          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-0">
                  {empty}
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const id = rowKey(row);
                const isOpen = expanded === id;
                const tone = ROW_TONE[rowTone?.(row) ?? "default"];

                return (
                  <tr
                    key={id}
                    className={`border-b border-hairline last:border-0 transition-colors hover:bg-surface-2/50 ${tone} ${
                      renderDetail ? "cursor-pointer" : ""
                    }`}
                    onClick={renderDetail ? () => setExpanded(isOpen ? null : id) : undefined}
                  >
                    {columns.map((col) => {
                      const right = col.align === "right" || col.numeric;
                      return (
                        <td
                          key={col.key}
                          className={`${pad} ${right ? "text-right" : "text-left"} ${
                            col.numeric ? "font-mono tabular-nums" : ""
                          } ${col.hideBelow ? HIDE_BELOW[col.hideBelow] : ""}`}
                        >
                          {col.render(row)}
                        </td>
                      );
                    })}

                    {actions && (
                      <td className={`${pad} text-right`}>
                        <span className="relative inline-block">
                          <button
                            type="button"
                            aria-label="Row actions"
                            aria-expanded={menuOpen === id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpen(menuOpen === id ? null : id);
                            }}
                            className="rounded-control px-2 py-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                          >
                            ⋯
                          </button>
                          {menuOpen === id && (
                            <span
                              className="absolute right-0 top-full z-20 mt-1 flex min-w-40 animate-popover-in flex-col rounded-panel border border-border bg-surface p-1 text-left shadow-popover"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {actions(row)}
                            </span>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })
            )}

            {/* Expanded detail, rendered as its own row so it spans every column. */}
            {renderDetail &&
              sorted
                .filter((row) => rowKey(row) === expanded)
                .map((row) => (
                  <tr key={`${rowKey(row)}-detail`} className="border-b border-hairline">
                    <td colSpan={colSpan} className="bg-surface-2/40 p-0">
                      {renderDetail(row)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A single item inside a row's overflow menu. */
export function DataTableAction({
  onClick,
  href,
  children,
  tone = "default",
}: {
  onClick?: () => void;
  href?: string;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  const cls = `rounded-control px-2.5 py-1.5 text-left text-xs transition-colors ${
    tone === "danger"
      ? "text-negative hover:bg-negative/10"
      : "text-foreground hover:bg-surface-2"
  }`;

  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
