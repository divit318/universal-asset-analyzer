# Knowledge Graph: Defect Audit (Phase 1)

Every finding reproduced on 2026-08-08 against the live app and `data/app.db`
unless marked otherwise. Severity: Critical (wrong numbers / failed core
premise), High (user-visible breakage of a job story), Medium (quality/clarity),
Low (polish). Evidence cites file:line as of commit 736d790.

The v2 rebuild of 2026-08-02 already fixed a large class of defects the mission
brief seeds (orphans, taxonomy splits, contrast, keyboard support, URL state:
see docs/kg-changelog.md). Items from the seed list that no longer reproduce
are listed in §9 with evidence rather than silently dropped.

## 1. Graph relevance and semantics

- **KG-001 · Critical · symbol scope.** `?scope=symbol&id=AAPL` builds 74
  nodes / 92 edges; AAPL has degree 9 and ranks THIRD behind two generic macro
  headlines (degree 45 and 40). Repro: `curl /api/knowledge-graph?scope=symbol&id=AAPL`,
  compute degrees. Root cause: `addScannerEvidence` (build.ts:405-440) imports
  the **entire causal chain** of every matching scanner event — every chain
  ticker (37 and 33 tickers on the two live macro events) becomes a node plus
  an IMPACTS edge, with no hop bound, no relevance test against the subject,
  and no cap. A symbol graph is not an ego network in any sense. Fix: bound
  the ego network — chain fanout only to entities the user tracks, capped per
  event; suppress residual hubs at build time; guarantee the focus is the
  highest-degree node.
- **KG-002 · Critical · symbol scope.** The two macro events act as co-mention
  super-hubs pulling ~55 tickers unrelated to AAPL (DAL, MDT, LEN, HMC, TM,
  NUE, FCX, DE, SPG, ZION, CMA…) into "Apple's" graph. Same root cause as
  KG-001; separately listed because the fix needs hub suppression (degree cap
  with an honest "+N more" residue), not just chain bounding.
- **KG-003 · High · all scopes.** No hub suppression exists anywhere; the
  builder prunes isolates but never bounds degree (build.ts:113-143).
- **KG-004 · Medium · UI.** `Min strength: Any` (options 0/40/60/80,
  graph-view.tsx:400-409) DOES filter (live strengths cluster at 35/45/60/74+,
  so 40+ removes the 35s) — but the user has no way to know: no node/edge count
  preview per option, and the thresholds are arbitrary relative to the data.
  Partially reproduced (control works; affordance absent).
- **KG-005 · Medium · layout.** No community detection; force layout is a
  single gravity well, so unrelated clusters interleave. (After KG-001/002 the
  graphs are small enough that communities mainly matter for layout grouping.)
- **KG-006 · High · sector scope.** sector:Technology = 16 nodes while
  symbol:AAPL = 74: density inverted across scopes. Sector membership only
  includes symbols the user already tracks (build.ts:781-852); a sector graph
  has no representative members of the sector itself. Fix: seed members from
  the sector SPDR ETF's disclosed top holdings (SECTOR_ETF_MAP exists,
  lib/sector-rotation.ts:52) — real, sourced evidence.

## 2. Data correctness and classification

- **KG-007 · Critical · symbol scope.** 55 of 74 AAPL nodes typed
  "Unclassified Instrument" (QQQ, TLT, GLD, PG, MSFT, DE…). Root cause:
  `bareAssetNode` (build.ts:191-208) hard-codes `instrument: "unknown"` and is
  used for every causal-chain ticker; no resolution is ever attempted. Fix:
  resolve every asset node through the instrument chain (bounded counts after
  KG-001 make this affordable); a node that still fails resolution must say
  why.
- **KG-008 · Critical · portfolio scope.** The ledger's synthetic cash lot
  `CASH-USD` ($1.34M, `asset_class='cash'`) is resolved through Yahoo to
  **"Litecash USD"**, a micro-cap cryptocurrency, and valued at Litecash's
  price — the graph shows the cash sleeve as "CASH (Litecash USD) · Digital
  Asset · 0.1% of book". Every other weight in the graph is inflated by the
  missing denominator. Repro: portfolio scope, node `company:CASH-USD`. Root
  cause: `listPortfolio()` drops `asset_class`; the KG re-derives class from
  Yahoo with no namespace guard (build.ts:649-654, instrument.ts:97-110).
  The rest of the app learned this lesson (lib/portfolio-performance.ts:613,
  lib/ios/server.ts:19); the KG did not. This is also the "CASH is rendered as
  a node with no clear type" seed item, and the same defect class as the
  brief's DASH/DoorDash observation (see §9 for DASH itself).
- **KG-009 · High · portfolio scope.** Look-through underlyings not otherwise
  in the graph enter as `bareAssetNode` — live: AVGO (Broadcom, disclosed by
  VOO/VYM) renders "Unclassified Instrument". Same root cause as KG-007.
- **KG-010 · High · ledger ignored.** `portfolio_lot.asset_class` (cash /
  crypto / bond / etf / reit / equity) is authoritative user data and is never
  consulted; Yahoo's quoteType silently wins even when it contradicts the
  ledger. Fix: ledger class is the namespace guard; Yahoo refines within it.
- **KG-011 · Critical · event linkage.** Timeline events are attached to
  symbols by scanner co-mention: `eventsFromScannerCache` (lib/timeline.ts:340-342)
  links any event whose affectedTickers OR sector matches. Live: AAPL's
  timeline includes "Meta's Bold $6.5 Billion Power Move…" and "Dollar slides
  against the yen and euro…" — headlines not materially about Apple — and the
  same headline is separately attached to TSM. The KG consumes these rows
  unfiltered (build.ts:491-509). Fix at KG ingestion: a deterministic linkage
  score (symbol/company-name centrality in the headline; filings/earnings
  always pass), threshold exposed on the edge, sub-threshold links dropped.
- **KG-012 · High · region leak.** Scanner events about NSE-listed companies
  leak into US sector graphs: live sector:Industrials contains "A batch of
  NSE-listed companies including JSW Steel, Britannia and Ola…" (affectedTickers
  all NSE names, affectedSectors includes "Industrials"). The seed list's
  `[EXCELSOFT]` item is this class. No region/exchange scoping exists anywhere
  in the KG pipeline. Fix: an event enters a US-scoped graph only if at least
  one affected ticker is plausibly US-listed; suffixed tickers (`.NS`, `.BO`,
  etc.) and >5-char bare names do not qualify.
- **KG-013 · Medium · dedup.** Event dedup is by id only (same story from two
  wires = two nodes). Not currently reproducible with live data (the scanner
  upstream already clusters stories), but there is no content-similarity guard
  at the KG layer. Mitigate cheaply: near-duplicate title collapse per scope.

## 3. Right rail panels

- **KG-014 · High.** "Since your last visit" duplicates: an added event node
  appears once as `+ <headline>` (addedNodes) and again as
  `+ <headline> impacts <SYM>` (addedEdges) — the same story two or three
  times (live portfolio scope: three "+ BTC…" headline rows plus the same
  headlines as edge rows; brief's AAPL screenshot: one headline three times).
  Root cause: inspector.tsx:136-158 renders raw addedNodes + addedEdges with
  no reconciliation.
- **KG-015 · High.** Single-asset flooding: live portfolio delta feed = 4 BTC
  entries of 4 (brief: 7 of 8). No per-entity cap, no materiality ranking
  (diff.ts preserves insertion order).
- **KG-016 · Medium.** Delta entries truncate with CSS ellipsis, no tooltip,
  no full text anywhere (inspector.tsx:144 `truncate`).
- **KG-017 · Medium.** Delta entries carry no timestamp; only the panel-level
  "previousAt" is shown for the no-changes case. Unverifiable feed.
- **KG-018 · Medium.** `+` / `−` prefixes unexplained; no key.
- **KG-019 · Medium.** "Correlation clusters" shows Leading/Lagging/Weakening/
  Strengthening with a window label but no definition of the quadrant terms
  and no visual (inspector.tsx:222-234). These are RRG quadrant terms; explain
  or drop.
- **KG-020 · Low.** Panel presence per scope is intentional (look-through
  needs book weights → portfolio only; clusters need ≥2 sectors in graph;
  opportunities need scanner matches) but nothing communicates this; empty ≠
  missing. Verified each panel's gating in recommend.ts — intentional, but
  undocumented in-UI.
- **KG-021 · Medium.** "AI READ" is a bare Generate button: no description of
  what it produces, no cost/time expectation (inspector.tsx:274-285).
- **KG-022 · High.** Look-through exposure — the single most valuable panel —
  is buried below the delta feed, capped at 6 rows with routes clipped to 3
  (inspector.tsx:162-205). Promote to the top of the portfolio summary rail
  and show the full route decomposition.
- **KG-023 · Medium.** "Opportunities not owned" renders `TSM opportunity` —
  zero information. The scanner opportunity carries theme, direction, verdict,
  rationale (all unused in the label). Fix label policy + panel copy.
- **KG-024 · Low.** "Density 0.03" means nothing to a user; cut from the stat
  row (keep nodes/edges/most-connected).

## 4. Node and edge visual encoding

- **KG-025 · High.** All assets share one shape+color (`company` = blue
  circle) regardless of instrument: Common Equity, Digital Asset, Bond ETF,
  Equity ETF, and Unclassified are visually identical on canvas
  (graph-model.ts:15). The legend splits them (by instrument) but the canvas
  does not. Fix: per-instrument-family fill variation within the asset shape
  family (equity circle, fund ring/donut, crypto/futures/fx distinct glyphs)
  while keeping type = shape as the primary channel.
- **KG-026 · Medium.** Market Event and Opportunity are both triangles
  differing only by fill hue (graph-model.ts:20-21) — fails color-blind and
  small sizes. Give Opportunity a distinct shape.
- **KG-027 · High.** Edge treatments (solid pink, solid purple, dashed grey…)
  are never explained: the legend row lists node types only; EDGE_VISUAL
  semantics exist in code but are not rendered anywhere (graph-view.tsx legend
  loop). Add a live edge legend.
- **KG-028 · Medium.** Arrowheads imply direction; direction semantics are
  never stated. The `directed` flag is honest in the model; the encoding is
  unexplained in the UI. Cover in the edge legend + edge inspector already
  shows "→"; add one line of copy.
- **KG-029 · Medium.** Node size = importance (documented in graph-model.ts
  only). Not stated in the legend. Verified size does encode importance/weight
  consistently; the defect is the missing in-UI documentation.
- **KG-030 · Low.** Legend chips ARE click-to-filter with aria-pressed, but
  nothing signals the affordance visually before interaction; add "click to
  filter" hint.
- **KG-031 · Medium.** Node labels have no halo/plate; they print directly
  over edges (graph-canvas.tsx:648-662). Foreground-on-surface contrast passes
  AA on clean background but not over an edge stroke. Add paint-order halo.

## 5. Layout and rendering

- **KG-032 · Not reproduced (fixed pre-mission).** Auto-fit on load: fitToView
  runs on simulation end, on radial compute, and on resize
  (graph-canvas.tsx:211/265/277-282). The brief's screenshots predate v2.
  Kept under regression watch.
- **KG-033 · High.** Label collisions: a greedy occlusion pass exists and
  suppresses colliding labels (graph-canvas.tsx:467-487) — but suppression is
  silent and event nodes are additionally label-suppressed by default below
  zoom 1.05 unless importance ≥75 (showLabel, :489-496). Net effect matches
  the brief: most event squares render unlabeled (live watchlist: 18 events,
  ~4 labeled). Fix: label everything the occlusion pass can fit, prioritized
  by importance; no type-based suppression; suppressed labels appear on hover
  (already) and count toward a zoom hint.
- **KG-034 · Medium.** Labels truncate at 26 chars with no per-node tooltip on
  the truncated text itself — native `<title>` exists on the node group
  (hover works) so this is partially mitigated; keep `<title>` + hover card.
- **KG-035 · High.** "Radial" layout is not ring-structured: ring 1 =
  neighbors of focus, everything else fans around its parent at parent+85-119px
  (computeRadial, graph-canvas.tsx:154-199). There are no concentric rings by
  hop depth, which is why screenshots look force-like. Rebuild as BFS-depth
  rings.
- **KG-036 · Medium.** Force layout has collision force (radius+12,
  graph-canvas.tsx:242) — brief's node-overlap item does not reproduce for
  the force layout. Radial fanning CAN overlap siblings (dist alternates
  85/119 with unbounded children per parent). Fix with ring layout (KG-035).
- **KG-037 · Low.** Isolated nodes: pruned by construction (verified
  isolatesDropped=0 across scopes; filters re-prune). Not reproduced.

## 6. Interaction

- **KG-038 · Not reproduced (fixed pre-mission).** Hover exists: neighbor
  emphasis + HTML tooltip card + cursor-pointer (graph-canvas.tsx:670-686).
- **KG-039 · High.** No focus/neighborhood mode, no expand/collapse, no pin,
  no per-node hide. (Legend hides whole types only.)
- **KG-040 · Not reproduced (exists).** Path finding: "Find path from here" →
  pick node → ranked multi-path with alternatives + AI narration
  (graph-view.tsx:191-222, traverse.ts). Kept.
- **KG-041 · Not reproduced (exists).** Edge inspector answers "why is this
  edge here" with evidence, confidence-or-Unknown, provenance, timestamps.
- **KG-042 · Medium.** "Highlight nodes…" only highlights; no
  focus/filter/navigate action, no keyboard flow from matches (Enter should
  select the first match; the match count is aria-live already).
- **KG-043 · Medium.** No time-range control over events. Each scope carries
  ≤6 events per symbol (top-importance), so a range filter over that sample
  would imply completeness the data lacks (same verdict as kg-next.md). The
  honest fix inside this mission: timestamps everywhere (hover, inspector,
  delta feed) + newest-first ordering; a real range control needs a deeper
  event endpoint (deferred, stated in report).
- **KG-044 · Medium.** No way to suppress an individual hub node (ties to
  KG-039 hide).
- **KG-045 · Low.** Zoom: wheel/buttons/keyboard +,-,0 all work; FIT is
  idempotent (pure function of positions). Pinch = wheel events on macOS
  trackpads (ctrlKey not special-cased; sensitivity acceptable). Not
  reproduced as broken; minor: wheel zoom is not cursor-anchored.
- **KG-046 · High.** Table view lacks parity: it renders the UNFILTERED graph
  (`graph` prop, graph-view.tsx:488) so legend filters/min-strength do not
  apply; no sorting; no evidence column; no timestamps; no export of the
  table itself (JSON export covers data parity partially).
- **KG-047 · Medium.** Copy link restores scope/id/layout/view/q/hide/min/sel
  but not zoom/pan. Decision recorded: zoom/pan stay out of the URL (fit-on-
  load makes them transient; serializing continuous transforms produces
  URL churn on every wheel tick). Focus/selection restore is the meaningful
  part and works.

## 7. States, performance, accessibility, responsiveness

- **KG-048 · Verified working.** Loading spinner, error+retry, empty
  portfolio/watchlist states, invalid symbol/sector 400s (route.ts:36-49,
  graph-view.tsx:287-332). Unknown-but-valid-shaped symbols build a 1-node
  graph — acceptable (focus-only graph renders with its "no connections"
  reality visible); partial upstream failure degrades per-node (quote null).
- **KG-049 · Medium.** Performance: measured v2 baselines hold 60fps to 165
  nodes (docs/kg-verification.md). Post-fix graphs are smaller (≤~40). The
  500/2000-node synthetic profile the brief demands is not meaningful for an
  SVG renderer documented to cap at ~150; decision: keep SVG, enforce the cap
  at build time (hub suppression + per-scope caps guarantee <100), document.
- **KG-050 · Low.** prefers-reduced-motion honored (synchronous settle);
  keyboard traversal + ARIA + table alternative exist; measured contrast pairs
  pass AA (docs/kg-verification.md). New UI added by this mission must be
  held to the same bar.
- **KG-051 · Medium.** Responsiveness: three chrome rows (tabs+chips,
  toolbar, legend) before content; at 390px the stack works (verified in v2
  pass) but the sector chip row wraps to 3+ lines. Compact the chip row on
  narrow viewports.
- **KG-052 · Low.** Theme parity: canvas uses tokens (`var(--…)`) and PNG
  export inlines them; light/dark verified in v2 pass. Not reproduced.

## 8. Tests

- **KG-053 · Medium.** No tests for: scanner-evidence bounding (the KG-001
  class), hub suppression, cash/ledger namespace guard, event linkage
  scoring, region scoping, delta-feed dedup/caps. Existing 56 KG tests + 10
  overlap tests pass and stay.

## 9. Seed items that do not reproduce (with evidence)

- **DASH under "Digital Asset"**: live portfolio graph resolves DASH as
  Common Equity (DoorDash) — Yahoo quoteType EQUITY wins. The defect class is
  real (KG-008: CASH-USD→Litecash proves the resolver crosses namespaces
  when Yahoo's answer is wrong) and the namespace guard (KG-010) covers both.
- **Symbol input full-width dumb input / URL desync / decorative legend /
  color-only encoding / no keyboard / contrast failures / no export / no
  empty states / non-deterministic layout**: all fixed in the 2026-08-02 v2
  pass, verified against live DOM and docs/kg-verification.md measurements.
- **"Nodes overlap in dense regions"**: force layout has a collision force;
  reproduces only in radial satellite fans — folded into KG-035/036.
- **"No auto fit on load"**: fixed pre-mission (KG-032).
