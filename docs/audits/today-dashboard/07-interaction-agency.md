# 07. Interaction and Agency: the Today dashboard (`/`)

Method: for each of ten user capabilities, establish whether it exists (file:line evidence), what exactly happens when used (persistence, undo, TTL, resurfacing), and where it is missing, design it concretely enough to build. Evidence: code cites below, the live keyboard/focus probe (`/tmp/keyboard-report.json`, 40 tab stops captured, `cmdK opens palette: true`), and the architecture map (`00-architecture-map.md`).

The one-sentence verdict: the dashboard has exactly ONE first-class verb (dismiss, with a real undo) plus navigation. Everything else the queue implies the user can do - snooze, mute, mark done, tune thresholds, tune ranking, log the decision - either does not exist or lives on another page with no path from here.

---

## 1. Capability-by-capability

### 1.1 Dismissing an item, and undo

**Exists, and it is the best-built interaction on the page.**

- Client: `app/_home/modules/attention-queue.tsx:498-563` (`dismiss` callback). Optimistic: the row animates out (`EXIT_MS = 150`, :61), is added to a `pending` set (:514), focus moves to the row that slides into the slot or to the clear-state heading (:516-520). The POST failure path rolls the row back and toasts "Couldn't dismiss - it's back in your queue" (:532-540), including the race where the failure lands before the exit animation finishes (`failed` flag, :503, :513).
- API: `app/api/home/attention/dismiss/route.ts:21-40` (POST) validates `dedupeKey` and `kind`, computes expiry via `dismissalExpiresAt` (`lib/home/attention.ts:341-351`), and persists via `dismissAttention` (`lib/db.ts:3077-3085`, upsert into `attention_dismissal`).
- Storage: `attention_dismissal (dedupe_key PRIMARY KEY, dismissed_at, expires_at)` (`lib/db.ts:342-347`). Expired rows are purged inside `listActiveDismissals` on every digest build (`lib/db.ts:3097-3100`).
- **TTLs** (`KIND_TTL_MS`, `lib/home/attention.ts:60-66`):

| Kind | TTL | Note |
|---|---|---|
| threat | 7 days | re-raises a still-standing risk weekly |
| event | 30 days ceiling, but real expiry = the catalyst time | `dismissalExpiresAt` (:346-349) stamps `expires_at` to the event date itself, so a dismissed earnings item lapses when earnings happen |
| action | 3 days | short by design; the engine re-scores continuously |
| signal | 30 days | "a scanner idea you passed on stays passed for a while" |
| alert | 7 days | same rhythm as threats |

- **The section 12 dedupe-key band resurfacing**: the dismissal suppresses a *story identity*, not a topic. Dedupe keys embed a coarse magnitude band: threats carry a 5-point `magnitudeBand` of `impactPct` (`attention.ts:160-164, 234-239`), actions and signals carry a 10-point `scoreBand` of the decision/combined score (:166-169, :204-208, :317). A materially worse (or better) version of the same story lands in a different band, gets a NEW dedupe key, and bypasses the dismissal immediately, TTL notwithstanding (schema comment, `lib/db.ts:338-341`). So "dismiss" means "quiet this story at roughly this severity", which is the right semantic - but nothing in the UI tells the user any of this. The X button has no tooltip explaining "hides for 3 days, returns sooner if it worsens".
- **Undo exists**: 10-second toast window (`UNDO_MS = 10_000`, :60; toast at :543-560) that fires DELETE `/api/home/attention/dismiss` (route.ts:42-54 -> `undismissAttention`, `lib/db.ts:3088-3090`) and removes the key from the `pending` set so the row reappears without a refetch. Edge gap: the undo fetch's failure is swallowed (`.catch(() => {})`, :552) - the row reappears client-side but the dismissal row may still exist server-side, so it vanishes again on the next digest build.
- **After the 10 seconds there is no path back.** There is no "dismissed items" view anywhere in the app, and because `listActiveDismissals` deletes expired rows and `undismissAttention` deletes on undo, the table is a live suppression set, not a history. A mis-dismissed 7-day threat is invisible for a week with no recourse.

### 1.2 Snoozing until a condition

**Does not exist.** No snooze affordance in `attention-queue.tsx`, no snooze path in the dismiss route, no snooze/mute logic anywhere in `app/_home/` or `lib/home/` (grep for `snooze|mute` across app and lib returns only CSS `text-muted` classes). The per-kind TTL is an implicit, fixed, invisible snooze the user cannot choose.

**Design.** Snooze is a dismissal with a user-chosen expiry, so 90% of it already exists:

- Interaction: long-press or a small chevron beside the X opens a menu on each row: "Until tomorrow", "Until next week", "Until earnings" (only when `digest.calendar` has a dated event for `item.symbol`), "Until price..." (only for symbol rows). Keyboard: `s` on the focused row opens the same menu.
- API: extend the POST body: `{ dedupeKey, kind, occursAt, snooze?: { until?: string; condition?: { type: "price_above" | "price_below"; symbol: string; value: number } } }`. Time snoozes just override `expiresAt` (one line in route.ts:32). Condition snoozes need a new column.
- Storage: add `condition_json TEXT` to `attention_dismissal`. `listActiveDismissals` returns condition rows too; the digest build (which already holds fresh quotes) evaluates the condition and treats a met condition as expired. This reuses the exact evaluation moment the alert engine uses (`lib/alerts.ts` is fed by `/api/monitor/run`).
- Edge cases: (a) a price-condition snooze on a story whose dedupe key rotates (band change) dies with the key - correct, a materially different story should resurface; (b) "until earnings" must store the resolved ISO date at snooze time, not re-look-up, or a moved earnings date silently extends the snooze; (c) cap condition snoozes at 90 days so a never-met price does not suppress forever.

### 1.3 Muting a signal class

**Does not exist.** There is no per-symbol or per-kind permanent suppression. Dismissing `signal:SCHW:70` silences SCHW for 30 days at that score band only; a re-scored SCHW (band 60 or 80) returns immediately (`attention.ts:317`). The kind filter chips (:634-650) are a *view* filter - client-side `useState` (:450), resets on reload, hides nothing from the count.

**Design.**

- Interaction: in the row's overflow menu (with snooze): "Mute SCHW signals", "Mute all fit signals". Managed (and reversible) from a "Muted" section - the natural home is the queue header's filter popover, with a `/settings` mirror.
- API: `POST /api/home/attention/mute` with `{ scope: "symbol" | "kind" | "symbol+kind", symbol?, kind? }`, DELETE to unmute.
- Storage: new table `attention_mute (id, scope, symbol, kind, created_at)`. Applied in `buildAttentionQueue` as a second filter beside dismissals (`attention.ts:389-393`), matching on seed `symbol`/`kind` rather than dedupe key so it survives band rotation - that durability is exactly what distinguishes mute from dismiss.
- Edge cases: (a) muting kind `threat` would hide portfolio-risk items entirely; require a confirm and surface a persistent "1 mute active" chip in the queue header so the clean queue is never silently a filtered queue; (b) `openCount` must state "19 open, 4 muted" or the section 4.2 "zero is reachable" promise becomes a lie.

### 1.4 Marking done and having it stay done

**Does not exist as a distinct verb; the semantics differ by how the item was generated, and the user is never told which case they are in.**

- If the user actually executes "Trim USD Cash" (in their brokerage, outside the app), the item stays gone WITHOUT any interaction: action items are regenerated per digest build from the live report (`buildRecommendedActions`, feeder at `attention.ts:201-225`), so once the lot data reflects the trim and the cash engine stops proposing it, the seed is never produced. Done-ness is inferred from portfolio state. This is genuinely good - but only for state-derived items, and only after the user re-syncs lots.
- If the user dismisses instead of acting, the same item returns in 3 days (`KIND_TTL_MS.action`), and sooner if the decision score crosses a 10-point band. There is no way to say "I did this" versus "stop nagging me".
- The hero's "Dismiss" button is worse: pure `useState(false)` (`todays-brief.tsx:139`, button :398-404), resets on every reload. Already flagged in 03 (#22): the affordance lies about its effect.
- The real gap: acting on a recommendation and marking it done should be the same gesture as logging it to the journal (see 1.7). "Done" without a record is a wasted signal.

**Design**: a "Did this" action on action-kind rows that (a) writes a journal decision pre-filled from the item (see 1.7), (b) writes a dismissal with a longer TTL (14 days) tagged `reason: "done"` (add a `reason TEXT` column to `attention_dismissal`), and (c) if the engine re-proposes the same story after re-sync, renders it with a "you marked this done on Aug 5, but the book still shows 33% cash" annotation instead of a bare repeat. That annotation is the honest behavior: the engine cannot verify an external trade, so it should say what it sees rather than either nagging or staying silent.

### 1.5 Setting or adjusting alert thresholds

**Not from this page.** Thresholds live per watchlist row: `target_price`, `target_direction`, `alert_pct_drop` columns (`lib/db.ts:54-55, 565, 711`), evaluated by the pure engine `lib/alerts.ts` (thresholds doc at :1-13, drop threshold at :49-50) on the `/api/monitor/run` schedule, delivered as notifications and as queue `alert` seeds. They are set and edited only on `/watchlist`.

From the dashboard, a fired alert row's primary action goes to `/research?symbol=X` (`attention.ts:273`) - not even to the watchlist row that owns the tripwire. So the loop "this alert is too chatty -> loosen it" takes: dashboard -> research -> navigate manually to watchlist -> find row -> edit. Threat thresholds (concentration %, drawdown) are code constants in the portfolio engines and `lib/home/threats.ts`; not user-adjustable anywhere, which is defensible for v1 risk semantics but should be stated in the threat's explain popover.

**Design** (smallest honest version): the explain popover on alert rows (`ExplainableValue`, queue row :405) gains a footer line "Your rule: drop of 5% or more. Edit rule ->" linking to `/watchlist?symbol=X&edit=alerts`. No new API: the watchlist edit surface exists; this is a deep link plus a query param the watchlist page handles by opening the row editor.

### 1.6 Adjusting priority weighting of the queue score

**Does not exist, by explicit design.** `SCORE_EXPONENTS = { impact: 0.5, urgency: 0.3, confidence: 0.2 }` are named module constants (`lib/home/attention.ts:46`), pinned by tests, tunable only by editing code. Same for `KIND_CONFIDENCE_DEFAULT` (:69-75) and `KIND_PRECEDENCE` (:78-84).

**Assessment: keep it that way for now.** Audit 03 (finding on the 65-67 signal-score compression) already establishes that the score's cross-kind comparability is unvalidated; letting the user re-weight an uncalibrated model adds a knob that cannot be reasoned about. The prerequisite is instrumentation (see `13-instrumentation.md` IN-05: action rate by score decile). Once the score is shown to predict action, offer at most a single user-facing preference ("rank more by urgency / more by impact", a 3-position toggle mapping to two preset exponent sets stored in a `user_pref` row), never raw exponent editing. Until then, the explain popover (`explainAttentionScore`, `lib/home/explain.ts`) showing the decomposition is the right amount of agency.

### 1.7 Acting on a recommendation and recording it to the decision journal

**The journal exists and is good; the dashboard has zero capture affordance into it.**

- The journal: `/journal` page (`app/journal/page.tsx`, nav entry visible in the keyboard probe: "Decision JournalLog calls, measure your ..." at tab index 19). Full capture form via `POST /api/decisions` -> `createDecision` (`lib/db.ts:2335-2359`): symbol, action (buy/watch/hold/avoid/sell), conviction 1-5, thesis, price at decision, target, horizon, fit score/tier, valuation case version. Scoring engine `lib/decision-journal.ts` computes hit rate, calibration by conviction and by fit tier (:92-107).
- From the dashboard: queue action rows link to `/portfolio?tab=decisions` or `/research?symbol=X` (`lib/home/actions.ts:71-73`, seed at `attention.ts:218-221`); the spotlight's CTA is the same `primaryAction` link (`attention-queue.tsx:319-331`). No queue row, spotlight card, or brief CTA writes to or links to `/journal`. The keyboard probe confirms the rendered dashboard contains no journal-related control.
- The irony is that the spotlight card already displays every field a journal entry needs: symbol, direction, rationale, simulated impact, the engine's WHY memo (:266-316). The decision engine composes the exact thesis text; the user would have to retype it on `/journal`.

**Design** (the highest-value missing interaction on this page):

- Interaction: a secondary button on the spotlight and an entry in each action row's overflow menu: "Log decision". Opens a pre-filled inline popover (not a navigation): action mapped from the recommendation direction, thesis pre-filled from `item.rationale` + `decision.why.whyNow`, priceAt from the live quote the digest already carries, fitScore/fitTier from `symbolContext`. One click + optional conviction tweak = logged.
- API: the existing `POST /api/decisions` unchanged, plus one optional field `sourceRef: string` (the queue item's `dedupeKey`) so the journal can later report "decisions initiated from the queue" - the capture point audit 13 needs.
- On success: toast "Logged to journal", and write the same done-tagged dismissal as 1.4 - logging a decision IS marking it handled.
- Edge cases: (a) threat and event rows have no direction; offer only "note" capture or omit; (b) duplicate logging (same dedupeKey twice in a session) should update, not append.

### 1.8 Context-preserving navigation

**Weak in both directions.**

- Outbound: every symbol-bearing `primaryAction` is `/research?symbol=X` (`attention.ts:273, 326`; `actions.ts:71-72`). The destination receives the symbol and nothing else: not the kind, not the rationale, not the score, not "you came from a fired drop alert". The research page cannot show "you're here because SCHW fit 79" and the user must hold the reason in their head. The `symbolContext` join that enriches queue rows (held weight, stage, research recency, `attention-queue.tsx:176-183`) is not mirrored on arrival.
- Return: no back-to-queue continuity. Navigation is a full route change; on return the digest may have rebuilt, the queue re-sorted, filter and expansion state reset (`useState`, :450-452), and scroll position lost. Working the queue top-to-bottom via primary actions means re-finding your place every time.

**Design.**

- Outbound: append `&via=attention&ref=<dedupeKey>` to `primaryAction.href` at seed build time. The research page reads `via`/`ref`, fetches nothing new (the digest endpoint already serializes the queue), and renders a one-line dismissible banner: the item's headline + rationale + "Back to queue". Cheap, honest, and it doubles as the click-through instrumentation join key (13, IN-02).
- Return: "Back to queue" returns to `/#action-center` (the anchor exists, :610) and the queue restores the roving cursor to the ref'd item if it is still present, else to its former index. Keep filter/expanded state in `sessionStorage` keyed by day so a same-session return is seamless but tomorrow starts clean.

### 1.9 Resuming interrupted work

**Exists as a chip; gives almost no context.** The brief renders `Resume: <ref>` from the newest activity row (`todays-brief.tsx:153-155, 379-388`; live probe shows `Resume: BTC-USD -> /research?symbol=BTC-USD`). Backed by the `activity` table, one row per (kind, ref), upserted so revisits bump `at` (`lib/db.ts:324-336`), written fire-and-forget by pages via `useRecordActivity` (`app/_home/use-record-activity.ts:19-35`, 1.5s debounce) and `POST /api/home/activity` (route validates same-origin hrefs, :49-55).

What it can honestly say: WHERE you last were (kind + ref + a label + href). What it cannot say: WHAT you were doing (no task state - no tab, scroll, draft note, half-configured screen), WHEN (the `at` timestamp ships in the digest, `lib/home/activity.ts:39`, but the chip does not render it), or WHY it might still matter (no join against changes: "you were researching BTC-USD and it moved -6% since"). The chip renders only `resume.ref` with the label demoted to a hover `title` (:382, :386). "Resume" therefore overpromises: it is "revisit", a bookmark to a page that will have forgotten the session.

**Design** (incremental): render recency inline ("Resume: BTC-USD, yesterday" - the data is already in the slice); join `ref` against `digest.changes` and `symbolContext` to append "changed since" when true; and only then invest in true resumability (pages persisting a small `state_json` in the activity row - the research page's active tab is the highest-value single field).

### 1.10 Keyboard operability

**The queue has a real listbox implementation; reaching it and learning it is the problem.**

What exists (code):
- Roving tabindex on rows: only the active row is tab-focusable (`tabIndex={active ? 0 : -1}`, `attention-queue.tsx:228, 366`), cursor clamped at render (:494).
- List-level handler (:575-603): ArrowDown/ArrowUp move focus, Enter opens `primaryAction` via `router.push`, Delete/Backspace dismisses, `f` cycles kind filters (only when `openCount > 5`).
- Focus after dismiss is managed (:516-520); focus-visible rings are styled throughout (:230, :368).

What the probe shows (`/tmp/keyboard-report.json`): 40 tab stops captured; the first 25 are the skip link, brand, and the full nav mega-menu; dashboard content starts at stop 26; the capture ends at "Filter by kind" (stop 39) before any queue row. All stops report a visible outline. `cmdK opens palette: true`.

Assessment against "driveable without a mouse":
- Reaching the queue costs 25+ Tab presses or the skip link plus more tabbing; there is no shortcut to jump to the queue (the hero's "Open Action Center" button at stop 27 scrolls but does not move focus into the list - `scrollToActions`, `todays-brief.tsx:374`).
- Inside a row, Tab still visits the score popover, the dismiss X, the primary link, merged links - fine - but Enter-on-row vs Enter-on-inner-control ambiguity exists once the user tabs within a row.
- No `j`/`k` (Arrow-only), no `d` (Delete/Backspace only - Backspace is risky: browsers with back-navigation-on-Backspace or a focused inner link can misfire), no `u` undo (undo is mouse-only via toast), no `e`/`s`/`m` for the verbs that do not exist yet. No keymap discoverability: nothing renders the shortcuts, no `?` overlay.
- No aria-activedescendant/listbox roles; `role="list"` (:688) is fine for now but the roving pattern would benefit from `aria-keyshortcuts` on documented keys.

**The command palette** (`app/_components/command-palette.tsx`): global CmdK/CtrlK toggle (:62-76), Escape closes, ArrowUp/Down + Enter select (:197-212). Commands: (1) live ticker search via `/api/search` (:93-114) with per-symbol verbs derived from `nav-config.ts` `symbolParam` - Research, Compare, Valuation, IC Report (:26-40) - plus "Add to watchlist" (:165-184, records idea provenance `source: "command-palette"`); (2) focus-symbol recents when the query is empty (:135); (3) "Go to" navigation for every tool in `ALL_TOOLS` (:117-123). It contains NO dashboard actions: no "dismiss current item", no "filter queue", no "log decision".

**Dashboard key map design** (keys chosen to avoid browser and palette conflicts; all single-key, no modifiers, inert while focus is in an input/textarea or the palette is open):

| Key | Action | Notes |
|---|---|---|
| `g` then `q` | focus the queue's active row from anywhere on the page | two-key chord avoids stealing a single letter globally |
| `j` / `k` | next / previous row | alias the existing ArrowDown/Up, muscle-memory standard |
| `Enter` | open primary action | exists (:583-588); add `&via=attention&ref=` per 1.8 |
| `o` | open primary action in the same tab; `Shift+o` new tab | Enter alias for vim users |
| `d` | dismiss | keep Delete as alias; DROP Backspace (misfire risk) |
| `u` | undo last dismiss | works while the 10s window is open; currently mouse-only |
| `s` | snooze menu (1.2) | conflicts with nothing; palette is modal so no clash |
| `m` | mute menu (1.3) | |
| `l` | log decision (1.7) | |
| `e` | expand/collapse spotlight WHY memo, or row detail | |
| `f` | cycle kind filter | exists (:595-600); remove the `openCount > 5` gate, it makes the key unreliable to learn |
| `?` | shortcut overlay | required for discoverability; also list CmdK |

Conflicts audited: CmdK is modifier-based, untouched. Single letters never fire with modifiers held (pass through for CmdD bookmark etc.). `/` is left unbound (palette owns search). Browser Find (Cmd/Ctrl+F) unaffected by bare `f`.

---

## 2. Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| AG-01 | Low | Dismiss + undo is well built: optimistic with rollback, per-kind TTL, band-based resurfacing, focus management. The model is sound; it is also the ONLY mutation on the page. | attention-queue.tsx:498-563; attention.ts:60-66, 160-169; db.ts:3077-3100 |
| AG-02 | Medium | Dismiss semantics are invisible: no tooltip or copy states the TTL or the "returns sooner if it worsens" band rule, so users cannot predict what the X does. | attention-queue.tsx:247-254, 413-420 (bare X, aria-label only) |
| AG-03 | Medium | No recovery after the 10s undo window: no dismissed-items view; undo-DELETE failure is swallowed so the row can silently re-vanish next build. | attention-queue.tsx:552; db.ts:3097-3100 (expired rows purged, no history) |
| AG-04 | High | No snooze-until-condition; the fixed TTL is an invisible snooze the user cannot choose. Design in 1.2 reuses the dismissal machinery almost entirely. | grep snooze/mute across app/ and lib/: no hits beyond CSS |
| AG-05 | High | No mute for a signal class or symbol; a passed-on idea returns whenever its score crosses a 10-pt band, forever. Kind filter is session-only view state. | attention.ts:317; attention-queue.tsx:450, 634-650 |
| AG-06 | High | No "mark done": acting outside the app clears an item only via portfolio re-sync; dismissing instead brings it back in 3 days. No way to distinguish "did it" from "stop showing me". Hero Dismiss is session-only useState and resets on reload. | attention.ts:63, 201-225; todays-brief.tsx:139, 398-404 |
| AG-07 | Medium | Alert thresholds are set on /watchlist only; the fired alert's queue row links to /research, not to the rule that fired, so tuning a noisy tripwire is a 4-hop journey. | db.ts:54-55; alerts.ts:1-13; attention.ts:273 |
| AG-08 | Low (correct for now) | Queue ranking weights are code constants with no user control. Right call until the score is calibrated (13, IN-05); the explain popover is the appropriate agency today. | attention.ts:46; explain.ts via attention-queue.tsx:242, 405 |
| AG-09 | High | The decision journal exists with calibration analytics, but the dashboard - the surface that proposes decisions, with the WHY memo rendered on screen - has no capture affordance into it. The user must retype on /journal. | app/journal/page.tsx; lib/decision-journal.ts:92-107; actions.ts:71-73; attention-queue.tsx:296-331 |
| AG-10 | Medium | Navigation drops context both ways: /research?symbol=X carries no reason-for-visit; returning loses queue position, filter, and expansion state. | attention.ts:273, 326; attention-queue.tsx:450-453 |
| AG-11 | Medium | "Resume: SYMBOL" is a bookmark, not a resume: no when, no what-you-were-doing, no changed-since join, despite the timestamp already shipping in the digest slice. | todays-brief.tsx:379-388; lib/home/activity.ts:39; db.ts:324-336 |
| AG-12 | Medium | Keyboard: the queue's listbox works (arrows, Enter, Delete, f) but is unreachable in fewer than ~26 tab stops, has no j/k/d/u, no jump-to-queue chord, no `?` overlay, and Backspace-as-dismiss is misfire-prone. Undo is mouse-only. | attention-queue.tsx:575-603; /tmp/keyboard-report.json (40 stops, queue content from stop 26) |
| AG-13 | Low | The CmdK palette is solid for navigation and symbol verbs but carries zero dashboard verbs; once 1.2/1.3/1.7 exist they should be palette commands too. | command-palette.tsx:26-40, 117-123, 165-184 |

Priority order for the parent agent: AG-09 (journal capture - closes the product's own feedback loop), AG-06 (done semantics), AG-04/AG-05 (snooze/mute - one storage change covers both), AG-12 (keymap), AG-02/AG-03 (dismiss transparency), AG-10, AG-11, AG-07.
