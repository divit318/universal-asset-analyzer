---
name: uaa-fincalc
description: Validate or modify UAA's financial calculations (scoring, DCF/valuation, portfolio math, risk) without silently breaking investment-grade numbers
---

UAA must never silently produce an incorrect investment calculation. Any change to financial math follows this workflow.

## 1. Know which engine you are in

| Domain | Single source of truth | Tests |
|---|---|---|
| Batch dimensional scoring (Screener) | `lib/composite.ts` (`valueScore`, `growthScore`, `qualityScore`, `financialHealthScore`, `momentumScore`, `computeScores`) | `tests/composite.test.ts` |
| Single-name decision engine | `lib/scoring.ts` (`scoreValuation`, `scoreQuality`, `scoreGrowth`, `scoreHealth`, `scoreCapitalAllocation`, …) | `tests/scoring.test.ts`, `tests/scoring-consistency.test.ts` |
| Score→recommendation bands/labels/tones | `lib/recommendation.ts` — the ONLY place bands live | `tests/unified-recommendation.test.ts` |
| DCF / valuation workspace | `lib/valuation/` (`dcf.ts`, `wacc.ts`, `reverse.ts`, `calibration.ts`, `revaluation.ts`) | `tests/valuation*.test.ts` |
| IC Report valuation (institutional) | `lib/ic/valuation-engine.ts` + `valuation-suite.ts` — every figure computed DETERMINISTICALLY; the model only proposes inputs, validated in `lib/ic/valuation-inputs.ts` | `tests/ic-valuation*.test.ts` |
| Portfolio math | `lib/portfolio-analytics.ts` | `tests/portfolio-*.test.ts` (30+ files), `tests/risk-ratios.test.ts` |

Two scoring engines exist BY DESIGN (batch vs single-name). Never merge them, never copy formulas between them, never inline recommendation bands anywhere.

## 2. Test-first, with an independent reference

1. Write the failing test BEFORE changing the formula. Put it in the existing test file for that engine.
2. For non-trivial math (IRR, WACC, Kelly, Sharpe/Sortino, MC percentiles), cross-check against an independent implementation in the Python venv — it has numpy/scipy/statsmodels:
   ```bash
   .venv/bin/python -c "import numpy_financial as npf" 2>/dev/null || \
   .venv/bin/python -c "import numpy as np; print(np.irr if hasattr(np,'irr') else 'use scipy.optimize.brentq for IRR')"
   ```
   Compute the expected value independently, then assert it in the TS test with an explicit tolerance (`toBeCloseTo`, document the digits).
3. Golden values in tests must state their provenance in the test (hand-computed, scipy, a filing). No "snapshot whatever the code returns".

## 3. Formatting and unit rules (institutional correctness)

- IC surfaces format ONLY through `lib/ic/format.ts` — it is INR lakh/crore aware and uses branded types to distinguish percentage-points (pp) from percent (%). Never hand-format a number on an IC surface.
- Elsewhere, use `lib/format.ts`. Never `toFixed()` inline in components.
- Financial color semantics (`--positive`, `--negative`, `--warning`) are never repurposed for chrome.

## 4. Verify

- `npx vitest run tests/<engine>*.test.ts` then the FULL suite (`npx vitest run`) — scoring changes ripple into screener/portfolio/IC tests by design.
- IC Report end-to-end harness (deterministic, no spend): `npx tsx scripts/ic-report-harness.ts`; add `--llm` only when the user approves live model runs.
- If provenance/canonical data shape changed, read `lib/ic/canonical.ts` and `docs/ic-report/00-map.md` first.

## 5. Red flags — stop and ask

- A test tolerance being widened to make a change pass.
- A formula change that alters existing recommendation bands or historical scores without the user explicitly requesting it.
- Copying a scoring/valuation formula into a page, API route, or second lib file.
