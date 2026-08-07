# 14. Code Health: the Today dashboard

Scope: `app/page.tsx`, `app/_home/**` (18 files), `lib/home/**` (20 files), `app/api/home/**` (4 routes), plus the shared pieces they lean on (`lib/metric.ts`, `lib/format.ts`, `lib/platform/client/use-dataset.ts`, `app/_components/ui` Section primitives, `tests/home-*.test.ts`, e2e specs).

Method: full read of every in-scope file in the CURRENT working tree (note: `git status` shows uncommitted modifications from a concurrent session in `app/_home/_atmosphere/explain-popover.tsx`, `_viz/format.ts`, `_viz/sparkline.tsx`, `home-header.tsx`, `module-map.ts`, `module-shell.tsx`, all six committed modules, and `lib/home/{contracts,digest,explain,layout,market-intel,pulse,registry}.ts`; `stream-primitives.tsx`, `use-hydrated.ts`, and `lib/home/equity-curve.ts` are untracked new files. All line numbers below are working-tree state, not HEAD). Lint run: `npx eslint app/_home lib/home --no-warn-ignored` (2 problems, both pre-existing and listed in AGENTS.md; see CH-25). `npx tsc --noEmit` was not run per instructions.

Line counts (working tree): `attention-queue.tsx` 779, `ai-investment-brief.tsx` 517, `market-intelligence.tsx` 420, `todays-brief.tsx` 409, `book.tsx` 367, `radar.tsx` 273, `module-shell.tsx` 225, `whats-changed.tsx` 162, `home-provider.tsx` 194; `lib/home` totals 6,207 lines across 20 files, of which `contracts.ts` is 760 and `attention.ts` 442.

---

## 1. Component boundaries and size

**CH-01 - attention-queue.tsx (779 lines) is at least ten components and three concerns in one file.**
Hidden sub-components and units, top to bottom: `kindTone()` (75), `ICON_TONE` map (91), `KIND_GLYPH`/`THREAT_GLYPH`/`glyphFor()` (104-127), `CategoryGlyph` (131), `RowTitle` (138), `daysAgo()` (163), `contextChips()`/`ContextChips` (176-197), `SpotlightCard` (210-334, itself holding `showWhy` state at 219), `QueueRow` (350-433), and `AttentionQueueModule` (439-779). The module function alone owns six `useState` slots (448-453), two refs (455-456), an optimistic dismiss/undo pipeline that interleaves animation timing, network persistence, rollback, and focus management inside one callback (`dismiss`, 498-563, including the `failed` closure flag at 503 that couples the animation timer to the fetch promise), a keyboard listbox handler (575-603), and four render branches (653-776). State (pending/exiting sets, filter, expansion, roving tabindex) and presentation (skeletons at 653-675, spotlight styling, empty states) are fully tangled: none of the row components can be tested or reused without the module's callbacks. Extraction candidates: `useQueueDismiss()` hook (the dismiss/undo/rollback pipeline), `useRovingListbox()` hook, and separate files for `SpotlightCard`/`QueueRow`/the tone-and-glyph maps.

**CH-02 - ai-investment-brief.tsx (517 lines) hides eight units plus a hand-copied lifecycle block.**
Units: `stripEmDashes()` (67), `NUMERIC_TOKEN` + `renderProse()` (75-96), `isEmptySection()` (109), `regimeVisual()` (128), `participationLabel()` (145), `GRID_SECTIONS` (162), `QualifierPill` (169), `SectionTile` (177), `TileSkeleton`/`BriefSkeleton`/`BriefError` (213-269), and the module (277-517). Because this module bypasses `ModuleShell`, it re-implements the shell's lifecycle emission verbatim: compare `ai-investment-brief.tsx:294-310` with `module-shell.tsx:107-123` (same `lastStatus` ref pattern, same three effects). That is a copy that will drift the first time either side changes. The body is built via an IIFE (342-450), which makes the branch structure hard to test in isolation.

**CH-03 - todays-brief.tsx (409 lines) mixes six digest slices, animation, and text processing in one component.**
Units: `readingTime()` (42), `scrollToActions()` (48, a raw `document.getElementById` DOM reach into a sibling module's `id="action-center"`, attention-queue.tsx:610, an implicit cross-module string contract with no validator), `regimeTone()` (55), `splitNarrative()` (76), `MonoNumbers` (89), `Kpi` (107), module (131-409). The module selects six slices (133-138) plus the brief, and derives `changeSummary`, `resume`, `narrative`, `readLabel`, `accentLine`, and two `useCountUp` animations before its first JSX line. Its `dismissed` state (139) is session-only `useState`, while the sibling AI brief's collapse is persisted via `usePersistedState` (ai-investment-brief.tsx:286): two different persistence policies for the same "hide this module" gesture.

**CH-04 - Prop drilling.**
(a) `RowProps` (attention-queue.tsx:340-348) drills seven props (`item, index, active, exiting, onFocus, onDismiss, registerRef`) into both `SpotlightCard` and `QueueRow`; `registerRef`/`active`/`onFocus` exist only to serve the parent's roving-tabindex machinery and would disappear behind a context or hook. (b) `ModuleGrid` (module-grid.tsx:83-86) passes `collapsible`/`defaultCollapsed` to every module; only `AiInvestmentBriefModule` (277-283) declares them, the other six silently ignore layout config that names them (a `collapsible: true` on `book` in `layout.ts` would be a no-op with no warning). (c) `Kpi` (todays-brief.tsx:107-129) takes four raw Tailwind class strings as props (`tone`, `captionTone`, `className`, plus label styling via module-level constants), i.e. styling decisions drilled as strings rather than semantic variants.

**CH-05 - Side effect inside a state updater.**
`module-shell.tsx:125-130`: `toggle()` calls `emit(...)` inside the `setCollapsed` updater function. React updater functions must be pure (StrictMode double-invokes them), so the lifecycle event can fire twice per toggle in dev and is a latent bug for any Phase 2 listener. The AI brief's own toggle does it correctly outside the updater (ai-investment-brief.tsx:327-330).

**CH-06 - Provider context value identity churn.**
`home-provider.tsx:153-165`: the `useMemo` deps include `digest` and `brief`, which are fresh object literals from `useDataset` on every render (`use-dataset.ts:140-158` spreads a new object each call). The memo therefore never caches across renders and every `useHome()` consumer re-renders whenever the provider does. Low impact today (the provider's parents are static), but it defeats the stated purpose of the memo and will matter once lifecycle listeners subscribe.

---

## 2. Duplicated formatting logic: full call-site inventory

Two formatter modules exist: `lib/format.ts` (app-wide; `formatPercent`, `formatCompact`, `formatNumber`, `formatCurrency`, `toneClass`, etc.) and `app/_home/_viz/format.ts` (page-local; `fmtSignedPct`, `fmtSignedMoney`, `fmtMoney`, `gradeTone`, `fmtTodayDate`, `relativeTime`, `countdown`), the latter delegating to the former for percent/compact only.

**CH-07 - Inventory of every number-formatting call site on the dashboard path, by which layer it uses.**

Via `app/_home/_viz/format.ts` (which wraps `lib/format`):
- `todays-brief.tsx:275` `fmtMoney(animValue)`; `:278` `fmtSignedPct(animToday)`; `:280` `fmtSignedMoney(todayChangeDollar)`; `:173` `gradeTone`.
- `book.tsx:166,171` `fmtSignedPct(curve.portfolioPct/benchmarkPct)`; `:242` `fmtSignedMoney`; `:267,275,291,292` `fmtSignedPct` (XIRR, return on cost, benchmark, excess); `:50` `gradeTone`.
- `_viz/primitives.tsx:11` `fmtSignedPct` (dead file, CH-14); `_viz/bars.tsx:10` `fmtSignedPct`/`fmtSignedMoney` (dead file).

Via `lib/format.ts` directly:
- `_viz/stamped.tsx:19,25` `formatPercent` inside `signedPct()` (all `MetricDelta` renders: todays-brief.tsx:352,362; book.tsx:236-240; market-intelligence.tsx:115-120,257).
- `book.tsx:20,241,266,272,333` `toneClass`.

Neither layer (inline, client-side):
- `attention-queue.tsx:179` `ctx.heldWeightPct.toFixed(1)` + "% of book"; `:243,410` `Math.round(item.score)`; `:276` `impact.healthDelta.toFixed(1)`; `:281` `Math.abs(impact.riskDeltaPp).toFixed(1)` + "pp"; `:286` `Math.abs(Math.round(impact.incomeDeltaAnnual)).toLocaleString()` (no locale argument, so viewer-locale grouping, unlike everything else on the page which pins en-US); `:271,274` raw `impact.healthBefore/After`.
- `book.tsx:39-42` local `fmtBps()` (hand-rolled sign + `toFixed(1)` + true minus, duplicating `fmtSignedPct`'s sign convention for a different unit); `:282` `Math.round(d.cashPct)` + "%"; `:69` `{score ?? "-"} / 100`.
- `market-intelligence.tsx:51-53` local `fmtLevel()` (`toLocaleString("en-US", {min/maxFractionDigits: 2})`, duplicating `lib/format.ts formatNumber(value, 2)` exactly); `:168` `${fmtLevel(p)}%` for the 10Y yield.
- `todays-brief.tsx:296,304` `String(actionCount)`; `:289` `{p!.healthGrade} {p!.healthScore ?? "-"}`; `:242-249` raw `changeSummary` counts.
- `radar.tsx:59` `Math.round(o.absoluteScore)` + "/100" appended into a sentence; `:137` `Math.round(o.combinedScore)`.
- SVG-internal `toFixed` (geometry, not display; exempt from a formatting layer but listed for completeness): `book.tsx:125,136,137`, `_viz/sparkline.tsx:51`, `_viz/radar.tsx:28`.

Neither layer (server-side, numbers baked into prose strings inside `lib/home` before they ever reach the client):
- `lib/home/threats.ts:54,70,85,131,146` `.toFixed(1)`/`.toFixed(2)` inside `detail` sentences.
- `lib/home/changes.ts:223,351,353` `.toFixed(1)` inside change headlines/details.
- `lib/home/brief.ts:136` `todayChangePct.toFixed(1)` inside the deterministic briefing.
- `lib/home/explain.ts:71,104,109,116,192,215,225,235` `.toFixed`/`Math.round`/`toLocaleString()` inside explanation `display` strings (235 again uses locale-less `toLocaleString`).
- `lib/home/pulse.ts:229` session note prose with an inline `Intl.DateTimeFormat`.
These server-side sites matter most for the planned single formatting layer: because the digest ships pre-formatted STRINGS, no client formatting layer can normalize them. The fact layer must ship structured `{value, unit}` (or `Metric`) and let the client format.

**CH-08 - Three near-identical numeric-token regexes and two em-dash strippers.**
`todays-brief.tsx:82` `NUMERIC_TOKEN = /([+\-−]?\$?\d[\d,.]*[%KMB]?)/g`, `ai-investment-brief.tsx:75` `NUMERIC_TOKEN = /(?<![A-Za-z0-9])([+\-−]?\$?\d[\d,]*(?:\.\d+)?(?:\/\d+)?%?)/g`, and `stream-primitives.tsx:70` `NUMBER_RE = /(\d[\d,]*(?:\.\d+)?%?)/g` all implement "wrap numbers in mono/tabular" with three different token definitions (only one guards against splitting "SMA200"; only one handles "73/100"; only one catches "$3.4M"). Em-dash-to-comma normalization is likewise duplicated: `ai-investment-brief.tsx:67-69 stripEmDashes()` vs `stream-primitives.tsx:80`'s inline replace; the two regexes even disagree on whitespace tolerance (the brief's uses `\s*` around the dash character, the stream's requires exactly one `\s` on each side). The same prose through two paths can render differently.

**CH-09 - The signed-percent implementation exists twice, and the deprecated bare-number Delta still ships.**
`_viz/format.ts:21-24 fmtSignedPct()` and `_viz/stamped.tsx:24-26 signedPct()` are byte-for-byte the same logic (`formatPercent(...).replace("-", MINUS)`), maintained separately; stamped's has a `digits = 1` default via `MetricDelta` while `formatPercent`'s own default is 2, so the "one default, overridden nowhere" comment (stamped.tsx:42-43) is enforced by convention only. `_viz/primitives.tsx:9-12 Delta` is the exact bare-number component `stamped.tsx:6-7` says "the final F-22 commit deletes"; it survives with zero importers (CH-14) as a trap for the next contributor.

---

## 3. Date/time handling

**CH-10 - Four competing definitions of "today", split across UTC and local.**
- UTC calendar day: `lib/home/digest.ts:207` `new Date().toISOString().slice(0, 10)` (event window start) and `:210` cutoff (but `:209 cutoff.setDate(...)` mutates in LOCAL time before the UTC slice, mixing the two in one computation); `lib/home/equity-curve.ts:76-79` (window anchor).
- Local (server TZ) calendar day: `lib/metric.ts:94-98 localDate()` feeding `metricSessionState` (staleness policy); `lib/home/brief.ts:182-184` (grounded-fact sessionDate).
- Local (viewer TZ) calendar day: `_viz/format.ts:58-65 fmtTodayDate()` (page h1 and Market Overview stamp).
On a server whose TZ is not UTC, digest "today" and metric "today" disagree around midnight; a viewer in another TZ adds a third. A US-market session-date policy exists (`lib/day-change.ts`, per the architecture map) but these helpers do not route through it.

**CH-11 - Locale policy is inconsistent across the page.**
Pinned `"en-US"`: `_viz/stamped.tsx:32,37` (`shortSessionDate`, `shortTime`), `market-intelligence.tsx:52` (`fmtLevel`), `todays-brief.tsx:263` (brief generatedAt time), `lib/home/pulse.ts:229`, `lib/format.ts:52,63` (all base formatters). Viewer locale (`undefined`/`[]`): `_viz/format.ts:59 fmtTodayDate`, `home-header.tsx:24 toLocaleTimeString(undefined, ...)`, `whats-changed.tsx:46,49` (`sinceLabel`). Locale-less: `attention-queue.tsx:286` and `lib/home/explain.ts:235 toLocaleString()`. So the header's date obeys the viewer's locale while the card timestamps two lines below it are en-US. One documented policy is needed before a formatting layer freezes either choice.

**CH-12 - Relative-time helpers are implemented five times with three different day-boundary semantics.**
Dashboard-local: `_viz/format.ts:68-81 relativeTime()` + `:84-95 countdown()` (elapsed-time buckets, `Math.round`); `attention-queue.tsx:163-168 daysAgo()` (`Math.floor((now - t)/86_400_000)`, so an event at 23:00 yesterday viewed at 01:00 reads "today", wrong by calendar-day semantics); `whats-changed.tsx:43-50 sinceLabel()` (same floor-of-ms pattern, same defect). Elsewhere in the app the pattern repeats (`app/research/_components/research-notes.tsx:6 timeAgo`, `app/_components/notification-bell.tsx:14 ago`). `countdown()`'s hour rounding also mislabels: at 25.4h away, `Math.round(hrs/24)` gives "Tomorrow" correctly, but at 0.6h `hrs = Math.round(0.6) = 1` gives "Today" while at 1.6h it gives "in 2h"; the "Today"/"in Nh" boundary is a rounding accident, not a rule.

**CH-13 - Hydration-safety is enforced in two places and relied on implicitly in three others; one timestamp is fabricated client-side.**
`use-hydrated.ts` gates `home-header.tsx:33` and `market-intelligence.tsx:354-365`. But `whats-changed.tsx:46,49` and `todays-brief.tsx:263` render locale times ungated; they are safe only because the data arrives via client fetch (never present at SSR), an invariant nothing documents or tests. Meanwhile `home-provider.tsx:86` initializes the brief accumulator with `generatedAt: new Date().toISOString()` (client clock); if the NDJSON stream dies before its `done` chunk, the UI shows a client-fabricated generation time as if the server stamped it, contradicting the F-22 "honest as-of" discipline (todays-brief.tsx:257-266 renders it).

---

## 4. Dead code and unused exports

**CH-14 - Four entire files in `app/_home/_viz/` have zero importers.**
Verified by repo-wide grep: `_viz/primitives.tsx` (50 lines: `Delta`, `SeverityBadge`, `SeverityDot`, `StatCell`, `Tile`), `_viz/feed-row.tsx` (59 lines: `FeedRow`), `_viz/bars.tsx` (77 lines: `ContributionBars`), `_viz/radar.tsx` (108 lines: `HealthRadar`) are imported nowhere. Consequently `_viz/format.ts relativeTime()` and `countdown()` (68-95) are exported but their only consumer is the dead `feed-row.tsx:11`, and `_viz/stamped.tsx:98 AsOfLine` has zero callers. These are leftovers of the retired timeline/attribution/health-radar modules.

**CH-15 - The digest ships six whole slices and a dozen fields no module reads.**
The complete set of client reads is the 20 `useHomeSlice(...)` calls (attention, portfolioPulse, recommendedActions, symbolContext, opportunityFeed, watchlistIntelligence, changes, marketIntelligence x2, performance, equityCurve, fallbackBriefing, activity) plus `digest.data.generatedAt` (market-intelligence.tsx:360, home-header.tsx:34). Never selected by any component: **`timeline`**, **`intelligence`** (the TimelineFeed pair built by `lib/home/timeline.ts` and assembled at digest.ts:232-237, 295-296; after the module retirement described in attention-queue.tsx:6-8 and radar.tsx:6-9 they render nowhere, yet the 155-line builder still runs on every digest), **`threats`** (contracts.ts:254; consumed server-side only as an attention feeder, digest.ts:261, but still serialized in full), **`attribution`** (contracts.ts:282, built at digest.ts:284 for a retired card), **`upcomingEvents`** (digest.ts:300; feeds attention server-side), and **`calibration`** (digest.ts:227-229, including an awaited `buildCalibration` call spent on a slice nobody renders). Unrendered fields inside live slices: `PortfolioPulse.largestRisk/largestOpportunity/diversificationScore/largestDrift/biggestStrength/biggestWeakness/marketPricedPct/radar` (contracts.ts:174-201; `radar` pairs with the dead `_viz/radar.tsx`), `PulseMover.sinceCost/plDollar` (contracts.ts:97-100), `MarketIntelligence.sectorAttention` (contracts.ts:83), `WatchlistIntelligence.total/alerts/upcomingEarnings` (contracts.ts:494-497; radar.tsx reads only `buckets`), `AttentionQueue.openCount/reviewedAt` (contracts.ts:398-402; the module RE-DERIVES openCount client-side at attention-queue.tsx:472 from `liveItems.length`, so the server's "true open count even when capped" contract field is dead and the two definitions can diverge). Given the measured 79.7 KB digest (architecture map §1), a meaningful fraction is payload nothing renders, and every dead field is un-flagged drift risk for the fact layer.

**CH-16 - The emit/subscribe lifecycle seam has zero consumers.**
`home-provider.tsx:53-54,140-151`: `subscribe` is exposed on context and called by nothing anywhere in the repo (grep confirms only the provider itself references it); `emit` is fired diligently by `module-shell.tsx:107-130` and `ai-investment-brief.tsx:294-310` into an always-empty listener set. `ModuleLifecycleEvent` includes `"reorder"` and `"resize"` (types.ts:186-187) that no code path can ever emit. This is a documented Phase 2 seam (provider comment 48-52), but it currently costs two effect blocks per shell-rendered module and a hand-copied triple effect in the AI brief (CH-02), all observable-behavior-free.

**CH-17 - ModuleShell features that no caller uses, and a capability gate wired by hand.**
`ModuleShell` is consumed exactly once (book.tsx:193). Its `collapsible`/`defaultCollapsed` props (module-shell.tsx:73-74) are never passed, so the entire collapse path (104, 125-130, 143-155, 210) is dead in practice; its `UNMET` map covers five capabilities (37-63) but only `"portfolio"` is reachable (book.tsx:190), and the shell never reads `definition.requires` (registry.ts:71 declares it), so the declared capability metadata and the actual gating are connected only by the module author remembering to compute `unmet` themselves.

**CH-18 - Unwired registry metadata and an endpoint with a dead verb.**
Registry fields consumed at runtime: `title`, `description`, `navTarget`, `defaultSize`/`minSize` (layout resolution), `id`. Fields consumed by tests only, with no runtime implementation anywhere: `loading` ("eager"/"deferred" drives nothing; there is one digest request for all modules), `refresh` + `refreshIntervalMs` (registry.ts:164-165 declares a 60s interval for market-intelligence and the architecture map §6 repeats it, but grep finds no code that reads `refreshIntervalMs` outside `registry.ts`/`types.ts`/`tests/home-registry.test.ts`; no interval poll exists in the working tree, so the tape does NOT auto-refresh), `priority` (paint order is layout order), `cache`, `screens`, `dataSources`, `dependencies`. This is the classic shipped-but-unwired pattern AGENTS.md warns about, now in metadata form: the registry promises behavior the shell never implements. Endpoint side: `POST /api/home/activity` has one caller (`use-record-activity.ts:25`, mounted only by `app/research/page.tsx:1865`; the homepage itself records nothing despite the file living in `app/_home/`), and `GET /api/home/activity` (route.ts:25-33) has zero fetch callers (the materiality route calls `getActivityAt` directly, `app/api/materiality/research/route.ts:64`), making the GET handler dead API surface. Also unused in UI: `lib/home/explain.ts:181 explainSentiment` (the sentiment tile at market-intelligence.tsx:299-330 renders no `ExplainableValue`; the export is exercised only by tests).

---

## 5. Type looseness

**CH-19 - The digest crosses the wire on a blind cast; a malformed digest reaches every module untyped.**
`home-provider.tsx:66` `return (await res.json()) as HomeDigest;` performs no runtime validation of a 79.7 KB payload with ~18 slices. Any server-side shape drift (a slice renamed, a field nulled where the type says number) flows straight into components: e.g. `attention-queue.tsx:464 (data?.items ?? [])` survives a missing array, but `book.tsx:215 d.topContributors` and `whats-changed.tsx:102 data.status`/`:121 data.changes.length` would throw on a malformed slice, taking the whole page down via the route-level boundary (CH-22). Same pattern for the stream: `home-provider.tsx:107` `JSON.parse(line) as HomeBriefChunk` trusts the chunk's `type` discriminant, and a `note` chunk with the wrong inner shape lands in `renderProse(note[s.key])` (ai-investment-brief.tsx:420) uninspected. Contrast: the server itself validates INBOUND bodies field-by-field (activity route.ts:44-54, dismiss route.ts:24-29) and `lib/home/brief.ts:219-238` carefully narrows the MODEL's untrusted JSON (`str()`, `readNote()`), so the codebase already has the discipline; it is only the server-to-client hop that is unguarded. A `parseHomeDigest()` (zod or hand-rolled narrowing like `readNote`) in `contracts.ts` is the fix and is also the natural anchor for the planned fact layer.

**CH-20 - `stepValue<T>` is an unchecked cast, used eight times in the digest build.**
`lib/platform/orchestrator.ts:313-316` returns `r.value as T`; nothing ties the type parameter to the step's `run` return type. `lib/home/digest.ts:196-203` performs eight such casts (`ctx`, `report`, `calendar`, `watchlist`, `notifications` via the clever but fragile `Parameters<typeof buildRecommendedActions>[2]`, `market`, `performance`, `equityCurve`). Renaming a step id or changing a step's return type compiles clean and mis-projects at runtime. A typed plan builder (step ids as a mapped type) or per-step result narrowing would close this. Related smaller casts: `dismiss route.ts:25` `body.kind as AttentionKind` (cast before the `KINDS.includes` check at 29 rather than a type guard), `module-map.ts:43` `Object.keys(...) as HomeModuleId[]`.

**CH-21 - Non-null assertions and `as` narrowing cluster in the hottest render paths.**
`todays-brief.tsx` uses `p!.`/`grade!.` ten times (173, 179, 186-187, 279-281, 284, 288-289) hanging off the `hasPulse` boolean at 169; a refactor that moves one JSX block outside the `hasPulse` branch becomes a runtime crash the compiler cannot see (an early destructure into a narrowed local would eliminate all ten). `lib/home/pulse.ts` has `m.dayChange!` (225) plus four `as number`/`as string` casts (250, 252, 255, 276, 294) that paper over the filter/sort losing the narrowing. None are wrong today; all are load-bearing assumptions the planned refactor must not silently break.

---

## 6. Error boundaries

**CH-22 - No per-module error boundary: one module's render throw takes down the entire dashboard.**
Grep confirms there is no React error boundary class anywhere in `app/` or `lib/` (`componentDidCatch`/`getDerivedStateFromError`: zero hits). The only safety net is Next's route-segment boundary `app/error.tsx` (plus `app/global-error.tsx`), which replaces the WHOLE page with the "This page failed to render" card. So the failure isolation story is asymmetric: the server isolates aggressively (per-step `runPlan` isolation, per-slice `status`, per-feeder `degradedFeeders`), but the client renders seven modules with zero isolation; a `TypeError` in, say, `ComparisonSparkline` (book.tsx:106-176, which does `curve.points[curve.points.length - 1]` at 130 after a `points.length >= 2` guard at 313 held elsewhere) or in `renderProse` on a malformed note (CH-19) blanks the brief, the queue, and the tape along with it. Given `module-grid.tsx:83` already renders each module at exactly one spot, wrapping `<Module/>` in a small `ModuleErrorBoundary` (falling back to the existing degraded-card idiom, with `emit("error", id)` for free) is a one-file change with page-wide payoff.

---

## 7. Test coverage on the dashboard path

**CH-23 - What exists.**
Unit (vitest, pure lib/home engines): `tests/home-attention.test.ts` (scoring, urgency, dedupe, dismissals, feeders), `home-changes.test.ts` (fingerprint capture/parse/promote/diff), `home-decision-surfaces.test.ts` (threats, attribution, timeline builders), `home-equity-curve.test.ts`, `home-explain.test.ts` (all four explainers), `home-modules.test.ts` (pulse, actions, watchlist buckets), `home-registry.test.ts` (registry validity, layout composition, nav targets, component-map lockstep), `home-sentiment.test.ts`, `home-symbol-context.test.ts`. E2E: `e2e/pages.spec.ts` renders `/` console-error-free with a seeded portfolio (ROUTES[0], line 19; assertions via `expectShellRendered`), and `e2e/journeys.spec.ts:17,69` uses `/` as the command-palette launchpad. That is solid coverage of the pure server-side projection layer and of "the page does not crash".

**CH-24 - The gaps.**
(a) **No component render tests at all**: nothing in `tests/` imports anything from `app/_home/`; every branch catalogued above (queue dismiss/undo/rollback, keyboard listbox, spotlight decision join at attention-queue.tsx:478-484, `isEmptySection` tile omission, `splitNarrative`, module-shell unmet CTA, the four-way empty/degraded/clear/loading branch at attention-queue.tsx:653-776) is exercised only incidentally by the e2e smoke, which asserts none of it. (b) **No numeric reconciliation test on the digest**: nothing asserts that the slices agree with each other, e.g. `attention.openCount === attention.items.length` post-filter (the client already re-derives it, CH-15), `pulse.topContributors` bps re-sum against `todayChangeDollar`/`totalValue` (contracts.ts:110-118 documents the arithmetic), `performance.totalReturnPct` vs `pulse.totalReturnOnCostPct` being the same engine field the contract comments promise (contracts.ts:184-193), or the ratio-vs-percent x100 boundary at digest.ts:125 (exactly the class of bug the comment says already happened: "-0.0% next to -$25,369"). (c) **No formatter tests for the page-local layer**: `tests/format.test.ts` covers `lib/format.ts` only; `_viz/format.ts` (`fmtSignedMoney` zero-sign case, `relativeTime`/`countdown` boundary buckets, CH-12's rounding defects) and `stamped.tsx` (`MetricDelta` session-label suppression matrix) are untested. (d) **No stream-parsing test**: `fetchBrief`'s NDJSON accumulator (torn lines, `error` chunk, missing `done`, empty headline throw, home-provider.tsx:77-126) is pure logic trapped in the provider file, untestable without extraction. (e) **No contract test for `/api/home`** shape (which is what CH-19 needs a parser for anyway). (f) `validateNavTargets` is tested with a synthetic route set (home-registry.test.ts:77-88); no test derives `knownRoutes` from the real `app/` tree, so a deleted `/wire` would still pass CI.

---

## 8. Known pre-existing lint issues (noted, not fixed)

**CH-25 - The eslint run over `app/_home lib/home` reproduces exactly the two issues AGENTS.md lists, and nothing else.**
(1) `app/_home/_atmosphere/use-count-up.ts:34` error `react-hooks/set-state-in-effect` (the reduced-motion snap calls `setValue` synchronously in the effect body; the fix direction is initializing from `prefersReduced()` in `useState` or routing through the same `useSyncExternalStore` trick as `use-hydrated.ts`). (2) `app/_home/modules/todays-brief.tsx:39` warning unused `definition` (the module reads no registry metadata since going bespoke; note this is line 39 in the current working tree, not the 31 recorded in AGENTS.md, more evidence of the uncommitted drift). Leave both; they are the concurrent session's to reconcile.

---

## 9. Refactor prerequisites for "single fact layer + single formatting layer + provenance plumbing"

**CH-26 - Seams that make the refactor safe (build on these).**
(1) `lib/home/contracts.ts` is the fact-layer seam: every number crossing the wire is already declared there, and `useHomeSlice` (home-provider.tsx:183-194) is the single client entry point, so a runtime parser + `Metric`-ization can be introduced slice-by-slice without touching modules. (2) `lib/metric.ts` + `_viz/stamped.tsx` are the provenance plumbing prototype: the pattern (branded basis, stamped as-of, render-boundary component that accepts only `Metric`) already works for day-changes; the work is extending it to the bare-number fields (`todayChangePct`, `totalReturnOnCostPct`, `xirrPct`, `cashPct`, `bps`, tape prices, curve percents) that currently carry no stamp. (3) `_viz/format.ts`'s F-22b comment (lines 14-19) already states the target rule (session quantities via `MetricDelta`, non-session via the formatter); the formatting layer is mostly consolidation, not invention.

**CH-27 - Prerequisite changes, in dependency order.**
(1) Add `parseHomeDigest()` runtime validation at the `fetchDigest` boundary (closes CH-19) BEFORE changing any slice shape, so drift during the refactor fails loudly. (2) Delete the dead weight first: the four dead `_viz` files, `relativeTime`/`countdown`/`AsOfLine`, the six unrendered digest slices and dead fields (CH-14/15), and either wire or delete the unconsumed registry metadata (CH-18); every dead field kept is a field the fact layer must migrate for nothing. (3) Move server-side number-in-prose composition (threats/changes/brief/explain `detail`/`display` strings, CH-07 last block) to structured `{value, unit, kind}` fields; until then the "single formatting layer" cannot reach roughly a third of the numbers on the page. (4) Unify the numeric-token/em-dash prose renderers into one `stream-primitives` export (CH-08) and fold `fmtBps`/`fmtLevel`/inline `toFixed` sites into `_viz/format.ts` (or promote that file into `lib/format.ts` home section), with a decided locale + "today" policy (CH-10/11) written down first. (5) Add the per-module error boundary (CH-22) before the refactor churns render paths, so a migration mistake degrades one card instead of the page. (6) Add the reconciliation tests of CH-24(b) as the refactor's safety net; they are the only tests that can catch a fact-layer x100/ratio/population regression.

**CH-28 - Risky files, ranked.**
(1) `app/_home/modules/attention-queue.tsx`: largest, most stateful, mixes optimistic network state with animation timers and focus (CH-01); any formatting-layer touch here risks the dismiss pipeline; extract the hooks first. (2) `lib/home/digest.ts`: the eight unchecked `stepValue` casts (CH-20) plus the mixed local/UTC window math (CH-10) sit exactly where the fact layer will be assembled. (3) `app/_home/modules/todays-brief.tsx`: ten non-null assertions (CH-21) and count-up animation share the KPI strip the formatting layer must rewrite. (4) `app/_home/home-provider.tsx`: the unvalidated boundary, the fabricated `generatedAt` (CH-13), and the memo churn (CH-06). (5) `lib/home/pulse.ts` and `lib/home/brief.ts`: the remaining `as` casts and server-side prose baking. (6) Everything under `app/_home/` and the seven `lib/home` files carrying uncommitted concurrent-session changes: coordinate before refactoring, since line numbers, and possibly semantics, are already in motion.

---

### Finding index

| ID | One-line summary |
|----|------------------|
| CH-01 | attention-queue.tsx: 10 components/3 concerns in one 779-line file; state/presentation tangled |
| CH-02 | ai-investment-brief.tsx: 8 hidden units + lifecycle block hand-copied from ModuleShell |
| CH-03 | todays-brief.tsx: 6-slice mega-component; DOM reach into sibling module; inconsistent dismiss persistence |
| CH-04 | Prop drilling: 7-prop RowProps; grid props 6 of 7 modules ignore; Tailwind strings as props |
| CH-05 | emit() side effect inside setState updater in module-shell toggle |
| CH-06 | HomeProvider context memo never caches (fresh useDataset object identity per render) |
| CH-07 | Full formatting call-site inventory: two layers plus ~25 inline sites, incl. server-side prose baking |
| CH-08 | Three divergent numeric-token regexes and two em-dash strippers |
| CH-09 | fmtSignedPct duplicated in stamped.tsx; deprecated bare-number Delta still shipped |
| CH-10 | Four "today" definitions across UTC/server-local/viewer-local; mixed in one computation in digest.ts |
| CH-11 | Locale policy split: en-US pinned vs viewer locale vs locale-less, on the same screen |
| CH-12 | Five relative-time helpers; floor-of-ms calendar-day defects; countdown rounding accident |
| CH-13 | Hydration gate applied inconsistently; client-fabricated generatedAt in fetchBrief |
| CH-14 | Four dead _viz files (primitives, feed-row, bars, radar) + dead relativeTime/countdown/AsOfLine |
| CH-15 | Six digest slices and ~12 fields serialized but never rendered; openCount re-derived client-side |
| CH-16 | emit/subscribe lifecycle seam has zero listeners; unreachable event kinds |
| CH-17 | ModuleShell collapse path dead; UNMET map 4/5 unreachable; definition.requires never read |
| CH-18 | Registry loading/refresh/interval/priority/cache metadata unwired (60s tape poll does not exist); GET /api/home/activity dead; explainSentiment unused in UI |
| CH-19 | fetchDigest/fetchBrief blind-cast JSON; malformed digest reaches components unvalidated |
| CH-20 | stepValue<T> unchecked cast x8 in digest.ts; cast-before-validate in dismiss route |
| CH-21 | Non-null assertion cluster (x10) in todays-brief; as-casts in pulse.ts |
| CH-22 | No per-module error boundary; single module throw blanks the whole dashboard via app/error.tsx |
| CH-23 | Existing coverage: 9 lib/home unit suites + / smoke in pages.spec/journeys.spec |
| CH-24 | Gaps: zero component tests, no digest numeric reconciliation, no _viz/format or NDJSON-parse tests, synthetic-route navTarget test |
| CH-25 | Lint clean except the two documented pre-existing issues (use-count-up.ts:34, todays-brief.tsx:39) |
| CH-26 | Refactor seams to build on: contracts.ts + useHomeSlice, metric.ts + stamped.tsx, format.ts F-22b rule |
| CH-27 | Prerequisite order: validate boundary, delete dead weight, de-prose server numbers, unify formatters, add module boundary, add reconciliation tests |
| CH-28 | Risky files ranked: attention-queue, digest.ts, todays-brief, home-provider, pulse/brief, uncommitted-drift set |
