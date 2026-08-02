# The UAA Logo — implementation reference

**`docs/brand-guidelines.md` is the identity authority.** Its §6 (Logo &
Iconography) defines *what* the mark is and *what may not be done to it*; §15 is
the governance that makes it binding. This file is narrower: it documents *how §6
is implemented in code*, so a contributor adding a surface does not have to
reverse-engineer the component API from the brand book.

If this file and `brand-guidelines.md` disagree, **the brand book wins** — and
that disagreement is a bug in this file.

Deliberate additions this file makes beyond §6, all compatible with it:

- A six-step size *token* scale (§3 below). §6.2 specifies only a minimum size;
  the tokens exist so no surface can invent `h-[19px]`.
- The `loading` / resolved distinction as an enforced API (`BrandEmptyState`),
  which is §6.1's "must not be altered" behaviour made hard to get wrong.
- A hover/focus treatment on interactive lockups (§8 below). §6.2's don'ts
  prohibit shadows, gradients, glow, recolouring and rotation/skew; this adds
  none of those — the terminus stays at 45° and only its scale changes.

### One thing Phase 1 must not miss

`lib/brand/mark.ts` exports `BRAND_COLORS`, which contains **literal hex copies**
of `--brand` for the contexts that cannot read CSS variables: the generated
favicon/app icons and the PDF exports. It is therefore a third file in the same
category as `app/_components/chart-theme.ts` in the brand book's "Known deltas"
list, and it must move in the **same commit** as the brass token swap — otherwise
the app goes brass while the browser tab and every exported PDF stay sky-blue.
Everything in the running app takes its colour from `var(--brand)` and needs no
change.

---

## 1. The mark: Convergence Point

Four bars of decreasing width converge downward into a single brand-coloured
diamond. It says the product's one sentence: a lot of noisy inputs — prices,
filings, fundamentals, news, sentiment — narrowing to one decision. The terminus
*is* the decision, and it is the only element that ever carries colour.

```
━━━━━━━━━━━━━━━━   0.55 opacity, 24 wide
  ━━━━━━━━━━━━     0.70 opacity, 19 wide
    ━━━━━━━━       0.85 opacity, 14 wide
      ━━━━━        1.00 opacity,  9 wide
        ◆          brand, 5.2 square rotated 45°
```

**Geometry lives in exactly one place: `lib/brand/mark.ts`.** Every consumer reads
from it — the React components, the animated loader, the favicon generator, the
PDF exporter. Nothing hardcodes a coordinate. That is what makes "the logo is
identical everywhere" a structural property rather than a hope.

### Resolved vs unresolved — the one meaning the geometry carries

| Terminus | Means | Component |
|---|---|---|
| Diamond (square rotated 45°) | resolved, settled, done | `<BrandMark>` |
| Square (unrotated) | work in flight | `<LoadingMark>` |

`<LoadingMark state="done">` lands **pixel-exactly** on `<BrandMark>`, because
they share the same rects and differ only by that rotation. This is why the boot
splash's ending reads as "the product" and not "a spinner stopped".

Consequence: **never show the resolved logo to mean "loading"**, and never show
the square to mean "ready". A screener that is still building its universe gets
`<BrandEmptyState loading>`, not the static mark.

---

## 2. The lockup

Mark + wordmark, horizontally locked, mark first.

```
◆̶ asset/analyzer
```

The wordmark is Geist Mono, 600 weight, lowercase, `tracking-tight`, with the
slash in `--faint`. Monospace and lowercase on purpose: it reads as a path, i.e.
as a tool, not a marketing campaign. It is **never** used without the mark.

The accessible name of a lockup is always **"Universal Asset Analyzer"** — set via
`aria-label`, because "asset/analyzer" is not what the product is called and a
screen-reader user deserves the real name.

---

## 3. Sizes

Six tokens. No values in between, and no raw `h-[19px]`.

| Token | px | Where |
|---|---|---|
| `xs` | 14 | inline with body text — app footer, command-palette signature strip |
| `sm` | 18 | dense chrome — mobile nav footer row |
| `md` | 22 | **the default.** App header and marketing header lockup |
| `lg` | 28 | marketing footer, mobile header (wordmark-less form) |
| `xl` | 44 | empty states, zero-data panels, first-run surfaces |
| `hero` | 96 | boot splash and the marketing hero — nowhere else |

The mark is always drawn on its 32×32 grid with `width === height`, so it can
never be stretched and never lands on a half-pixel.

---

## 4. Colour and theming

- **Ink** (the bars) is `currentColor`. The mark inherits the text colour of
  wherever it sits, which means it works in both themes with zero per-theme
  variants and zero `data-theme` branches.
- **Terminus** is always `var(--brand)` — `#38bdf8` dark, `#0284c7` light.
- `tone="mono"` makes the terminus `currentColor` too. Use it only where a
  brand-coloured accent already sits within ~200px and would compete.
- Tone classes: `text-muted` for quiet placements, `text-foreground` for the
  hero. **Not `text-faint`** — the bars already carry a 0.55→1.0 opacity ramp, so
  faint ink on top of that drops the top two bars below a 2:1 contrast ratio and
  the mark degenerates into a stray blue diamond.
- Never hardcode a hex in app code. `BRAND_COLORS` in `lib/brand/mark.ts` exists
  only for the contexts that genuinely cannot read CSS variables: favicons,
  app icons, and PDF exports.

---

## 5. Spacing

- **Clear space** on every side: at least half the mark's height. The `gap` paired
  to each size token in `brand.tsx` already satisfies this inside a lockup.
- Mark-to-wordmark gap is fixed per size (`gap-1.5` at `xs` up to `gap-5` at
  `hero`). Do not override it.

---

## 6. Placement — where the logo goes, and where it must not

**Chrome (always):**

| Surface | Form |
|---|---|
| App header | `<BrandLockup size="md" wordmark="sm-up" href="/">` |
| Marketing header | `<BrandLockup size="md" href={LANDING_HOME}>` |
| Marketing footer | `<BrandLockup size="lg" href={LANDING_HOME}>` |
| App footer (every page) | `<BrandMark size="xs">` + "Universal Asset Analyzer" |
| Mobile nav sheet | `<BrandMark size="sm">` + full product name |
| Browser tab / PWA / iOS | generated icons — see §8 |

**Brand moments (the mark alone, no wordmark):**

| Surface | Form |
|---|---|
| Boot splash | `<LoadingMark size={96}>` + wordmark, resolving |
| Marketing hero | `<BrandMark size="hero">` |
| Command palette | `<BrandMark size="xs">` signature strip; `lg` in its empty state |
| AI assistant resting state | `<BrandMark size="xl">` |
| Screener / portfolio empty states | `<BrandEmptyState>` |
| Loading panels & lines | `<LoadingPanel>` / `<LoadingLine>` |
| Exported PDFs | `drawBrandMark()` — cover banner + every page's running header |

**Do NOT place the logo:**

- Beside a page `<h1>`. Twelve pages × one mark each is wallpaper, not identity.
- On individual cards, tiles, table rows, badges or home-dashboard modules.
- More than one **lockup** per view. Additional bare marks at genuine brand
  moments are fine; a second wordmark is not.
- Anywhere a functional icon belongs. The mark is not a "filter" or "sort" glyph,
  and the nav/module icon set (`app/_components/icons.tsx`) is the family that
  echoes it — it borrows only the brand diamond, never the whole mark.

---

## 7. Responsive behaviour

Below `sm` (640px) the app header has no room for the wordmark: the right-hand
control cluster alone is ~296px of a ~342px content box. So:

- The wordmark hides. **The mark never hides** — it is the part that has to
  survive.
- The mark steps **up** one size token (22 → 28). A 22px mark stranded to the left
  of six 18px icon buttons reads as a seventh button; at 28px it is unmistakably
  the largest thing in the bar and unmistakably a logo.
- The open mobile nav sheet carries the full "Universal Asset Analyzer" name, so
  the product still names itself at phone widths.

This is implemented once, inside `<BrandLockup wordmark="sm-up">`. Do not
reimplement it with responsive size utilities.

---

## 8. Hover and focus

Only an *interactive* lockup animates. On hover or `:focus-visible`:

- the bars' opacity ramp levels up to full ink — the mark "resolving harder";
- the terminus scales to 1.14 (staying at 45°).

No translate, no colour change, no shadow: the logo must not restyle itself. Both
are disabled under `prefers-reduced-motion`. Rules live in `app/globals.css`
under "The brand mark".

---

## 9. Generated assets

```bash
npm run brand:assets     # node scripts/generate-brand-assets.ts
```

Regenerate and commit whenever the geometry or `BRAND_COLORS` change.

| File | Role |
|---|---|
| `app/favicon.ico` | 16/32/48 tile for browsers that still request it |
| `app/icon.svg` | the modern favicon — vector, sharp at any zoom |
| `app/apple-icon.png` | 180×180 full-bleed tile (iOS applies its own rounding) |
| `public/brand/icon-{192,512}.png` | PWA install icons, listed by `app/manifest.ts` |
| `public/brand/uaa-mark-on-{dark,light}.svg` | transparent marks for docs/README |
| `public/brand/uaa-icon.svg` | the tiled app-icon form |

Two things worth knowing:

- The PWA pngs live under `public/`, **not** `app/`. Anything matching `app/icon*`
  is claimed by Next's icon convention and served from a hashed route, so a
  manifest cannot link to it by a stable path.
- `app/layout.tsx` deliberately declares **no** `metadata.icons`. Next's file
  conventions already emit those links; declaring them again produces duplicate
  `<link rel="icon">` tags whose source order silently decides the winner.

The app-icon form insets the mark to 78% on a rounded `#0a0b0e` tile. That inset
is what makes the same 512px file safe as an Android `maskable` icon.

---

## 10. Changing the mark

1. Edit `MARK_BARS` / `MARK_TERMINUS` / `MARK_BAR_HEIGHT` in `lib/brand/mark.ts`.
   Nothing else.
2. `npx vitest run tests/brand.test.ts` — it pins convergence, axis alignment,
   the bar-to-diamond gap, optical padding, and the minimum bar opacity. Each
   assertion is a defect the mark actually had during the branding pass.
3. `npm run brand:assets` and commit the output.
4. **Judge the result at 16px in both themes**, not at 96px. A 2.4-unit bar is
   ~1.4 device pixels at 18px; the difference between a legible mark and a blue
   smudge lives entirely in that range.
