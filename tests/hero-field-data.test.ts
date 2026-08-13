import { describe, expect, it } from "vitest";
import { buildHeroSeries, gaussianSmooth, magnitudeQuantile, packHeroSeries, resampleLinear } from "@/app/landing/_components/ink/hero-data";
import { rectFalloffField, SDF_FALLOFF_PX } from "@/app/landing/_components/ink/hero-sdf";
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

describe("hero text-exclusion falloff field", () => {
  it("is fully open with no rects", () => {
    const f = rectFalloffField([], 8, 8, 800, 400);
    expect(f.every((v) => v === 255)).toBe(true);
  });

  it("is 0 inside a rect and ramps smoothly to 255 at the falloff radius", () => {
    const w = 64;
    const h = 32;
    const cssW = 1280;
    const cssH = 640;
    const rect = { x0: 100, y0: 100, x1: 300, y1: 200 };
    const f = rectFalloffField([rect], w, h, cssW, cssH);
    const at = (x: number, y: number) => f[Math.floor((y / cssH) * h) * w + Math.floor((x / cssW) * w)];
    expect(at(200, 150)).toBe(0); // inside
    const near = at(300 + 40, 150);
    const far = at(300 + 120, 150);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near); // monotone falloff
    expect(at(300 + SDF_FALLOFF_PX + 60, 150)).toBe(255); // beyond the radius
  });

  it("takes the union (min distance) over multiple rects", () => {
    const a = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const b = { x0: 500, y0: 0, x1: 600, y1: 100 };
    const one = rectFalloffField([a], 64, 16, 640, 160);
    const both = rectFalloffField([a, b], 64, 16, 640, 160);
    for (let i = 0; i < one.length; i++) expect(both[i]).toBeLessThanOrEqual(one[i]);
  });
});
