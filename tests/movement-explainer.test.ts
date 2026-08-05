import { describe, expect, it } from "vitest";
import { windowReturn, volumeAnomaly, parseMovementResponse } from "@/lib/movement-explainer";
import type { HistoryPoint } from "@/lib/types";

function history(closes: number[], volumes?: number[]): HistoryPoint[] {
  const now = new Date();
  return closes.map((close, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (closes.length - 1 - i));
    return { date: d.toISOString().slice(0, 10), close, volume: volumes?.[i] };
  });
}

describe("windowReturn", () => {
  it("returns null with fewer than 2 points", () => {
    expect(windowReturn(history([100]), 5)).toBeNull();
    expect(windowReturn([], 5)).toBeNull();
  });

  it("computes percent return over the window", () => {
    const h = history([100, 105, 110]);
    const r = windowReturn(h, 5);
    expect(r).not.toBeNull();
    expect(r).toBeCloseTo(10, 0); // 100 -> 110 = +10%
  });

  it("guards against a zero-price start point", () => {
    const h: HistoryPoint[] = [
      { date: "2026-06-01", close: 0 },
      { date: "2026-07-01", close: 50 },
    ];
    expect(windowReturn(h, 30)).toBeNull();
  });
});

describe("volumeAnomaly", () => {
  it("returns null without enough history", () => {
    expect(volumeAnomaly(history([100, 101, 102]))).toBeNull();
  });

  it("detects elevated recent volume vs. baseline", () => {
    const closes = Array.from({ length: 26 }, (_, i) => 100 + i);
    const volumes = Array.from({ length: 26 }, (_, i) => (i >= 23 ? 500_000 : 100_000));
    const h = history(closes, volumes);
    const anomaly = volumeAnomaly(h);
    expect(anomaly).not.toBeNull();
    expect(anomaly!).toBeGreaterThan(0);
  });

  it("returns null when volume data is missing", () => {
    const closes = Array.from({ length: 26 }, (_, i) => 100 + i);
    const h = history(closes); // no volumes
    expect(volumeAnomaly(h)).toBeNull();
  });
});

describe("parseMovementResponse", () => {
  it("defaults confidence/persistence when a valid parse omits them", () => {
    const raw = '{"summary":"Rate cut drove the rally.","drivers":[]}';
    const movement = parseMovementResponse(raw);
    expect(movement.summary).toBe("Rate cut drove the rally.");
    expect(movement.confidence).toBe(0);
    expect(movement.persistence).toBe("transient");
  });

  it("joins a driver's evidence array instead of crashing on .map/.length downstream", () => {
    const raw = '{"summary":"ok","drivers":[{"category":"macro","description":"d","evidence":["a","b"],"direction":"bullish"}]}';
    const movement = parseMovementResponse(raw);
    expect(movement.drivers).toHaveLength(1);
    expect(movement.drivers[0].evidence).toBe("a; b");
  });

  it("normalizes an invented direction/persistence variant to a safe enum value", () => {
    const raw = '{"summary":"ok","drivers":[{"direction":"Very Bullish"}],"persistence":"long-term"}';
    const movement = parseMovementResponse(raw);
    expect(movement.drivers[0].direction).toBe("neutral");
    expect(movement.persistence).toBe("transient");
  });

  it("returns the unavailable-message default on total garbage instead of throwing", () => {
    const movement = parseMovementResponse("the model refused to answer");
    expect(movement.summary).toBe("Unable to generate an explanation — insufficient evidence or AI unavailable.");
    expect(movement.drivers).toEqual([]);
  });
});

describe("window source selection (F-22a)", () => {
  // windowReturn derives from daily bars, which lag the live session; the
  // 1-day path must therefore prefer the quote. Multi-day windows keep bars.
  it("windowReturn stays the multi-day source and quote is only its fallback", () => {
    const history = [
      { date: "2026-08-01", close: 100, adjClose: 100 },
      { date: "2026-08-04", close: 102, adjClose: 102 },
      { date: "2026-08-05", close: 103, adjClose: 103 },
    ];
    expect(windowReturn(history, 5)).toBeCloseTo(3);
    // 1-day from bars would be yesterday's close-to-close — the wrong quantity
    // for "today"; the explain path now takes quote.changePercent first.
    expect(windowReturn(history, 1)).toBeCloseTo((103 - 102) / 102 * 100);
  });
});
