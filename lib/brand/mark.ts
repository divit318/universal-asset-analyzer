/**
 * The UAA logo — "Convergence Point" — as data.
 *
 * ONE definition of the mark's geometry, for every consumer: the React
 * `<BrandMark>`/`<BrandLockup>` in app/_components/brand.tsx, the animated
 * `<LoadingMark>` that resolves *into* it, and the static asset generator
 * (scripts/generate-brand-assets.ts) that emits favicon.ico / icon.svg /
 * apple-icon.png / public/brand/*.svg.
 *
 * Before this file existed the mark was defined once, inline, inside
 * loading-mark.tsx — so the only place the logo appeared was the loading
 * spinner, and every header "logo" was a Unicode `◆` next to some text. Two
 * different shapes claiming to be the same brand. Anything that draws the mark
 * now reads it from here, which is what makes "identical everywhere" a
 * structural property rather than a promise.
 *
 * ── The idea ────────────────────────────────────────────────────────────────
 * Four bars of decreasing width converge downward into a single point: a lot of
 * noisy inputs (prices, filings, fundamentals, news) narrowing to one decision.
 * The terminus is the answer, and it is the only element that carries brand
 * colour — the same rule the icon set follows (every dot is a brand diamond).
 *
 * ── Resolved vs unresolved ──────────────────────────────────────────────────
 * The terminus is a DIAMOND (a square rotated 45°) in the logo, and an
 * unrotated SQUARE while work is in flight. That is the one piece of semantics
 * the geometry carries, and it is why `<LoadingMark state="done">` lands
 * pixel-exactly on the logo in the header: same rects, same numbers, only the
 * rotation differs.
 *
 * ── Why these numbers ───────────────────────────────────────────────────────
 * Widths 24 → 19 → 14 → 9 step by a constant 5, and the diamond's width
 * (5.2 × √2 ≈ 7.35) continues that narrowing past the last bar, so the
 * convergence reads as one uninterrupted gesture. Bars are fully rounded
 * (rx = height / 2). The 4.4 pitch leaves a 1.0 gap between the last bar and
 * the diamond's top vertex: an earlier draft overlapped them, which at 16-20px
 * fused the point into the bar above it and turned the terminus into a blob.
 * Optical padding is balanced top (4.0) and bottom (3.64).
 *
 * Bar height is 2.8 (8.75% of the grid) and the faintest bar sits at 0.55, not
 * the 0.45 an earlier draft used. Both exist for the same reason: at the 18-22px
 * the header actually renders, a 2.4-unit bar is ~1.4 device pixels and 0.45
 * opacity took the top two bars to the edge of invisible — the mark read as a
 * lone blue diamond with some smudge above it. Judge any future change to these
 * two numbers at 16px on both themes, not at 96px.
 */

export const MARK_VIEWBOX = 32;

/** Height of every bar. Bars are pills: rx is exactly half of this. */
export const MARK_BAR_HEIGHT = 2.8;
export const MARK_BAR_RADIUS = MARK_BAR_HEIGHT / 2;

export interface MarkBar {
  /** Left edge, in viewBox units. Every bar is centred on x = 16. */
  x: number;
  y: number;
  width: number;
  /**
   * Resting opacity — the convergence gradient. Also the `--mark-rest` value
   * the loading animation returns to, so the wave never resolves to a flat
   * stack of four identical bars.
   */
  opacity: number;
}

export const MARK_BARS: readonly MarkBar[] = [
  { x: 4, y: 4, width: 24, opacity: 0.55 },
  { x: 6.5, y: 8.4, width: 19, opacity: 0.7 },
  { x: 9, y: 12.8, width: 14, opacity: 0.85 },
  { x: 11.5, y: 17.2, width: 9, opacity: 1 },
] as const;

/**
 * The terminus, expressed as an axis-aligned square. Consumers rotate it 45°
 * about its own centre (`transform-box: fill-box; transform-origin: center` in
 * CSS, or an explicit `rotate(45 cx cy)` in a standalone SVG) to get the
 * diamond. Never bake the rotation into the coordinates — the loading state
 * needs the unrotated square.
 */
export const MARK_TERMINUS = { x: 13.4, y: 22.08, size: 5.2, radius: 1.05 } as const;

export const MARK_TERMINUS_CENTER = {
  x: MARK_TERMINUS.x + MARK_TERMINUS.size / 2,
  y: MARK_TERMINUS.y + MARK_TERMINUS.size / 2,
} as const;

/**
 * Brand palette for contexts that cannot read CSS custom properties — favicons,
 * app icons, `app/manifest.ts` theme colours, PDF exports. In the app itself the
 * mark takes its ink from `currentColor` and its terminus from `var(--brand)`;
 * these literals exist only so a generated .ico is not a different blue than the
 * header.
 *
 * ⚠ These are hand-copied from app/globals.css and nothing enforces it. This file
 * is therefore in the same category as app/_components/chart-theme.ts on the
 * "Known deltas" list in docs/brand-guidelines.md §14: when Phase 1 swaps
 * `--brand` from sky-blue to brass, THIS TABLE MUST CHANGE IN THE SAME COMMIT and
 * `npm run brand:assets` must be re-run — otherwise the app goes brass while the
 * browser tab, the installed-app icon and every exported PDF stay blue.
 */
export const BRAND_COLORS = {
  dark: { ink: "#edeff2", brand: "#38bdf8", background: "#0a0b0e" },
  light: { ink: "#101722", brand: "#0284c7", background: "#f7f8fa" },
} as const;

export type BrandScheme = keyof typeof BRAND_COLORS;

/**
 * The mark's `<rect>` elements as an SVG markup string, for standalone files.
 *
 * `state: "done"` (the logo) rotates the terminus; `"loading"` leaves it a
 * square. Static assets always want "done" — a favicon must not depict work in
 * progress.
 */
export function markMarkup({
  ink,
  brand,
  state = "done",
}: {
  ink: string;
  brand: string;
  state?: "done" | "loading";
}): string {
  const bars = MARK_BARS.map(
    (b) =>
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${MARK_BAR_HEIGHT}" rx="${MARK_BAR_RADIUS}" fill="${ink}" fill-opacity="${b.opacity}"/>`,
  );
  const rotate =
    state === "done"
      ? ` transform="rotate(45 ${MARK_TERMINUS_CENTER.x} ${MARK_TERMINUS_CENTER.y})"`
      : "";
  bars.push(
    `<rect x="${MARK_TERMINUS.x}" y="${MARK_TERMINUS.y}" width="${MARK_TERMINUS.size}" height="${MARK_TERMINUS.size}" rx="${MARK_TERMINUS.radius}" fill="${brand}"${rotate}/>`,
  );
  return bars.join("");
}

/**
 * A complete standalone SVG document of the mark.
 *
 * `padded` insets the mark so it survives being drawn on a filled badge (app
 * icons need breathing room inside their tile; a transparent mark for docs does
 * not). `background` draws a rounded tile behind it — that is what makes a
 * favicon legible against both a light and a dark browser tab strip, which a
 * bare `currentColor` mark cannot be.
 */
export function markDocument({
  size = MARK_VIEWBOX,
  ink,
  brand,
  background,
  padded = false,
  title,
}: {
  size?: number;
  ink: string;
  brand: string;
  background?: string;
  padded?: boolean;
  title?: string;
}): string {
  const tile = background
    ? `<rect width="${MARK_VIEWBOX}" height="${MARK_VIEWBOX}" rx="${MARK_VIEWBOX * 0.22}" fill="${background}"/>`
    : "";
  // 0.78 keeps ~11% clear space on each side of the tile — the same optical
  // inset Apple's own icon grid uses, and enough that the 24-wide top bar does
  // not read as touching the tile's edge at 16px.
  const scale = padded ? 0.78 : 1;
  const offset = (MARK_VIEWBOX * (1 - scale)) / 2;
  const inner = `<g transform="translate(${offset} ${offset}) scale(${scale})">${markMarkup({ ink, brand })}</g>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}" fill="none">`,
    title ? `<title>${title}</title>` : "",
    tile,
    inner,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("");
}
