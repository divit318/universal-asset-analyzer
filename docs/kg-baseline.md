# Knowledge Graph v1: Ground Truth Baseline

Recorded 2026-08-02, before any change, on branch `feat/knowledge-graph-v2`.
All numbers measured against the running app (port 3000) and the live
`data/app.db`. Findings are numbered KGC-01 onward; the Phase 1 defect list
from the mission brief is triaged separately in `docs/kg-changelog.md`.

## 1. Feature map and data flow

```
/knowledge-graph (app/knowledge-graph/page.tsx, client)
  reads ?scope=&id= -> IntelligenceProvider (lib/intelligence/context.tsx)
  '- GraphView (app/knowledge-graph/_components/graph-view.tsx)
      |- GraphScopeSwitcher (_components/graph-scope-switcher.tsx)
      |    scope tabs + SymbolSearch + GICS sector chips
      |- highlight input + static legend (7 types, in graph-view.tsx)
      |- GraphCanvas (_components/graph-canvas.tsx)
      |    d3-force simulation + hand-rolled SVG pan/zoom/drag
      |- NodeDetailPanel | ConnectionExplainer (right column, mutually exclusive)
      '- InsightsPanel (bottom card row)

fetch /api/knowledge-graph?scope=&id=
  '- app/api/knowledge-graph/route.ts
      '- getKnowledgeGraph (lib/knowledge-graph/index.ts)
          |- cache: scanner_cache row "kg:<scope>:<ID>", 15 min TTL
          |- buildGraph (lib/knowledge-graph/build.ts)
          |    |- buildSymbolGraph    getFundamentals + listTimelineEvents
          |    |                      + sector rotation snapshot + scanner snapshot
          |    |- buildPortfolioGraph listPortfolio (portfolio_lot aggregate, cap 12)
          |    |- buildWatchlistGraph listWatchlist (cap 12 of 61)
          |    '- buildSectorGraph    rotation snapshot + portfolio/watchlist joins
          '- computeGraphInsights (lib/knowledge-graph/recommend.ts)

fetch /api/knowledge-graph/explain?scope=&id=&from=&to=
  '- app/api/knowledge-graph/explain/route.ts
      '- explainConnection (lib/knowledge-graph/traverse.ts)
          |- findPath: undirected BFS (pure)
          '- runPrompt("knowledge-graph-explain") via lib/ai (Ollama)

Types: lib/knowledge-graph/types.ts (GraphNode/GraphEdge/KnowledgeGraph)
Tests: tests/knowledge-graph.test.ts (traverse + recommend only; build.ts untested)
```

Data sources feeding the graph: `fundamentals_cache` (Yahoo quoteSummary),
`timeline_event` (per-symbol event store, 1,900+ rows), the singleton
`scanner_snapshot` (last auto-scan), `sector_rotation_snapshot` (1 row),
`portfolio_lot` (26 distinct symbols), `watchlist` (61 rows).

## 2. Measured baseline, per scope

Measured via `scripts/kg-baseline-audit.mjs` against the live API (fresh
build, cache cold except where noted).

| Scope | Nodes | Edges | Orphans (deg 0) | Event orphans | Build ms |
|---|---|---|---|---|---|
| symbol:AAPL | 20 | 3 | 16 | 6 of 6 | 67 (cached) |
| symbol:SKHY | 13 | 2 | 10 | 0 | 4 |
| symbol:USDCHF=X | 3 | 2 | 0 | 0 | 9 |
| portfolio | 23 | 22 | 0 | 0 | 3 |
| watchlist | 23 | 24 | 0 | 0 | 2 |
| sector:Technology | 17 | 8 | 10 | 0 | 1 |

Other measured facts:

- KGC-01 symbol:AAPL renders 6 timeline_event nodes and 0 edges to AAPL.
  Root cause found in code: `buildSymbolGraph` runs `addTimelineEvidence`
  inside `Promise.all` BEFORE `companyNode(symbol)` is upserted, and
  `GraphBuilder.addEdge` silently drops any edge whose endpoint node does
  not exist yet (build.ts:52). Every event->company edge in symbol scope is
  discarded. This is the single worst defect: the feature's core premise
  (events connected to entities) fails silently.
- KGC-02 10 sector nodes at degree 0 in symbol and sector scopes:
  `addSectorRotationEdges` upserts all 11 sectors unconditionally but only
  adds ROTATES_TO edges for |rankChange| >= 2 pairs (build.ts:146). The full
  sector universe is seeded regardless of scope.
- KGC-03 Two sector taxonomies confirmed: portfolio/watchlist scopes emit
  Yahoo assetProfile names ("Basic Materials", "Financial Services");
  symbol/sector scopes emit rotation-engine names ("Materials",
  "Financials"). Same sector, two node ids. `canonicalizeSector()`
  (lib/gics-sectors.ts) exists but is never called by the KG builder.
- KGC-04 Correlation clusters are byte-identical across symbol:AAPL,
  symbol:SKHY and sector:Technology (verified: same JSON). They derive from
  sector nodes present in the graph, and the graph always contains the full
  11-sector universe in those scopes. In portfolio scope the panel is
  missing entirely (Yahoo-taxonomy sector nodes carry no rotation
  `classification` metric, so the cluster computation yields []).
- KGC-05 Duplicate labels "10-Q: 10-Q" x2 in every scope that shows filings.
  Filing titles are built as `${form}: ${description}` (lib/timeline.ts:249)
  and SEC descriptions are frequently the form name again. Node ids do NOT
  collide (they derive from accession numbers), only labels do.
- KGC-06 SKHY: Yahoo classifies SKHY as EQUITY "SK hynix Inc."
  (Semiconductors / Technology). Verified against Yahoo search API. The
  mission brief's claim that SKHY is a short-term high-yield corporate bond
  ETF is not reproducible; it appears to conflate SKHY with SPHY / SCYB
  (bond ETFs that are also on this watchlist). However the underlying class
  of bug is real: there is no instrument-type concept anywhere in the model,
  so USDCHF=X (an FX pair) renders as a "Company", bond ETFs like SPHY get
  `sector: null` and silently lose their classification edge, and futures
  (HO=F) and crypto (USDT-USD) on the watchlist would all render as
  companies.
- KGC-07 The `insights.concentrationRisks` panel and the sector-scope graph
  disagree ("Technology, 2 holdings: AAPL, TSM" vs 4 rendered members)
  because concentration only counts OWNS->OPERATES_IN chains within the
  loaded graph, while the sector graph adds scanner-opportunity tickers with
  a different edge shape.
- KGC-08 Portfolio scope: `listPortfolio()` aggregates `portfolio_lot` (26
  distinct symbols including GLD, DBC, USDCHF=X, BTC-USD) but the builder
  caps at MAX_HOLDINGS=12 with no indication that 14 holdings were silently
  dropped. Watchlist: 12 of 61 shown, no indication.
- KGC-09 Position size, cost basis, P&L, weight: absent from every node and
  edge. All OWNS edges are strength 70 confidence 100 regardless of whether
  the position is 0.1% or 40% of the book.
- KGC-10 Legend advertises 7 node types; only company, sector,
  portfolio/watchlist, timeline_event ever rendered in the 6 audited scopes
  (market_event, opportunity, thesis appear only when the scanner snapshot
  contains matching tickers; it currently rarely does).
- KGC-11 The 15-minute KG cache lives in `scanner_cache`, a table globally
  pruned by unrelated writers; a cached graph also pins stale insights.
  Additionally `kg:<scope>:<id>` uppercases sector ids ("TECHNOLOGY") while
  the sector route validates case-sensitively, which is harmless today only
  because both read and write uppercase.

## 3. Rendering and interaction baseline (code inspection + DOM)

- Re-renders per keystroke in the highlight box: 1 full re-render of
  GraphView INCLUDING GraphCanvas (unmemoized component, new
  highlightedNodeIds Set per keystroke; every SVG node/edge re-created).
  There is no debounce; the match scan is O(nodes) per keystroke, which is
  fine at n=23 but does full-tree SVG reconciliation.
- Force simulation restart: does NOT restart on highlight/selection changes
  (effect keyed on `[nodes, edges]`, which are referentially stable per
  fetch). It DOES fully restart on every scope/id change (expected) and on
  drag (alphaTarget 0.15, expected).
- Fit-to-view: implemented and called on simulation `end` (graph-canvas.tsx:156)
  and on container resize. The mission-brief screenshots predate this fix.
- Settle time: alpha default decay, ~300 ticks x 20 nodes; sub-second wall
  time, but positions stream through React state every tick (setPositions
  per tick = ~300 sequential renders during settle).
- Layout: non-deterministic (d3 default phyllotaxis start + random jitter),
  not persisted; every visit produces a new arrangement.
- Renderer: pure SVG. No culling. At n<100 this is fine; canvas threshold
  never considered.
- Labels: drawn only for selected/connect-from/r>=14 nodes at 10px
  monospace `var(--foreground)` on `--surface`; passes AA (measured 15.4:1
  dark theme) BUT labels are suppressed for most nodes, so identification
  requires hover (native <title> only, ~600ms delay, no styling).
- Dimmed state: non-highlighted nodes at opacity 0.2 including label =>
  effective contrast ~2.9:1 on dark theme. Fails AA.
- Hint text `text-muted/70` at 10px: `--muted` is #8b93a7 at 70% on #101318
  => ~3.4:1. Fails AA for body text.
- Legend dots 8px + 10px text-muted: ~4.6:1, passes AA large-text only
  marginally; legend is purely decorative (no counts, no filtering).
- Node hit targets: min radius 7px => 14px diameter. Below the 24px
  guideline.
- Color coding: type encoded by fill color alone; no shape/glyph channel.
  accent(blue)/chart-1(purple)/chart-2(orange) at these sizes are hostile
  to protan/deutan viewers.
- Keyboard: zero graph keyboard support. No focusable nodes, no ARIA roles,
  no table alternative. Zoom buttons are focusable but 24x24px with no
  shortcuts, no percentage readout, no reset.
- prefers-reduced-motion: not consulted; simulation always animates.
- Empty/error states: API errors render an inline red box (exists); empty
  watchlist/portfolio produce a 1-node graph with no explanatory empty
  state; invalid ticker returns 400 "Invalid symbol" only for charset
  violations, otherwise builds a 1-node orphan graph for any string.
- URL: `?scope=&id=` synced via router.replace (back/forward collapse);
  bare /knowledge-graph never receives params; `id=portfolio` redundant for
  singleton scopes; symbol input does not sync FROM the URL param on load
  when scope != symbol default mismatch. No other view state (selection,
  filters, zoom) is in the URL.
- Bundle: d3-force only (~10 KB gzip) plus hand-rolled SVG. No heavy graph
  library. This part is healthy.

## 4. Copy baseline

- Page subtitle: "How your names connect [em dash] companies, sectors,
  events, and theses." Contains an em dash; "your names" is vague.
- Filing labels: "10-Q: 10-Q", "6-K: FORM 6-K" (duplicated form names, no
  issuer/date on the label).
- Edge rationale for classification edges: "<SYM> is classified under
  <sector>" for every OPERATES_IN edge; template, not analysis.
- "Confidence: 100%" possible on OWNS edges (hard-coded 100).
- Correlation terms (Lagging/Leading/Weakening/Strengthening) shown with no
  definition, window, or coefficient anywhere in the UI.

## 5. What already works and should survive

- The evidence-consumer principle (graph composed from existing engines,
  nothing fabricated) is the right architecture and is kept.
- findPath BFS + describePath are pure, tested, and correct.
- "AI narrates, engines decide" split in traverse.ts is correct.
- Fit-to-view, non-scaling edge strokes, ResizeObserver sizing.
- SymbolSearch autocomplete already exists in the scope switcher (the
  full-width dumb input in the brief's screenshots predates it).
- The route-level validation of scope/id/symbol charset.
