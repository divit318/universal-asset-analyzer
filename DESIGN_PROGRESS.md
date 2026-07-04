# DESIGN_PROGRESS.md — Design/Frontend Session (2026-07-04)

Goal: polish UAA to premium-terminal quality. Refinement, not redesign.

## Design system (as found)
- `app/globals.css` (88 lines): dark-only. Surface scale (`--surface/-2/-3`),
  `--border/--foreground/--muted`, `--accent #4ade80`, semantic
  `--positive/--negative/--warning`, chart palette `--chart-1..5`, mapped to
  Tailwind v4 utilities via `@theme inline`. Global `:focus-visible` accent
  ring; Geist sans/mono; slim scrollbars; dialog-enter keyframes.
- Shared components in `app/_components/` (header, search, dialog, toast,
  fit badge/panel, movement explainer, sector rotation panel, dashboards).

## Audit — pages inspected live (Chrome, 1462×812)
Home, Research (AAPL), Scanner (live pipeline), Screener, Portfolio,
Watchlist, Intelligence hub, Compare, DCF, Calendar, IC Report, Engine.
No console errors on any page. Loading skeletons and empty states are
consistently present and high quality (Compare/DCF/IC/Engine exemplary).

## Fixed this session (commit 27ca645)
1. **Nav group label clipped** (site-header.tsx): label was `absolute
   -top-[22px]` inside the 56px header → rendered above the viewport,
   illegible on every page. Moved to `-top-[12px] left-2.5 leading-none`;
   verified visually (zoom screenshot, active + hover states).
2. **Token consistency sweep**: raw `green-400`/`red-400` classes (~130
   uses) → `positive`/`negative` tokens (identical hex, zero visual change);
   `amber-400` (~250 uses) → `warning`, and `--warning` aligned to #fbbf24
   (amber-400), the shade every warning surface already used. Raw palette
   classes remaining are deliberate categorical colors (blue/purple/orange
   node & badge coding) plus small emerald/rose accents distinct from tokens.
3. **Compare "Mag 7" preset** listed only 5 tickers (page caps at 5) and
   duplicated Big Tech — replaced with Defensives (JNJ/PG/KO/WMT).
4. **Watchlist Portfolio-Fit scores all identical (73)** — cross-feature
   data gap, not UI: page passed `sector: null` for every symbol so the
   25%-weight sector dimension (and dividend input) defaulted to neutral.
   `/api/watchlist` GET now joins `sector` + `dividendYield` from
   `fundamentals_cache` (7-day tolerance; sector is stable), page passes
   them to `ios.getPortfolioFit`. Live-verified: APA 71 / RNR 73 now differ.
   (`WatchlistItem` gained optional `sector`/`dividendYield` fields.)

Verified after all changes: `tsc --noEmit` clean, eslint 0 errors
(48 pre-existing warnings), 317/317 tests, live browser inspection of
header, watchlist, screener, calendar.

## Cross-feature journeys (checked live)
- Research → Timeline / Graph / Compare / Watchlist / Excel: present on the
  quote header. ✓
- Portfolio → Timeline / Graph / Opportunities + rotation-aware panels. ✓
- Watchlist rows → DCF / IC Report / Compare / Deep view + fit badges. ✓
- Scanner → Opportunity Map header link; cards deep-link with context. ✓
- Calendar events → Research / Compare links per event. ✓

## Remaining opportunities (ranked)
1. **Dev-nav perceived freeze**: all pages are client components; first
   navigation in dev waits on compile with no in-app feedback. Production
   unaffected — do NOT add 14 loading.tsx files; revisit only if server
   pages appear.
2. Portfolio health-score sublabels truncate mid-word ("Portfolio-…",
   "Concentra…") at 1462px — could switch to title attrs or wider column.
3. Watchlist rows show both "Added 5d ago" and an "Added Jun 29, 2026"
   divider — redundant; drop one.
4. Screener results table right edge clips the HEALTH column without a
   visible scroll affordance.
5. `text-[9px]`/`text-[10px]` micro-sizes appear in a few components;
   could be normalized to one micro-label size.
6. 48 pre-existing lint warnings (unused vars) — mechanical cleanup.
