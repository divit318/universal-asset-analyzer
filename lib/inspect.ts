import type { AnalysisInsight } from "./types";

/**
 * Content-level inspectors. Each takes the raw bytes of an asset and derives
 * insights from its actual contents (not just metadata).
 */

const decoder = new TextDecoder("utf-8", { fatal: false });

// --- Text -------------------------------------------------------------------

export function inspectText(bytes: Uint8Array): AnalysisInsight[] {
  const text = decoder.decode(bytes);
  // wc-style: count newline characters (a trailing newline is not a new line).
  const lines = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  const words = text.match(/\S+/g)?.length ?? 0;

  return [
    { label: "Characters", value: text.length.toLocaleString() },
    { label: "Lines", value: lines.toLocaleString() },
    { label: "Words", value: words.toLocaleString() },
  ];
}

// --- Image ------------------------------------------------------------------

const read16BE = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const read16LE = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const read32BE = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const read32LE = (b: Uint8Array, o: number) => {
  const v = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
  return v;
};

/** Parse pixel dimensions from common image headers (PNG, GIF, BMP, JPEG). */
export function imageDimensions(
  b: Uint8Array,
): { width: number; height: number } | null {
  // PNG: 89 50 4E 47 ... IHDR width@16 height@20 (big-endian)
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) {
    return { width: read32BE(b, 16), height: read32BE(b, 20) };
  }

  // GIF: "GIF" then width@6 height@8 (little-endian uint16)
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: read16LE(b, 6), height: read16LE(b, 8) };
  }

  // BMP: "BM" then width@18 height@22 (little-endian int32, height may be < 0)
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return { width: read32LE(b, 18), height: Math.abs(read32LE(b, 22)) };
  }

  // JPEG: FF D8, then walk segments to the SOF marker
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1];
      const isSOF =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSOF) {
        return { height: read16BE(b, o + 5), width: read16BE(b, o + 7) };
      }
      const len = read16BE(b, o + 2);
      if (len < 2) break;
      o += 2 + len;
    }
  }

  return null;
}

export function inspectImage(bytes: Uint8Array): AnalysisInsight[] {
  const dim = imageDimensions(bytes);
  if (!dim || dim.width === 0 || dim.height === 0) {
    return [{ label: "Dimensions", value: "unknown" }];
  }

  const megapixels = (dim.width * dim.height) / 1_000_000;
  return [
    { label: "Dimensions", value: `${dim.width} × ${dim.height} px` },
    { label: "Megapixels", value: megapixels.toFixed(2) },
    { label: "Aspect ratio", value: (dim.width / dim.height).toFixed(3) },
  ];
}

// --- Binary -----------------------------------------------------------------

const ENTROPY_SAMPLE = 1_000_000; // cap entropy scan at 1 MB for speed

/** Shannon entropy in bits/byte (0 = uniform, ~8 = compressed/encrypted). */
export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const sample =
    bytes.length > ENTROPY_SAMPLE ? bytes.subarray(0, ENTROPY_SAMPLE) : bytes;

  const counts = new Uint32Array(256);
  for (let i = 0; i < sample.length; i++) counts[sample[i]]++;

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (counts[i] === 0) continue;
    const p = counts[i] / sample.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function inspectBinary(bytes: Uint8Array): AnalysisInsight[] {
  const magic = Array.from(bytes.subarray(0, 8))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join(" ");

  return [
    { label: "Magic bytes", value: magic || "—" },
    { label: "Entropy", value: `${shannonEntropy(bytes).toFixed(2)} bits/byte` },
  ];
}
