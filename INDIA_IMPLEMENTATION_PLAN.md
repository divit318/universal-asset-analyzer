# UAA — India Implementation Plan

**Companion to `INDIA_GAP_ANALYSIS.md` · 2026-08-02 · PLAN ONLY — no code has been changed.**

This plan turns every NOTHING/PARTIAL row from the gap analysis into concrete work items:
what data to pull, which files to create/touch, what schema to add, and how to verify.
It follows the repo's existing architecture rules (domain logic in `lib/`, all DB access via
`lib/db.ts`, all cached fetches registered in `lib/platform/registry.ts`, AI only via
`runPrompt()` — per `CLAUDE.md` / `AGENTS.md`).

---

## How to read this

- **4 phases**, each shippable on its own. Phase 0 is prerequisites everything else reuses.
- Every item lists: **Source → New/changed files → Wiring → Verify**.
- Effort: S (<~1 day), M (days), L (week+).
- ⚠️ = risk or decision needed before building.

---

## PHASE 0 — Foundations (build these first, everything reuses them)

### 0.1 Indian number/currency formatting — S
- **Change:** `lib/format.ts` — add `formatCompactIndian()` (lakh/crore: `₹4.5L Cr` style),
  make `formatMarketCap` currency-aware (kill the hardcoded `$` at `lib/format.ts:55-58`),
  add optional `locale` param (`en-IN`) to `formatNumber`/`formatCurrency`/`formatDate`.
- **Wiring:** callers pass the listing market from `detectMarket()` (`lib/market.ts:30-71`).
  Fix exports too: `app/api/export/portfolio/route.ts:48-55, 85`.
- **Verify:** new cases in the `lib/format.ts` test file; RELIANCE.NS shows ₹/Cr in `/research` and in Excel export.

### 0.2 App-side NSE client — M
- **Why:** almost every Phase 1 item needs NSE's JSON API; the cookie/session/backoff logic
  already exists but only in Python (`engine/data/nse_enrichment.py:131-178`).
- **New:** `lib/nse.ts` — session bootstrap (homepage cookie), browser headers, exponential
  backoff + jitter, per-endpoint typed fetchers. Mirror the engine's 3-strikes failure tracking.
- **Wiring:** register each NSE dataset in `lib/platform/registry.ts` with TTLs (most: 15min–24h,
  `persist: true`) so dedupe/SWR/persistence come free.
- ⚠️ **Risk:** NSE anti-bot changes. Mitigation: every endpoint gets a bhavcopy/CSV fallback where
  one exists, and failures stay non-fatal (existing pattern: `lib/screener-in.ts:384-398`).
- **Verify:** a `tests/nse.test.ts` with recorded fixtures; manual smoke against 3 endpoints.

### 0.3 Symbol identity (ISIN + BSE code) — M
- **Why:** CAS/broker import, MF↔stock joins, and NSE/BSE dedupe are all ISIN-keyed.
- **New table** in `lib/db.ts`: `symbol_identity(symbol PK, isin, bse_code, nse_series, name, sme INTEGER)`.
- **Source:** NSE `EQUITY_L.csv` security master (free, daily) + BSE scrip master.
- **Also:** populate the existing always-null `bseCode` (`lib/screener-in.ts:57, 458`).
- **Verify:** `SELECT COUNT(*) FROM symbol_identity WHERE isin IS NOT NULL` ≈ NSE mainboard count; RELIANCE maps to INE002A01018 + 500325.

### 0.4 India universe in the app layer — M
- **Change:** `lib/universe.ts` — add `getIndiaUniverse()` (Nifty 50/100/500 constituent CSVs;
  engine already ships `engine/data/pit_universe/nifty50.csv`) alongside the `region=us` query (`lib/universe.ts:36-42`).
- **Wiring:** new screener universe provider `lib/screener/universes/india.ts` following the ~40-line
  wrapper pattern of `lib/screener/universes/equity.ts`; `lib/dataset.ts` is already a factory (`lib/dataset.ts:16-23`).
- **Verify:** `fundamentals_cache` gains hundreds of `.NS` rows (today: 0 of 2,066); a P/E<20 + ROE>15 screen returns Indian names.

### 0.5 India market calendar — S
- **Change:** `lib/market-hours.ts` — NSE holiday list (static JSON, or NSE `holiday-master` API via 0.2),
  pre-open 09:00–09:08, Muhurat session flag.
- **Verify:** unit test: status on Republic Day = closed; Muhurat date = special session.

> ⚡ **TL;DR:** Five foundation pieces — ₹ formatting, an NSE client, an ISIN identity table, an Indian universe, and a holiday calendar — unblock everything else.

---

## PHASE 1 — Equity-side features Indian retail expects (Image 1 gaps)

### 1.1 IPO calendar + subscription + listing gains — M
- **Source:** NSE `/api/ipo-current-issue` + `/api/all-upcoming-issues?category=ipo` (mainboard),
  BSE for SME IPOs. Subscription-by-category (QIB/NII/retail) is in the NSE issue detail.
- **New:** `lib/ipo.ts` (types + fetchers via `lib/nse.ts`), `app/api/ipo/route.ts`,
  events merged into `lib/calendar.ts`, optional home module registered in `lib/home/registry.ts`
  (home modules are additive by design — never touches `app/page.tsx`).
- **Listing gains:** computed post-listing from Yahoo history (issue price vs listing close) — pure function + test.
- ⚠️ **Allotment status** requires per-user PAN lookups on registrar sites (Link Intime/KFintech) —
  recommend v1 ships a deep link to the registrar, not scraping.
- **Verify:** calendar shows a live IPO with subscription numbers matching nseindia.com.

### 1.2 F&O: NSE option chain, OI, max pain, lot sizes — M
- **Source:** NSE `/api/option-chain-equities?symbol=X` and `/api/option-chain-indices?symbol=NIFTY`;
  lot sizes from NSE's F&O market-lots CSV.
- **Change:** `lib/derivatives-analysis.ts` — add an NSE adapter beside the Yahoo path (`:1-113`);
  new pure functions: `maxPain(chain)`, PCR, OI concentration. Lot size joins from `symbol_identity` extension or a small `fo_lots` table.
- **UI:** derivatives tab shows strike ladder with OI bars + max pain marker for `.NS` names.
- **Verify:** `tests/derivatives-india.test.ts` — max pain on a fixture chain matches hand calculation; RELIANCE.NS derivatives tab renders NSE data.

### 1.3 Block & bulk deals — S
- **Source:** NSE `/api/block-deal` + bulk-deals endpoint (daily); historical via NSE CSV archives.
- **New:** `lib/deals.ts` + dataset registration; render in research Ownership section + `/wire` India focus.
- **Verify:** a day's deals match the NSE website table.

### 1.4 Promoter pledging — surface what's already fetched — S/M
- **Already exists:** engine fetches `/api/corporate-pledgedata` (`engine/data/nse_enrichment.py:430-465`) — never shown in UI.
- **Plan:** re-fetch app-side via `lib/nse.ts` (cleaner than reading engine caches), add "Promoter pledge %"
  + QoQ delta to the India Ownership section (`app/research/page.tsx` India block) and as a watchlist alert type.
- **Verify:** a known pledged name (check `data/nse_cache/`) shows pledge % in `/research`.

### 1.5 FII/DII daily flows — S
- **Source:** NSE `/api/fiidiiTradeReact` (daily provisional cash-market flows).
- **New:** small fetcher in `lib/nse.ts`, store a rolling series (new `fii_dii_flow` table via `lib/db.ts`),
  home/wire module with a 30-day flow chart.
- **Verify:** today's numbers match NSE's published provisional data.

### 1.6 Circuit limits, series codes, SME flag — S
- **Source:** NSE `/api/quote-equity?symbol=X` returns `priceBand` and `series`; SME flag from the security master (0.3).
- **UI:** quote header chips for IN symbols: series (EQ/BE/SM), circuit band %, SME badge.
- **Verify:** a BE-series and an SME name render the right chips.

### 1.7 NIFTY/SENSEX membership & rebalancing — M
- **Source:** niftyindices.com constituent CSVs (Nifty 50/100/500, sectoral); BSE for SENSEX.
- **New:** `index_membership(index, symbol, added_at, removed_at)` table; quarterly diff = rebalance events into `lib/calendar.ts`.
- **Verify:** RELIANCE shows "NIFTY 50 · NIFTY 100" badges; a historical rebalance date appears in the calendar.

### 1.8 Dividend record/ex-dates from Indian source — S
- **Source:** the NSE corporate-actions endpoint the engine already calls for buybacks (`engine/data/nse_enrichment.py:383`) also returns dividends — just stop filtering them out.
- **Change:** extend the app-side corporate-actions fetcher; feed `lib/calendar.ts` for IN symbols instead of Yahoo-only (`lib/calendar.ts:366-404`).
- **Verify:** ITC's next ex-date matches NSE.

### 1.9 India sector rotation — S/M
- **Change:** `lib/sector-rotation.ts:37-54` — parameterise the instrument set per market;
  India set = NIFTY sectoral indices via Yahoo (confirm tickers: ^NSEBANK etc. — UNVERIFIED) or NSE index quotes.
- **Verify:** home rotation strip switches to NIFTY sectors under India focus; `lib/market-summary.ts` narrative follows.

> ⚡ **TL;DR:** One NSE client (0.2) unlocks nine features — IPOs, option chain/max pain, block deals, pledging, FII/DII, circuit/series chips, index membership, Indian dividend dates and NIFTY sector rotation — each individually S/M effort.

---

## PHASE 2 — Mutual funds & SIP (Image 2 gaps) — the new product pillar

### 2.1 AMFI ingestion — M
- **Source:** `https://www.amfiindia.com/spages/NAVAll.txt` (daily, free, no auth; ~10k schemes).
  Historical NAV: AMFI NAVHistory download or mfapi.in mirror (⚠️ decide: mfapi.in is a third-party convenience — prefer AMFI directly).
- **New tables** (`lib/db.ts`): `mf_scheme(amfi_code PK, isin_growth, isin_div, name, amc, sebi_category, plan_type, scheme_type)`
  and `mf_nav(amfi_code, date, nav)` (composite PK).
- **New:** `lib/amfi.ts` parser + `scripts/ingest-amfi.ts` daily job; register in `lib/platform/registry.ts`.
- **SEBI category + direct/regular:** both parseable from the NAVAll scheme-name/section structure.
- **Verify:** `SELECT COUNT(*) FROM mf_nav WHERE date = <today>` ≈ 10k (today: **0**); a known scheme's NAV matches AMFI.

### 2.2 Fund search + scheme page — M
- **Change:** blend `mf_scheme` into `app/api/search/route.ts` results; scheme page = new module or an
  India branch of the existing fund research tab (`lib/ai-fund-research.ts`).
- **Metrics from NAV history:** CAGR, rolling returns (1/3/5y windows), volatility, drawdown, downside/upside capture vs benchmark.
- **Benchmark series:** NIFTY TRI index CSVs (niftyindices.com) → also fixes tracking error, declared-unavailable at `lib/assets/etf.ts:416-423`.
- **Verify:** searching "parag parikh" finds the scheme; rolling-return math pinned by tests against hand-computed fixtures.

### 2.3 SIP calculator + step-up/SWP/STP — S/M
- **Reuse:** XIRR already implemented (`lib/portfolio-performance.ts:94-140`).
- **New:** `lib/sip.ts` — pure cash-flow generators (SIP, step-up %, SWP, STP) → XIRR; UI calculator
  (works against `mf_nav` history for real backtests, or an assumed-return mode).
- **Verify:** `tests/sip.test.ts` — a 12-month ₹10k SIP against a fixture NAV series matches a spreadsheet XIRR.

### 2.4 Direct-vs-regular comparison — S
- **Plan:** pair schemes by normalized name (same scheme, plan differs); show NAV-growth delta = effective cost of regular.
- **Verify:** a known pair shows plausible ~0.5–1.5% annualized gap.

### 2.5 ELSS lock-in — S
- **Plan:** `sebi_category = ELSS` ⇒ per-lot 3-year lock; badge + unlock dates in portfolio (`portfolio_lot` already has `trade_date`, `lib/db.ts:66-78`).
- **Verify:** an ELSS lot bought <3y ago renders "locked until <date>".

### 2.6 Fund overlap for Indian MFs — L (stretch)
- **Needs:** AMC monthly portfolio disclosures (Excel per AMC) — parseable but heterogeneous.
  The overlap engine already exists (`lib/compare/holdings-overlap.ts:53-116`); only holdings ingestion is missing.
- ⚠️ Defer until 2.1–2.3 prove demand.

> ⚡ **TL;DR:** One free AMFI feed + two tables turns UAA into a mutual-fund product; the SIP calculator is nearly free because XIRR already exists.

---

## PHASE 3 — Tax-aware analysis (Image 3 gaps)

### 3.1 Capital-gains engine — M
- **New:** `lib/tax/india.ts` — pure functions: classify holding period per asset class
  (equity 12m, debt slab, gold 24m…), apply STCG/LTCG rates, ₹1.25L LTCG exemption,
  31-Jan-2018 grandfathering (FMV = high on that date, fetchable from Yahoo history),
  Indian FY (Apr–Mar) boundaries.
- **Input:** existing `portfolio_lot` rows (`lib/db.ts:66-78`). No schema change needed for v1.
- ⚠️ Rates change every budget — keep them in one versioned constants file with an `effective_from` date.
- **Verify:** `tests/tax-india.test.ts` with worked examples (incl. a grandfathered pre-2018 lot).

### 3.2 Auto transaction costs — S
- **Plan:** port `engine/models/transaction_costs.py:5-53` (STT/stamp/SEBI/exchange/GST) to
  `lib/tax/transaction-costs.ts`; auto-fill the `fees` field on IN lot entry (`lib/portfolio-lots.ts:74, 79`), user-overridable.
- **Verify:** a ₹1,00,000 buy shows the same fee as the Python model.

### 3.3 Tax-loss harvesting (31 March) — S/M
- **Plan:** scan open lots for unrealised losses vs realised-gain YTD (from 3.1); surface as a
  Portfolio card + notification from ~1 Feb. Note: India has no wash-sale rule, which keeps v1 simple — state this in the UI copy.
- **Verify:** fixture portfolio with a gain + a loss produces the expected "harvest ₹X to save ₹Y" line.

### 3.4 80C/80D + regime comparator — M
- **Plan:** pure calculators in `lib/tax/regime.ts`; needs a minimal `user_profile` table
  (age band, regime, 80C/80D inputs) — first user-profile data in the app.
- ⚠️ **Decision:** this captures personal data; confirm scope before building (compliance surface, gap analysis §8).
- **Verify:** worked examples vs a published FY26 tax table.

### 3.5 Statement import — L
- **Order of attack:** (1) Zerodha Console tradebook/P&L CSV, (2) Groww CSV, (3) CAMS/KFintech CAS PDF (password-protected PDFs — needs a PDF parser dependency; ⚠️ pick one >7 days old per security rules), (4) CDSL/NSDL e-CAS.
- **New:** `lib/import/` parsers → normalized lots keyed by ISIN (requires 0.3) → `portfolio_lot`.
- **Verify:** golden-file tests per broker format; imported portfolio totals match the broker's own summary.

> ⚡ **TL;DR:** Tax = one pure-function engine over lots you already store, plus porting a cost model that already exists in Python; only statement import is genuinely hard.

---

## PHASE 4 — Other instruments + polish

| Item | Plan | Effort |
|---|---|---|
| PPF/NPS/EPF/SSY/FD/RD | Promote from `manual_asset` to typed instruments with rate logic; quarterly small-savings rates as a versioned static JSON (RBI publishes them) | M |
| SGBs | Issue master (RBI), 2.5% coupon accrual, maturity; live price via NSE (SGBs trade as e.g. SGBAUG32) | M |
| Indian REITs/InvITs | Add EMBASSY/MINDSPACE/NXST etc. + InvITs (IRB, POWERGRID InvIT) to the REIT universe (`lib/screener/universes/reit.ts`); distribution yield in place of P/FFO where unavailable | S/M |
| Goal-based planning | Goals table + inflation-adjusted projection using India CPI (RBI DBIE series) — depends on Phase 2 SIP math | L |
| Benchmarks/risk-free | SPY→^NSEI and 4.25%→6.5% per market (`lib/portfolio-analytics.ts:57, 267-271, 399`) | S |
| WACC India tax rate | 0.21 → ~0.2517 (`lib/valuation/wacc.ts:26`) | S |
| Fiscal quarter labels | Apr–Mar aware `quarterLabel` (`lib/fundamentals.ts:259-263`) | S |
| Disclaimers on live surfaces | Reuse the export disclaimer string on screener/verdict/thematic/portfolio surfaces | S |
| "Why is this blank" copy | EDGAR/analyst/insider panels explain "not available for NSE listings" instead of rendering empty | S |

> ⚡ **TL;DR:** Phase 4 is mostly small corrections (benchmarks, tax rate, labels, disclaimers) plus typed Indian savings instruments if the product wants to be a full net-worth tracker.

---

## Sequencing & dependency graph

```
Phase 0.1 formatting ──────────────► ship immediately (no deps)
Phase 0.2 NSE client ──┬─► 1.1 IPO   ─┬─► calendar/home modules
                       ├─► 1.2 F&O    │
                       ├─► 1.3 deals  │
                       ├─► 1.4 pledge │
                       ├─► 1.5 FII/DII│
                       ├─► 1.6 chips  │
                       └─► 1.8 dividends
Phase 0.3 identity ────┬─► 3.5 imports
                       └─► 2.1 AMFI (ISIN join)
Phase 0.4 universe ────┬─► screener India, 1.7 membership, thematic mapping
Phase 2.1 AMFI ────────┬─► 2.2 scheme pages ─► 2.3 SIP ─► 2.4/2.5 ─► 4 goals
Phase 3.1 tax engine ──┬─► 3.3 harvesting ─► 3.4 regime
```

**Suggested order of shipping:** 0.1 → 0.4 + 1.9 (screener + sectors: biggest visible win) →
0.2 + 1.4/1.5/1.6/1.8 (cheap NSE wins) → 2.1–2.3 (mutual funds MVP) → 3.1–3.3 (tax) → the rest.

---

## Decisions needed before building (blockers)

1. **screener.in / NSE scraping ToS** — acceptable long-term, or move to licensed data first? (Gap analysis Open Q1–2)
2. **Mutual funds in scope?** Phase 2 is a second product pillar, not a feature. (Open Q4)
3. **User tax profile** — 3.4 stores personal data for the first time; confirm. (Open Q on compliance)
4. **PDF parser dependency** for CAS import — approve adding one (≥7-day-old version per security rules).
5. **mfapi.in vs direct AMFI** for historical NAV.
6. **Allotment status**: registrar deep-links (recommended) vs PAN-based scraping (not recommended).

---

## Verification protocol (applies to every phase)

Per `AGENTS.md:289-307`: `npx tsc --noEmit` · `npx vitest run` · `npx eslint app lib` · `npm run build`,
plus a real page load (tsc green ≠ page renders). Every new `lib/` module gets a test file with
hand-computed fixtures (max pain, XIRR SIP, STCG/LTCG worked examples). Every new fetcher is
registered in `lib/platform/registry.ts` — never a bare `fetch` in a component.

> ⚡ **TL;DR:** Build 5 foundations, then 4 phases in order of visible impact; almost everything uses free official feeds (NSE, AMFI, RBI, niftyindices), and 6 human decisions gate the riskier parts.
