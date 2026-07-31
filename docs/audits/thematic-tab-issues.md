# Thematic Tab Audit: Issues

Date: 2026-08-01. Auditor: read-only code audit plus empirical verification (typecheck, lint, production build, unit tests, bundle inspection, live exercise of the tab against a running dev server and a full 7-minute pipeline run on qwen3:14b with the real 2,209-row fundamentals cache).

## Executive summary

The Thematic tab is one of the better-hardened surfaces in UAA: the engine coerces and clamps every model output, tracks stage failures explicitly, ships an integrity block with every report, reconciles the verdict against the capital cycle, and is covered by 32 passing unit tests. The page renders with zero console errors, negligible layout shift (CLS 0.0006 observed), a modest bundle (~213 KiB of client chunks, no heavy libraries), and honest empty states. The serious problems are concentrated in the data path rather than the rendering path: the candidate-universe shortlist silently truncates alphabetically and excluded TSM from an "AI Compute" run while including Corsair and Logitech; the policy table renders the literal string "null" as a capital figure; disk-cached reports are served for up to 6.5 days with no schema validation; and the news relevance filter drops the tokens "AI", "EV", and "5G" entirely. A cluster of state and UX defects (stale ?theme= URL, frozen progress for joined runs, missing error boundary) and a set of consistency and accessibility gaps round out the list.

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 1 |
| P2 | 11 |
| P3 | 19 |
| Total | 31 |

| Confidence | Count |
|---|---|
| OBSERVED (ran it, saw it) | 13 |
| INFERRED (read the code, reasoned to it) | 18 |

## Phase 0: Discovery

### File inventory

| Path | Role | Lines | Scope |
|---|---|---|---|
| app/thematic/page.tsx | Route page: search, progress, full report UI (20+ inline components) | 1,390 | Thematic-specific |
| app/api/thematic/route.ts | POST SSE endpoint: validation, cache, in-flight dedup, streaming | 143 | Thematic-specific |
| lib/thematic-engine.ts | 10-stage engine: lexicon, shortlist, proxies, 8 AI stages, scoring, integrity | 1,734 | Thematic-specific |
| lib/thematic-theme.ts | Client-safe theme normalization + MAX_THEME_LENGTH | 39 | Thematic-specific |
| tests/thematic-engine.test.ts | Engine unit tests (32) | 416 | Thematic-specific |
| lib/ai.ts | runPrompt facade over orchestrator | 58 | Shared |
| lib/ai/orchestrator.ts | runTask/runTaskText, request coalescing | ~300 read | Shared |
| lib/ai/task-registry.ts | "thematic-analysis" task: deep, jsonMode, 300s timeout | 583 (registry read) | Shared |
| lib/composite.ts | computeScores, sector-aware composite | 213 | Shared |
| lib/score-math.ts | norm/lerp | partial | Shared |
| lib/db.ts | getFreshFundamentals (fundamentals_cache) | 3,161 (relevant fns read) | Shared |
| lib/news.ts | fetchMarketNews aggregation | 414 (relevant fns read) | Shared |
| lib/yahoo.ts | getQuotes (batch), getHistory (platform-cached) | 887 (relevant fns read) | Shared |
| lib/json-extract.ts | extractJson/Object/Array/ObjectsLoose | 185 | Shared |
| lib/platform/cache.ts | L1 LRU + SQLite L2, SWR semantics | 281 | Shared |
| lib/platform/registry.ts | thematicReport policy: 12h TTL, 6d SWR, persist | partial | Shared |
| app/_components/ui/* (badge, button, card, input, page-shell, tabs, task-progress, index) | Design system | 1,898 total | Shared |
| app/_components/{reveal,score-ring,value-bar,count-up,loading-mark,toast}.tsx | Motion + feedback primitives | ~570 | Shared |
| app/template.tsx | Page-transition remount boundary | 22 | Shared |
| e2e/pages.spec.ts | Idle-state smoke test for /thematic | partial | Shared |
| Deep-link producers: lib/scanner/index.ts (thematicResearchUrl), app/wire/_components/emerging-theme-card.tsx, lib/ai-app-assistant.ts, app/_components/nav-config.ts | Entry points into the tab | partial | Shared |

### Data flow

```
User types theme (or ?theme= deep link from Wire/Scanner, or preset/recent chip)
  -> page state (theme, running, events[], report, error, elapsed)
  -> POST /api/thematic { theme, refresh }            [client -> server boundary]
     -> validate (typeof string, normalizeTheme, len 2..120)
     -> cacheKey("thematicReport", { theme: lowercase-normalized })
     -> readCache (L1 in-process LRU -> L2 SQLite platform_cache)
        hit  -> single SSE "done" event with cached report
        miss -> join in-flight run for same theme, or start runThematicEngine:
           parallel prefetch (non-AI):
             pickCommodityProxies(theme)  <- THEME_LEXICON word-boundary match
               -> fetchCommodityProxies -> lib/yahoo getQuotes (1 batch) +
                  getHistory(ticker, 400d) per proxy (platform cache, dedup)
             fetchThemeNews -> lib/news fetchMarketNews (Yahoo news, NewsAPI,
                  Google News; global only) -> filter headlines by theme words >= 4 chars
             getFreshFundamentals(7d) -> shortlistUniverse (lexicon industry hints
                  + theme-word fallback, cap 140, tie-break by symbol)
           8 sequential Ollama calls via runPrompt("thematic-analysis", ...):
             future_state -> dependency_chain -> bottleneck -> supply_demand
             -> commodity -> policy(+20 headlines) -> structural_advantage
             -> company_mapping (140-row candidate list)
           company_quality: lib/composite computeScores per mapped company (in-process)
           computeOpportunityScore: 7 weighted factors -> 0-100, verdict, cycle cap,
             riskFlags (deterministic), 10-item checklist
           buildIntegrity: evidenceScore, stagesEvidenced/8, caveats
        -> SSE events {stage, message, data?} per stage    [server -> client boundary]
        -> final "done" + report; writeCache (persisted, 12h TTL / 6d SWR)
  -> client parses SSE frames, appends to events[] (drives ProgressView)
  -> on done: setReport + sessionStorage("uaa_thematic_last_report")
  -> localStorage("uaa_thematic_recent") ring of 8 themes
```

The page is entirely a client component ("use client"); the route prerenders as a static shell (confirmed in build output). The only server crossings are the POST body and the SSE stream.

### What could NOT be inspected

- lib/ai/router.ts, providers, and Ollama internals beyond the orchestrator entry points (read partially; behavior verified empirically instead).
- lib/db.ts, lib/yahoo.ts, lib/news.ts were read for headers plus every function the Thematic path calls, not all 4,400 combined lines, since most of their content belongs to other tabs.
- Only one full pipeline run was executed (Uranium, qwen3:14b, 7 minutes); model-quality findings from it are single-sample and marked accordingly.
- The Playwright MCP browser was locked by another session; the project's own Playwright was used headlessly instead (identical engine).
- Multi-client join behavior (two browsers on one theme) was reasoned from the route code, not exercised.

## Phase 1: Empirical verification

All items below are OBSERVED unless noted.

- `npx tsc --noEmit`: exit 0, no output.
- `npx eslint app lib`: 13 problems (1 error, 12 warnings), all pre-existing and known per AGENTS.md; none in any Thematic file.
- `npm run build`: compiled successfully in 47s. Two Turbopack NFT warnings, both tracing to lib/valuation/engine-prior.ts via /api/ledger, unrelated to Thematic. `/thematic` is static (o), `/api/thematic` dynamic (f).
- Bundle: /thematic references 7 client chunks totaling 213.1 KiB uncompressed (screener: 262.3 KiB); 2 chunks (~49 KiB) are unique to the route. No charting library, no date library, no lodash; lucide-react icons are imported individually (5 icons) and tree-shaken. No dynamic imports and none needed at this size.
- `npx vitest run tests/thematic-engine.test.ts tests/json-extract.test.ts`: 61/61 pass.
- Live exercise (headless Chromium, 1440x900): page loads with zero console errors or warnings; CLS 0.0006; no reveals stranded at opacity 0; heading order H1 -> H2 is clean. Started a "Uranium" run: stage list updated live ("Inevitability: 4/10" inline), Cancel returned to idle cleanly. At 375px the only horizontal overflow (80px) comes from the shared site header and reproduces identically on /screener, so it is not a Thematic defect.
- Full pipeline run (curl SSE, theme "Uranium"): 24 events, ~7 minutes wall clock (stage timings: 22+72+36+29+38+79+97+41 = 414s), report cached, and a subsequent in-browser search for "Uranium" rendered the full report from cache in 122 ms with zero console errors. All four secondary tabs render correctly against the real report.
- Shortlist probe against the real fundamentals cache (2,209 rows): results in TH-01 below.
- Network behavior: quotes are batched (one call), histories parallel, news sources parallel via allSettled, all through the platform cache with request dedup; the 8 AI calls are deliberately sequential because Ollama serializes generations (documented in the engine). No waterfalls beyond that design, no duplicate calls observed, no unbounded payloads (news capped at 20, shortlist at 140, report ~22 KB).
- Re-render triggers: one state root (ThematicPageInner) so every SSE event and each 1 Hz elapsed tick re-renders the page subtree during a run; while running, the only mounted children are the search bar and ProgressView, so the cost is trivial. The report subtree is static after arrival. The `tabs` array is recreated per render (harmless). No context providers are created by this page. No memoization is missing that would be genuinely warranted.

## Phase 2: Issues

Format: ID | Severity | Confidence | Category, then file:line, what, why, evidence.

---

### TH-01 | P1 | OBSERVED | A. Correctness / B. Data integrity

lib/thematic-engine.ts:575-580 (shortlistUniverse)

What: when a theme's industry hints match more than SHORTLIST_SIZE (140) rows, every match scores the same flat 10, and the tie-break is `a.row.symbol.localeCompare(b.row.symbol)`. The 140-row cap then cuts the candidate list alphabetically.

Why it matters: the model can only map companies it is shown. For "AI Compute", 194 rows match the industry hints, so every symbol after roughly "PL" is silently excluded from the analysis. TSM, the archetypal AI-compute bottleneck company, is dropped while Corsair (CRSR), Logitech (LOGI), and 3D Systems (DDD) are included. The "Best expressions of this theme" table and the whole Companies tab are built from a universe biased by ticker spelling.

Evidence (probe against the real 2,209-row cache):

```
AI Compute: shortlisted 140/2209 top: ANET,CRSR,DDD,DELL,HPQ,IONQ,LOGI,...
AI Compute contains NVDA: true TSM: false SMCI: true VRT: false MSFT: true
last 10 alphabetically-cut: ONTO,ORCL,OUST,PAGS,PANW,PATH,PAY,PAYP,PENG,PLTR
rows matching AI/compute industry hints: 194
```

---

### TH-02 | P2 | OBSERVED | B. Data integrity

lib/thematic-engine.ts:1015 (sanitizePolicyItem), app/thematic/page.tsx:939 (PolicyTable)

What: the policy prompt shows `"estimatedCapitalUSD": "<headline capital committed, or null if not quantified>"` inside quotes, and the model duly returns the string "null". sanitizePolicyItem accepts any string, and PolicyTable's `{p.estimatedCapitalUSD ?? "-"}` only guards real null, so the literal text "null" renders in the Capital column.

Why it matters: a research table showing "null" as a dollar figure reads as broken software and undermines trust in the surrounding numbers.

Evidence: the live Uranium report contains `'estimatedCapitalUSD': 'null'` for all three returned policies (Canada, US, China).

---

### TH-03 | P2 | OBSERVED | A. Correctness (internal consistency)

lib/thematic-engine.ts:1485-1491 (collectRiskFlags)

What: the "N stages unevidenced" risk flag always says the failed stages "fell back to a neutral 5/10, so the headline score partly reflects an assumption, not analysis". The Dependency Chain and Company Mapping stages carry zero score weight, so when only they fail, the claim is false.

Why it matters: the live Uranium report simultaneously displays `evidenceScore: 100` (all score weight evidenced) and a risk flag saying the headline score partly reflects an assumption. Two panels on one screen contradict each other, which is exactly the failure mode the project's own rules call out ("one figure, one direction").

Evidence: observed report: `integrity: {evidenceScore: 100, missingStages: ['Dependency Chain'], ...}` beside riskFlag "1 stage unevidenced ... headline score partly reflects an assumption".

---

### TH-04 | P2 | INFERRED (high confidence) | B. Data integrity

lib/thematic-engine.ts:652 (DEFAULT_SUPPLY_DEMAND), app/thematic/page.tsx:466-482 (supply-demand tiles), 546-561 (commodity dl)

What: when an AI stage fails, its neutral default is rendered in the Overview tab as if it were a finding. The supply/demand tiles would show "growing / balanced / mid / moderate" with no marker that the stage returned nothing; only the caveat box at the top and the struck-through factor tile reflect the failure. Text fields carry "AI analysis unavailable" sentences, but the enum tiles and badges do not.

Why it matters: a user reading the Overview panels has no way to tell a measured "balanced" from a defaulted "balanced". The factor strip solved this problem for the score; the panels below it did not get the same treatment.

Evidence: DEFAULT_SUPPLY_DEMAND provides demandTrajectory "growing", investmentSignal "moderate"; the tile renderer has no `evidenced` input at all (page.tsx:469-481).

---

### TH-05 | P2 | INFERRED (high confidence) | B. Data integrity / E. Error states

app/api/thematic/route.ts:89-99, lib/platform/registry.ts:145, app/thematic/page.tsx:1107-1112

What: reports persisted in platform_cache are served for up to ~6.5 days (12h TTL + 6d SWR) with no schema validation and no schema version in the cache key. The page's asCurrentReport guard protects only the sessionStorage path; an API-served report written by an older engine shape (for example one predating `newsItems`, `integrity`, or `riskFlags`) flows straight into the renderer, where `report.newsItems.length` or `flags.length` throws.

Why it matters: the page comments prove this exact class of crash already happened once with sessionStorage ("restoring it blindly crashed the page on first paint"); the fix was applied to one of the two storage tiers. Combined with TH-09 (no error boundary), a schema-drifted cached report is a blank page.

Evidence: route sends `hit.value` unvalidated (route.ts:92-97); cacheKey contains only the theme (registry.ts:158-167); asCurrentReport is called only from the sessionStorage initializer (page.tsx:1150-1151).

Note: the SWR contract in lib/platform/cache.ts:84-91 says a "revalidating" hit obliges the caller to kick a background refresh; the route never does. The registry comment says this is deliberate for this dataset, so it is recorded here as documented intent rather than a separate defect, but the contract and the policy disagree on paper.

---

### TH-06 | P2 | INFERRED (high confidence) | B. Data integrity

lib/thematic-engine.ts:1680-1688 (fetchThemeNews), 528-533 (STOPWORDS)

What: news relevance filtering keeps only headlines containing a theme word of 4+ characters. For "AI Compute" the filter set is just {"compute"}; every headline that says "AI" but not "compute" is discarded. The same holds for "EV", "5G", "LNG" (3 chars) as standalone tokens.

Why it matters: the Why now tab and the policy stage's LIVE NEWS evidence are systematically starved for precisely the themes the tab advertises first (the #1 preset is "AI Compute"). The empty state then tells the user "no recent headline mentions this theme by name", which is false.

Evidence: `words = theme.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w))` then `words.some((w) => text.includes(w))`.

---

### TH-07 | P2 | INFERRED (high confidence) | D. State management

app/thematic/page.tsx:1141-1155, 1256-1261

What: the URL is read (`?theme=`) but never written. Two consequences: (1) after arriving via a deep link and then researching a different theme, the stale `?theme=` survives in the address bar; a reload silently re-runs the URL's theme and discards the report on screen (the report initializer returns null whenever themeFromQuery is set). (2) The auto-run effect is mount-only, so a same-route navigation that only changes the query (assistant navigation, command palette, a second Wire deep link while already on /thematic) updates `themeFromQuery` but triggers nothing.

Why it matters: filters/selection that behave like navigation should live in the URL (the audit brief's own category D); here the URL actively lies about the page's content, and reload destroys work.

Evidence: no router.replace/push anywhere in the file; effect at 1256-1261 has an empty dependency array with an exhaustive-deps disable.

---

### TH-08 | P2 | INFERRED (high confidence) | E. Loading states

app/api/thematic/route.ts:104-114, app/thematic/page.tsx:970-977

What: a second client requesting a theme already in flight "joins" the run but receives only two init events and then silence until the terminal report. The ProgressView computes the current stage from data-bearing events, of which the joiner gets none, so it renders "Future state / Running... / 0/10 stages" with a ticking clock for potentially many minutes regardless of actual progress. The joining message itself is not shown: `detail` only displays a message whose stage matches the current pipeline stage, and "init" never matches.

Why it matters: a frozen progress list under a running timer is indistinguishable from a hang, on a surface whose whole progress design exists to prevent exactly that impression.

Evidence: route comment "a joiner gets the finished report" (route.ts:104-106); page derives `completed` from `e.data !== undefined` (page.tsx:971) and `detail` from `latest.stage === current?.id` (page.tsx:977).

---

### TH-09 | P2 | OBSERVED (absence) | E. Error states

app/ (no error.tsx or global-error.tsx anywhere; none in app/thematic/)

What: there is no React error boundary in the app tree. Any render-time throw on this page (TH-05's schema drift being the concrete candidate) falls through to Next's default error output.

Why it matters: the tab's data comes from a local model and two cache tiers that outlive the code that wrote them; render-time surprises are a matter of when, not if. The failure mode is a blank page with no retry affordance.

Evidence: `ls app/error.tsx app/global-error.tsx app/thematic/error.tsx` -> all "No such file or directory".

---

### TH-10 | P2 | INFERRED | E. Error states / C. Network

app/api/thematic/route.ts:67-133, app/thematic/page.tsx:1217-1239

What: individual stages run up to 300s (task registry timeout) with no SSE traffic in between, and the stream sends no heartbeat/comment frames. The client has no stall detection: if the connection dies quietly (proxy idle timeout, laptop sleep), `reader.read()` waits indefinitely while the elapsed timer keeps ticking.

Why it matters: observed stage gaps in the live run reached 97s; a single slow stage on weaker hardware can exceed typical proxy idle timeouts (often 60-120s). The user's only recovery is noticing that nothing has changed and pressing Cancel.

Evidence: stage timings from the live run (97s structural advantage); no `:\n\n` keepalive writes in route.ts; no timeout wrapping `reader.read()` in page.tsx.

---

### TH-11 | P2 | OBSERVED | F. Design consistency / D. Product

app/thematic/page.tsx:764-825 (CompanyTable)

What: the companies table is hand-rolled with no sorting, while the design system's DataTable (used by Screener and Watchlist, 751 lines, with sorting, density, and consistent header treatment) sits unused. Six numeric columns (Quality, ROIC, Margin, Rev growth, D/E) cannot be ranked.

Why it matters: an analyst's first move on a companies table is to sort by quality or leverage; here they cannot. It is also the exact "shipped-but-unwired" pattern AGENTS.md warns about, and the tab visually drifts from the tables on Screener/Watchlist.

Evidence: `<table className="w-full text-sm">` at page.tsx:767; DataTable export in app/_components/ui/index.ts:5-13 with zero references in app/thematic/.

---

### TH-12 | P2 | OBSERVED (single sample, medium confidence) | B. Data integrity / Product

lib/thematic-engine.ts:755-788 (buildDependencyChain), 1098-1185 (mapCompaniesToTiers)

What: on the recommended local model (qwen3:14b, a mid-size thinking model), the dependency chain stage spent 72s and returned nothing usable, and the company mapping placed 1 of 53 candidates. The report shipped as "WEAK 56/100" with an empty flagship tab (the dependency chain is the framework's centerpiece per the page's own header copy) and a Companies tab of one row.

Why it matters: the framework's differentiating output (six-tier chain, non-obvious tiers) is the least reliable part of the pipeline in practice. The empty-state copy compounds it by advising "a larger local model maps the six tiers far more reliably" when the user is already on a 14B model. This is a single run, so treat the yield numbers as indicative, not statistical.

Evidence: SSE log: "No tiers returned - chain unavailable" after 72s; "1 companies mapped across 1 tiers"; rendered empty-state text captured in browser.

---

### TH-13 | P3 | OBSERVED | I. Code quality / H. Accessibility

app/thematic/page.tsx:970-1048 (ProgressView) vs app/_components/ui/task-progress.tsx

What: the page carries a private progress implementation instead of the shared TaskProgress (checklist layout, aria-live="polite", ETA support). The private version has no aria-live, so screen readers are never told a stage completed, and no remaining-time estimate.

Why it matters: duplicated presentational logic drifts (it already has: TaskProgress announces stage changes, ProgressView does not), and the one accessibility behavior the shared component encodes was lost in the copy.

### TH-14 | P3 | OBSERVED | I. Code quality

lib/thematic-engine.ts:260-261, 1651

What: `stageTimings` is computed on every run, serialized into every cached report, and read by nothing (grep: 2 hits, both in the engine). Its doc comment claims it "drives the progress ETA on the next run"; no such ETA exists.

Why it matters: a false doc comment on shipped-but-unwired data, the precise pattern the 2026-07-27 audit documented. It also inflates every cached report and SSE payload for no consumer.

### TH-15 | P3 | OBSERVED | I. Code quality

lib/thematic-engine.ts:293-299, 550, 566

What: `ThemeLexiconEntry.sectors` is declared, documented ("sectors are exact-ish sector fallbacks, weighted far lower"), and scored (+3), but no lexicon entry defines it. `sectorHints` is always empty; the branch is dead.

### TH-16 | P3 | OBSERVED | I. Code quality

lib/ai.ts:33-34, lib/thematic-engine.ts (8 call sites)

What: every engine stage passes `maxTokens` (600-2000), but lib/ai.ts deliberately does not forward it ("capping num_predict mid-generation truncates JSON output"). Eight call sites pass dead options that read as if they bound the response.

Why it matters: a reader (or a future model-cost calculation) will reason from limits that do not exist. Either forward it or remove it from the signatures.

### TH-17 | P3 | INFERRED | E. Error states / I. Code quality

app/thematic/page.tsx:1184-1198, 1373-1379

What: `run()` clears the current report (`setReport(null)`) before the replacement exists, so a failed Re-run leaves an error box and nothing else (the old report survives only in sessionStorage until remount). Consequently `running && report` never coexist, so the `refreshing` prop threaded into Hero and ThematicReportView is always false: dead plumbing that suggests an in-place refresh UX that does not exist.

### TH-18 | P3 | OBSERVED | B. Data integrity (copy)

app/thematic/page.tsx:1198, 1314

What: `pushRecent(t)` runs at the start of the request, so cancelled and failed themes enter the Recent list, whose chips carry the tooltip "Saved reports load instantly". Observed: after cancelling the first Uranium run, a "Uranium" recent chip appeared; clicking it would start a full multi-minute pipeline, not an instant load.

### TH-19 | P3 | INFERRED (low likelihood, latent) | A. Correctness

app/thematic/page.tsx:1184-1247

What: if a second `run()` ever starts while one is in flight, the aborted run's `finally { setRunning(false) }` resolves after the new run has set `running = true`, hiding the progress view for the remainder of the new run. Today every trigger is disabled while running (button swaps to Cancel, input disabled, chips hidden), so the race is unreachable through the UI; it is a landmine for the next person who adds a trigger.

### TH-20 | P3 | OBSERVED | F. Consistency / I. Code quality

app/thematic/page.tsx:171-179 vs lib/format.ts:61-63

What: the page hand-rolls `pct()` (1 decimal, own sign logic) and `changeTone()` while lib/format.ts exports formatPercent (2 decimals) used elsewhere. Number formatting differs across tabs for the same quantity class, and AGENTS.md's "format utilities -> lib/format.ts only" rule is violated.

### TH-21 | P3 | OBSERVED | F. Design system

app/thematic/page.tsx:181-188 (TIER_TONE)

What: tier badges use raw Tailwind palette classes (purple-500, orange-500, blue-500, orange-400 text) while the rest of the page and the design system use semantic tokens (brand/positive/warning/negative). Dark-mode-only today, but these colors sit outside the theme system and will not follow token changes.

### TH-22 | P3 | OBSERVED | H. Accessibility (shared component)

app/_components/ui/tabs.tsx:21-49

What: role="tablist"/role="tab" without aria-controls, without any role="tabpanel" on the content, and without arrow-key navigation (Tab reaches each tab button individually; left/right do nothing). Affects every consumer, including this page's 5-tab report.

### TH-23 | P3 | OBSERVED | H. Accessibility

app/thematic/page.tsx:314 (FactorStrip title), 776 (Quality th title), 284 (Re-run title)

What: explanatory content ("what this factor measures", "composite quality score from the screener") is delivered exclusively through the title attribute: invisible on touch devices, not reliably announced by screen readers, and undiscoverable by keyboard.

### TH-24 | P3 | OBSERVED | H. Accessibility

app/thematic/page.tsx:769-782, 927-932

What: table header cells in CompanyTable and PolicyTable lack scope="col"; the tables have no caption or aria-label. Screen-reader users get positional guessing on an 11-column table.

### TH-25 | P3 | OBSERVED | F. Copy consistency

app/thematic/page.tsx:1270 ("10 stages" badge), Hero badge "{n}/8 stages evidenced" (page.tsx:244-248, engine TOTAL_AI_STAGES=8)

What: the header advertises 10 stages; the integrity badge counts out of 8 (AI stages only). Both are individually correct but sit on one screen with different denominators and no explanation of the difference.

### TH-26 | P3 | OBSERVED | F. Copy

app/thematic/page.tsx:629-634

What: the empty dependency-chain state always says "a larger local model maps the six tiers far more reliably", regardless of the model that just ran. Observed rendering beside a report produced by qwen3:14b, the largest model installed.

### TH-27 | P3 | OBSERVED | I. Code quality / Product polish

lib/thematic-engine.ts:1382-1391, 1346-1351

What: checklist items 8 (reserve concentration) and 9 (recycling) have their signal hardcoded to "neutral"; they can never turn positive or negative regardless of the stage output. Item 1's answer template produces ". Score: 5/10." with a dangling period when drivingForces is empty (the failure default).

### TH-28 | P3 | INFERRED | J. Security

lib/thematic-engine.ts:959-961, 1603; app/thematic/page.tsx:858-863

What: the user theme is carefully fenced against prompt injection (themeBlock), but external news headlines are interpolated into the policy prompt raw, and mapped company names/industries into the mapping prompt raw. Separately, news item URLs from RSS/aggregators are rendered into href without scheme validation (a hostile feed could supply javascript: URLs; rel="noopener noreferrer" is present, scheme checking is not).

Why it matters: both are low-probability for a local single-user tool, but the asymmetry (fencing the least dangerous input while trusting the most external one) is worth recording.

### TH-29 | P3 | INFERRED | J. Robustness

app/api/thematic/route.ts

What: no rate limiting or queue-depth cap: N distinct themes = N queued multi-minute pipelines on a serialized Ollama. inFlight dedups identical themes only. Acceptable for a local single-user app; would be a P1 the day this route is exposed.

### TH-30 | P3 | OBSERVED | I. Code structure

app/thematic/page.tsx

What: 1,390 lines, 20+ components in a single file, against the repo convention of app/[module]/_components/ (screener, watchlist, portfolio, wire all follow it). app/thematic/ contains only page.tsx.

### TH-31 | P3 | OBSERVED | G. Responsiveness (shared, not Thematic-specific)

app/_components/site-header (DIV.ml-auto flex shrink-0 items-center gap-2)

What: at 375px viewport the document overflows horizontally by 80px. Reproduced identically on /screener, so the source is the shared header's right-side cluster, not this tab. Recorded here because the audit observed it on /thematic first.

---

### Categories with no issues found

- A. Correctness (financial math): the weighted score (weights sum to 1.0), 0-10 to 0-100 normalization, score clamping/rescaling, tier clamping, pctChange (null on short history and zero base), and the verdict banding were checked by hand and against the live run; no defects found beyond TH-01/TH-03. Timezone/currency handling has no exposure here (proxy prices are USD ETFs/stocks displayed with $; dates render through toLocaleString).
- C. Performance: no meaningful defects. Static report subtree, trivial run-time re-renders, batched/cached/deduplicated network, 213 KiB route JS, CLS ~0, cache hit renders in 122 ms. The 7-minute wall time is Ollama inference, is honestly presented, and is the product's stated design.
- NaN/Infinity propagation: coerceNumber/coerceScore10 gate all model numerics; pctChange guards zero division; QualityCell/pct render null as an em-dash-free placeholder. No path found where NaN reaches the UI.
- Secrets: none in any Thematic file; the AI path is local-only by design.
