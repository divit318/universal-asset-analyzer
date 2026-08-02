/**
 * Renders every static brand asset from lib/brand/mark.ts.
 *
 *   node scripts/generate-brand-assets.ts
 *
 * Run this after changing the mark's geometry or the brand colours, and commit
 * the output. The generated files are checked in because Next.js's icon file
 * conventions (app/icon.svg, app/apple-icon.png, app/favicon.ico) are resolved
 * from disk at build time — there is no hook that could produce them lazily.
 *
 * Why generate rather than hand-draw: app/favicon.ico shipped as the stock
 * Next.js placeholder for the life of the project, so every browser tab, every
 * bookmark, and every PWA install showed a logo that was not UAA's. Deriving all
 * of them from the same geometry the header renders is the only way "the logo is
 * consistent everywhere" survives the next tweak to the mark.
 *
 * Assets:
 *   app/favicon.ico          16/32/48 tile, for browsers that still ask for it
 *   app/icon.svg             the modern favicon — vector, sharp at any zoom
 *   app/apple-icon.png       180×180 full-bleed tile (iOS rounds it itself)
 *   public/brand/icon-*.png  PWA install icons, referenced by app/manifest.ts
 *   public/brand/*.svg       transparent marks for docs, exports and README use
 *
 * The PWA pngs live under public/, not app/ — anything matching app/icon* is
 * claimed by Next's icon convention and served from a hashed route, so a
 * manifest could not link to it by a stable path.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BRAND_COLORS, markDocument } from "../lib/brand/mark.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const { dark, light } = BRAND_COLORS;

/** The app-icon form: the mark inset on a rounded brand-dark tile. */
const tileSvg = markDocument({
  size: 512,
  ink: dark.ink,
  brand: dark.brand,
  background: dark.background,
  padded: true,
  title: "Universal Asset Analyzer",
});

/** The same inset mark with no tile, for compositing onto a flat background. */
const bareOnDarkSvg = markDocument({
  size: 512,
  ink: dark.ink,
  brand: dark.brand,
  padded: true,
  title: "Universal Asset Analyzer",
});

function png(svg: string, size: number) {
  return sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Wrap PNGs in an ICO container.
 *
 * PNG-in-ICO (rather than a BMP payload) is supported by every browser still in
 * use and is the only sane way to emit one without a bitmap encoder. Width and
 * height bytes are 0 for 256px by spec — irrelevant here, but the clamp keeps
 * this honest if someone adds a 256 entry later.
 */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(ENTRY);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size (0 = truecolor)
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  await mkdir(path.join(ROOT, "public/brand"), { recursive: true });

  const [ico16, ico32, ico48] = await Promise.all([16, 32, 48].map((s) => png(tileSvg, s)));

  const appleIcon = await sharp(Buffer.from(bareOnDarkSvg))
    .resize(180, 180)
    .flatten({ background: dark.background })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const [icon192, icon512] = await Promise.all([192, 512].map((s) => png(tileSvg, s)));

  const files: [string, string | Buffer][] = [
    ["app/favicon.ico", ico(
      [
        { size: 16, data: ico16 },
        { size: 32, data: ico32 },
        { size: 48, data: ico48 },
      ],
    )],
    // Emitted at the mark's native 32-unit grid; the browser scales the vector.
    ["app/icon.svg", markDocument({
      ink: dark.ink,
      brand: dark.brand,
      background: dark.background,
      padded: true,
      title: "Universal Asset Analyzer",
    })],
    ["app/apple-icon.png", appleIcon],
    ["public/brand/icon-192.png", icon192],
    ["public/brand/icon-512.png", icon512],
    // Transparent marks: `-on-dark` carries light ink, `-on-light` dark ink.
    // Named by the surface they sit on, not by theme name — the single most
    // common way a two-file logo set gets used backwards.
    ["public/brand/uaa-mark-on-dark.svg", markDocument({
      ink: dark.ink,
      brand: dark.brand,
      title: "Universal Asset Analyzer",
    })],
    ["public/brand/uaa-mark-on-light.svg", markDocument({
      ink: light.ink,
      brand: light.brand,
      title: "Universal Asset Analyzer",
    })],
    ["public/brand/uaa-icon.svg", tileSvg],
  ];

  for (const [rel, data] of files) {
    await writeFile(path.join(ROOT, rel), data);
    const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.length;
    console.log(`  ${rel.padEnd(34)} ${bytes.toLocaleString()} bytes`);
  }
}

await main();
