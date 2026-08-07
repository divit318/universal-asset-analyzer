# 11. Responsive and viewport audit

Method: full-page screenshots at 390, 768, 1024, 1440, 2560 widths (`docs/audits/today-dashboard/shots/baseline/`), plus short-viewport reasoning against the 1440x900 fold. Layout source: `lib/home/layout.ts` (HOME_LAYOUT spans), `app/_home/module-grid.tsx` (single-column below lg by module spans all being 12/12 at sm/md).

## Behaviour by width

| Width | Behaviour | Verdict |
|---|---|---|
| 390 | Single column, correct order (brief, book, changes, queue, radar, tape, long read). Page is ~14 screens tall. All 19 queue rows plus 5 duplicate radar tiles stack; the tape renders 8 full-size tiles plus a 5-instrument index strip that clips (FTSE/NIKKEI cut off, no scroll affordance visible). | reflow works, density does not adapt |
| 768 | Still one column for modules (md spans are 12), radar switches to internal 2-col tiles. The brief's stat row wraps 2x2. Index strip clips at DOW; overflow-x with no indicator. | acceptable, same repetition cost |
| 1024 | lg grid activates: queue 7 + radar 5, brief 8 + book 4. Cards get tight but read. | acceptable |
| 1440 | Reference layout. Brief card has ~200 px of dead vertical space between the 2-sentence summary and the footer strip because the card's height is driven by the book rail beside it. Market overview begins at ~2.5 screens; long read at ~3.2 screens. | dead space inside the hero; context far below fold |
| 2560 | Content is max-width capped (~1300 px) and centered; margins are ~600 px each side. No density gain, no extra columns, sparklines do not widen. A 27-inch display shows exactly what a 13-inch laptop shows, smaller than it could. | wasted canvas by design cap |

## Findings

### RV-01 (high): density does not adapt, only column count does
The layout system can vary span per breakpoint (`layout.ts` spans) but every module renders identical content at every width. At 390 the user pays 14 screens of scroll for one screen of decisions (cross-ref RD audit repetition counts: the phone user scrolls past the same cash story 6 times). At 2560 the cap wastes half the display. Density adaptation (compact rows at sm, wider tape grid at xl, 3-col attention row at 2xl) is currently impossible because modules have no density prop; the registry has size but not density.

### RV-02 (high): the fold at 1440x900 is spent on prose, not decisions
From the 1440 shot: above the 900 px fold the user gets the AI headline (a restatement, cross-ref DU-01/LQ), four stat chips, and the book card's top half. The queue (the actionable surface) starts at ~1250 px; the user's first decision is more than one viewport away. On a 768x1024 tablet the queue starts at ~3000 px. (Cross-ref IA restructure.)

### RV-03 (medium): dead vertical space inside the brief card at lg+
The command row is a CSS grid; the brief (8 cols) stretches to the book rail's height (4 cols, tall because of curve + contributors). The brief's content ends ~200 px before its footer at 1440. Either the brief needs to earn the height (fill with the actions it advertises) or the row needs `items-start` with independent card heights.

### RV-04 (medium): horizontally clipped index strip on small widths with no affordance
At 390 and 768 the S&P/NASDAQ/DOW/FTSE/NIKKEI strip clips mid-number (`market-intelligence.tsx` index row, overflow hidden or unsignalled overflow-x). Numbers that clip mid-digit are worse than numbers that are absent: "10,9" reads as a wrong value. Needs an explicit horizontal scroll affordance or a wrap.

### RV-05 (low): short viewports (900 px and under, e.g. 13-inch laptops with docks, or a half-height window)
Nothing above the fold is sticky or prioritized; the header (56 px) plus page title block (~90 px) plus the brief label row consume ~30 percent of a short viewport before any number renders. The Today h1 and date line duplicate what the nav already says (Today is the active nav item) and cost 90 px at every width.

### RV-06 (low): the radar's internal 2-col grid at md creates orphan tiles
With 5 tiles in a 2-col grid the fifth spans awkwardly alone (768 shot); with the radar merged into the queue (RD/IA recommendation) this disappears.

## Requirements carried into the rebuild

1. Compact row density at sm (one-line queue rows, 44 px touch targets kept).
2. Kill dead space: command row aligns items-start, brief height independent (RV-03).
3. Tape becomes a single horizontally scrollable strip with scroll affordance at < lg, grid at lg+, and gains a 3rd/4th column only if content earns it at 2xl.
4. The fold at 1440x900 must contain: what changed, day P&L with as-of, and the first two queue items.
5. No mid-digit clipping anywhere; overflow is always signalled.
