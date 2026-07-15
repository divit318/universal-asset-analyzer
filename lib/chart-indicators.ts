/**
 * Custom klinecharts indicators for the technical analysis workspace
 * (app/research/_components/chart-workspace/), registered under `UAA_`-prefixed
 * names rather than reusing klinecharts' built-in "SMA"/"BOLL"/"RSI"/"MACD" —
 * each `calc` delegates to the exact same functions in `./indicators.ts` that
 * the rest of the app already uses (the inline Recharts chart, the
 * pattern-signals engine), so indicator values never drift between the
 * Fullscreen workspace and everywhere else in UAA. Registration is idempotent
 * and must be called once before any chart instance is created.
 */

import { registerIndicator } from "klinecharts";
import type { KLineData } from "klinecharts";
import { calcBollingerBands, calcMacd, calcRsi, calcSma } from "./indicators";

let registered = false;

export function registerChartIndicators(): void {
  if (registered) return;
  registered = true;

  registerIndicator<{ value?: number }>({
    name: "UAA_SMA50",
    shortName: "SMA 50",
    series: "price",
    precision: 2,
    figures: [{ key: "value", title: "SMA 50: ", type: "line" }],
    calc: (dataList: KLineData[]) => {
      const values = calcSma(dataList.map((d) => d.close), 50);
      return values.map((v) => (v == null ? {} : { value: v }));
    },
  });

  registerIndicator<{ value?: number }>({
    name: "UAA_SMA200",
    shortName: "SMA 200",
    series: "price",
    precision: 2,
    figures: [{ key: "value", title: "SMA 200: ", type: "line" }],
    calc: (dataList: KLineData[]) => {
      const values = calcSma(dataList.map((d) => d.close), 200);
      return values.map((v) => (v == null ? {} : { value: v }));
    },
  });

  registerIndicator<{ up?: number; mid?: number; dn?: number }>({
    name: "UAA_BOLL",
    shortName: "BOLL",
    series: "price",
    precision: 2,
    figures: [
      { key: "up", title: "UP: ", type: "line" },
      { key: "mid", title: "MID: ", type: "line" },
      { key: "dn", title: "DN: ", type: "line" },
    ],
    calc: (dataList: KLineData[]) => {
      const bands = calcBollingerBands(dataList.map((d) => d.close), 20, 2);
      return bands.map((b) => (b.upper == null ? {} : { up: b.upper, mid: b.middle!, dn: b.lower! }));
    },
  });

  registerIndicator<{ value?: number }>({
    name: "UAA_RSI",
    shortName: "RSI",
    series: "normal",
    precision: 2,
    figures: [{ key: "value", title: "RSI: ", type: "line" }],
    calc: (dataList: KLineData[]) => {
      const values = calcRsi(dataList.map((d) => d.close), 14);
      return values.map((v) => (v == null ? {} : { value: v }));
    },
  });

  registerIndicator<{ dif?: number; dea?: number; macd?: number }>({
    name: "UAA_MACD",
    shortName: "MACD",
    series: "normal",
    precision: 3,
    figures: [
      { key: "dif", title: "DIF: ", type: "line" },
      { key: "dea", title: "DEA: ", type: "line" },
      { key: "macd", title: "MACD: ", type: "bar", baseValue: 0 },
    ],
    calc: (dataList: KLineData[]) => {
      const points = calcMacd(dataList.map((d) => d.close));
      return points.map((m) => (m.macd == null ? {} : { dif: m.macd, dea: m.signal!, macd: m.histogram! }));
    },
  });
}
