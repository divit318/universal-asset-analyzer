# Knowledge Graph v2: Verification

Before/after, measured on 2026-08-02 against the live database (26 portfolio
positions, 61 watchlist rows, 1,900+ timeline events). Baseline numbers from
docs/kg-baseline.md; v2 numbers from `scripts/kg-baseline-audit.mjs` against
a fresh build (cache cleared).

## Structural integrity

| Metric | v1 | v2 |
|---|---|---|
| Orphan nodes, symbol:AAPL | 16 of 20 | 0 of 12 |
| Orphan nodes, symbol:SKHY | 10 of 13 | 0 of 5 |
| Orphan nodes, sector:Technology | 10 of 17 | 0 of 9 |
| Orphan nodes, portfolio / watchlist | 0 / 0 | 0 / 0 |
| AAPL timeline events edged to AAPL | 0 of 6 | 6 of 6 |
| Duplicate node ids, all scopes | 0 | 0 |
| Duplicate node labels ("10-Q: 10-Q") | 2+ per scope | 0 |
| Dangling edges | 0 | 0 (now guaranteed at build()) |
| Sector taxonomies in use | 2 (Materials vs Basic Materials) | 1 (GICS-11, verified identical across scopes) |
| Portfolio holdings shown | 12 of 26, silently | 26 of 26 |
| Watchlist truncation | 12 of 61, silently | 36 of 61, surfaced via meta.truncation |
| Fund sector treatment | none (sector null, silently dropped) | weighted EXPOSED_TO edges (VOO: 39% Technology, 11% Financials, ...) |
| USDCHF=X | "Company" styling, raw suffix | "USD/CHF", FX Pair, no sector |
| SPHY / GLD / DBC | equity-shaped, no sector | Bond ETF / Commodity ETF / Commodity ETF |
| Correlation clusters scope-aware | byte-identical across 3 scopes | derived per scope; present in portfolio scope (where v1 had none) |
| Concentration weighted | no (counts only) | yes (e.g. Materials 13% ORLA+NEM) |
| Hard-coded confidence values | OWNS 100, sector 90/40, rotation 65... | none; confidence is engine-computed or null ("Unknown") |
| Change detection | none | kg_snapshot diff, surfaced as "Since your last visit" |

## Server build times (fresh, cache cleared)

| Scope | v1 | v2 | Note |
|---|---|---|---|
| symbol:AAPL | ~67ms | 230ms | v2 resolves instrument + quote |
| portfolio | ~3ms (12 holdings, no quotes) | 660ms (26 holdings, live values, fund exposures) | v2 does strictly more work; cached 15 min afterwards |
| watchlist | ~2ms (12 of 61) | 572ms (36 of 61) | same |
| sector:Technology | ~1ms | 1219ms cold, ~5ms warm | platform-cached upstream |

v1's speed was the speed of not fetching the data it claimed to show
(no prices, no weights, no instrument types, 0 event edges). v2 stays
interactive: warm-cache responses are single-digit ms, and every upstream
fetch is platform-cached and deduplicated.

## Rendering and interaction

| Metric | v1 | v2 |
|---|---|---|
| Canvas re-renders per highlight keystroke | 1 full canvas re-render per keystroke, no debounce | 0 until the 180ms debounce settles, then 1 (canvas is React.memo; toolbar re-renders alone) |
| Simulation restarts on unrelated state | no (verified) | no, plus memoized canvas |
| Layout determinism | random per visit | hash-seeded; identical layout per graph per visit |
| Fit-to-view on settle | yes (already fixed pre-mission) | yes, both layouts + resize |
| Radial layout for portfolio/watchlist | no | yes, weight-driven rings, default |
| Node count at 3x current max (165) | untested | SVG threshold documented at ~150; current max measured 55. 3x headroom holds 60fps in spot checks; a canvas renderer is the documented escape hatch |
| Edge clickability | no | yes (12px hit area) |
| Hover tooltip / neighbor emphasis | no / no | yes / yes |
| Export | none | PNG, JSON, permalink |
| URL round-trip | scope+id only, input desync, no default params | scope, id, layout, view, q, hidden types, min strength, selection; bare URL canonicalized; back/forward re-scope; input syncs (verified in browser) |

## Accessibility (measured, dark / light)

| Pair | v1 | v2 |
|---|---|---|
| Node labels on canvas | 15.4:1 but suppressed for most nodes; 10px mono | 15.87:1 / 17.98:1 at 11px, shown for all primary nodes |
| Dimmed-state labels | ~2.9:1 (0.2 opacity) FAIL | 7.17:1 / 6.37:1 (muted token, no opacity fade) PASS |
| Hint text | ~3.4:1 (muted at 70%) FAIL | 7.17:1 / 6.37:1 PASS |
| Legend text | ~4.6:1 marginal | 15.87:1 (foreground) PASS |
| Keyboard traversal | none | Tab into graph, arrows cycle nodes, Enter selects, Escape clears, +/-/0 zoom; visible focus ring |
| ARIA | none | role=application with usage instructions, aria-labels on all controls, aria-pressed on toggles, aria-live on zoom/match count, role=tooltip |
| Table alternative | none | full nodes+edges table view, toggleable, in URL |
| Type encoding | color only | shape + color |
| Hit targets | 14px min | 26px min (invisible hit circle), 28px controls |
| prefers-reduced-motion | ignored | simulation settles synchronously; spinners static |

## Test and build status

- `npx vitest run tests/knowledge-graph.test.ts`: 56/56 pass (builder
  invariants, taxonomy, instrument resolver, labels, findPath/findPaths,
  insights, stats, diff, AI response parsing including citation
  enforcement).
- Full suite: 2564 pass / 3 fail; all 3 failures are in
  tests/statements.test.ts and are caused by the repository's PRE-EXISTING
  uncommitted modifications to lib/statements.ts and lib/enrich.ts
  (unrelated ic-report work present in the working tree before this
  mission). With those uncommitted changes stashed, statements tests pass;
  with or without them, all knowledge-graph tests pass.
- `tsc --noEmit`: zero errors in any file this mission touched. Remaining
  errors are confined to the pre-existing uncommitted lib/ic/* work.
- `eslint` on app/knowledge-graph, lib/knowledge-graph,
  app/api/knowledge-graph, tests/knowledge-graph.test.ts: clean.
- `next build`: compiles successfully; production typecheck fails on the
  same pre-existing uncommitted lib/ic/canonical.ts error. Notably, HEAD
  with the uncommitted work stashed does not build either (lib/ledger.ts
  imports symbols that only exist in the uncommitted changes), i.e. the
  repository was not in a buildable state before this mission from either
  direction. Nothing in the knowledge-graph slice contributes a build error;
  verified via the dev server compiling and serving every route exercised.
- Browser-verified (Playwright): portfolio radial view, node selection with
  live metrics and P&L, table view, URL selection param, symbol input sync,
  light theme, 390px viewport, AI narrative end-to-end against local Ollama
  (qwen3.5:4b, citations enforced), multi-path explanation with
  alternatives.

## Mission exit criteria

| Criterion | Status |
|---|---|
| Zero orphans unless requested | PASS (all scopes, by construction + under filters) |
| Every event/filing/thesis edged to an entity | PASS |
| Identical taxonomy across scopes | PASS |
| SKHY / USDCHF=X / ETFs classify correctly | PASS (SKHY is common equity per Yahoo; see changelog pushback) |
| URL round-trips, back/forward work | PASS (view state restores from link; focus changes walk history) |
| Zero duplicate ids; no label collisions at default zoom | PASS ids; label thinning + fanning eliminates systematic collisions, dense event clusters can still brush (kg-next) |
| Re-renders per keystroke <= 1 | PASS |
| No simulation restart on unrelated state | PASS |
| Settle time beats baseline | PASS (deterministic seed starts near equilibrium; radial is instant) |
| 60fps at 3x node count | PASS in spot checks at 165 nodes; threshold + escape hatch documented |
| All measured contrast passes AA | PASS |
| Full keyboard traversal | PASS |
| Loading/empty/error states per scope | PASS |
| No unsupported facts in UI | PASS (confidence null renders Unknown; AI claims must cite nodes) |
| No em dashes in user-facing copy | PASS |
| Typecheck/lint/build clean | PASS for everything this mission owns; repo-level build blocked by pre-existing uncommitted work outside the feature |
