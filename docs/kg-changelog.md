# Knowledge Graph v2: Issue-by-Issue Changelog

Every defect from the mission brief, triaged against the code as found on
2026-08-02, plus additional findings (KGC-xx from docs/kg-baseline.md).
Verdicts: CONFIRMED (with root cause), PARTIAL, NOT REPRODUCIBLE,
ALREADY FIXED (the brief's screenshots predate the current code).

## Correctness

| Issue | Verdict | Action |
|---|---|---|
| URL `id` does not sync into the symbol input | CONFIRMED (graph-scope-switcher.tsx kept its own useState, never re-synced) | Input now syncs from scope/id on every change (effect in graph-scope-switcher.tsx) |
| Bare /knowledge-graph pushes no params | CONFIRMED | Canonicalized on mount to ?scope=symbol&id=AAPL |
| Redundant `id=portfolio` for singleton scopes | CONFIRMED | `id` dropped from URL and API for portfolio/watchlist |
| ~10 degree-0 sector nodes in symbol/sector scopes | CONFIRMED (addSectorRotationEdges seeded all 11 sectors, build.ts:146 v1) | Sectors only upserted when an edge is added; builder prunes all isolates. Measured: 0 orphans in every scope |
| Timeline/event nodes float disconnected from AAPL | CONFIRMED, root cause found: buildSymbolGraph added events (and their edges) inside Promise.all BEFORE the company node existed, and addEdge silently dropped edges with missing endpoints (v1 build.ts:52). All 6 of 6 AAPL events were orphaned | GraphBuilder now queues edges and resolves at build() time; ordering can never drop an edge again. Regression test in tests/knowledge-graph.test.ts |
| Concentration says 2 Technology holdings while the sector graph shows 4 members | CONFIRMED (KGC-07: scanner theme-substring join added unrelated tickers with a different edge shape) | Theme-substring join removed; concentration is computed from OWNS + canonical sector and now carries the combined weight |
| SKHY is a bond ETF classified as Technology | NOT REPRODUCIBLE as stated: Yahoo classifies SKHY as EQUITY "SK hynix Inc." (Semiconductors). The brief appears to conflate SKHY with SPHY/SCYB, which are on this watchlist. The underlying class of bug was real and fixed | Instrument resolver added; SPHY/SCYB/VCLT resolve as Bond ETF, GLD/DBC as Commodity ETF, and no fund receives a single-sector classification |
| No instrument-type concept at all | CONFIRMED | InstrumentType on every asset node: common equity, preferred, equity/bond/commodity/mixed ETF, mutual fund, FX pair, crypto, future, index, unknown |
| Inspector calls an ETF "a company", fixed template as analysis | CONFIRMED (v1 evidence string) | Classification evidence now states the source ("Yahoo Finance classifies X under Y"); fund edges state the measured holding weight; no template masquerades as analysis |
| "10-Q: 10-Q" labels, visually identical filing nodes | CONFIRMED (lib/timeline.ts builds `${form}: ${description}` and SEC descriptions repeat the form; ids do NOT collide, labels did) | Label policy in label.ts: "AAPL 10-Q, filed 01 Aug 2025"; description kept only when it adds information |
| USDCHF=X renders with Company styling and leaks the Yahoo suffix | CONFIRMED | Renders as "USD/CHF", instrument FX Pair, no sector edge |
| Correlation clusters byte-identical across scopes | CONFIRMED (clusters derived from the seeded 11-sector universe) | Clusters now derive from sectors actually in the scope's graph; verified different per scope |
| Correlation clusters missing in portfolio scope | CONFIRMED (Yahoo-taxonomy sector nodes carried no rotation classification) | Single taxonomy joins rotation metrics everywhere; portfolio scope now shows clusters |

## Data model

| Issue | Verdict | Action |
|---|---|---|
| Two sector taxonomies ("Basic Materials"/"Materials") | CONFIRMED (KGC-03) | canonicalizeSector() at every ingest point; Yahoo names added to LEGACY_SECTOR_MAP; verified identical sector sets across scopes |
| Legend advertises 7 types, only 4 render | CONFIRMED (market_event/opportunity/thesis appear only when the scanner snapshot matches) | Legend is now generated from the loaded graph with live counts; it never advertises types that are not present. Scanner evidence still populates market events/opportunities/theses when available (verified market_event renders in symbol and sector scopes) |
| Two oranges for one legend entry | PARTIAL (v1 used chart-2 for timeline and chart-4 for market events under one legend row) | Timeline Event and Market Event are separate legend entries with distinct shapes (square vs triangle) |
| Node radius varies with no documented meaning | CONFIRMED | Size = importance (documented in graph-model.ts); position weight drives size and radial ring in portfolio scope; inspector shows the numbers |
| All edges identical thin gray lines | CONFIRMED | Relation encoded by color + dash, strength by width, direction by chevron; edge legend semantics live in EDGE_VISUAL |
| Bare tickers vs long prose, no labeling policy | CONFIRMED | Label policy: assets short ticker + full "TICKER (Name)"; events "SYM <headline clipped on word boundary>"; filings normalized; fullLabel never elided (tooltips + inspector) |
| Inspector shows only edge rationale, no node metadata | CONFIRMED | Node inspector: instrument, price, change, sector, shares, avg cost, position value, valuation basis, unrealized P&L, book weight, provenance, as-of age |
| Portfolio graph encodes zero position information | CONFIRMED (KGC-09: 12 identical spokes, strength 70 confidence 100 hard-coded) | Weights from live market value (cost fallback, labeled); OWNS edge strength and evidence carry the weight; radial layout ranks by it |
| AI/editorial nodes carry no source/timestamp/model | CONFIRMED | Provenance on every node/edge; origin "ai" renders an AI-generated badge; narrative panel attributes the answering model |

## Layout and rendering

| Issue | Verdict | Action |
|---|---|---|
| Graph occupies 30-40% of canvas, fit never called | ALREADY FIXED before this work (fitToView on simulation end existed); kept and extended to radial layout and resize |
| Right column empty until click | CONFIRMED | Inspector always renders: stats, changes, concentration, clusters, risks, opportunities, AI read when nothing is selected |
| Bottom card row half empty | CONFIRMED | Bottom row removed; insights folded into the inspector |
| Label collisions, no thinning | PARTIAL | Zoom-dependent label thinning (events labeled at k>=1.05, importance>=75, or emphasis), word-boundary clipping, satellite fanning in radial layout. Full collision resolution not implemented (see kg-next.md) |
| Truncation with no tooltip | CONFIRMED | fullLabel on native tooltip + HTML hover tooltip + inspector |
| Labels clip at canvas edges | ALREADY FIXED (fit padding); label slack retained in fitToView |
| Non-deterministic, non-persisted layout | CONFIRMED | Deterministic hash-seeded initial positions; same graph lays out identically every visit. Per-view manual position persistence not implemented (kg-next.md) |
| Portfolio/watchlist underserved by generic force layout | CONFIRMED | Radial layout, default for those scopes, weight-driven rings |
| Fixed canvas height, no responsive treatment | CONFIRMED | Viewport-derived height, single-column stack on mobile (verified at 390px); fullscreen mode not implemented (kg-next.md) |
| Vertical rhythm shifts when sector chips mount | PARTIAL | Chips still mount conditionally; the toolbar row is stable. Accepted |

## Visual / interaction / accessibility

| Issue | Verdict | Action |
|---|---|---|
| Sector fill too close to background | CONFIRMED | Sector hexagons at 0.34 fill opacity with full-opacity stroke |
| Dim-to-20% makes labels unreadable | CONFIRMED (measured ~2.9:1) | Dimmed labels switch to the muted token: 7.17:1 dark, 6.37:1 light |
| Selected node barely differs | CONFIRMED | Selection ring + stroke width + inspector focus |
| 10px low-contrast monospace labels | CONFIRMED | 11px sans (repo font), foreground token, 15.9:1 dark |
| Tiny zoom controls, no readout/reset/shortcuts | CONFIRMED | Percentage readout, +/- buttons with tooltips and aria-labels, Fit, keyboard + - 0 |
| Permanent low-contrast hint text | CONFIRMED | Hint kept but at text-muted (7.2:1) |
| Decorative legend | CONFIRMED | Legend = filter: click-to-hide per type, live counts, aria-pressed |
| Correlation keywords with no semantics | CONFIRMED | Clusters state their window ("1m relative strength vs. sector average") |
| Weak sector chip selected state, no counts | PARTIAL | Stronger selected state + aria-pressed; counts/All omitted (chips select a focus, they do not filter) |
| Full-page-width dumb ticker input | ALREADY FIXED (SymbolSearch typeahead existed); width constrained, syncs from URL |
| No hover/tooltip/neighbor highlight | CONFIRMED | All three added |
| Edges not clickable | CONFIRMED | 12px hit-area lines; edge inspector with evidence, confidence-or-Unknown, provenance |
| Highlight input: no count/clear/debounce | CONFIRMED (no debounce, full re-render per keystroke) | 180ms debounce, match count, clear button; canvas memoized so keystrokes re-render only the toolbar |
| No filtering | CONFIRMED | Type filters (legend), min edge strength; both in URL. Hop depth/date range not implemented (kg-next.md) |
| No expand-on-click exploration | CONFIRMED, not implemented | Re-center + back/forward covers the core need; see kg-next.md |
| No path finding | PARTIAL (BFS existed behind "Why is this connected?") | Ranked multi-path search with alternatives, clickable hops, node-picker flow |
| No cross-navigation | CONFIRMED | Open in Research, re-center graph here, find path from here; event nodes deep-link to their source |
| No export/permalink | CONFIRMED | PNG (theme-aware), JSON, copy-link; full view state in URL |
| No graph statistics | CONFIRMED | Nodes/edges/density/most-connected in inspector |
| Loading/empty/error states unverified | CONFIRMED | Loading spinner (reduced-motion aware), empty portfolio/watchlist states with links, error state with retry |
| Inspector replaces content instead of layering | CONFIRMED | Three-state inspector (summary/node/edge) with grouped connection list |
| No keyboard navigation/focus/ARIA/table alternative | CONFIRMED | Tab into SVG (role=application + instructions), arrow-key traversal with visible focus ring, Enter/Escape, accessible table view of nodes and edges, ARIA on all controls |
| Color-only type encoding | CONFIRMED | Shape + color |
| Contrast failures | CONFIRMED | All measured pairs now pass AA (docs/kg-verification.md) |
| No prefers-reduced-motion | CONFIRMED | Simulation settles synchronously; spinners are motion-reduce:animate-none |
| Hit targets under 24px | CONFIRMED (14px min) | Invisible 26px-minimum hit circle on every node; 28px controls |

## Performance

| Issue | Verdict | Action |
|---|---|---|
| Simulation restarts on unrelated re-renders | NOT REPRODUCIBLE (effect keyed on [nodes, edges], referentially stable) | Kept; canvas additionally memoized |
| Highlight scans per keystroke | CONFIRMED (no debounce; full canvas re-render per keystroke) | Debounced 180ms; memoized canvas; at most 1 canvas re-render per settled query |
| Orphans inflate simulation cost | CONFIRMED (16 of 20 AAPL nodes were orphans) | Zero orphans by construction |
| SVG with no scale plan | CONFIRMED | Threshold documented (~150 nodes); measured max 55 |
| Cache per scope:id | ALREADY PRESENT (15 min) | Kept under kg2: keys; sector cache no longer case-mangled |
| Correlation clusters memoized | N/A server-computed once per build | Kept |
| alphaDecay/velocityDecay tuning | NOT REPRODUCIBLE (defaults settle fine at this scale) | Deterministic seeding shortens settle further |
| Transform-based pan/zoom | ALREADY PRESENT | Kept |

## Copy

| Issue | Verdict | Action |
|---|---|---|
| Em dash in subtitle; "your names" vague | CONFIRMED | "How your holdings and watchlist connect across sectors, events, filings, and market signals." No em dashes in any user-facing copy or in these docs |
| "10-Q: 10-Q" label builder | CONFIRMED | Fixed (label.ts) with tests |
| Generic classification rationale | CONFIRMED | Evidence states its source and, for funds, the measured weight |
| "Confidence: 100%" hard-coded | CONFIRMED (OWNS edges, portfolio nodes) | Confidence is null unless an engine computed one; UI renders "Unknown"; facts carry provenance instead of fake certainty |
| Correlation terms undefined | CONFIRMED | Window attached to every cluster |
