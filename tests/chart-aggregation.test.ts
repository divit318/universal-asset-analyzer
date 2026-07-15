import { describe, expect, it } from "vitest";
import {
  aggregateBars,
  aggregateToFourHour,
  aggregateToMonthly,
  aggregateToWeekly,
} from "@/lib/chart-aggregation";
import type { HistoryPoint } from "@/lib/types";

function bar(date: string, open: number, high: number, low: number, close: number, volume = 1000): HistoryPoint {
  return { date, open, high, low, close, volume };
}

/* -------------------------------------------------------------------------- */
/* aggregateBars                                                              */
/* -------------------------------------------------------------------------- */

describe("aggregateBars", () => {
  const fourBars: HistoryPoint[] = [
    bar("2024-01-01T09:00", 100, 105, 99, 102, 1000),
    bar("2024-01-01T10:00", 102, 108, 101, 106, 1200),
    bar("2024-01-01T11:00", 106, 110, 104, 103, 900),
    bar("2024-01-01T12:00", 103, 107, 100, 105, 1100),
  ];

  it("combines a full group: open=first, close=last, high=max, low=min, volume=sum", () => {
    const [out] = aggregateBars(fourBars, 4);
    expect(out).toEqual({
      date: "2024-01-01T09:00",
      open: 100,
      high: 110,
      low: 99,
      close: 105,
      adjClose: 105,
      volume: 4200,
    });
  });

  it("still aggregates a trailing partial group instead of dropping it", () => {
    const fifth = bar("2024-01-01T13:00", 105, 106, 103, 104, 500);
    const out = aggregateBars([...fourBars, fifth], 4);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ date: "2024-01-01T13:00", open: 105, high: 106, low: 103, close: 104, volume: 500 });
  });

  it("returns the input unchanged for groupSize <= 1", () => {
    expect(aggregateBars(fourBars, 1)).toBe(fourBars);
  });

  it("returns an empty array for empty input", () => {
    expect(aggregateBars([], 4)).toEqual([]);
  });

  it("handles a single-bar group as itself", () => {
    const [single] = aggregateBars([fourBars[0]], 4);
    expect(single).toEqual({ ...fourBars[0], adjClose: fourBars[0].close });
  });
});

/* -------------------------------------------------------------------------- */
/* aggregateToFourHour                                                       */
/* -------------------------------------------------------------------------- */

describe("aggregateToFourHour", () => {
  it("groups 4 consecutive hourly bars into one 4-hour bar", () => {
    const hourly = [
      bar("2024-01-01T09:00", 100, 105, 99, 102),
      bar("2024-01-01T10:00", 102, 108, 101, 106),
      bar("2024-01-01T11:00", 106, 110, 104, 103),
      bar("2024-01-01T12:00", 103, 107, 100, 105),
      bar("2024-01-01T13:00", 105, 109, 104, 108),
    ];
    const out = aggregateToFourHour(hourly);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ open: 100, high: 110, low: 99, close: 105 });
    expect(out[1]).toMatchObject({ open: 105, high: 109, low: 104, close: 108 });
  });
});

/* -------------------------------------------------------------------------- */
/* aggregateToWeekly                                                          */
/* -------------------------------------------------------------------------- */

describe("aggregateToWeekly", () => {
  it("groups daily bars into calendar weeks (Monday start)", () => {
    // 2024-01-01 is a Monday; Jan 1-5 is one trading week, Jan 8 starts the next.
    const daily = [
      bar("2024-01-01", 100, 102, 99, 101),
      bar("2024-01-02", 101, 103, 100, 102),
      bar("2024-01-03", 102, 104, 101, 103),
      bar("2024-01-04", 103, 106, 102, 105),
      bar("2024-01-05", 105, 107, 104, 106),
      bar("2024-01-08", 106, 108, 105, 107),
    ];
    const out = aggregateToWeekly(daily);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: "2024-01-01", open: 100, high: 107, low: 99, close: 106 });
    expect(out[1]).toMatchObject({ date: "2024-01-08", open: 106, high: 108, low: 105, close: 107 });
  });
});

/* -------------------------------------------------------------------------- */
/* aggregateToMonthly                                                         */
/* -------------------------------------------------------------------------- */

describe("aggregateToMonthly", () => {
  it("groups daily bars into calendar months", () => {
    const daily = [
      bar("2024-01-30", 100, 102, 99, 101),
      bar("2024-01-31", 101, 103, 100, 102),
      bar("2024-02-01", 102, 105, 101, 104),
      bar("2024-02-02", 104, 106, 103, 105),
    ];
    const out = aggregateToMonthly(daily);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: "2024-01-30", open: 100, high: 103, low: 99, close: 102 });
    expect(out[1]).toMatchObject({ date: "2024-02-01", open: 102, high: 106, low: 101, close: 105 });
  });

  it("returns an empty array for empty input", () => {
    expect(aggregateToMonthly([])).toEqual([]);
    expect(aggregateToWeekly([])).toEqual([]);
  });
});
