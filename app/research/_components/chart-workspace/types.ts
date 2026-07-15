/**
 * Object Architecture for the technical analysis workspace's drawings.
 *
 * `DrawingObject` is deliberately rich (id, type, ticker, timeframe,
 * coordinates/anchors, timestamps, styling, and a reserved `metadata` bag) so
 * a later phase can attach AI features (Explain/Validate/Suggest) directly to
 * any drawing without a schema change. No AI logic reads or writes `metadata`
 * in this phase.
 */

export type DrawingCategory =
  | "trend"
  | "levels"
  | "fibonacci"
  | "trade-planning"
  | "annotations"
  | "utilities";

export type DrawingToolId =
  | "trend-line"
  | "parallel-channel"
  | "pitchfork"
  | "horizontal-line"
  | "horizontal-ray"
  | "rectangle"
  | "fib-retracement"
  | "fib-extension"
  | "risk-reward"
  | "measure"
  | "arrow"
  | "text"
  | "callout"
  | "cursor"
  | "crosshair"
  | "brush";

export interface DrawingStyle {
  color: string;
  opacity: number; // 0-1
  thickness: number; // px
  lineStyle: "solid" | "dashed" | "dotted";
  textSize: number; // px
}

export interface DrawingPoint {
  timestamp: number;
  value: number;
}

/**
 * A single persisted drawing. `id` is a client-generated identifier
 * (independent of the SQLite autoincrement row id, which is an internal
 * storage detail exposed only by `lib/db.ts`'s `ChartDrawingRecord`).
 */
export interface DrawingObject {
  id: string;
  type: DrawingToolId;
  symbol: string;
  timeframe: string;
  points: DrawingPoint[];
  style: DrawingStyle;
  locked: boolean;
  hidden: boolean;
  createdAt: number; // Unix ms
  updatedAt: number; // Unix ms
  /** Reserved for future AI features (Explain/Validate/Suggest). Unused in Phase 1. */
  metadata: Record<string, unknown>;
}

export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  color: "#60a5fa",
  opacity: 1,
  thickness: 1.5,
  lineStyle: "solid",
  textSize: 12,
};

/** How much historical data is displayed — independent of Candle Interval (what each bar represents). */
export type PeriodKey = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "Max";

/**
 * What each candlestick represents. 5m/15m/30m/1H/4H are real intraday bars
 * (5m/15m/30m fetched directly from Yahoo via /api/chart-history; 1H is
 * Yahoo's native "60m"; 4H is aggregated client-side from 60m bars since
 * Yahoo has no native 4h interval). 1D is the daily history already on the
 * page; 1W/1M are aggregated client-side from that same daily data — see
 * lib/chart-aggregation.ts. Independent of PeriodKey: changing one never
 * changes the other.
 */
export type CandleIntervalKey = "5m" | "15m" | "30m" | "1H" | "4H" | "1D" | "1W" | "1M";

export type IndicatorKey = "sma50" | "sma200" | "boll" | "rsi" | "macd";
