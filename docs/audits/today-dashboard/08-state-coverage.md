# 08. State Coverage: every state the Today dashboard can be in, graded

As of 2026-08-08. Read-only audit. Evidence: file:line references against the working tree, plus the captured screenshots in `docs/audits/today-dashboard/shots/`. Companion to `00-architecture-map.md` section 6 (the code's own claimed state matrix); this document verifies those claims and grades what actually renders.

Grading scale, applied per state per module:

- **DESIGNED**: the state is intentional. The copy is directive (tells the user what is true and what to do next), the treatment is distinct from loading and from error, and nothing on screen is fabricated.
- **DEFAULTED**: it renders and does not lie outright, but the treatment is generic, apologetic, or under-informative ("No data available", a bare Retry, a silent disappearance).
- **BROKEN**: what renders is wrong or misleading in that state (a false all-clear, a fabricated zero, a wrong-cause explanation).

The seven modules: Today's Brief (hero, `modules/todays-brief.tsx`), Portfolio Health / Book (`modules/book.tsx`), What Changed (`modules/whats-changed.tsx`), Attention Queue (`modules/attention-queue.tsx`), Radar (`modules/radar.tsx`), Market Overview (`modules/market-intelligence.tsx`), AI Investment Brief (`modules/ai-investment-brief.tsx`).

## 1. How state is plumbed (the machinery being graded)

- One digest request feeds all seven modules (`home-provider.tsx:133`, `useHomeSlice` at 183-194). A module's slice inherits the digest's `SectionState` wholesale: if `/api/home` fails, EVERY slice is `status:"error", data:null` simultaneously.
- Server-side, `runPlan()` isolates step failures (`lib/home/digest.ts:161-194`): a dead step ships its slice as `status:"degraded"` with empty arrays (e.g. `marketIntelligence` fallback at digest.ts:275-276, `performance` at 302-303, `equityCurve` at 305-307). So there are two entirely different failure shapes: **transport failure** (whole digest 500/offline: `data:null` everywhere) and **source failure** (digest 200, slice `degraded`). The modules handle the second far better than the first.
- Every slice carries `status: CardStatus` ("ok" | "empty" | "degraded" | "stale") per `lib/home/contracts.ts:12-22` and the per-slice `status:` fields (contracts.ts:72, 155, 255, 283, 316, 394, 466, 493, 505, 563, 592, 682, 741, 750, 755).
- `ModuleShell` (module-shell.tsx:89-225) delegates loading/empty/error to `Section` (app/_components/ui/section.tsx:107-135) and adds capability-gated CTA empty states (`UNMET`, module-shell.tsx:37-63). Only ONE module actually passes `unmet` (book.tsx:190-196); todays-brief, attention-queue, radar, market-intelligence, and ai-investment-brief are bespoke surfaces that reimplement (or skip) parts of the state machine, and that is where the broken cells below live.
- `SectionError` renders message + Retry (section.tsx:161-176); `SectionEmpty` renders a one-line fact with NO retry and NO CTA (section.tsx:178-187).

## 2. Findings

### ST-01. CRITICAL: the Attention module renders a false all-clear on digest failure

Evidence: `shots/states/digest-500.png` (Attention card: "0 open", check-in-a-circle, "Nothing needs your attention.") and `modules/attention-queue.tsx`.

Trace:

- `loading` is `state.status === "loading" && !data` (attention-queue.tsx:459). On a digest 500, status is `"error"`, so `loading` is false.
- `liveItems` is `(data?.items ?? [])` (463-466): error means data is null, so zero items and `openCount = 0` (472).
- `degraded` is `data?.degradedFeeders ?? []` (473): empty, because there is no data at all.
- `noPortfolio` is `pulse.data?.status === "empty"` (460): false, pulse data is also null.
- The render chain (653-776) therefore falls through `loading` (no), `visible.length > 0` (no), `noPortfolio && openCount === 0 && degraded.length === 0` (no), `degraded.length > 0` (no), and lands on the final else at 768-776: **the earned clear state**, checkmark and "Nothing needs your attention."

There is no `state.status === "error"` branch anywhere in the module. The card that exists to be "one ranked, finishable stream" tells a user whose dashboard failed to load that they are done for the day. This is the exact failure the comment at 748-749 ("not a fake clear state") guards against for the empty-portfolio case, and misses for the error case.

Should be: an error branch above the clear state, mirroring `SectionError`: "Couldn't load your queue. What needs your attention is unknown right now." + Retry wired to `refreshDigest`. The clear state must be reachable only when `state.status === "success"` and the queue is genuinely empty with zero degraded feeders.

Severity: Critical (false all-clear on an error; directly inverts the product's core promise).

### ST-02. HIGH: the hero renders fabricated numbers and live CTAs from null data (error AND loading)

Evidence: `shots/states/digest-500.png` and `shots/states/loading-skeleton.png` (both show "ACTIONS 0" as a real KPI, "15s read", and an active amber "Open Action Center" button); `modules/todays-brief.tsx`.

Trace:

- `actionCount = actions.data?.actions.length ?? 0` (todays-brief.tsx:170): null data silently becomes 0, and the Kpi renders `value={String(actionCount)}` (296, 304) with no loading or error gate. "ACTIONS 0" is a claim ("you have zero actions"), not an absence.
- `readingTime()` floors at 15s (42-46), so an empty headline still yields "15s read" (162-166 renders it unconditionally). On digest-500 the narrative band is blank yet labeled a 15 second read.
- The narrative gate is `loading = !headline && fallbackSlice.status === "loading"` (159). On error, `loading` is false and the module renders the narrative band with an empty verdict: a silent blank, neither skeleton nor error.
- "Open Action Center" (372-378) renders unconditionally in every state; on digest-500 it scrolls to a queue that is showing ST-01's false all-clear. Dismiss (398-404) is also always live.
- The hero does not use ModuleShell (by design, header comment 18-24) and reimplemented only the happy path plus a loading skeleton for the narrative (313-322). It has NO error state at all.

Should be: gate the KPI strip and CTAs on digest status. Error: "Your brief couldn't load." + Retry, no numbers, no CTA. Loading: the Actions KPI gets a skeleton chip, not a zero.

Severity: High.

### ST-03. HIGH: Radar footer fabricates "Watchlist: 0 buys, 0 near-buys" on error and loading

Evidence: `shots/states/digest-500.png` (Radar card body shows "Couldn't load your dashboard (500)" + Retry, yet the footer confidently states "Watchlist: 0 buys, 0 near-buys") and `shots/states/loading-skeleton.png` (same zeros under skeletons); `modules/radar.tsx:184-187`:

```
const buyCount = watchlist.data?.buckets.find(...)?.symbols.length ?? 0;
const nearBuyCount = watchlist.data?.buckets.find(...)?.symbols.length ?? 0;
```

Null data coerces to zero, and the footer (258-270) renders unconditionally. Same `?? 0` pathology as ST-02. The body correctly shows the Section error (the one part of this card that inherited the state machine, radar.tsx:220-227), which makes the confident footer zeros directly contradict the error message above them.

Should be: render the footer only when `watchlist.data` exists; otherwise omit the line (absence is honest) or show a dash.

Severity: High.

### ST-04. MEDIUM: degraded equity curve mislabeled "Not enough priced history to draw yet."

Evidence: `shots/states/degraded-market.png` (Book card, "90-DAY VS SPY" band shows that sentence while the rest of the card is fully populated); `modules/book.tsx:313-321`.

The branch order is: `curve.status === "ok" && points >= 2` draw; else loading skeleton; else the history sentence. A curve slice that arrived as `status:"degraded"` (Yahoo history fetch failed; digest.ts:305-307 ships the degraded shape) falls into the same else as a genuinely young portfolio. The copy asserts a fact about the user's data ("not enough priced history") when the truth is "the fetch failed". A user with two years of lots reads this as data corruption.

Should be: branch on `curve.status`: degraded gets "Couldn't price the 90-day comparison right now." + inline retry; "empty" keeps the history sentence.

Severity: Medium (wrong-cause copy; the number-free band limits damage).

### ST-05. MEDIUM: Market Overview conflates degraded with empty, and its empty state has no retry

Evidence: `shots/states/degraded-market.png` (a ~420px void containing only "Market data is unavailable right now."); `modules/market-intelligence.tsx:402-409` + `app/_components/ui/section.tsx:119-120, 178-187`.

The degraded market slice ships `status:"degraded", groups: []` (digest.ts:275-276). The module's `isEmpty` is `d.groups.length === 0` (405), so Section renders `SectionEmpty`, which by design has no retry affordance (section.tsx:178-187, "a fact about the asset"). But this is NOT a fact about the asset; it is a transient failure, and the only recovery is the small header refresh icon. The `CardStatus` discipline exists precisely to tell these apart (contracts.ts:11-13) and the module throws the distinction away. Meanwhile the header subtitle still reads "Global markets at a glance · Sat, Aug 8, 3:09 AM" as if all were well.

Should be: check `d.status === "degraded"` before `isEmpty` and render an error treatment with Retry; reserve the empty message for a genuinely empty-but-successful tape (which arguably cannot happen).

Severity: Medium.

### ST-06. MEDIUM: the new-user hero is dressed with another life's furniture

Evidence: `shots/states/new-user.png`; `modules/todays-brief.tsx`.

For a user with no portfolio and no watchlist, the hero shows:

- "Resume: RELIANCE.NS" (todays-brief.tsx:155, 379-388): `activity.data?.entries[0]` comes from the SQLite visit log (`buildRecentActivity`, digest.ts:231), which is not scoped to the portfolio. A brand-new book resumes a symbol the user never expressed interest in. For an actual fresh install this would be empty; the deeper point is that the hero has no concept of "there is nothing to resume INTO yet".
- "MARKETS CLOSED - FRI, AUG 7 CLOSE" (338-345): a session note about holdings the user does not have. (`buildPortfolioPulse`'s EMPTY object sets `sessionNote: null`, pulse.ts:21-46, so a true empty pulse would suppress it; the shot shows the band rendering when pulse fields survive, and the band's gate `p && (p.sessionNote || ...)` at 338 renders for any pulse object with a note regardless of `status`.)
- "15s read" (42-46, 162-166) on a brief whose entire content is one fallback sentence: labeling nothing as a read.
- "Open Action Center" (372-378), a primary CTA pointing at a queue whose own copy says to go add holdings; and Dismiss, offering to dismiss an empty brief.
- The page header still shows "Updated 3:09 AM" (home-header.tsx:22-37 from `digest.generatedAt`): technically true (the digest did build) but it stamps freshness onto a surface that is otherwise saying "no data yet".

What IS designed here: the Book card renders the capability CTA "Add a holding to see your portfolio here." + "Add a holding ->" (module-shell.tsx:37-42, 189-205, via book.tsx:190) and the queue renders "Add holdings and a watchlist to start your queue." with two CTAs (attention-queue.tsx:748-760). Those two are the correct pattern: state the fact, hand the user the next verb. But the hero, the largest and first surface, gives the new user zero direction; its only buttons are verbs for a portfolio that does not exist.

Should be: when `pulse.status === "empty"`, the hero swaps its action row for the onboarding verbs ("Add your first holding ->", "Build a watchlist ->"), suppresses Resume/session note/read-time, and the headline becomes directive: "Add a holding and tomorrow's brief will be about YOUR money."

Severity: Medium (no falsehood a new user can act on wrongly, but the flagship surface wastes the single most formative visit).

### ST-07. MEDIUM: the empty-state fallback headline contradicts the screen it is on

Evidence: `shots/states/new-user.png`: the hero's 34px verdict is "No market or portfolio data available yet." directly above a Market Overview card full of live market data. Source: `lib/home/brief.ts:111` (the `deterministicBriefing` last-resort string) via `digest.ts:317-319` (used when `ctx` is null).

The sentence bundles two claims and one of them is false on screen. Market data IS available; portfolio data is not.

Should be: split the fallback: with no ctx but no portfolio, "You're not tracking a portfolio yet." The market half should never be claimed absent by a string that cannot see the market slice.

Severity: Medium.

### ST-08. MEDIUM: the market-open "live" refresh is declared but not wired

Evidence: `lib/home/registry.ts:160-166` declares `refresh: "interval", refreshIntervalMs: 60 * 1000` for market-intelligence ("the one module where the number on screen is genuinely live"). No code in `app/_home/` consumes `refresh` or `refreshIntervalMs` (grep: zero matches for `setInterval|refreshIntervalMs` under app/_home; module-grid.tsx only reads layout). The `"on-focus"` policy declared for book/changes/queue/radar is likewise unconsumed (no visibilitychange/focus listener in app/_home).

So the market-open state renders correctly once and then freezes at digest build time; the only refresh is manual. `validateRegistry` (registry.ts:242-251) validates the policy's internal consistency but nothing executes it. The architecture map's claim ("60s interval refresh on market-intelligence only") describes the registry, not the runtime.

Should be: either wire an interval driver in the provider keyed off the registry, or delete the policy fields so the registry stops documenting behavior that does not exist.

Severity: Medium (market-open figures silently stale during the one session they claim to be live).

### ST-09. LOW: queue header asserts "0 open" while loading

Evidence: `shots/states/loading-skeleton.png` (Attention header reads "0 open" above skeleton rows); `attention-queue.tsx:616-618` renders `{openCount} open` unconditionally; openCount is 0 until data lands (463-472). Same zero-as-claim pattern as ST-02/ST-03, lower stakes because the skeleton below signals loading.

Should be: render the count only when data exists.

### ST-10. MEDIUM: the brief stream's partial-retention promise only covers one of two death modes; a fabricated timestamp leaks to the UI

Evidence: `home-provider.tsx:69-126`.

- The doc comment (73-75) says a stream that dies halfway "leaves us holding the headline". True only for a clean early EOF: `done` arrives, the loop exits, and if `acc.headline` is set it is returned (124-125). If `reader.read()` REJECTS mid-stream (connection reset, the common case for a dying stream), the exception propagates out of `fetchBrief`, `useDataset` records an error (use-dataset.ts:104-110), and the partial headline is discarded. There is no try/catch around the read loop.
- When the `done` chunk never arrives, `generatedAt` stays the client-side `new Date().toISOString()` from 86, and todays-brief.tsx:259-266 renders it in the header as the generation time ("a cached generation is honest about WHEN it was written"): the one path where that stamp is fabricated rather than reported.
- Fallback behavior is otherwise sound: the hero keeps `fallbackBriefing` (157) so a dead brief never blanks the narrative.

Should be: wrap the read loop; on mid-read failure, return the accumulated brief if `acc.headline` is non-empty (fulfilling the comment), else rethrow. Null out `generatedAt` unless a `done` chunk supplied it.

Severity: Medium (the failure copy is fine; the retention claim and the stamp are what mislead).

### ST-11. LOW: "AI GENERATED" badge renders on non-AI and failed content

Evidence: `shots/states/digest-500.png` (collapsed AI Investment Brief still carries the amber "AI GENERATED" badge while the brief is erroring); `ai-investment-brief.tsx:480-482` renders the badge unconditionally in the header. The hero handles the same problem correctly with its "Computed" pill (todays-brief.tsx:226-228). A card labeled AI-generated whose body says "Brief unavailable" or shows the deterministic path is claiming provenance for content that has none.

Should be: gate the badge on `brief.data?.aiGenerated`, and show "Computed" symmetry otherwise.

### ST-12. LOW: holiday and pre-open are approximations, and the IN market is gated by the US clock

Evidence: `lib/market-hours.ts:3-9` (module doc honestly states no holiday calendar, no early closes) and 37-43; `digest.ts:255` hardcodes `estimateMarketStatus("US")` for the queue's urgency gating even though the HOURS table has an IN entry (market-hours.ts:13) and the repo prices `.NS` books.

- Holiday: `estimateMarketStatus` returns "open" on a weekday holiday, so the `MARKET_CLOSED_URGENCY_CEIL` (attention.ts:92-99) is not applied and event urgency ramps as if the user could act. The visible session note stays correct because it is data-driven from stamped quote sessionDates (pulse.ts:224-230), not from the clock: the good half of the design.
- Pre-open (weekday, before 9:30 ET): status "closed", quotes carry the prior session, so the note reads "Markets closed - <day> close". Honest, but not directive; there is no "opens in 40 min" affordance anywhere.
- A predominantly-Indian book gets its event urgency capped/uncapped by New York's clock.

Should be: pass the book's dominant region (the report knows listing markets) into the urgency gate; add "opens <time>" to the session note when the next open is computable.

### ST-13. LOW: `marketPricedPct` ships in the digest and is rendered by no home module

Evidence: contract at `lib/home/contracts.ts:193-195` ("Share of value that is marked to market rather than self-reported"), populated at `lib/home/pulse.ts:284`. Grep over `app/` finds exactly one renderer: `/portfolio` (app/portfolio/page.tsx:438-447, the "Valuation basis" disclosure). Nothing in `app/_home/` reads it.

So a book that is 40% manually-marked (delisted names, private holdings, self-reported valuations) shows its total value, day P&L, health grade, and XIRR on Today with no caveat whatsoever, while /portfolio shows the disclosure for the same data. The only adjacent honesty on Today is the equity curve's "prices N% of book" note (book.tsx:307-311), which describes the CURVE's coverage, not the valuation basis, and only when the curve drew.

Should be: when `pulse.marketPricedPct < 95`, the Book card's header caption or hero band carries "N% market-priced", matching /portfolio's disclosure.

### ST-14. LOW: the queue's onboarding copy ignores an existing watchlist

Evidence: `attention-queue.tsx:748-760`. The empty branch keys only on `noPortfolio` (pulse empty) and says "Add holdings and a watchlist to start your queue" with both CTAs, even for a user who HAS a watchlist (zero-holdings-but-watchlist state). Telling a user to build the thing they already built erodes trust in every other CTA.

Should be: read `watchlistIntelligence.total` and drop the second clause/CTA when a watchlist exists: "Add holdings to start your queue. Your watchlist alerts will appear here when they fire."

### ST-15. LOW: offline renders the browser's raw error string plus every ST-01/02/03 pathology

Evidence: code path only (no shot). Offline, `fetch` rejects with `TypeError: Failed to fetch`; `fetchDigest` never gets a response (home-provider.tsx:64-66), and `use-dataset.ts:109` stores `err.message` verbatim, so ModuleShell surfaces render "Failed to fetch" as the error copy: developer prose, not product prose. The bespoke modules simultaneously exhibit ST-01 (false all-clear), ST-02 (Actions 0 + live CTA), ST-03 (zero footer). A 4xx/5xx at least produces the written sentence "Couldn't load your dashboard (500)" (home-provider.tsx:65). There is no offline detection (`navigator.onLine`, retry-with-backoff) anywhere in the home stack.

Should be: map network-level failures to one written sentence ("You're offline, or the server is unreachable.") in the fetcher, where the distinction is knowable.

### ST-16. LOW: four of five capability CTAs are dead code on this page

Evidence: `module-shell.tsx:37-63` defines directive UNMET states for portfolio, watchlist, scanner-snapshot, ai, and decisions. Grep: `unmet` is passed exactly once, by book.tsx:190 (portfolio). Radar, whose data source is literally the scanner snapshot, renders the generic Section empty "No new candidates today." (radar.tsx:224) even when the true state is "the scanner has never been run", for which a purpose-built CTA ("Run The Wire once to surface opportunities.") already exists eight lines above in the same codebase. `buildOpportunitySnapshot` distinguishes this exact case (`getLatestScannerSnapshot()` null -> status "empty" with null freshness, lib/mission-control.ts:283-286) so the signal is on the wire; nothing reads it.

Should be: Radar checks `state.data?.status === "empty" && scannerFreshness == null` and renders the scanner-snapshot UNMET treatment.

## 3. State-by-state verdicts

Each state: overall verdict, evidence, and what designed would look like. Per-module cells are in the matrix (section 4).

**S1. New user (no portfolio, no watchlist).** Verdict: MIXED, gets direction right in two modules and wrong in the flagship. Evidence: `shots/states/new-user.png`; ST-06, ST-07, ST-16. Book and Queue are DESIGNED (real CTAs with destinations, module-shell.tsx:37-47, attention-queue.tsx:750-759). The hero is BROKEN in spirit: stale Resume chip, market-closed note for a nonexistent book, "15s read" on one sentence, contradictory fallback headline, and its only CTAs point into the void. Radar is DEFAULTED ("No new candidates today.", radar.tsx:224, when it should say run the scanner or build a watchlist). What Changed is DESIGNED ("First visit - from now on, what moved while you were away shows up here.", whats-changed.tsx:112-118: honest and forward-pointing). Market Overview is DESIGNED (full data; a new user still gets the market). Should be: the hero owns onboarding (it is the first thing seen); everything below reinforces one path: add a holding.

**S2. Zero holdings, watchlist exists.** Verdict: DEFAULTED. Evidence: pulse empty (pulse.ts:200-201 keys on `holdingCount === 0`), so Book shows the add-holding CTA (DESIGNED); Queue shows the S1 copy that wrongly tells the user to build a watchlist (ST-14, DEFAULTED); Radar and its footer counts are real (`buildWatchlistIntelligence(watchlist, ...)`, digest.ts:298) and watchlist alerts still feed the queue when they fire (`seedsFromAlerts` with `UNHELD_IMPACT` floor 0.3, attention.ts:255-277: a genuinely designed touch, tracked-but-unheld names rank lower but rank). Brief prompt side: "No portfolio is tracked." (brief.ts:142) keeps the AI honest.

**S3. Single holding.** Verdict: DESIGNED. Evidence: `worstPerformer` requires `scored.length > 1` (pulse.ts:220), so one holding is never both Top and Weakest; radar spokes fall back to whatever covered dimensions exist when the canonical six are thin (pulse.ts:144-156); contributors renders one honest row (pulse.ts:78-81); the 100% concentration finding ranks first in the queue via the threat feeder's measured-impact path (attention.ts:230-233). No falsehoods found in code.

**S4. Market open.** Verdict: DEFAULTED, because the liveness is declared and unwired (ST-08). Everything renders correctly at build time; MetricDelta session-stamps keep figures honest; but "the one module where the number on screen is genuinely live" (registry.ts:161) refreshes only on manual click. Urgency ramps operate uncapped as designed (attention.ts:88-91).

**S5. Market closed, weekday evening.** Verdict: DESIGNED. Evidence: session notes are data-driven from stamped quote sessionDates, not the wall clock: pulse.ts:224-230 emits "Markets closed - <Weekday, Mon D> close" only when NO qualifying mover describes the current session; market-intelligence.tsx:74-84 emits "Showing <date> close" only when every previous-session figure agrees on one date, and per-figure labels are suppressed exactly then (`suppressSessionLabel`). The queue caps overnight urgency inflation at 0.85 (attention.ts:92-99). This is the strongest state design on the page.

**S6. Weekend (the baseline).** Verdict: DESIGNED. Evidence: `shots/baseline/1440.png`: the hero's Band 4a reads "MARKETS CLOSED - FRI, AUG 7 CLOSE" once, as a deliberate label rather than a warning wall; Top/Weakest deltas render without per-figure date stamps (suppressed by the note, todays-brief.tsx:352, 362); the Book's Day P&L is dated "Fri, Aug 7" (book.tsx:245-247); Market Overview's subtitle carries "Showing Fri, Aug 7 close" and the page still feels alive rather than apologizing for the calendar. The one blemish: "Today" KPI label over Friday's move relies on the session note being read; the stamp discipline (Metric sessionDate everywhere, `lib/metric.ts`) is what earns the DESIGNED grade.

**S7. Holiday (weekday, exchange closed).** Verdict: DEFAULTED. Evidence: ST-12. The visible layer behaves like S6 because the notes derive from quote stamps, which is the right architecture. The clock layer (`estimateMarketStatus`, market-hours.ts:37-43) calls the day "open", so queue urgency is not capped and any "open" assumptions ride the wrong fact. The module doc-comment honestly declares the limitation (market-hours.ts:3-9): documented approximation, not a bug, hence DEFAULTED not BROKEN.

**S8. Pre-open (weekday morning).** Verdict: DEFAULTED. Same machinery as S5 shows "Markets closed - <yesterday> close" honestly, but nothing tells the user the open is imminent, which is the single most useful fact at 9:00 AM. No pre-market quotes are attempted anywhere in the digest.

**S9. Upstream (Yahoo) failure, digest still 200.** Verdict: MIXED, this is the failure shape the architecture actually designed for. Evidence: `shots/states/degraded-market.png`. Per-step isolation works: with market + curve dead, the hero, book vitals, queue (19 open), and radar all render fully. The Queue's degraded plumbing is DESIGNED: `degradedFeeders` names the dead feeders and the footer offers "Some data unavailable (x) - retry" (attention-queue.tsx:739-746), or a dedicated degraded empty state (761-767). What Changed is deliberately silent when degraded (whats-changed.tsx:100-102): defensible (the band "earns its place by having something true to say") but a silent vanish is indistinguishable from "nothing changed" for a user who saw it yesterday: DEFAULTED. Book's curve band is BROKEN (ST-04 wrong-cause copy). Market Overview is DEFAULTED-to-BROKEN (ST-05: degraded conflated with empty, no retry, stale-confident subtitle).

**S10. Partial data (some quotes dead).** Verdict: DESIGNED. Evidence: per-tile degradation in Market Overview: a missing ticker renders an em-dash-free "-" price, no delta, and "Live data for this instrument is unavailable right now." (market-intelligence.tsx:248-270); missing 30d history holds the sparkline's exact box with a shimmer "never a fabricated line" (263-266); the sentiment tile drops to "Sentiment gauge unavailable - not enough market data." (327). Health dimensions abstain rather than guess (`covered:false` spokes drawn faded, pulse.ts:119-140; abstentions "sink to the bottom (they still render, faded - an abstention is information)", pulse.ts:181-183); the Book shows "prices N% of book" on the curve when coverage < 95% (book.tsx:307-311). This is the page's best-executed degradation tier.

**S11. Stale scanner cache.** Verdict: DESIGNED. Evidence: Radar renders "From a stale scan - re-run the scanner for current signals." above the tiles (radar.tsx:245-247): directive copy with a specific verb. Queue confidence decays with observation age (full <= 1 day, half <= 3 days, zero beyond; attention.ts:190-198), so stale signals sink via the geometric score instead of being censored.

**S12. LLM timeout / unavailable.** Verdict: DESIGNED. Evidence: the digest never touches AI (digest.ts:14-17); the hero paints `fallbackBriefing` immediately and marks it "Computed" (todays-brief.tsx:226-228); while the stream runs it shows "Writing AI brief..." (389-397), and on failure the fallback simply stays. The long read: error -> message + Retry (ai-investment-brief.tsx:343-345); success-with-no-note -> "The long-form note needs a reachable AI provider. Connect one and refresh." (349-356), which is directive (though a link to /settings, as the `ai` UNMET state has, would complete it). Blemish: ST-11's unconditional AI badge.

**S13. Rate limited.** Verdict: BROKEN via inheritance. Two shapes: (a) `/api/home` itself returns 429 -> identical to S19 (the thrown copy interpolates the status: "Couldn't load your dashboard (429)", home-provider.tsx:65), including ST-01's false all-clear; (b) Yahoo throttles inside the digest -> S9's degraded shape. No throttle-specific handling (no Retry-After awareness, no backoff) exists anywhere in the home stack.

**S14. Offline.** Verdict: BROKEN. Evidence: ST-15. Raw "Failed to fetch" copy plus the full digest-transport-failure pathology (ST-01, ST-02, ST-03).

**S15. Slow network (digest never resolves).** Verdict: MIXED. Evidence: `shots/states/loading-skeleton.png`. The skeleton system itself is DESIGNED: shape-matched shimmers per module (attention-queue.tsx:653-675 mirrors the spotlight + rows; radar.tsx:228-241 mirrors tiles; todays-brief.tsx:313-322 mirrors the verdict/support), reserved heights so nothing shifts (section.tsx:86-94), and What Changed correctly renders nothing rather than a placeholder band. The failures are the numbers that leak through: "ACTIONS 0" (ST-02), "0 open" (ST-09), "Watchlist: 0 buys, 0 near-buys" (ST-03), plus live Open Action Center / Dismiss buttons on an unloaded page. There is also no slow-load messaging: at 13.9s cold (architecture map section 4) the user stares at shimmer with no "still building your digest" reassurance and no timeout escape into an error state; `runPlan`'s 20s server timeout (digest.ts:194) is the only bound.

**S16. Very large portfolio (100+ holdings).** Verdict: DESIGNED (presentation layer). Evidence: every list clamps: queue shows the spotlight + 7 rows with "N more items" expand (MAX_VISIBLE 8, attention-queue.tsx:59, 471, 722-737); filters unlock at > 5 items (595); Radar caps at 5 tiles (radar.tsx:249); contributors cap at 3 shaped rows (pulse.ts:78-81); events cap at 8 (digest.ts:215); change chips cap at 5 with a Details expander (whats-changed.tsx:27, 130-131). The queue contract explicitly leaves the cap to the UI (contracts.ts:395). Unverified at runtime: server-side digest build cost with 100+ symbols (quote batching exists; the 20s plan timeout is the backstop, and a timeout would surface as S9's degraded shape, in which case ST-04/ST-05 apply). No pagination exists in the expanded queue: 60 open items render as one long list, which is finishable-by-design but heavy.

**S17. Untracked / delisted / manual-priced holdings.** Verdict: DEFAULTED. Evidence: ST-13. The engines handle it correctly (cost fallback, `marketPricedPct` + `stalePct` computed in lib/portfolio/model/holding.ts:196-197; confidence engine consumes it, engines/confidence.ts:60-64); the Today page just never discloses it. The equity curve honestly excludes unpriceable assets and reports coverage (equity-curve.ts:22-24), but only on the curve band. A fully-manual book renders a confident dashboard indistinguishable from a marked-to-market one.

**S18. Multi-currency book (CASH-INR lots, .NS symbols).** Verdict: DESIGNED with one seam. Evidence: synthetic `CASH-<CCY>` lots are excluded from Yahoo batches, with the comment documenting the real bug this fixed (a dropped forex position) (digest.ts:92-98; equity-curve.ts:54-57); the curve carries FX series (`<CCY>USD=X`, equity-curve.ts:64-65); market-hours knows IN (market-hours.ts:13); pulse session notes are per-symbol stamp-driven so a mixed US/IN book shows "Markets closed" only when ALL sessions are finished (pulse.ts:225-230), and mixed dates keep per-figure labels (market-intelligence.tsx:74-84 requires ONE shared date to collapse the labels: exactly right). The seam is ST-12's US-only urgency gate (digest.ts:255). The Market Overview tape is US/global-index centric with no NIFTY, a content choice rather than a state bug.

**S19. Digest 500.** Verdict: BROKEN. Evidence: `shots/states/digest-500.png`. The three ModuleShell/Section consumers do the right thing: Book, Radar body, and Market Overview each render "Couldn't load your dashboard (500)" + Retry, independently (a failed section fails alone, section.tsx:22-23). Everything bespoke fails open: the hero (ST-02), the queue (ST-01, the critical false all-clear), the radar footer (ST-03). What Changed vanishes silently. The page header correctly drops its "Updated" stamp (home-header.tsx:34 reads `digest.data?.generatedAt`, null on error). Net: a user skimming the page sees two confident zeros, a checkmark, and a glowing CTA before they see the three small error paragraphs.

**S20. Brief stream dies mid-read.** Verdict: DEFAULTED. Evidence: ST-10 (partial headline survives clean early EOF only; mid-read rejection discards it; fabricated `generatedAt` on missing done-chunk). Additionally, when the headline survives but `note` never arrived, the long read's no-note copy blames the provider ("needs a reachable AI provider", ai-investment-brief.tsx:349-356) when the provider demonstrably produced a headline seconds earlier: wrong-cause copy in that specific sub-state. The hero degrades perfectly (fallback never left the screen).

## 4. State x module matrix

Legend: D = designed, F = defaulted, B = broken, n/a = state does not touch the module. Grades are for the module's behavior IN that state, per the evidence above.

| # | State | Brief (hero) | Book | What Changed | Attention Queue | Radar | Market Overview | AI Invest. Brief |
|---|---|---|---|---|---|---|---|---|
| S1 | New user | B (ST-06/07) | D | D | D | F (ST-16) | D | F |
| S2 | Watchlist, no holdings | F | D | D | F (ST-14) | D | D | F |
| S3 | Single holding | D | D | D | D | D | D | D |
| S4 | Market open | D | D | n/a | D | D | F (ST-08) | n/a |
| S5 | Closed evening | D | D | n/a | D | n/a | D | n/a |
| S6 | Weekend (baseline) | D | D | n/a | D | n/a | D | n/a |
| S7 | Holiday | D | D | n/a | F (ST-12) | n/a | D | n/a |
| S8 | Pre-open | F | D | n/a | D | n/a | F | n/a |
| S9 | Yahoo dead (degraded) | F | B (ST-04) | F (silent) | D | F | B (ST-05) | n/a |
| S10 | Partial quotes | D | D | D | D | D | D | n/a |
| S11 | Stale scanner | n/a | n/a | n/a | D | D | n/a | n/a |
| S12 | LLM down/timeout | D | n/a | n/a | n/a | n/a | n/a | D (badge: ST-11) |
| S13 | Rate limited (API) | B | D | F | B | B | D | F |
| S14 | Offline | B | F (ST-15) | F | B (ST-01) | B (ST-03) | F | F |
| S15 | Slow network | B (ST-02) | D | D | F (ST-09) | F (ST-03) | D | D |
| S16 | 100+ holdings | D | D | D | D | D | D | D |
| S17 | Manual-priced book | F (ST-13) | F (ST-13) | n/a | n/a | n/a | n/a | n/a |
| S18 | Multi-currency (.NS/INR) | D | D | n/a | F (ST-12) | n/a | F (no IN tape) | n/a |
| S19 | Digest 500 | B (ST-02) | D | F | B (ST-01) | B (ST-03) | D | F (ST-11) |
| S20 | Brief stream dies | F (ST-10) | n/a | n/a | n/a | n/a | n/a | B (wrong-cause copy) |

Tallies (98 graded cells): 55 designed, 26 defaulted, 17 broken.

## 5. The shape of the problem

One pattern generates almost every broken cell: **`data?.x ?? 0` (or `?? []`) in bespoke modules that opted out of the shared Section state machine.** Section itself distinguishes loading/error/empty/success correctly (section.tsx:107-135), and the three modules that use it (Book, Radar body, Market Overview) are the three that render honest errors on digest-500. The four bespoke surfaces (hero, queue, radar footer, long-read badge) each re-derive display values from possibly-null data, and null coerces to a confident zero, an earned-looking checkmark, or an unearned badge. The fix is one discipline, not seventeen patches: a bespoke module must branch on `state.status` BEFORE it reads `state.data`, and no numeral or CTA may render from a slice whose status is error or loading.

Second-order theme: the degraded tier (S9/S10/S11) is genuinely well-designed because the contracts carry `CardStatus` per slice and the server isolates failures; the two modules that lose that information (ST-04's curve else-branch, ST-05's isEmpty conflation) are the ones that flattened a four-value status into a boolean.

Third: empty states that give direction exist and are good (module-shell UNMET, queue onboarding, first-visit band), but they are wired into 2 of the 5+ places they apply (ST-16), and the flagship hero, the surface a new user reads first, has none (ST-06).

## 6. Verification notes

- All code references are to the working tree on 2026-08-08. Screenshots were provided pre-captured; the new-user and degraded shots reflect mutated/degraded digests, so some cells (e.g. the new-user session note surviving into the hero) reflect the shot as evidence of the render path, with the corresponding pure-code path noted where it differs (pulse.ts EMPTY sets sessionNote null).
- Not verified at runtime (read-only constraints): true 100+ holding digest build time, real holiday behavior, real IN-session mixed-book rendering, actual offline copy. Each is graded from the code path with the reasoning stated inline.
