# 12. Benchmark: prior art for the morning surface

Scope: the Today dashboard (`/`) as mapped in `00-architecture-map.md` and shown in `shots/baseline/1440.png`. This audit studies how serious tools solve the "what happened and what should I do" problem, extracts transferable patterns, and grades each against this page's north star: a user opens the page in the morning and within 30 seconds knows what changed, what it means, and the single most valuable next action.

Method: web research (product docs, help centers, first-party feature pages, practitioner writeups) conducted 2026-08-08. Patterns below are mechanics, not marketing claims. Where a source is aspirational rather than verified in-product, it is marked.

---

## 1. Source-by-source findings

### 1.1 Bloomberg Launchpad + First Word (the desk analyst's morning)

- Launchpad is a user-composed grid of live monitors: multiple watchlist panels, function panels with tabs, and "component groups" where changing the symbol in one panel updates every linked panel. It is pure density, zero narrative. The user builds it once and it never rearranges itself.
- The actual morning read on the desk is not Launchpad; it is First Word (curated one-liner news channels, filtered by asset class, written by ex-traders) and the "Five Things You Need to Know to Start Your Day" newsletters: a greeting line naming the 3 to 5 movers, then exactly five named items, one short paragraph each, every claim linked to the underlying story. Fixed count, fixed order, timestamped, signed by an author.
- First Word's explicit design goal (per Bloomberg's own framing): "filter out the noise and filter in what is important" for a specific reader. Curation is a person's judgment, not an engagement algorithm.
- Key mechanic: separation of the monitor (always-on, dense, no prose) from the brief (once-a-day, fixed length, all prose). Bloomberg never blends them into one card.

### 1.2 Koyfin (My Dashboards, Market Overview, Home)

- Two-tier dashboard model: curated Market Overview pages (world indices, sectors, factors, yields, FX, commodities) that Koyfin maintains, and My Dashboards the user assembles from widgets (watchlists, charts, news). The v3.87 release made "Home" the start page "with your favorites pinned at the top": recency plus explicit pinning, not algorithmic ranking.
- Widget "color groups" link components so a symbol click propagates. Useful in a multi-panel research session; irrelevant to a fixed morning page.
- The market tape norm: one row per instrument, last, change, percent change, tiny sparkline. Koyfin's curated market dashboard is the closest commercial analog to this page's Market Overview band, and it carries no narrative sentences at all inside the tape.

### 1.3 Addepar (advisor home / Dashboards)

- The View Capital client spotlight is the most instructive artifact: advisors set the landing page to a dashboard of "single number widgets that quickly inform advisors where attention is needed," with dedicated "notification widgets that point users in the direction of where to prioritize their efforts." Their before state: "a dozen or so views that I would independently scroll through to get the same answers." The dashboard's job is to collapse a scroll-and-hunt ritual into one glance.
- Widgets are number-first (single stat, short table, small chart), refresh on a schedule, and are shared as firm standards. Nothing on the Addepar home is a feed; everything is a state readout.
- Client portal Overview tab: net worth, rate of return, historic change, allocation "all on a single page." Four numbers, one page, no queue: the pattern is that the summary layer never tries to be the work layer.

### 1.4 YCharts (Dashboards)

- Module catalog: charts, security/indicator lists, news, alerts, text boxes, custom images, and an "AI market commentary" module. Commentary is a module the user opts into and places, clearly boxed and labeled, never interleaved with the numbers.
- Alerts are a module on the dashboard, i.e. triggered conditions surface where the user already looks, instead of only in email. Manage/share/publish flow exists because YCharts serves teams; the single-user analog is zero.
- The "Condense" feature exists specifically to remove whitespace between modules: an explicit vote for density on monitoring surfaces.

### 1.5 Fintool (AI equity research)

- Every AI answer carries citations with document title, page number, and a relevance score; their own best-practices doc instructs builders to "always parse and display citations" and "make citations actionable" (click-through to the exact chunk). Streaming answers show thinking states so latency is legible.
- Documents are pre-chunked and typed (10-K, 10-Q, 8-K, EARNINGS_CALL) so a citation names its source class, not just a URL.
- The transferable rule: an AI sentence containing a number is a liability unless the number resolves to a source the user can open. This page already has the server-side half (grounding verification in `lib/home/brief.ts`, fallback to `deterministicBriefing()`); Fintool shows the missing client-side half: visible, clickable provenance on the prose itself.

### 1.6 Sentieo / AlphaSense (research dashboards + monitoring)

- Dashboards are assembled from saved searches and watchlists; the monitoring loop is: save a search, attach an alert cadence, optionally pin it to a dashboard. Pull surface and push surface are fed by the same saved object, so nothing is configured twice.
- Alert emails offer three summarization depths as templates: "Documents Only," "Summarized Documents," "Executive Brief." The user picks how much AI summarization they want per alert; summaries are labeled as such and each cites the underlying documents.
- Dashboard templates ship for common jobs (Portfolio Monitor, Industry Overview) rather than a blank canvas: opinionated defaults with escape hatches.

### 1.7 Atom Finance

- Portfolio-aware everything: linked accounts drive the news feed, briefings, and alerts, so the feed is scoped to what the user actually owns or watches. Daily "market briefings" are short and push-delivered.
- Hubs = watchlist + comparison metrics + a news feed for that set. The cautionary half: the news feed inside a Hub is reverse-chronological and unranked, so it reads as an infinite scroll. Atom demonstrates both the value of holdings-scoping and the cost of an unranked feed on a monitoring surface. (Atom has since effectively shut down as a consumer product; patterns cited from archived reviews and TechCrunch coverage.)

### 1.8 Tegus (expert research workflow)

- Every transcript is typed (Company Deep-Dive, Industry Overview, Voice of Customer, Channel Check) and every expert is labeled by perspective (competitor, customer, former exec). Qualitative evidence carries structured provenance so the reader can weight it before reading a word.
- AI-led calls and AI summaries are explicitly labeled as AI-led/AI-generated, distinct from investor-led. The label is a first-class filter, not a footnote.
- Project workflow is a queue with states (requested, scheduled, completed) and each completed item rolls up into an auto-updating report: individual items resolve into a durable artifact instead of vanishing.

### 1.9 Morning notes desk analysts actually read (JPM Eye on the Market, Goldman Top of Mind, sell-side morning meeting notes)

- The canonical sell-side morning note format (widely documented, including in published note templates): Top Call first (the one headline a PM must hear, 2 to 3 sentences on why it matters), then Overnight Developments as one-liners each with "our take," then Key Events Today with times and expectations, then Trade Ideas each paired with "Risk: what would make this wrong." One page max, readable in 2 minutes, timestamped, opinionated. "No news is a valid morning note": saying "nothing material overnight" is considered a feature, not a failure.
- JPM Eye on the Market: one author's voice, one thesis per issue, argument carried by charts with the text annotating them. It began as "a text-only monthly email designed for clients using a Blackberry": the format was born from a hard length budget.
- Goldman Top of Mind: a single question framed per issue, answered through interviews with people who disagree. Powerful for monthly theme pieces; wrong cadence and wrong length for a daily surface.
- The common thread across all three: fixed structure so the reader's eyes learn where things live; the lede is a judgment, not a statistic; every claim is signed and timestamped.

### 1.10 Linear (Inbox + Triage)

- One ordered list, keyboard-walked with J/K. Triage guarantees every item exits by exactly one of four resolutions, each on a single key: accept (1), duplicate (2), decline (3), snooze (H). Nothing lingers in an ambiguous state.
- Snooze is not deletion: a snoozed item returns at the chosen time OR immediately when there is new activity on it, whichever comes first. Snoozed items can be shown or hidden via a display setting, so the queue count stays honest.
- Triage has an owner (rotating schedule) and a definition of done (queue empty). The queue is a workflow with an end, not a feed.

### 1.11 Superhuman (split inbox + keyboard triage)

- Design-for-flow principles, stated and shipped: (1) the next action is always obvious, and taking it advances you to the next item automatically (archive shows the next email, never the inbox, killing per-item decision fatigue); (2) feedback in under 100ms so attention never wanders; (3) you cannot see the list and an item at the same time, deliberately, so there is exactly one focus.
- Split Inbox: user-defined splits (VIP, Team, Calendar, Notifications) so similar items are processed in a batch instead of forcing context switches per item.
- Three visible buttons per screen, everything else behind Cmd+K with fuzzy matching that teaches the direct shortcut for next time. Inbox Zero is celebrated with a full-screen photograph: a deliberate engagement/delight mechanic.

### 1.12 PagerDuty (incident feed)

- Precise, separated vocabulary: priority orders the work (P1..P5), urgency controls how you are notified (high/low), severity describes impact on the service (critical/warning/error). Three different questions get three different fields; they are never fused into one opaque score.
- Lifecycle semantics: triggered -> acknowledged (someone owns it, escalation halts, but it is NOT done; the ack times out and the incident re-triggers) -> resolved (closed, reopenable). Snooze exists only on acknowledged incidents and the incident comes back loudly if the timer expires unresolved. Low-urgency incidents never escalate on their own.
- The system is built so that ignoring something is impossible but deferring it is cheap. Deferral always has a return path.

### 1.13 Things 3 (Today view)

- Today contains only actual commitments; the community's #1 rule is that an overloaded Today is the primary failure mode. Everything else lives in Anytime/Someday, visible on demand but never polluting the morning list.
- Two axes kept separate: "when will I do this" (Today, This Evening, Someday) vs "when is it due" (Deadline). This Evening is a sub-section of Today for items you cannot act on until later in the day: a temporal split inside the day itself.
- Color is reserved for meaning (yellow = Today, red = deadline, indigo = evening); the interface is otherwise near-monochrome. Calendar events render inline with tasks, read-only, at the top.

### 1.14 GitHub notifications inbox

- Triad of states: Unread, Saved (flagged, kept indefinitely, its own sidebar view), Done (removed from inbox but retrievable for 5 months via `is:done`). Dismissal is reversible and auditable, never destructive.
- Unsubscribe as a first-class exit: kill future notifications from a whole conversation, with automatic resubscribe on @mention. The user can mute a source, not just an item.
- Filters are a query language (`is:unread`, `reason:mention`) and custom filters are savable: the inbox is a database view, not a stream.

### 1.15 TradingView watchlist detail / Notion Home My Tasks

- TradingView: clicking a watchlist row populates a persistent detail pane (chart, stats, news for that symbol) without navigation. Zero-cost drill-down keeps the user on the monitoring surface.
- Notion Home My Tasks: aggregates tasks assigned to you across up to 10 databases into one view, with inline property editing (complete, reassign) directly in the widget. The aggregation view is also a work surface, so items can be resolved where they are seen.

---

## 2. Pattern table

Verdicts are relative to THIS page and its north star. "Steal" = adopt the mechanic as-is. "Adapt" = adopt the principle with changes for a single-user local terminal. "Reject" = deliberately do not do this, with reason.

| # | Pattern | Source | Applicability to this dashboard | Verdict |
|---|---------|--------|--------------------------------|---------|
| 1 | Top Call first: lead with one judgment (the thing the PM must hear), not a statistic | Sell-side morning note format | The AI executive brief headline already leads; enforce that it is always a judgment naming the single watch item, with the stat row subordinate | Steal |
| 2 | "No news" is a valid brief: say "nothing material since yesterday, positioning unchanged" | Morning note discipline | The brief currently always narrates something; on quiet days it should say so in one line and shrink | Steal |
| 3 | Fixed section count and order (exactly five things, same slots daily) so eyes build muscle memory | Bloomberg Five Things newsletter | The module order is already fixed via `HOME_LAYOUT`; extend the discipline inside cards (brief always: headline, why, watch item, action) | Steal |
| 4 | Hard length budget: one page, 2-minute read, enforced | Morning notes; JPM EOTM origin story | Brief already shows "2 min read"; make it a real constraint on generation, not a label | Steal |
| 5 | Every idea paired with "Risk: what would make this wrong" | Morning note trade ideas | Radar/queue signal rows state fit but never the disconfirming condition; add one falsifier line per recommendation | Steal |
| 6 | Author + timestamp on every claim; takes are signed and dated | Morning notes; Bloomberg First Word | Page already stamps `generatedAt` and per-metric `sessionDate`; surface the model/deterministic origin on the brief the same way | Steal |
| 7 | Separate the monitor (dense, live, no prose) from the brief (fixed length, prose, daily) | Bloomberg Launchpad vs First Word | Already the page's structure (tape vs brief); protect it: never let narrative sentences leak into tape tiles ("Markets are euphoric...") | Steal |
| 8 | Curated one-liner feed written to filter noise IN a specific reader's terms | Bloomberg First Word | The Attention Queue is the analog; the scoring engine plays the editor role and must be as opinionated | Adapt |
| 9 | Linked panels / symbol propagation across widgets | Bloomberg Launchpad, Koyfin color groups | Multi-panel research pattern; the Today page is single-column narrative. `symbol-link.tsx` hover context is the right lighter-weight version | Reject: adds interaction machinery a fixed morning page does not need |
| 10 | Two-tier dashboards: curated defaults plus user-composed custom | Koyfin, AlphaSense templates | A single-user product should ship one excellent opinionated layout; module registry already allows recomposition in code | Adapt: keep layout opinionated, allow per-module collapse persistence instead of drag-drop |
| 11 | Landing page as "where attention is needed" pointers, single-number widgets | Addepar (View Capital) | Exactly the brief stat row + queue design; validates the architecture. The Addepar test: does each number change a decision this morning? | Steal |
| 12 | Summary layer never tries to be the work layer: four numbers, links out to depth | Addepar client portal Overview | The page mostly obeys this (Open portfolio, Open research links); resist adding inline editing of positions or deep tables | Steal |
| 13 | AI commentary as a clearly boxed, labeled, opt-in module | YCharts AI market commentary | Matches the collapsed AI Investment Brief with its AI GENERATED badge; keep the long read collapsed by default forever | Steal |
| 14 | Alerts surface on the dashboard itself, not only in email/notification tray | YCharts alerts module | Watchlist alerts already feed the queue; ensure no alert class exists that can only be seen elsewhere | Steal |
| 15 | Every AI number/claim carries an actionable citation (source, location, confidence) | Fintool | The grounding pipeline exists server-side; add visible provenance chips on brief sentences that resolve to the engine value and its asOf stamp (the explain-popover pattern already on queue scores, extended to prose) | Steal |
| 16 | Show thinking/streaming states so AI latency is legible | Fintool, AlphaSense | Brief already streams NDJSON over the deterministic fallback; label the in-flight state explicitly ("drafting from 3:11 AM data") | Adapt |
| 17 | User-selectable summarization depth (documents only / summarized / executive brief) | AlphaSense alert templates | One user, one preference: a single setting for brief verbosity (headline only vs full note) would serve; three tiers is over-engineering | Adapt |
| 18 | Saved query feeds both the pull dashboard and the push alert; configure once | AlphaSense saved searches | Watchlist rules already feed queue + notifications; keep single-definition when adding push (email/OS notification) later | Adapt |
| 19 | Structured provenance labels on qualitative items (type + perspective) | Tegus transcript/expert labels | Queue rows already carry kind badges (THREAT, SIGNAL, ACTION, EVENT); add source feeder to the badge (scanner, alert engine, health engine) so trustworthiness is scannable | Steal |
| 20 | AI-led vs human-led artifacts explicitly labeled and filterable | Tegus AI Interviewer, AI summaries | Brief already flips `aiGenerated: false` on fallback; render the distinction (AI vs deterministic) instead of only the AI badge | Steal |
| 21 | Resolved queue items roll up into a durable artifact (auto-updating report) | Tegus call projects | Dismissed queue items currently vanish into a TTL table; a reviewable "handled this week" log closes the loop cheaply | Adapt |
| 22 | Portfolio-scoped feed: only items about what you own or watch | Atom Finance | Already the page's core premise (every feeder is book- or watchlist-derived); named here as the thing that must never regress toward general market news | Steal |
| 23 | One ordered queue, keyboard-walked (J/K), every item exits via exactly one of four single-key resolutions | Linear Inbox/Triage | The Attention Queue's missing interaction model: today it has only mouse dismissal (x) and act links. Add J/K walk plus act/done/snooze/mute on single keys | Steal |
| 24 | Snooze returns at time chosen OR on new activity, whichever first | Linear snooze | The dismissal TTL in `/api/home/attention/dismiss` is the timer half; add the re-trigger half: a dismissed item whose underlying fingerprint changes materially should return early | Steal |
| 25 | Show/hide snoozed items toggle so the open count stays honest | Linear, GitHub | Queue header says "19 open"; a "+ n snoozed" affordance keeps trust in the count | Adapt |
| 26 | Resolving an item auto-advances focus to the next; the next action is always obvious | Superhuman archive flow | On queue keyboard dismissal, move focus to the next row instead of collapsing back to the whole list | Steal |
| 27 | Split processing by type to avoid per-item context switching | Superhuman Split Inbox | Queue interleaves threats/signals/actions/events by score, which is correct for ranking; add kind filter chips for batch processing without changing default order | Adapt |
| 28 | Sub-100ms feedback on every action; minimal visible buttons; command palette teaches shortcuts | Superhuman | Dismiss/snooze must be optimistic-UI; the app-wide Cmd+K search exists, extend it to queue verbs | Adapt |
| 29 | Inbox Zero celebration imagery, gamified delight on clearing | Superhuman | Contradicts the product: the reward for finishing the morning read is closing the tab. A quiet "Queue clear, next check after the open" line suffices | Reject: engagement mechanic on a tool whose success metric is minutes NOT spent |
| 30 | Separate vocabulary: priority (work order) vs urgency (interruption level) vs severity (impact size), never fused into one opaque number | PagerDuty | Directly addresses audit finding #4 (all signals compressed to 65-67): the geometric blend impact^a * urgency^b * confidence^c destroys legibility. Show the components (already in explain popover) as compact glyphs on the row; keep the blend only for sort order | Steal |
| 31 | Ack vs resolve distinction: acknowledged means owned-not-done, times out and re-raises if never resolved | PagerDuty | Queue "dismiss" currently conflates "seen" with "handled." Split: done (acted, logged) vs snooze (timer + re-raise) vs mute (kill this source) | Steal |
| 32 | Low-urgency items never escalate or interrupt; they wait for the morning | PagerDuty urgency rules | The page IS the low-urgency channel; codify a floor score below which items never enter the visible queue, only the "11 more items" overflow | Adapt |
| 33 | Today contains only real commitments; overload is the named failure mode; everything else stays in Anytime | Things 3 | Validates the Next Best Step + capped visible queue + overflow design; make the above-fold cap explicit (5 to 7 items) and tune the score floor to hold it | Steal |
| 34 | Separate "when will I act" from "when is it due" (When vs Deadline) | Things 3 dual dates | Queue events carry event dates (US Employment Report); actions carry act-by intent. Render the two differently instead of one priority number for both | Adapt |
| 35 | This Evening: a temporal sub-section within today for cannot-act-yet items | Things 3 | Market analog: "at the open" vs "after the close" sections for actions gated on session state (`estimateMarketStatus` already exists) | Adapt |
| 36 | Color reserved exclusively for meaning; interface otherwise neutral | Things 3 | The dark terminal aesthetic already trends this way; audit the page for decorative green/red (sparkline tint vs semantic P&L color should not compete) | Steal |
| 37 | Done is reversible and auditable (is:done view, 5-month retention); Saved is a separate flag | GitHub notifications | Dismissals persist in SQLite already; expose them ("dismissed today: 3, review") so trust in the queue's editing is verifiable | Steal |
| 38 | Unsubscribe/mute at the source level, with auto-resubscribe on direct relevance | GitHub unsubscribe | "Never show me SCHW fit signals again" is a mute on a feeder+symbol pair; auto-return if that symbol enters the portfolio | Adapt |
| 39 | Click a row, get a detail pane in place; drill-down without navigation | TradingView watchlist detail | The explain popover and symbol hover context are the right size; a full split pane would violate the 30-second read. Keep popover, reject pane | Adapt |
| 40 | Aggregation view is also a resolution surface (inline property edit in My Tasks) | Notion Home My Tasks | Queue action rows should complete in place where the action is atomic (dismiss, snooze); routing to Action Center for multi-step decisions is correct | Adapt |
| 41 | One author, one thesis, chart-led argument in the long read | JPM Eye on the Market | The collapsed AI Investment Brief should be restructured: one thesis sentence, then sections annotating the SAME charts the page already shows, not new prose territory | Adapt |
| 42 | Question-framed monthly deep dive with adversarial viewpoints | Goldman Top of Mind | Wrong cadence for a daily surface; belongs in research/IC-report land if anywhere | Reject: monthly-essay format on a daily page inflates read time with no decision value |
| 43 | Blank-canvas dashboard customization (drag-drop, resize, share, publish) | Koyfin, Addepar, YCharts, AlphaSense | Those are team products selling flexibility; this is one user and one code-owned layout (`lib/home/layout.ts`). Customization UI would be dead weight | Reject: configuration surface for an audience of one; the repo IS the customization UI |
| 44 | Reverse-chronological unranked news feed on the monitoring surface | Atom Hubs feed, generic news widgets | The queue's whole thesis is ranked-or-absent; an unranked feed reintroduces the scanning tax the page exists to eliminate | Reject: infinite feeds convert a 30-second read into open-ended grazing |
| 45 | Ambient motion: flashing ticks, count-up number animations, live-updating gauges | Launchpad-style monitors; this page's own `use-count-up.ts` | Motion signals change; on a page whose job is to REPORT change, animation that fires on every load is a false change signal and taxes the 30-second budget | Reject: animation should be reserved for actual data arrival (brief stream landing), not decoration |
| 46 | Curated defaults ship as templates (Portfolio Monitor, Industry Overview) | AlphaSense dashboard templates | The philosophical cousin: an opinionated default beats a blank canvas. Already embodied; noted as validation | Steal (already done) |

---

## 3. Synthesis

### 3.1 Five patterns to steal that would most improve this page

1. Four-exit triage semantics on the Attention Queue (Linear #23, PagerDuty #31, GitHub #37). Today the queue has one exit: a mouse-only x whose meaning (seen? handled? wrong?) is undefined, plus TTL resurrection the user never sees. Give every item exactly four single-key exits: act (open the linked surface), done (logged, reviewable), snooze (timer plus early return if the underlying fact changes, per Linear), mute (kill this feeder+symbol pair). This is the single highest-leverage change: it converts the queue from a report into a workflow with a defined end state, which is what "within 30 seconds knows the single most valuable next action" actually requires.

2. Decompose the fused priority score on the row face (PagerDuty #30). Audit finding #4 shows the geometric blend compressing all signals into 65-67: the number sorts fine but communicates nothing. Keep the blend for ordering; render impact, urgency, and confidence as three compact glyphs (or a 3-segment micro-bar) on each row, with the existing explain popover as the detail layer. PagerDuty proves practitioners under time pressure need the components, not the composite, to decide what to touch first.

3. Visible provenance chips on AI prose (Fintool #15, Tegus #20). The grounding pipeline already verifies facts server-side and falls back deterministically; none of that rigor is visible. Make every number in the brief a chip that resolves to the engine value, its asOf stamp, and its source (the same contract data the tape tiles already carry). This also directly attacks audit findings #1 and #2 (two return systems, three collections narrated as one): a number that must name its engine cannot silently be a different number than the card beside it.

4. Morning note discipline on the brief (sell-side format #1, #2, #4, #5). Enforce the fixed skeleton: one judgment headline (already close), one "why it matters" sentence, one watch item, one action, and a falsifier line on the recommended action ("wrong if SPY breadth rolls over"). On quiet days, the brief must be allowed to say "nothing material since Friday's close" and shrink. Fixed structure plus honest null states is what makes a daily read scannable in seconds by day 30.

5. Commitment cap above the fold (Things 3 #33, Addepar #11). Codify what the layout already gestures at: at most one Next Best Step plus 5 to 7 queue rows visible, everything else behind the overflow, with the score floor tuned to hold that budget. Pair with the Addepar test as a design gate for any future module: if a number on this page does not change a decision this morning, it moves off this page.

### 3.2 Three patterns to deliberately reject

1. Ambient animation and count-up theatrics (#45). The page already ships `use-count-up.ts`. On a surface whose entire job is to report what changed, motion that plays on every load is a false positive for change: it spends the user's 30-second attention budget on decoration and dulls their response to real deltas. Rule: motion only when data actually arrives (the brief stream replacing the fallback is the one legitimate animation on this page).

2. Unranked or infinite feeds (#44). Atom's Hub feeds and every news widget in Koyfin/YCharts show the failure mode: a reverse-chronological stream next to a ranked queue teaches the user that the ranking is optional and reopens the scan-everything tax the queue exists to eliminate. Rule for this page: an item is either scored into the Attention Queue or it is absent; there is no third surface for "stuff, newest first."

3. Engagement and delight mechanics (#29). Superhuman's Inbox Zero photography, streaks, celebratory confetti: all optimize time-in-product and return frequency. This product's success metric is the inverse: the user opens the page once, knows what changed, what it means, and what to do, and leaves. The correct empty-queue state is one quiet line ("Queue clear. Next scheduled check: market open, 9:30 ET") and the correct reward for a good morning read is that it ended.

### 3.3 One-line verdict on the current page

The architecture already matches the best prior art (Addepar's attention-pointer home, Bloomberg's monitor/brief separation, Things 3's capped Today, an opinionated non-customizable layout). What it is missing is the interaction and trust layer the queue-native tools consider table stakes: keyboard triage with defined exits, decomposed scores, and provenance the user can see instead of take on faith.

---

## Appendix: sources consulted

- Bloomberg: Terminal Essentials (Launchpad, News and Research), Launchpad user guide PDF, First Word FX press release and Traders Magazine coverage, "Five Things You Need to Know to Start Your Day" newsletter.
- Koyfin: Custom Dashboards and Market Dashboards feature pages, Help (My Dashboards, groups), v3.87 release notes (Home with pinned favorites).
- Addepar: Dashboards fact sheet, Sept 2024 launch PR, View Capital client spotlight, client portal quick-start guide, WealthManagement.com coverage.
- YCharts: Knowledge base (Dashboards Overview, module list including AI market commentary), Dashboard blog post, Advisors solution page.
- Fintool: API docs (introduction, /v1/search citation building), best-practices guide (citation handling, streaming/thinking states).
- AlphaSense/Sentieo: Help center (Maximizing Monitoring Tools; Save Searches and Create Email Alerts with Executive Brief template tiers), platform and equity-research pages, G2 comparison.
- Atom Finance: TechCrunch launch coverage, Benzinga spotlight, MoneyCrashers and TraderHQ reviews (archival; product since wound down).
- Tegus (AlphaSense): Expert Transcript Library intro (transcript types, expert perspectives), Call Services portal help (project states, AI Interviewer), Expert Insights pages.
- Morning notes: published sell-side morning-note templates and skill definitions (top call, overnight one-liners with takes, key events, trade idea + risk, 1-page/2-minute budget, "no news is a valid note"), JPM Eye on the Market issues (origin as text-only email, single-thesis chart-led structure), Goldman Top of Mind issues (question-framed, multi-viewpoint).
- Linear: Inbox docs, Triage docs, 2021 snooze changelog (early return on activity), Descript internal guide (J/K, E, Shift+H norms).
- Superhuman: "3 principles of designing for flow" blog, Split Inbox blog, design-lead interview (three visible buttons, Cmd+K), Acquired/SED interviews.
- PagerDuty: Incidents docs (triggered/acknowledged/resolved; priority vs urgency vs severity), Edit Incidents (snooze rules), Escalation Policy basics, Notification Urgency, Incident Priority.
- Things 3 (Cultured Code): features page (Today, This Evening, Jump Start), practitioner IA breakdowns and guides (commitment-only Today, When vs Deadline, color-for-meaning).
- GitHub Docs: Managing notifications from your inbox (Done/Saved/Unread/Unsubscribe), inbox filters, triage workflow tutorial.
- TradingView watchlist detail pane (product UI); Notion Home My Tasks help and third-party guides (cross-database aggregation, inline edit).
