# Tranche 5 — Compare (equity + class) + Simulator

Date: 2026-08-05. Verified: tsc silent, 2,697 tests pass, eslint clean,
`next build` green; class compare exercised live through the app under
`AI_PROVIDER=devin`.

## What migrated

**Equity compare** (`lib/ai-compare.ts` blocking path) — `runAnalysis` with
`EquityComparisonWireSchema` (10 narrative sections + ranked verdict tail).
The loose bag flows through the existing `flatFromStreamedFields` merge, so
`finalizeComparison` sees the identical shape from blocking, streamed, and
seam paths. The streamed twin (`streamComparisonFields`) stays on the token
stack per the agreed order.

**Class compare** (`lib/compare/class-ai-compare.ts`) —
`ClassComparisonWireSchema` (per-class keyQuestions + the same verdict tail).
Downstream sanitizers (`normalizeRankings`, `sanitizeKeyQuestions`) unchanged.

**Simulator** (`lib/portfolio/simulator/generate.ts`, both structured stages)
— `AllocationWireSchema` / `SelectionWireSchema`. `parseSelectionResponse`
split into a string entry point (kept, exported, tested) delegating to
`parseSelectionBag`, so mandate enforcement (exclusion filter, symbol
validation, budget renormalization) exists once and serves both entry points.
`portfolio-construction` is `latency:"interactive"`: under the global flag the
guardrail keeps it on the token stack; the wire schemas apply whenever a
per-task pin routes it to sessions.

**Error classification** (`lib/ai/errors.ts`): `DevinAnalysisError.category`
now maps directly onto `AiErrorCategory` (duck-typed by name, same
no-import-cycle convention as `codeOf`) — the Compare page's `aiStatus` copy
stays accurate under the new provider, and `cancelled` propagates so an
aborted compare still rethrows.

Wire-design notes carried into the schemas as comments:
- `noClearWinner` accepts boolean OR "true"/"false" strings — the downstream
  coercion is deliberately lenient; a stricter wire would make Devin the only
  provider forbidden from a quirk the app already tolerates.
- Ranking symbols are NOT enum-constrained: `normalizeRankings` back-fills a
  bad symbol from composite-score order, and a wire rejection for one bad
  entry would cost the whole comparison.

## Parity gates (records in bench-out/parity/)

| Task | Subject | Devin (sessions) | Token stack | Agreement |
|---|---|---|---|---|
| compare | AAPL,MSFT,NVDA (5KB dossier) | ok 122.4s — **NVDA>MSFT>AAPL, conf 82** | ok 45.3s — **NVDA>MSFT>AAPL, conf 82** | identical ranking AND identical confidence |
| simulator | allocation (growth/risk-7 mandate) | ok 24.3s — equity 46/etf 35/bond 9/reit 5/cash 5 | ok 11.1s — equity 50/etf 28/bond 11/reit 5/cash 6 | same shape, ±5pp weights — both inside the mandate |
| simulator | selection | ok 52.2s — 12 picks, budgets respected | ok 4.4s — 11 picks | both valid; different-but-defensible menus |

KOSS,BGFV degenerate pair skipped honestly: BGFV no longer loads from Yahoo
(`Only 1 of 2 symbols loaded`) — same upstream loss the tranche-2 insight gate
logged.

**The gate did its job in reverse too:** three `wire-incomplete` flags on the
token-stack side showed my wire caps were stricter than observed legitimate
behavior (6 evidence bullets for a mega-cap; a terse selection rationale).
The WIRE was relaxed to match reality (strengths/weaknesses ≤6, `why` min 1)
— tightening the models to match the schema would have converted richness
into corrective turns.

## Live under the flag

`POST /api/compare/class` (BTC-USD, ETH-USD, SOL-USD): `model: devin`,
ranking BTC>ETH>SOL with **noClearWinner: true, confidence 45** — "one
correlated trade at three risk intensities" — grounding level high, 4/4 key
questions answered. The honest-uncertainty behaviors the prompts ask for
survive the transport.

Compare's 122s tail (largest dossier yet) is inside the new
`devinTimeoutMs: 300_000` for `comparison`; blocking compare is a
click-triggered page with progress UI, not a spinner-gated interactive.

## Remaining in the agreed order

scanner (fan-out validated ≤40; **still gated on the Settings > Plans
reading**) → IC report → thematic → streaming redesigns.
