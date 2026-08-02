# IC Report Hardening — Final Report

Date: 2026-08-02. Work on branch `ic-report-hardening` (commits also present on
`feat/knowledge-graph-v2` — see "Concurrent session" in the decision log).
Baseline artifacts: `/tmp/ic-baseline` (deterministic) and `/tmp/ic-baseline-llm`
(full NVDA run on the old pipeline). Final artifacts: `/tmp/ic-final`,
`/tmp/ic-llm-after` (full TCS.NS run on the new pipeline).

---

## 1. Issues found and fixed, by root-cause cluster

### A. No canonical data object (Phase 1)
Every stage re-interpreted raw provider payloads independently.

| Defect | Evidence (baseline) | Fix | Files |
|---|---|---|---|
| No provenance, units, periods or as-of on any figure | every number a bare float | `CanonicalFacts`: every field is a `Datum` with value/unit/currency/period/source/asOf; UI Data tab + PDF appendix render the provenance table | `lib/ic/canonical.ts`, `app/ic-report/_components/data-tab.tsx` |
| Currency hardcoded to `$` in every prompt and signal for all markets | `Total debt: $X.XB` on ₹ names | one formatting module, locale + currency aware (en-IN grouping, crore/lakh compact); ad-hoc `toFixed` banned in the feature | `lib/ic/format.ts` |
| INR→₹-else-$ currency mapping | GBp/EUR names mislabelled | trading currency flows from the quote as an ISO code end to end | route, canonical |
| ADR currency mixing: TSM's TWD cash flows against a USD ADR price | old report: silent; new engine initially printed a blocked 10.6x-spot value | `financialCurrency` captured; FX rate fetched and figures converted with conversion provenance, or dropped as loud gaps; case seeding skipped on mismatch | `lib/fundamentals.ts`, canonical, route |
| Fiscal labels unauditable; Yahoo fallback off-by-one risk for non-Dec FYE | `fy` label with no period end | period end dates threaded through EDGAR and Yahoo paths; `fmtFiscalPeriod` renders "FY2026 (ended Jan 2026)"; validation asserts label/date ordering | `lib/statements.ts`, canonical |
| Revenue-into-FCF collision class | mission symptom | ingest validator flags identical revenue/FCF values repeating across years (NVDA's FY24/FY25 near-collision proved to be genuine data — the validator distinguishes exact repeated collisions from coincidence) | `validateStatements` |
| Missing data rendered as silence or zero | absent sections | `gaps[]` with reasons; explicit "not available (reason)" rendering; report-level disclosure banner | canonical, header |
| pp vs % confusion | "Revenue growth decelerated 48.7%" (a 48.7pp delta) | branded `Fraction`/`PercentagePoints` types, `deltaPp`/`relativeChange`, `fmtPp` ("48.7pp") — audited every rate comparison in the feature | format, signals |

### B. The model produced the numbers (Phase 2)
Baseline NVDA (old pipeline): P/E method target $318.49 with assumptions citing
"$214% earnings growth"; verdict citing "forward P/E of 15.6x" while the method
table said 20.5x on the same screen; free-invented scenario prices $450/$315/$185;
auto-seeded case fair value **$67,267 per share vs $200.75 spot (335x)** because a
68% delivered CAGR compounded unclamped for a decade.

Fixes:
- Deterministic engine (`lib/ic/valuation-engine.ts`): explicit-period DCF with a
  documented linear fade, terminal by perpetuity AND exit multiple, full
  EV-to-equity bridge, every intermediate inspectable (per-year rows in UI + exports).
- LLM proposes inputs only (`lib/ic/valuation-inputs.ts`): per-field
  schema/range validation with recorded rejections; history-derived defaults;
  provenance (`model` vs `default`) on every input.
- Hard invariants, tested directly: terminal < WACC, absolute terminal ceiling,
  WACC band, growth band with justification gate above 25%, monotonic fade,
  bear < base < bull, >8x-spot blocking, terminal-share warning,
  sum-of-parts reconciliation asserted not trusted.
- One engine feeds methods table, scenarios, sensitivity and headline; the
  headline is the blend of the same methods shown, arithmetically tied to spot
  (asserted in tests to 1e-8).
- Assumption prose generated from the structured inputs (Phase 2.5), with
  hand-recomputation tests: every relative method reproduces its target from its
  own stated inputs to the cent.
- Anchor-vs-estimate distinction: methods that reuse the market's own current
  multiple are rendered for context and EXCLUDED from the blend (blending them
  laundered spot into the headline and manufactured false agreement).
- Reverse DCF (implied stage-1 growth + implied duration) — NVDA now states
  "today's price implies ~75% stage-1 FCF growth" beside the conservative DCF.
- Sensitivity as data: WACC × terminal grid (heatmap in UI, tables in exports),
  breakeven growth, per-driver deltas.
- Confidence-weighted blend with weights and rationale rendered.
- ValuationCase and Monte Carlo prior reconciled deterministically (no model
  call between two numbers and the sentence comparing them); IC-route case
  seeding clamps delivered growth into the defensible band.

### C. Statistically impossible history stats (Phase 2.6/2.7)
Baseline NVDA: "1-year return 12.0% at the **58th percentile**, median 34.5%" (a
below-median value above the 50th percentile) while the 1Y chip showed **36th**
percentile on the same screen — the headline percentile came from the 5Y window.

Fix: `lib/ic/history-stats.ts` — return, rolling median and percentile are only
ever reported together from the SAME window's distribution; midpoint percentile
rank unit-tested against known distributions (property test: below-median can
never rank above 50); verdict names its window; short histories degrade to
since-listing context with no fabricated percentile.

### D. Agent-count and accounting lies (Phase 3)
Baseline: copy said 9 agents; 8 ran for NVDA (accounting got no questions);
`questionsAnswered` reported assigned counts while the prompt capped at 6;
"13 signal types" copy vs 18 typed categories, 6 of which had no detector.

Fixes: every domain always receives a baseline question so `AGENT_COUNT` (one
constant, one source: `lib/ic-questions.ts`) is the actual count on every run;
`questionsAnswered` vs `questionsAssigned` both reported honestly; the 6
sourceless signal categories were REMOVED (a library listing checks it can never
fire misstates its coverage); landing copy derives from `signalLibrarySize()`
and `AGENT_COUNT`.

### E. Decorative multi-agent architecture (Phase 3.3–3.8)
Baseline agents all received near-identical data slices. Fixes: distinct
evidence slice per domain (business gets statements+margins; management gets
surprises+insiders; governance gets ownership; etc.) plus a distinct mandate
with an explicit "not yours" list; verified by test that slices differ.
Citation enforcement: figures that do not trace to the agent's own slice
downgrade its confidence with a rendered reason (observed working on the TCS.NS
run: 3 of 9 agents downgraded). Person-level claims gated to filed records.
New synthesis stage: deterministic cross-agent dedup with attribution,
schema-validated disagreement detection (TCS.NS surfaced 2 genuine
disagreements, rendered first-class in the thesis tab), cross-agent summary,
and per-agent data-gap collection feeding the report-level disclosure banner.

### F. Narrative/numbers divergence (Phase 3.11)
Thesis now receives ESTABLISHED CONCLUSIONS (engine scenario values, reverse
DCF, terminal share) computed in code; scenario narratives are bound to their
engine values in the UI (value badge on each case card). Thesis retries once at
a higher token budget on parse failure (observed truncation with qwen3.5:9b).

### G. Export quality (Phase 6)
Baseline PDF used WinAnsi Helvetica (₹ → • − – all mojibake), drew running
headers into the content stream, had no page numbers, duplicated the
disclaimer, and dated the filename with export-time UTC vs report-time locale.
Rebuilt: DejaVu embedded (verified: no Helvetica objects in output), header and
footer in margin regions via `pageAdded` only, "Page N of M" post-painted,
linked ToC + outline tree, executive summary page, appendix with the canonical
data table + sources + prompt versions, measured chips and tables, widow
control, one disclaimer, correct metadata, and one shared UTC date derivation
for header/cover/filename. Full-parity Markdown and JSON exports plus clipboard
copy added. Verified against real NVDA (27 pages) and TCS.NS (₹, Indian
grouping, crore, IST) reports.

### H. UI lifecycle (Phase 5)
Baseline rendered nothing until `done` (minutes of empty pane). Rebuilt:
progressive rendering from typed per-stage SSE payloads; one grid for the whole
lifecycle; sticky ARIA tab bar with export cluster; URL state (symbol + tab);
keyboard shortcuts; skeletons and designed empty states; full agent narratives
with expand/collapse-all; signals tab showing fired AND passed AND
not-evaluable checks with evidence + threshold + signal→question→agent
traceability; side-by-side scenario comparison; football field, sensitivity
heatmap; report header with price-at-generation/mcap/shares/as-of/model/prompt
versions; history with age, staleness marker and diff vs previous run; loud
validation and data-gap banners. The native market `<select>` was removed
entirely — market resolves from the ticker (decision log #7).

### I. Resilience (Phase 7)
Runs are owned by a server-side registry, not the HTTP stream: closing the tab
leaves the pipeline running; reopening re-attaches and replays events (verified
live in the browser mid-run). Reports persist to SQLite (`lib/ic/store.ts`,
last 10 per symbol). Pre-flight checks fail in seconds (ticker resolvable,
model routable). Per-agent retry with backoff inside the run plus a
`retry-agent` endpoint and UI affordance afterwards. Prompt versions and model
recorded on every report. Agent dispatch remains sequential by default with
documented rationale (Ollama single slot) and supports bounded concurrency.

### J. Accessibility (Phase 8)
Programmatic contrast audit against the real tokens in BOTH themes:
dark now 0 failing pairings (low-opacity muted text removed); light mode gets
scoped one-step-darker accent tokens for this surface only (all ≥4.5:1).
Meaning never colour-alone (severity/confidence chips carry text; direction has
sign + label). Correct ARIA tab pattern with arrow keys; live region on the
progress feed; visible focus rings; 36–44px hit targets; verified at 375/768/
1024/1440/2560 and in light mode; wide shell replaces the narrow reading band.

### K. Code quality and security (Phase 9)
Ticker sanitisation (`/^[A-Z0-9.\-]{1,20}$/`) before prompts/URLs/filenames;
model-name sanitisation; schema-gated exports (v2 only); every LLM response
schema-validated with typed fallbacks; no `any` on external data paths in the
new code; camelCase identifiers no longer leak as UI labels (AGENT_LABELS
single source); ordinal fixes ("92nd", not "92th"); user-facing prose prefers
colons over em dashes (45 strings); zero console errors across all harness
tickers and browser sessions.

---

## 2. Issues found independently (not on the mission's list)

1. **Blend laundering**: with defaulted inputs, relative methods using the
   market's own current multiple reproduce spot exactly (P/B target ≡ spot by
   construction), silently dragging the "independent" headline toward the
   market price. Fixed with the anchor/estimate distinction.
2. **Auto-seeded ValuationCase absurdity is app-wide**: `seedAssumptions`
   compounds unclamped delivered growth. Fixed at the IC boundary (clamped
   seed + divergence flagging); the shared seeding path itself was left alone
   deliberately (decision log #4).
3. **INFY-class WACC underflow**: a 0.13 beta yields a 5.0% platform WACC;
   the bull scenario's −50bp shift walked it out of the band and blocked the
   run. Scenario shifts now clamp; out-of-band platform WACC clamps with an
   audit warning.
4. **RIVN-class margin false positive**: a genuine −7,672% pre-revenue
   operating margin tripped the collision heuristic; threshold now
   distinguishes currency-magnitude values from extreme-but-real margins.
5. **Model proposals at the band edge**: qwen3.5 proposed a 15% required FCF
   yield (the old band maximum) for NVDA — band-edge reaching, not reasoning.
   Band tightened to 2–10%.
6. **Mislabelled input provenance**: model-proposed multiples displayed the
   default's rationale text ("current EV/EBITDA held (default)" beside a
   clearly non-default 42.6x). Rationale now states who chose the input.
7. **`extractAnnual` dropped period end dates** that EDGAR provides — restored
   and threaded through so fiscal labels are auditable.

---

## 3. Before / after

| Measure | Before (baseline) | After |
|---|---|---|
| NVDA headline value | case $67,267/share (335x spot), scenario prose free-invented | blended $96–$171 (deterministic vs model-proposed inputs), every method reproducible, reverse DCF explains the gap to spot |
| NVDA run hot/cold | 12% return @ 58th pct with 34.5% median (impossible), two percentiles for one value | one window, one distribution: 15y CAGR +52.6% vs +44.7% median @ 92nd pct |
| Agents that ran (NVDA) | 8 of 9 advertised | 9 of 9, count derived from one constant |
| Adversarial sweep (17 quotable tickers) | not runnable as a suite | 0 blocking violations, 0 validation issues, 0 console errors; financials/REITs/loss-makers/ADRs/negative-book/low-high-price/IN all coherent |
| Invalid/delisted/ambiguous tickers | streamed a slow error mid-run | preflight 422 in ~1s |
| PDF glyphs | `→ ✓ ⚠ ◆ ₹ –` mojibake | DejaVu-embedded, verified on USD + INR reports |
| Exports | PDF only, partial, disclaimer duplicated | PDF + Markdown + JSON + clipboard, full parity, one disclaimer, provenance appendix |
| Tab-close during a 12-minute run | run lost | run continues server-side; re-attach replays; report persisted with history + diff |
| Full pipeline timing (LLM, qwen3.5:9b) | NVDA 439s (old stages) | TCS.NS 756s for 9 agents + synthesis + retried thesis (~60s/agent; synthesis 106s; valuation inputs 26s). Sequential dispatch retained by measurement-backed rationale — Ollama serves one slot; the added stages (synthesis) buy dedup + disagreement detection |
| Contrast (feature surfaces) | unaudited; light mode untested | dark 0 AA failures; light 0 within the feature (scoped tokens) |
| Tests | 4 IC test files (parsers only) | 15 IC test files, 165 IC-specific tests incl. direct invariant suite, hand-recomputation, percentile property tests, ADR/FX regression, export resilience; full suite 2,681 green |

## 4. Decision log

1. **IC engine is the report's headline; the ValuationCase is reconciled, not
   silently adopted** (Phase 2.3 "one engine" option). The codebase philosophy
   made the case the single estimate owner, but the mission's architectural
   directive requires deterministic, inspectable engine output. The case
   remains the app-wide persisted estimate; the report renders an explicit
   reconciliation row either way. Alternative (case feeds both views) rejected:
   the seeded case was the source of the 335x-spot defect.
2. **Spot-sanity band asymmetric**: >8x spot blocks (broken maths); <1/8x spot
   warns (a conservative DCF on a growth-priced name is a legitimate committee
   finding, and the reverse DCF beside it explains the gap). Blocking both
   directions muted exactly the reports an IC most needs.
3. **Sourceless signal categories removed** rather than stubbed (SHARE_DILUTION,
   GUIDANCE_CUT, MARKET_SHARE_LOSS, ROYALTY_INCREASE, RELATED_PARTY_EXPANSION,
   CAPEX_SURGE): no data source exists for any of them in the current
   providers. Alternative (keep + mark "not evaluable") rejected: permanent
   not-evaluable rows are noise, and the checks list must state real coverage.
4. **Shared `seedAssumptions` left unchanged**; the clamp lives at the IC route
   (mission stop-condition 1: other tabs depend on the shared seeding path).
   The IC report also flags a divergent existing case rather than mutating it.
5. **Agent dispatch sequential by default** with `concurrency` support. The
   codebase documents Ollama's single-slot behaviour (parallel dispatch
   previously caused mass timeouts). Parallelism yields nothing without
   OLLAMA_NUM_PARALLEL; retry budgets stay meaningful sequentially.
6. **Reconciliation prose is deterministic** (old code asked the model to
   explain a divergence between two numbers). A model call between two numbers
   and the sentence comparing them is a hallucination seam.
7. **Market select removed** instead of rebuilt as a custom listbox (5.4):
   market resolution is automatic from the ticker suffix/currency/exchange, so
   the control was redundant; a static market indicator with a tooltip replaces
   it. Simpler than a listbox and removes an input that could contradict the
   symbol.
8. **Anchors excluded from the blend** (see §2.1). Alternative (tiny weight)
   rejected: any weight on spot-reproducing methods biases the headline toward
   the market and defeats the point of an independent estimate.
9. **Light-mode contrast fixed with scoped tokens** (`.ic-report-scope`) rather
   than editing the global light palette: other tabs' palette is someone
   else's tuned surface (stop-condition 1 adjacent). Note: Tailwind v4 resolves
   `--color-*` aliases at `:root`, so the scoped rule overrides the aliases
   directly.
10. **No zod dependency**: hand-rolled per-field validation with recorded
    rejections. Equivalent safety, one fewer supply-chain surface; `tsx` was
    the only dependency added (dev-only, for the harness).
11. **Concurrent session protocol**: another agent session created
    `feat/knowledge-graph-v2` from this branch mid-mission and owns the working
    tree's HEAD. To avoid clobbering it, IC commits land on the shared HEAD and
    are cherry-picked onto `ic-report-hardening` via a separate worktree
    (`/tmp/ic-hardening-wt`). `ic-report-hardening` contains exactly the IC
    work; nothing was committed to main.
12. **"Conviction" derived, and labelled as derived**, from the distribution of
    agent confidences (the thesis schema has no conviction field); exports say
    exactly how it was computed.

## 5. Deliberately not done, with reasoning

- **Streaming model tokens for narrative sections (5.1 partial)**: sections
  render progressively per stage, but individual model responses are not
  token-streamed. `runPrompt` has no streaming interface; threading one through
  the router/orchestrator touches every AI consumer in the app. Stage-level
  progressive rendering already removes the minutes-of-empty-pane defect.
- **Web Worker/背景 job runner (7.4)**: replaced by the server-side detached
  run registry, which achieves the actual goal (navigation does not kill the
  run; completion is picked up on return) with less machinery. In-process
  registry does not survive a dev-server restart; the persisted report history
  does.
- **Signal trend sparklines (5.13 partial)**: evidence, window, thresholds and
  data points render per signal; per-signal time-series charts need historical
  ratio series that only exist for a subset (statements/screener.in ratios).
  Documented gap rather than misleading part-coverage charts.
- **Indian filings integration (Phase 4)**: SEC EDGAR is US-only; the Indian
  path states this as an explicit gap on every IN report and leans on
  screener.in for annual trends. Integrating BSE/NSE filings is a data-source
  project of its own.
- **Seed/temperature recording (7.7 partial)**: model + prompt versions are
  recorded; the AI layer does not currently expose per-call seed/temperature.
  Recording them requires an AI-router change shared with every other tab.
- **`fetchValuationFacts` FCF-CAGR anomaly** (INFY delivered growth 1378%):
  upstream prefill bug outside the IC surface; the IC boundary clamps it and
  the seeded-case label says so. Left a defect note rather than editing the
  user's in-flight `lib/valuation` WIP.

## 6. Remaining known limitations / next steps

- LLM narrative quality is bounded by the local model; grounding enforcement
  downgrades rather than regenerates. A regenerate-on-unsupported-figures loop
  would cost another model call per offending agent.
- The in-flight run registry is per-process: a dev-server restart mid-run loses
  the run (the finished-report history survives). A durable queue would fix it.
- Report history diffs are summary-level (headline, signals, spot). A
  field-level diff view would be a natural extension of the canonical model.
- `.NS`/`.BO` resolution trusts the user's suffix; a resolver that offers the
  NSE listing when a bare Indian name is typed would close the last input gap.
- Windows/Linux portability of the PDF fonts is handled (fonts are committed),
  but `qlmanage`-style visual PDF checks in CI are macOS-only.
