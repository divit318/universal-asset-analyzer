# Thematic Tab Audit: Improvements

Date: 2026-08-01. Companion to docs/audits/thematic-tab-issues.md (issue IDs TH-xx referenced throughout). This file proposes changes; nothing here has been implemented.

## Executive summary

The Thematic tab's foundations are sound: a hardened engine with failure tracking, a cached and deduplicated API, a design-system UI with honest empty states, and real test coverage. The improvement program therefore is not a rewrite. It has four thrusts: (1) a set of small, isolated fixes that remove the observed wrong-data moments (literal "null" in the policy table, alphabetical universe truncation, the short-token news filter); (2) structural work that pays down the two real architecture gaps, a single 1,390-line page file and a cache with no schema version; (3) reliability work on the multi-minute stream (heartbeat, joiner progress, retry of the one stage that empirically fails); and (4) product work that turns a one-shot verdict page into an analyst tool: constituent transparency, sortable tables, proxy-basket performance context, cross-theme overlap, and a watchlist handoff that the type system already anticipates (`IdeaSource "thematic"` exists and nothing emits it).

## Counts

| Effort | Count |
|---|---|
| S (small, hours) | 12 |
| M (medium, one to a few days) | 10 |
| L (large, a week or more) | 3 |
| Total proposals | 25 |

Suggested sequencing lives in the roadmap at the end; every item lists effort, risk, files, and dependencies inline.

---

## 1. Quick wins (high impact, low effort, isolated blast radius)

### QW-1. Treat the string "null" (and empty string) as null in sanitizePolicyItem
- Fixes: TH-02 (observed literal "null" in the Capital column).
- What: in sanitizePolicyItem, map `"null"`, `"n/a"`, `""` (case-insensitive, trimmed) to null before the typeof check. Optionally change the prompt example to `"estimatedCapitalUSD": null` outside quotes so the model stops learning the wrong shape.
- Files: lib/thematic-engine.ts (sanitizePolicyItem, scorePolicy prompt); add a unit test beside the existing sanitizer tests.
- Effort: S. Risk: none. Dependencies: none. Sequence: first, alongside QW-2.

### QW-2. Fix the shortlist tie-break so the 140-cap is not alphabetical
- Fixes: TH-01 (TSM excluded from "AI Compute").
- What: the tie-break needs a relevance-bearing second key before the symbol key. Two options that keep determinism: (a) score industry hints by specificity (a hit on "semiconductor" is worth more than a hit on "software - infrastructure" when the theme names semiconductors; weight hints by their position in the lexicon entry), and/or (b) break remaining ties by the company's composite quality score via fundamentalQualityScore, which the engine already computes later and which is deterministic over cached fundamentals. Keep symbol as the final key for stability.
- Files: lib/thematic-engine.ts (shortlistUniverse); tests/thematic-engine.test.ts (add a "does not cut alphabetically" case with >SHORTLIST_SIZE tied rows).
- Effort: S/M. Risk: low; shortlist membership changes for broad themes, which is the point. Dependencies: none. Sequence: first batch.

### QW-3. Let short uppercase tokens through the news filter
- Fixes: TH-06 ("AI", "EV", "5G" dropped).
- What: in fetchThemeNews (and the sibling word list in shortlistUniverse's themeWords if desired), keep tokens of length 2-3 when they appear as standalone uppercase words in the raw theme (AI, EV, 5G, LNG, SMR), matching them with the existing word-boundary helper themeMatches rather than substring includes, so "AI" does not match "said".
- Files: lib/thematic-engine.ts (fetchThemeNews); unit test with an "AI Compute" fixture.
- Effort: S. Risk: low. Dependencies: none. Sequence: first batch.

### QW-4. Write the theme to the URL and react to query changes
- Fixes: TH-07 (stale ?theme=, dead same-route deep links).
- What: on run start, `router.replace('/thematic?theme=' + encodeURIComponent(t), { scroll: false })`; drive the auto-run effect off `themeFromQuery` changes (with a ref guarding re-runs of the same value) instead of a mount-only effect. Reload then restores the report actually on screen, and a second deep link while on the page works.
- Files: app/thematic/page.tsx.
- Effort: S. Risk: low-medium (effect retriggering needs the same-value guard tested by hand). Dependencies: none. Sequence: first batch.

### QW-5. Mark unevidenced stages on their Overview panels
- Fixes: TH-04.
- What: Panel already receives a score; give it an optional `evidenced` prop (derived from report.integrity.missingStages / stageFailures) and render the existing warning Badge ("unevidenced, neutral default") in the panel header, plus grey the enum tiles when their stage failed. All data is already in the report; no engine change.
- Files: app/thematic/page.tsx (Panel, OverviewTab).
- Effort: S. Risk: none. Dependencies: none. Sequence: first batch.

### QW-6. Correct the unevidenced risk-flag copy for weightless stages
- Fixes: TH-03 (observed self-contradiction).
- What: in collectRiskFlags, split the failed set into score-weighted stages and weightless ones (Dependency Chain, Company Mapping). Weighted failures keep the current sentence; weightless failures get "its tab is empty, but the headline score is unaffected". The evidenceScore 100 + "score reflects an assumption" contradiction disappears.
- Files: lib/thematic-engine.ts (collectRiskFlags); unit test asserting the chain-only-failure copy.
- Effort: S. Risk: none. Dependencies: none. Sequence: first batch.

### QW-7. SSE heartbeat
- Fixes: TH-10 (half of it).
- What: in the route's start(), setInterval every 15s writing an SSE comment frame (`: keepalive\n\n`) while the run is in flight; clear it in finally. Comment frames are ignored by the client parser (lines not starting with "data: " are already skipped).
- Files: app/api/thematic/route.ts.
- Effort: S. Risk: none. Dependencies: none. Sequence: first batch.

### QW-8. Push to Recent only on success, and label cached vs fresh
- Fixes: TH-18.
- What: move pushRecent into the done handler (where the report is set). While there, use the `cached: true` flag the route already sends to show a small "Loaded saved report from {date}" toast or badge, surfacing staleness the way the route's own message already phrases it (that message is currently discarded).
- Files: app/thematic/page.tsx.
- Effort: S. Risk: none. Dependencies: none. Sequence: first batch.

### QW-9. Version the thematicReport cache and validate on read
- Fixes: TH-05 (crash-on-schema-drift path).
- What: add a REPORT_SCHEMA_VERSION constant in lib/thematic-engine.ts, include it in the cache key params (`{ theme, v: REPORT_SCHEMA_VERSION }`); old-shape rows then simply miss and expire. Belt-and-braces: run the asCurrentReport-style structural check server-side before serving a hit, treating failure as a miss.
- Files: app/api/thematic/route.ts, lib/thematic-engine.ts (or thematic-theme.ts if the page needs the same constant).
- Effort: S. Risk: one-time cache invalidation on deploy (each saved theme re-runs once); acceptable and honest. Dependencies: none. Sequence: first batch.

### QW-10. aria-live on the progress stage list
- Fixes: TH-13 (accessibility half).
- What: add `aria-live="polite"` to the ProgressView `<ol>` (mirroring task-progress.tsx:233) so stage completions are announced. One attribute if ProgressView stays; free if R-2 below replaces it with TaskProgress.
- Files: app/thematic/page.tsx.
- Effort: S. Risk: none. Sequence: first batch.

### QW-11. Fix the empty-chain copy and the checklist template edge
- Fixes: TH-26, TH-27 (cosmetic parts).
- What: the empty-chain message should reference the model that ran (report.model is available) or drop the "larger model" claim; checklist item 1 should omit the driving-forces clause when the list is empty; items 8 and 9 should derive a signal (e.g. reserve concentration mentions of single-country dominance -> negative, meaningful recycling -> negative for scarcity), or honestly render no dot rather than a permanently neutral one.
- Files: app/thematic/page.tsx, lib/thematic-engine.ts (checklist assembly).
- Effort: S. Risk: none. Sequence: any time.

### QW-12. Delete or wire the dead surface area
- Fixes: TH-14, TH-15, TH-16, TH-17 (code hygiene cluster).
- What: (a) either build the ETA (see R-2) or correct stageTimings' doc comment; (b) remove ThemeLexiconEntry.sectors and the dead +3 branch, or populate sectors for at least one entry; (c) remove maxTokens from runPrompt's signature or forward it, ending the eight dead call-site options; (d) remove the always-false `refreshing` prop threading.
- Files: lib/thematic-engine.ts, lib/ai.ts, app/thematic/page.tsx.
- Effort: S. Risk: none. Sequence: bundle with the structural refactor R-1 to avoid churn.

---

## 2. Structural improvements

### R-1. Decompose page.tsx into app/thematic/_components/
- Fixes: TH-30; enables everything below to land in reviewable pieces.
- What: split along the seams the file already draws with comment banners: hero.tsx (Hero, FactorStrip, IntegrityNotice, RiskFlags), overview-tab.tsx, chain-tab.tsx, companies-tab.tsx (+ CompanyTable, FilterChip), signals-tab.tsx, checklist-tab.tsx, progress.tsx, markdown.ts (toMarkdown), storage.ts (recent/sessionStorage helpers, asCurrentReport). page.tsx keeps state and orchestration (~300 lines). Zero behavior change; follow the module convention every other tab uses.
- Files: app/thematic/* (new files), page.tsx.
- Effort: M. Risk: low (mechanical; verify with build + e2e idle test). Dependencies: none, but do it before R-3/P-2 so those diffs stay small. Sequence: second batch.

### R-2. Replace ProgressView with the shared TaskProgress, driven by stageTimings
- Fixes: TH-13, TH-14; improves the longest wait in the tab.
- What: TaskProgress already supports checklist layout, elapsed, remaining, and aria-live. Feed it: steps = PIPELINE, activeStepId from the same completed-set logic, and remainingMs derived from the previous run's stageTimings for this theme (available on the cached report) or, absent that, a rolling median persisted alongside the cache. This finally makes stageTimings' doc comment true and gives the 7-minute wait an honest ETA, the exact pattern the Scanner set.
- Files: app/thematic/_components/progress.tsx, app/api/thematic/route.ts (include prior timings in the init event for cache misses of known themes), lib/thematic-engine.ts (no change to what it records).
- Effort: M. Risk: low. Dependencies: R-1 (file layout), QW-7 pairs well. Sequence: second batch.

### R-3. Adopt DataTable for the companies table
- Fixes: TH-11, TH-24, and most of TH-20/TH-21 fall out.
- What: render tierCompanies through the shared DataTable with sortable columns (Quality, ROIC, Margin, Rev growth, D/E), the standard density toggle, and the standard header treatment. Keep the tier grouping as a groupBy or as a Tier column + default sort. Use lib/format.ts formatPercent for all percentage cells.
- Files: app/thematic/_components/companies-tab.tsx.
- Effort: M. Risk: low-medium (visual change; compare against Screener side by side). Dependencies: R-1. Sequence: second batch.

### R-4. Give joiners real progress
- Fixes: TH-08.
- What: keep a per-key ring buffer of the events the originating run has emitted (they are small; the engine already emits ~24 per run). A joiner replays the buffer, then subscribes to a simple listener set for live events. The route's send() becomes a fan-out over subscribers. This removes the "for very little user benefit" tradeoff by making the benefit cheap.
- Files: app/api/thematic/route.ts (inFlight map becomes { promise, events[], listeners }).
- Effort: M. Risk: medium (careful cleanup on abort/completion; add a route-level test). Dependencies: none. Sequence: third batch.

### R-5. Client stall detection
- Fixes: TH-10 (client half).
- What: wrap the reader loop in an inactivity watchdog (e.g. 90s with heartbeats arriving at 15s): on trip, abort and surface the existing error box with Try again. Trivial once QW-7 guarantees traffic.
- Files: app/thematic/page.tsx (run()).
- Effort: S. Risk: low. Dependencies: QW-7. Sequence: third batch.

### R-6. Error boundary
- Fixes: TH-9.
- What: add app/thematic/error.tsx (and ideally app/error.tsx for the whole app) using the design system's Card + Button with a reset() retry. Any render-time surprise then degrades to a styled retry instead of a blank page.
- Files: app/thematic/error.tsx, app/error.tsx.
- Effort: S. Risk: none. Sequence: second batch.

### R-7. Retry the empirically fragile stage once
- Fixes: TH-12 (mitigation).
- What: buildDependencyChain and mapCompaniesToTiers are the two stages observed returning nothing usable. In the stage() wrapper, allow one retry for stages whose isEmpty triggered, with a terser reformulated prompt (the engine already documents that small models do better with shorter asks). Cap total added time; record `retried: true` in stageTimings. Combine with a prompt tweak: the chain prompt currently buries one instruction mid-list ("Write every field about this theme specifically" sits inside the bottleneck criteria list at engine line 817, which is a copy-paste artifact worth fixing regardless).
- Files: lib/thematic-engine.ts.
- Effort: M. Risk: medium (adds wall time on failures; bounded by one retry). Dependencies: none. Sequence: third batch.

### R-8. Type-safety hardening at the cache boundary
- Fixes: the residual half of TH-05.
- What: define a single runtime validator (zod is not in the dependency set; a hand-rolled structural check like asCurrentReport is fine) exported from the engine and used by (a) the route on cache read, (b) the page on sessionStorage read, so the two tiers cannot drift again.
- Files: lib/thematic-engine.ts or lib/thematic-theme.ts (client-safe), route, page.
- Effort: S/M. Risk: none. Dependencies: QW-9. Sequence: second batch.

---

## 3. Performance program

The route's client bundle (213 KiB, no heavy deps) and render behavior (CLS 0.0006, static report subtree, 122 ms cache-hit render) are already healthy; the performance budget here is wall-clock inference time and perceived progress.

### P-1. Stage-level latency budget and measurement
- What: stageTimings already measures per-stage wall time (observed: 22-97s per stage, 414s total). Surface it: log a single structured line per run (theme, per-stage ms, failures) and show the total in the report footer. Expected effect: regressions in prompt size or model routing become visible the day they happen.
- Verify: compare stageTimings distributions before/after any prompt change.
- Effort: S. Risk: none.

### P-2. Trim the mapping prompt
- What: the company-mapping prompt serializes up to 140 rows of "symbol | name | sector | industry" (~8-10 KB) into a model asked to return 12-18 picks; the observed yield was 1/53. Reduce SHORTLIST_SIZE for the prompt (not the shortlist) to the top ~60 by relevance score after QW-2 fixes ranking quality, and state the expected output count explicitly ("return between 12 and 18 objects").
- Expected effect: faster mapping stage (fewer prompt tokens), better yield (denser candidates); measure yield = mapped/candidates across a fixed theme set before and after.
- Files: lib/thematic-engine.ts.
- Effort: S/M. Risk: medium (changes results; A/B over the preset themes). Dependencies: QW-2.

### P-3. Optional: think-mode budget for JSON stages
- What: qwen3-family models spend output budget on thinking before JSON. If the provider layer supports disabling think mode per request (Ollama `think: false`), route "thematic-analysis" with it; the stages need structured recall, not chain-of-thought. Empirically test: chain-stage failure rate over the 10 preset themes with and without.
- Files: lib/ai/* (task registry option), no engine change.
- Effort: M. Risk: medium (answer quality could drop; keep behind the task registry so it is one line to revert). Confidence: low until measured; the 72s empty chain observation motivates the experiment.

### P-4. Do not re-render the page subtree on the 1 Hz timer (hygiene only)
- What: elapsed lives in ThematicPageInner, so the whole page re-renders every second during a run. Cost is trivial today (measured nothing user-visible); moving elapsed into the progress component (via the shared useElapsedMs) is free with R-2 and keeps the state root quiet.
- Effort: folded into R-2. Risk: none.

---

## 4. Visual and design-system alignment

Reference points are the strongest existing patterns, not new conventions.

### D-1. Tables: align to DataTable (see R-3). The Screener's table is the reference for numeric alignment, header case, density, and hover treatment.

### D-2. Tier colors: move TIER_TONE to semantic tokens
- What: 6 tiers need 6 distinguishable hues, which the token set does not currently provide; the right home is a small `--tier-1..6` token group defined beside the existing chart palette (app/_components/chart-theme.ts is the precedent for multi-series color scales) instead of raw purple-500/orange-500/blue-500 utilities in the page (TH-21).
- Files: globals.css or chart-theme.ts, thematic components.
- Effort: S. Risk: none.

### D-3. Number formatting: lib/format.ts everywhere
- What: replace the local pct()/changeTone() with formatPercent plus a shared tone helper (changeTone-like logic already exists in other tabs; extract once into lib/format.ts or a ui helper rather than a third copy). Decimals become consistent with Research/Watchlist (TH-20).
- Effort: S. Risk: none.

### D-4. Tooltips that work for everyone
- What: FactorStrip's meaning text and the Quality column definition should render in a real popover/tooltip component (the app already has dialog primitives) or as visible microcopy on tap/focus, not title attributes (TH-23). The factor tile is the more important one: it is the only place the score's semantics are explained.
- Effort: S/M. Risk: none.

### D-5. Tabs component upgrade (shared)
- What: add aria-controls/ids, role="tabpanel" on content wrappers, and left/right arrow handling in app/_components/ui/tabs.tsx (TH-22). Every tab consumer in the app inherits the fix.
- Effort: S/M (shared component; test all consumers). Risk: low.

### D-6. One denominator for stages
- What: pick a presentation: either the hero badge counts all 10 pipeline stages ("9/10 stages evidenced" counting the screener stages as always-evidenced) or the header badge stops saying "10 stages" and says "8 AI stages + screener". The current pairing (TH-25) makes an attentive user distrust the count.
- Effort: S. Risk: none.

---

## 5. Product-level opportunities (thematic investing specifically)

### PR-1. Constituent transparency: show the universe, not just the survivors
- What an analyst does with it: the first professional question about any theme list is "what was the eligible universe and why these names". Add a collapsible "Universe" section: N candidates matched (the shortlist), each with its matched industry/keyword and relevance score, and which were shown to the model vs cut by the cap. This converts TH-01's silent truncation into a visible, checkable decision, and turns the existing integrity numbers (53 of 2,015) into something inspectable.
- Data: already computed in shortlistUniverse; needs to travel on the report (add `universePreview` to ThematicReport).
- Files: engine (carry the data), companies-tab.
- Effort: M. Risk: low. Sequence: after QW-2.

### PR-2. Weighting and methodology note on the score
- What an analyst does with it: audits the construction. The factor strip already shows weights; add a one-line methodology footer ("weights fixed per framework Part 10.5; score = weighted mean of stage scores; verdict capped by capital cycle") and label the AI-derived stages as interpretation vs the derived flags as computation, per the project's own "label AI output as interpretation" rule. Mostly copy; the data exists.
- Effort: S. Risk: none.

### PR-3. Proxy-basket performance and drawdown context
- What an analyst does with it: answers "how has this theme actually traded" before reading a narrative about it. The engine already fetches 400 days of history per proxy and then keeps only three deltas. Render a small multi-line chart (relative-strength-chart.tsx is the existing primitive) of the matched proxies vs SPY over 1Y with max drawdown annotated. Zero new network cost on the server side; the report would carry a downsampled series per proxy.
- Files: engine (attach series), a new overview panel.
- Effort: M. Risk: low. Payload grows ~2-4 KB per proxy downsampled weekly.

### PR-4. Cross-theme overlap and correlation
- What an analyst does with it: sizes how much of "AI Compute" they already own via "Robotics" or "Semiconductors". The platform cache holds every generated thematic report; a small module can list saved themes, compute company overlap (Jaccard over tierCompanies symbols) and proxy correlation (existing history data), and render "this theme shares 6 of 14 names with Energy Storage". This is uniquely cheap here because reports persist server-side already.
- Files: new lib function reading platform_cache dataset=thematicReport, small UI section or a "Compare themes" view.
- Effort: L. Risk: low. Dependencies: QW-9 (stable schema).

### PR-5. Valuation and crowding read on the mapped names
- What an analyst does with it: distinguishes a right theme from a rich one. The fundamentals cache already holds forwardPE, evToEbitda, revenue growth for every mapped company; the engine discards valuation entirely. Add per-company forwardPE and a tier-level median vs sector median, plus a "crowding" proxy (distance from 52-week high once the price layer joins, or 1Y proxy return which is already fetched). The capital-cycle caveat then gets quantitative support instead of resting on the model's phase call alone.
- Files: engine (extend TierCompany), companies-tab columns.
- Effort: M. Risk: low.

### PR-6. Watchlist handoff with provenance
- What an analyst does with it: acts on the research. lib/idea-source.ts already defines IdeaSource "thematic" with detail "the theme and tier", and nothing in the codebase ever emits it (verified by grep): the classic shipped-but-unwired case. Add a row action "Add to watchlist" on the companies table that records source: "thematic", detail: `${theme} T${tier}`. The Ledger and Watchlist then show where the idea came from for free.
- Files: companies-tab, existing watchlist add API.
- Effort: S/M. Risk: low. Sequence: early; highest leverage per line of code in this section.

### PR-7. Export parity
- What an analyst does with it: puts the work in a memo. toMarkdown omits supply/demand detail, the policy table, regional advantages, and news. Extend it to the full report, and add /api/export/thematic (XLSX of the companies table) following the seven existing /api/export/* routes. The copy button's toast pattern stays.
- Files: markdown.ts, new export route reusing the existing export utilities.
- Effort: M. Risk: none.

### PR-8. Report history per theme
- What an analyst does with it: grades the framework. Runs are cached but each re-run overwrites the single cache row; the previous verdict is gone. Keep the last N reports per theme (key with generatedAt) and render a one-line delta on re-run ("score 56 -> 61; capital cycle downturn -> early"). This is the "grade your own recommendations" rule applied to this tab, and it is what makes stageTimings/verdict history worth persisting.
- Files: route (key scheme), small history panel.
- Effort: L. Risk: low, storage growth bounded by N.

---

## Prioritized roadmap

Ordering rationale: kill observed wrong-data first (they cost trust fastest and are cheap), then the crash-class and URL/state issues that corrupt sessions, then structure so later work reviews cleanly, then reliability of the long stream, then the product build-out, which is where the tab's ceiling actually is.

1. QW-1 policy "null" fix (S): observed wrong data, one-line class of fix.
2. QW-2 shortlist tie-break (S/M): the P1; changes what companies the whole pipeline can see.
3. QW-3 short-token news filter (S): un-starves "AI"/"EV" themes' evidence.
4. QW-6 risk-flag copy (S) + QW-5 unevidenced panels (S): removes the observed self-contradiction and the silent-default rendering.
5. QW-9 cache versioning (S) + R-8 shared validator (S/M) + R-6 error boundary (S): closes the crash-class trio.
6. QW-4 URL state (S) + QW-8 recent-on-success (S): session integrity.
7. QW-7 heartbeat (S) + R-5 stall watchdog (S): stream survives real networks.
8. R-1 decomposition (M): unlocks clean diffs for everything after; bundle QW-12 dead-code cleanup into it.
9. R-2 TaskProgress + ETA (M): the biggest UX upgrade for the longest wait; makes stageTimings honest.
10. R-3 DataTable companies table (M) + D-3 formatting + D-2 tier tokens (S): design-system convergence.
11. PR-6 watchlist handoff (S/M): highest product value per effort; wiring that the types already promise.
12. R-7 fragile-stage retry (M) + P-2 mapping prompt trim (S/M) + P-3 think-mode experiment (M): attack the observed quality floor (empty chain, 1/53 mapping yield) with measurement in place from P-1.
13. R-4 joiner fan-out (M): correctness of a rarer path; after the stream is otherwise solid.
14. PR-1 universe transparency (M) + PR-5 valuation columns (M) + PR-3 proxy chart (M): the analyst-tool tier.
15. PR-7 export (M), PR-8 report history (L), PR-4 cross-theme overlap (L): the long-horizon differentiators, each dependent on the stable schema from step 5.

D-4 tooltips and D-5 Tabs a11y (shared component) can slot into any batch; D-6 denominator copy rides along with whichever hero change lands first. QW-10/QW-11 are any-time fillers.
