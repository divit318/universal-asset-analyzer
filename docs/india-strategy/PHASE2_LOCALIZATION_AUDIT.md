# UAA India Strategy — Phase 2
## India-Specific Analytical Framework & Localization Audit

**Date:** 2026-09-01
**Status:** Phase 2 complete. No fixes implemented (per instruction). Phase 3 NOT started.
**Method:** Four parallel code-audit streams (scoring/screening engines, valuation stack, portfolio + AI layers, plus a web-research stream establishing Indian analytical norms as the correctness reference), combined with **live representative-asset tests** run against UAA's own deterministic pipelines (no LLM spend): 7 stocks through `buildFundamentalsData`/`computeScore`, 5 funds through `getFundProfile`/`computeFundScore`, 3 Indian names through the IC valuation harness (`scripts/ic-report-harness.ts`), an independent beta re-computation (Python/yfinance vs NIFTY and S&P 500), and a live AMFI API probe. Builds on `docs/india-strategy/PHASE1_MARKET_INTELLIGENCE.md`.

**Correctness reference used** (from the norms research stream, all cited): Nifty 50 long-term median P/E ≈ 20–21x; Indian sector P/E norms (FMCG 30–60x, PSU banks 7–15x, capital goods 35–46x); India 10Y G-sec ≈ 6.6–6.9%; Damodaran India ERP ≈ 7.1–7.5%; typical Indian WACC 10–14%; Indian DCF terminal-growth convention 5–6%; SEBI TRI-benchmark mandate (2018); AMFI/SEBI 36-category MF scheme; ValueResearch/Morningstar category-relative rating methodology; SEBI TER caps by AUM slab; direct-vs-regular TER gap 0.6–0.9% for active equity.

---

# 1. Executive Verdict

**Can UAA currently be trusted to evaluate Indian stocks and mutual funds without systematically importing US-market assumptions? — No, not uniformly. But the failure mode is NOT "a US model with Indian data attached." It is a two-track system with cross-track leaks.**

The audit **disproves** the naive hypothesis. UAA contains substantial, deliberate, and often well-executed India localization:

- Market detection (`lib/market.ts:30-71`) reliably routes `.NS`/`.BO`/INR to `IN` across the app.
- Benchmarks are market-aware (`lib/benchmarks.ts`): NIFTY 50 (`^NSEI`) not SPY, NIFTY sector indices, India risk-free 6.5% — and these are live wires, consumed by the research bundle and portfolio context.
- A dedicated **India single-name engine** (`lib/india-snapshot.ts`) scores Indian stocks from screener.in data with genuinely India-calibrated thresholds (ROCE bands, net-NPA for banks, promoter holding, P/E ≤ 18 "reasonable" bands, interest coverage) that align well with the Indian-norms reference. The research page uses it as the ONLY headline score for NSE/BSE names, specifically to avoid contradictory verdicts (`app/research/page.tsx:649-665`).
- WACC carries region parameters (`lib/valuation/wacc.ts:24-26`: IN rf 6.5%, ERP 6.0%, tax 25.17%), terminal growth is region-split (US 2.5% / IN 3.5%, `lib/valuation/prefill.ts:55`), the IC canonical layer carries market/currency and refuses to mix currencies (`lib/ic/canonical.ts:180-189`), and IC surfaces format INR in lakh/crore (`lib/ic/format.ts`).
- The screener's India asset class is INR-native with ₹Cr market-cap scales and India-specific templates including promoter/FII ownership screens (`lib/assets/india-equity.ts`).
- Signal weighting is India-aware: analyst consensus is down-weighted from 0.25 to 0.10 for IN (`lib/scoring.ts:385-388`).
- MF plumbing knows AMFI exists: an AMFI TER provider with direct/regular plan detection (`lib/amfi.ts`), and the fund scorer honestly labels absolute-vs-category-relative performance rather than fabricating a category edge (`lib/fund-scoring.ts:44-56`).

**However**, the second track — the US-calibrated engines — still evaluates Indian assets on several reachable surfaces, and several US inputs leak into the India-aware track itself:

1. **The DCF discount rate is systematically wrong for Indian stocks** (CRITICAL, verified live): Yahoo's beta for `.NS` names is computed against the **S&P 500**, not NIFTY. Measured: TCS Yahoo beta 0.164 vs true NIFTY beta 0.89; RELIANCE 0.157 vs 1.08; HDFCBANK 0.414 vs 1.02. Fed into CAPM this produces WACCs of **6.4–7.8%** for Indian large caps — RELIANCE's 6.4% is *below India's own risk-free rate* — where Indian practice is 10–14%. Every Indian DCF fair value is systematically inflated. The region parameters are right; the beta wire is cross-market.
2. **The India screener scores ~500 NSE names through the US-calibrated batch scorer** (`lib/composite.ts`) with absolute bands tuned for US mega-caps (CRITICAL).
3. **The US-threshold single-name engine remains reachable for Indian stocks** via `/api/compare`, `/api/portfolio/buy/recommendation`, `/api/fundamentals`, and the research bundle — so the same Indian stock can receive two different verdicts from two engines depending on the surface (CRITICAL as an architecture problem).
4. **The sector-rotation signal fed into Indian composite scores is computed from US SPDR sector ETFs** (XLK/XLF/...), and the India weight profile gives it MORE weight (0.10) than the US default (0.08). Verified live: TCS and AAPL share the identical "Technology #4/11, +2.0pp, momentum −4.5" rotation entry (CRITICAL).
5. **Indian mutual funds are evaluated without their category system** (HIGH): no AMFI category resolution, therefore absolute-return judgments where category-relative is the Indian norm; identical criteria for small-cap vs debt vs index funds; no TRI benchmark; no rolling returns; no tracking difference. The AMFI TER wire is additionally **broken in practice** by an API pagination regression (verified live).
6. **US-framed AI and display leaks**: the macro verdict prompt hard-codes US Treasuries/Fed, home-surface value formatting hard-codes `$`, NSE options Greeks use a 4.25% US risk-free, and the quant engine rate-scales even its India universes by the US 10Y (^TNX).

**Bottom line:** the India-aware track (research page, benchmarks, IC formatting, WACC regions, India screener templates) shows the team already understands market-context dependence. The problem is **inconsistent application**: the screener, compare, portfolio recommendations, DCF beta, sector rotation, fund analysis, and several AI/display layers still run Indian assets through US-calibrated logic — producing exactly the "confident-looking but systematically inappropriate judgments" this phase was designed to detect.

---

# 2. Stock Analysis Localization Audit

## 2.1 The two-track architecture (context for everything below)

| Track | Engine | Data source | Thresholds | Where it judges Indian stocks |
|---|---|---|---|---|
| **India-aware** | `lib/india-snapshot.ts` | screener.in (`lib/screener-in.ts`) | India-calibrated | Research page headline verdict for NSE/BSE (`app/research/page.tsx:649-676`) |
| **US-calibrated** | `lib/scoring.ts` (single-name), `lib/composite.ts` (batch) | Yahoo | US-absolute (sector-branched) | India **screener** (composite), `/api/compare`, `/api/portfolio/buy/recommendation`, `/api/fundamentals`, research-bundle `fundamentals` step, landing demo |

The research page deliberately suppresses track 2 for Indian equities ("Yahoo's coverage is unreliable and produced a second, contradictory headline score" — `app/research/page.tsx:649-651`). But track 2 still runs and still surfaces for Indian symbols elsewhere. The two tracks can and do disagree (see §5).

## 2.2 Valuation metrics

| Metric | Current logic | India-appropriate? | Evidence |
|---|---|---|---|
| P/E (India engine) | ≤12 full credit, ≤18 strong, ≤25 partial, ≤35/50 fading | **Yes** — matches Nifty median ≈ 20x context; sector-blind but reasonable bands | `lib/india-snapshot.ts:357` |
| Forward P/E (US engines, used on India) | default cheap→expensive 8→40x; financials 8→18/20x; utilities 12/13→28/30x | **Partially** — bands are wide enough for large caps but derived from US norms; FMCG/capital-goods names (norm 30–60x) always score poorly regardless of quality-adjusted fairness | `lib/composite.ts:59`, `lib/scoring.ts:51,61` |
| PEG (US single-name engine) | 0.8 best → 3.0 worst, all markets | **No for Indian quality compounders** — TCS (PEG 2.97) and HUL (3.69) both scored 0/10; Indian consumer staples structurally carry PEG > 2.5. Absolute PEG bands import a US-value convention | `lib/scoring.ts:70`; live test §5 |
| EV/EBITDA | US engines: 5→22x; India engine: **always null** (screener.in doesn't provide it; hard-coded null) | US bands unexamined for India; India engine has a **dead metric** | `lib/composite.ts:60`, `lib/india-snapshot.ts:94,230` |
| Analyst upside | −15%→+30% band, both engines; India blend weight cut to 0.10 | **Questionable** — Indian analyst coverage via Yahoo is thin (counts/ratings missing in live tests) and HDFCBANK showed +43.1% "upside," suspiciously consistent with a corporate-action-unadjusted target. The weight cut helps the blend but the valuation *bucket* still uses upside at full factor weight | `lib/scoring.ts:50`, live test §5 |
| Relative multiples (IC) | Default = the stock's **own current multiple**, clamped [2,80] P/E; marked "anchor" and excluded from the fair-value blend | **Defensible** (no fake US "fair P/E") but no Indian sector-relative band either; screener.in peer P/Es are shown to the model but never used in deterministic math | `lib/ic/valuation-inputs.ts:89-91`, `lib/ic/valuation-suite.ts:320-345` |

## 2.3 DCF / cost of capital (the largest quantitative error found)

| Input | Value | Assessment |
|---|---|---|
| Risk-free (IN) | 6.5% static | Right ballpark (10Y G-sec 6.6–6.9%); static, no live feed | 
| ERP (IN) | 6.0% static | **Low** vs Damodaran India ≈ 7.1–7.5%; no country-risk-premium structure |
| **Beta** | **Yahoo raw beta — S&P 500-relative for `.NS` names** | **WRONG INDEX.** Measured live: TCS 0.164 (Yahoo) vs 0.89 (true, vs NIFTY, 5y weekly); RELIANCE 0.157 vs 1.08; HDFCBANK 0.414 vs 1.02. Clamp floor 0.1 does not catch it (`lib/valuation/wacc.ts:36`) |
| Cost of debt | **5.0% flat for both US and IN** | Below India's own risk-free rate; Indian corporate credit spreads ignored (`lib/valuation/wacc.ts:25-26`) |
| Tax rate (IN) | 25.17% | Correct |
| Terminal growth (IN) | 3.5% default, capped at 5% | Conservative vs Indian convention (5–6%, nominal-GDP-anchored); the 5% engine cap (`lib/ic/valuation-engine.ts:79`) makes the Indian convention barely expressible |
| Resulting WACC (live) | TCS 7.1%, RELIANCE 6.4%, HDFCBANK 7.8% | vs Indian practice 10–14%. With corrected beta ≈ 1.0, TCS's cost of equity would be ≈ 12.5% (6.5 + 1.0 × 6.0), not 7.5%. **Every Indian DCF output is inflated**, partially offset by the conservative terminal growth — two wrongs producing an uncalibrated result |
| Currency | INR flows discounted at INR-parameter WACC; mismatches dropped, not mixed | **Correct** — the classic USD-rate-on-INR-flows bug is absent (`lib/valuation/dcf.ts:9-12`, `lib/ic/canonical.ts:180-189`) |

## 2.4 Quality / growth / health thresholds (US engines applied to India)

Full threshold inventory with file:line references was compiled during the audit; the pattern:

- ROE 5→25/30%, ROIC 5→25%, margins 20→70% gross / 5→30% operating, D/E 0.1→2, growth 0→20/25% (`lib/composite.ts:96-172`, `lib/scoring.ts:112-201`). These are **sector-branched** (financials/utilities/REITs get separate bands — Indian banks do get ROA/cost-income treatment, which is directionally right) but **not market-branched**.
- Versus the Indian reference: ROCE-first analysis (Indian norm) exists only in the India engine; the US engines don't score ROCE at all for India (screener.in ROCE 63% for TCS never reaches them). D/E norms are close enough for most sectors; growth bands (0→20-25%) are tolerable given India's higher nominal growth but systematically stingy.
- **Missing-data half-credit** (`lib/score-math.ts:62-64`): every absent input scores 50% of its factor. Indian names with thin Yahoo coverage (missing ROE, FCF CAGR, current ratio — observed live for RELIANCE, HINDUNILVR, SBIN) get padded toward the middle, and the confidence discount is modest (HDFCBANK: two half-credited buckets, still BUY @ confidence 78).

## 2.5 Momentum, sector rotation, peers

- **Momentum** (`computeMomentum`) is absolute (own price history, 52-wk range, SMAs) — market-neutral, **NO ISSUE**.
- **Sector rotation is a cross-market contamination** (verified live): `lib/sector-rotation.ts:37-48` hard-codes the 11 US SPDR ETFs; entries are keyed by sector name only; `computeScore` attaches the XLK entry to TCS and the XLI entry to POLYCAB, at weight 0.10 for IN (`lib/scoring.ts:387`). No NIFTY sector rotation exists despite `indiaSectorIndex()` already mapping sectors to NIFTY indices for charts (`lib/benchmarks.ts:93-106`).
- **Peers**: `lib/peers.ts:118-126` correctly refuses to compare Indian names to the S&P 500 universe (a previously fixed bug) — but nothing replaces it in the numeric engines. screener.in's Indian peer table (fetched, cached, rich: P/E, ROCE, mcap per peer) is **display-only** (`ranked-peers.tsx`), a dead wire for scoring/valuation.
- **Benchmark comparisons** in the research bundle and portfolio analytics are correctly market-aware (NIFTY 50 / NIFTY sector indices / GOI risk-free) — **NO ISSUE** (`lib/research-bundle.ts:105-121`, `lib/portfolio/context.ts`).

## 2.6 AI, macro, display layers

- **Macro verdict prompt is US-only**: "US Treasury yield curve … Do NOT invent CPI, GDP, payrolls, or Fed policy figures" (`lib/ai/verdict.ts:669-703`). No RBI/G-sec/CPI-India branch. CRITICAL for Indian macro context.
- **IC agent prompts are market-blind**: data context is INR-correct and even uses promoter/FII/DII terminology (`lib/ic-agents.ts:127-138`, with an explicit promoter-terminology rule at :251), but the agent instruction never states "this is an NSE-listed Indian company under SEBI/Ind AS" — the model must infer the regime from formatting.
- **Retrieval intent keywords** for filings are US-only (`10-k`, `10-q`, `sec` — `lib/ai/retrieval.ts:45`), though retrieved Indian filings are correctly labeled "Recent NSE corporate announcements" (`lib/ai/retrieval.ts:342-350`).
- **Hard-coded `$`**: home visualizations and home facts always render `$` regardless of asset currency (`app/_home/_viz/format.ts:30,36`, `lib/home/facts.ts:132`); `formatMarketCap` is an always-USD footgun (`lib/format.ts:143-146`) used in the crypto verdict and compare dilution chart. An Indian portfolio's P&L rendered as dollars is materially misleading.
- **Derivatives Greeks** use `RISK_FREE_RATE = 0.0425` for all markets (`lib/derivatives-analysis.ts:19`) — NSE option pricing with a US T-bill rate.
- **Quant engine**: has India universes (`engine/universe.py`) and an `universe_is_india` base adjustment (`engine/daily_run.py:240`), but rate-scales that base by the **US 10Y (^TNX)** even for India scans (`engine/daily_run.py:213-246`). India universe size buckets are USD-denominated (explicit, at least).
- **Thematic engine**: proxy lexicon is entirely US tickers/ETFs, and proxy performance is benchmarked to SPY even for India-relevant themes (`lib/thematic-engine.ts:143-157, 359-467`). An `indiaSpecificPolicies` field exists in its types but nothing populates the framework with Indian proxies.

---

# 3. Mutual Fund Localization Audit

## 3.1 What exists

The fund pipeline is: Yahoo fund modules → `mapFundProfile` (`lib/yahoo.ts:718-875`) → AMFI TER backfill for INR funds with missing expense ratios → `computeFundScore` (`lib/fund-scoring.ts`) scoring four buckets (Cost, Diversification, Performance, Risk-Adjusted Quality) + momentum, through the shared 0–100 / 5-tier recommendation frame. Deeper engines exist in `lib/research-engines/fund/` (overlap, concentration, regime behavior vs the market-aware benchmark, alternatives).

## 3.2 Findings (live-tested with Parag Parikh Flexi Cap, SBI Small Cap, UTI fund, NIFTYBEES.NS, SPY control)

| Dimension | Current behavior | India-appropriate? |
|---|---|---|
| **Category system** | Yahoo `category` — resolves for US funds ("Large Blend" for SPY) but **null for every Indian MF tested**. No AMFI/SEBI 36-category mapping exists anywhere. | **No.** The entire Indian evaluation norm (category-relative percentile, category-appropriate criteria) is unavailable to the scorer. This is the root cause of most downstream MF issues. |
| **Performance judgment** | Category-relative returns when Yahoo provides them; otherwise **absolute** returns against generic bands (1y: −20→+25%; 3y: −5→+18%) with honest "(absolute)" labeling | **Honest but category-blind.** SBI Small Cap's +2.9% absolute 1y scored 8/16 with the same band a liquid fund would get. Point-to-point returns only — the Indian norm is rolling returns. No TRI benchmark comparison (SEBI-mandated frame since 2018). |
| **Category-specific criteria** | One model for all funds: same concentration bands, same performance bands, same Sharpe bands for small-cap equity, debt, index, thematic | **No.** The Indian reference requires: drawdown/downside-capture emphasis for mid/small-cap; duration + credit quality + PRC matrix for debt; tracking difference/error for index funds; concentration-as-design for focused (SEBI max 30 stocks) and sectoral funds — the current diversification bucket would *penalize* a compliant focused fund for being what it is. |
| **Fees** | Expense ratio band 1.5%→0.03% (US index-fund-anchored); AMFI TER backfill exists with direct/regular awareness (`isDirectPlan`, R_TER vs D_TER, `lib/amfi.ts:151`) | **Band is US-anchored** (SEBI caps allow up to 2.25% for small-AUM equity; Indian direct large-cap ≈ 0.5–1%); worse, **the AMFI wire is broken in practice**: the API now caps `pageSize` at 100 (verified live: `meta: {pageSize:100, total:217, pageCount:3}` for PPFAS) while `lib/amfi.ts` requests `pageSize=10000` and reads only page 1 — the Flexi Cap scheme sits on page 2/3, match fails, TER stays null, Cost bucket half-credits. Every tested Indian fund had `expenseRatio=null`. |
| **Risk** | Yahoo/Morningstar Sharpe + "alpha vs category" when present (present for PPFAS: +4.7) | Partial — inconsistent Yahoo coverage; Sharpe's underlying risk-free basis is Yahoo's (US) convention; no downside capture, no drawdown, no riskometer/PRC awareness. |
| **Direct vs regular / growth vs IDCW** | Yahoo lists them as separate symbols (0P…), `amfi.ts` can detect plan type — but no surface tells the user they're looking at a regular plan or compares it to the direct variant | **Missing** — the single highest-conviction Indian MF heuristic (buy direct) is absent from analysis. |
| **Indian ETFs** | NIFTYBEES.NS (India's most popular ETF): holdings 0, no TER, no returns, no category → **HOLD 52 @ confidence 0** | Honest confidence-zero, but the flagship Indian passive product is effectively unanalyzable. No tracking-difference analysis exists for any index fund. |
| **Portfolio/overlap engines** | Regime behavior uses the market-aware benchmark (NIFTY for .NS) — good; alternatives engine is keyed to US curated lists + Morningstar categories → returns nothing useful for Indian funds | Mixed. |

## 3.3 MF verdict

UAA does **not** import wrong US judgments into Indian funds so much as it **abstains into genericness**: honest labels, confidence discounts, null-safe degradation — but the analytical result for an Indian MF investor is close to content-free (cost unknown, category unknown, performance absolute-only, risk thin), while still emitting a 0–100 score and a BUY/HOLD tier that *looks* like analysis. Given Phase 1's finding that MF-first investors are UAA-relevant, this is a capability gap more than a mis-localization — with one true bug (AMFI pagination) and one true framework problem (category-blind uniform criteria).

---

# 4. Data vs Interpretation vs Framework Matrix

| # | Issue | Class | Severity | Evidence |
|---|---|---|---|---|
| 1 | Yahoo beta is S&P 500-relative for `.NS`; feeds CAPM unchanged | **DATA INTERPRETATION** (right datum exists nowhere; wrong datum trusted) | **CRITICAL** | `lib/valuation/wacc.ts:83-86`; live: 0.16 vs 0.89 (TCS) |
| 2 | India screener scores via US-calibrated `composite.ts` bands | **INTERPRETATION** | **CRITICAL** | `lib/dataset.ts:340→295`, `lib/composite.ts:59-194` |
| 3 | `scoring.ts` (US thresholds) reachable for Indian stocks via compare/portfolio-buy/fundamentals API → contradicts India engine | **FRAMEWORK** (two-track inconsistency) | **CRITICAL** | `app/api/compare/route.ts:159`, `app/api/portfolio/buy/recommendation/route.ts:56` |
| 4 | US SPDR sector rotation feeds Indian composites at 0.10 weight | **FRAMEWORK** | **CRITICAL** | `lib/sector-rotation.ts:37-48`, `lib/scoring.ts:387`; live: TCS≡AAPL entry |
| 5 | Macro AI verdict hard-codes US Treasury/Fed | **FRAMEWORK** | **CRITICAL** (for macro surfaces) | `lib/ai/verdict.ts:669-703` |
| 6 | Home surfaces hard-code `$` for INR values | **INTERPRETATION** (display) | **CRITICAL** (trust) | `app/_home/_viz/format.ts:30,36`, `lib/home/facts.ts:132` |
| 7 | No AMFI category resolution for Indian MFs → absolute-return, uniform-criteria fund scoring | **DATA AVAILABILITY** (category feed) + **FRAMEWORK** (uniform criteria) | **HIGH** | `lib/fund-scoring.ts:44-56`; live tests |
| 8 | AMFI TER pagination regression (API caps at 100 rows; module reads page 1 only) | **DATA AVAILABILITY** (regression, easy fix) | **HIGH** | `lib/amfi.ts` fetch; live probe: total 217, pageCount 3 |
| 9 | Cost of debt 5% flat for India; ERP 6.0% vs Damodaran ~7.1–7.5%; static rates | **INTERPRETATION** | **HIGH** | `lib/valuation/wacc.ts:25-26` |
| 10 | `mk()` half-credit inflates thin-coverage Indian names | **FRAMEWORK** | **HIGH** | `lib/score-math.ts:62-64`; live HDFCBANK |
| 11 | Derivatives Greeks at 4.25% rf for NSE options | **INTERPRETATION** | **HIGH** | `lib/derivatives-analysis.ts:19` |
| 12 | Thematic engine: US proxies only, SPY benchmark | **FRAMEWORK** | **HIGH** | `lib/thematic-engine.ts:143-157,359-467` |
| 13 | IC agent prompts never state market/regulatory regime | **FRAMEWORK** (prompting) | **HIGH** | `lib/ic-agents.ts:280-299` |
| 14 | NIFTYBEES / Indian ETFs: near-total data void; no tracking-difference analysis | **DATA AVAILABILITY** | **HIGH** | live test |
| 15 | Quant engine rate-scales India universes by US ^TNX | **INTERPRETATION** | **MEDIUM-HIGH** | `engine/daily_run.py:213-246` |
| 16 | `lib/ios/fit-scorer.ts` USD mcap buckets ($2B/$10B) vs INR caps → Indian holdings mis-bucketed as micro-cap | **INTERPRETATION** | **HIGH (needs 1 verification)** | `lib/ios/fit-scorer.ts:428-430,532-535` |
| 17 | Absolute PEG bands (0.8→3.0) punish Indian growth-premium sectors | **INTERPRETATION** | **MEDIUM** | `lib/scoring.ts:70`; live HUL/TCS 0/10 |
| 18 | Analyst-target quality for India (thin coverage; possible unadjusted targets post-corporate-action) | **DATA AVAILABILITY** | **MEDIUM** (needs validation) | live HDFCBANK +43.1% |
| 19 | screener.in dead wires: peers, documents (ARs/concalls/credit ratings), KPIs, gross NPA, `basis` (consolidated/standalone) fetched but unused in any judgment | **DATA AVAILABILITY (ingested, unused)** | **MEDIUM** | `lib/screener-in.ts:435-731`; `lib/india-snapshot.ts` consumes a subset |
| 20 | India engine's EV/EBITDA hard-null; promoter **pledge** and net-NPA screener filters declared "unavailable" | **DATA AVAILABILITY** | **MEDIUM** | `lib/india-snapshot.ts:94,230`, `lib/assets/india-equity.ts:503-533` |
| 21 | Direct/regular plan identity not surfaced in fund analysis | **FRAMEWORK** | **MEDIUM** | `lib/amfi.ts:151` (capability exists, unused) |
| 22 | Portfolio alignment inflation/conflict heuristics generic (US-ish yields, 2008-scale shock); Sharpe default rf 4.25% in the primitive (overridden by market-aware callers) | **FRAMEWORK** | **MEDIUM** | `lib/portfolio/alignment/engine.ts:777,947-969`, `lib/portfolio-analytics.ts:150` |
| 23 | Retrieval "filings" intent keywords US-only | **FRAMEWORK** | **MEDIUM** | `lib/ai/retrieval.ts:45` |
| 24 | Terminal growth IN 3.5% (cap 5%) vs Indian convention 5–6% | **INTERPRETATION** (conservative direction) | **MEDIUM** | `lib/valuation/prefill.ts:55`, `lib/ic/valuation-engine.ts:79` |
| 25 | Nifty P/E standalone→consolidated 2021 break; TTM-vs-FY March year-end alignment unexamined in historical comparisons | **INTERPRETATION** | **LOW-MEDIUM** (flagged, not fully traced) | norms reference |
| — | Market detection; NIFTY benchmarks; INR formatting on IC; currency conversion in portfolio/canonical; EDGAR graceful degradation; India screener templates in ₹Cr; bank-specific scoring branches; India signal weights; india-snapshot thresholds; fund scorer honesty labels | — | **NO ISSUE** | verified across audits |

---

# 5. Representative Asset Tests (actual UAA outputs)

All deterministic; run 2026-09-01. Stock pipeline: `buildFundamentalsData` → `computeScore` (i.e., the **US-calibrated track**, exactly what compare/portfolio-buy/fundamentals surfaces use). IC valuation: `scripts/ic-report-harness.ts --tickers RELIANCE.NS,TCS.NS,HDFCBANK.NS` (deterministic stages).

| Asset | UAA output (US-track) | Assessment of the reasoning |
|---|---|---|
| **AAPL** (control) | HOLD 57, conf 84; full data; sector rotation Technology #4/11 | **Correct-framework baseline.** |
| **RELIANCE.NS** | HOLD 58, conf 77; PEG 0.82 → 10/10; ROE **null**, FCF CAGR **null** (half-credited); analyst upside +28.2% → 12/12; sector rotation from **XLE (US energy ETF)** | **Questionable.** The verdict is plausibly right, but ~2 of 12 factors are half-credit padding, the strongest positive is a thin analyst target, and the rotation factor is another market's energy sector. IC valuation: `canValue: false` (no Yahoo FCF) — honest degradation, **correct**. WACC computed anyway: **6.4% — below India's risk-free rate; clearly inappropriate** (beta 0.157). |
| **HDFCBANK.NS** | **BUY 65**, conf 78; driven by analysts 87 (upside +43.1%) and bank-branch valuation (fwd P/E 11.4 scored on the 8→18 US bank band) | **Questionable to inappropriate.** Bank-specific treatment (ROA, cost-income proxy) is right in *kind*; but the call leans on a +43% target that looks corporate-action-unadjusted, and quality factors score an Indian private-bank franchise (ROE 14%, ROA 1.8%) as mediocre on US bands where Indian bank analysis would weight NIM/NPA/CASA — none of which this track sees (screener.in has them; this engine doesn't). IC WACC 7.8% (beta 0.414) — inappropriate. |
| **TCS.NS** | HOLD 58, conf 85; PEG 2.97 → **0/10**; ROE 48% → 9/9; sector rotation = **XLK's entry, identical to AAPL's** | **Framework contamination demonstrated.** Verdict may be defensible; the reasoning includes a US tech-ETF rotation signal and a US-convention PEG zero. IC valuation: canValue true; **WACC 7.1% (beta 0.164 vs true NIFTY beta 0.89)** → fair value systematically inflated. Region rf/ERP/tax correct; terminal 3.5% conservative. screener.in stage fetched 13y financials, promoter 71.8%, consolidated basis — **rich data present in the pipeline that the score never uses**. |
| **HINDUNILVR.NS** | HOLD 48, conf 80; PEG 3.69 → 0/10; fwd P/E 37.5 penalized; ROE **null** | **Inappropriate band for the sector.** Indian FMCG norm is 30–60x P/E; HUL is being judged as a US-style expensive stalwart, with its defining quality metric (ROE/ROCE — screener.in has ROCE) missing from the engine that judges it. |
| **SBIN.NS** | HOLD 57, conf 82; fwd P/E 9.87 → strong; ROA 1.1% → 2/8 | **Partially correct.** Cheapness read is right; but a PSU bank scored without NPA data (the single most important Indian PSU-bank metric — available in screener.in, used only by the *other* track) is structurally incomplete. |
| **POLYCAB.NS** (mid-cap) | **BUY 70**, conf 84; growth 25/25, health 19/20; rotation from **XLI** | **Plausibly correct verdict, partially borrowed reasoning** (US industrial ETF rotation, absolute US growth bands that a high-nominal-growth market clears more easily). |
| **Beta cross-check** | Yahoo betas 0.16/0.16/0.41 vs recomputed NIFTY betas 0.89/1.08/1.02 (n=261 weekly) | **Proof of finding #1.** |
| **SPY** (fund control) | BUY 60, conf 100; full category-relative scoring, TER 0.09% | **Correct** — the fund framework works when its inputs exist. |
| **Parag Parikh Flexi Cap (Reg-Gr)** | BUY 62, conf 88; **category null, TER null** (AMFI match fails — pagination bug verified), performance absolute-labeled | **Questionable.** Honest labels, but a BUY at conf 88 with unknown cost, unknown category, and no category-relative return is over-confident for the Indian MF norm. Plan type (Regular) never surfaced. |
| **SBI Small Cap** | BUY 69, conf 88; +2.9% (1y abs) scored mid-band; no drawdown/downside metrics | **Category-blind.** A small-cap fund scored with no small-cap criteria. |
| **NIFTYBEES.NS** | HOLD 52, **conf 0**; every field null | **Honest but empty.** India's flagship ETF cannot currently be analyzed. |
| **EDGAR/IC pipeline for .NS** | statements-edgar fails cleanly ("No SEC filer — US-listed only"), Yahoo statements + dedicated screener-in stage succeed, INR formatting correct | **Correct degradation** — no wrong-market data substituted. |

---

# 6. Priority Fix List

Ranked by (analytical-correctness impact × importance to an Indian investor) vs implementation complexity. **Recommendations only — nothing implemented.**

| P | Fix | Impact | Complexity | Confidence |
|---|---|---|---|---|
| **P0-1** | **Compute/normalize beta vs the home benchmark** for non-US listings (compute from held history vs `^NSEI` — the app already fetches both series — or clamp+label Yahoo beta as unusable for IN); add an India cost-of-debt spread; revisit ERP to Damodaran-current | Fixes every Indian DCF/IC fair value | Low-Med (`lib/valuation/wacc.ts`, `prefill.ts`; parity with `engine/models/monte_carlo.py` per fincalc skill) | **High** — independently verified |
| **P0-2** | **Stop feeding US SPDR rotation into Indian scores**: gate `sectorRotation` on market, or build the NIFTY-sector rotation variant (the index map already exists in `lib/benchmarks.ts`) | Removes a wrong-market signal worth 10% of every Indian composite | Low (gate) / Med (NIFTY variant) | **High** |
| **P0-3** | **AMFI TER pagination fix** (iterate `pageCount` pages) | Restores fund Cost analysis for all Indian MFs | **Trivial** | **High** — bug reproduced live |
| **P0-4** | **Currency-correct home/display formatting** (kill hard-coded `$` in `app/_home/_viz/format.ts`, `lib/home/facts.ts`; gate `formatMarketCap`) | Trust-level display correctness for INR users | Low | **High** |
| **P1-1** | **Resolve the two-track architecture**: one decision — either (a) route ALL Indian-stock judgments through the india-snapshot engine (extend it to compare/portfolio/screener contexts), or (b) parameterize `scoring.ts`/`composite.ts` thresholds by market. Do not leave both answering the same question differently. Blocks: compare, portfolio buy recs, watchlist, screener scores | The architecture question of this audit | High | High that it must be decided; **direction (a) vs (b) needs a design decision** |
| **P1-2** | **India-calibrate the India screener** (whichever way P1-1 goes): India bands for composite dimensions or percentile-vs-universe scoring (the screener already computes class/peer percentiles for filters — the headline score could use them) | 500-name screener correctness | Med | High |
| **P1-3** | **AMFI category foundation for MFs**: ingest AMFI scheme master (free), map Yahoo 0P symbols → scheme → category + plan type; then category-relative performance and category-specific criteria (small-cap: drawdown/downside; debt: duration/credit/PRC; index: tracking difference; focused/sectoral: concentration-as-design) | Converts Indian MF analysis from generic to correct; Phase 1 identified MF investors as a core segment | Med-High (data plumbing + per-category scorer branches) | High on direction; per-category thresholds need design |
| **P1-4** | **India macro branch** in the AI verdict layer (RBI/G-sec/CPI-India/USDINR) + one-line market-context grounding in IC agent prompts + India filings-intent keywords | Removes the most visibly US-framed AI outputs | Low-Med (prompt work) | High |
| **P1-5** | **Market-aware derivatives risk-free** (`riskFreeRate(region)`); India yield for quant-engine rate scaling | Options analytics + engine correctness | Low | High |
| **P2-1** | **Wire the dead screener.in data into judgments**: promoter pledge, gross/net NPA (PSU banks), consolidated/standalone basis flag, peer medians as the IC relative-valuation band, credit-rating documents as risk events | The India-specific quality factors professionals actually weight (norms reference §1.3) | Med | High on value; per-factor design needed |
| **P2-2** | **Missing-data policy**: reduce or eliminate `mk()` half-credit when coverage < threshold, and/or cap recommendation tier at HOLD under low coverage | Prevents padded BUYs on thin Indian (or any) data | Low-Med — ripples through existing scores/tests; needs explicit sign-off per fincalc skill red-flag rule | Med-High |
| **P2-3** | Verify + fix `lib/ios/fit-scorer.ts` USD mcap buckets for INR holdings | Portfolio fit correctness | Low | Med (one trace needed) |
| **P2-4** | Sector-aware Indian valuation context (at minimum: FMCG/pharma/capital-goods P/E norms; PEG band per market or drop PEG for IN); analyst-signal validation for IN (target adjustment check; suppress upside factor when coverage < n) | Reduces sector-level misreads | Med | Med — needs validation pass first |
| **P3** | Thematic engine India proxy table + market-aware benchmark; India ETF data source (tracking difference); direct-vs-regular surfacing; alignment-engine inflation calibration; live rates feed (G-sec/repo); terminal-growth band review | Completeness | Med-High each | Med |

---

# 7. Phase 3 Recommendation

Phase 2's verdict is that UAA's problem is **inconsistent localization, not absent localization** — with one quantitatively severe error (beta/WACC), one architecture decision that can't be deferred (two-track scoring), and one capability gap (category-aware Indian MF analysis). Phase 3 should be an **implementation phase, sequenced as three work packages with a verification gate**, not another audit:

1. **WP-A: Correctness hotfixes (P0 block).** Beta/WACC region correctness, sector-rotation gating, AMFI pagination, currency display. Each is small, independently testable, and none requires the architecture decision. Per `uaa-fincalc` rules: failing test first, independent reference values (the Python venv can compute NIFTY betas/WACC), full suite after.
2. **WP-B: The scoring architecture decision (P1-1/P1-2).** A short design doc deciding india-snapshot-everywhere vs market-parameterized engines, then implementation. Inputs it must respect: the fincalc rule that recommendation bands live only in `lib/recommendation.ts`; the existing two-engines-by-design (batch vs single-name) split; and the india-snapshot precedent that mixing Yahoo and screener.in produced contradictory scores. This decision gates compare, portfolio recommendations, and the India screener.
3. **WP-C: Indian MF foundation (P1-3).** AMFI scheme-master ingestion → category + plan resolution → category-relative and category-specific scoring. This is the largest net-new build and maps directly to Phase 1's best-evidenced underserved segments.

**Also carried into Phase 3 planning:** an "India analytical goldens" test suite — a fixed set of Indian assets (the §5 set) with hand-verified expected behaviors (WACC ranges, band assignments, category resolution) so localization can never silently regress; and a decision log entry (ADR) for the architecture choice.

**Explicitly out of scope until instructed:** implementing any of the above. Stopping here per instruction.

---

## Appendix: Audit trail

- Live stock tests: `buildFundamentalsData` on AAPL, RELIANCE.NS, HDFCBANK.NS, TCS.NS, HINDUNILVR.NS, SBIN.NS, POLYCAB.NS (temp harness, since deleted).
- Live fund tests: `getFundProfile` + `computeFundScore` on SPY, NIFTYBEES.NS, 0P0000XVU2.BO (UTI), 0P0000YWL0.BO (PPFAS Flexi Cap Reg-Gr), 0P0001BB9I.BO (SBI Small Cap) (temp harness, since deleted).
- IC valuation: `/tmp/ic-india/` harness outputs (stage-valuation-case.json, stage-screener-in.json per ticker).
- Beta verification: 5y weekly regressions vs ^NSEI and ^GSPC via `.venv` yfinance/numpy.
- AMFI probe: live `populate-ter-month` + `populate-te-rdata-revised` calls demonstrating the 100-row page cap.
- Code-audit streams: scoring/screening engines; valuation stack (`lib/valuation/`, `lib/ic/`); portfolio/alignment/thematic/AI-prompt layers; each with file:line citations preserved in this document. (A fourth stream covering the data layer failed to return usable output; its scope — market detection, screener-in consumers, MF pipeline, quant engine — was covered by direct inspection and live tests instead.)
- Indian norms reference: web-research stream with primary citations (SEBI circulars, AMFI, RBI, Damodaran, NSE methodology docs, ValueResearch/Morningstar methodologies).
