# Knowledge Graph: Rebuild Report (Phase 10)

Mission completed 2026-08-08. Every phase ran end to end; every number below
was measured against the live app and database, cache cold.

## What was broken, in one paragraph

The feature produced graphs about nothing. A symbol-scoped graph imported the
entire causal chain of any scanner event that merely shared the subject's
sector, so `?scope=symbol&id=AAPL` rendered 74 nodes in which two generic
macro headlines out-connected Apple 45-and-40 to 9, and 55 of the nodes were
"Unclassified Instrument" because chain tickers were never resolved. The
portfolio graph valued the user's $1.34M cash sleeve at the price of
"Litecash", a micro-cap cryptocurrency Yahoo resolves for the synthetic
`CASH-USD` ticker, corrupting every book weight (cash showed 0.1%; it is
30.0%). Headlines attached to symbols by co-mention ("Meta's Bold $6.5B…" on
AAPL), NSE corporate filings leaked into US sector graphs, and the delta feed
showed the same story three times while one loud asset filled every slot.

## Headline numbers (before → after, measured)

| Metric | Before | After |
|---|---|---|
| symbol:AAPL nodes / edges | 74 / 92 | 16 / 16 |
| AAPL degree rank in its own graph | 3rd (9 links vs 45/40 for macro events) | 1st (7 links; suppression guarantees it) |
| "Unclassified Instrument" nodes (all scopes) | 56 | 0 |
| Cash sleeve weight | 0.1% ("Litecash", crypto) | 30.0% (Cash, face value) |
| Headlines mis-attached to AAPL | 2 of 6 timeline events | 0 (linkage gate) |
| NSE filings in US sector graphs | present (sector:Industrials) | 0 (region gate) |
| Duplicate stories in the delta feed | same headline 2-3x | 0 (subsumption + title dedup) |
| Delta feed single-asset flooding | 4 of 4 entries BTC | capped at 2 per entity, ranked by importance |
| sector:Technology nodes | 16 (only user-tracked names) | 23 (8 SPDR-disclosed constituents with weights) |
| Full test suite | 2564 pass (pre-existing baseline) | 2971 pass, 0 fail (95 KG tests, +28 new) |

## What changed

### Data layer (lib/knowledge-graph/)
- **Ledger namespace guard** (`instrument.ts: applyLedgerGuard`): the
  portfolio ledger's `asset_class` outranks Yahoo across the
  cash/crypto/fx/security boundary. `CASH-USD` short-circuits to a Cash node
  valued at face without touching Yahoo; a declared equity can never flip to
  crypto on a ticker collision (the DASH class of bug).
- **Instrument resolution everywhere**: look-through underlyings and causal-
  chain tickers resolve through the same chain as holdings; a node that still
  fails carries `metrics.unresolvedReason`, never a silent bucket.
- **Subject linkage gate** (`relevance.ts`): broadcast headlines (news,
  scanner) link to a symbol only when the headline names the ticker or the
  identifying company-name token as a whole word; filings, earnings, and
  alerts always link. The gate runs before the top-N slice and the linkage
  basis is written into the edge evidence.
- **Region gate**: an event enters a US-scoped graph only if at least one
  affected ticker is plausibly US-listed (1-5 letters, no foreign exchange
  suffix). Tickerless macro events pass.
- **Near-duplicate collapse**: event nodes with the same normalized title
  merge; edges re-point to the survivor.
- **Timestamps**: asset nodes carry quote time; every delta entry carries the
  underlying fact's date; the feed states the snapshot it diffs against.

### Graph construction
- **Bounded ego network**: causal-chain fanout only to tickers the user
  tracks (≤4 per event, resolved); sector-matched macro events edge to the
  SECTOR node, not the subject, so relevance is honest ("reaches AAPL only
  through its sector" is on the edge).
- **Hub suppression** (GraphBuilder.build): no non-focus node may reach the
  focus's degree; surplus edges drop weakest-first (never the focus edge) and
  the count is visible as "Links suppressed" in the inspector.
- **Sector density**: sector graphs seed the SPDR ETF's disclosed top
  holdings as CONSTITUENT edges with measured weights (XLK for Technology…),
  so the graph is about the sector, not the user's coincidental overlap.
- **Community detection** (`community.ts`): deterministic label propagation;
  informs force-layout seeding and cohesion so clusters render as groups.
  Deliberate decision: communities do NOT drive hue — color + shape already
  encode node type and one channel cannot serve two masters.

### Rendering
- Instrument glyphs within the asset family: circle = single issuer,
  ring = fund, dotted circle = digital asset, dashed circle = other/cash.
  Opportunity became a star (was a second triangle distinguishable only by
  hue). No two semantic types differ by hue alone.
- Every node is labeled unless the greedy occlusion pass (importance
  priority) must suppress it; labels have halo plates; suppressed labels
  return on hover/selection and live in tooltips and the table.
- Radial layout is genuinely radial: concentric BFS-depth rings, ring 1
  ordered by book weight from 12 o'clock, even angular spacing with a
  minimum-arc guarantee.
- Edge legend renders every relation on screen (color + dash sample), plus
  one-line keys: "arrow = direction, width = strength, size = importance /
  book weight".
- Fit-to-view fixed for narrow viewports (the d3 end handler framed against
  a stale 800px default; now a ref). Verified 0.52x fit at 390px.

### Interaction
- Double-click (or inspector button) = focus mode: the view reduces to a
  node's neighborhood with a breadcrumb back; in the URL (`focus=`).
- Per-node hide with a restore chip; in the URL (`hn=`).
- Drag pins a node (indicator dot, Alt-click or "Unpin n" to release).
- Wheel zoom is cursor-anchored.
- Search: Enter selects the first match; Escape clears; match count is
  aria-live.
- Min-strength options preview live node/edge counts per threshold.

### Right rail
- Look-through exposure leads the rail (8 rows, full route decomposition,
  floors-not-totals caveat verbatim).
- Delta feed: node+edge subsumption, ≤2 entries per entity, ranked by
  importance, dated, full text on hover, click focuses the node, a plain
  key for +/−, and an honest "N more hidden" line.
- Rotation quadrants (Leading/Weakening/Lagging/Strengthening) each carry a
  one-line definition and the computation window.
- Opportunities state theme + direction in the label and the rationale below.
- AI read explains what it produces and what it costs before the button is
  pressed; output remains citation-enforced narration over computed numbers.
- "Density 0.03" cut (mapped to no job story).

### Parity and plumbing
- Table view now renders the same filtered set as the canvas, with sortable
  columns, evidence tooltips, and edge timestamps.
- URL round-trips scope, id, layout, view, q, hidden types, hidden nodes,
  focus, min strength, selection. Verified: focus restores from a pasted URL.
- 28 new tests (tests/kg-relevance.test.ts): linkage gate, region gate,
  ledger guard, cash short-circuit, hub suppression, duplicate collapse,
  communities, delta-feed summarization. Full suite: 2971 pass.

## What was deleted, and why
- The unbounded causal-chain fanout (the single biggest source of nodes).
  A 40-ticker chain of names the user does not track answers no job story.
- The "Density" stat. No user action follows from it.
- The raw addedNodes/addedEdges/removedNodes rendering of the delta feed.
- The pseudo-radial satellite fan (replaced by real rings).
- `bareAssetNode` (the silent "unknown" bucket).

## What a user can now do that they could not before
1. Open AAPL and see a graph that is actually about Apple, with every node's
   reason for existing stated on its edge (J1, J3).
2. Trust the portfolio weights: cash is cash, at face value; look-through
   shows GOOGL 4.0% effective via direct + VOO with the routes printed (J2).
3. Read "since your last visit" as a ranked, dated, deduplicated changelog
   and click through to any entry (J4).
4. See what Technology is beyond their own book (SPDR constituents), and what
   the scanner flags there that they do not own, with the rationale (J5).
5. Focus, hide, pin, search-and-select, and share the exact view by URL.

## Deliberately not done, with rationale
- **Pixel "before" screenshots at three widths**: the pre-rebuild UI exists
  only in the mission brief's screenshots and the measured JSON baselines in
  docs/kg/00_INVENTORY.md; standing up a second dev server against the same
  SQLite file to re-shoot a known-broken UI was not worth the risk to live
  state. After-screenshots for all four scopes at 1440/1024/390 are in
  docs/kg/shots/.
- **Pan/zoom in the URL**: fit-on-load makes the transform transient;
  serializing it churns the URL on every wheel tick. Selection/focus/filters
  (the parts that answer a question) round-trip.
- **500/2000-node synthetic profiling**: the builder now enforces small
  graphs by construction (hub caps, chain caps, per-scope caps; measured max
  49 nodes). The SVG renderer is documented to hold 60fps to ~165 nodes with
  a canvas escape hatch documented in graph-canvas.tsx; profiling a scale the
  data layer cannot produce would be theater. Revisit if a future scope
  raises the caps.
- **Event time-range control**: each scope carries ≤6 top-importance events
  per symbol; a range filter over that sample would imply completeness the
  data does not have. Timestamps are now everywhere instead. The honest
  version needs a deeper event endpoint first (documented in kg-next.md).
- **Expandable suppressed hub links**: suppression counts are visible on the
  node; expansion needs an incremental subgraph endpoint (kg-next.md item 5).

## Known limits
- The linkage gate keys on the ticker or the FIRST identifying name token; a
  headline that references a company purely by nickname ("Cupertino gets a
  new CEO") will not link. Under-linking is the chosen failure mode.
- The region gate is a listing-shape heuristic; a ≤5-letter bare foreign
  ticker would pass. All observed leaks (NSE names, .NS suffixes) are caught.
- Watchlist scope still caps at 36 of 61 names, surfaced honestly.
- The one-time snapshot diff after this rebuild is large ("37 more changes
  hidden") because the graph shape changed; subsequent diffs are normal.

## Verification checklist (definition of done)
- AAPL unambiguously most connected on its own graph: PASS (7 links, next 5;
  hub suppression makes this a structural invariant, unit-tested).
- Zero "Unclassified Instrument" for liquid US symbols: PASS (0 across all
  scopes; unresolved carries a reason).
- No headline attached to a subject it is not materially about: PASS
  (linkage gate + tests reproducing the exact live artefacts).
- No duplicate entries in any panel: PASS (subsumption + title dedup + tests).
- No overlapping labels / unlabeled nodes / tooltip-less truncation: PASS
  (occlusion pass with importance priority; suppressed labels on hover +
  table; halos; full labels in tooltips).
- Every node type, edge type, colour, shape, size explained in the legend:
  PASS (live node legend by instrument, live edge legend, size/arrow/width
  keys).
- Five job stories under 30 seconds: PASS (see "What a user can now do").
- No regressions elsewhere: PASS (full suite 2971 green; /research /screener
  /wire /portfolio serve 200; Research's graph preview card benefits from the
  same cleaned graphs through the unchanged `company:SYMBOL` contract).

## What I would do next
1. Contagion edges: wire lib/portfolio-analytics correlations into
   CORRELATES_WITH edges with the window labeled (kg-next.md item 2).
2. Incremental expansion endpoint for suppressed hub links and hop-depth
   exploration.
3. A deeper event endpoint, then a real time-range control with an event
   volume histogram.
4. Saved views (named URL + pinned positions).
