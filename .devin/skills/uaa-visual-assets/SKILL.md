---
name: uaa-visual-assets
description: Create, optimize and manage UAA's visual assets — SVG-first illustration in the brand grammar, icon conventions, raster pipeline (sharp/WebP/AVIF), diagrams, and asset budgets
---

UAA is **SVG-first**. Illustrations, diagrams, brand marks, decorative fields — vector unless a photograph is genuinely required. The brand is "The Instrument of Record": evidence in ink, verdicts in brass. Read `docs/brand-guidelines.md` before authoring anything visual.

## 1. Brand grammar for illustration

- Palette: brass `#C8A96E` (earned by judgment — hue only where meaning exists), graphite `#131519`, and the semantic tokens from `app/globals.css`. Use `var(--…)` tokens in inline SVG so both themes work; hardcode hex only in standalone exported assets.
- The **diamond is the terminal particle** (see `lib/brand/mark.ts`, the loading mark, ink-engine sprites). Angular, machined geometry; no blobs, no rounded mascots, no generic startup illustration.
- Texture language: stipple fields and particle streams, procedurally generated with seeded PRNGs. Precedents to copy: `scripts/generate-hero-stipple.ts` (seeded mulberry32 dot placement → single `<path>` elements), `scripts/generate-particle-fields.mjs` (parametric curves, dots bucketed by radius×opacity into one path per bucket, **60KB budget per asset**).
- Density is respect: information-dense, restrained, institutional. One decorative moment per page maximum.

## 2. Authoring workflows

- **UI illustrations / empty states / heroes**: hand-author inline SVG JSX in the component (theme tokens, `aria-hidden="true"` if decorative, `role="img"` + `<title>` if meaningful). Generate repetitive geometry with a small seeded script, following the two precedent scripts — deterministic output, committed artifact.
- **Diagrams** (architecture/process/flow): for docs, `npx -y @mermaid-js/mermaid-cli -i d.mmd -o d.svg` then svgo. For product surfaces, hand-drawn SVG with token colors — Mermaid's look is not product-grade for UAA.
- **Icons**: `lucide-react` is the only icon library (tree-shaken via `optimizePackageImports`). Custom icons go in `app/_components/icons.tsx` as JSX, 24×24 grid, `stroke="currentColor"`, stroke-width matching lucide (2). Never add a second icon package.
- **Brand assets** (favicons, PWA icons, marks): regenerate via `npx tsx scripts/generate-brand-assets.ts` — do not hand-edit its outputs.

## 3. Optimization pipeline

- **SVG**: `svgo` (installed globally, v4). Default: `svgo --multipass -i in.svg -o out.svg`. Keep `viewBox` (never strip), coordinate precision 2–3. Optimize EVERY authored/exported SVG before commit; report before/after bytes.
- **Raster**: `sharp` is already in the repo's node_modules (used by `scripts/generate-brand-assets.ts`). One-liners:
  ```bash
  node -e "require('sharp')('in.png').resize(1600).webp({quality:82}).toFile('out.webp')"
  node -e "require('sharp')('in.png').avif({quality:55}).toFile('out.avif')"   # AVIF ~half of WebP for photos
  node -e "require('sharp')('in.png').png({compressionLevel:9,palette:true}).toFile('out.png')"
  ```
  `public/landing/*.png` screenshots are the main raster surface — prefer adding WebP/AVIF variants (`<picture>` or next/image) over new PNGs.
- **Background removal** (rare): `uvx --from "rembg[cpu]" rembg i in.png out.png` — local ONNX model (~170MB first download). Don't install permanently.
- **Budgets**: decorative asset ≤60KB (particle-field precedent); a page's total NEW image weight needs justification past ~200KB; anything bigger lazy-loads.

## 4. Image generation

- No raster AI generation is installed: the 16GB host has ~4GB slack (see AGENTS.md host-health) and UAA's aesthetic is procedural-vector, not AI-raster. If genuinely needed: Draw Things (free macOS app, local SD) run by the user with the dev stack STOPPED (`scripts/ops/uaa stop`) — treat like Ollama: never resident alongside dev.
- The idiomatic UAA answer to "we need an illustration" is a seeded procedural SVG in the brand grammar, not a generated image.

## 5. Verification

- Render both themes (`data-theme="dark"` / `"light"`) and screenshot via the browser MCPs; decorative SVGs must not break keep-out/legibility (landing: `node scripts/ink-verify.mjs`).
- Check bundle/asset impact: `du -h` the asset, and for route-level JS impact `npm run build` First Load JS comparison.
- Accessible SVG checklist: decorative → `aria-hidden="true"` `focusable="false"`; informative → `role="img"` + `<title>`; interactive → real buttons/links wrapping, visible focus.
