# Knowledge Graph: What Comes Next

What I would build next, in order, and what I deliberately chose not to
build in this pass and why.

## Build next (highest leverage first)

1. SHIPPED (2026-08-02): the look-through overlap engine
   (lib/knowledge-graph/overlap.ts). Per-security effective weight =
   direct + sum(fund book weight x disclosed holding weight), fund/fund
   overlap pairs, HOLDS edges in the portfolio graph, an inspector section
   with the floors-not-totals caveat, and a curated cross-listing identity
   map (2330.TW -> TSM etc.) so international fund disclosures match ADR
   positions. Remaining extension: per-sector look-through aggregation and
   a deeper-than-top-10 holdings source.
2. Contagion / blast radius. "If TSM breaks, what moves?" needs pairwise
   return correlations. lib/portfolio-analytics.ts already computes
   correlation; wire it into edges (CORRELATES_WITH, weight = coefficient,
   window labeled) and rank propagation by |rho| x position weight. I did
   not fabricate this from the current edge set because ownership and
   classification edges are not impact estimates, and the mission forbids
   invented numbers.
3. Second-order neighbors. Scanner causal chains already surface one-hop-out
   tickers; rank them by connection strength to held names and show a
   "watch next" list in the inspector summary.
4. Persisted saved views. The URL already carries the full view state, so a
   saved view is just a named URL plus optional pinned node positions
   (kg_snapshot-style table keyed by view name).
5. Progressive exploration (double-click to expand a node's neighborhood
   in place). Needs an incremental subgraph endpoint
   (?expand=nodeId&hops=1); the builder is already shaped for it.
6. Command palette scoped to the graph (jump to node, toggle filter, switch
   layout). app/_components/command-palette.tsx exists to extend.
7. Label collision resolution (simulated-annealing or greedy occlusion
   pass) for dense event clusters, plus leader lines past ~80 nodes.
8. Fullscreen mode (requestFullscreen on the canvas container) and a
   hop-depth filter once expansion (5) exists.
9. Thesis linkage UI. SUPPORTED_BY / CONTRADICTED_BY edges now render
   distinctly (green/red), but the Journal/thesis store they should attach
   to was removed from the app in an earlier cleanup (app/journal deleted).
   When a thesis store returns, edge generation in build.ts has the seam
   ready (event.thesisImpact already drives edge type).

## Deliberately not built, and why

- Canvas/WebGL renderer. Measured scopes peak at 55 nodes; SVG holds 60fps
  at 3x that. Building a second renderer now would be speculative
  complexity; the threshold (~150 nodes) and the escape hatch are
  documented in graph-canvas.tsx.
- Event date-range filter. Each scope carries at most 6 events per symbol
  (top-importance); a date filter over that sample would imply a
  completeness the data does not have. The right fix is a deeper event
  endpoint first.
- Fuzzy search in the highlight box. Substring over label+summary covers
  the realistic queries at this graph size; a fuzzy matcher adds surprise
  for little gain at n<100.
- Automatic narrative on load. The AI read is on-demand: a 30s local-model
  call on every scope switch would make the tab feel broken, and an
  auto-generated wall of prose users did not ask for is exactly the
  "template as analysis" failure the mission bans. One click, labeled,
  model-attributed.
- "Add to watchlist" from the inspector. Write actions from a research
  surface need a confirm/undo pattern; Open in Research already lands on a
  page that has it.
- Persisting manually dragged positions by default. Deterministic layout
  already gives a stable mental map; persisting ad-hoc drags silently would
  turn every accidental drag into permanent state. Belongs with saved
  views (4).
- SIC-code ingestion for the taxonomy layer. Yahoo covers every symbol the
  app currently feeds the graph; EDGAR SIC mapping adds a second source of
  truth to reconcile without a consumer that needs it yet.

## Known remaining rough edges

- Watchlist scope caps at 36 of 61 names (surfaced honestly in the UI).
  Uncapping needs either pagination or renderer work item 7.
- Edge selection is session-local (not in the URL); node selection is.
  Edge ids contain "::" which URL-encodes uglily; acceptable trade.
- The dev-server watchlist cold build is ~1.6s (36 quote fetches). Warm
  cache is single-digit ms. A batch quote endpoint would cut the cold path.
- lib/intelligence/context.tsx no longer has any consumer (this page owned
  it). Left in place rather than deleted because the user's uncommitted
  work is mid-refactor across the app; delete in a cleanup pass.
