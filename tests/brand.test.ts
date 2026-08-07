import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BRAND_COLORS,
  MARK_BARS,
  MARK_BAR_HEIGHT,
  MARK_BAR_RADIUS,
  MARK_TERMINUS,
  MARK_TERMINUS_CENTER,
  MARK_VIEWBOX,
  markDocument,
  markMarkup,
} from "@/lib/brand/mark";

/**
 * Pins the properties of the logo that make it a logo.
 *
 * These are not style preferences — each one encodes a defect the mark had at
 * some point during the branding pass, and each is invisible to `tsc` and to a
 * glance at a 96px render. Judge the mark at 16px; assert it here.
 */
describe("brand mark geometry", () => {
  it("converges: every bar is strictly narrower than the one above it", () => {
    const widths = MARK_BARS.map((b) => b.width);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
  });

  it("continues converging past the last bar — the diamond is narrower than bar 4", () => {
    const diamondWidth = MARK_TERMINUS.size * Math.SQRT2;
    const lastBar = MARK_BARS[MARK_BARS.length - 1];
    expect(diamondWidth).toBeLessThan(lastBar.width);
  });

  it("centres every element on the grid's vertical axis", () => {
    const axis = MARK_VIEWBOX / 2;
    for (const bar of MARK_BARS) {
      expect(bar.x + bar.width / 2).toBeCloseTo(axis, 6);
    }
    expect(MARK_TERMINUS_CENTER.x).toBeCloseTo(axis, 6);
  });

  it("leaves a gap between the last bar and the rotated diamond's top vertex", () => {
    const lastBar = MARK_BARS[MARK_BARS.length - 1];
    const barBottom = lastBar.y + MARK_BAR_HEIGHT;
    // Rotating a square 45° about its centre puts its top vertex a half-diagonal
    // above that centre.
    const halfDiagonal = (MARK_TERMINUS.size * Math.SQRT2) / 2;
    const diamondTop = MARK_TERMINUS_CENTER.y - halfDiagonal;
    // An earlier draft overlapped these, which fused the terminus into the bar
    // above it at header sizes and turned the point into a blob.
    expect(diamondTop).toBeGreaterThan(barBottom);
  });

  it("fits inside the viewBox, with balanced optical padding", () => {
    const halfDiagonal = (MARK_TERMINUS.size * Math.SQRT2) / 2;
    const top = MARK_BARS[0].y;
    const bottom = MARK_TERMINUS_CENTER.y + halfDiagonal;
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(MARK_VIEWBOX);
    // Within a unit of each other; anything looser reads as vertically adrift.
    expect(Math.abs(top - (MARK_VIEWBOX - bottom))).toBeLessThan(1);
  });

  it("keeps bars as true pills and no bar faint enough to disappear at 16px", () => {
    expect(MARK_BAR_RADIUS).toBeCloseTo(MARK_BAR_HEIGHT / 2, 6);
    for (const bar of MARK_BARS) {
      expect(bar.opacity).toBeGreaterThanOrEqual(0.55);
      expect(bar.opacity).toBeLessThanOrEqual(1);
    }
    // The last bar is the fully-opaque anchor of the gradient.
    expect(MARK_BARS[MARK_BARS.length - 1].opacity).toBe(1);
  });
});

describe("brand mark markup", () => {
  it("rotates the terminus for the resolved logo and not for the loading state", () => {
    const ink = "#111111";
    const brand = "#38bdf8";
    expect(markMarkup({ ink, brand, state: "done" })).toContain("rotate(45");
    expect(markMarkup({ ink, brand, state: "loading" })).not.toContain("rotate");
  });

  it("emits one rect per bar plus the terminus", () => {
    const rects = markMarkup({ ink: "#000", brand: "#fff" }).match(/<rect /g) ?? [];
    expect(rects).toHaveLength(MARK_BARS.length + 1);
  });

  it("draws a tile and insets the mark only when asked", () => {
    const bare = markDocument({ ink: "#000", brand: "#fff" });
    const tile = markDocument({ ink: "#000", brand: "#fff", background: "#0a0b0e", padded: true });
    expect(bare).not.toContain("#0a0b0e");
    expect(bare).toContain("scale(1)");
    expect(tile).toContain("#0a0b0e");
    // Padded assets must actually shrink, or a maskable PWA icon gets cropped.
    expect(tile).toMatch(/scale\(0\.\d+\)/);
  });

  it("ships a colour pair for both themes, brand distinct from ink", () => {
    for (const scheme of ["dark", "light"] as const) {
      const c = BRAND_COLORS[scheme];
      expect(c.ink).not.toBe(c.brand);
      expect(c.ink).not.toBe(c.background);
      expect(c.brand).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

/**
 * `BRAND_COLORS` is hand-copied from app/globals.css, because favicons, the web
 * manifest and PDF exports cannot read CSS custom properties. Nothing about the
 * language enforces that copy — so this does.
 *
 * Without it, docs/brand-guidelines.md §14 Phase 1 (swapping `--brand` from
 * sky-blue to brass) would turn the app brass while the browser tab, the
 * installed-app icon and every exported PDF silently stayed blue, with a green
 * typecheck and a green test suite. That is exactly how `chart-theme.ts` — the
 * other file holding literal copies of these tokens — became a documented delta.
 */
describe("BRAND_COLORS tracks app/globals.css", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  /** Read a custom property out of a specific theme block. Anchored to the
   *  selector opening its own rule (`selector {`) so other appearances of the
   *  attribute string — e.g. @custom-variant declarations — cannot match. */
  function token(selector: string, name: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`rule block not found for ${selector}`);
    const block = css.slice(start);
    const end = block.indexOf("\n}");
    const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(block.slice(0, end));
    if (!match) throw new Error(`--${name} not found in ${selector} block`);
    return match[1].toLowerCase();
  }

  it.each([
    ["dark", ":root,\n[data-theme=\"dark\"]"],
    ["light", '[data-theme="light"]'],
  ] as const)("%s scheme matches the stylesheet", (scheme, selector) => {
    const c = BRAND_COLORS[scheme];
    expect(c.brand).toBe(token(selector, "brand"));
    expect(c.ink).toBe(token(selector, "foreground"));
    expect(c.background).toBe(token(selector, "background"));
  });
});
