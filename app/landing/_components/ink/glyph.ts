"use client";

import { markDocument } from "@/lib/brand/mark";

/**
 * The Seal's point cloud: a Poisson-disk sampled DISC with the
 * asset/analyzer mark as NEGATIVE SPACE. The mark SVG is rasterized to an
 * offscreen canvas at 2x, ImageData is read, and alpha > 128 becomes an
 * exclusion mask; disc candidates inside the mask are rejected. Never a
 * naive grid stride (grid striding produced the rectangular bar artifacts
 * two builds ago).
 *
 * Points are normalized to -1..1 disc space. Loading is async (an <img>
 * decode); until ready, sealPoints() returns null.
 */

const RASTER = 128;
/** The mark occupies this fraction of the disc's diameter. */
const MARK_FRACTION = 0.8;
/** Poisson radius in disc units (-1..1 space): sets packing density. */
const POISSON_R = 0.05;

let points: Float32Array | null = null;
let loading = false;

export function loadSeal(): void {
  if (points || loading || typeof document === "undefined") return;
  loading = true;
  const svg = markDocument({ size: RASTER, ink: "#fff", brand: "#fff" });
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = RASTER;
    const g = canvas.getContext("2d")!;
    g.drawImage(img, 0, 0, RASTER, RASTER);
    const data = g.getImageData(0, 0, RASTER, RASTER).data;
    const sample = (nx: number, ny: number): boolean => {
      // nx,ny in -1..1 disc space -> mark raster coords.
      const mx = (nx / MARK_FRACTION + 1) / 2;
      const my = (ny / MARK_FRACTION + 1) / 2;
      if (mx < 0 || mx >= 1 || my < 0 || my >= 1) return false;
      const px = Math.floor(mx * RASTER);
      const py = Math.floor(my * RASTER);
      return data[(py * RASTER + px) * 4 + 3] > 128;
    };
    // Dilate the exclusion by ~2px of disc space so dot footprints cannot
    // bleed into the negative space and close the mark's counters.
    const M = 0.024;
    const masked = (nx: number, ny: number): boolean =>
      sample(nx, ny) || sample(nx + M, ny) || sample(nx - M, ny) || sample(nx, ny + M) || sample(nx, ny - M);

    // Poisson-disk dart throwing over the unit disc, seeded and gridded.
    let s = 777777;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
    const cell = POISSON_R / Math.SQRT2;
    const gw = Math.ceil(2 / cell);
    const grid = new Int32Array(gw * gw).fill(-1);
    const picked: number[] = [];
    for (let attempt = 0; attempt < 40000 && picked.length / 2 < 1050; attempt++) {
      const x = rnd() * 2 - 1;
      const y = rnd() * 2 - 1;
      if (x * x + y * y > 1) continue; // outside the disc
      if (masked(x, y)) continue; // inside the mark: negative space
      const gx = Math.floor((x + 1) / cell);
      const gy = Math.floor((y + 1) / cell);
      let ok = true;
      for (let oy = -2; oy <= 2 && ok; oy++) {
        for (let ox = -2; ox <= 2 && ok; ox++) {
          const cx2 = gx + ox;
          const cy2 = gy + oy;
          if (cx2 < 0 || cy2 < 0 || cx2 >= gw || cy2 >= gw) continue;
          const pi = grid[cy2 * gw + cx2];
          if (pi < 0) continue;
          const dx = picked[pi * 2] - x;
          const dy = picked[pi * 2 + 1] - y;
          if (dx * dx + dy * dy < POISSON_R * POISSON_R) ok = false;
        }
      }
      if (!ok) continue;
      grid[gy * gw + gx] = picked.length / 2;
      picked.push(x, y);
    }
    points = Float32Array.from(picked);
    loading = false;
  };
  img.onerror = () => {
    loading = false;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Disc points [x0,y0,...] in -1..1 (mark excluded), or null while loading. */
export function sealPoints(): Float32Array | null {
  return points;
}
