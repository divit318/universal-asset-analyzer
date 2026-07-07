# UAA — Quality Program (Phase 0–3)

A four-phase program that took the platform audit's top-10 findings and shipped
them, built pure-engine-first with tests and **verified live against the running
app and real data** throughout.

**Verification:** `tsc` 0 errors · `lint` 0 · **426 tests / 46 files** (was
331/36 — +95 tests). Every feature was exercised end-to-end against the live
server, real portfolio, real watchlist, and the engine's real signal log.

Two calls where the code overrode the original plan (both documented below):
we **did not merge** the two scoring engines, and **did not tear down** the
research page — because investigation showed both were the wrong move.

---

## Phase 0 — Foundations (fix the substrate)

### AI grounding & verification
Every AI feature runs on a small local model, so the ceiling is grounding. The
copilot *asked* the model to cite sources and never invent numbers — nothing
*checked* it.

- **`lib/ai/grounding.ts`** — a pure verifier that extracts every figure from an
  AI answer, traces it back to the evidence (tolerant of rounding, `$`/`%`,
  magnitude suffixes, Indian cr/lakh), validates citations, and scores grounding.
- **`tests/ai-eval/`** — an offline eval harness (golden fixtures) that fails CI
  if a prompt/model change starts producing ungrounded answers.
- Adopted across **copilot, AI verdict, compare, and the 9-agent IC report** via
  one shared **`GroundingBadge`** ("N/M figures trace to sources").

### Scoring consolidation (kept two engines — challenged the plan)
The audit said "merge the two scoring engines." The code said otherwise:
`composite.ts` scores 1000+ names in batch (no per-name analyst/statements) and
`scoring.ts` is the rich single-name decision engine. Merging would cripple one
or gut the other. **The real bug was the shared decision layer**, where the same
score meant different things on different pages.

- **`lib/recommendation.ts`** — the single source of truth for score→
  recommendation bands, labels, and tones (screener now matches research).
- **`lib/score-math.ts`** — the shared clamp-lerp both engines normalize with.
- **`tests/scoring-consistency.test.ts`** — locks the contract. Docs corrected.

### Portfolio lot ledger + data provenance
- **`lib/portfolio-lots.ts`** — the portfolio moved from one aggregate row per
  symbol to a **transaction ledger** (average-cost, realized P&L, true inception
  date). Idempotent migration seeds lots from legacy rows — **verified on the 12
  real positions** with zero drift.
- **`lib/provenance.ts` + `DataProvenance`** — a source + freshness badge
  (fresh/aging/stale), wired into the screener.

---

## Phase 1 — Repair broken promises

### Performance analytics — *are you beating the index?*
Built on the lot ledger.

- **`lib/portfolio-performance.ts`** — **XIRR** (money-weighted return) and a
  true benchmark: *the same cash flows invested on the same dates into SPY*.
- Shows on the portfolio page: total return, XIRR, **vs S&P 500**, realized /
  unrealized split. (`/api/portfolio/performance`)

### Real alerts / notification engine — *was completely inert*
Watchlist thresholds were stored but nothing ever fired them.

- **`lib/alerts.ts`** — evaluates price targets, drop alerts, and portfolio
  big-moves (≥7%/day) into 24h-deduped events.
- Notification store + **`/api/monitor/run`** + **`/api/notifications`** + a
  **header bell** (unread badge, dropdown, OS-toast).
- **Background delivery**: `scripts/monitor.mjs` (+ launchd plist / cron
  template in `scripts/README.md`, `npm run monitor`) keeps alerts firing with
  no tab open.

---

## Phase 2 — Close the loops

### Decision journal & track record  (`/journal`)
- **`lib/decision-journal.ts`** — logs calls with conviction + a thesis, and
  captures the **IOS portfolio-fit at decision time**, then scores outcomes:
  hit rate, avg return, and **calibration by conviction and by fit tier**
  ("do my high-conviction / high-fit calls actually outperform?").
- The personalization spine (`lib/ios/`) **already existed** and is wired
  everywhere — the journal threads it in rather than rebuilding it.

### Signal backtest  (`/backtest`)
- **`lib/backtest.ts`** — over the engine's real signal log, joins each
  actionable signal to its realized return and reports long-short spread,
  score↔return correlation, and hit rate. Its live verdict is **honest** (it
  reported *no demonstrated edge* over the short available window — exactly what
  a backtest should do).

---

## Phase 3 — Surface & action

### Analysis-to-action layer
- **`lib/position-action.ts`** + a card on the research page — turns the fit
  scorer's suggested weight into a **concrete sized order**: *"Buy 12 shares
  (~$1,850) to establish a 4.0% position,"* with current→target weight and a
  "Log this decision →" link into the journal.

### Onboarding + progressive disclosure
- **`GettingStarted`** — a stateful first-run checklist (portfolio, watchlist,
  alerts, journal) that self-hides once you're set up.
- **`CollapsibleSection`** — a progressive-disclosure primitive; the research
  page already leads with the decision (DecisionHero + tabs), so this was a
  contained tightening, not a teardown.

---

## New surfaces at a glance

| Where | What |
|-------|------|
| Header bell | Live alerts (price target / drop / big move) + OS toast |
| Portfolio → Performance panel | XIRR + you-vs-S&P 500 + realized/unrealized |
| `/journal` (nav: Portfolio) | Log calls, measure your track record & calibration |
| `/backtest` (nav: Research) | Do the engine's signals actually work? |
| Research page | Grounding badges, sized Next-Action card, fit context |
| Home | Getting-started checklist for new users |

## Run it
```bash
npm run dev        # app
npm run test       # 426 tests
npm run monitor    # one background alert check (schedule via scripts/README.md)
```
