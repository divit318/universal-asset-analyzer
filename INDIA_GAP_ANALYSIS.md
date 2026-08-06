# UAA — India-First Gap Analysis

**Read-only audit · 2026-08-02**

All counts in Section 5 are live queries against `data/app.db`, `data/engine.duckdb`, `data/scorecard_snapshot.parquet`, and `data/nse_cache/` run on audit day. Every claim carries a file citation; items that could not be confirmed are marked **UNVERIFIED**.

**Audit persona:** an Indian retail investor whose mental model is SIPs, mutual funds, ELSS/80C, IPO allotments, FD ladders, and F&O expiry — not 10-Ks and earnings calls.

---

## Table of Contents

1. [Feature Inventory](#1-feature-inventory)
2. [Indian Retail Product Coverage](#2-indian-retail-product-coverage)
3. [Data Source Map](#3-data-source-map)
4. [Schema and Hardcoded Assumptions](#4-schema-and-hardcoded-assumptions)
5. [Coverage Measurement](#5-coverage-measurement-live-queries)
6. [Model and Router Behaviour](#6-model-and-router-behaviour)
7. [Language and Localisation](#7-language-and-localisation)
8. [Compliance Surface](#8-compliance-surface)
9. [Open Sweep](#9-open-sweep)
10. [Ranked Fix List](#10-ranked-fix-list)
11. [The Top Five](#11-the-top-five)
12. [Open Questions](#open-questions)

---

## 1. FEATURE INVENTORY

| # | Feature | Route | India rating | Determining code |
|---|---------|-------|--------------|------------------|
| 1 | Home dashboard | `/` | PARTIAL | Module registry is market-agnostic (`app/page.tsx:1-49`), but the sector-rotation module is US-only: `SECTOR_ETFS` is 11 US SPDR ETFs (XLK…XLC), `lib/sector-rotation.ts:37-49` |
| 2 | Research | `/research` (absorbs `/research/india`, which redirects: `app/research/india/page.tsx:4-13`) | **FULL INDIA SUPPORT** | Dedicated India path: `const isIndia = market === "IN"` at `app/research/page.tsx:349`; India dataset fetch `app/research/page.tsx:523-532`; India components `app/research/page.tsx:83-88`; data from `lib/screener-in.ts:1-517` + scoring `lib/india-snapshot.ts:1-308` |
| 3 | Screener | `/screener` | **US-ONLY / BROKEN FOR INDIA** | Equity universe hardcoded `q.eq("region", "us")` + NMS/NYQ/ASE exchanges, `lib/universe.ts:36-42`; equity provider just wraps it, `lib/screener/universes/equity.ts:1-40`. Measured: **0 of 2,066** cached screener symbols are `.NS`/`.BO`. An Indian stock can never appear in screener results |
| 4 | Scanner / signals | inside `/wire` | PARTIAL | AI prompt is India-aware (NSE symbols, `isIndian` flag): `lib/event-screener.ts:30-71`, `.NS` enrichment `:128-142`. Signal comes from headlines + LLM, not NSE data feeds |
| 5 | Compare | `/compare` | PARTIAL | Equity comparison loads via Yahoo only (`lib/ai-compare.ts:91-100`); no screener.in merge, so Indian names compare on Yahoo's thinner NSE fundamentals (`lib/india-snapshot.ts:5-7`). Non-equity classes use US universes (`lib/screener/universes/reit.ts:1-165`; `lib/assets/reit.ts:1-444`) |
| 6 | Portfolio | `/portfolio` | PARTIAL | Market-agnostic math (`lib/portfolio-analytics.ts`), accepts `.NS` (`lib/db.ts:59-65`). But benchmark is SPY (`lib/portfolio-analytics.ts:57, 267-271`), risk-free 4.25% US T-bill (`:399`), no INR-native P&L, no CAS import, no Indian tax lots |
| 7 | Watchlist | `/watchlist` | PARTIAL | `.NS` accepted; INR symbol in alerts (`lib/alerts.ts:48-49`); no IST-aware scheduling, no India alert types (pledge change, results date) |
| 8 | DCF / Valuation | `/valuation` | PARTIAL (better than most) | Currency deliberately absent from DCF core (`lib/valuation/dcf.ts:11`); WACC has an IN region: `IN: { riskFree: 0.065, erp: 0.060, … taxRate: 0.21 }`, `lib/valuation/wacc.ts:24-27`. But `taxRate: 0.21` is the **US** rate — India's is ~25.17% (§4) |
| 9 | Calendar | `/calendar` | PARTIAL | Hardcoded India macro events (CPI/GDP/PMI, RBI MPC): `lib/calendar.ts:128-145`; corporate events via Yahoo only `:272-281, 366-404`; no NSE/BSE holiday calendar, no board-meeting/AGM/record dates |
| 10 | IC Report | `/ic-report` | FULL (data) / PARTIAL (knowledge) | `AgentContext.screenerIn` `lib/ic-agents.ts:41`; screener.in block injected `:127-146`; live USD/INR `lib/ic-valuation.ts:356-372`. Industry/competition agents answer from model memory (§6) |
| 11 | Engine (quant) | `/engine` | **FULL INDIA SUPPORT** | India universes `nifty50/india_largecap/india_midcap/india_smallcap/india_best/full_india`: `engine/universe.py:5-18`, Nifty-50 fallback `:57-88`; NSE enrichment `engine/data/nse_enrichment.py:1-634`; NSE expiry-week Kelly reduction `engine/daily_run.py:71-93, 1046-1047`; ^NSEI handling `:743` |
| 12 | Thematic | `/thematic` | PARTIAL | India policy explicitly prompted ("PLI schemes, national missions": `lib/thematic-engine.ts:959-989`) but from model memory; company mapping runs over the screener DB, which is US-only (#3), so Indian companies can't be mapped into themes |
| 13 | Knowledge Graph | `/knowledge-graph` | UNVERIFIED | No India logic visible in `app/knowledge-graph/page.tsx:1-59` |
| 14 | Journal | `/journal` | PARTIAL (market-agnostic) | `decision` table stores `currency` (`lib/db.ts:142-159`) |
| 15 | Wire | `/wire` | PARTIAL | Focus chip "india": `app/wire/page.tsx:31-58`; India news: Economic Times RSS `lib/news.ts:228-248`, Google News `hl=en-IN&gl=IN` `:214-225`, Moneycontrol `:346-356`, NSE announcements `:262-298`. Sector rotation inside Wire remains US-only |
| 16 | Fund research | research tab | PARTIAL → US-ONLY in practice | `lib/ai-fund-research.ts:1-104` via Yahoo `fundProfile`; Indian MF schemes aren't on Yahoo — no AMFI source exists (§2, §3) |
| 17 | Derivatives | research tab | PARTIAL → BROKEN FOR INDIA | `lib/derivatives-analysis.ts:1-113` reads Yahoo option chains; no NSE F&O, no max pain, no lot sizes |
| 18 | Crypto / Forex / Commodity | research tabs | N/A (global) | `lib/ai-crypto-research.ts`, `lib/ai-forex-research.ts`, `lib/ai-commodity-research.ts`; USDINR=X works via Yahoo |
| 19 | Alerts/Monitor | background | PARTIAL | `lib/alerts.ts:48-49` INR symbol only; no IST scheduling (UNVERIFIED whether scheduler exists — `PLAN-background-alerts-scheduler.md`) |
| 20 | Market summary | wire | PARTIAL | `lib/market-summary.ts:1-75` consumes US-only sector rotation |
| 21 | Market hours | header/status | FULL (hours) / PARTIAL (calendar) | `IN: Asia/Kolkata, 09:15–15:30` `lib/market-hours.ts:13`; explicitly no holiday calendar `:4-10` |
| 22 | Exports (Excel/PDF) | various | **BROKEN FOR INDIA (display)** | Hardcoded `$` compaction `app/api/export/portfolio/route.ts:48-55`; `en-US` dates `:85`, `app/api/export/ic-report/route.ts:133` |
| 23 | Search | global typeahead | PARTIAL | `app/api/search/route.ts` → Yahoo autocomplete (`lib/yahoo.ts:462-500`); no local Indian universe, no alias handling (§9) |

### Equity-side items Indian retail expects

| Item | Status | Evidence |
|---|---|---|
| IPO calendar, subscription by category, allotment, listing gains | **NOTHING** | Zero IPO code anywhere |
| F&O option chain / OI / max pain / expiry behaviour | PARTIAL | Yahoo chains only, `lib/derivatives-analysis.ts:1-113`; only expiry logic is engine Kelly reduction, `engine/daily_run.py:71-93, 1046-1047` |
| Block & bulk deals | **NOTHING** | No matches |
| Promoter pledging | PARTIAL | Engine fetches NSE pledge data `engine/data/nse_enrichment.py:430-465`, but only the quant engine consumes it — not surfaced in `/research` UI (UNVERIFIED whether any UI reads it) |
| Shareholding pattern QoQ | **FULL** | `lib/screener-in.ts:34-78, 310-345, 503-517`; UI `app/research/india/_components/ownership-timeline.tsx` |
| FII/DII daily flows | NOTHING (holdings % only) | Holdings % via screener.in `lib/screener-in.ts:503-517`; no daily-flow endpoint |
| Circuit limits, series (EQ/BE/SM), lot sizes | **NOTHING** | No matches |
| SME platform listings | **NOTHING** | No matches |
| NIFTY/SENSEX membership & rebalancing | PARTIAL | Nifty-50 list `engine/universe.py:57-88` + `engine/data/pit_universe/nifty50.csv`; no SENSEX, no rebalance tracking |
| Dividend record/ex-dates | PARTIAL | Yahoo-only, `lib/calendar.ts:366-404` |
| Muhurat trading | **NOTHING** | `lib/market-hours.ts:4-10` disclaims special sessions |

> ⚡ **TL;DR:** Research, IC Report and the quant Engine genuinely support India; the Screener, sector rotation, exports and F&O are US-only or broken for India, and IPO/block-deals/circuit-limits/SME features simply don't exist.

---

## 2. INDIAN RETAIL PRODUCT COVERAGE

### Mutual funds and SIPs

| Item | Verdict | Evidence | Full support requires |
|---|---|---|---|
| AMFI NAV ingestion, daily | **NOTHING** | Zero AMFI references anywhere. Sources are Yahoo (`lib/yahoo.ts`) + screener.in equities (`lib/screener-in.ts:1-517`) | Ingest AMFI `NAVAll.txt` daily (free, no auth); scheme master keyed by AMFI code + ISIN; new SQLite tables + a cron in `lib/platform/registry.ts` |
| Scheme comparison (expense ratio, AUM, exit load, direct vs regular) | PARTIAL | Expense ratio/AUM for Yahoo funds: `lib/fund-scoring.ts:22-29`, `lib/assets/etf.ts:96-116`. Exit load: nothing. Direct vs regular: nothing | AMFI-style scheme metadata; direct/regular pairing; per-scheme exit-load rules |
| SIP calculator + XIRR | PARTIAL | **Full XIRR exists** (Newton + bisection): `lib/portfolio-performance.ts:94-140`, used at `:185, 285, 301`. No SIP UI or cash-flow generator | Mostly UI + reuse of existing XIRR — small effort, high perceived value |
| Step-up SIP, SWP, STP | **NOTHING** | No matches | Cash-flow generators on the same XIRR engine |
| Rolling returns, downside capture, scheme-vs-benchmark | PARTIAL | Category-relative 1y/3y `lib/fund-scoring.ts:46-64`; portfolio-vs-benchmark XIRR `lib/portfolio-performance.ts:206-241`. No rolling windows, no capture ratios | Full NAV history (AMFI, free) + windowed return math |
| Portfolio overlap between funds | **FULL** (for Yahoo-covered funds) | `lib/compare/holdings-overlap.ts:53-116`; UI `app/compare/_components/class-holdings-overlap.tsx:1-48` | For Indian MFs: AMC monthly portfolio disclosures (parseable, effortful) |
| Fund manager history/tenure | **NOTHING** | No matches | Vendor or AMC scraping; no free structured feed (UNVERIFIED) |
| SEBI scheme categorisation | **NOTHING** | "SEBI" appears only in engine cost constants (`engine/models/transaction_costs.py:5-11`) | Category mapping ships in AMFI scheme master |
| ELSS 3-year lock-in | **NOTHING** | No matches | Lot-level lock-in on top of `portfolio_lot` (`lib/db.ts:66-78`) |
| Index funds/ETFs incl. tracking error | PARTIAL | Tracking error declared-unavailable by design: `lib/assets/etf.ts:416-423`; UI says so: `app/compare/_components/class-benchmark-section.tsx:36` | Benchmark identity per fund + benchmark daily series (NIFTY indices free from NSE) |

### Tax-aware analysis

| Item | Verdict | Evidence | Full support requires |
|---|---|---|---|
| STCG/LTCG (equity, debt, gold, property) | **NOTHING** | Zero capital-gains logic | Holding-period engine over `portfolio_lot` (`lib/db.ts:66-78`) + rate tables per asset class |
| LTCG exemption + grandfathering | **NOTHING** | No "grandfather" matches | ₹1.25L threshold; 31-Jan-2018 FMV grandfathering (historical prices already available via Yahoo) |
| STT, stamp duty, brokerage in returns | PARTIAL — **built but unwired** | Complete NSE cost model exists: STT 0.1% sell, stamp 0.015% buy, SEBI fee, exchange fee, GST 18% — `engine/models/transaction_costs.py:5-11, 28-53`. App-side, fees are user-entered only: `lib/portfolio-lots.ts:74, 79`; `lib/portfolio-performance.ts:148-153` | Port the Python model into `lib/` and auto-fill fees per trade (classic shipped-but-unwired, cf. `AGENTS.md:311-327`) |
| 80C/80D, old vs new regime | **NOTHING** | No matches | Calculator logic + a user tax profile (none exists — `lib/profile.ts` is *company* profiles) |
| Tax-loss harvesting before 31 March | **NOTHING** | No matches (not even US-style) | Unrealised-loss scan over lots + FY-end (Apr–Mar) deadline awareness |
| Capital gains statement parsing | **NOTHING** | No statement import; only CSV use is engine-internal (`engine/universe.py:34`) | Parsers for CAMS/KFintech CAS PDFs and broker P&L CSVs |

### Other instruments

| Item | Verdict | Evidence |
|---|---|---|
| NPS, PPF, EPF, Sukanya Samriddhi | **NOTHING** | Zero matches. Nearest hook: `manual_asset` table (`lib/db.ts:173-185`) as dumb values, no rate logic |
| FDs/RDs, small-finance-bank rates | **NOTHING** | Zero matches |
| SGBs, gold ETFs, digital gold | PARTIAL | Gold futures GC=F via `lib/assets/commodity.ts:1-368`; Indian gold ETFs only as generic Yahoo funds; SGB issue/maturity/2.5% coupon: nothing |
| Corporate / tax-free / RBI floating-rate bonds | PARTIAL | Bond *funds* only, US-centric: `lib/assets/bond.ts:1-487` ("no free numeric feed for corporate or treasury bond pricing", `:5-9`); universe is US funds `lib/screener/universes/bond.ts:1-267` |
| REITs and InvITs | PARTIAL | US REIT framework `lib/assets/reit.ts:1-444`, US universe `lib/screener/universes/reit.ts:1-165`. Indian REITs (EMBASSY.NS etc.) not in universe; InvITs: nothing |
| Unlisted / pre-IPO shares | PARTIAL | Manual private-market assets with MOIC/CAGR: `lib/manual-asset-analysis.ts:85-96`, `lib/types.ts:1232+`; discovery uses SEC Form D (`lib/edgar.ts:221-294`) — US-only |

### Portfolio and behaviour

| Item | Verdict | Evidence |
|---|---|---|
| CAS / CDSL / NSDL / broker import | **NOTHING** | Zero matches; no portfolio file-import route in `app/api/` |
| Goal-based planning | **NOTHING** | "goal/retirement" appear only in docs |
| Inflation-adjusted returns with Indian CPI | PARTIAL | India CPI exists only as *calendar events* `lib/calendar.ts:133-136`; inflation is a factor exposure, not a real-return calc: `lib/portfolio/engines/risk.ts:100-101, 345-346, 376`. No CPI series ingested (macro = US Treasury curve only, `lib/macro-analysis.ts:15-20`) |
| Asset allocation across equity/debt/gold/real-estate | **FULL (framework)** | Taxonomy `lib/asset-class.ts:16-35`; health `lib/portfolio/engines/health.ts:252-268`; UI `app/portfolio/_components/universal/allocation-panel.tsx`. But Indian debt/gold instruments only enter as manual assets |

> ⚡ **TL;DR:** The product has zero mutual-fund/SIP/tax/small-savings support — the core of Indian retail investing — even though the hard math (XIRR, overlap, NSE cost model) is already built and just needs wiring + AMFI data.

---

## 3. DATA SOURCE MAP

| Source | Provides | Coverage | Auth | Rate limiting | Cadence/cache | Cost |
|---|---|---|---|---|---|---|
| Yahoo Finance (yahoo-finance2) | quotes, history, intraday, quoteSummary, statements, options, news, search, treasury curve (`lib/yahoo.ts:152-838`) | Global incl. .NS/.BO | none (cookie/crumb `lib/yahoo-screener.ts:36-43`) | 250/batch `lib/yahoo.ts:245-247` | TTLs 15s–7d: `lib/platform/registry.ts:39-107` | Free |
| screener.in (HTML scrape) | Indian equity ratios, annual/quarterly P&L, shareholding, peers (`lib/screener-in.ts:128-371, 413-471`) | India only | none; browser-mimic headers `:97-101` | 8–10s timeouts `:130,147,420` | 6h TTL / 1d SWR, persisted: `lib/platform/registry.ts:99` | Free (ToS: UNVERIFIED) |
| NSE India API | announcements (`lib/news.ts:262-298`); quarterly results, corporate actions/buybacks, pledging (`engine/data/nse_enrichment.py:228, 383, 442`) | India | session cookie `engine/data/nse_enrichment.py:149-165` | exp. backoff + jitter `:131-136`; 1s sleeps | 24h disk cache `data/nse_cache/` (`:43-44`) | Free |
| SEC EDGAR | CIK map, filings, Form D, XBRL (`lib/edgar.ts:7-294`, `lib/statements.ts:161-206`) | **US only** | User-Agent (`lib/edgar.ts:4-5`) | none | 6h–7d (`lib/platform/registry.ts:77, 88`) | Free |
| Google News RSS | headlines; India query `hl=en-IN&gl=IN` (`lib/news.ts:212-225`) | Global+IN | none | 8s timeout | none | Free |
| Economic Times RSS | Indian market news (`lib/news.ts:228-248`) | India | none | none | none | Free |
| Moneycontrol RSS | market outlook (`lib/news.ts:346-356`) | India | none | none | none | Free |
| NewsAPI.org (optional) | global news (`lib/news.ts:312-340`) | Global | `NEWSAPI_KEY` | ~100/day free | none | Free tier |
| RentCast | US property AVM (`lib/rentcast.ts:15-104`) | **US only** | API key | 50/mo free | SQLite cache | Free tier |
| yfinance (Python) | OHLCV + fundamentals for engine (`engine/data/loader.py:368-650`) | Global | none | 8 workers `:662` | DuckDB tables | Free |
| Devin CLI (hosted AI) | inference (`lib/ai/devin-cli.ts`) | n/a | CLI auth | 8-proc cap `:231-234` | 10-min catalogue | Paid |
| Ollama (local AI) | inference (`lib/ai/ollama.ts:15, 58, 91, 196`) | n/a | none | hardware | n/a | Free |

### Where India coverage is thinner than US

- Yahoo fundamentals for `.NS` are "frequently incomplete or stale" — the codebase says so: `lib/india-snapshot.ts:5-7`. Measured (§5): engine India ROE populated **18/50 (36%)** vs 90% for non-India; FCF **12/50 (24%)** vs 92%.
- Filings: EDGAR US-only; Indian names get an empty filings panel — no BSE/NSE filings equivalent.
- Macro: only US Treasury curve fetched (`lib/macro-analysis.ts:15-20`); no RBI repo rate, no India CPI series, no G-sec curve.
- Analyst consensus: sparse for NSE; scoring compensates by down-weighting analysts for IN (`lib/scoring.ts:349-352`).
- Options: Yahoo chains vs. no NSE option chain (`lib/derivatives-analysis.ts:1-113`).
- Sector rotation: US ETFs only (`lib/sector-rotation.ts:37-49`).

### Where India "data" is LLM-generated, not fetched

1. Thematic policy — "PLI schemes, national missions" asked of the model: `lib/thematic-engine.ts:959-989`
2. Thematic structural advantage — India assessed from model knowledge: `lib/thematic-engine.ts:1019-1046`
3. Thematic dependency chain — "real-world company examples (not tickers)" from memory: `lib/thematic-engine.ts:755-788`
4. IC industry agent — sector growth/regulation not in context: `lib/ic-agents.ts:165-168`
5. IC competition agent — market share/moats from memory: `lib/ic-agents.ts:169-172`
6. IC valuation FX heuristics — "1% USD/INR ⇒ 2–4% earnings…" hardcoded: `lib/ic-valuation.ts:369-371`
7. Scanner theme classification from headlines: `lib/event-screener.ts:30-71`

### Free public Indian sources that could close §2 gaps (none currently used)

**AMFI** (NAVAll.txt — MF NAVs), **NSE** (bhavcopy, option chain, FII/DII flows, IPO pipeline, block/bulk deals, circuit bands, lot sizes, index constituents), **BSE** (scrip master, SME board), **RBI** (repo, CPI/WPI via DBIE, SGB terms), **SEBI** (categorisation, FPI data), **MCA** (unlisted filings). Grep confirms AMFI/RBI/SEBI/BSE/MCA appear nowhere; NSE is the only one used (`lib/news.ts:262-298`, `engine/data/nse_enrichment.py`).

**Needs a paid licence:** real-time NSE ticks, corporate bond pricing (`lib/assets/bond.ts:5-9`), fund-manager databases (Morningstar/Value Research), on-chain crypto (`lib/assets/crypto.ts:26-27`).

> ⚡ **TL;DR:** India runs on two free-but-fragile scraped sources (screener.in + NSE cookie API) while the biggest free official feeds (AMFI, RBI, BSE, SEBI) are completely untapped — and several "India facts" in the UI actually come from the LLM's memory.

---

## 4. SCHEMA AND HARDCODED ASSUMPTIONS

Items marked ✓ were verified directly during this audit.

### Fiscal year / quarters

1. `lib/fundamentals.ts:259-263` — `quarterLabel` uses calendar month. Indian FY is Apr–Mar; RELIANCE's Apr–Jun quarter labels as "Q2". **Correct:** fiscal-aware labeling keyed off `detectMarket`.
2. `lib/statements.ts:56-75` — annual extraction filters on SEC `10-K`/`FY`; inherently empty for India. **Correct:** route IN symbols to screener.in annual P&L (`lib/screener-in.ts:277-292`).
3. `lib/screener-in.ts:277-308` — screener.in period labels passed through raw; not normalised vs Yahoo quarter labels (UNVERIFIED whether any UI juxtaposes them).
4. ✅ Done right: `lib/calendar.ts:139-140` labels India GDP "Q1 FY27 (April–June 2026)".

### Currency

5. ✓ `lib/format.ts:55-58` — `formatMarketCap` hardcodes `$`. Any Indian market cap through this renders as dollars.
6. ✓ `lib/format.ts:11, 22` — `formatNumber`/`formatCurrency` hardcode `"en-US"`.
7. `app/api/export/portfolio/route.ts:48-55` — export `compact()` hardcodes `$…T/B/M`.
8. `lib/ai-crypto-research.ts:25` — `$` hardcoded (acceptable for crypto).
9. ✓ `lib/valuation/wacc.ts:26` — `IN: { …, taxRate: 0.21 }` — **US 21% federal rate applied to India** (should be ~25.17%). Every India WACC is slightly wrong.
10. ✅ Done right: `formatCompactCurrency` exists because ₩84.1T once rendered as "$84.12T" (`lib/format.ts:89-108`); India prompts use ₹/Cr (`lib/ai-research.ts:104, 118`); Monte Carlo converts USD↔INR + India risk-free/growth (`engine/models/monte_carlo.py:306-346`).

### Number format (lakh/crore)

11. ✓ `lib/format.ts:37-53` — `formatCompact` knows only K/M/B/T. **No lakh/crore formatter exists anywhere.** Only `en-IN` in the repo is a news URL parameter (`lib/news.ts:215`). **Correct:** an IN display mode — "₹4.5L Cr" style.
12. `app/screener/_components/results-table.tsx:83-85` — `price >= 1000` decimals threshold is currency-blind (₹1000 ≠ $1000).
13. `lib/compare/class-ai-compare.ts:100`, `app/calendar/page.tsx:83, 88`, `app/research/_components/interactive-chart.tsx:113-122`, `earnings-card.tsx:129,137`, `candle-chart.tsx:87-95` — all `en-US` hardcoded.

### Timezone & market hours

14. ✓ `lib/market-hours.ts:13` — IST + 09:15–15:30 correctly modeled.
15. ✓ `lib/market-hours.ts:4-10` — no holiday calendar (self-documented); no pre-open session (09:00–09:08), no Muhurat. Status reads "open" on Indian holidays.
16. ✓ `lib/format.ts:126-135` — dates rendered `en-US`/UTC; `app/calendar/_components/event-drawer.tsx:31, 153` same.
17. Cache TTLs (`lib/platform/registry.ts:39-107`) are wall-clock, not market-session-aware: nothing invalidates at 09:15 IST open (user impact UNVERIFIED).
18. ✅ Engine handles NSE F&O expiry week (`engine/daily_run.py:71-93`).

### Accounting standards

19. `lib/statements.ts:10-41` — XBRL tag map is `us-gaap` only; `Concept.units.USD` only (`:52`). No Ind AS mapping.
20. `lib/screener-in.ts:10, 146, 414` — always fetches `/consolidated/`; no standalone option (material for banks/holdcos). **Correct:** selectable.

### Ticker identity

21. ✓ `lib/market.ts:12` — `SYMBOL_RE` admits `.NS`/`.BO`/`&`/`^` (M&M works); `detectMarket` `:30-71` sound.
22. `lib/screener-in.ts:57, 458` — `bseCode` field exists but is **always null**. No ISIN anywhere. `watchlist`/`portfolio` key on bare `symbol TEXT` (`lib/db.ts:30-36, 59-65`) — RELIANCE.NS and RELIANCE.BO are two unrelated assets; CAS import (ISIN-keyed) has nothing to join on. **Correct:** identity table symbol↔BSE code↔ISIN.
23. `app/api/search/route.ts:13-18` — search is Yahoo-only; no local Indian universe (§9).

### Indices & benchmarks

24. ✓ `lib/sector-rotation.ts:37-49` — US SPDR ETFs only. **Correct for India:** NIFTY sectoral indices (IT, BANK, FMCG, PHARMA, AUTO…), free from NSE.
25. `lib/portfolio-analytics.ts:57, 267-271` — benchmark hardcoded to SPY (`spyReturn1y`). **Correct:** per-market benchmark (^NSEI).
26. `lib/portfolio-analytics.ts:399` — risk-free 4.25% US T-bill in Sharpe/Sortino. **Correct:** ~6.5% GOI 10Y for INR portfolios (WACC module already knows: `lib/valuation/wacc.ts:25-26`).
27. `lib/gics-sectors.ts:8-12` — GICS taxonomy; screener.in sectors are a different taxonomy, unmapped (UNVERIFIED).
28. ✅ Done right: engine fetches both ^NSEI and ^GSPC (`engine/daily_run.py:743, 751`).

### Cap-size buckets

29. `lib/ios/fit-scorer.ts:378-380` — large ≥ $10B, mid ≥ $2B USD. SEBI defines by AMFI rank (top 100 / 101–250 / 251+). An Indian SEBI "large cap" (~$4B) classifies as mid here.
30. `lib/assets/equity.ts:515` — screener large-cap filter `max: 10e9` USD, same issue.
31. `lib/composite.ts:59-62, 171-173` — growth/leverage normalisation calibrated to US norms; Indian capital-intensive sectors will systematically score low (judgement call).

### Trading calendar / misc

32. `engine/features/factory.py:60, 96, 132, 151` — 252 trading days/yr; NSE is ~248–250 (this is why all 50 Indian names have 1,239 bars vs ~1,254 US in §5).
33. Settlement (T+1), circuit bands, series codes, lot sizes: absent everywhere.
34. ✓ ✅ `lib/scoring.ts:349-352` — IN-specific signal weights exist (analysts down-weighted) — a correct India adaptation.

> ⚡ **TL;DR:** ~30 hardcoded US assumptions break India — the worst being dollar/en-US formatting with no lakh/crore, calendar-vs-fiscal quarters, SPY/US-T-bill benchmarks, the US tax rate inside India's WACC, and USD cap-size buckets instead of SEBI's rank rules.

---

## 5. COVERAGE MEASUREMENT (live queries)

### App database `data/app.db`

| Measure | Total | India (.NS/.BO) | US/other |
|---|---|---|---|
| `fundamentals_cache` symbols (screener universe) | 2,066 | **0** | 2,066 |
| `platform_cache` rows | 6,906 | 2 distinct symbols | rest |
| `platform_cache` by dataset | quoteSummary 3,256 · fundamentalsTimeSeries 2,025 · history 1,604 · filings 12 · thematicReport 5 · aiVerdict 3 · cikMap 1 | `screenerIn` rows: **0** | — |
| watchlist / portfolio / research_session | 4 / 0 / 1 | 0 / 0 / 0 | — |

### Quant engine `data/engine.duckdb` (read-only)

| Measure | India | US/other |
|---|---|---|
| Symbols with any price data (`price_daily`) | **50** (exactly the Nifty 50; all "FRESH" in `data/data_health.json`) | 463 |
| Price history depth | all 50 = 1,239 bars (~5 Indian trading years @ ~248/yr) | min 1,235 / median 1,254 / max 1,264 |
| Symbols ≥ 1,250 bars ("5y by US day-count") | **0** (artifact of the 252-day assumption, §4 #32) | 462 |
| `fundamentals` rows | 50 | 1,765 |
| — forward_pe populated | 50/50 (100%) | 1,490/1,765 (84%) |
| — ROE populated | **18/50 (36%)** | 1,587/1,765 (90%) |
| — revenue_cagr_3y | 49/50 | 1,633/1,765 |
| — institutional ownership | 50/50 | 1,751/1,765 |
| — earnings_surprise | 48/50 | 1,443/1,765 |
| — free_cashflow | **12/50 (24%)** | 1,615/1,765 (92%) |
| Latest `scorecard_daily` date | 50 rows, **all India** (last run = India universe) | 0 on that date |
| `data/scorecard_snapshot.parquet` | 50 rows, all `.NS` | 0 |
| NSE cache (`data/nse_cache/`) | 310 files; keys: institutional_ownership 306, revenue_cagr_3y 291, eps_cagr_3y 196, earnings_surprise_pct 48 | n/a |
| `data/detail_snapshots/` | 54 `.NS` of 511 files | 457 |
| `data/fundamentals_pit.jsonl` | 214 `.NS` lines | rest |

### Requested measures — hard answers

- **Indian listed companies with any data:** 50 in the engine (Nifty 50 only, vs ~2,000+ NSE mainboard); **0** in the app screener cache (vs 2,066 US). screener.in is fetched per-symbol on demand and, despite `persist: true` (`lib/platform/registry.ts:99`), **0 rows** are currently persisted.
- **Complete financials for 8 quarters:** 0 persisted for India in either store (engine `fundamentals` is a snapshot; `platform_cache` holds no screenerIn rows). On demand, screener.in returns ~8 quarters per request (`lib/screener-in.ts:295-308`) — transient, not coverage.
- **5+ years of history:** all 50 Indian engine symbols have ~5 Indian trading years; 462/463 US names have ≥1,250 bars.
- **Mutual fund schemes with current NAV: 0. With full history: 0.** (No AMFI ingestion.) US equivalent: thousands of funds available on-demand via Yahoo (uncounted; UNVERIFIED) plus a curated ~237-name US REIT universe (`lib/screener/universes/reit.ts`).

> ⚡ **TL;DR:** Measured, not estimated: US has ~2,066 screenable + 1,765 quant-scored companies with 84–92% field completeness; India has 50 companies (Nifty 50 only) with 24–36% completeness on ROE/FCF, **zero** screenable Indian stocks, and **zero** mutual funds.

---

## 6. MODEL AND ROUTER BEHAVIOUR

### Architecture

- **Providers/models:** 6 hosted (Devin CLI: claude-opus-5-medium/low, claude-sonnet-5-low, gpt-5-6-terra-low, swe-1-6-fast, gpt-5-6-luna-low) + 5 local Ollama (qwen3:30b/14b, mistral, qwen coders): `lib/ai/models.ts:112-351`. Chain devin→ollama: `lib/ai/config.ts:69-78`. Router scores memory-fit, capabilities, task complexity/latency: `lib/ai/router.ts:182-235, 349-417`.
- **No routing input is market/region.** No "India" task among the 30 in `lib/ai/task-registry.ts:104-274`; an India query routes identically to a US one. India-awareness lives entirely in prompt builders.
- **Good grounding exists:** `indianDeepAnalysis` / `indianChatWithData` say "Using ONLY the structured data below" with screener.in figures interpolated (`lib/ai-research.ts:114-154, 256-265`); section insights (`:186-236`); IC agents get a screener.in block (`lib/ic-agents.ts:127-146`); IC valuation gets live USD/INR (`lib/ic-valuation.ts:356-372`).
- **India-specific evals: none.** Only the deterministic scorer is tested (`tests/india-snapshot.test.ts`); zero AI-output evals for India in `tests/` or `ai-migration/`.

### Top 10 places a confident wrong India answer reaches a user

| # | Path | Prompt location → UI surface | Risk |
|---|------|------------------------------|------|
| 1 | Thematic policy stage | `lib/thematic-engine.ts:959-989` → `/thematic` Policy | Model recalls PLI schemes/missions from memory; named schemes, capital amounts |
| 2 | Thematic structural advantage | `lib/thematic-engine.ts:1019-1046` → `/thematic` | India's position per theme from memory |
| 3 | IC valuation FX rules-of-thumb | `lib/ic-valuation.ts:369-371` → `/ic-report` Valuation | Hardcoded "2–4% IT, 1–3% pharma, 3–6% oil" sensitivities |
| 4 | Scanner theme/signal classification | `lib/event-screener.ts:30-71` → `/wire` signals | "RBI rate pause"-style themes from headlines + memory |
| 5 | IC industry agent | `lib/ic-agents.ts:165-168` → `/ic-report` | Sector growth/regulation not retrieved |
| 6 | IC governance agent | `lib/ic-agents.ts:193-196` → `/ic-report` | Promoter-behaviour norms from memory |
| 7 | India Buy/Hold/Sell verdict | `lib/ai-research.ts:149-153` → `/research` verdict card | The call itself is model judgement over thin data |
| 8 | India financials insight | `lib/ai-research.ts:186-198` → `/research` Financials | Trend read without segment/cash-flow data |
| 9 | India ownership insight | `lib/ai-research.ts:211-216` → `/research` Ownership | Reads promoter/FII moves without pledge data (engine has it; app never passes it) |
| 10 | India peers insight | `lib/ai-research.ts:218-224` → `/research` Peers | Premium/discount judgement over P/E+ROCE only |

**Also:** research copilot chat is open-ended — "kya main ELSS mein invest karun?" gets answered entirely from model memory; no India tax/regulatory retrieval exists to ground it (`lib/ai-research.ts:256-265` limits *company* data only). UNVERIFIED how the chat route handles off-company questions (`app/api/research/chat/route.ts`).

> ⚡ **TL;DR:** The AI router is completely market-blind, company numbers ARE well-grounded in screener.in data, but anything about Indian policy, regulation, tax or industry structure comes straight from model memory with zero India evals to catch confident mistakes.

---

## 7. LANGUAGE AND LOCALISATION

- **No i18n layer.** No next-intl/react-intl/i18next in `package.json:16-29`; `lang="en"` hardcoded `app/layout.tsx:53`.
- **All UI strings hardcoded in JSX** — sampled: `app/research/page.tsx:282-290`, `app/_components/symbol-search.tsx:109` ("e.g. AAPL, Apple, Nvidia"), `app/screener/page.tsx:87`, `app/_components/site-header.tsx:62-80`. Estimated 200–300+ strings across ~50 components.
- **Formats baked in:** `en-US` in `lib/format.ts:11, 22, 130` and at least 8 components (§4 #13). No `en-IN` formatting path anywhere; the single `en-IN` in the repo is a Google News URL param (`lib/news.ts:215`).
- **Fonts:** Geist loaded with `subsets: ["latin"]` only (`app/layout.tsx:15-23`) — Devanagari/Tamil/Telugu/Bengali/Gujarati would fall back to system fonts.
- **AI output:** all prompts English; no language parameter on `runPrompt` (`lib/ai.ts`).

**Verdict:** Hindi/Marathi/Tamil/Telugu/Bengali/Gujarati support is a **rewrite-scale effort** (string extraction + i18n framework + fonts + prompt plumbing). Number/date localisation alone (en-IN + lakh/crore) is, by contrast, a small change concentrated in `lib/format.ts`.

> ⚡ **TL;DR:** There is zero i18n infrastructure — regional languages would be a rewrite — but Indian number/date formatting (the thing users notice first) is a cheap fix concentrated in one file.

---

## 8. COMPLIANCE SURFACE

*(Map only — no legal opinion.)*

### Outputs readable as investment recommendations

- **Buy/Sell bands:** `TIER_EDGES [25,42,60,78]` → Strong Buy…Strong Sell, `lib/recommendation.ts:27-42`; rendered by `app/_components/ui/score-chip.tsx:124-130`, `app/research/_components/conviction-breakdown.tsx:13-25`, engine export incl. "Top 10 Strong Buys" (`app/api/export/engine/route.ts:33-51, 249-250`).
- **India verdicts:** Strong Buy/Accumulate/Hold/Reduce/Avoid, `lib/india-snapshot.ts:222-228`; AI "Buy/Hold/Sell with valuation context", `lib/ai-research.ts:149-153`.
- **AI investment verdict** (bullish/bearish/neutral + confidence + horizon): `lib/ai/verdict.ts:49-63` → `app/research/_components/decision-hero.tsx:200-237`.
- **Target prices:** DCF fair value (`lib/valuation/case.ts`); analyst targets (`lib/ic-valuation.ts:350-353`).
- **Ranked lists:** screener rankings (`app/screener/page.tsx`), thematic verdicts exceptional…avoid (`lib/thematic-engine.ts:213-234`), fund scores (`lib/ai-fund-research.ts:41`).
- **Portfolio suggestions:** brief/audit (`lib/ai-portfolio-manager.ts`, `app/api/portfolio/audit/route.ts`), new-position suggestions (`app/api/portfolio/new-positions/route.ts:42-90`), watchlist "top picks" (`lib/ai-watchlist.ts:225-237`).

### Disclaimers

- **Present only on exports:** IC-report PDF ("Not financial advice…", `app/api/export/ic-report/route.ts:212, 602`), compare exports (`app/api/export/compare/route.ts:268-270`, `app/api/export/compare-class/route.ts:177-179`).
- **Absent on every live web surface:** screener rankings, research verdict card, thematic verdicts, portfolio suggestions, watchlist alerts, fund scores, DCF output, engine scorecard.

### Geo / KYC / user data

- No geo-gating, no KYC, no jurisdiction logic anywhere (greps: zero).
- Country of residence **not captured**; only `country` field is the *company's* (`lib/profile.ts:59`).
- User data lives entirely in local SQLite (`lib/db.ts:29-294`); footer states "Runs locally. Your data never leaves this machine" (`app/_components/site-footer.tsx:37-39`).
- **Tension:** prompts containing user portfolio/research context go to the hosted Devin CLI when it's first in the chain (`lib/ai/config.ts:69-78`) — vs. the footer's locality claim. Mapped, not opined.

> ⚡ **TL;DR:** The app makes explicit Buy/Sell calls, target prices and ranked lists on every surface, but disclaimers exist only in exported PDFs/Excels, no user residence is captured, and the "data never leaves this machine" claim conflicts with hosted-AI-first routing.

---

## 9. OPEN SWEEP

*Everything else an Indian retail user would hit.*

### Identity & universe

1. **Biggest structural gap:** no Indian symbol universe in the app layer. `lib/universe.ts:42` pins `region=us`; the engine has Nifty-50 (`engine/universe.py:57-88`) but the app can't see it. Cascades: screener empty of India, thematic company-mapping can't map Indian names, opportunity engine ranks only US names, compare has no Indian peer pool.
2. `bseCode` scraped-but-null (`lib/screener-in.ts:57, 458`); no ISIN column anywhere → no future CAS/broker import path (§4 #22).
3. **Docs drift:** `CLAUDE.md` still cites `lib/fundamental-screener.ts`, which no longer exists (verified); screener logic moved to `lib/screener/` + `lib/dataset.ts`. `PROJECT_ROADMAP.md:14-16` still describes `/research/india` as a separate page though it redirects.

### Search & onboarding

4. Search is a thin proxy to Yahoo autocomplete (`app/api/search/route.ts:13-18`); no local index, no NSE ranking boost, no alias handling ("HDFC" vs "HDFCBANK", "M&M" vs "Mahindra", "Zomato" → ETERNAL.NS — the rename is even present in `data/data_health.json`). UNVERIFIED which result Yahoo ranks first for "Reliance".
5. Search placeholder is US-first: "e.g. AAPL, Apple, Nvidia" (`app/_components/symbol-search.tsx:109`).
6. QUICK_SYMBOLS: 1 Indian of 13 (`app/research/page.tsx:265-279`). No market-preference setting to flip defaults.
7. No first-run onboarding at all; an Indian first-run lands on a dashboard whose sector-rotation module is US ETFs.

### Performance & mobile (mid-range Android, slow connection)

8. Research bundle is well-orchestrated (NDJSON streaming, concurrency 8: `app/api/research/bundle/route.ts:59-97`; cold 1455ms per `ARCHITECTURE.md:55-56`) — but the India path adds a 2-fetch HTML scrape with 8–10s timeouts (`lib/screener-in.ts:130, 147, 420`): Indian tickers have a structurally slower worst case.
9. Because `platform_cache` holds **0 screenerIn rows** (§5) despite `persist: true` (`lib/platform/registry.ts:99`), every India research view since the last flush has paid the full scrape. Investigate whether persistence works for this dataset (UNVERIFIED root cause).
10. No service worker/offline mode; minimal PWA manifest (`app/manifest.ts`); no data-saver mode. India charts are at least lazy-loaded (`app/research/page.tsx:168-191`).
11. Responsive grids + mobile nav exist (`app/_components/site-header.tsx:111-212`); DataTable has `hideBelow` + horizontal scroll (`app/_components/ui/data-table.tsx:56, 94-99, 199`); but no touch-target sizing — dense tables will be rough on 360px screens.

### Freshness, caching, errors

12. No stale-data badges tied to TTLs; `DataProvenance` exists (`app/_components/data-provenance.tsx`) but India-surface coverage UNVERIFIED.
13. Cache TTLs are session-blind (§4 #17): nothing refreshes at Indian open.
14. Graceful degradation is genuinely good: EDGAR null for non-US (`lib/edgar.ts:68-71`), India sections render only when `isIndia && hasIndia` (`app/research/page.tsx:640-654, 775-830`), screener.in failures non-fatal (`lib/screener-in.ts:384-398`). **But** "degrade silently" means the user is never told *why* filings/analysts/insider panels are blank — no "not available for NSE listings" messaging (UNVERIFIED for every panel).
15. NSE session-cookie bootstrap (`engine/data/nse_enrichment.py:149-165`, `lib/news.ts:264-271`) is fragile against NSE anti-bot changes; 3-strikes alerting exists in the engine (`:54-55, 584-588`) but not in the app-side news fetcher.

### Feature-level friction for the Indian persona

16. Portfolio: no INR-aware totals when mixing US+India holdings — no FX normalisation layer found in `lib/portfolio-analytics.ts` (UNVERIFIED whether any FX conversion applies when summing; the ADR D/E cap at `lib/fundamentals.ts:175-186` suggests currency handling is patchy).
17. Watchlist alerts lack the types Indian retail sets: results-date reminders, 52-week breakout, pledge increase, dividend record date, circuit-hit.
18. Engine's NSE pledging/buyback data (`engine/data/nse_enrichment.py:371-465`) never reaches the research UI — a **shipped-but-unwired** India feature matching the pattern in `AGENTS.md:311-327`.
19. Wire's "india" focus exists but opportunities + sector modules stay US-flavoured (`lib/sector-rotation.ts`) — the India tab feels half-painted.
20. Exports hand an Indian user a `$`-denominated Excel (`app/api/export/portfolio/route.ts:48-55`) — the artifact most likely shared with a spouse/CA: maximum embarrassment surface.
21. Compare relies on Yahoo growth/margin fields sparse for NSE names (§5), so India-vs-India comparisons render rows of "—" without explanation.
22. No dividend-yield screen for India (screener has no India names) — a dominant Indian retail strategy.
23. Muhurat/holiday: status chip wrong on ~15 Indian holidays/year (`lib/market-hours.ts:4-10`).
24. Research page promises "Global stocks across US, India, Japan…" (`app/research/page.tsx:282-290`) — research delivers; every other module under-delivers vs. that promise.
25. Two scoring systems can disagree for the same Indian stock: `lib/india-snapshot.ts` verdict (screener.in data) vs `lib/scoring.ts` computeScore (Yahoo data). `lib/score-kinds.ts` disambiguates *kinds*, but Indian names are uniquely exposed to *data-source* divergence. UNVERIFIED whether both render on one page.
26. Nifty-50-only quant universe: `/engine` shows exactly 50 Indian names; `india_midcap`/`india_smallcap` are defined (`engine/universe.py:5-18`) but unpopulated (§5) — capacity exists, data hasn't been run.
27. Hosted-first AI means Indian users on flaky connections lose AI features exactly when offline, and local Ollama at 0.9–5 tok/s (`lib/ai/models.ts`) is painful on modest hardware.

> ⚡ **TL;DR:** Beyond the headline gaps: no Indian universe poisons five downstream features, search/onboarding/exports feel American, the engine's pledge data is fetched but never shown, caching quietly fails for screener.in, and blank India panels never explain themselves.

---

## 10. RANKED FIX LIST

*Sorted by impact-to-effort. Impact: H/M/L for the Indian retail persona. Effort: S (<~1 day), M (days), L (weeks+).*

| # | Gap | Feature(s) | Impact | Effort | Paid? | Depends on |
|---|-----|-----------|--------|--------|-------|------------|
| 1 | `$` + en-US + K/M/B everywhere; no ₹/lakh/crore/en-IN (`lib/format.ts:11,22,37-58,130`; exports) | all | H | S | No | — |
| 2 | India universe absent from app screener (`lib/universe.ts:42`; 0/2,066 measured) | Screener, Compare, Thematic, Opportunity | H | M | No | NSE/AMFI constituent lists or Yahoo IN region |
| 3 | India sector rotation (NIFTY sectoral indices) (`lib/sector-rotation.ts:37-49`) | Home, Wire, Research | H | S/M | No | Yahoo carries ^CNXIT etc. — UNVERIFIED tickers |
| 4 | AMFI NAV ingestion + MF scheme master | Funds (net-new pillar) | H | M | No | AMFI free feed |
| 5 | SIP/step-up/SWP calculator reusing existing XIRR (`lib/portfolio-performance.ts:94-140`) | Portfolio/Funds | H | S | No | #4 for scheme-level |
| 6 | Wire engine's NSE pledging/buyback into research UI (`engine/data/nse_enrichment.py:371-465`) | Research India | H | M | No | engine→app plumbing |
| 7 | STCG/LTCG engine over lots + ₹1.25L threshold + grandfathering | Portfolio (tax) | H | M | No | lot data exists (`lib/db.ts:66-78`) |
| 8 | Auto STT/stamp/brokerage — port `engine/models/transaction_costs.py:5-53` to `lib/` | Portfolio P&L | M | S | No | — |
| 9 | Fiscal Apr–Mar quarter labeling for IN (`lib/fundamentals.ts:259-263`) | Research, statements | M | S | No | — |
| 10 | Per-market benchmark + risk-free (SPY/4.25% → ^NSEI/6.5%) (`lib/portfolio-analytics.ts:57, 267-271, 399`) | Portfolio analytics | M | S | No | — |
| 11 | NSE option chain (OI, max pain, lot sizes) | Derivatives | H | M | No (public, fragile) | NSE session client (exists in engine) |
| 12 | IPO calendar + subscription + GMP/listing gains | new module | H | M/L | No | — |
| 13 | FII/DII daily flows (NSE provisional) | Wire/Home | M | S | No | — |
| 14 | India holiday calendar + Muhurat + pre-open (`lib/market-hours.ts:4-10`) | status chip, alerts | M | S | No | static list ok |
| 15 | SEBI cap-size classification (rank-based) (`lib/ios/fit-scorer.ts:378-380`, `lib/assets/equity.ts:515`) | fit scoring, screener | M | S | No | #2 |
| 16 | Indian REITs/InvITs into REIT universe (`lib/screener/universes/reit.ts`) | Compare/Screener | M | S/M | No | — |
| 17 | ELSS lock-in + 31-Mar tax-loss harvesting alerts | Portfolio | M | M | No | #7 |
| 18 | CAS/broker import (Zerodha/Groww CSV first, CAS PDF later) | Portfolio | H | L | No | ISIN identity (#19) |
| 19 | Symbol identity: ISIN + BSE code columns (`lib/screener-in.ts:57,458`, `lib/db.ts:30-36,59-65`) | search, import, dedupe | M | M | No | — |
| 20 | Local Indian search index + aliases | Search | M | M | No | #2 |
| 21 | Consolidated vs standalone toggle (`lib/screener-in.ts:10,146,414`) | Research India | M | S | No | — |
| 22 | India WACC tax rate 0.21→~0.2517 (`lib/valuation/wacc.ts:26`) | DCF | M | S | No | — |
| 23 | RBI macro (repo, CPI series, G-sec curve) (`lib/macro-analysis.ts:15-20` is US-only) | Macro, real returns | M | M | No | RBI DBIE |
| 24 | Rolling returns + capture ratios for funds | Funds | M | M | No | #4 |
| 25 | Direct-vs-regular plan comparison, exit loads | Funds | M | M | No | #4 |
| 26 | 80C/80D + regime comparison calculators | new (tax) | M | M | No | — |
| 27 | Block/bulk deals feed | Research/Wire | L | S | No | NSE public |
| 28 | Circuit limits, series codes, SME flag | quote header | L | S | No | NSE bhavcopy |
| 29 | Dividend record/ex-date from Indian source | Calendar | L | M | No | NSE corporate actions (already fetched for buybacks) |
| 30 | Disclaimers on live recommendation surfaces (currently exports-only) | compliance | M | S | No | — |
| 31 | Ground India AI answers: retrieval for policy/tax/regulatory facts; India evals | Thematic, IC, chat | H | L | No | #23 + curated corpus |
| 32 | Session-aware cache invalidation (refresh at 09:15 IST) | freshness | L | M | No | #14 |
| 33 | i18n foundation (extract strings, en-IN plumb-through) | localisation | M | L | No | — |
| 34 | Hindi + regional languages (fonts, prompts) | localisation | M→H long-term | L | No | #33 |
| 35 | SGB/PPF/NPS/FD instrument types with rate logic | real instruments | M | L | No (RBI/NSDL) | — |
| 36 | "Why is this blank" messaging for India-empty panels | Research UX | M | S | No | — |
| 37 | Fund manager history/tenure | Funds | L | L | **Likely yes** | vendor |
| 38 | Individual bond pricing (corporate/tax-free) | Bonds | L | L | **Yes** (`lib/assets/bond.ts:5-9`) | vendor |
| 39 | Goal-based planning with Indian CPI | Portfolio | M | L | No | #23 |
| 40 | Run + persist `india_midcap`/`india_smallcap` engine universes (`engine/universe.py:5-18`, unpopulated per §5) | Engine | M | S (compute) | No | NSE screen source |

> ⚡ **TL;DR:** 40 gaps ranked; the top quick wins are formatting (₹/lakh/crore), an Indian screener universe, NIFTY sector rotation, an SIP calculator on the existing XIRR engine, and wiring up the already-fetched NSE pledge data — almost everything is solvable with free data.

---

## 11. THE TOP FIVE

*The five changes that most raise perceived India quality in a new user's first 30 seconds.*

### 1. Indian number/currency formatting

- **Files:** `lib/format.ts` (formatMarketCap `$` at 55-58; en-US at 11, 22, 130; add lakh/crore compaction alongside `formatCompact` 37-53), `app/api/export/portfolio/route.ts:48-55`, en-US components in §4 #13
- **Data:** none
- **Verify:** load RELIANCE.NS in `/research` — market cap must read "₹20.5L Cr" (or "₹20,50,000 Cr"), never "$247.2B"; export a portfolio with an `.NS` holding and check the Excel; add cases to `lib/format.ts` tests

### 2. Indian stocks in the Screener

- **Files:** `lib/universe.ts` (new India universe alongside `US` at 36-42), `lib/screener/universes/equity.ts`, `lib/dataset.ts` (factory already supports multiple universes, `:16-23`)
- **Data:** NSE constituent lists (engine already has `data/pit_universe/nifty50.csv`) or Yahoo screener `region=in`
- **Verify:** `sqlite3 data/app.db "SELECT COUNT(*) FROM fundamentals_cache WHERE symbol LIKE '%.NS'"` goes from **0** to hundreds; screening "P/E < 20, ROE > 15" returns HDFC Bank-type names

### 3. NIFTY sector rotation on the home page

- **Files:** `lib/sector-rotation.ts:37-54` (parameterise ETF set per market), `lib/home/` module + `app/_home/module-map.ts`, `lib/market-summary.ts`
- **Data:** NIFTY sectoral indices via Yahoo (^NSEBANK etc. — confirm tickers; UNVERIFIED)
- **Verify:** home page renders an India rotation strip; market-summary narrative mentions Indian sectors when India focus is on

### 4. Fix the India research fast-path: persist screener.in + surface pledging

- **Files:** investigate why `platform_cache` holds 0 `screenerIn` rows despite `persist: true` (`lib/platform/registry.ts:99`, `lib/platform/data-layer.ts`); pipe pledge/buyback (already fetched: `engine/data/nse_enrichment.py:371-465`) into `app/research/page.tsx` India sections
- **Data:** already fetched
- **Verify:** second load of RELIANCE.NS research serves screener.in from cache (log/timing); "Promoter pledge: X%" appears in Ownership for a pledged name (check one from `data/nse_cache/`)

### 5. India-first search & onboarding

- **Files:** `app/_components/symbol-search.tsx:109` (placeholder with Indian examples), `app/research/page.tsx:265-279` (QUICK_SYMBOLS market mix or preference), `app/api/search/route.ts` (blend a local Indian name/alias index ahead of Yahoo)
- **Data:** Nifty-500 symbol/name/alias list (free)
- **Verify:** typing "reliance", "hdfc bank", "tata motors", "zomato" each returns the NSE listing first; first-run shows Indian examples when the user picks India

> ⚡ **TL;DR:** Fix formatting, put Indian stocks in the screener, add NIFTY sector rotation, make India research fast + show pledge data, and make search find Indian names first — five changes, mostly small, that transform the first impression.

---

## OPEN QUESTIONS

*Things the code cannot answer — need a human.*

1. **screener.in terms of service** — the product scrapes HTML with browser-mimic headers (`lib/screener-in.ts:97-101`). Acceptable for your distribution model, or should India fundamentals move to a licensed source before India is promoted as first-class?
2. **NSE/BSE API terms** — same for cookie-bootstrapped NSE endpoints (`engine/data/nse_enrichment.py:149-165`); NSE periodically blocks such clients. Fallback (bhavcopy files, paid vendor) budgeted?
3. **Paid-data budget** — fund managers, bond pricing, real-time NSE need licences. Any budget, or strictly free sources?
4. **Product scope** — the Indian retail persona is MF/SIP-first. Building AMFI + SIP + tax is a second product pillar. Intended, or should India-first mean "best-in-class Indian *equities*" only?
5. **Single-user assumption** — `AGENTS.md:461` says "single-user, self-hosted"; the brief says "international user base". Which is true? Compliance posture (§8) matters enormously more if distributed.
6. **Hosted AI vs "data never leaves this machine"** — footer claim (`app/_components/site-footer.tsx:37-39`) vs Devin-CLI-first routing (`lib/ai/config.ts:69-78`). Deliberate? Disclosure or local-only toggle for Indian users?
7. **Why does `platform_cache` contain zero screenerIn rows** despite `persist: true`? Bug, recent flush, or eviction? Not determinable read-only (§5, §9 #9).
8. **Was the latest engine run intentionally India-only?** Newest `scorecard_daily` date + parquet contain only the 50 Nifty names — `/engine` currently shows no US names for the latest date. Expected?
9. **Which broker formats matter** for import (Zerodha/Groww/Upstox/ICICI CSV vs CAMS/KFintech CAS PDF)? Determines #18's shape.
10. **Language priority** — is Hindi (or any regional language) actually demanded, or is en-IN formatting enough for the next year? Cost differs by an order of magnitude (§7).
11. **Consolidated vs standalone default** for Indian financials — who decides the default (`lib/screener-in.ts:10`)?
12. **Docs drift** — `CLAUDE.md` references `lib/fundamental-screener.ts` (deleted) and a 41-file `lib/` (now ~110 entries). Regenerate rules files before more agent work?
13. **SEBI cap-rank data** — rank-based classification needs the AMFI semi-annual list. OK to bundle as a static file updated twice a year?
14. **Target user hardware** — mobile/slow-connection findings (§9 #8-11) only matter if deployment isn't purely desktop localhost. Is a remote/mobile mode planned?

> ⚡ **TL;DR:** Fourteen decisions block or shape the roadmap — the big ones are scraping-ToS risk, whether mutual funds are in scope, whether the product is really single-user, and why screener.in caching is silently empty.
