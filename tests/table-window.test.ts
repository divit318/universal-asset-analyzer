import { describe, expect, it } from "vitest";
import {
  computeWindow,
  indexForOffset,
  offsetForIndex,
  shouldVirtualize,
  VIRTUALIZE_THRESHOLD,
} from "@/lib/table-window";

/**
 * Windowing geometry.
 *
 * The invariant that matters is that the spacers plus the rendered rows always
 * add up to the true content height. If they don't, the scrollbar lies about how
 * long the list is, and content shifts under the pointer while being read.
 */

const ROW = 30;
const VIEWPORT = 600;

/** Height actually occupied by the rendered slice. */
function renderedHeight(
  start: number,
  end: number,
  expandedIndex: number | null,
  detailHeight: number,
): number {
  if (end < start) return 0;
  const rows = (end - start + 1) * ROW;
  const detail = expandedIndex != null && expandedIndex >= start && expandedIndex <= end ? detailHeight : 0;
  return rows + detail;
}

describe("offsetForIndex / indexForOffset are inverses", () => {
  it("round-trips with no expanded row", () => {
    for (const i of [0, 1, 7, 99, 500]) {
      expect(indexForOffset(offsetForIndex(i, ROW, null, 0), ROW, null, 0)).toBe(i);
    }
  });

  it("round-trips with an expanded row above, at, and below the index", () => {
    const detail = 220;
    for (const expanded of [0, 5, 40]) {
      for (const i of [0, 1, 5, 6, 41, 300]) {
        const offset = offsetForIndex(i, ROW, expanded, detail);
        expect(indexForOffset(offset, ROW, expanded, detail)).toBe(i);
      }
    }
  });

  it("places the detail AFTER its own row, not before it", () => {
    const detail = 200;
    // The expanded row itself is not displaced…
    expect(offsetForIndex(10, ROW, 10, detail)).toBe(10 * ROW);
    // …but the next one is.
    expect(offsetForIndex(11, ROW, 10, detail)).toBe(11 * ROW + detail);
  });
});

describe("computeWindow", () => {
  it("renders a slice around the viewport, not the whole list", () => {
    const w = computeWindow({
      rowCount: 5000,
      rowHeight: ROW,
      viewportHeight: VIEWPORT,
      scrollTop: 0,
      expandedIndex: null,
      detailHeight: 0,
    });
    expect(w.startIndex).toBe(0);
    // 600/30 = 20 visible + overscan, nowhere near 5000.
    expect(w.endIndex).toBeLessThan(40);
    expect(w.endIndex - w.startIndex + 1).toBeLessThan(40);
  });

  it("keeps spacers + rendered rows exactly equal to the total height", () => {
    for (const scrollTop of [0, 15, 300, 3_000, 60_000, 149_970]) {
      const w = computeWindow({
        rowCount: 5000,
        rowHeight: ROW,
        viewportHeight: VIEWPORT,
        scrollTop,
        expandedIndex: null,
        detailHeight: 0,
      });
      const sum = w.paddingTop + renderedHeight(w.startIndex, w.endIndex, null, 0) + w.paddingBottom;
      expect(sum).toBe(w.totalHeight);
      expect(w.totalHeight).toBe(5000 * ROW);
    }
  });

  it("keeps the height invariant with an expanded row, at every scroll position", () => {
    const detail = 240;
    const expanded = 200;
    for (const scrollTop of [0, 1_000, 5_985, 6_000, 6_240, 20_000, 149_000]) {
      const w = computeWindow({
        rowCount: 5000,
        rowHeight: ROW,
        viewportHeight: VIEWPORT,
        scrollTop,
        expandedIndex: expanded,
        detailHeight: detail,
      });
      const sum = w.paddingTop + renderedHeight(w.startIndex, w.endIndex, expanded, detail) + w.paddingBottom;
      expect(sum).toBe(w.totalHeight);
      expect(w.totalHeight).toBe(5000 * ROW + detail);
    }
  });

  it("keeps the expanded row mounted even when scrolled far away", () => {
    // Otherwise the content would shrink by `detailHeight` mid-scroll and the
    // scrollbar would jump.
    const w = computeWindow({
      rowCount: 5000,
      rowHeight: ROW,
      viewportHeight: VIEWPORT,
      scrollTop: 100_000,
      expandedIndex: 3,
      detailHeight: 240,
    });
    expect(w.startIndex).toBeLessThanOrEqual(3);
    expect(w.endIndex).toBeGreaterThanOrEqual(3);
  });

  it("never produces negative padding or an out-of-range index", () => {
    for (const scrollTop of [-500, 0, 999_999]) {
      const w = computeWindow({
        rowCount: 100,
        rowHeight: ROW,
        viewportHeight: VIEWPORT,
        scrollTop,
        expandedIndex: null,
        detailHeight: 0,
      });
      expect(w.paddingTop).toBeGreaterThanOrEqual(0);
      expect(w.paddingBottom).toBeGreaterThanOrEqual(0);
      expect(w.startIndex).toBeGreaterThanOrEqual(0);
      expect(w.endIndex).toBeLessThanOrEqual(99);
    }
  });

  it("renders the tail correctly at the very bottom of the list", () => {
    const w = computeWindow({
      rowCount: 300,
      rowHeight: ROW,
      viewportHeight: VIEWPORT,
      scrollTop: 300 * ROW - VIEWPORT,
      expandedIndex: null,
      detailHeight: 0,
    });
    expect(w.endIndex).toBe(299);
    expect(w.paddingBottom).toBe(0);
  });

  it("handles an empty list without dividing by anything", () => {
    const w = computeWindow({
      rowCount: 0,
      rowHeight: ROW,
      viewportHeight: VIEWPORT,
      scrollTop: 0,
      expandedIndex: null,
      detailHeight: 0,
    });
    expect(w).toEqual({ startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0, totalHeight: 0 });
  });

  it("degrades safely if a row height has not been measured yet", () => {
    const w = computeWindow({
      rowCount: 500,
      rowHeight: 0,
      viewportHeight: VIEWPORT,
      scrollTop: 0,
      expandedIndex: null,
      detailHeight: 0,
    });
    expect(w.endIndex).toBe(-1);
  });

  it("ignores an expanded index that is out of range", () => {
    // e.g. the expanded row was just filtered out.
    const w = computeWindow({
      rowCount: 10,
      rowHeight: ROW,
      viewportHeight: VIEWPORT,
      scrollTop: 0,
      expandedIndex: 999,
      detailHeight: 240,
    });
    expect(w.totalHeight).toBe(10 * ROW);
  });
});

describe("shouldVirtualize", () => {
  it("only kicks in for long lists inside a real scrollport", () => {
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD + 1, true)).toBe(true);
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD, true)).toBe(false);
    // Without a bounded scrollport there is nothing to window against.
    expect(shouldVirtualize(5000, false)).toBe(false);
  });

  it("leaves a typical watchlist fully rendered", () => {
    // 57 names: windowing would add measurement and scroll coupling, and break
    // browser find-in-page, to save nothing.
    expect(shouldVirtualize(57, true)).toBe(false);
  });
});
