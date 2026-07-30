/**
 * Row windowing geometry for the virtualized data grid.
 *
 * Extracted from the component and kept pure because this is the part of
 * virtualization that is easy to get subtly wrong and hard to notice: an
 * off-by-one in the visible range shows up as a flicker at the edge of the
 * viewport, and a wrong spacer height shows up as a scrollbar that lies about how
 * much list there is — or worse, as content that jumps under the pointer while
 * the user is reading it.
 *
 * ## The complication
 *
 * Rows are a uniform height, which makes `index = scrollTop / rowHeight`
 * trivial — except that this grid can have **one** expanded detail row of a
 * different, larger height. That single exception breaks the uniform mapping for
 * every row after it, so both directions of the conversion (offset → index and
 * index → offset) have to account for it explicitly.
 *
 * The alternative — dropping the expanded row out of the DOM when it scrolls out
 * of the window — was rejected because the total content height would then change
 * as you scroll, which makes the scrollbar jump.
 *
 * Unit-tested in `tests/table-window.test.ts`.
 */

export interface WindowInput {
  /** Total rows after filtering and sorting. */
  rowCount: number;
  /** Measured (or estimated) uniform row height in px. Must be > 0. */
  rowHeight: number;
  /** Height of the scrollport in px. */
  viewportHeight: number;
  /** Current scroll offset in px. */
  scrollTop: number;
  /** Index of the expanded row, or null when none is open. */
  expandedIndex: number | null;
  /** Measured height of the expanded detail panel in px. */
  detailHeight: number;
  /** Extra rows rendered above and below the viewport to hide fast scrolling. */
  overscan?: number;
}

export interface WindowResult {
  /** First row index to render (inclusive). */
  startIndex: number;
  /** Last row index to render (inclusive). */
  endIndex: number;
  /** Height of the spacer row standing in for everything above `startIndex`. */
  paddingTop: number;
  /** Height of the spacer row standing in for everything below `endIndex`. */
  paddingBottom: number;
  /** Total scrollable content height, used to sanity-check the spacers. */
  totalHeight: number;
}

const DEFAULT_OVERSCAN = 6;

/**
 * Pixel offset of the top of row `index`, accounting for an open detail panel
 * above it.
 */
export function offsetForIndex(
  index: number,
  rowHeight: number,
  expandedIndex: number | null,
  detailHeight: number,
): number {
  const base = index * rowHeight;
  // The detail sits immediately AFTER its row, so it only displaces rows whose
  // index is strictly greater than the expanded one.
  const extra = expandedIndex != null && index > expandedIndex ? detailHeight : 0;
  return base + extra;
}

/** Inverse of {@link offsetForIndex}: the row containing pixel offset `offset`. */
export function indexForOffset(
  offset: number,
  rowHeight: number,
  expandedIndex: number | null,
  detailHeight: number,
): number {
  if (rowHeight <= 0) return 0;
  if (expandedIndex == null || detailHeight <= 0) {
    return Math.floor(offset / rowHeight);
  }
  // Everything up to and including the expanded row is still uniform.
  const boundary = (expandedIndex + 1) * rowHeight;
  if (offset < boundary) return Math.floor(offset / rowHeight);
  // Past the detail panel, shift the coordinate space back by its height.
  const shifted = offset - detailHeight;
  return Math.max(expandedIndex + 1, Math.floor(shifted / rowHeight));
}

/**
 * The range of rows to render, plus the spacer heights that keep the scrollbar
 * honest.
 *
 * Invariant the tests pin: `paddingTop + renderedHeight + paddingBottom` always
 * equals `totalHeight`, for every scroll position and with or without an
 * expanded row. If that ever drifts, the scrollbar misreports the list length.
 */
export function computeWindow(input: WindowInput): WindowResult {
  const {
    rowCount,
    rowHeight,
    viewportHeight,
    scrollTop,
    expandedIndex,
    detailHeight,
    overscan = DEFAULT_OVERSCAN,
  } = input;

  const openIndex = expandedIndex != null && expandedIndex >= 0 && expandedIndex < rowCount ? expandedIndex : null;
  const detail = openIndex != null ? Math.max(0, detailHeight) : 0;
  const totalHeight = rowCount * rowHeight + detail;

  if (rowCount === 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  }

  const firstVisible = indexForOffset(Math.max(0, scrollTop), rowHeight, openIndex, detail);
  const lastVisible = indexForOffset(
    Math.max(0, scrollTop) + Math.max(0, viewportHeight),
    rowHeight,
    openIndex,
    detail,
  );

  let startIndex = Math.max(0, firstVisible - overscan);
  let endIndex = Math.min(rowCount - 1, lastVisible + overscan);

  /* Keep the expanded row mounted even when it scrolls out of the window.
     Dropping it would remove `detailHeight` from the content, shrinking the
     scrollable area mid-scroll and yanking the scrollbar. */
  if (openIndex != null) {
    startIndex = Math.min(startIndex, openIndex);
    endIndex = Math.max(endIndex, openIndex);
  }

  const paddingTop = offsetForIndex(startIndex, rowHeight, openIndex, detail);
  // Measured from the end rather than accumulated, so rounding cannot drift.
  const consumedThroughEnd = offsetForIndex(endIndex + 1, rowHeight, openIndex, detail);
  const paddingBottom = Math.max(0, totalHeight - consumedThroughEnd);

  return { startIndex, endIndex, paddingTop, paddingBottom, totalHeight };
}

/**
 * Whether windowing is worth its complexity for this many rows.
 *
 * Below the threshold the DOM cost is irrelevant and full rendering is strictly
 * better: no measurement, no spacers, no scroll coupling, and browser find-in-page
 * works across the whole list. Virtualization is a remedy, not a default.
 */
export const VIRTUALIZE_THRESHOLD = 120;

export function shouldVirtualize(rowCount: number, hasScrollport: boolean): boolean {
  return hasScrollport && rowCount > VIRTUALIZE_THRESHOLD;
}
