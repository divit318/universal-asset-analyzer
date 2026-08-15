import { describe, expect, it } from "vitest";
import { buildHeroSeries, gaussianSmooth, magnitudeQuantile, packHeroSeries, resampleLinear } from "@/app/landing/_components/ink/hero-data";
import { keepFactor } from "@/app/landing/_components/meridian/plate";
import { computeGeometry, deriveStations, limbPoint, stationPoint, STATION_COUNT } from "@/app/landing/_components/meridian/stations";
import series from "@/app/landing/_components/ink/hero-series.json";

describe("hero series bake math", () => {
  it("resampleLinear preserves endpoints and length", () => {
    const out = resampleLinear([1, 2, 3, 4], 7);
    expect(out).toHaveLength(7);
    expect(out[0]).toBe(1);
    expect(out[6]).toBe(4);
    expect(out[3]).toBeCloseTo(2.5);
  });

  it("gaussianSmooth preserves a constant series and damps a spike", () => {
    expect(gaussianSmooth([5, 5, 5, 5, 5], 2).every((v) => Math.abs(v - 5) < 1e-9)).toBe(true);
    const spike = new Array(101).fill(0);
    spike[50] = 1;
    const smoothed = gaussianSmooth(spike, 4);
    expect(smoothed[50]).toBeLessThan(0.2);
    expect(smoothed[50]).toBeGreaterThan(smoothed[30]);
  });

  it("magnitudeQuantile is robust to a single outlier", () => {
    const vals = new Array(99).fill(1).concat([1000]);
    expect(magnitudeQuantile(vals, 0.95)).toBeLessThan(10);
  });

  it("buildHeroSeries emits normalized channels of the requested length", () => {
    const closes = Array.from({ length: 1000 }, (_, i) => 100 * Math.exp(0.001 * i + 0.02 * Math.sin(i / 7)));
    const asset = buildHeroSeries(closes, { index: "T", symbol: "^T", source: "test", start: "2000-01-01", end: "2004-01-01", n: 256, sigma: 6 });
    expect(asset.smooth).toHaveLength(256);
    expect(asset.deriv).toHaveLength(256);
    expect(asset.vol).toHaveLength(256);
    expect(asset.resid).toHaveLength(256);
    expect(Math.min(...asset.smooth)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...asset.smooth)).toBeLessThanOrEqual(1);
    expect(Math.min(...asset.deriv)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...asset.deriv)).toBeLessThanOrEqual(1);
    expect(Math.min(...asset.vol)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...asset.vol)).toBeLessThanOrEqual(1);
    expect(Math.min(...asset.resid)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...asset.resid)).toBeLessThanOrEqual(1);
  });

  it("refuses degenerate input", () => {
    expect(() => buildHeroSeries([1, 2, 3], { index: "T", symbol: "^T", source: "t", start: "a", end: "b" })).toThrow();
    expect(() => buildHeroSeries(new Array(100).fill(-1), { index: "T", symbol: "^T", source: "t", start: "a", end: "b" })).toThrow();
  });

  it("packHeroSeries interleaves RGBA with derivative and residual biased", () => {
    const packed = packHeroSeries({ points: 2, smooth: [0, 1], deriv: [-1, 1], vol: [0, 1], resid: [0, 0] });
    expect(Array.from(packed)).toEqual([0, 0, 0, 128, 255, 255, 255, 128]);
  });
});

describe("committed hero-series.json asset", () => {
  it("is the NIFTY 50 with consistent channels (the attribution line depends on this)", () => {
    expect(series.index).toBe("NIFTY 50");
    expect(series.symbol).toBe("^NSEI");
    expect(series.points).toBeGreaterThanOrEqual(400);
    expect(series.points).toBeLessThanOrEqual(600);
    for (const ch of [series.smooth, series.deriv, series.vol, series.resid]) expect(ch).toHaveLength(series.points);
    expect(series.start < series.end).toBe(true);
    expect(Math.min(...series.smooth)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...series.smooth)).toBeLessThanOrEqual(1);
    expect(Math.min(...series.deriv)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...series.vol)).toBeLessThanOrEqual(1);
  });

  it("carries real macro structure, not a flat line", () => {
    // The smoothed sweep must span its normalized range and the 2008 and
    // 2020 volatility regimes must register above the median.
    const volSorted = [...series.vol].sort((a, b) => a - b);
    const median = volSorted[Math.floor(volSorted.length / 2)];
    expect(Math.max(...series.vol)).toBeGreaterThan(median * 2);
    expect(series.deriv.some((v) => v < 0)).toBe(true);
    expect(series.deriv.some((v) => v > 0)).toBe(true);
  });
});

describe("meridian geometry", () => {
  const geo = computeGeometry(1440, 900, false);

  it("the limb is a dome across the upper third, bleeding off both edges", () => {
    const left = limbPoint(geo, geo.phi0);
    const apex = limbPoint(geo, 0);
    const right = limbPoint(geo, geo.phi1);
    expect(left.x).toBeLessThan(0); // off the left edge
    expect(right.x).toBeGreaterThan(1440); // off the right edge
    expect(apex.y).toBeCloseTo(900 * 0.24, 0);
    expect(left.y).toBeGreaterThan(apex.y); // dome, not a line
    expect(right.y).toBeGreaterThan(apex.y);
    expect(left.y).toBeLessThan(900); // still on the plate
  });

  it("derives one station per calendar year of the committed series", () => {
    const stations = deriveStations(series);
    expect(stations).toHaveLength(STATION_COUNT);
    expect(stations[0].year).toBe(2007);
    expect(stations[stations.length - 1].year).toBe(2026);
    for (const s of stations) {
      expect(s.v).toBeGreaterThanOrEqual(0);
      expect(s.v).toBeLessThanOrEqual(1);
    }
    // Time is monotone left → right across the sky.
    const xs = stations.map((s) => stationPoint(geo, s, false).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it("stations hang ABOVE the limb, clear of the nav band", () => {
    const stations = deriveStations(series);
    for (const s of stations) {
      const p = stationPoint(geo, s, false);
      if (p.x < 0 || p.x > geo.w) continue; // off-plate stations are clipped anyway
      const phi = Math.asin((p.x - geo.cx) / geo.R);
      expect(p.y).toBeLessThan(limbPoint(geo, phi).y); // above the arc
      expect(p.y).toBeGreaterThanOrEqual(900 * 0.11 - 1e-6); // below the nav
    }
  });
});

describe("meridian keep-out falloff", () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 };

  it("is fully open with no rects and floors near zero inside a rect", () => {
    expect(keepFactor([], 400, 400)).toBe(1);
    expect(keepFactor([rect], 200, 150)).toBeLessThanOrEqual(0.05);
  });

  it("ramps monotonically from the rect edge to open space", () => {
    const near = keepFactor([rect], 340, 150); // 14px past pad
    const far = keepFactor([rect], 420, 150);
    expect(near).toBeGreaterThan(0.04);
    expect(far).toBeGreaterThan(near);
    expect(keepFactor([rect], 600, 150)).toBe(1); // beyond the feather
  });

  it("takes the union (minimum) over multiple rects", () => {
    const b = { x: 500, y: 100, w: 100, h: 100 };
    const one = keepFactor([rect], 450, 150);
    const both = keepFactor([rect, b], 450, 150);
    expect(both).toBeLessThanOrEqual(one);
  });
});
