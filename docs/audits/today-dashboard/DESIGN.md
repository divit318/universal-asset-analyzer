# DESIGN.md: the Today page's visual system

The floor is do no harm; the target is a clear improvement. The committed UI is the product's visual identity (the 2026-08 terminal redesign is abandoned; see AGENTS.md), so this document does not invent a new language. It DOCUMENTS the existing token system as the binding contract, names the gaps the audits found (AC-01, AC-03, AC-10, DU on sparklines and count-up), and derives every Phase 5 style decision from it. Where a rule below conflicts with an ad hoc style in a dashboard component, the component is wrong.

## 1. Color tokens (dark theme, authoritative values from app/globals.css)

| Token | Hex | Semantic role | Contrast basis |
|---|---|---|---|
| `--background` | #0a0b0e | page ground | n/a |
| `--surface` / `--surface-2` / `--surface-3` | #131519 / #1a1d23 / #23272f | card, tile, popover elevations | n/a |
| `--foreground` | #edeff2 | primary text and headline figures | 18.2:1 on background |
| `--muted` | #99a3b2 | secondary text, labels, supporting figures | 8.2:1 |
| `--faint` | #626c7a | ornament ONLY, at >= 12 px | 3.9:1 (fails AA for small text) |
| `--brand` | #c8a96e | the verdict brass: primary CTA, AI labels, active nav | 8.8:1 |
| `--positive` / `--negative` | #4ade80 / #f87171 | gains / losses, always WITH an explicit sign | 12.1 / 7.6:1 |
| `--warning` | #fb923c | caution and threats, never a verdict | 8.7:1 |
| `--alert` | #b585fa | a tripwire the user set has fired | 6.2:1 on its strictest surface |
| `--chart-1..5` | purple/steel/teal/pink/slate | categorical series identity, never semantics | per audit |

Binding rules:
- R1. `--faint` never carries information below 12 px. The audit's three AA failures (AC-01) were all `--faint`-tier text at 9 to 10 px; information-bearing small text uses `--muted` or larger.
- R2. Gains and losses never rely on hue alone (AC-03). Numeric text always carries the sign; line charts distinguish series by dash pattern or marker as well as hue.
- R3. Brass is chrome and verdict; orange is caution; violet is a fired tripwire; green/red are data direction. No borrowing.

## 2. Type scale

Faces: Geist (display and body), Geist Mono (every number, always `tabular-nums`).

| Tier | Size / weight / tracking | Use |
|---|---|---|
| Headline figure | 26 to 30 px mono 600 | the page's few first-glance numbers (day P&L, XIRR, grade) |
| Section title | 20 to 22 px sans 600, -0.01em | module h2 |
| Body | 14 px sans 400 | rationale sentences, prose |
| Supporting figure | 13 to 14 px mono 400/500 | row-level numbers, deltas, bps |
| Label | 11 px sans 600 caps, +0.09em, foreground/55 | section labels (the LABEL constant) |
| Ornament | 10 px, `--muted` or better (R1) | chips, kind tags |

Binding rules:
- R4. No number renders outside the mono face; no component calls toFixed on a digest value (the fact layer owns precision).
- R5. A magnitude and its sign live in the same glyph run (+1.2%, −5.1 bps, true minus for alignment).
- R6. Nothing information-bearing below 10 px; prefer promoting to 11 px `--muted`.

## 3. Spacing, density, elevation

- Grid: 12-col, `gap-4` within zones, `gap-6` between zones (lib/home/layout.ts owns this).
- Card chrome: matte machined panels (`--panel-top`/`--panel-bottom` gradient, `--edge-top` rim, `--depth-1` shadow). Cards never stretch to fill a row's height; rows align `items-start` (RV-03).
- Density is a feature: the Book strip packs four cells into ~200 px; queue rows are one line of headline + one of rationale. Dead vertical space inside a card is a defect.
- Elevation ladder: page < card (`--depth-1`) < spotlight tile (brand-tinted border) < popover (`--shadow-popover`). Nothing else casts shadows.

## 4. Chart rules

- The 90-day comparison: portfolio line solid (toned by its own direction), benchmark DASHED steel (`--chart-2`) so the pair survives greyscale (R2); endpoint labels carry the signed window returns; the window is named in the label ("90-day vs SPY").
- Tape-tile sparklines: 30 trading days, labelled as such ("30d") in the tile, terminal dot marks the newest print. An unlabelled sparkline is decoration and gets cut instead.
- The sentiment gauge bar keeps its gradient (it is a position-on-scale encoding with an aria label), but its words come from the shared vixBand vocabulary (NI-05).
- No axes on sparklines; anything needing axes belongs on /portfolio or /research.

## 5. Motion

- Loading: skeletons that match final layout (CLS 0 is measured and stays).
- One-shot entrance stagger (`uaa-reveal`) is acceptable; ambient/looping motion is not (benchmark audit reject list). The count-up number animation is REMOVED: it displays false values for ~760 ms on a page whose whole point is true values (DU verdict).
- All motion behind `prefers-reduced-motion` (already blanket-ruled in globals.css).

## 6. The signature element

The reconciled Day P&L attribution in the Book strip: three named contributors, the Σ "Everything else" residual, and a hairline contribution bar, summing exactly to the day's headline move. It is the one place the page proves its arithmetic on sight, and it is what this dashboard should be remembered by. Everything around it stays quiet: no other element in the strip gets color beyond data direction, and the bar itself is the only proportional graphic in Zone 1.

## 7. The one removal

`useCountUp` and its call sites are deleted (see section 5). Nothing else is added in its place.

## Phase 5 change list (all derived from rules above)

1. AC-01 / R1: `whats-changed` band labels move from `text-faint` 10 px to `text-muted`.
2. AC-03 / R2: benchmark line in the 90-day chart becomes dashed; tape sparklines gain a terminal dot and a "30d" window label.
3. DU / section 5: count-up deleted from the retired hero; hook file removed; AGENTS.md known-lint note updated.
4. Section 6: contribution bar added to the Book strip's attribution cell.
5. R6: queue kind chips and priority-band text hold at 11 px+ with muted-or-better tiers (verified, no change needed beyond 1).
