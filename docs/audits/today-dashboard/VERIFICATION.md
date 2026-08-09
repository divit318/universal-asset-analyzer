# Phase 6: verification

All measurements taken 2026-08-08 against `next dev` on the host machine (the same environment as the baseline, so the comparisons are like-for-like). Screenshots referenced below live in `shots/`.

## 1. Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint app lib` | 0 errors; 12 warnings, all in files outside the dashboard scope (compare, knowledge-graph, watchlist, ai, ic-agents; pre-existing or a concurrent session's in-flight work). `app/_home`, `lib/home`, `app/api/home` are fully clean, including the two formerly "known pre-existing" issues, which were removed with their code |
| `npx vitest run` | 192 files, 2986 passed, 3 skipped (live-AI suite, by design) |
| `npm run build` | compiled successfully, 28/28 pages |
| Reconciliation harness (`tests/home-facts.test.ts` + dev-mode route check) | green; zero invariant violations logged on live digest builds |

## 2. Performance: baseline vs final

| Metric | Baseline (audit 09) | Final | Change |
|---|---|---|---|
| `/api/home` (warm) | 8,100 to 9,300 ms | 24 to 71 ms | ~150x |
| `/api/home` (cold engines) | 13.9 s | ~10 s once, then SWR serves stale-instantly while rebuilding | first build unchanged, never blocks again |
| `/api/portfolio/report` on page load | 8,000 to 9,000 ms, duplicate build | 15 to 29 ms, shared build | ~400x, duplication gone |
| `/api/home/brief` with cached prose | 8,500 ms | 36 to 80 ms | ~150x |
| Engine builds per homepage load | 3 parallel full builds | 1, shared via platform datasets | PF-02 closed |
| Digest payload | 80 KB | 38 KB | dead slices cut |
| FCP | ~200 ms | 100 to 212 ms | unchanged (was never the problem) |
| CLS | 0.00 | 0.00 | held |
| TBT | 0 ms | 0 ms | held |
| Time-to-meaning (modules painted, warm) | ~9 s | < 0.5 s | the audit's headline defect |

Targets from 09-performance.md: warm time-to-meaning < 1.5 s (hit), `/api/home` cache hit < 300 ms (hit), brief TTFT cached < 500 ms (hit), redundant builds 3 -> 1 (hit), payload < 50 KB (hit).

## 3. Reconciliation, live

From the running page (values move with the market; the invariants do not):

- Day P&L attribution: contributors + "Everything else" residual sum exactly to the day move (verified live: 82.8 + 11.6 − 5.1 + 23.7 ≈ 112.8 bps vs day +1.128% = 112.8 bps, and the harness asserts it within 0.75 bp on every dev build).
- Health decomposition sums exactly to the displayed total (69.0 = 69).
- Sentiment components sum exactly to the score (81 = 81).
- One count: the strip, the queue header, and the CTA all read the queue's `openCount`.
- One VIX interpretation: gauge caption and tile caption share `vixBand`.
- Cash renders at one precision (30.0%) everywhere it appears.

## 4. States, before and after (`shots/states/` vs `shots/final-states/`)

| State | Before | After |
|---|---|---|
| Digest 500 | Queue rendered a checkmark and "Nothing needs your attention"; hero showed "ACTIONS 0", a "15s read" of nothing, and a live CTA; radar footer claimed "0 buys, 0 near-buys" | Every zone shows an explicit error + Retry; the queue says "Couldn't load your queue. Its state is unknown, not clear."; the radar footer says "Watchlist unavailable" |
| New user | Full-strength hero with stale Resume pill and filled CTA over "ACTIONS 0" | Book strip shows the add-a-holding CTA; queue shows onboarding actions; no fabricated numbers |
| All-clear queue | ~1000 px empty card beside a radar shouting the same five signals | The earned clear state stands alone; the radar owns signals as context below the work |
| Weekend / closed market | (was already good) session stamps and "Showing Fri close" retained | unchanged |
| Slow network | skeletons matching final layout | unchanged, CLS 0 |

## 5. Accessibility checks (from 10-accessibility.md, re-verified)

| Check | Result |
|---|---|
| AC-01 failing contrast tier in the delta band | fixed: labels moved to the muted tier (>= 4.5:1) |
| AC-03 color-only charts | fixed: dashed benchmark line, terminal dots on all sparklines, signed adjacent labels |
| Focus visibility, skip link, labelled icon buttons | pass (re-probed) |
| Reduced motion | pass; the one ambient-adjacent animation (count-up) is deleted outright |
| Keyboard operability | queue fully driveable: j/k move, Enter open, d dismiss, s snooze, e done, with a visible legend |
| aria-live on queue count and brief status | pass |
| Deferred | AC-04 (svg aria sweep), AC-05 (metric group semantics), the header's 9 px ⌘K hint (outside dashboard scope) |

## 6. Responsive (`shots/final/`)

390 / 768 / 1024 / 1440 / 2560 captured. The fold at 1440x900 now contains: the whole Book strip (state), the delta band with the AI read, and the queue header plus the spotlight decision. The first executable decision moved from ~y1835 (62% of page height) to ~y560, inside the first viewport. Mobile is the same artifact in one column; the radar's five tiles are a grid instead of a duplicate stack.

## 7. The daily ritual, walked (NORTH-STAR.md against `shots/final/1440.png`)

1. Orient (5 s): the Book strip: C 69 ring, day +1.1% +$35.4K stamped with its session and coverage ("prices 70% of book"), XIRR +67.9% labelled annualized/money-weighted/95d vs SPY, cash 30.0%, the 90-day pair, and the reconciled attribution. One strip, one glance.
2. Delta (15 s): "Since last visit" directly below: "2 new ideas in the Radar", "10 queue items cleared", and the one AI sentence, labelled AI READ, interpreting rather than restating: "A +1.1% day was essentially one position: ABNB alone delivered 82.8 bps of the move, so this book's outcome is currently an ABNB bet with a 30% cash cushion." The full morning note is one disclosure away.
3. Triage (2 to 4 min): the queue, full width. The spotlight is the executable decision ("Trim USD Cash from 30.0% to 20%", Act now, with the simulated before/after and the absorbed threat's link), not a restatement of it. Every row has act/log/snooze/done/mute/dismiss with stated TTLs and undo; the keyboard drives all of it; reaching the end is an earned, explicit state.
4. Depart (5 s): every row's primary action deep-links with `from=today`; acting on the spotlight can log the decision to the journal in place.

Thirty seconds after opening: what changed (delta band), whether it matters (Book strip + per-item book-weight chips), and the single next thing to do (the spotlight). Every number traces: click any figure with a dotted underline (health, priority band, fit, decision score) for its decomposition; every window and methodology is stated inline.

## 8. Findings disposition

See FINDINGS.md: every row is marked fixed (with its wave), deferred (with reason), or rejected (with reason). No silent drops.
