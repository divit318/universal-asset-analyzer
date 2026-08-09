/* Pixel-diff dark screenshots: .audit/baseline/dark vs .audit/screenshots/dark.
   Reports % of pixels differing (channel delta > 12) per route. */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const A = ".audit/baseline/dark";
const B = ".audit/screenshots/dark";
const files = fs.readdirSync(B).filter((f) => f.endsWith("@1440.png") && fs.existsSync(path.join(A, f)));
const rows = [];
for (const f of files) {
  const [a, b] = await Promise.all(
    [path.join(A, f), path.join(B, f)].map((p) =>
      sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    rows.push([f, `SIZE ${a.info.width}x${a.info.height} vs ${b.info.width}x${b.info.height}`]);
    continue;
  }
  const n = a.info.width * a.info.height;
  let diff = 0;
  for (let i = 0; i < n * 4; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > 12 ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > 12 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 12
    )
      diff++;
  }
  rows.push([f, ((diff / n) * 100).toFixed(2) + "%"]);
}
for (const [f, v] of rows.sort((x, y) => String(x[1]).localeCompare(String(y[1])))) console.log(v.padStart(10), f);
