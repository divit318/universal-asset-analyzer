# ADR-002: Market-parameterized scoring engines (India)

**Date:** 2026-09-01 · **Status:** Accepted · **Context:** Phase 3 of the India strategy
(docs/india-strategy/PHASE2_LOCALIZATION_AUDIT.md found Indian stocks reachable
through US-calibrated judgment paths).

## Decision

Indian stocks are analyzed by **market-parameterized shared engines plus the
dedicated screener.in engine** — not by extending `lib/india-snapshot.ts` to
every surface, and not by leaving the shared engines US-calibrated.

1. **`lib/composite.ts` and `lib/scoring.ts` derive the market INTERNALLY from
   the symbol suffix** (`bandMarketOf`/`bandMarket`) and select US or IN
   normalization bands per metric. Callers cannot opt out or forget — this is
   the anti-leak property. Suffix-only detection is deliberate: an ADR
   (INFY on NYSE) is a US listing priced by US investors and keeps US bands,
   consistent with `waccRegionFor`.
2. **`lib/india-snapshot.ts` remains the canonical single-name India verdict**
   on the research page. It reads screener.in data (ROCE, net NPA, promoter
   holding, interest coverage) that Yahoo does not carry, and therefore sees
   India-specific quality factors the shared engines cannot. The shared
   engines are the *consistent batch/secondary layer* (screener, compare,
   portfolio recommendations, `/api/fundamentals`) — India-calibrated, but
   Yahoo-limited.
3. **US-market-derived signals are gated out of non-US listings at the source**:
   sector rotation (US SPDR ETFs) via `sectorRotationEntryFor` in
   `lib/sector-rotation-utils.ts`; Yahoo's S&P 500-relative beta via
   `resolveBeta` in `lib/valuation/prefill.ts` (NIFTY regression or the 1.0
   prior — never the vendor figure for IN).

## Why not india-snapshot everywhere?

- It requires a screener.in fetch per symbol (rate-limited scraping) — the
  500-name screener and multi-holding portfolio paths cannot batch it.
- Compare must render one bucket structure across a US and an Indian stock.
- The two-engine split (batch `composite.ts` vs single-name `scoring.ts`)
  exists by design (AGENTS.md); a third full engine would deepen divergence.

## Why not one US band set with disclaimers?

Phase 2 demonstrated material misjudgment: TCS/HUL scored 0/10 on a US PEG
band; the India screener judged ~500 NSE names on US thresholds; TCS inherited
XLK's sector momentum at 10% weight; DCFs discounted INR flows at 6.4–7.8%.

## Consequences

- Every IN band override carries an inline rationale traceable to the Phase 2
  norms reference; metrics whose norms are business-model driven (margins,
  current ratio, FCF conversion, momentum) intentionally keep one band.
- `tests/india-localization.test.ts` is the leak guard: identical fundamentals
  under a `.NS` vs US symbol must produce the documented band differences, and
  Indian symbols must never receive sector-rotation entries or Yahoo betas.
- Residual known divergence: the research page (screener.in engine) and the
  shared engines (Yahoo data) can still disagree for an Indian name — by
  design, since they see different data. The research page's verdict wins on
  that surface; other surfaces are at least India-calibrated now.
- Adding a new market (JP/EU/…) means adding a band column, not a new engine.
