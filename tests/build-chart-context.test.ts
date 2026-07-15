import { describe, expect, it } from "vitest";
import { buildChartContext, resolveSelection } from "@/app/research/_components/chart-workspace/build-chart-context";
import type { IndicatorKey } from "@/app/research/_components/chart-workspace/types";
import type { TechnicalSignal } from "@/lib/pattern-signals";
import type { HistoryPoint, NewsItem } from "@/lib/types";
import type { Overlay, VisibleRange } from "klinecharts";

function bar(date: string, close: number, opts: Partial<HistoryPoint> = {}): HistoryPoint {
  return { date, close, open: close, high: close + 1, low: close - 1, volume: 1000, ...opts };
}

function fakeOverlay(id: string, name: string, points: { timestamp: number; value: number }[] = []): Overlay {
  return { id, name, points } as unknown as Overlay;
}

const NO_INDICATORS: Record<IndicatorKey, boolean> = { sma50: false, sma200: false, boll: false, rsi: false, macd: false };

/* -------------------------------------------------------------------------- */
/* resolveSelection                                                           */
/* -------------------------------------------------------------------------- */

describe("resolveSelection", () => {
  const history: HistoryPoint[] = [bar("2024-01-01", 100), bar("2024-01-02", 102), bar("2024-01-03", 104)];

  it("a selected drawing takes precedence over everything else", () => {
    const overlay = fakeOverlay("ov1", "segment", [{ timestamp: 1, value: 100 }]);
    const signals: TechnicalSignal[] = [];
    const selection = resolveSelection({
      selectedOverlay: overlay,
      selectedStyle: null,
      pinnedCandleIndex: 1,
      displayHistory: history,
      signals,
    });
    expect(selection.kind).toBe("drawing");
    expect(selection.label).toBe("Trend Line");
    expect(selection.drawing?.type).toBe("trend-line");
    expect(selection.drawing?.points).toEqual([{ timestamp: 1, value: 100 }]);
  });

  it("falls back to a generic label when the overlay name has no known tool id", () => {
    const overlay = fakeOverlay("ov2", "someUnknownOverlay");
    const selection = resolveSelection({
      selectedOverlay: overlay,
      selectedStyle: null,
      pinnedCandleIndex: null,
      displayHistory: history,
      signals: [],
    });
    expect(selection.kind).toBe("drawing");
    expect(selection.label).toBe("Drawing");
  });

  it("a clicked candle matching a curated pattern is labeled as that pattern", () => {
    const signal: TechnicalSignal = {
      index: 1, name: "Bullish Engulfing", direction: "bullish", description: "d",
      date: "2024-01-02", span: 2, confidence: 80, category: "reversal", confirmations: [],
    };
    const selection = resolveSelection({
      selectedOverlay: null,
      selectedStyle: null,
      pinnedCandleIndex: 1,
      displayHistory: history,
      signals: [signal],
    });
    expect(selection.kind).toBe("pattern");
    expect(selection.label).toBe("Pattern · Bullish Engulfing");
    expect(selection.signal).toBe(signal);
    expect(selection.candle?.date).toBe("2024-01-02");
  });

  it("a clicked candle with no matching pattern is just a candle", () => {
    const selection = resolveSelection({
      selectedOverlay: null,
      selectedStyle: null,
      pinnedCandleIndex: 0,
      displayHistory: history,
      signals: [],
    });
    expect(selection.kind).toBe("candle");
    expect(selection.label).toBe("Candle");
    expect(selection.candle?.close).toBe(100);
  });

  it("nothing selected or pinned is Chart Overview", () => {
    const selection = resolveSelection({
      selectedOverlay: null,
      selectedStyle: null,
      pinnedCandleIndex: null,
      displayHistory: history,
      signals: [],
    });
    expect(selection).toEqual({ kind: "overview", label: "Chart Overview" });
  });
});

/* -------------------------------------------------------------------------- */
/* buildChartContext                                                          */
/* -------------------------------------------------------------------------- */

describe("buildChartContext", () => {
  const history: HistoryPoint[] = [
    bar("2024-01-01", 100, { volume: 1000 }),
    bar("2024-01-02", 105, { volume: 1000 }),
    bar("2024-01-03", 110, { volume: 3000 }),
  ];
  const fullVisibleRange: VisibleRange = { from: 0, to: 2, realFrom: 0, realTo: 2 } as VisibleRange;

  function base(overrides: Partial<Parameters<typeof buildChartContext>[0]> = {}) {
    return buildChartContext({
      symbol: "AAPL",
      period: "1M",
      candleInterval: "1D",
      indicators: NO_INDICATORS,
      displayHistory: history,
      signals: [],
      news: undefined,
      visibleRange: fullVisibleRange,
      selectedOverlay: null,
      selectedStyle: null,
      allOverlays: [],
      pinnedCandleIndex: null,
      ...overrides,
    });
  }

  it("computes visible range, price range, and a positive trend summary", () => {
    const ctx = base();
    expect(ctx.visibleCandleCount).toBe(3);
    expect(ctx.visibleDateRange).toEqual({ from: "2024-01-01", to: "2024-01-03" });
    expect(ctx.visiblePriceRange).toEqual({ low: 99, high: 111 });
    expect(ctx.trendSummary).toContain("+10.0%");
  });

  it("flags an above-average volume bar in the summary (needs >= 20 bars for the SMA to resolve)", () => {
    const longHistory: HistoryPoint[] = Array.from({ length: 20 }, (_, i) => bar(`2024-02-${String(i + 1).padStart(2, "0")}`, 100 + i, { volume: 1000 }));
    longHistory[longHistory.length - 1] = { ...longHistory[longHistory.length - 1], volume: 3000 };
    const longRange: VisibleRange = { from: 0, to: 19, realFrom: 0, realTo: 19 } as VisibleRange;
    const ctx = base({ displayHistory: longHistory, visibleRange: longRange });
    expect(ctx.volumeSummary).toMatch(/[\d.]+x its 20-bar average volume/);
  });

  it("lists only enabled indicators", () => {
    const ctx = base({ indicators: { ...NO_INDICATORS, sma50: true, rsi: true } });
    expect(ctx.indicatorsEnabled.sort()).toEqual(["rsi", "sma50"]);
  });

  it("caps otherDrawings to 15 and excludes the selected overlay", () => {
    const selected = fakeOverlay("sel", "segment");
    const others = Array.from({ length: 20 }, (_, i) => fakeOverlay(`o${i}`, "rect"));
    const ctx = base({ selectedOverlay: selected, allOverlays: [selected, ...others] });
    expect(ctx.otherDrawings.length).toBe(15);
    expect(ctx.otherDrawings.every((d) => d.type === "rectangle")).toBe(true);
  });

  it("filters nearby news to within 5 days of the anchor date, closest first, capped to 3", () => {
    const news: NewsItem[] = [
      { headline: "far", source: "s", url: "u", publishedAt: "2024-01-20", tickers: [], summary: null },
      { headline: "close-2", source: "s", url: "u", publishedAt: "2024-01-04", tickers: [], summary: null },
      { headline: "closest", source: "s", url: "u", publishedAt: "2024-01-03", tickers: [], summary: null },
      { headline: "close-3", source: "s", url: "u", publishedAt: "2024-01-06", tickers: [], summary: null },
      { headline: "close-4", source: "s", url: "u", publishedAt: "2024-01-07", tickers: [], summary: null },
    ];
    const ctx = base({ news });
    expect(ctx.nearbyNews.map((n) => n.headline)).toEqual(["closest", "close-2", "close-3"]);
  });

  it("returns a neutral volume summary when no bars have volume data", () => {
    const noVolumeHistory = history.map((h) => ({ ...h, volume: undefined }));
    const ctx = base({ displayHistory: noVolumeHistory });
    expect(ctx.volumeSummary).toBe("Volume data unavailable.");
  });

  it("selection defaults to Chart Overview when nothing is selected or pinned", () => {
    const ctx = base();
    expect(ctx.selection).toEqual({ kind: "overview", label: "Chart Overview" });
  });
});
