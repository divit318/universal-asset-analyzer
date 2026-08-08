# REPORT: the Today dashboard audit and rebuild

2026-08-08. Fourteen audits, one synthesis, six implementation waves, one visual pass. Commits `11b709c` (wave 1) through `7b3f69d` (phase 5), each independently reviewable; the full evidence trail is the rest of this directory.

## What was broken, and why it mattered

1. **The page contradicted itself.** Cash was 33% in one card and 32.9% in the next (inside one queue row, both at once). Top contributors summed to 65 bps under a day P&L of 116 bps, with a real denominator bug (whole-book previous close vs the live-quoted base the percentage used) accounting for 38 bps of the gap, not just truncation. The health decomposition missed its own headline. "Extreme Greed" sat beside "Normal volatility", two unshared threshold tables reading one VIX quote. The brief said "Actions 1" above a CTA that landed on "19 open". A research terminal that cannot reconcile itself forfeits the only thing it sells: trust in its numbers.

2. **It said everything twice and the decision last.** The cash concentration story appeared up to ten times. The Radar and the queue rendered the same five scanner signals as two surfaces, and clearing one left the other shouting. The largest text on the page was a model-written restatement of two stats visible directly above and below it, while the only executable decision sat at 62% of page height, ranked below an informationless threat restatement of itself.

3. **It was slow in the one way that matters.** FCP was 200 ms of skeletons; meaning arrived after an 8-to-9-second engine rebuild on every load, and each load ran that build three times in parallel (digest, IOS context, brief route).

4. **Its errors lied.** A failed digest rendered a checkmark reading "Nothing needs your attention", "ACTIONS 0", and "Watchlist: 0 buys": fabricated all-clears on a dead page.

5. **The AI was fed too little to say anything.** Six numbers in, eighteen sentences demanded out: the note sections were structurally forced to pad and restate, only the headline was grounding-checked, a macro section existed with zero macro facts behind it, and one generated section was rendered by nothing.

## What changed

- **Foundation (wave 1).** A typed fact layer (`lib/home/facts.ts`): every cross-surface fact carries value, unit, one display precision, window, as-of, and source; components format through it and never re-round. A reconciliation harness runs the invariants (attribution sums to the total, decompositions sum to their headlines, counters match collections, benchmark sides share a window, one VIX interpretation) in CI and on every dev build. One market-session clock. Every named numerical defect fixed at its source, with a visible "Everything else" residual so the attribution reaches its own total by construction.
- **Structure (wave 2).** The layout is now the ritual: state (the Book as a full-width strip), delta (Since Last Visit, owning the one AI sentence), queue (full width, signals removed, the action absorbing its threat twin via cross-kind story collapse), context (Radar as sole owner of ideas; the tape collapsed to its index strip). The hero brief and long read are retired in place, one line each to restore. Priority renders as bands (Act now / Today / This week / FYI); the uncalibrated number lives in the click-through decomposition.
- **Agency (wave 3).** Log-to-journal from the spotlight, snooze until a date or the event, done with material-worsening resurfacing, per-symbol mute, TTLs stated in every toast, undo on all of it, and full keyboard triage (j/k/enter/d/s/e) with a visible legend.
- **Intelligence (wave 4).** The prompt now carries the reconciled attribution, cash, coverage, the top measured threat, and the data's age; it demands interpretation and forbids restating; the note is grounded separately from the headline and dropped alone when weak; cached prose re-verifies its whole text against current facts; the macro section and the unused generated summary are gone (wire schema v2).
- **Performance and states (wave 5).** The report, the mission context, and the digest became platform datasets with TTL + SWR and mutation-driven invalidation: one engine build shared by every consumer, warm loads in tens of milliseconds, and a morning open that paints the last known state instantly (honestly stamped) while rebuilding behind it. Payload down 80 KB to 38 KB. Error states stopped fabricating zeros.
- **Instrumentation (wave 6).** A local-first event ledger (SQLite, 180-day sweep), a batched beacon hook, emitters for act/suppress/undo/log/expand/visit, and a calibration read view producing acted-rates per score decile: the ground truth the priority model never had.
- **Visual (phase 5).** DESIGN.md binds the existing token system; charts survive greyscale (dashed benchmark, terminal dots, named windows); the failing contrast tier left the delta band; the count-up animation is deleted (the one removal); the signature element is the reconciled attribution bar: the place the page proves its arithmetic on sight.

## What measurably improved

See VERIFICATION.md for the full tables. Headlines: time-to-meaning ~9 s to under 0.5 s warm; three engine builds per load to one; brief-with-cached-prose 8.5 s to ~50 ms; payload 80 to 38 KB; first executable decision from ~62% of page height to inside the first viewport; zero reconciliation violations on live builds; 2986 tests green including the new harness, story-collapse, telemetry, and agency suites; dashboard-scope lint fully clean for the first time.

## What I chose not to do

- **No per-module React error boundary** (CH-22): the three fabricated-zero branches were fixed directly and every module now has an explicit error state; a page-level boundary redesign was judged out of proportion to the residual risk this session.
- **No client-side digest schema validation** (CH-19/20): the payload is produced and consumed by the same codebase in a local-first app; a zod parse of 38 KB on every load buys little here. Documented as deferred, not rejected.
- **No adjustable score weights** (AG-08): exposing exponent sliders before telemetry can calibrate them would be false control. The bands re-anchor against measured action rates once events accrue.
- **No threshold editing on the page** (AG-07): alert thresholds belong to the watchlist that owns them; a second editor here recreates the duplication this rebuild removed.
- **The tape's declared 60 s poll stays unwired** (PF-05): with the digest now served in milliseconds and refresh-on-demand everywhere, a background poll is spend without a demonstrated need.
- **No dependency additions anywhere.** Everything shipped on the existing platform, SQLite, and SVG primitives. The alternative rejected most often was "add a library" (command-palette kit, charting lib, analytics SDK); each time the in-repo seam was sufficient and smaller.

## What I would do next

1. Wire the calibration loop end to end: a small `/dev` view over `computeQueueCalibration`, then re-anchor the priority bands (and possibly the exponents) against a few weeks of acted-vs-suppressed data.
2. Finish the accessibility sweep: svg aria pass, metric-group semantics for screen readers, and the last information-bearing 10 px text.
3. Real token streaming for the brief (the NDJSON framing is ready; the model call still buffers), and a `from=today` receiving-side affordance so Research can offer "back to your queue".
4. Delete the now-dead `_viz` files and the retired modules once a release cycle confirms nothing resurrects them.
5. A holiday-aware market calendar for the session clock (weekends are handled; NYSE holidays currently read as ordinary closed days).

## The three riskiest assumptions

1. **Cross-kind story collapse assumes the subject slug is a reliable join.** The concentration threat and its trim action are matched on a normalized subject string. A renamed holding or a differently-worded engine title silently un-merges them (the pair then shows twice, ranked apart). The harness cannot catch this class; only telemetry or a user will.
2. **45 s TTL + 30 min SWR on the digest assumes stale-then-refresh is always acceptable on this page.** The payload is honestly stamped and mutations invalidate, but a user who acts within seconds of an external change (a fill elsewhere, a price shock) is briefly deciding on old numbers without a strong visual cue that a rebuild is in flight.
3. **Demoting the AI to one sentence assumes users came for the numbers, not the prose.** There was zero usage data when the hero was retired (that was the point of wave 6). If the morning note was the actual daily ritual for this user, the rebuild moved it two clicks away; the telemetry (`brief_note_expanded`) is what will confirm or refute this within weeks.
