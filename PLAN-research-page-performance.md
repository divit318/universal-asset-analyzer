# PLAN-research-page-performance: Lazy-load the remaining recharts chains on `/research`

**Rank: #4 of 5.**

**STATUS: COMPLETE (2026-07-10).** All 5 static recharts chains in
`app/research/page.tsx` converted to `dynamic()`. `/timeline/page.tsx` no
longer exists (merged into `/intelligence` per the July 2026 redesign) —
applied the same treatment to `ThesisEvolutionPanel`'s import in
`app/intelligence/_views/timeline-view.tsx` instead, which is the current
static-import site. `/research` First Load JS: 1308.1 kB → 821.7 kB (−486.4
kB, −37%); `/intelligence` (bonus, not originally in scope): 1124.4 kB →
746.9 kB (−377.5 kB, −34%). All acceptance criteria met — see commit for
details.

## Goal

Finish the performance pass started 2026-07-06 (framer-motion removal + chart
lazy-loading + `getHistory` TTL cache); its explicitly named next target was "the
research page's static recharts imports". `/research` is the flagship page (1,127-line
client component, 30+ statically imported subcomponents). `InteractiveChart` is already
`next/dynamic` (see `app/research/page.tsx:85` for the house pattern), but **five more
recharts-bearing component chains are still static imports**, so recharts and every
below-the-fold chart parse/execute on first paint — including the India-only components,
which are dead weight on every US-stock view (the majority case).

Honest framing (from `DESIGN_PROGRESS.md` M7): for a localhost app, network transfer is
not the bottleneck — but parse/execute cost, hydration time, and shipping India-market
code to US-market views are real, and the fix is mechanical and zero-risk. This is a
tidy, bounded win, which is why it ranks #4 rather than higher.

## Files to touch

- `app/research/page.tsx` — the only file with required changes (imports at lines ~55–73)
- `app/timeline/page.tsx` — check `ThesisEvolutionPanel` import
  (`app/timeline/_components/thesis-evolution-panel.tsx` imports recharts); if static,
  apply the same treatment
- No changes to the chart components themselves

Static recharts-bearing imports on `app/research/page.tsx` to convert (verified):

| Import (current line) | Module | Condition rendered |
|---|---|---|
| `EarningsCard` (55) | `./_components/earnings-card` | US stocks, below fold |
| `ValuationHistoryChart` (57) | `./_components/valuation-history-chart` | below fold |
| `MarginTrendChart`, `PeerRadarChart`, `RevenueFcfChart` (58) | `./_components/charts` | below fold |
| `OwnershipTimeline` (64) | `./india/_components/ownership-timeline` | **India stocks only** |
| financial-charts imports (…73) | `./india/_components/financial-charts` | **India stocks only** |

Do NOT touch: `InteractiveChart` (already dynamic; its child `candle-chart.tsx` rides the
same chunk), `InvestmentSnapshot` / `RatioSparklines` (verify first — they are NOT in the
recharts-importers list, so leave them static unless you find recharts inside),
`ResearchCopilot`, and all the small non-chart cards (no recharts → no win, only
loading-flash risk).

## Step-by-step implementation order

### Step 1 — Record the baseline

```
npm run build 2>&1 | tee /tmp/build-before.txt
```
Note the `/research` route's "First Load JS" from the build output table. Keep the file.

### Step 2 — Study the house pattern

Read `app/research/page.tsx:85` (`InteractiveChart = dynamic(...)`) — copy its exact
style: `dynamic(() => import(...).then(m => m.Export), { ssr: false, loading: ... })`.
Match whatever `ssr`/`loading` choices it makes. The loading placeholder MUST have a
fixed height matching the real component's rendered height (read each component's root
className for its height, e.g. `h-64`) so lazy-mount does not cause layout shift.

### Step 3 — Convert, one import at a time

For each row in the table above, replace the static import with a module-scope `dynamic`
declaration next to the existing `InteractiveChart` one. For multi-export modules
(`charts.tsx` exports three), create three separate dynamic components:

```ts
const MarginTrendChart = dynamic(() => import("./_components/charts").then(m => m.MarginTrendChart), { ssr: false, loading: () => <ChartSkeleton h="h-56" /> });
```

(All three resolve to the same chunk — that's fine and correct.)

Keep any `import type { ... }` from those modules as static type-only imports — types
cost nothing and dynamic() doesn't provide them.

After EACH conversion: `npx tsc --noEmit` + reload `/research?symbol=AAPL` in the
browser and confirm the section still renders.

### Step 4 — Timeline page

`grep -n "ThesisEvolutionPanel" app/timeline/page.tsx` (and its `_components`). If it is
statically imported by the page (or by a component the page statically imports), convert
it identically. If it's already behind a dynamic boundary, note that and skip.

### Step 5 — Verify and measure

```
npm run build 2>&1 | tee /tmp/build-after.txt
```
Compare `/research` First Load JS before vs after. Record both numbers in the commit
message. Then live-verify (both themes — the charts were theme-migrated in M2/M7 and a
lazy-load regression could bypass `useChartTheme` wiring):
- `/research?symbol=AAPL` (US): interactive chart, margin/revenue/peer-radar charts,
  earnings card, valuation history all render after scroll; no console errors;
  no visible layout jump when a chart pops in.
- `/research?symbol=RELIANCE.NS` (India): India snapshot + financial charts +
  ownership timeline render; US-only cards absent as before.
- Toggle light/dark on both and confirm axis/grid/tooltip colors adapt (regression
  check on `useChartTheme`).

### Step 6 — Gate

`npx tsc --noEmit`, `npx eslint .`, `npm run test`, `graphify update .`.

## Edge cases a weaker model will miss

- **Named exports need `.then(m => m.Name)`** — `dynamic(() => import("./_components/charts"))`
  alone only works for default exports; these are all named. Getting this wrong
  typechecks in some configurations and then crashes at render.
- **Fixed-height loading placeholders.** A `null` loading state causes cumulative layout
  shift and can re-trigger the documented `ResponsiveContainer 0×0 first-paint bug class`
  (see `PROJECT_ROADMAP.md` Opportunity Map notes): a chart mounting inside a container
  that is mid-layout can measure zero. The placeholder must reserve the same box.
- **`ssr: false` inside a client component is required here** — the page is a client
  component; keep `ssr: false` consistent with the existing `InteractiveChart` usage.
  Do not "improve" it to server-render the charts; recharts SSR emits hydration warnings.
- **Do not convert tiny components** without recharts inside — each dynamic boundary adds
  a request + a loading flash; the win only exists where a heavy dep is cut. Check with
  `grep -l recharts <file>` before converting anything not in the table.
- **Conditional India components are the biggest win** — but confirm their render
  condition (`detectMarket()` from `lib/market.ts`) still gates them AFTER conversion.
  A dynamic component that's rendered unconditionally still downloads its chunk.
- **`optimizePackageImports: ["recharts", ...]` in `next.config.ts`** already tree-shakes
  the barrel; don't remove or fight it. The dynamic() split is complementary
  (defers WHEN code loads; the optimizer trims WHAT loads).
- **Don't rename or move component files** — other pages/components import some of these
  modules (e.g. `ownership-card.tsx` references ownership-timeline concepts in comments;
  compare page has its own dynamic radar). Only the import style in the two page files
  changes.

## Acceptance criteria (verify each)

1. `/research` First Load JS in `npm run build` output is measurably smaller than
   baseline (expect roughly ≥50 kB reduction from deferring 5 recharts chains; record
   exact before/after in the commit message). If the reduction is under 10 kB,
   investigate before merging — a chain is probably still statically reachable.
2. `grep -n "from \"./_components/charts\"\|from \"./_components/earnings-card\"\|valuation-history-chart\|ownership-timeline\|financial-charts" app/research/page.tsx`
   shows only `import type` (or nothing) as static imports; components come from
   `dynamic(...)`.
3. `npx tsc --noEmit` clean; `npx eslint .` 0/0; `npm run test` unchanged-or-better.
4. Live verification per Step 5 completed in BOTH themes and for BOTH a US and an
   India symbol, with zero new console errors/hydration warnings.
5. No visible layout shift when scrolling to each lazily-loaded chart (placeholder
   heights match).
6. If PLAN-e2e-smoke-suite is already merged: `npm run test:e2e` still green.
