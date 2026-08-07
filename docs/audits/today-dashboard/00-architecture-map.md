# 00. Architecture Map: the Today dashboard (`/`)

As of 2026-08-08, branch `f22/day-change`. Evidence: file paths and line numbers below; runtime evidence from a live cold load against `next dev` on :3000 (waterfall captured with `docs/audits/today-dashboard/tools/waterfall.mjs`) and a live digest sample (`/api/home`, 79.7 KB).

## 1. Component tree

```
app/page.tsx (49 lines, "use client", zero logic)
└── PageShell (app/_components/ui)
    └── HomeProvider (app/_home/home-provider.tsx)         one context, two datasets
        ├── HomeHeader (app/_home/home-header.tsx)          h1 "Today" + date + generatedAt
        └── ModuleGrid (app/_home/module-grid.tsx)          walks HOME_LAYOUT config
            ├── [command row]
            │   ├── TodaysBriefModule    (modules/todays-brief.tsx, 409 ln)   span 8/12
            │   └── BookModule           (modules/book.tsx, 367 ln)           span 4/12
            ├── [changes band]
            │   └── WhatsChangedModule   (modules/whats-changed.tsx, 162 ln)  span 12/12
            ├── [attention row]
            │   ├── AttentionQueueModule (modules/attention-queue.tsx, 779 ln) span lg7/xl8
            │   └── RadarModule          (modules/radar.tsx, 273 ln)           span lg5/xl4
            ├── [tape]
            │   └── MarketOverviewModule (modules/market-intelligence.tsx, 420 ln) span 12
            └── [the long read]
                └── AiInvestmentBriefModule (modules/ai-investment-brief.tsx, 517 ln)
                    span 12, collapsible, defaultCollapsed
```

Shared infra used by the modules:

- `app/_home/module-shell.tsx` (225 ln): card chrome, collapse, degraded footer.
- `app/_home/_viz/`: `sparkline.tsx`, `radar.tsx`, `bars.tsx`, `feed-row.tsx`, `primitives.tsx`, `stamped.tsx`, `format.ts` (a second, page-local formatter beside `lib/format.ts`).
- `app/_home/_atmosphere/`: `explain-popover.tsx` (score decompositions), `symbol-link.tsx` (hover context joins on `digest.symbolContext`), `use-count-up.ts`, `stream-primitives.tsx`, `use-hydrated.ts`, `popover-position.ts`.
- `app/_home/use-record-activity.ts`: records page visit into the activity log.

Registry/layout plumbing (server-safe, no React):

- `lib/home/registry.ts`: module metadata, priorities, cache policy, `validateRegistry()`.
- `lib/home/layout.ts`: `HOME_LAYOUT` groups/spans; the ONLY place position lives.
- `lib/home/types.ts`: `HomeModuleId`, breakpoints, sizes.
- `app/_home/module-map.ts`: id -> component; `validateHomeComposition` keeps map and registry in lockstep (tests/home-registry.test.ts).

## 2. Data flow: one digest, one brief

Client requests (all fired from the browser; the page is fully client-rendered):

| Request | Fired by | Feeds |
|---|---|---|
| `GET /api/home` | `HomeProvider` via `useDataset("home.digest")` | all seven modules (deterministic paint) |
| `GET /api/home/brief` (NDJSON stream) | `HomeProvider` via `useDataset("home.brief")` | Today's Brief headline + AI Investment Brief + pulse summary |
| `GET /api/portfolio/report?objective=maximize_sharpe` | `lib/ios-context.tsx:164` (IOS provider in the app layout) | NOT the home page; global IOS context. Duplicates the report build the digest just did server-side |
| `POST /api/home/attention/dismiss` | AttentionQueueModule on dismiss | persists dismissal, TTL per kind |
| `POST /api/home/activity` | use-record-activity | visit log |
| `GET /api/auth/session`, `/api/settings/ai-providers`, `POST /api/monitor/run` | layout chrome | not dashboard-specific |

Server side, `GET /api/home` -> `buildHomeDigest()` (`lib/home/digest.ts:160`) runs a `runPlan()` DAG with 20s timeout:

```
ctx (gatherContext: legacy report, rotation, regime, watchlist alerts, scanner)
report (buildPortfolioReport: THE universal engine - health, risk, decisions)
calendar, watchlist, notifications          (SQLite reads)
performance (buildPerformance: lots + Yahoo quotes + SPY history -> XIRR engine)
equityCurve (90d daily portfolio index vs SPY)
market <- ctx (tape groups, sentiment gauge, breadth, regime, sector attention)
```

then composes pure projections:

- `buildPortfolioPulse(report)` (`lib/home/pulse.ts`): health, day P&L, movers, contributors, radar, cash, drift.
- `buildRecommendedActions(report, alerts, notifications)` (`lib/home/actions.ts`).
- `buildThreats(report)` (`lib/home/threats.ts`).
- `buildAttribution(report, benchmark)` (`lib/home/attribution.ts`): cumulative, on cost basis.
- `buildAttentionQueue({feeders})` (`lib/home/attention.ts`): 5 feeders (actions, threats, alerts, events, signals) -> dedupe -> geometric score (impact^a * urgency^b * confidence^c) -> dismissal filter.
- `buildChangeFeed` (`lib/home/changes.ts`): fingerprint diff vs last-visit baseline (SQLite persisted; VISIT_GAP promotion).
- `buildMarketIntelligence` (`lib/home/market-intel.ts`) + `computeSentiment` (`lib/home/sentiment.ts`): in-house gauge (VIX + breadth + SPY momentum).
- `buildWatchlistIntelligence`, `buildTimelineFeeds`, `buildRecentActivity`, `buildSymbolContext`, `deterministicBriefing` (fallback prose, ships in digest).

Contracts crossing the wire: `lib/home/contracts.ts` (760 ln). Every slice carries its own `status: CardStatus` ("ok" | "empty" | "degraded" | "stale"), so each source degrades alone (orchestrator isolates step failures).

## 3. Data sources and freshness guarantees

| Source | Path | Freshness |
|---|---|---|
| Yahoo Finance quotes | `lib/yahoo.ts` via platform registry | 15s TTL (quotes.batch); history cached per day |
| Universal portfolio report | `lib/portfolio/report.ts` | rebuilt per digest call; separately cached 5 min for `/api/portfolio/report` (`lib/portfolio/context.ts`) |
| Legacy report + regime + rotation | `lib/mission-control.ts gatherContext()` | scanner snapshot freshness carried in payload |
| Scanner (The Wire) | SQLite snapshot | `scannerFreshness` stamps; signals surface as radar/queue items |
| Watchlist alerts | alert engine via ctx | evaluated on digest build |
| Macro calendar | `lib/calendar.ts` | static + earnings dates, 14-day window in digest |
| Notifications | SQLite | live |
| SEC EDGAR | not on this page (research surfaces only) | n/a |
| LLM inference | `/api/home/brief` -> `runAnalysis(taskType: "daily-briefing")` -> provider chain (devin -> anthropic -> ... -> ollama) | cached ~1h per portfolio-state key in scanner_cache; serve-time re-grounding check |
| Session clock | `lib/market-hours.ts estimateMarketStatus("US")`, per-metric `sessionDate` stamps (`lib/metric.ts`, `lib/day-change.ts`) | each Metric carries sessionDate + asOf |

## 4. The request waterfall (measured cold load, dev build)

```
t=0        document GET /  (2.9s dev-compile inclusive)
t≈11.1s    hydration completes; four fetches fire in parallel:
             /api/settings/ai-providers (313ms)
             /api/monitor/run (359ms)
             /api/auth/session (1.6s)
             /api/home (13.9s cold; all engines rebuild)
             /api/portfolio/report (13.3s; IOS context, REDUNDANT with digest's internal build)
t≈16.5s    /api/home resolves -> whole page paints from skeletons at once
t>16.5s    /api/home/brief fires (stream); headline replaces fallbackBriefing when done
```

Notes: nothing is server-rendered; the page is a client shell. The digest is one request by design (good), but it is also one BLOCKING request: no module paints until every engine in the plan finishes or times out. The brief is independent (good). ~7.7 MB of JS over 30 script requests on a dev load.

## 5. LLM calls on this page

Exactly one model call per cache window: `generateHomeBrief()` (`lib/home/brief.ts:260`).

- Prompt: `buildHomeBriefPrompt()` (`lib/home/brief.ts:119`). Inputs: regime line, rotation leaders/laggards, portfolio facts (grade, total, today %, concentration count, top recommendation), unread count. The model is handed pre-computed values and asked for JSON sections (headline, portfolioSummary, note{regime, opportunities, risks, portfolio, sectors, macro, recommendations[3-5]}).
- Grounding: `verifyGroundingWithFacts()` on tagged facts; a "low" grounding level discards the generation and serves `deterministicBriefing()`.
- Cache: key = hour + healthGrade + healthTotal + alertCount + rotation asOf + regime trend, stored in `scanner_cache` (SQLite). Cached prose is re-grounded at serve time against current facts.
- Failure mode: every path (no key, parse fail, grounding fail, throw) lands on the deterministic briefing with `aiGenerated: false`. The digest itself never touches AI.
- Cost per render: zero on cache hit; one `daily-briefing` call per state-change per hour otherwise.
- Consumers: Today's Brief (headline), AI Investment Brief (note sections), pulse summary line. One call, three surfaces.

## 6. State matrix (from code; the state audit verifies each visually)

| State | What the code does |
|---|---|
| New user, no portfolio | `portfolioPulse.status = "empty"` (pulse.ts:21); performance `status:"empty"`; actions `hasPortfolio:false` distinguishes "nothing to optimize" from "no book"; brief prompt says "No portfolio is tracked." |
| Empty watchlist | watchlistIntelligence empty buckets; radar falls back to scanner-only items |
| Stale scanner cache | `scannerFreshness` stamps; opportunity feed carries staleness; queue signal confidence decays with observation age (attention.ts) |
| Failed upstream | per-step isolation in `runPlan`; slice ships `status:"degraded"`; module-shell renders degraded footer; `attention.degradedFeeders` names dead feeders |
| Weekend/holiday | `sessionNote` ("Markets closed - Fri, Aug 7 close") from stamped Metrics; `estimateMarketStatus` gates event urgency |
| Market open | 60s interval refresh on market-intelligence only (registry.ts:164) |
| Partial data | health dimensions abstain (`covered:false`), weights renormalize; sentiment drops dead components and lowers confidence |
| LLM down/slow | deterministic fallback already on screen; brief stream replaces it if/when it lands |

## 7. Authoritative engines (what the page must NOT re-derive)

- Health/grade: `lib/portfolio/engines/health.ts` via universal report.
- Day change: stamped `Metric<"day">` from `lib/day-change.ts` (session-aware).
- XIRR + benchmark: `lib/portfolio-performance.ts` (ratios, x100 at digest boundary, digest.ts:125).
- Total return on cost: `report.totalReturn` (same field /portfolio renders, pulse.ts:283).
- Recommendation bands: `lib/recommendation.ts`.
- Scores explained client-side by pure projections in `lib/home/explain.ts` (popover).

## 8. Structural observations carried into the audits

1. Two return systems on one card: `performance.totalReturnPct` (lot ledger), `pulse.totalReturnOnCostPct` (report), `performance.xirrPct` (money-weighted), `equityCurve.portfolioPct` (90d TWR-ish index) render adjacent with mixed labels. (-> 01)
2. `openCount` (19) vs brief "Actions 1" vs "three unread alerts" in prose: three different collections narrated as one concept. (-> 01, 02)
3. Cash concentration story appears in: brief prose, brief "watch today" sentence, book card cash stat, next-best-step card, queue action row, threats-derived queue item, and the long read risks/observations/recommendations. (-> 02)
4. Signal rows all read "X fits your book" at 65-67: `rankByFit` blend compresses the range; scale meaning and cross-kind comparability of the queue score is unvalidated. (-> 03)
5. Sentiment "Extreme Greed" beside VIX "Normal volatility": the gauge's largest component IS low VIX; the two tiles narrate the same input in opposite tones with no linkage. (-> 01, 04)
6. `lib/ios-context.tsx` re-fetches the full report client-side on the same page load that already built it server-side. (-> 09)
7. No dashboard usage instrumentation found in `app/_home/` beyond visit recording. (-> 13)
