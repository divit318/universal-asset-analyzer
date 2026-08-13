"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeWindow, offsetForIndex, shouldVirtualize } from "@/lib/table-window";

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
 * one thing a watchlist is for (rank 57 names by upside, or by today's move, and
 * act on the top few) was impossible.
 *
 * A comparable Koyfin watchlist shows the same 57 rows in about two screens with
 * ten sortable columns. The difference is entirely presentational, which is why it
 * belongs in one component rather than in each page.
 *
 * ## What it guarantees
 *
 * - **Sortable columns** with nulls always sinking to the bottom regardless of
 *   direction. A missing value is not a small value.
 * - **Stable sorting.** `Array.prototype.sort` is specified as stable, so ties
 *   keep the order the caller supplied them in — for the watchlist that is
 *   `added_at DESC`, which makes an all-null column a no-op rather than a
 *   reshuffle.
 * - **Right-aligned tabular numerals** for numeric columns, so digits line up
 *   and magnitudes are comparable by eye without reading every figure.
 * - **A header that actually sticks.** `position: sticky` only sticks within the
 *   nearest scrollport, and this table's horizontal scroller is one — so on an
 *   unbounded wrapper the header pinned to the top of its own content and never
 *   moved. Pass {@link DataTableProps.maxBodyHeight} for long lists to give the
 *   grid a real vertical scrollport, which is what makes the header stay legible
 *   50 rows down.
 * - **A density toggle.** Compact is the default for data; comfortable exists for
 *   people who want air. Remembered by the caller if it wants to persist it, and
 *   suppressible so a surface with several grids can own one control for all of
 *   them rather than repeating it per table.
 * - **One overflow action menu per row** instead of N inline buttons. The
 *   repeated four-link cross-nav (Research / DCF / IC Report / Compare) rendered
 *   on every row of the watchlist AND every calendar event card was hundreds of
 *   duplicate controls competing with the data for attention.
 * - **Keyboard and screen-reader parity.** Every sortable header reports
 *   `aria-sort`; an expandable row is reachable by Tab and toggles on
 *   Enter/Space; the action menu closes on Escape and on an outside click and
 *   returns focus to the trigger.
 */

export type SortDir = "asc" | "desc";

export interface DataTableColumn<T> {
  /** Stable key, also used as the sort key. */
  key: string;
  /** Header text. Keep it short — the tooltip carries the detail. */
  label: string;
  /** Longer explanation, shown on header hover and to screen readers. */
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
  /**
   * Which direction the FIRST click on this column should sort. Defaults to
   * descending, which is "best first" for a score or a magnitude — but wrong for
   * a name column, where the useful first click is A→Z.
   */
  firstSortDir?: SortDir;
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
  /**
   * Controlled expansion: which row's detail is open. Pass `null` for none.
   * Omit entirely (undefined) to keep the default uncontrolled behaviour.
   * Lets a surface open a row from outside the table — e.g. the watchlist's
   * attention queue opening the clicked name's decision file.
   */
  expandedKey?: string | null;
  onExpandedChange?: (id: string | null) => void;
  /** Emphasis for a row (e.g. an alert firing, or a name needing attention). */
  rowTone?: (row: T) => "default" | "alert" | "positive" | "watch";
  density?: Density;
  onDensityChange?: (d: Density) => void;
  /**
   * Set false when the SURFACE owns density and renders one {@link DensityToggle}
   * for several grids. A page that shows ten tables of one dataset (the Holdings
   * tab) shares a single density value, so ten toggles were ten controls for one
   * setting — changing any of them changed all ten, which reads as a bug.
   */
  showDensityToggle?: boolean;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  /** Caption above the table (count, filters). */
  toolbar?: ReactNode;
  /**
   * CSS length capping the grid's height, e.g. `"min(70vh, 900px)"`. Set it for
   * long lists: it creates the vertical scrollport the sticky header needs.
   * Leave undefined for short lists, which scroll with the page instead.
   */
  maxBodyHeight?: string;
  /** Accessible name for the grid. */
  label?: string;
  className?: string;
}

export type Density = "compact" | "comfortable";

const CELL_PAD: Record<Density, string> = {
  compact: "px-2.5 py-1.5",
  comfortable: "px-3 py-3",
};

const DENSITY_LABEL: Record<Density, string> = {
  compact: "Dense",
  comfortable: "Roomy",
};

/**
 * The row-height control, as a segmented control rather than two loose words.
 *
 * The selected option used to be marked with `bg-surface-2` — #1a1d23 sitting on
 * a #131519 card, a 3% step that is invisible at 10px. So the toggle showed two
 * equally-dead labels and gave no answer to the only question it is asked
 * ("which one am I looking at?"). The active segment now carries the same
 * brand-tinted treatment every other selected control in the app uses.
 *
 * Exported so a surface with SEVERAL grids over one dataset can render a single
 * control for all of them (see {@link DataTableProps.showDensityToggle}).
 */
export function DensityToggle({
  density,
  onChange,
  className = "",
}: {
  density: Density;
  onChange: (d: Density) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Row density"
      className={`flex shrink-0 items-center gap-0.5 rounded-control border border-border bg-surface p-0.5 text-[10px] uppercase tracking-widest ${className}`}
    >
      {(["compact", "comfortable"] as const).map((d) => {
        const active = density === d;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(d)}
            aria-pressed={active}
            className={`rounded-control px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              active
                ? "bg-brand/15 font-semibold text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {DENSITY_LABEL[d]}
          </button>
        );
      })}
    </div>
  );
}

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
  watch: "bg-warning/[0.05]",
};

const ARIA_SORT: Record<SortDir, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
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
  expandedKey,
  onExpandedChange,
  rowTone,
  density,
  onDensityChange,
  showDensityToggle = true,
  empty,
  toolbar,
  maxBodyHeight,
  label,
  className = "",
}: DataTableProps<T>) {
  const [ownSortKey, setOwnSortKey] = useState(defaultSortKey ?? "");
  const [ownSortDir, setOwnSortDir] = useState<SortDir>(defaultSortDir);
  const [ownDensity, setOwnDensity] = useState<Density>("compact");
  const [ownExpanded, setOwnExpanded] = useState<string | null>(null);
  /* Controlled when `expandedKey` is passed (even as null); uncontrolled
     otherwise — the same convention `sortKey` follows. */
  const expanded = expandedKey !== undefined ? expandedKey : ownExpanded;
  const setExpanded = useCallback(
    (id: string | null) => {
      if (expandedKey === undefined) setOwnExpanded(id);
      onExpandedChange?.(id);
    },
    [expandedKey, onExpandedChange],
  );
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** The open menu's element, used to tell an inside click from an outside one. */
  const menuRef = useRef<HTMLElement | null>(null);

  const activeKey = sortKey ?? ownSortKey;
  const activeDir = sortDir ?? ownSortDir;
  const activeDensity = density ?? ownDensity;

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(null);
    if (restoreFocus) menuTriggerRef.current?.focus();
  }, []);

  /**
   * An open overflow menu must be dismissible without choosing anything —
   * otherwise the only exits are picking an action or reloading.
   *
   * Dismissal is decided by asking whether the pointer landed INSIDE the menu,
   * not by having the menu call `stopPropagation`. React attaches its listeners
   * to the app root, so a synthetic `stopPropagation` does not reliably stop a
   * listener bound to `document` — and when it does not, `pointerdown` closes the
   * menu before the `click` that would have run the action ever fires, leaving
   * every item in it silently unclickable by mouse.
   */
  useEffect(() => {
    if (menuOpen == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return closeMenu(false);
      // Inside the menu, or on the trigger that owns it: not an outside click.
      if (menuRef.current?.contains(target)) return;
      if (menuTriggerRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen, closeMenu]);

  /* A row that has been filtered or deleted away must not leave its detail panel
     or its menu addressed by a key nothing renders any more. */
  const liveKeys = useMemo(() => new Set(rows.map(rowKey)), [rows, rowKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciling retained ids against a prop-derived key set; a stale id is not derivable at render time precisely because it is state the component still holds
    if (expanded != null && !liveKeys.has(expanded)) setExpanded(null);
    if (menuOpen != null && !liveKeys.has(menuOpen)) setMenuOpen(null);
  }, [liveKeys, expanded, menuOpen, setExpanded]);

  function setSort(col: DataTableColumn<T>) {
    // Clicking the active column flips direction; a new column starts in its own
    // preferred direction — descending for scores and magnitudes, which is "best
    // first", but ascending where A→Z is the useful first look.
    const first = col.firstSortDir ?? "desc";
    const nextDir: SortDir =
      col.key === activeKey ? (activeDir === "desc" ? "asc" : "desc") : first;
    if (onSortChange) onSortChange(col.key, nextDir);
    else {
      setOwnSortKey(col.key);
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
    // Stable by specification, so equal values keep the caller's order.
    return [...rows].sort((a, b) => compare(get(a), get(b), activeDir));
  }, [rows, columns, activeKey, activeDir]);

  const pad = CELL_PAD[activeDensity];
  const colSpan = columns.length + (actions ? 1 : 0);

  /* ---------------------------------------------------------------------- */
  /* Windowing                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Only long lists inside a bounded scrollport are windowed. Below the
   * threshold, full rendering is strictly better — no measurement, no scroll
   * coupling, and browser find-in-page still searches the whole list.
   */
  const virtualized = shouldVirtualize(sorted.length, Boolean(maxBodyHeight));

  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRowRef = useRef<HTMLTableRowElement>(null);
  const detailRef = useRef<HTMLTableRowElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Estimates until measured; the estimate only ever affects the first paint.
  const [rowHeight, setRowHeight] = useState(activeDensity === "compact" ? 30 : 44);
  const [detailHeight, setDetailHeight] = useState(0);
  const rafRef = useRef<number | null>(null);
  /** Row id awaiting focus once windowing has mounted it. */
  const pendingFocusRef = useRef<string | null>(null);

  const expandedIndex = useMemo(() => {
    if (expanded == null) return null;
    const i = sorted.findIndex((r) => rowKey(r) === expanded);
    return i >= 0 ? i : null;
  }, [expanded, sorted, rowKey]);

  /* Scroll is read through rAF rather than on every event: a wheel gesture fires
     scroll dozens of times per frame, and setting state on each one re-renders
     the window for pixels nobody sees. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!virtualized || !el) return;
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [virtualized]);

  /* Measure the scrollport and a real row, so the geometry uses the actual
     rendered height rather than a hardcoded guess that breaks the moment the
     density changes or the font loads. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!virtualized || !el) return;
    const measure = () => {
      setViewportHeight(el.clientHeight);
      const h = measureRowRef.current?.getBoundingClientRect().height;
      if (h && h > 0) setRowHeight(h);
      const d = detailRef.current?.getBoundingClientRect().height;
      setDetailHeight(d && d > 0 ? d : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (measureRowRef.current) observer.observe(measureRowRef.current);
    if (detailRef.current) observer.observe(detailRef.current);
    return () => observer.disconnect();
    // `expanded` is in the deps so the detail panel is re-measured when it opens
    // or closes; without it the geometry would keep a stale height.
  }, [virtualized, activeDensity, expanded, sorted.length]);

  const windowed = useMemo(
    () =>
      computeWindow({
        rowCount: sorted.length,
        rowHeight,
        viewportHeight,
        scrollTop,
        expandedIndex,
        detailHeight,
      }),
    [sorted.length, rowHeight, viewportHeight, scrollTop, expandedIndex, detailHeight],
  );

  const visible = virtualized
    ? sorted.slice(windowed.startIndex, windowed.endIndex + 1)
    : sorted;
  const indexOffset = virtualized ? windowed.startIndex : 0;

  /**
   * Arrow-key navigation between rows.
   *
   * Necessary *because* of windowing: Tab alone cannot reach a row that is not in
   * the DOM, so a 5,000-row list would be keyboard-navigable only within the
   * ~30 rows that happen to be rendered. Moving by index instead scrolls the
   * target into view first, which mounts it, and focus is then applied after the
   * browser has laid it out.
   */
  const focusRowByIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(sorted.length - 1, index));
      const row = sorted[clamped];
      if (!row) return;
      const id = rowKey(row);
      const el = scrollRef.current;

      if (virtualized && el) {
        const top = offsetForIndex(clamped, rowHeight, expandedIndex, detailHeight);
        // Only scroll when the row is actually outside the scrollport, so
        // stepping through visible rows does not jerk the viewport.
        let next = el.scrollTop;
        if (top < el.scrollTop) next = top;
        else if (top + rowHeight > el.scrollTop + el.clientHeight) {
          next = top + rowHeight - el.clientHeight;
        }
        if (next !== el.scrollTop) {
          el.scrollTop = next;
          /* Push the new offset into state in the SAME update rather than waiting
             for the scroll event → rAF → setState chain. A large jump (Home/End)
             re-renders the window, and relying on that chain meant requesting
             focus before the target row existed — pressing Home dropped focus to
             the body entirely. */
          setScrollTop(next);
        }
      }

      /* Focus is applied by the effect below, once the row is actually in the
         DOM. Doing it here would race the commit that mounts it. */
      pendingFocusRef.current = id;
      // Already mounted (the common case: stepping between adjacent visible
      // rows) — focus immediately so there is no perceptible delay.
      const existing = el?.querySelector<HTMLTableRowElement>(`tr[data-row-id="${CSS.escape(id)}"]`);
      if (existing) {
        existing.focus();
        pendingFocusRef.current = null;
      }
    },
    [sorted, rowKey, virtualized, rowHeight, expandedIndex, detailHeight],
  );

  /**
   * Apply a deferred row focus after the window has rendered it.
   *
   * The reliable half of keyboard navigation: a jump to a row outside the
   * rendered window cannot focus it until React has committed the row, so the
   * request is recorded and satisfied here.
   */
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    const target = scrollRef.current?.querySelector<HTMLTableRowElement>(
      `tr[data-row-id="${CSS.escape(id)}"]`,
    );
    if (target) {
      target.focus();
      pendingFocusRef.current = null;
    }
  });

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {(toolbar || showDensityToggle) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-muted">{toolbar}</div>
          {showDensityToggle && (
            <DensityToggle density={activeDensity} onChange={setDensity} />
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className="overflow-auto rounded-card border border-border"
        style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
      >
        <table
          className="w-full text-sm"
          aria-label={label}
          /* Windowing removes rows from the DOM, so the true size has to be
             announced explicitly or a screen reader reports "30 rows" for a
             5,000-row list. +1 for the header row, per the ARIA grid model. */
          aria-rowcount={virtualized ? sorted.length + 1 : undefined}
        >
          <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-muted">
            <tr className="border-b border-border" aria-rowindex={virtualized ? 1 : undefined}>
              {columns.map((col) => {
                const sortable = Boolean(col.sortValue);
                const right = col.align === "right" || col.numeric;
                const isActive = activeKey === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    title={col.help}
                    aria-sort={sortable ? (isActive ? ARIA_SORT[activeDir] : "none") : undefined}
                    className={`${pad} font-medium ${right ? "text-right" : "text-left"} ${
                      col.hideBelow ? HIDE_BELOW[col.hideBelow] : ""
                    }`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => setSort(col)}
                        className={`inline-flex items-center gap-1 rounded-control transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                          isActive ? "text-foreground" : ""
                        }`}
                      >
                        {col.label}
                        <span aria-hidden="true" className="text-[9px] text-muted/70">
                          {isActive ? (activeDir === "desc" ? "▼" : "▲") : ""}
                        </span>
                        {col.help && <span className="sr-only">. {col.help}</span>}
                      </button>
                    ) : (
                      <>
                        {col.label}
                        {col.help && <span className="sr-only">. {col.help}</span>}
                      </>
                    )}
                  </th>
                );
              })}
              {actions && (
                <th scope="col" className={`${pad} text-right font-medium`}>
                  Actions
                </th>
              )}
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
              [
                /* Spacer standing in for the rows above the window. Carries the
                   scroll height those rows would have occupied so the scrollbar
                   reports the real list length. */
                ...(virtualized && windowed.paddingTop > 0
                  ? [
                      <tr key="__spacer_top" aria-hidden="true">
                        <td colSpan={colSpan} style={{ height: windowed.paddingTop, padding: 0, border: 0 }} />
                      </tr>,
                    ]
                  : []),
                ...visible.flatMap((row, i) => {
                const absoluteIndex = indexOffset + i;
                const id = rowKey(row);
                const isOpen = expanded === id;
                const tone = ROW_TONE[rowTone?.(row) ?? "default"];
                const toggle = () => setExpanded(isOpen ? null : id);

                const dataRow = (
                  <tr
                    key={id}
                    data-row-id={id}
                    // The first rendered row is the measurement subject; every row
                    // is the same height, so one sample is enough.
                    ref={i === 0 ? measureRowRef : undefined}
                    // +2: one for the header row, one to convert to 1-based.
                    aria-rowindex={virtualized ? absoluteIndex + 2 : undefined}
                    className={`border-b border-hairline transition-colors hover:bg-surface-2/50 ${tone} ${
                      renderDetail
                        ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
                        : ""
                    }`}
                    onClick={renderDetail ? toggle : undefined}
                    tabIndex={renderDetail ? 0 : undefined}
                    aria-expanded={renderDetail ? isOpen : undefined}
                    onKeyDown={
                      renderDetail
                        ? (e) => {
                            // Only when the row itself has focus — otherwise Space
                            // inside the action menu would also expand the row.
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggle();
                              return;
                            }
                            /* Arrow / Home / End move by INDEX rather than relying
                               on Tab order, which cannot reach a row that
                               windowing has removed from the DOM. */
                            const jump: Record<string, number | undefined> = {
                              ArrowDown: absoluteIndex + 1,
                              ArrowUp: absoluteIndex - 1,
                              PageDown: absoluteIndex + 10,
                              PageUp: absoluteIndex - 10,
                              Home: 0,
                              End: sorted.length - 1,
                            };
                            const next = jump[e.key];
                            if (next !== undefined) {
                              e.preventDefault();
                              focusRowByIndex(next);
                            }
                          }
                        : undefined
                    }
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
                            ref={menuOpen === id ? menuTriggerRef : undefined}
                            aria-label="Row actions"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen === id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpen(menuOpen === id ? null : id);
                            }}
                            className="rounded-control px-2 py-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            ⋯
                          </button>
                          {menuOpen === id && (
                            <span
                              role="menu"
                              ref={menuRef}
                              className="absolute right-0 top-full z-20 mt-1 flex max-h-80 min-w-40 animate-popover-in flex-col overflow-y-auto rounded-panel border border-border bg-surface p-1 text-left shadow-popover"
                              // Still stopped so a menu click does not also toggle
                              // the row's expand handler; dismissal no longer
                              // depends on it (see the pointerdown effect).
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

                /* The detail sits immediately after its own row. It used to be
                   appended after the whole body, so on any sort but the default
                   the panel appeared detached from the row that opened it. */
                if (!renderDetail || !isOpen) return [dataRow];
                return [
                  dataRow,
                  <tr key={`${id}-detail`} ref={detailRef} className="border-b border-hairline">
                    <td colSpan={colSpan} className="bg-surface-2/40 p-0">
                      {renderDetail(row)}
                    </td>
                  </tr>,
                ];
              }),
                ...(virtualized && windowed.paddingBottom > 0
                  ? [
                      <tr key="__spacer_bottom" aria-hidden="true">
                        <td colSpan={colSpan} style={{ height: windowed.paddingBottom, padding: 0, border: 0 }} />
                      </tr>,
                    ]
                  : []),
              ]
            )}
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
  disabled = false,
}: {
  onClick?: () => void;
  href?: string;
  children: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  const cls = `rounded-control px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
    tone === "danger"
      ? "text-negative hover:bg-negative/10"
      : "text-foreground hover:bg-surface-2"
  } ${disabled ? "cursor-not-allowed opacity-40" : ""}`;

  // Next's Link, not a bare <a>: an in-app cross-link out of a table row should
  // be a client transition, not a full document reload that discards the page.
  if (href) {
    return (
      <Link role="menuitem" href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button role="menuitem" type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
