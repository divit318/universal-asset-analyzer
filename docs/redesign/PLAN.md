# UAA Redesign — Implementation Plan & Session Handoff

> Status: **ABANDONED — 2026-08-02, owner decision.** The direction had drifted
> too close to Bloomberg's visual language and was reverted mid-Phase-4a. The
> entire implementation (Phases 1–3 complete, 4a partial) is preserved on the
> `redesign-terminal-archive` git branch; the working tree was restored to the
> pre-redesign visual shell while keeping all non-visual work (brand system,
> AI platform, engine, backend improvements). Do NOT implement from this file
> or from SPEC.md. Kept as a design-history record only.
> Last updated: 2026-08-02
>
> ~~If you are an agent starting a fresh session: execute the next incomplete phase.~~
> **No further phases will be executed.** See the abandonment note above.

---

## 1. What this is

A complete visual and interaction transformation of UAA into the approved
"research terminal" concept — command-first, editorial, decision-driven — executed in
phases with zero loss of functionality, zero loss of information density, and zero
performance regressions.

### Sources of truth, in order of authority

1. **`docs/brand-preview/terminal/SPEC.md`** — the design bible. Every page, layout,
   motion, keyboard, state, and signature moment. If a phase deviates from SPEC.md
   without a logged decision in §7, that is a bug.
2. **`docs/brand-preview/spec-demo/index.html`** — the approved interactive prototype.
   This is the skeleton of the final product: the shipped app must look and behave like
   this sample, with real data replacing canned data. Open it via
   `python3 -m http.server 4173 --directory docs/brand-preview` → `/spec-demo/`.
   Its "WHAT A SAMPLE CAN'T SHOW" tab lists exactly what the real build adds.
3. **`docs/brand-preview/terminal/index.html`** — static layout reference + design notes.
4. `docs/brand-guidelines.md` — brand book v1 ("Instrument of Record"). **Partially
   superseded**: its voice rules and process survive; its brass/serif visual system does
   not. Do not implement anything visual from it.
5. `docs/brand-preview/{index.html, working/, engines/}` — earlier explorations,
   superseded, kept for the record. Never implement from these.

---

## 2. Invariants (the owner's "never lose" list — verbatim intent, enforced every phase)

1. **Information density is sacred.** Every converted page must show equal or MORE
   information per viewport than the page it replaces. QA counts fields; nobody guesses.
2. **Features integrate; they don't get isolated pages.** If a capability can live
   inside an existing flow, it must.
3. **The journal/timeline experience stays** — it makes the AI feel alive and transparent
   (Run page log, decision history, streaming with visible self-correction).
4. **Useful subheadings and contextual metadata stay** (session blocks, cache ages,
   provenance lines, findings columns).
5. **Hover-for-context stays and generalizes** — the margin answers (source, age, method,
   last opened, previews) instead of tooltips.
6. **The blinking block caret and terminal-like interactions stay** — they are the
   personality.
7. **Editorial research-terminal feel, never dashboard cards.** No cards, no card grids,
   no KPI tiles — rules, whitespace, and type hierarchy only.
8. **Amber means exactly one thing: a decision is open.** Green/red belong to the market.
   No blue chrome. No other accent, ever.
9. **One big number per page (76px), never two.**
10. **The product must never get slower.** Performance is a feature (see §3).

## 3. Performance budgets (hard requirements)

Baseline is recorded in Phase 0 (§4) and written into §6. Every phase re-measures and
must meet:

- Route JS bundle: no growth beyond +5% per phase without a logged decision in §7.
- LCP / TTI on the five heaviest pages: never worse than baseline.
- All animation via `transform`/`opacity` only; durations 120/240/420ms with
  `cubic-bezier(.32,.72,0,1)`; no blocking animations; respect `prefers-reduced-motion`.
- No re-render storms: typing in the command line re-renders the line only; live prices
  update cells, not tables.
- Screener/tables: virtualize when rows exceed ~100; FLIP re-rank must hold 60fps at the
  full universe (~400 rows) — this is Phase 4b's explicit gate.
- Margin annotations are O(1) from data already on the client. No fetch on hover.
- Lazy-load below-the-fold and per-route (charts, IC document body, run streams).
- **Measure after every phase.** "It feels fine" is not a measurement.

## 4. Phases

Every phase ends with the same five-part gate, and no phase starts until the previous
one passed all five:

```
GATE: npx tsc --noEmit          (silent)
      npx vitest run            (all pass; 1,426 as of 2026-07-27 — count may grow)
      npx eslint app lib        (only the two known pre-existing issues: see AGENTS.md)
      npm run build             (tsc alone is NOT proof a page renders — build or load it)
      Manual QA of every affected workflow + performance vs Phase 0 baseline
      Then: update §6, commit. One commit chain per phase → rollback is one revert.
```

### Phase 0 — Baseline & guardrails  *(no visual change)*
- [x] Write this file; add pointer in AGENTS.md.
- [x] Record performance baseline into §6: production build time; per-route bundle sizes
      (`npm run build` output); LCP/TTI for `/`, `/research`, `/screener`, `/portfolio`,
      `/ic-report` (real page loads, dev machine, noted conditions); screener scroll FPS
      at full universe; heap after 30-min simulated session.
- [x] Decide and log (§7): light theme handling. Recommendation: dark-only during the
      transformation; re-derive light from the token layer in Phase 7. The current
      `data-theme` mechanism stays intact either way.

### Phase 1 — Tokens & primitives  *(foundation; nothing visible changes yet)*
- New token layer in `app/globals.css` per SPEC.md Part I: bg `#101113`; ink/mut/dim
  `#E9EBEE/#9AA1AB/#5E646D`; rules `#3C4048/#2B2E34`; amber `#E2A336`; market
  `#4BD587/#F0716B`; radius 0; motion tokens; the gapped type scale (76/30/21/16.5/13.5/
  12.5/12/10 with tracking specs).
- Build unused primitives beside existing UI (do not replace anything yet): Rule,
  FigRow, DecisionLine, open-table styles, settle-number, margin-note host, the amber
  left-edge focus tick. CSS-only wherever possible.
- Existing pages still render on old tokens — keep both layers until Phase 4 retires the
  old one. Regression risk here should be near zero; that's the point.

### Phase 2 — Global chrome & IA  *(highest-risk phase; QA hardest)*
- Command line (37px) + function row (31px) replace the sidebar/site-header per SPEC.md
  Part II: brand block, hint line with block caret, session status (Ollama state copy:
  `OLLAMA DOWN · PROSE PAUSED · NUMBERS FINE`), autocomplete-as-column, responses in
  document flow (kill all toasts).
- Grammar v1: ticker → research; multi-ticker → compare; screen expressions; `g` +
  letter navigation; `Esc` discipline; `?` reference card; `j/k` row focus.
- Every existing route must remain reachable; deep links intact; keyboard-only pass.
- Perf: zero CLS from chrome; keystrokes re-render the line only.

### Phase 3 — The decision line + The Desk
- DecisionLine on every page (strong rule above, hairline below, amber/dim tag, one
  sentence, one action); docking marker `◆ 1 OPEN` / `◇ CLEAR` in the command bar.
- The Desk as opening screen: docket with decisions aging by typographic weight (2 days
  normal → 2 weeks bold lead → 6 weeks larger number + `OPEN N WEEKS`), OVERNIGHT wire,
  compressed book figure row, the empty-state sentence (verbatim from SPEC.md).
- Journal wiring underneath (lib/db.ts): decisions as first-class records — open,
  decided, deferred(date), retired. No visual flourishes in this phase; it's the logic
  phase.

### Phase 4 — Page conversions (four sub-phases, each shipped + gated separately)
Rule: a page converts completely or not at all; no half-converted pages. Each conversion
includes its page's copy rewrite per SPEC.md voice, and a density field-count vs the old
page recorded in §6.
- **4a Research** — masthead, decision line, standfirst (daily, frozen, analyst-written),
  figure row, 7:3.2:2.8 columns (chart with journal lines drawn on it · readings with
  dissent clause · wire with judgments), analyst note with grounding attribution,
  conviction as the 76px number.
- **4b Screener** — query line with inline-editable clauses, binding-clause auto-amber
  with stated cost, open table with WORTH KNOWING findings column, FLIP re-rank with
  departure-to-rule grammar, why-empty diagnosis with one-click counterfactuals.
  **Hard gate: 60fps re-rank at full universe; virtualize if needed.**
- **4c Portfolio + Watchlist** — figure row; REQUIRES A DECISION docket (policy copy
  quotes the user's own rules with dates); holdings open table with STANDING prose and
  `no basis` cells; trim sheet (weights drag, policy sentence counts down, amber drains
  at compliance, rule redraws, files to journal). Watchlist: WHAT YOU SAID · WHAT'S TRUE
  NOW column; rows ordered by need; retire-a-note strikethrough → journal.
- **4d Compare + IC Report + Run** — compare matrix (verdict row first, best-value ticks,
  analyst reading that takes positions); IC document (margin TOC, stance/conf on the
  heading rule, dissent inset carried into the verdict sentence); Run (timestamped log of
  findings, readable-when-filed sections, streaming prose, completion crossfade,
  pause/resume honesty).

### Phase 5 — The margin + the settle, system-wide
- Margin annotations on every figure/score/claim (300ms hold, row-height positioned,
  keyboard `?` on focused cell). One implementation, all pages.
- Settle animation wired to real data updates (≤3 intermediates, 180ms); departure by
  demotion everywhere; loading = em-dashes filling left-to-right (kill any remaining
  skeletons/spinners outside the boot splash, which stays).

### Phase 6 — Signature interactions  *(each independently skippable — never blocks)*
- Research price probe (drag, amber counterfactual, band-flip, Quant-withdraws line,
  release-settle). IC reading detection (honest thresholds) + export cover line. Run
  self-correction display (strike + replace + margin cite) wired to the grounding pass.
  Compare column physics (drag reorder, tear-away, type-into-stub).

### Phase 7 — Mobile, copy sweep, closing the book
- Mobile decision view per SPEC.md §9 (decide/defer/retire, swipe-to-defer).
- Full copy sweep against SPEC.md voice on every surface not already rewritten in
  Phase 4 (empty states, errors, boot messages, calendar/dcf/thematic/etc. pages that
  keep old layouts get the new voice regardless).
- Optional sounds behind a preference (pen-cap tick; end-of-run tone), off by default.
- Re-derive light theme from tokens (per §7 decision). Final end-to-end QA. Final perf
  table vs Phase 0 published in §6.

## 5. Session workflow (the token-problem protocol)

- **One phase (or sub-phase) per chat.** Opening prompt: *"Read docs/redesign/PLAN.md
  and docs/brand-preview/terminal/SPEC.md. Execute the next incomplete phase."*
- A phase is not done until its §6 entry says so — an undocumented phase didn't happen.
- Commit after every green gate. Never mix phases in one commit chain.
- If a session dies mid-phase: next session reads §6, finds the phase in progress, and
  finishes it before anything else.

## 6. Status log  *(append-only; newest on top)*

| Date | Phase | What shipped | Gate results | Perf vs baseline | Open items |
|---|---|---|---|---|---|
| 2026-08-02 | 3 (complete) | **Decisions as first-class records** — questions vs. answers (owner decision, §7): new `docket_item` table + CRUD in lib/db.ts (open → decided / deferred(date) / retired; deferral reopens lazily with age preserved; retirement is recorded, never deletion; `decision_id` column links a filed journal answer). Pure engine `lib/docket.ts`: `evaluateDocket` (v1 raisers: portfolio concentration vs lib/portfolio/policy.ts with all-or-nothing book pricing, watchlist notes at trigger quoting the user's note verbatim) + `planDocketSync` (refresh keeps age; 7-day re-raise cooldown after resolution; auto-retire ONLY conditions actually evaluated this pass — a network hiccup never closes a question) + `docketAge` bands (fresh/aging ≥2wk/old ≥6wk). Sync rides `runMonitor`'s existing quotes fetch (zero extra network); `/api/docket` GET/POST. **Chrome**: `◆ N OPEN`/`◇ CLEAR` marker at the command line's right end (click = back to the line, or the Desk); chrome-carried DecisionLine on every non-Desk page, scoped to route (symbol match → policy on /portfolio → watchlist on /watchlist → oldest); `d`/`f`/`r` row verbs via ROW_KEY_EVENT + `?` card updated. **The Desk replaces the module dashboard as the opening screen**: masthead + LAST SESSION block (from the change feed's baseline + recorded-decision timestamps), docket with typographic aging per SPEC (number 11→13px, lead 400→600→700, amber `OPEN N WEEKS`), decide-composer (one sentence files the record), defer ▸ +14d, retire; OVERNIGHT wire from the digest change feed (honest empty/first-visit states); compressed book figure row (value/today/◆ breaches/health · weakest); the verbatim empty-state sentence with the real last-closed weekday. 19 new unit tests (suite 1,695). | tsc silent · vitest 1,695 passed (+19, 119 files) · eslint: my files clean; same pre-existing issues elsewhere (AGENTS.md list) · build green (26/26; pre-existing valuation NFT-trace warning only) · live QA on :3100: all 17 routes 200 with chrome; full docket lifecycle exercised against the REAL book (monitor raised a genuine QQQM 54.2% breach; defer → re-defer → lazy reopen with age preserved → decide with sentence → cooldown held on next monitor pass; manual raise never auto-retired); QA rows deleted afterwards so the real breach re-raised fresh | Route JS (raw KB): / 775→693 (dashboard out, Desk in), /research 981→983, /screener 820→823, /portfolio 1246→1248, /ic-report 735→737 — all within budget. LCP medians warm: / 96, /research 100, /screener 152, /portfolio 100, /ic-report 84 (at or far better than baseline; a cold-start run right after `next start` read 308–532ms — server warm-up, not route weight). Decision-line CLS: strip height is reserved pre-fetch via a sessionStorage hint; only the first-ever load with an open decision shifts once. | app/_home/* + lib/home/registry/layout UI unmounted but on disk (digest engine still powers the Desk via /api/home) — fold into the Phase 2 cleanup pass. Decide-composer files the sentence to the docket only; wiring a full journal `decision` (action/conviction) through `decision_id` lands with Phase 4c/4d. `N DECISIONS RECORDED` counts an 8h window before the baseline froze — heuristic until real session records exist. Docket marker is persistent (no scroll-detach animation yet) — the detach/dock choreography lands when Phase 4 pages own their decision lines. |
| 2026-08-02 | 2 (complete) | Global chrome: command line (37px) + function row (31px, sliding ink underline) replace the site header and ⌘K palette (`app/_components/terminal/chrome.tsx`; ⌘K now focuses the line). Grammar v1 (`command-grammar.ts` + tests): ticker→research, multi→compare, operator→screen (via /api/screener/nl when Ollama is up, plain screener otherwise), page words, `wl SYM note`, `alerts`, `assistant`, `.` repeat. Keyboard: typing-focuses-line, Esc discipline, `g`+letter nav, `j/k` DOM-driven row focus (amber left tick, works on unconverted pages), `?` reference card. Session status with the spec's Ollama copy. **All toasts killed**: `useToast()` API kept, presentation is now response lines in document flow under the chrome (`toast.tsx` rewrite + `<ResponseLines/>`); the alert monitor poll moved from the bell into the chrome so alert evaluation never stopped, alerts print as sticky response lines + OS notification. Landing keeps its own chrome. | tsc silent · vitest 1,676 passed (+9 grammar) · eslint same 4 pre-existing · build green · QA: all 17 routes render with chrome + reachable (route loop), deep links intact, landing suppressed, keyboard-only pass (type→enter, g-nav, j/k, ?, Esc), focused controls keep their keys (Space/Enter guard), watchlist QA row deleted after test | Route JS SHRANK on all five pages (raw KB): / 791→775, /research 995→981, /screener 837→820, /portfolio 1261→1246, /ic-report 751→735 (palette+header out, chrome in). LCP/TTI medians at or better than baseline everywhere measurable (/screener 444→36, /portfolio 208→32; `/` LCP still the async-brief artifact). CLS with new chrome: 0.001–0.009 (chrome itself fixed-height sticky, zero shift). Typing re-renders `<CommandLine/>` only by construction (sibling state). | Old chrome files (site-header, command-palette, notification-bell, ollama-status, theme toggle) unmounted but left on disk — some carry owner's uncommitted edits; remove in a cleanup phase. Decision-line docking marker (`◆ 1 OPEN`) lands with Phase 3's DecisionLine. Commit deferred to owner. |
| 2026-08-02 | 1 (complete) | `--tm-*` token layer + `.tm-*` primitive styles at the bottom of `app/globals.css` (canvas/ink/rules/amber/market, motion doctrine, gapped type scale, caret, focus tick, figrow, decision line, open table, margin host); React primitives in `app/_components/terminal/` (Rule, FigRow/Fig, DecisionLine, SettleNumber + pure `settleSequence`, MarginHost/MarginNote) — deliberately unimported by any page until Phase 4; `tests/terminal-settle.test.ts` pins the settle grammar | tsc silent · vitest 1,667 passed (+7) · eslint unchanged (same 4 pre-existing) · build green · visual QA: primitives verified against SPEC.md on a throwaway page (deleted); legacy /, boot splash, portfolio unchanged | Route JS byte-identical on all five pages (791/995/837/1261/751 raw KB). CSS 146.0 raw / 22.9 gz KB (+~5 raw KB for the tm layer; CSS wasn't in the Phase 0 table — this is the reference now). LCP/TTI at or better than baseline except `/` LCP ~4-5s, which is the async AI-brief `<p>` becoming the LCP element when its cache is cold — pre-existing data path, JS/route untouched (verified byte-identity). Build wall time varied 16-33s across identical-code runs (Turbopack cache state); the build containing this phase's changes ran 15.96s. | Commit deferred: owner batches commits (owner instruction, this session). INCIDENT: a scratch script corrupted `app/globals.css` mid-phase; fully reconstructed from the dev-server source map + git HEAD and verified rule-for-rule against the pre-corruption compiled CSS (only minifier formatting differs). Authored comments on the owner's uncommitted `.uaa-brand-*` / `.uaa-boot-splash .boot-*` blocks (if any existed) could not be recovered — owner should eyeball that region (~lines 814-905). |
| 2026-08-02 | 0 (complete) | Baseline recorded below; `scripts/perf-baseline.mjs` added (lcp/fps/heap modes — rerun after every phase); light-theme decision logged in §7 with owner sign-off | tsc silent · vitest 1,660 passed / 3 skipped (count grew from 1,426) · eslint: 2 known issues + 2 pre-existing warnings in `app/ic-report/page.tsx` (unused eslint-disable + exhaustive-deps; file untouched this session — add to AGENTS.md known list or fix in a real ic-report phase) · build green | is the baseline | none |
| 2026-07-31 | 0 (started) | PLAN.md written; AGENTS.md pointer added | n/a | baseline not yet recorded | Record baseline; log light-theme decision |

### Phase 0 baseline (recorded 2026-08-02)

Conditions: dev machine (macOS, Darwin 23.6.0), Next.js 16.2.9 (Turbopack) production
build served via `next start -p 3100`, headless Chromium 1440×900 via
`scripts/perf-baseline.mjs`, local SQLite data, Ollama state as-found. Working tree
included uncommitted brand-asset work (see git log around this date); re-measure from
the Phase 0 commit if in doubt.

Methodology notes (bind future comparisons to the same method):
- Turbopack's `next build` no longer prints per-route bundle sizes; route JS below is
  the deduped set of `<script src>` tags in each route's prerendered
  `.next/server/app/*.html` — i.e. initial JS, excluding lazy-loaded chunks.
- TTI is a proxy: max(FCP, end of last long task) after a ≥5s quiet window
  (`perf-baseline.mjs lcp`). LCP/FCP via PerformanceObserver, 3 runs, median reported
  (all runs kept in the raw table below because data-fetch variance is real).

```
build time:            16.1s wall (npm run build; compile 5.0s, TS 8.3s, 26 static pages)

route bundles (initial JS, gzip / raw KB):
  /portfolio        369 / 1261     (heaviest)
  /journal          333 / 1117
  /compare          302 / 1003
  /research         290 /  995
  /screener         248 /  837
  /watchlist        244 /  816
  /                 237 /  791
  /engine           236 /  784
  /wire             231 /  776
  /thematic         230 /  764
  /calendar         227 /  762
  /knowledge-graph  229 /  756
  /valuation        228 /  756
  /ic-report        225 /  751    (lightest)

LCP/TTI medians of 3 runs, ms (raw runs were noisy — LCP on / ranged 76–4668 depending
on when async content landed; compare medians AND worst-run against this table):
  /            FCP 172   LCP 172   TTI 4623   (worst LCP 4668)
  /research    FCP  68   LCP 120   TTI   68   (worst LCP  240)
  /screener    FCP 160   LCP 444   TTI  278   (worst LCP 3064)
  /portfolio   FCP 128   LCP 208   TTI  128   (worst TTI 5374)
  /ic-report   FCP  68   LCP  68   TTI   68   (worst TTI  324)

screener scroll fps:   60.1 avg fps, 0/361 frames >26ms — at 50 rows, because the
                       current screener paginates at PAGE_SIZE=50 and cannot render the
                       full universe at all. There is NO pre-existing full-universe
                       render to baseline against: Phase 4b's 60fps-at-~400-rows gate
                       is absolute, not relative. (`perf-baseline.mjs fps`)
heap after 30 min:     11.3 MB used / 15.4 MB total JS heap — 59 full cycles over the
                       five routes above with scroll, single tab (`perf-baseline.mjs
                       heap`). Note: today's app does full-document navigations, which
                       reset the heap per page; once Phase 2 makes navigation client-
                       side this number becomes the one to watch for leaks.
```

## 7. Decision log  *(deviations from SPEC.md land here or they didn't happen)*

| Date | Decision | Why |
|---|---|---|
| 2026-07-31 | spec-demo + SPEC.md are the binding skeleton for the final product; deviations require an entry here | Owner confirmation |
| 2026-08-02 | Light theme: dark-only through the transformation; light re-derived from the token layer in Phase 7. The existing `data-theme` mechanism stays intact throughout. | Owner sign-off, 2026-08-02 (chose PLAN.md's recommended option). Halves visual QA per phase; SPEC.md's system is defined dark-first. |
| 2026-08-02 | Function row's `RUN` maps to `/engine` (the systematic desk) until Phase 4d builds the Run page, then it re-points. | SPEC.md's seven words are fixed; the closest existing surface keeps the word honest and the engine reachable. |
| 2026-08-02 | Autocomplete column renders over content (canvas-colored, no box/border/shadow) rather than displacing it. | SPEC.md asks for "the next four lines of a document" visually; literal document flow would shift the page on every keystroke, violating §3's re-render/CLS discipline. |
| 2026-08-02 | Decision data model: questions vs. answers. Docket items (`docket_item`) are open QUESTIONS with their own lifecycle (open/decided/deferred/retired); the journal `decision` table stays the record of ANSWERS. Resolving a question may file an answer via `decision_id`. | Owner choice, 2026-08-02. Bolting deferred/retired onto the journal table would conflate "my call is still live" with "something needs attention" and corrupt /journal's track-record math. |
| 2026-08-02 | On unconverted pages, the chrome-carried decision line renders ONLY when a decision is open — no permanent `NOTHING OPEN` strip. | The `◇ CLEAR` marker already says "nothing needs you" in the chrome; a second permanent nothing-indicator on every legacy page fails "every element earns its place". Converted pages get the full always-present line (with `NOTHING OPEN` state) in their own mastheads in Phase 4, where it belongs to the page's rhythm. |
| 2026-08-02 | The `◆ N OPEN` marker is persistent in the command line rather than appearing via the scroll-detach animation. | The detach choreography needs a page-owned decision line whose exit can be observed; legacy pages don't have one. The spec-demo also shows the marker persistent. The 240ms dock/420ms return land with the Phase 4 conversions. |
| 2026-08-02 | Phase 3 policy-breach copy quotes the product's 20% cap ("the cap only means something if breaching it costs a decision") rather than SPEC's "the limit you set on 12 Mar, in writing". | There is no user-authored policy store yet — pretending the constant in lib/portfolio/policy.ts was "set by you, in writing" would be a lie in the product's own voice. Phase 4c (trim sheet + policy work) is where user-authored limits and the borrowed-authority copy arrive together. |
| 2026-08-02 | The Desk has no 76px element. | Matches the approved spec-demo skeleton (binding source #2), whose Desk sets no big number; the docket's aged items are the focal point. SPEC.md Part I's one-big-number rule reads as "at most one" here — two sources conflict and the demo wins per §1. |
