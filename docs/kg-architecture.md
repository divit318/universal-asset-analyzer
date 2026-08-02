# Knowledge Graph v2: Architecture

## Principles

1. Evidence consumer, not a new engine. Every node and edge is derived from
   data an existing UAA engine already computed (portfolio ledger, watchlist,
   timeline events, sector rotation, scanner snapshot, Yahoo quotes). The
   graph never fabricates a fact.
2. Unknown is a valid output. Confidence is `number | null` end to end; a
   null renders as "Unknown". Nothing in this module hard-codes a confidence
   score. Deterministic facts (you own X) carry no confidence at all because
   they are not probabilistic claims.
3. Zero orphans by construction. The builder queues edges and resolves them
   at build() time, then prunes every degree-0 node except the scope's focus
   node. No render-time cleanup is needed because a disconnected node cannot
   leave the builder.
4. One taxonomy. Every sector label passes through `canonicalizeSector()`
   (lib/gics-sectors.ts, GICS-11). Yahoo's assetProfile names ("Basic
   Materials", "Financial Services", "Consumer Defensive") are mapped at
   ingest. An unresolvable label produces NO sector node; the asset surfaces
   as "Unclassified" instead of joining a second taxonomy.

## Module layout (lib/knowledge-graph/)

| File | Role | I/O |
|---|---|---|
| `types.ts` | The one schema: GraphNode, GraphEdge, Provenance, InstrumentType, insights, changes, narrative types. | none (client-safe; UI imports values from here, never from index) |
| `instrument.ts` | Instrument resolution: symbol shape, Yahoo quoteType, fund-name heuristics; fund sector exposures from holdings composition. | Yahoo (platform-cached) |
| `label.ts` | Label policy: filing dedup ("AAPL 10-Q, filed 01 Aug 2025"), word-boundary clipping, symbol prefixes on shared headlines. | none |
| `build.ts` | GraphBuilder + the four scope builders. | db, Yahoo, scanner snapshot |
| `recommend.ts` | Pure insights: weighted concentration, hidden opportunities, emerging risks, windowed correlation clusters, graph stats. | none |
| `traverse.ts` | BFS shortest path, ranked multi-path DFS (`findPaths`), AI path narration. | Ollama via runPrompt |
| `diff.ts` | Pure snapshot diff (added/removed nodes and edges). | none |
| `narrate.ts` | AI narrative with enforced citations: claims that do not cite in-graph node ids are dropped server-side. | Ollama via runPrompt |
| `index.ts` | Entry point: cache (15 min, `kg2:` keys), daily snapshot + diff wiring. | db |

## Schema highlights

GraphNode: `id, type, instrument, label (short), fullLabel (never elided),
summary, importance (size), confidence (number|null), sector (canonical or
null), weight (0-1 book share or null), metrics, provenance, href`.

GraphEdge: `id, source, target, type, label, confidence (number|null),
strength (width), directed, evidence, provenance, timestamp`.

Provenance: `{ source: yahoo|sec_edgar|platform|..., origin:
computed|ai|user, asOf }`. Anything Ollama-generated carries `origin: "ai"`
and the UI labels it as such.

`type: "company"` remains the node type for all tradeable assets to keep the
`company:SYMBOL` id contract with existing consumers (Research's graph
preview card, the AI context builder). The `instrument` field is what
distinguishes an FX pair from a bond ETF from a common stock.

## Instrument resolution

Order of precedence:
1. Symbol shape (pure): `=X` FX pair, `=F` future, `^` index, `-P[A-Z]?`
   US preferred listing.
2. Yahoo quoteType: EQUITY, ETF, MUTUALFUND, CRYPTOCURRENCY, CURRENCY,
   FUTURE, INDEX.
3. For funds, the underlying asset class (bond/commodity/mixed/equity) is
   inferred from the fund name. This is a heuristic; it is recorded as
   `underlyingSource: "name-heuristic"` and never given a confidence number.

Unrecognized quoteTypes resolve to "unknown", not to equity. Sector policy:
only common equity and preferreds get a single-sector OPERATES_IN edge.
Funds get weighted EXPOSED_TO edges from Yahoo's holdings composition
(`topHoldings.sectorWeightings`, threshold 5%, top 4). FX, crypto, futures,
and indices get no sector edge: honest absence instead of a fake
classification.

## Scope builders

- symbol: focus asset + timeline events (top 6 by importance) + sector
  classification + rotation edges + portfolio/watchlist membership + scanner
  events/opportunities/theses.
- portfolio: ALL open positions (no silent cap), position weights from live
  market value (cost basis fallback, labeled), per-holding sector edges,
  fund exposures, top 3 timeline events each.
- watchlist: same shape, capped at 36 with `meta.truncation = {shown,total}`
  surfaced in the UI.
- sector: focus sector + rotation edges + tracked members classified into it
  + scanner events touching it. The v1 theme-substring join that pulled
  unrelated tickers into sector graphs was removed as unsound.

## Change detection

`kg_snapshot` (lib/db.ts): one row per scope key, updated at most every 18
hours, so `changes` means "since roughly yesterday", not "since the 15-minute
cache expired". Diff is pure (diff.ts) and rides on the graph payload; the
inspector renders it as the "Since your last visit" feed.

## Renderer decision

SVG + d3-force, one renderer. Measured scopes peak at 55 nodes / 86 edges;
React SVG reconciliation at that scale is well under one frame, and SVG keeps
native hit-testing, tooltips, and accessibility hooks that a canvas/WebGL
path would have to reimplement. The canvas is memoized (`React.memo`) so
toolbar/search state changes do not touch it; layout is seeded
deterministically by hashing node ids so the same graph lays out the same way
every visit. If a future scope exceeds ~150 nodes, add a canvas renderer
behind the same props; the threshold is documented in graph-canvas.tsx.

Two layouts:
- force: d3-force with deterministic seeding, gentle x/y centering so weakly
  connected nodes cannot drift to infinity, fit-to-view on settle.
- radial (default for portfolio/watchlist): focus centered, holdings ringed
  with position weight driving both radius (heavier = closer) and node size,
  satellites fanned outward from their parent.

`prefers-reduced-motion` runs the simulation synchronously (300 ticks) and
renders the settled layout once.

## Visual encodings

- Node type: shape AND color (circle asset, hexagon sector, diamond
  portfolio/watchlist, square event/thesis, triangle market event/
  opportunity/risk). The feature works in grayscale.
- Node size: importance / position weight.
- Edge relation: color + dash pattern; strength: width; direction: chevron
  at 62% along the edge.
- Selection: ring outline; hover: neighbor emphasis. Dimmed labels switch to
  the muted token (7.2:1 dark) instead of fading opacity below AA.

## URL contract

`/knowledge-graph?scope=&id=&layout=&view=&q=&hide=&min=&sel=`
- `id` omitted for singleton scopes (portfolio, watchlist).
- Bare visits are canonicalized to `?scope=symbol&id=AAPL`.
- Focus changes push history; view-state changes replace.
- Legacy inbound links (`?scope=watchlist&id=watchlist`) still work.

## AI usage

Three narrow, labeled jobs, all through `runPrompt`/`runPromptWithMeta` with
the `knowledge-graph-explain` task (light complexity, interactive latency):
1. Path narration (traverse.ts): narrates an already-computed path; the
   deterministic chain is always shown alongside.
2. Graph narrative (narrate.ts): 2-4 observations about the current graph;
   each must cite node ids present in the graph or it is dropped server-side;
   the answering model is attributed in the UI.
3. Nothing else. Classification, weights, paths, diffs, and insights are all
   deterministic.
