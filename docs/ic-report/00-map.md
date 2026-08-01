# IC Report — Phase 0 Map (baseline, before hardening)

Date: 2026-08-02. Branch: `ic-report-hardening`. This documents the feature **as found**,
including defects, before any changes.

## 1. File inventory

### Core pipeline (lib/)
| File | Lines | Responsibility |
|---|---|---|
| `lib/ic-report.ts` | 223 | Stage 6 orchestrator. Runs signals → questions → agents → thesis → valuation → reconciliation, emits progress events, assembles `ICReport`. |
| `lib/ic-signals.ts` | 466 | Stage 1. Pure detectors over snapshot/statements/insider/screener.in. 18 categories in the type, ~12 with detectors. |
| `lib/ic-questions.ts` | 345 | Stage 2. Signal→question templates + 6 always-on baseline questions; groups questions by agent domain. |
| `lib/ic-agents.ts` | 396 | Stage 3. 9 agent personas; builds per-domain data context; sequential dispatch to Ollama; JSON extraction; grounding verification. |
| `lib/ic-thesis.ts` | 99 | Stage 4. Single LLM call synthesising agent findings into bull/bear/base + catalysts/risks/drivers. |
| `lib/ic-valuation.ts` | 679 | Stage 5. Run hot/cold percentile maths; LLM "cross-check" prompt that asks the model for price targets; `applyCaseNumbers` overwrite; case-vs-engine reconciliation. |

### Surface (app/)
| File | Lines | Responsibility |
|---|---|---|
| `app/ic-report/page.tsx` | 1008 | Entire UI: input, SSE consumption, progress sidebar, 5 tabs (thesis/valuation/agents/signals/watch items), sessionStorage cache. |
| `app/api/ic-report/route.ts` | 154 | POST SSE endpoint. Loads quote/fundamentals/statements/screener.in in parallel, seeds a ValuationCase if absent, streams pipeline events. |
| `app/api/export/ic-report/route.ts` | 606 | PDF export via pdfkit. Redeclares its own (divergent) report interfaces. Built-in Helvetica only. |

### Supporting modules (read, not owned by this feature)
- `lib/types.ts` — `FundamentalsSnapshot`, `FinancialStatements` (`AnnualPoint {fy, value}`), `AnalystConsensus`, `InsiderActivity`.
- `lib/fundamentals.ts` — Yahoo quoteSummary → snapshot/analyst/insider. No currency on the snapshot.
- `lib/statements.ts` — SEC EDGAR companyconcept → annual points (USD only, `fy` from EDGAR, 330–400-day period filter); Yahoo fundamentals-timeseries fallback (`fy` = calendar year of period end — off-by-one risk for non-Dec FYE).
- `lib/yahoo.ts` — `getQuote` (has `currency`, `marketCap`, 52w range), `getHistory(symbol, days)`.
- `lib/valuation/case.ts` + `prefill.ts` — the app's single intrinsic-value estimate (deterministic 2-stage DCF), seeded from Yahoo FCF/shares/net-debt + CAPM WACC. `canValue` requires positive FCF.
- `lib/valuation/engine-prior.ts` — Monte Carlo p50 prior when available.
- `lib/ai.ts` / `lib/ai/router.ts` / `task-registry.ts` — model routing per task, timeouts, fallback.
- `lib/ai/grounding.ts` — numeric-claim tracing of LLM prose against its data slice (±4% tolerance).
- `lib/json-extract.ts` — tolerant JSON extraction with defaults.
- `lib/screener-in.ts` — screener.in HTML scrape for `.NS`/`.BO` names (₹ crore units).
- `lib/format.ts` — app-wide formatting helpers (NOT used anywhere in the IC feature — every file formats ad hoc).

### Consumers of ic-* exports
`app/ic-report/page.tsx`, `app/api/ic-report/route.ts`, `tests/ic-{agents,report,thesis,valuation}.test.ts`. No other tab imports these modules, so the IC surface can be rebuilt without cross-tab breakage (stop-condition 1 does not trigger).

## 2. Data flow

```
 POST /api/ic-report {symbol, exchange}
   │  Promise.allSettled:
   │    getQuote(symbol)                Yahoo   → price, currency, marketCap, name
   │    getFundamentals(symbol)         Yahoo   → snapshot / analyst / insider
   │    getFinancialStatements(symbol)  EDGAR   → annual revenue/NI/FCF/margins (US only; throws for .NS/.BO)
   │    getScreenerInCompany(symbol)    scrape  → Indian ratios/peers/shareholding (IN only)
   │  seed ValuationCase if absent (fetchValuationFacts → seedAssumptions → computeCaseResult)
   ▼
 generateICReport (lib/ic-report.ts)
   1. detectAllSignals(snapshot, statements, insider, epsSurprises, screenerIn)
   2. generateQuestions(signals) + 6 baseline → groupByAgent (Map<domain, Q[]>)
   3. runAgentNetwork — sequential; per agent: buildDataContext(domain) → prompt → runPrompt(json)
      → extractAgentJson → verifyGrounding
   4. formThesis — one LLM call over all findings
   5. getHistory(symbol, 7300) → computeRunHotCold
      runValuationEngine — LLM prompt asked for approaches (WITH price targets), scenarios,
      sensitivity prose, verdict, case assessment → parseValuation → applyCaseNumbers
      (overwrites headline + scenario prices with the case's; approaches are NOT overwritten)
   6. reconcileValuations(case fairValue vs engine p50) when both exist
   7. monitorables = thesis.keyDrivers + high-severity signals, slice(0, 8)
   ▼
 SSE events → page.tsx (renders ONLY when stage === "done")
   ├─ sessionStorage "uaa_ic_last_report"
   └─ Export PDF: POST /api/export/ic-report {report} → pdfkit
```

## 3. Where numbers are computed / transformed / formatted / rendered (baseline)

| Site | What happens | Risk found |
|---|---|---|
| `statements.ts extractAnnual` | EDGAR `fy` label taken verbatim; USD-only | Yahoo fallback derives fy from calendar year of period end (off-by-one for non-Dec FYE) |
| `ic-signals.ts pct()` | multiplies by 100 with `%` label | growth-rate *deltas* (pp) labelled `%` (REVENUE_DECELERATION, MARGIN_COMPRESSION) |
| `ic-agents.ts buildDataContext` | ad-hoc `$X.XB` formatting | `$` hardcoded for debt/cash/EBITDA/FCF and analyst targets on ALL markets, including ₹ names |
| `ic-valuation.ts buildValuationContext` | same ad-hoc `$` formatting | same defect |
| `ic-valuation.ts computeRunHotCold` | percentile of 5Y (or 3Y/1Y) rolling CAGR window | UI pairs this percentile with the **1-year** return and 1-year median → statistically impossible pairing on screen; per-window chips show a *different* percentile for what reads as the same statistic |
| LLM valuation prompt | model emits `priceTarget`/`impliedUpside` strings per approach | the architecture defect: model produces numbers; methods table never reconciled to case; scenario prose free-written |
| `applyCaseNumbers` | overwrites headline + scenarios with case numbers | approaches left as model-invented; label-substring matching |
| `page.tsx` | renders formatted strings verbatim; sign-based colouring (`startsWith("+")`) | downside colouring keyed to arithmetic sign of a *string* |
| PDF route | own interfaces; `+`/`-` substring colouring; Helvetica (WinAnsi) | `→ ✓ ⚠ ◆ · – ₹` all mojibake; filename date = export-time UTC while header = generatedAt locale |

## 4. Known defects catalogued at baseline (root-cause clusters)

**A. No canonical data object** — every stage re-interprets raw payloads; currency hardcoded to `$` in prompts; snapshot carries no currency/as-of/source; `exchange` select and symbol suffix disagree on market; quote currency mapped `INR→₹ else $` (GBp/EUR ADRs mislabeled).

**B. Model produces numbers** — `runValuationEngine` prompt explicitly requests price targets and upsides per method; assumptions prose free-written; sensitivity is prose citing numbers never rendered; scenario narratives generated independently of the case's numbers (thesis too).

**C. Percentile/statistics defects** — 1Y return displayed against 5Y-window percentile; `medianReturn` from rolling 1-year *simple* returns vs `oneYearReturn` as *CAGR*; since-IPO simple return used as "1-year return"; inclusive-`<=` percentile with no interpolation; two percentiles for the same concept on one screen.

**D. Agent-count/accounting lies** — copy says "9 agents"/"13 signal types"; actual agent count = distinct domains with questions (7 baseline; accounting+governance only via signals); `questionsAnswered = questions.length` but prompt caps at 6; thesis prompt hardcodes "9 specialist agents"; landing copy lists "growth …optionality" domains that don't match `AGENT_CONFIG`.

**E. Signals half-shipped** — 18 categories typed, 6 have no detector (SHARE_DILUTION, GUIDANCE_CUT, MARKET_SHARE_LOSS, ROYALTY_INCREASE, RELATED_PARTY_EXPANSION, CAPEX_SURGE) yet all have question templates; no market gating concept; negative checks (pass state) never surfaced.

**F. Export quality** — non-WinAnsi glyph mojibake; running header drawn as body text (`doc.text` at fixed y) interleaves on extraction; no page numbers/ToC links; duplicated disclaimer; no parity (PDF lacks questions/grounding/reconciliation/caseAssessment/windows; UI lacks reconciliation/caseAssessment too); filename/header date mismatch; own divergent type declarations.

**G. UI lifecycle** — nothing renders until `done` (minutes of empty pane); layout shift between running/complete; native `<select>`; no URL state; sessionStorage cache without age/history/warning; "Local AI" pill looks interactive; fixed-height live feed; monitorables mix drivers and signal templates.

**H. Resilience** — no per-agent retry; one shared timeout regime; no stage caching/persistence (reload kills run); no pre-flight checks (model present? provider reachable?); no seed/temperature/prompt-version recorded; no ticker sanitisation before prompt/URL interpolation.

**I. Indian path** — statements throw for non-US (caught upstream as null); EDGAR gap silent; `detectFxExposure(symbol, symbol)` drops company name; `isConglomerate` name-list hack; ₹ formatting partial; no lakh/crore consistency; FII/DII gating only implicit via screenerIn presence.

## 5. Test infrastructure at baseline
`tests/ic-agents.test.ts`, `ic-report.test.ts`, `ic-thesis.test.ts`, `ic-valuation.test.ts` — parser/fallback behaviour only. Zero coverage of: signal detectors' thresholds, question accounting, run hot/cold maths, applyCaseNumbers, PDF, UI. Full suite: `npx vitest run` (1715 tests green pre-change).

## 6. Environment facts
- Node v26 (native TS type-stripping available for scripts).
- Ollama installed; models: qwen3.5:4b/9b, qwen3:14b, qwen3:30b-a3b, devstral:24b, qwen2.5-coder:14b, qwen3-coder, mistral. None resident; LLM stages cost minutes each.
- Yahoo reachable via yahoo-finance2 (raw curl 429s; the library's crumb handling works).
- No IC-report persistence in `lib/db.ts` (sessionStorage only).
