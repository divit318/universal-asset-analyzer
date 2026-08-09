# 10. Accessibility and readability audit

Method: computed-style contrast sweep of every distinct text style on the live page (script: `docs/audits/today-dashboard/tools/a11y.mjs`, output archived at /tmp/a11y-report.json), a 40-stop tab-order probe (`tools/keyboard.mjs`), heading/landmark inspection, and code reading of `app/globals.css`, `app/_home/**`. WCAG 2.1 AA thresholds: 4.5:1 normal text, 3:1 large text (>= 24 px, or >= 18.66 px bold).

## Contrast sweep results

54 distinct text styles sampled on the rendered page. 51 pass AA (most pass AAA; the theme's body colors `rgb(237,239,242)` on near-black are 13 to 18:1).

### AC-01 (medium): the dimmest muted grey fails AA at the sizes it is used
`rgb(98,108,122)` (the `text-muted/60`-ish tier) measures 3.43:1 at 9 px (the command palette `⌘K` hint) and 3.95:1 at 10 px ("Since last visit" label, "today 12:53 AM" timestamp). All three are under the 4.5 requirement for small text, and they are used precisely on the smallest type on the page. Fix in the token pass: the sub-muted tier must be >= 4.5 on `#000` and `#131519`, or the 9 to 10 px uses move up a tier.

### AC-02 (pass, recorded): loss-red on card backgrounds
`rgb(248,113,113)` on `rgb(26,29,35)` = 6.1:1 passes AA. Gain-green 9.7 to 12:1 passes. Amber/gold accents 8 to 9:1 pass.

## Non-contrast findings

### AC-03 (high): gains and losses are not color-only in text, but ARE color-only in charts
Numeric text always carries an explicit sign (`+1.2%`, `−1.65%`), so text survives greyscale. The sparklines, the 90-day curve (green portfolio vs blue benchmark), and the sentiment gradient bar encode meaning by hue alone: a red down-sparkline and a green up-sparkline are identical in greyscale, and the two curve series are indistinguishable. (Cross-ref Phase 5 signal-encoding requirement.) Fix direction: end-point markers plus signed end labels on every spark (the tape tiles already have the label adjacent, the 90-day curve has +9.7/+4.9 labels but the series need distinguishable line styles: solid vs dashed, or marker at terminus).

### AC-04 (medium): 26 decorative SVGs lack aria treatment
26 inline SVGs have neither `role` nor `aria-label` nor an aria-labelled ancestor (probe count). Most are decorative icons that should carry `aria-hidden="true"`; the informational ones (sparklines) need `role="img"` with a sentence-length label ("90-day return, portfolio +9.7 percent vs SPY +4.9 percent"). `_viz/radar.tsx:42` and `market-intelligence.tsx:314` already do this correctly; `sparkline.tsx` and the tape tiles do not consistently.

### AC-05 (medium): metric cards read as word salad to a screen reader
The brief's stat row renders label and value as sibling divs with no grouping semantics; a screen reader announces "PORTFOLIO VALUE $4.07M TODAY +1.2% +$31.68K GRADE C 68 ACTIONS 1" with no boundaries or units expansion ("C 68" is opaque). Each stat should be a labelled group (`role="group"` + `aria-label="Portfolio value, 4.07 million dollars"`) or a definition-list pair. Same for the book card's DAY P&L / RETURN (XIRR) / CASH grid and the queue rows (score "67" announced with no context; it needs "priority 67 of 100").

### AC-06 (low): focus visibility and tab order are good; keyboard reach inside the queue is partial
Every stop in the 40-stop probe had a visible outline (`outline: true` on all), a skip link exists and works, cmd+K opens the palette, icon-only buttons all have labels (0 unlabeled found), and dismiss buttons are reachable. The queue has an `onKeyDown` handler on the list (`attention-queue.tsx:688`) but there is no visible key legend, and no single-key triage (j/k/e/d) is documented anywhere on the page. (Cross-ref 07-interaction audit for the key map.)

### AC-07 (low): live regions exist where they matter
`aria-live="polite"` on the queue count (`attention-queue.tsx:616`) and the brief status (`ai-investment-brief.tsx:495`) are correct. The count-up animation, however, causes the day P&L to be announced mid-interpolation if focus lands during the 760 ms ramp (cross-ref DU verdict: cut the count-up).

### AC-08 (pass, recorded): reduced motion is respected
Blanket `prefers-reduced-motion` rules at `globals.css:538,574,741,755,787,813` cover the reveal stagger and CSS transitions; `use-count-up.ts` checks are noted in code. Verified by code reading; the reveal animation is CSS-driven and covered by the blanket rule.

### AC-09 (medium): heading structure is sound but two modules lack h2 identity
Landmark probe found h1 "Today" and h2s for Portfolio Health, Attention, Radar, Market Overview, The long read, AI Investment Brief. The executive brief (the largest module on the page) exposes NO heading: its title is a decorative uppercase label, so screen-reader rotor navigation skips the page's primary module. Since Last Visit is likewise heading-less.

### AC-10 (readability, medium): the page's smallest tier is overloaded
27 distinct strings render at 10 to 11 px and another 27 at 13 px mono. The 10 px tier carries real information (kind chips, "Priority", timestamps, fit rationales), not just ornament. On a 13-inch laptop at 1440 effective width this is the boundary of legibility, and the muted color tiers push it past it. The type scale in DESIGN.md must promote the information-bearing 10 px uses to 11 to 12 px and reserve sub-11 px for true ornament.

## Checks run and results summary

| Check | Result |
|---|---|
| Contrast, all rendered text styles (54) | 3 FAIL (AC-01), 51 pass |
| Color-only encoding | text pass, charts FAIL (AC-03) |
| Focus visible on every stop (40 sampled) | pass |
| Skip link | pass |
| Icon-only buttons labelled | pass (0 unlabeled) |
| SVG aria | 26 missing (AC-04) |
| Headings/landmarks | brief + changes band missing h2 (AC-09) |
| aria-live | pass where present (AC-07) |
| Reduced motion | pass (AC-08) |
| Min font sizes | 9 to 10 px in active duty (AC-10) |
