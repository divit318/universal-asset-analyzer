# Knowledge Graph: Inventory (Phase 0)

Recorded 2026-08-08 against the live app (port 3000) and the live `data/app.db`,
before any change in this mission. The feature received a "v2" rebuild on
2026-08-02 (see docs/kg-architecture.md, docs/kg-changelog.md); this mission
audits the v2 code as it stands, because live data has since exposed defect
classes the v2 pass did not cover.

## 1. Every file that participates

| File | Lines | Role |
|---|---|---|
| `app/knowledge-graph/page.tsx` | 118 | URL-state owner. scope/id/layout/view/q/hide/min/sel in query string; push on focus change, replace on view change |
| `app/knowledge-graph/_components/graph-scope-switcher.tsx` | 88 | Scope tabs + SymbolSearch + GICS sector chips |
| `app/knowledge-graph/_components/graph-view.tsx` | 519 | Orchestrator: fetch, filters, legend, toolbar, layout switch, exports, canvas/table/inspector composition |
| `app/knowledge-graph/_components/graph-canvas.tsx` | 696 | SVG renderer: d3-force + radial layouts, pan/zoom/drag, hover, keyboard traversal, label occlusion, PNG export |
| `app/knowledge-graph/_components/graph-model.ts` | 80 | Visual language: NODE_VISUAL (shape+color per type), EDGE_VISUAL (color+dash per relation), nodeRadius, hashAngle |
| `app/knowledge-graph/_components/graph-table.tsx` | 109 | Table alternative (nodes + edges) |
| `app/knowledge-graph/_components/inspector.tsx` | 714 | Right rail: summary (stats/changes/look-through/concentration/clusters/risks/opportunities/AI read), node inspector, edge inspector, path panel |
| `app/api/knowledge-graph/route.ts` | 58 | GET graph; validates scope/id; canonicalizes sector |
| `app/api/knowledge-graph/explain/route.ts` | 37 | GET path explanation between two node ids |
| `app/api/knowledge-graph/narrative/route.ts` | 33 | GET AI narrative |
| `lib/knowledge-graph/types.ts` | 266 | The one schema (client-safe; no I/O imports) |
| `lib/knowledge-graph/index.ts` | 93 | Entry: 15-min cache (`kg2:` keys in scanner_cache), 18h snapshot cadence + diff |
| `lib/knowledge-graph/build.ts` | 911 | GraphBuilder + 4 scope builders + evidence providers |
| `lib/knowledge-graph/instrument.ts` | 160 | Instrument resolution (symbol shape → Yahoo quoteType → fund-name heuristic); fund sector exposures |
| `lib/knowledge-graph/label.ts` | 68 | Label policy (filing dedup, word-boundary clip, symbol prefixes) |
| `lib/knowledge-graph/overlap.ts` | 206 | Look-through engine (pure core + Yahoo topHoldings fetch, cross-listing identity map) |
| `lib/knowledge-graph/recommend.ts` | 137 | Insights: concentration, hidden opportunities, emerging risks, correlation clusters, stats |
| `lib/knowledge-graph/traverse.ts` | 236 | BFS shortest path, ranked multi-path DFS, AI path narration |
| `lib/knowledge-graph/diff.ts` | 53 | Pure snapshot diff |
| `lib/knowledge-graph/narrate.ts` | 100 | AI narrative with enforced node-id citations |
| `tests/knowledge-graph.test.ts` | 526 | Builder invariants, taxonomy, instruments, labels, paths, insights, diff, AI parsing |
| `tests/kg-overlap.test.ts` | 118 | Look-through engine |
| `scripts/kg-baseline-audit.mjs` | 52 | Per-scope node/edge/orphan counter against the live API |

Total: ~5,400 lines. Shared UI consumed: `SymbolSearch`, `PageShell`/`PageHeader`,
theme tokens from `app/globals.css`. External graph dependency: `d3-force` only.

## 2. Data path per scope (URL → SVG)

All four scopes share: page.tsx parses URL → GraphView fetches
`/api/knowledge-graph` → route validates → `getKnowledgeGraph` (15-min cache in
`scanner_cache` under `kg2:<scopeKey>`) → `buildGraph` → `computeGraphInsights` →
`computeChanges` (kg_snapshot, ≥18h cadence) → JSON → GraphView filters
(hiddenTypes, minStrength, isolate re-prune) → GraphCanvas (d3-force or radial)
→ SVG.

- **symbol:SYM** — `getFundamentals(SYM)` (fundamentals_cache/Yahoo) +
  `listTimelineEvents(SYM)` top 6 by importance → `resolveInstrument` (Yahoo
  quote) → asset node + event nodes/edges → `addClassificationEdges` (sector
  node + OPERATES_IN, or weighted EXPOSED_TO for funds) →
  `addSectorRotationEdges` (rank-delta pairs) → portfolio/watchlist membership
  edges → `addScannerEvidence`: cached scanner snapshot events matching
  `affectedTickers ∋ SYM` or sector match, **plus the full causal chain of every
  matching event** (every chain ticker becomes a `bareAssetNode`, instrument
  "unknown", no quote fetch; every chain sector becomes a sector node).
- **portfolio** — `listPortfolio()` (aggregated `portfolio_lot`, closed
  positions excluded, **asset_class column dropped**) → per holding:
  `getFundamentals` + `resolveInstrument` (live quote), market-value weights
  (cost fallback), classification edges, top-3 timeline events →
  look-through: `fetchFundHoldings` per fund → `computeLookThrough` → HOLDS
  edges; underlyings not already present enter as `bareAssetNode` (unknown).
- **watchlist** — same shape, cap 36 of N, no weights, no look-through.
- **sector:NAME** — rotation snapshot node + rotation edges + tracked
  (portfolio ∪ watchlist) members classified into it + tracked funds with
  ≥5% measured exposure + scanner events touching the sector + opportunities
  for tickers already present.

## 3. State, caching, external APIs

- Server caches: graph JSON 15 min (`scanner_cache`), Yahoo quote/quoteSummary
  via the platform cache (lib/yahoo.ts), fundamentals_cache 24h,
  scanner_snapshot written by the Wire auto-scan, kg_snapshot ≥18h per scope.
- Client state: React in GraphView (selection, search, filters, layout, view)
  mirrored to URL; GraphCanvas owns transform (pan/zoom, NOT in URL), positions,
  hover, keyboard focus.
- External hits per cold build: 1 quote per asset node + 1 quoteSummary
  (topHoldings) per fund + fundamentals per symbol. Warm-cache builds are
  single-digit ms; cold portfolio ~0.7s, cold sector ~1.2s.
- AI: `knowledge-graph-explain` task via runPrompt for path narration and
  narrative only. All numbers deterministic.

## 4. Duplication / divergence across scopes

- Membership edges: symbol scope builds OWNS/WATCHES inline (strength 80/50),
  sector scope builds them in `addMembership` (strength 60), holdings scope in
  `buildHoldingsGraph` (weight-driven). Three code paths, three strength
  conventions for the same fact.
- Classification edges: `addClassificationEdges` (symbol/holdings) vs an
  inlined copy in `buildSectorGraph` (OPERATES_IN + EXPOSED_TO duplicated).
- Scanner event handling: symbol scope (`addScannerEvidence`, full chain
  fanout) vs sector scope (sector-edge only, no chain). The fanout asymmetry is
  the direct cause of the 74-node symbol hairball vs the 16-node sector graph.
- `bareAssetNode` (no resolution) vs `assetNode` (resolved): two node shapes
  for the same entity kind; whichever is upserted first wins.

## 5. Live measurements (2026-08-08, cache cold)

| Scope | Nodes | Edges | Focus degree | Max degree (node) | "unknown" instruments |
|---|---|---|---|---|---|
| symbol:AAPL | 74 | 92 | 9 | 45 (macro market_event) | 55 |
| portfolio | 32 | 44 | 14 | 14 (focus) | 1 (AVGO, via look-through) |
| watchlist | 51 | 66 | 24 | 24 (focus) | 0 |
| sector:Technology | 16 | 22 | 11 | 11 (focus) | 0 |

Ground truth from the ledger (`portfolio_lot.asset_class`): CASH-USD is the
app's synthetic cash convention (`cash`), BTC-USD `crypto`, IEF/USFR `bond`,
VNQ `reit`, VOO/VYM `etf`. The KG reads none of this: it re-derives class from
Yahoo, which resolves CASH-USD to "Litecash USD" (a micro-cap cryptocurrency)
— the user's $1.34M cash sleeve was valued at Litecash's price, corrupting
every portfolio weight in the graph.
