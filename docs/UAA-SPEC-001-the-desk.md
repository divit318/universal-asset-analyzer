# UAA-SPEC-001 — "The Desk"
## Home Redesign + Whole-App Information Architecture

**Status:** Implementation-ready specification for Opus
**Author:** Fable 5 (product/design strategy pass), 2026-07-18
**Scope:** Home page (`app/page.tsx` + `lib/home/*` + `app/_home/*`), navigation IA (`app/_components/nav-config.ts`), route disposition, and one new domain engine. No code in this document is production code; all snippets are contracts for Opus to implement.

---

## 1. Executive Summary

UAA's Home page has evolved into a **mirror of the application** — 14 modules in 8 rows, each faithfully reflecting a destination page — when its job is to be a **scheduler of the user's attention**. The registry architecture (which is excellent, and is preserved) made adding modules nearly free, and nothing ever made removing them necessary. The result: six separate modules that all answer variations of "something may need your attention," each with its own ranking logic, none aware of the others, none dismissible, and no finish line. A daily surface that cannot be finished trains the user to skim and leave.

The whole-app IA has the right skeleton — four objectives (Today / Discover / Research / Portfolio) that mirror the investment loop — but the loop is implemented as four silos. Nothing carries state across stages: an idea surfaced by the Scanner, researched in the Hub, bought in Portfolio, and logged in Journal is *the same object* to the user and four unrelated records to the app.

This spec makes three moves, in ascending order of ambition:

1. **Collapse Home from 14 modules to 6** around a single new centerpiece: the **Attention Queue** — one ranked, finishable stream that merges actions, threats, alerts, catalysts, and signals under a shared attention score. Dismissal is state. Zero is reachable and celebrated.
2. **Repair the IA seams**: dissolve `/intelligence` (a container named after technology, not an objective), promote the Knowledge Graph, move Quant Engine + Backtest from Research to Discover, delete dead routes, and make the command palette symbol-first.
3. **Introduce the OS primitive**: the **Idea lifecycle** — a `stage` on every tracked symbol (`surfaced → researching → thesis → owned → exited/passed`) that turns Watchlist + Portfolio + Journal into three views of one pipeline. This is what makes "Investment OS" true rather than aspirational. Shipped last, smallest possible v1.

Everything is phased so Phase A (Home collapse + Attention Queue) is independently shippable and delivers most of the perceived value.

---

## 2. Problems Identified

### Home

- **P1 — No attention model.** The registry's `priority` field orders *fetch and paint*, not user attention. A severity-9 threat renders in row 3 below a routine brief. Importance is decided per-module; nothing ranks across modules.
- **P2 — Six modules compete for the same job.** `recommended-actions`, `threat-center`, `intelligence-feed`, `timeline`, `upcoming-events`, and the alerts half of `watchlist-intelligence` are all "things that may need a decision," rendered as six sibling lists with six visual treatments.
- **P3 — No finish line.** Nothing on Home is dismissible or completable. The page never says "you're clear." Users cannot tell a fresh item from one they already saw yesterday, so the whole page decays into wallpaper.
- **P4 — Home duplicates destinations.** `performance-attribution` fully duplicates `/portfolio?tab=performance`; `threat-center` duplicates `?tab=risk`; the deep halves of `timeline` and `intelligence-feed` duplicate `/intelligence`. Duplicated workflows are explicitly on this product's avoid-list.
- **P5 — 8 rows exceeds any daily scroll budget.** Rows 5–8 (`explain`, `feeds`, `next`, `note`) are below-fold filler; their content is either stale mirrors (P4) or belongs in the queue (P2).
- **P6 — Two portfolio vitals cards.** `portfolio-pulse` (health radar) and `portfolio-performance` (XIRR rail) split "how is my book" across two cards in two different rows.

### Information architecture

- **P7 — `/intelligence` is a bucket, not an objective.** Its own header comment admits its reason to exist left when Mission Control became the homepage. "Graph and Timeline, the two exploration surfaces" is a grouping by *widget type*.
- **P8 — Straddling tools.** Quant Engine and Backtest sit under Research ("analyze one company") but are system-level idea generation/validation — Discover jobs. The Knowledge Graph is buried two levels deep inside `/intelligence`.
- **P9 — Route debris.** `/comps` has components but no page (dead). `/stocks` is a redirect shim (fine, keep). `/timeline` and `/knowledge-graph` are component directories whose surfaces render only inside `/intelligence`.
- **P10 — No symbol context spine.** Every tool takes `?symbol=` but the app forgets the symbol between tools. Moving AAPL from Research → DCF → IC Report → Compare means re-entering it up to three times. An OS carries the working set.
- **P11 — No lifecycle object.** The investment loop (notice → find → analyze → decide → own → review) has no object that travels it. Watchlist is a flat list; Journal is a detached log; Portfolio is an endpoint. The user maintains the pipeline in their head.

---

## 3. Root Causes

- **RC1 — Asymmetric cost of add vs. remove.** The module registry made adding a module a 4-step, zero-risk operation. No mechanism (attention budget, module cap, overlap review) ever forced consolidation. Sprawl is the *predictable equilibrium* of that architecture, not an accident.
- **RC2 — Modules are organized by data source, not by decision.** `threat-center` exists because `lib/home/threats.ts` exists; `timeline` because `lib/home/timeline.ts` exists. The user's question ("what needs me?") spans all of them.
- **RC3 — Severity is scoped per-module.** Each engine ranks its own output. There is no shared unit of importance, so cross-module ranking was never possible without a new contract.
- **RC4 — The IA groups tools, and tools are nouns.** Objectives were retrofitted over pre-existing pages. Pages that didn't fit an objective (`/intelligence`) survived as containers.
- **RC5 — No shared domain object across the loop.** Each module owns its own tables (`watchlist`, `portfolio`, journal). Nothing was ever forced to agree on "what is an idea," so no pipeline could exist.

---

## 4. Proposed Redesign

### North star

> **An operating system schedules attention across processes.**
> UAA's processes are *ideas about symbols* moving through a lifecycle.
> Home is the scheduler. Tools are verbs. The Idea is the noun.

### 4.1 Home v2 — "The Desk" (6 modules, 4 rows)

| Row | Left (8 cols) | Right (4 cols) |
|---|---|---|
| **Command** | `todays-brief` (unchanged hero) | `book` — NEW, merges `portfolio-pulse` + `portfolio-performance`: health ring, XIRR vs benchmark, cash %, day P&L |
| **Attention** | `attention-queue` — NEW centerpiece (see §4.2) | `radar` — NEW, merges `opportunity-feed` + buy-candidate half of `watchlist-intelligence`: "ideas entering the pipeline" |
| **Tape** | `market-intelligence`, full-width, slimmed to a single instrument row + expandable second row | |
| **Long read** | `ai-investment-brief`, full-width, collapsed by default (unchanged) | |

**Retired as Home modules** (their libs survive as *feeders*, §4.2): `recommended-actions`, `threat-center`, `intelligence-feed`, `timeline`, `upcoming-events`, `watchlist-intelligence`, `performance-attribution` (lives only at `/portfolio?tab=performance`; the `book` rail links to it), `portfolio-pulse`, `portfolio-performance`, `opportunity-feed`, `continue` (its job moves to command-palette recents + a "Resume" chip in the brief's footer).

The registry/layout/module-map architecture is **kept exactly as is** — this change is proof it works: retiring a module is a registry + layout + map edit, `app/page.tsx` untouched, validators catch drift.

### 4.2 The Attention Queue

One ranked stream. Every item is a card with: kind badge, symbol (Neural-Flow linked), headline, one-line rationale, attention score, and **exactly two affordances — a primary action (deep link into the owning tool, verb-labeled: "Review threat", "Execute", "Open research") and Dismiss**. Dismissals persist. When the queue is empty, the zone renders a deliberate, quiet "You're clear — nothing needs a decision" state. That state is the product's reward loop.

**Feeders** (all existing engines, now normalized instead of card-owning):

| Feeder | Source lib | Item kind |
|---|---|---|
| Portfolio engine decisions | existing recommended-actions data path | `action` |
| Threats | `lib/home/threats.ts` | `threat` |
| Triggered watchlist alerts | watchlist data path | `alert` |
| Catalysts ≤ 7 days (earnings, ex-div) | calendar data path | `event` |
| High-signal scanner hits | scanner snapshot | `signal` |

**Scoring.** `score = 100 × impact^0.5 × urgency^0.3 × confidence^0.2` (geometric — a zero in any dimension sinks the item; exponents are the starting point, tuned in tests).
- `impact` (0–1): portfolio-weighted exposure for threats/alerts/events; engine expected-impact for actions; fit-score for signals.
- `urgency` (0–1): time-decay to catalyst/expiry (1 at ≤24h, linear to 0 at 7d); 0.6 default for undated items.
- `confidence` (0–1): engine confidence where available, else per-kind default (threats 0.8, calendar 1.0, signals 0.5).

**Why this is superior:** it replaces six per-module ranking heuristics with one contract; it makes importance comparable across the whole product; and it converts Home from read-only wallpaper into a finishable workflow. The user's daily loop becomes: read brief → clear queue → done.

### 4.3 IA v2

Four objectives kept, placements repaired:

| Objective | Tools | Changes |
|---|---|---|
| **Today** (`/`) | The Desk | — |
| **Discover** | Screener, Scanner, Thematic, **Quant Engine** ⬅, **Backtest** ⬅ | Engine/Backtest moved in (they generate and validate ideas system-wide); `/intelligence` removed |
| **Research** | Research Hub, Compare, DCF, IC Report, **Knowledge Graph** ⬆ | Graph promoted to a real route/nav item; Engine/Backtest moved out |
| **Portfolio** | Portfolio, Watchlist, Journal, Calendar | Unchanged now; becomes the Pipeline in Phase D |

Route disposition:
- `/intelligence` → **dissolve**. Graph surface → `/knowledge-graph` (components already live there). Timeline's daily job → the Attention Queue; its `thesis-evolution-panel` migrates into Journal (Phase D). `/intelligence` becomes a redirect to `/` for one release, then deleted.
- `/comps` → **delete** after confirming zero imports (no page exists today).
- `/stocks/[symbol]` → **keep** as redirect shim (already correct).
- All `navTarget`s in the Home registry that point at `/intelligence` re-point per above.

### 4.4 Symbol context spine (Phase C)

A lightweight **focus context**: the last 5 symbols the user acted on (searched, opened, queued), persisted per-session, surfaced as (a) chips in the ⌘K palette header, (b) prefill for every `symbolParam` tool, (c) "recents" in the palette. Palette becomes **symbol-first**: typing a ticker shows the symbol with a verb list (Research · Compare · DCF · IC Report · Add to watchlist) rather than a page list. Likely host: extend the existing app-level context provider (`lib/ios-context.tsx`) — Opus should verify fit before adding a new provider.

### 4.5 The Idea lifecycle (Phase D — the OS primitive)

v1 is deliberately minimal: add `stage` (`surfaced | researching | thesis | owned | passed | exited`) to the watchlist record; auto-transitions where unambiguous (buy → `owned`; sell-all → `exited`); a **Pipeline board view** as a tab on `/portfolio` showing all tracked symbols by stage; Journal prompts fire on stage transitions ("You moved NVDA to Thesis — log your reasoning?"). No new top-level page. No workflow enforcement — stages are descriptive, never gates.

**Problem it solves:** P11. It gives the four objectives a shared object, makes the Journal self-populating (today its biggest failure mode is that nobody fills it in), and gives the Attention Queue a future dimension ("3 ideas stuck in Researching for 30+ days").

---

## 5. UX Rationale

- **One queue beats six lists** because ranking *is* the product. The user's scarce resource is attention; only a shared score can allocate it. Six lists delegate the ranking to the user's scroll finger.
- **Dismissal-as-state** is what separates a workspace from a poster. It creates novelty detection (unseen items are meaningful), a finish line (zero state), and implicit feedback for future tuning (chronically dismissed kinds can decay).
- **Two affordances per card, never more.** The current `recommended-actions` card carries Research / Execute / Explain. Three buttons is a menu; two is a decision. "Explain" folds into the detail the primary action opens.
- **Merging the book rail** restores the glanceable invariant: one card = one question ("how is my book?"). Health, return, cash are facets of that one question.
- **Dissolving `/intelligence`** removes the only nav item named after implementation rather than intent. Objectives survive contact with users; containers don't.
- **Descriptive, not prescriptive, lifecycle** (Phase D) respects how investors actually work — nonlinearly — while still capturing structure the OS can reason about.

---

## 6. Alternative Approaches Considered

1. **Tabbed Home** (Overview / Actions / Market tabs). Rejected: tabs hide, they don't rank. The attention problem is prioritization, not real estate.
2. **User-configurable dashboard** (drag-drop, show/hide modules). Rejected: "unnecessary configuration" is on the avoid-list; it outsources the product's core editorial judgment to the user and multiplies QA surface.
3. **Everything-is-a-feed** (brief, tape, and book also become stream items). Rejected: the brief and the book are *ambient state*, not decisions; forcing them into a queue destroys glanceability. Hybrid (state on top, queue in the middle) chosen.
4. **Five+ top-level nav objectives** (adding "System" for Engine/Backtest/Graph). Rejected: four objectives map 1:1 to the loop; a fifth is org-chart thinking. Engine/Backtest fit Discover's job description.
5. **New `ideas` table for the lifecycle** instead of a `stage` column on watchlist. Rejected for v1: a parallel table re-creates P11 (two records for one idea). Extend the object users already have; migrate to a richer entity only if stage history demands it.
6. **AI-ranked queue** (LLM scores each item). Rejected: attention scoring must be deterministic, instant, explainable, and testable. AI narrates (the brief); math ranks. This also honors the existing registry invariant that AI never blocks the digest paint.

---

## 7. Recommended Solution

Phase A (Home collapse + Attention Queue + book/radar merges) → Phase B (IA repair) → Phase C (symbol spine) → Phase D (lifecycle v1). Each phase ships independently; A alone resolves P1–P6. Full plan in §20.

---

## 8. Detailed User Journey

**Morning open (primary, ~90 seconds to "clear"):**
1. User opens `/`. Command row paints instantly from the digest: brief hero (accent hairline green/red per today's move), book rail (health ring, XIRR, cash, day P&L).
2. Attention Queue paints in the same digest pass: e.g. 5 items — `threat` "NVDA now 31% of book" (score 84), `action` "Trim MSFT — engine conviction dropped" (76), `event` "AAPL earnings in 2 days" (61), `alert` "TSM hit your $210 target" (58), `signal` "New scanner hit: ASML fits your quality tilt" (41).
3. User hovers NVDA — Neural Flow dims everything non-NVDA across the whole page (queue, brief movers, radar).
4. Clicks "Review threat" → `/portfolio?tab=risk` with NVDA focused. Acts (or doesn't), returns; the item revalidates on focus — if concentration was addressed it leaves the queue on its own, else the user Dismisses ("acknowledged, 7 days").
5. Dismisses the scanner signal — card slides out, queue reflows, count decrements.
6. Queue reaches zero → "You're clear." User skims the tape, optionally expands the long read. Done.

**Idea pursuit (Phase C+D):** Radar shows ASML → click → Research Hub (symbol enters focus context) → ⌘K, type nothing: ASML chip is first → "DCF" verb → DCF prefilled → back to Hub → "Add to watchlist" sets stage `researching`. Days later, promotion to `thesis` triggers a Journal prompt. Buying flips it to `owned` automatically. The pipeline board shows the whole funnel.

**Empty-portfolio first-run:** Command row shows brief in market-only mode; book rail becomes an onboarding card ("Add your holdings to unlock the queue and book"); queue shows market-kind items only (events, signals); radar leads the page's emphasis.

---

## 9. Wireframe Descriptions

**Desktop (lg+, 12-col grid, `gap-6` between rows):**

```
┌───────────────────────────────────────────────┬───────────────────────┐
│ TODAY'S BRIEF (hero, 8 col)                   │ BOOK (4 col)          │
│ accent hairline · headline · 3 movers ·       │ health ring 64        │
│ "Resume: NVDA research →" chip in footer      │ XIRR +11.2% vs +8.4%  │
│                                               │ cash 6% · day +$1.2k  │
│                                               │ → Portfolio           │
├───────────────────────────────────────────────┼───────────────────────┤
│ ATTENTION · 5 open                    filter ▾│ RADAR (4 col)         │
│ ┌───────────────────────────────────────────┐ │ ideas entering        │
│ │ ▮THREAT NVDA · 31% of book        84 ⋯ ✕ │ │ the pipeline          │
│ │  concentration breach · [Review threat]   │ │ ASML  fit 82  [+]     │
│ ├───────────────────────────────────────────┤ │ LIN   fit 77  [+]     │
│ │ ▮ACTION MSFT · trim signal        76 ⋯ ✕ │ │ near-buys (2)         │
│ │  conviction fell 8pts · [Open decision]   │ │ → Screener            │
│ ├── + 3 more, descending score ─────────────┤ │                       │
│ └───────────────────────────────────────────┘ │                       │
├───────────────────────────────────────────────┴───────────────────────┤
│ TAPE — SPX +0.4 · NDX +0.7 · VIX 14.2 · 10Y 4.31 · WTI · DXY · BTC  ▾│
├───────────────────────────────────────────────────────────────────────┤
│ ▸ THE LONG READ — AI Investment Brief (collapsed)                     │
└───────────────────────────────────────────────────────────────────────┘
```

- Queue card anatomy (one line + one line): row 1 = kind chip (data-colored: threat amber/red, action blue, event neutral, alert blue, signal green) · `SymbolTag` · headline · score numeral (mono, right) · dismiss ✕. Row 2 = rationale sentence · primary action as text-button.
- Score numeral is quiet (muted mono); the *order* communicates rank, the number is for calibration trust.
- Filter `▾` = kind toggle chips (All / Actions / Threats / Alerts / Events / Signals) — appears only when the queue exceeds 5 items.
- Cap visible cards at 8; "N more ↓" expander beneath.
- **Mobile (sm):** single column, order: brief → queue (cap 5) → book → radar → tape (horizontally scrollable chips) → long read. Dismiss via the ✕ (no swipe gestures in v1).

---

## 10. Component Hierarchy

```
app/page.tsx (unchanged — walks layout config)
└─ ModuleGrid (existing, SymbolLinkRoot wrapper)
   ├─ TodaysBrief (existing + ResumeChip footer)
   ├─ BookRail                    [new: app/_home/modules/book.tsx]
   │   ├─ HealthRing (lift from portfolio-pulse)
   │   ├─ ReturnStat / CashStat / DayPnl (lift from portfolio-performance)
   ├─ AttentionQueue              [new: app/_home/modules/attention-queue.tsx]
   │   ├─ QueueHeader (count, KindFilter)
   │   ├─ QueueList
   │   │   └─ QueueCard × n  (KindChip, SymbolTag, Headline, Rationale,
   │   │                      ScoreNumeral, PrimaryAction, DismissButton)
   │   ├─ QueueExpander ("N more")
   │   └─ QueueClearState
   ├─ Radar                       [new: app/_home/modules/radar.tsx]
   │   └─ RadarRow × n (SymbolTag, FitScore, AddToWatchlist)
   ├─ MarketIntelligence (existing, slimmed to TapeRow + ExpandableDetail)
   └─ AiInvestmentBrief (existing, unchanged)
```

Registry: 6 `HomeModuleId`s (`todays-brief`, `book`, `attention-queue`, `radar`, `market-intelligence`, `ai-investment-brief`). New engine `lib/home/attention.ts`; existing `threats.ts`, `timeline.ts`, calendar/watchlist/scanner paths become imports of the attention engine, not module owners.

---

## 11. Required UI States

**Attention Queue:** loading (3 skeleton rows, fixed height — no layout shift); populated; filtered (with "clear filter"); **clear** (deliberate design: quiet check glyph, "You're clear", timestamp of last review — this state must feel earned, not empty); degraded (≥1 feeder failed: render surviving items + one muted footer line "Threat data unavailable — retry"; never a full-zone error); no-portfolio (market-kind items only + one inline hint); market-closed (items persist; urgency decay pauses via `lib/market-hours.ts`).

**Book rail:** loading skeleton; populated; no-portfolio onboarding card; stale-quote (dim values + "as of" stamp).

**Radar:** populated; empty ("No new ideas today — run the Screener →"); scanner-snapshot-missing (same CTA, different copy).

**Brief / Tape / Long read:** existing states unchanged (deterministic brief fallback when Ollama is down is already correct — keep).

**Global:** first-ever-visit (no portfolio, no watchlist) → command row + radar + tape only; queue zone shows onboarding copy, not a fake-empty clear state.

## 12. Edge Cases

- **Duplicate story across feeders** (NVDA earnings appears as event + signal + action): `dedupeKey = kind-agnostic story key` where feeders can supply one (e.g. `symbol:earnings:2026-07-30`); on collision keep highest-score item, merge others' hrefs into its detail.
- **Dismissal resurfacing:** `dedupeKey` includes a severity band (e.g. concentration `25-30%` vs `30%+`). Material worsening = new key = item returns. Dismissals carry a TTL by kind (threats 7d, events until date passes, actions until engine revision changes, signals 30d).
- **Item resolved elsewhere** (user trims NVDA in Portfolio): queue revalidates on window focus (`refresh: "on-focus"`); resolved items leave without user action.
- **Score ties:** stable secondary sort by kind precedence (threat > action > alert > event > signal), then symbol.
- **>30 open items** (long absence): cap at 8 visible + expander; never paginate; header shows true count.
- **Clock skew / overnight tab:** urgency computed at render from timestamps, not stored.
- **Symbol delisted/invalid in a stored dismissal or stage:** feeders drop unknown symbols silently; dismissal rows are pruned opportunistically on read.
- **`/intelligence` inbound links** (bookmarks, old `navTarget`s): redirect to `/` for one release with a toast "Timeline now lives on your Desk."

## 13. Data Requirements

**AttentionItem contract** (in `lib/home/contracts.ts`):

```ts
interface AttentionItem {
  id: string;                 // stable per story instance
  dedupeKey: string;          // story identity incl. severity band
  kind: "action" | "threat" | "alert" | "event" | "signal";
  symbol: string | null;
  headline: string;           // ≤ 60 chars
  rationale: string;          // one sentence
  score: number;              // 0–100, computed by the engine, never by feeders
  impact: number; urgency: number; confidence: number;  // 0–1 inputs
  occursAt: string | null;    // ISO, for events
  primaryAction: { label: string; href: string };
  source: string;             // feeder id, for degraded-state attribution
}
```

- Feeders emit `Omit<AttentionItem, "score">`; only `lib/home/attention.ts` scores, dedupes, sorts. Feeders are pure functions over already-fetched digest data — **no new fetch paths, no new caches** (platform layer owns all caching; this is a hard rule from CLAUDE.md).
- **Dismissals:** new SQLite table via `lib/db.ts` only: `attention_dismissal(dedupe_key TEXT PK, dismissed_at INTEGER, expires_at INTEGER)`. CRUD in `lib/db.ts`; API `POST /api/home/attention/dismiss`.
- **Queue transport:** rides the existing Home digest (`cache: { via: "digest" }`); AI is never in its path (registry validator already enforces this — keep the rule).
- **Book rail:** consumes the same portfolio-engine digest slices `portfolio-pulse` and `portfolio-performance` use today; no new endpoint.
- **Phase D:** `watchlist.stage TEXT NOT NULL DEFAULT 'surfaced'` + `stage_changed_at INTEGER`; transitions written only through `lib/db.ts`.

## 14. Interaction Requirements

- **Dismiss:** single click on ✕; no confirmation (it's reversible by TTL and low-stakes); optimistic UI with rollback on API failure; toast "Dismissed for 7 days" with an Undo action (10s window).
- **Primary action:** plain navigation (deep link). Never a mutation directly from the queue in v1 — the queue routes to the tool that owns the mutation and its confirmation UX.
- **Keyboard:** queue is a listbox — `↑/↓` move focus, `Enter` = primary action, `Delete`/`Backspace` = dismiss, `f` cycles kind filter. ⌘K palette gains symbol-first behavior (Phase C).
- **Neural Flow:** every `QueueCard` and `RadarRow` symbol wrapped in `SymbolTag`; cards get `uaa-linkable` so hovering a ticker anywhere dims non-matching cards (extends the existing pattern exactly as the visual-language memo anticipated).
- **Hover:** card top-rim brighten per Machined Instrument adaptive-edge rule; dismiss ✕ appears at rest (not hover-only — touch parity).
- **Filter chips:** toggle, multi-select off (one kind or All); filter state is session-only, never persisted.
- **Tape expand / long-read expand:** existing disclosure patterns unchanged.

## 15. Animation Recommendations

- **Dismiss:** 180ms translate-x(12px)+fade, then 160ms height collapse (ease-out); items below reflow via the collapse, no springs.
- **Queue reorder on revalidate:** FLIP position transitions, 220ms ease-out, only when the tab is focused; never animate on initial paint.
- **Clear state:** 240ms fade-in after the last card's collapse completes — the "earned" beat.
- **Entrance:** reuse existing `.uaa-reveal` stagger; queue cards stagger 30ms each, cap 5.
- **Score changes:** never animate numerals in the queue (implies false liveness); the existing count-up stays exclusive to the brief/book.
- **`prefers-reduced-motion`:** all of the above collapse to opacity-only ≤ 100ms; FLIP disabled.

## 16. Visual Design Recommendations

Full compliance with the **Machined Instrument** language (see memory: matte panels, one overhead light, data-only color):

- Queue cards are rows *within* one `.uaa-card` panel — not 8 separate panels (panel-per-item would rebuild the clutter this spec removes). Hairline separators (`--edge-hairline`).
- Kind chips are the only chromatic elements on a card: threat amber (red only at score ≥ 80), action/alert interaction-blue, signal green, event monochrome. Chrome stays monochrome.
- The queue zone gets `uaa-topline` with `--accent-line` driven by top-item kind (amber when a threat leads, blue otherwise) — the page telegraphs its own headline.
- Score numerals: Geist Mono, `text-muted`; hierarchy by position and weight, not color.
- Clear state: no illustration, no confetti. Monochrome check glyph, one sentence, timestamp. Institutional calm *is* the reward aesthetic.
- Book rail health ring reuses the existing radar/ring treatment from portfolio-pulse; data-colored by band (green/amber/red), track monochrome.
- Keep all wrappers transparent per the stacking constraint (overhead light on `body::before` must not be occluded).

## 17. Accessibility Considerations

- Queue: `role="list"` with cards as `role="listitem"`; the interactive row uses the roving-tabindex listbox pattern described in §14; dismiss button carries `aria-label="Dismiss: {headline}"`.
- Live updates: queue count in an `aria-live="polite"` region; card removal moves focus to the next card (or the clear state heading) — never lose focus to `body`.
- Kind is never conveyed by color alone: chips carry text labels ("THREAT"), not just tint.
- All targets ≥ 44px on touch; dismiss ✕ visible at rest (§14).
- Score semantics: `aria-label="attention score 84 of 100"` on the numeral.
- Collapsed long-read and tape expanders: standard `aria-expanded` disclosure; filter chips `aria-pressed`.
- Color pairs (amber/red/green/blue on panel tokens) must pass 4.5:1 in both themes — verify against both `[data-theme]` values, not just dark.

## 18. Performance Considerations

- Queue paints from the digest in the first eager pass — **deterministic, no AI, no new round-trips**. Feeders are synchronous transforms of digest data; scoring is O(n log n) on n ≤ ~100.
- Fewer modules = fewer fetch paths: retiring 8 module cards removes their independent `on-focus` refresh storms; the queue revalidates as one unit.
- Dismissal POST is fire-and-forget optimistic; reads of `attention_dismissal` join in the digest build server-side (one SQLite query, indexed PK).
- Interval polling remains exclusive to the tape (existing 60s / 15s-TTL discipline — keep the validator rule).
- No virtualization needed (cap 8 visible); the expander mounts the remainder lazily.
- Layout shift budget: every zone has a fixed-height skeleton; CLS target 0 for the above-fold rows.

## 19. Acceptance Criteria

**Phase A (Home):**
1. Home renders exactly 6 registered modules; `validateRegistry()` and `validateHomeComposition()` pass; existing tests updated, not deleted.
2. Every queue item has exactly one primary action and one dismiss; dismissing persists across reload and expires by kind TTL.
3. Emptying the queue shows the clear state; a new qualifying item resurfaces on next digest.
4. A worsened threat (severity band change) reappears despite prior dismissal.
5. One feeder throwing does not blank the queue (degraded footer renders, others paint).
6. With no portfolio: no error cards; onboarding variants render as specified in §11.
7. Full keyboard path: tab to queue, arrow through, Enter navigates, Delete dismisses, focus lands correctly after removal.
8. Deterministic paint: with Ollama stopped, command row + queue + tape render completely.
9. `graphify update .` run after the change; module count and retired files reflected.

**Phase B (IA):** `/intelligence` redirects then is removed; `/knowledge-graph` reachable from Research dropdown; Engine + Backtest under Discover; `/comps` deleted with zero broken imports; every route reachable in ≤2 clicks or via ⌘K; no `navTarget` points at a dead route (add this as a registry validator check).

**Phase C:** last-5 focus symbols persist per session; every `symbolParam` tool prefills from focus; palette shows symbol-verb results when the query matches a known ticker.

**Phase D:** every watchlist row has a stage; buy/sell auto-transitions fire; pipeline board renders on `/portfolio`; stage transition raises a Journal prompt exactly once; stages never block any action.

## 20. Implementation Plan (for Opus)

> Work sequence is dependency-ordered. Run `graphify query` before touching each area; run `graphify update .` and the Vitest suite after each phase. Never touch `app/page.tsx` for layout — that invariant is the architecture's proof.

**Phase A — The Desk (ship first, independent):**
1. `lib/home/contracts.ts`: add `AttentionItem` + dismissal types.
2. `lib/home/attention.ts` (new): feeder interface, scoring (§4.2 formula), dedupe, sort, dismissal filtering. Pure functions; unit-test scoring, dedupe, TTL, band-resurfacing in `tests/home-attention.test.ts`.
3. Convert feeders: extract item-emitting functions from the data paths of recommended-actions / `threats.ts` / watchlist alerts / calendar / scanner. Feeders transform digest slices only — no fetching.
4. `lib/db.ts`: `attention_dismissal` table + CRUD; `app/api/home/attention/dismiss/route.ts`.
5. Wire the queue into the digest build (`lib/home/digest.ts`).
6. New modules: `book.tsx` (lift ring + stats from portfolio-pulse/performance), `attention-queue.tsx`, `radar.tsx` (lift from opportunity-feed + watchlist-intelligence buy list).
7. Registry/types/module-map/layout: register 3 new ids, retire 11, rebuild `HOME_LAYOUT` per §9. Update `tests/home-registry.test.ts`.
8. Delete retired module components; keep their lib engines (now feeder inputs). Add ResumeChip to the brief footer (reads the `continue` data path).
9. States, interactions, animation, a11y per §11–§17. Verify with `/verify` against a running dev server: dismiss, clear state, keyboard path, Ollama-down paint.

**Phase B — IA repair:** rewrite `NAV` in `nav-config.ts` per §4.3; create `app/knowledge-graph/page.tsx` hosting the existing components; `/intelligence` → redirect (one release); delete `app/comps/` after an import sweep; re-point registry `navTarget`s; add the dead-route validator check.

**Phase C — Symbol spine:** extend `lib/ios-context.tsx` (verify fit first) with focus-symbol state (sessionStorage-backed); palette symbol-first mode in `command-palette.tsx`; prefill wiring in each `symbolParam` page.

**Phase D — Idea lifecycle v1:** schema migration in `lib/db.ts` (`stage`, `stage_changed_at`, default `surfaced`); auto-transitions in the buy/sell transaction paths (`lib/portfolio/engines/transaction.ts`); pipeline board tab on `/portfolio`; Journal prompt on transition; migrate `thesis-evolution-panel` from `app/timeline/_components/` into Journal; then retire `app/timeline/`.

**Explicit non-goals:** drag-drop dashboard configuration; AI-ranked queue; mutations executed directly from queue cards; swipe gestures; any new cache outside `lib/platform/`; any shadcn tooling.

---

*End of specification. Hand this document to Opus with Phase A as the first work order.*
