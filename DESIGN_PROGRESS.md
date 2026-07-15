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

## Remaining opportunities (ranked, as of 2026-07-04 session)
1. **Dev-nav perceived freeze**: all pages are client components; first
   navigation in dev waits on compile with no in-app feedback. Production
   unaffected — do NOT add 14 loading.tsx files; revisit only if server
   pages appear.
2. ~~Portfolio health-score sublabels truncate mid-word~~ — fixed 2026-07-06.
3. ~~Watchlist redundant "Added" date~~ — fixed 2026-07-06.
4. ~~Screener HEALTH column clips with no scroll affordance~~ — fixed 2026-07-06.
5. ~~`text-[9px]`/`text-[10px]`/`text-[11px]` micro-sizes~~ — investigated
   2026-07-06, not a defect (see below).
6. ~~48 pre-existing lint warnings~~ — fixed 2026-07-06 (see below).

## Session 2 (2026-07-06) — continuation, not a re-audit

Picked up the ranked list above plus two areas the first session didn't
cover (dialogs/forms, keyboard a11y). Did not redo the full page audit —
built directly on session 1's findings.

### Fixed
1. **Portfolio health dimension captions** truncated mid-word at a fixed
   `w-14` column (`portfolio-health.tsx`) — moved the explanation to its own
   full-width line with a `title` tooltip for the full text.
2. **Watchlist redundant date** — merged "Added 5d ago" + the separate
   "Added Jun 29, 2026" footer divider into one line; the absolute date is
   now a hover `title` on the relative one.
3. **Screener HEALTH column scroll affordance** — added a real overflow
   check (`scrollLeft + clientWidth < scrollWidth`) driving a right-edge
   fade. First attempt used a `bg-gradient-to-l from-surface` overlay that
   turned out to be **invisible in the live browser** (the color matched
   the table's own background almost exactly) — caught by re-screenshotting
   after implementing, not just reading the diff. Replaced with an inset
   `box-shadow` (translucent black), which reads as a fade regardless of
   the underlying surface color. Lesson: verify color-matched overlays
   live, not just by code review.
4. **Micro-typography (`text-[9/10/11px]`) audit** — sampled ~10 components
   before touching anything. Found a real, consistently-applied three-tier
   scale: 9px for uppercase pill/badge labels, 10px for uppercase
   micro-headers and tabular numerics, 11px for regular-weight secondary
   captions (one 8px outlier is a deliberate "/100" subscript). This is
   working hierarchy, not drift — flattening it would have actively hurt
   the "information hierarchy" goal. No changes made; documented so a
   future session doesn't re-flag it.
5. **Lint cleanup**: 48 → 0 warnings. Mostly dead imports/params, but two
   were substantive:
   - `lib/scanner/causal-engine.ts` had a redundant `otherEvents` filter
     (never used — the function already reconstructs full output order via
     a Map) and an obfuscated index expression
     (`i + enriched.length - (enriched.length - enriched.length)`, always
     just `i + enriched.length`) — simplified.
   - `app/scanner/page.tsx`: the SSE stream handler threw on
     `{type:"error"}` messages *inside* the same try/catch that guards
     `JSON.parse` against malformed lines, so real backend scan errors were
     silently swallowed as "malformed line" instead of surfacing via
     `setError()`. Split JSON parsing from message dispatch so real errors
     propagate to the outer catch.
6. **Dialog/drawer duplication**: found three independent slide-in "drawer"
   implementations (calendar `EventDrawer`, timeline `EventDetailDrawer`,
   plus the existing centered `Dialog`) with diverging accessibility —
   the timeline one had *no* Escape handling, no `aria-modal`/`role`, no
   focus trap, and rendered without a portal. Added a shared `Drawer` to
   `app/_components/dialog.tsx` (same focus-trap/Escape/scroll-lock as
   `Dialog`, side-anchored) and migrated both call sites. Live-verified:
   Escape now closes both, focus returns to the trigger element.
7. **Keyboard accessibility**: swept for `onClick` on non-interactive tags
   without `role`/`tabIndex`. Found and fixed three real gaps — a
   collapsible header in `portfolio-fit-panel.tsx`, an expandable holdings
   row in `holdings-tab.tsx`, and a job-tab-with-nested-remove-icon in
   `engine/page.tsx` (the last one also had an invalid nested-interactive
   pattern — `<span onClick>` inside a `<button>` — restructured into a
   `div[role=button]` containing a real nested `<button>`). Live-verified
   Enter/Space now toggle the holdings row.
8. **Real crash, found by chance while live-testing #7**: `/portfolio`'s
   default Brief tab threw `Cannot read properties of undefined (reading
   'length')` in `ai-portfolio-brief.tsx`. Root cause: `/api/ai/portfolio-
   brief`'s `extractJson()` only guarantees parseable JSON, not schema
   completeness — the local Ollama model can (and did) omit `actionItems`
   from its response, and the route trusted the TypeScript cast with no
   runtime default. Fixed by defaulting each field after extraction rather
   than trusting the type assertion. **Not fixed**: the same
   trust-the-cast pattern exists at ~25 other `extractJson<T>()` call sites
   across `lib/` — worth a dedicated hardening pass, out of scope here.

### Investigated, no change needed
- Buttons and form inputs: sampled across screener/DCF/watchlist/portfolio.
  Already consistent (`bg-accent-strong` for primary CTAs, `rounded border
  border-border bg-surface px-py outline-none focus:border-accent` for text
  inputs) — no action.
- Responsive breakpoints: nav already has a proper `md:hidden` hamburger +
  `#mobile-nav` panel; grids throughout use `sm:`/`lg:` column steps.
  (Note: the browser-automation `resize_window` tool did not actually
  change the captured viewport in this environment, so mobile layouts were
  verified by reading the responsive classes rather than screenshotting a
  narrow viewport — flag this if a future session needs actual mobile
  screenshots.)

Verified after all changes: `tsc --noEmit` clean, eslint 0 errors/0
warnings, 317/317 tests, live browser verification of both drawers
(Escape + focus return), the holdings-tab keyboard toggle, and the fixed
portfolio-brief crash.

## Remaining opportunities (ranked, as of 2026-07-06)
1. **Dev-nav perceived freeze** (unchanged from session 1 — still correctly
   deferred).
2. **`extractJson<T>()` schema-trust pattern** — ~25 call sites in `lib/`
   cast LLM JSON output to a type with no runtime validation. Only the one
   that actually crashed (`portfolio-brief`) was fixed. A dedicated pass
   should add the same "default missing fields after extraction" treatment
   (or a small shared validator) to the rest.
3. ~~`app/portfolio/_components/position-recommendations.tsx` is confirmed
   still dead code (defined, never imported — `actions-tab.tsx`'s
   `DecisionCard` is the live "Decision Queue" UI).~~ Done — deleted in
   PLAN-legacy-cleanup.
4. Mobile/narrow-viewport layouts were reasoned about via responsive
   classes, not screenshotted — worth a real device-width pass if the
   browser tooling supports it in a future session.

## Session 3 (2026-07-06) — World-class redesign (mandate: "Bloomberg, redesigned in 2026")

Full autonomous redesign; this is a REDESIGN, not the earlier refinement passes.
User interview locked: product for retail investors, premium fintech-professional
(Linear/Vercel clarity + Stripe refinement + Bloomberg density where it earns it),
light mode + new deps + module consolidation + arch refactors all in-bounds;
hard constraint = analytical correctness & API contracts must not regress.

Milestones (see also memory project_uaa_redesign_2026):

**M1 — Design system + LIGHT MODE (new).** `globals.css` rebuilt as dual-theme
semantic tokens under `[data-theme]` (dark on `:root` too for SSR). Added
`--border-strong`, `--faint`, `--brand-muted`, per-theme shadows, `--grid-line`,
`--ease-spring`, tabular-nums helper, reduced-motion block. No-flash init script
(`THEME_INIT_SCRIPT` in `app/_components/theme.tsx`) injected in layout `<head>`;
`<html data-theme="dark" suppressHydrationWarning>`. Dark default; stored pref
(localStorage `uaa-theme`) wins. `useTheme()` (useSyncExternalStore, SSR-safe) +
`<ThemeToggle>` in header. Semantic pos/neg/warn DARKEN in light for AA contrast.

**M2 — Theme-aware charts.** `chart-theme.ts` → `useChartTheme()`/`getChartTheme()`
returning literal-hex palettes per theme (Recharts var() is unreliable). Migrated
interactive-chart, compare-chart, radar-chart, AND candle-chart (structural+semantic
colors threaded into module-scope shape/tooltip helpers via props; categorical
BLUE/AMBER/PURPLE/TEAL/ORANGE kept static — legible on both). `CHART_SERIES` stays
static. Legacy `CHART_*` consts retained for compat.

**M3 — Primitives** (APIs unchanged → zero call-site churn): Button (focus rings,
`xs` size, primary keeps theme-adaptive `text-background`), Card (interactive lift),
StatTile (tone accent bar + tabular-nums), Input (ring focus), Tabs (semibold active).

**M4 — Goal-based IA + app shell.** User chose first-principles IA rethink. New
`app/_components/nav-config.ts` = single source (header + palette). 4 OBJECTIVES:
Today (`/`), Discover (Screener/Scanner/Thematic/Intelligence), Research (Deep
Research/Compare/DCF/IC Report/Engine), Portfolio (Portfolio/Watchlist/Calendar).
`site-header.tsx` rewritten with hover/focus hub dropdowns + ⌘K trigger; mobile menu
closes via click-delegation. `command-palette.tsx` (mounted in layout): ⌘K/Ctrl-K,
ticker search (/api/search → `/research?symbol=`) + fuzzy tool nav. Existing
routes/URLs unchanged — relayered, not moved. Effects written to satisfy the
enforced `react-hooks/set-state-in-effect` rule (debounce clears inside timeout;
active-index reset on input change; no route-change effect).

**M5 — Home / "Today".** `page.tsx` realigned to the 4-objective model: tighter hero
with a prominent ticker-search hero action + ⌘K hint, compact stat strip, live
Market Dashboard + Today's Pulse, and a "Jump in" launcher built from NAV (Discover/
Research/Portfolio cards listing their tools). Converted daily-pulse + market-dashboard
legacy green `accent` links → `brand` (blue) so action-chrome no longer collides with
the green "gains" semantic.

Verified each milestone: `tsc` clean, `eslint` 0, 317/317 tests, live QA in BOTH
themes (home, Discover hub dropdown, ⌘K ticker+tool search & deep-link, research
line chart in light). Gotcha logged in memory: a stale `next dev` on :3000 served
old CSS — kill all `next dev`/`next-server` if token edits "don't apply".

**M6 progress:** Research MASTHEAD redesigned (unified header+key-stats into one dense
terminal card: iconified ghost/emphasized action row + hairline-divided tabular stats
strip). Screener TABLE upgraded (sticky header in a bounded `max-h` scroll region,
active-sort column brand-highlighted, tabular-nums, refined header/hover). Both verified
live in light (dark inherits via tokens); tsc/eslint/317 tests green.

**App-wide chrome consistency (big win):** ~70 files still used the legacy green
`accent` classes (~350 instances) for chrome/links/selection, clashing with the blue
`brand` used in the migrated nav/home/masthead. Instead of 350 risky call-site edits,
`--accent`/`--accent-strong` in globals.css now ALIAS `--brand`/`--brand-strong` (both
themes). So every `bg-accent`/`text-accent`/`border-accent`/`focus:border-accent` usage
instantly renders brand-blue, unifying chrome app-wide with zero churn, fully reversible.
IMPORTANT for future work: `accent` == `brand` now (blue), NOT green. Gain/positive
semantics use `--positive` (unaffected). Fixed the one semantic-green case this exposed:
`screener/_components/score-chip.tsx` mid-tier (55–75) was `accent` — now stays green
(`positive` at lower opacity) since a score chip must read as a quality signal, not chrome.
Also converted compare-chart period/metric selection (`bg-accent`→`bg-brand-strong`).

**M7 — remaining surfaces + perf (DONE):**
- **Theme correctness swept app-wide.** Found + migrated the last 5 chart components that
  still hardcoded dark hex (broke in light mode): research `charts.tsx` (Margin/Revenue/
  PeerRadar), `valuation-history-chart.tsx`, `earnings-card.tsx`, India `financial-charts.tsx`
  (4 charts + 2 shared tooltips), India `ownership-timeline.tsx`. Same pattern as candle-chart:
  structural axis/grid/tooltip/cursor from `useChartTheme()` threaded into module-scope
  tooltips via a `style` prop; categorical/semantic series colors kept static (legible on
  both). Verified `quadrant-view.tsx` + `thesis-evolution-panel.tsx` are already safe (they
  use CSS `var(--…)` in HTML `contentStyle`, which adapts). **A full grep confirms ZERO
  hardcoded dark colors remain anywhere in app/ outside the (now theme-aware) chart files.**
- **Performance assessed, not blindly refactored.** Prod bundle = 3.3MB client JS across 44
  files; largest are shared vendor (4×363KB); `yahoo-finance2` correctly server-only (absent
  from client). Pages prerender static shells (○). For a localhost-served tool, network size
  isn't the bottleneck, so bundle-trimming / client→server conversion is low-ROI and was
  consciously de-scoped rather than churned. The dev-nav compile lag is a known dev-only item
  (see session 1) deliberately left.
- **Final gate:** `next build` ✓ (21/21 static pages), `tsc` clean, `eslint` 0, **325 tests**.

**Consciously de-scoped (low-ROI / high-risk, documented not forgotten):** deeper bespoke
LAYOUT surgery on Portfolio/Compare internals (they already inherit the new system, themed
charts, consistent chrome, refreshed StatTiles + sticky holdings table); broad client→server
component conversion + list virtualization (needs real profiling to justify on a local app);
adopting `extractJsonObject` at the ~18 internal (non-UI) `extractJson` sites (no crash surface).

**Production gate + robustness:** `next build` ✓ compiles all 16 routes clean. Added
`extractJsonObject<T>(raw, defaults)` to `lib/json-extract.ts` — schema-safe LLM-JSON
coercion (missing/null/type-mismatched fields fall back to defaults, arrays stay arrays,
never throws) + 8 unit tests (suite now 325). Applied to the flagship `/api/ai/verdict`
route (research page's core AI answer, which .map()s catalysts/risks/keyMetrics). Verified
`/api/screener/nl` needs NO change — its `FundamentalScreenerCriteria` is all-optional, so
a partial parse is valid. Remaining ~18 `extractJson` sites are mostly internal lib
processing (not direct UI `.map()`s); adopt `extractJsonObject` per-schema as touched.
- M7: remaining surfaces (Scanner/Thematic/Intelligence/IC Report/DCF/Engine/Watchlist/
  Calendar) + perf/arch (server/client boundaries, streaming, list virtualization) +
  FINAL gate incl. `next build` and full light-mode chart QA (candle mode live).
- Known debt: ~25 `extractJson<T>()` call sites lack runtime schema defaults (one
  crash already fixed in session 2); `position-recommendations.tsx` is dead code.
