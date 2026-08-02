import {
  BRAND_COLORS,
  MARK_BARS,
  MARK_BAR_HEIGHT,
  MARK_BAR_RADIUS,
  MARK_TERMINUS,
  MARK_TERMINUS_CENTER,
  MARK_VIEWBOX,
  type BrandScheme,
} from "./mark";

/**
 * Draws the UAA mark into a PDFKit document.
 *
 * Exported PDFs are the only artefact of this product that leaves the machine
 * and gets handed to another person, and they carried the product's name in
 * 7pt Helvetica and nothing else. A report with a logo on it is a document from
 * a tool; a report with only a footnote is a document from a script.
 *
 * Geometry is the same MARK_BARS/MARK_TERMINUS the header renders — PDFKit has
 * no SVG support, so the rects are replayed as `roundedRect` calls against the
 * same 32-unit grid, scaled to `size`. Colours come from BRAND_COLORS because a
 * PDF has no CSS custom properties; `scheme` picks the pair that reads on the
 * page's own background (dark ink for white paper, light ink for a dark banner).
 */
export function drawBrandMark(
  doc: PDFKit.PDFDocument,
  {
    x,
    y,
    size,
    scheme = "light",
  }: { x: number; y: number; size: number; scheme?: BrandScheme },
): void {
  const { ink, brand } = BRAND_COLORS[scheme];
  const k = size / MARK_VIEWBOX;

  // `save`/`restore` around the whole mark: fillOpacity and fillColor are
  // document-level state in PDFKit, and leaking a 0.55 opacity into the caller's
  // next `.text()` silently washes out whatever it draws afterwards.
  doc.save();

  for (const bar of MARK_BARS) {
    doc
      .fillOpacity(bar.opacity)
      .roundedRect(x + bar.x * k, y + bar.y * k, bar.width * k, MARK_BAR_HEIGHT * k, MARK_BAR_RADIUS * k)
      .fill(ink);
  }

  // The terminus is stored unrotated (the loading-state square); rotate about
  // its own centre to get the diamond, exactly as the CSS does.
  doc
    .fillOpacity(1)
    .rotate(45, { origin: [x + MARK_TERMINUS_CENTER.x * k, y + MARK_TERMINUS_CENTER.y * k] })
    .roundedRect(
      x + MARK_TERMINUS.x * k,
      y + MARK_TERMINUS.y * k,
      MARK_TERMINUS.size * k,
      MARK_TERMINUS.size * k,
      MARK_TERMINUS.radius * k,
    )
    .fill(brand);

  doc.restore();
}
