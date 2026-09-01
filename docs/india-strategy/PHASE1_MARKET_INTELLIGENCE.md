# UAA India Strategy — Phase 1
## Indian Investor & Competitor Intelligence Audit

**Date:** 2026-09-01
**Status:** Phase 1 complete. Phase 2 NOT started (per instruction).
**Method:** Five parallel web-research streams (Groww deep dive, Zerodha ecosystem, investor segmentation, workflow-fragmentation evidence, head-to-head comparison) using primary sources (groww.in, zerodha.com/support/Z-Connect/kite.trade, SEBI, NSE, AMFI, CDSL) supplemented by community evidence (TradingQnA, ValuePickr, Reddit) and credible journalism. No UAA code was inspected or modified.

**Evidence convention** (used throughout):
- **VERIFIED FACT** — directly supported by a cited primary/secondary source.
- **OBSERVATION** — conclusion drawn from examining products, reviews, or community discussions.
- **HYPOTHESIS** — plausible inference requiring further validation. Never presented as fact.

---

# 1. Indian Investor Segmentation

## 1.1 Market backdrop (VERIFIED FACTS unless noted)

| Metric | Value | Source |
|---|---|---|
| Demat accounts | 3.94 cr (Dec 2019) → 18.53 cr (Dec 2024) → 21.59 cr (Dec 2025) | CDSL periodic stats; BusinessWorld |
| NSE unique investors (PANs) | 2.7 cr (FY19) → 9.2 cr (FY24); 12 cr+ registered by 2025 | Economic Survey via ET; NDTV Profit |
| Actually traded in last 12 months | ~3.72 cr (of 12 cr registered) | NSE via NDTV Profit |
| Contributing SIP accounts | 8.11 cr (Mar 2025); SIP AUM ₹13.35 L cr; monthly SIP flow ~₹26–27k cr | AMFI |
| MF folios | 23.45 cr (Mar 2025), 16.38 cr equity-oriented | AMFI Annual Report 2025 |
| Active clients, top brokers (FY25) | Groww 1.29 cr (26.3%), Zerodha 78.9 L (16.0%), Angel One 75.8 L (15.4%) | NSE via Business Standard |
| F&O trader losses | 91.1% of individual F&O traders lost money in FY24 (~₹75,000 cr); 92.8% over FY22–24 (₹1.81 L cr total) | SEBI studies |
| Post-SEBI-crackdown cooling | NSE active clients ~5.02 cr (Jan 2025 peak) → 4.53 cr (Sep 2025); F&O unique traders 52.6 L (Jun 2024) → ~30 L (Mar 2025) | Moneycontrol, CNBC-TV18, SEBI |
| Advice scarcity | ~927–1,000 SEBI RIAs and ~1,380 RAs for a 12-cr+ investor base; 1.78 L MFDs | SEBI board files; Cafemutual |

**OBSERVATION:** The market is structurally huge but behaviorally shallow — only ~30% of registered investors traded in the last year, and the 2024–25 SEBI F&O measures cut the most active (and most loss-making) cohort by ~20%. The regulated-advice vacuum (<1,000 RIAs) is a defining market failure; finfluencers filled it and SEBI is now purging them.

## 1.2 Segments — who they are, what they do, how served

| Segment | Approx. size | Frequency & behavior | Tools today | Served? |
|---|---|---|---|---|
| **Complete beginners** | HYPOTHESIS: 8–10 cr post-2020 demat holders who trade rarely. 75% of new accounts are under-30 (VERIFIED, HDFC Sec); ~60% from Tier-2/3 | Sporadic; app-marketing/referral-driven; 1–2 stocks + SIPs | Groww, Angel One, YouTube, Telegram tips | **Over-served** on onboarding & finfluencer content; **underserved** on trustworthy first-step guidance |
| **Long-term retail (SIP + some stocks)** | HYPOTHESIS: 5–8 cr (overlaps MF-only) | Monthly SIP, occasional lump sum, low churn | Groww, Coin, Kuvera, ET Money, ValueResearch | **Well-served** on execution; **underserved** on goal-based, fee-only advice |
| **Active stock investors (delivery, research-driven)** | VERIFIED: 37.9 L NSE cash-active individuals (2024); HYPOTHESIS: 1.5–3 cr hold researched individual stocks | Weekly–monthly research, quarterly rebalancing | Broker + Screener.in + Trendlyne/Tickertape + Moneycontrol + Excel | **Well-served** on data availability; **underserved** on integrated research & governance analytics |
| **Traders (intraday/F&O)** | VERIFIED: 78.6 L active F&O individuals FY26 (down 20%) | Daily, expiry-focused; 9 in 10 lose money (SEBI) | Kite/Groww terminals, Sensibull, Streak, TradingView, Telegram | **Over-served** on access/leverage; **underserved** on risk controls |
| **MF-only investors** | HYPOTHESIS: 6–9 cr unique individuals | Monthly SIP; annual ELSS | Groww, ET Money, Kuvera, Coin, banks/MFDs | **Well-served** on execution; **underserved** on cost transparency and consolidated analytics |
| **Sophisticated self-directed** | HYPOTHESIS: 15–30 L core (Screener.in traffic est. 10–40 M visits/mo; Tickertape 3 M MAU, 120k paying — VERIFIED) | Daily/weekly deep research; annual reports, concalls | Screener.in, Tijori, Trendlyne, ValuePickr, BSE/NSE filings, Excel DCFs | **Well-served** on screening; **underserved** on affordable institutional-grade data & synthesis |
| **HNIs & family offices** | VERIFIED: ~300 family offices (45 in 2018); 13,000+ families >$30M; 1.91 L discretionary PMS clients | Quarterly reviews; PMS/AIF/private markets | Private banks, Dezerv/Kristal, MProfit, Bloomberg, CIO notes | **Over-served** on products; **underserved** on transparent fiduciary reporting |
| **Advisors (RIAs/MFDs)** | VERIFIED: ~927 RIAs; 1.78 L MFDs (45% B30 cities) | Monthly servicing, quarterly reviews | BSE Star MF, Wealthy, AssetPlus, ValueResearch | **Underserved as a profession** — SEBI itself says the RIA model must be made "more viable" |
| **Investment professionals** | VERIFIED: 1,380 RAs, ~460 PMS firms; HYPOTHESIS: tens of thousands of analysts | Daily coverage work | Bloomberg, Ace Equity, Capitaline, Prowess, Screener premium | **Well-served if budget is large; underserved at mid-market** — integrated India research stacks are costly |

**OBSERVATION (important for later phases):** These segments are NOT equally plausible UAA customers. Beginners and F&O traders are the largest segments but are served by (and fought over by) Groww/Zerodha at zero-to-negative margin, and their needs (execution, leverage) are not research needs. The segments whose *unmet* needs are research/analysis/decision-shaped are: active stock investors, sophisticated self-directed investors, mid-market professionals/advisors, and (differently) family offices. No conclusion is drawn here about UAA's target — that is Phase 2+ work.

---

# 2. Groww Deep Dive

## 2.1 What Groww is

Groww is India's **largest broker by NSE active clients** (1.29 cr FY25, ~26% share — VERIFIED) and is now a **listed company** (IPO Nov 2025, ₹6,632 cr raise — VERIFIED). Strategy per its own annual report: "acquire maximum customers, retain and grow their wealth, launch products that increase wallet share" — i.e., a **mass-market financial-distribution platform**, not a research house (VERIFIED: Groww Annual Report 2025-26).

## 2.2 Product surface (all VERIFIED from groww.in/help unless noted)

- **Stocks:** delivery (₹20 or 0.1%, min ₹2–5 — NOT free), intraday, stock SIPs, GTT, MTF (0.041%/day, ~4x). **US stocks discontinued** (June 2024).
- **F&O + commodities:** flat ₹20/order; option chain with Greeks, payoff graphs, basket orders; "915" pro web terminal (8-chart layouts, TradingView/ChartIQ, straddle charts, fast exit); F&O Pause self-exclusion.
- **Mutual funds:** direct plans, zero commission, regular→direct switching, MF Prime recommendations; own AMC (ex-Indiabulls; State Street buying 23%).
- **IPOs, bonds/NCDs (SEBI OBPP licence, bond IPOs in-app), SGBs, FDs, gold, NPS (via separate POP entity), personal loans/LAMF/LAS, UPI payments.**
- **GR-1 AI assistant** (VERIFIED: groww.in/updates): natural-language Q&A ("why did this stock fall 5%?"), earnings summaries, MF recommendations with reasoning, alert setting. Explicitly does NOT give buy/sell/position-size advice.

## 2.3 Stock research experience (inspected via stock pages: Reliance, HDFC Bank, TCS)

**What exists (VERIFIED):** live price, 52W range, market cap, P/E, P/B, EPS, industry P/E, ROE/ROCE; ~5 quarters of summarized P&L; peer table (price, P/E, P/B, mcap, 52W); shareholding pattern page; events calendar; personalized news + exchange filings for holdings/watchlist; product-page technicals (RSI, MACD, SMA/EMA, pivots, delivery %, colour-coded bullish/bearish verdicts); screeners (P/E, RSI, volume, 52W proximity, intraday screener).

**Critical assessment (OBSERVATION):** Sufficient for a *quick sanity check*, insufficient for an *investment decision*: no full financial statements history (10y), no cash-flow/balance-sheet depth, no segment data, no concall transcripts or annual reports, no analyst consensus, no valuation model beyond displayed multiples. A user deciding whether to buy must leave for Screener.in / Tijori / annual reports.

## 2.4 Workflows

| Workflow | Groww solves | User must leave for |
|---|---|---|
| Hear about stock → research → invest | Search, snapshot ratios, chart, news, 2-tap order | Financial-statement depth, concalls, valuation judgment, analyst views |
| Discover → screen → investigate | Basic + intraday screeners, "most bought on Groww", trending sectors | Custom-formula screening, backtested screens (Screener.in, Chartink) |
| Own portfolio → monitor → decide | Real-time P&L, Portfolio Analysis (XIRR vs Nifty 50, sector/mcap/asset split, dividends, tax-loss-harvesting prompts), custom Portfolios | Cross-broker view, MF-overlap, stock+MF unified sector view, rebalancing math (Excel/trackers) |
| Complete beginner | Best-in-market: free paperless onboarding, ₹0 AMC, ₹100+ SIPs, simple language, blog/e-books | Structured education (many use Varsity or YouTube), fiduciary guidance |

## 2.5 Strengths (concrete)

1. **Scale + distribution funnel** — #1 active clients; MF-first onboarding graduates users to stocks/F&O/credit (VERIFIED).
2. **Onboarding friction** — genuinely fastest path from zero to first SIP (OBSERVATION, consistent across reviews).
3. **Breadth in one app** — stocks/MF/IPO/F&O/commodities/bonds/FD/gold/loans (VERIFIED).
4. **In-app portfolio analytics ahead of Zerodha's mobile experience** — XIRR vs benchmark, sector drill-down, dividend tracker, tax-loss-harvesting prompts (VERIFIED product updates).
5. **AI-summarized, holdings-scoped news + GR-1** — the closest either incumbent gets to research synthesis (VERIFIED).
6. **Momentum:** profitable (FY25 PAT ₹1,819 cr), listed, W by Groww (HNI wealth), Fisdom acquisition, own AMC (VERIFIED).

## 2.6 Limitations

**Users actually complain about (OBSERVATION/VERIFIED):** May 2025 charting glitch (wrong prices, GTTs mis-triggered — VERIFIED, acknowledged); support quality despite 24×7 phone; order/app lag at volatile opens; withdrawal holds; KYC/account freezes. **SEBI settlements 2025** (~₹83 L total) for incorrect client statements, AML gaps, and offering non-securities services in the trading app (VERIFIED: SEBI order).

**Absent but users may not care (flagged, not assumed to matter):** no API-grade research data, no NRI accounts, no currency derivatives, shallow fundamentals. Evidence users care about the *research* gap is indirect: heavy usage of Screener.in/Tickertape alongside Groww (OBSERVATION).

---

# 3. Zerodha Deep Dive

## 3.1 Ecosystem map (all VERIFIED from zerodha.com/support/Z-Connect unless noted)

| Product | Who | Problem solved | Workflow stage | Deliberately does NOT do |
|---|---|---|---|---|
| **Kite** | Traders + investors | Execution, charting (ChartIQ + TradingView, 100+ indicators), watchlists, option chain (Greeks/PCR/Max Pain via Sensibull), 500 alerts + 200 alert-trigger orders, GTT/iceberg/basket, MTF, Nudge warnings, Kill Switch | Trade / monitor | Deep fundamentals (only a Tijori snapshot widget), screening, advice, paper trading |
| **Console** | Investors, tax filers, families | True corporate-action-adjusted P&L, stock+portfolio XIRR, Performance Curve vs Nifty benchmarks (beta), best-in-industry Tax P&L, family view (10 accounts, view-only), Timeline/Insights (Tijori) | Analyze / tax | Unified mobile stocks+MF+bonds+NPS view; performance attribution; order placement for family |
| **Coin** | Long-term savers | Direct MF (₹2 L cr AUM, ~5.6 M SIPs), NPS, FDs — zero commission | Invest / save | Historically almost no fund research (2024–25 revamp adding analysis/comparisons); no cart; no 1-day-change |
| **Varsity** | Beginners/learners | Free structured education, 13+ modules, certification (~₹250) | Learn | Advice, simulation, upsell |
| **Kite Connect API** | Algo traders, fintechs | Programmatic orders (free since Mar 2025); market data ₹500/mo | Automate | Free market data, backtesting engine |
| **Rainmatter partners** | Various | Smallcase (baskets), Streak (no-code algo, free), Sensibull (options, free), GoldenPi (bonds), Ditto (insurance), **Tijori (fundamentals — powers Kite stock pages/Console insights)**, MProfit (multi-asset tracking) | Fill gaps Kite won't | Full integration — each is a separate login/app routing orders back through Kite |

**Philosophy (VERIFIED via Nithin Kamath blog/Forbes):** no ads, no growth targets, no push notifications to trade, no dark patterns; deep features deliberately delegated to partners. Financially fortress-like: FY25 revenue ₹8,847 cr, PAT ₹4,237 cr, ~₹22,679 cr cash, zero debt — despite losing the #1 client spot to Groww.

**Business pressure (VERIFIED):** SEBI's 2024–25 F&O measures (₹15–20 L contract size, one weekly expiry/exchange, upfront premium, higher expiry-day margins) hit ~30% of orders; Nithin publicly stated "the time has finally come for the business to pivot." Diversification levers: MTF (~₹9,000 cr book), Coin revamp, AI/MCP experiments, corporate bonds licence (HYPOTHESIS on direction, VERIFIED on statements).

## 3.2 Ecosystem workflow and exit points

```
Learn        Varsity ✔ (best-in-market)
Discover     Kite watchlists / Kite Screener presets / smallcase themes   → users exit to Tickertape, Chartink for real discovery
Research     Tijori widget + stock pages (snapshot only)                  → PRIMARY EXIT: Screener.in, annual reports, Trendlyne,
                                                                            concall transcripts, ValuePickr, Moneycontrol
Trade        Kite ✔ (decisively best execution/charting stack)
Monitor      Kite positions + Console holdings + Coin (three surfaces)    → users exit to ValueResearch/Excel for one combined view
Analyze      Console P&L/XIRR/tax ✔ (best tax reports in industry)        → exit to MProfit/Excel for multi-broker & attribution
```

**Direct community evidence (VERIFIED, TradingQnA):** a user states they must use ValueResearchOnline to see all investments in one place because Coin/Kite/Console are siloed; another rates Zerodha "market analytics 0/100," listing nine separate products a user must juggle and asking for one integrated research/analytics experience.

## 3.3 Strengths / limitations summary

**Strengths:** execution reliability and trader tooling (decisive), pricing (₹0 delivery), Console tax P&L, Varsity, trust/transparency brand, profitability.
**Limitations users voice (OBSERVATION):** app fragmentation (Kite/Coin/Console), no in-app screening-to-research continuity, ticket-driven support, Coin UX gaps (no cart, autopay failures), IPO UPI-mandate failures, no 3-in-1 banking, beginner-hostile Kite.

---

# 4. Investor Workflow Map (cross-platform reality)

**VERIFIED canonical stacks** (from ValuePickr/Reddit/TradingQnA threads; representative quotes cited in research):

| Persona | Actual stack observed |
|---|---|
| Beginner / SIP saver | Groww or ET Money + YouTube + WhatsApp groups |
| Long-term fundamental investor | Zerodha (execute) + **Screener.in** (screen/fundamentals) + BSE/NSE filings + concall transcripts + credit-rating reports + **Excel/Sheets DCF** + ValuePickr (peer review) |
| Active trader | Kite + TradingView + Chartink + Sensibull + Telegram |
| Multi-asset family / HNI | MProfit or INDmoney + CA + custom Excel |
| Quant/tinkerer | Python + Kite Connect + Screener + ChatGPT/AI tools |

**The serious-research pipeline (reconstructed from ValuePickr + tool docs, VERIFIED/OBSERVATION):**
idea (screen/forum) → Screener.in query → annual report/DRHP (400–700 pages per company per HonestMoney — VERIFIED) → concall transcripts → credit-rating reports (CRISIL/ICRA) → shareholding/insider data (Trendlyne) → Excel valuation model → decision journal (self-maintained). A proper mid/small-cap deep dive is **20–40+ hours** (OBSERVATION); ValuePickr veterans describe conviction-building over 2 years (VERIFIED quote).

**The monitoring pipeline:** price alerts split across broker/Screener/Moneycontrol; results season for a 20-stock portfolio = ~300–600 pages of transcripts, 15+ hours, 4×/year (VERIFIED: inve.money); corporate actions tracked by third-party apps; news across 4+ apps ("I used to spend 30–40 minutes every morning reading news across 4 apps" — VERIFIED testimonial).

---

# 5. Fragmentation Map — where users open another tab/app/spreadsheet

Ranked by frequency of mention in communities and by how many products exist solely to attack the gap:

1. **Consolidated multi-broker / multi-asset / family portfolio view.** NSE: 11.3 cr unique investors vs 22 cr client codes — multiple accounts per person are the norm (VERIFIED, Moneycontrol). An entire product wave (INDmoney, MProfit, DeltaView "stop logging into 4 apps", Invesh, Arthavi, freefincal sheets, GitHub Excel trackers) exists because neither broker shows stocks+MF+FD+NPS+EPF+gold in one place. **VERIFIED problem.**
2. **Capital-gains tax across brokers.** "No single source document consolidates all of this the way Form 16 consolidates salary" (VERIFIED, TaxBuddy); FIFO across brokers is manual. **VERIFIED problem.**
3. **Deep fundamental research.** Broker apps end at ratio snapshots; the actual work happens in Screener.in + documents + Excel. Even Screener users complain about ratio errors, missing metrics, paywalls (VERIFIED quotes). **VERIFIED problem.**
4. **Valuation judgment.** Neither Groww nor Zerodha (nor free Screener) computes intrinsic value / margin of safety / "is this cheap"; users go to Excel, Tijori paid reverse-DCF, Alpha Spread. **VERIFIED gap; pain level varies by segment.**
5. **Results-season monitoring at portfolio level.** Earnings calendars, transcript summaries, guidance ("promise vs delivery") tracking are manual; new AI tools (ConCallIQ, Inve.money, NiveshIQ, Sharpely) are emerging precisely here. **VERIFIED problem.**
6. **Decision support** (buy/hold/sell, position size, exit rules). Both platforms explicitly avoid it (regulatory + philosophical); the vacuum is filled by finfluencers/Telegram — which SEBI is dismantling. **VERIFIED gap; validated demand, regulated supply.**
7. **MF overlap / cross-holdings concentration.** Partially solved by ValueResearch/Tickertape/OverlapIQ. **VERIFIED but crowded.**
8. **Alerts/news scattered** across broker + Screener + Moneycontrol + Telegram. **OBSERVATION.**

---

# 6. Potential Opportunity Map

Each item: who hurts, how much, how often, current workaround, why incumbents haven't solved it, and an honest label. **No conclusion that UAA should build any of these** — that is Phase 2/3 work.

### O1. Integrated deep-research workspace (screen → filings → concalls → cited synthesis) — **VERIFIED PROBLEM**
- **Who:** active stock investors (~37.9 L cash-active) and sophisticated self-directed (~15–30 L core).
- **Pain/frequency:** 20–40 h per new stock; weekly. Current workaround: Screener.in + PDFs + Excel + forums.
- **Why unsolved by incumbents:** Groww optimizes for mass-market transaction volume, not 400-page AR readers; Zerodha deliberately outsources research to partners (Tijori/Tickertape) and keeps Kite lean. Neither monetizes research directly.
- **Caveat:** Screener.in is beloved, profitable (₹14.5 cr PAT on ₹23 cr revenue FY25 — VERIFIED) and now shipping Screener AI. The bar is high; the gap is *synthesis and cross-document work*, not raw data display.

### O2. Portfolio-level results-season intelligence (earnings calendar + transcript synthesis + guidance tracking) — **VERIFIED PROBLEM**
- **Who:** anyone holding 10+ stocks; most acute for active/sophisticated investors and advisors.
- **Pain/frequency:** 15+ hours, 4×/year, plus daily news triage. Workaround: manual reading, Telegram summaries.
- **Why unsolved:** brokers have no revenue link; data plumbing (transcripts, filings) is fragmented. New AI startups attacking it are early and un-trusted.
- **Trust requirement (VERIFIED sentiment):** AI is accepted as a *summarizer with citations*, not as a decision-maker.

### O3. Valuation & decision support (fair value, margin of safety, position sizing, exit discipline) — **LIKELY PROBLEM REQUIRING VALIDATION**
- **Who:** active + sophisticated investors; also the advice-starved long-term retail cohort.
- **Evidence for:** neither incumbent offers anything beyond P/E context (VERIFIED); "when to exit" questions dominate forums (OBSERVATION); <1,000 RIAs for 12 cr investors (VERIFIED).
- **Evidence of caution:** SEBI regulation makes explicit recommendations legally sensitive (why incumbents abstain — VERIFIED via their disclaimers); willingness-to-pay for *judgment tools* (vs free data) is unproven in India outside Tickertape's 120k paying users and Trendlyne subscriptions.

### O4. Cross-asset, cross-broker portfolio intelligence (allocation, overlap, risk, tax) — **VERIFIED PROBLEM, CROWDED SOLUTION SPACE**
- Pain is real (#1 in fragmentation ranking) but INDmoney, MProfit, ValueResearch, ET Money, Kuvera and a wave of 2025–26 startups already attack aggregation. The *unsolved* layer is analytical depth on top of aggregation (policy-aware alignment, attribution, risk) rather than aggregation itself. Aggregation requires India-specific plumbing (CAS parsing, broker APIs/MF Central).

### O5. Mid-market professional / advisor research stack — **LIKELY PROBLEM REQUIRING VALIDATION**
- Bloomberg/Capitaline/Ace are unaffordable below institutional scale (VERIFIED pricing complaints); 1.78 L MFDs and growing family-office count need client-grade reporting and research. Small individual markets but high willingness to pay. Distribution to this segment is non-obvious.

### O6. Beginner guidance / education — **WEAK HYPOTHESIS (for a research product)**
- Varsity already dominates education free of charge; beginner attention is over-served; monetization pushes toward exactly the distribution business Groww owns. No evidence a third party wins here on research quality.

### O7. Trader tooling (options analytics, algo, scanners) — **WEAK HYPOTHESIS**
- Segment is shrinking under SEBI pressure (−20% FY26), 9-in-10 lose money, and Sensibull/Streak are free inside Zerodha. Poor strategic ground.

---

# 7. Phase 2 Recommendation

Phase 1 establishes that the *execution* layer of Indian investing is a solved, brutally competitive duopoly+ (Groww for mass-market distribution, Zerodha for trader tooling), while the *cognition* layer — deep research synthesis, portfolio-level monitoring intelligence, valuation judgment, and policy-aware portfolio analysis — is where investors demonstrably assemble 4–8 tools plus Excel. That cognition layer maps to what UAA nominally is (an analyzer, not a broker).

**Phase 2 should audit UAA against these validated Indian workflows — capability by capability, data source by data source:**

1. **India data-foundation audit (highest priority).** Every validated gap depends on Indian data: NSE/BSE fundamentals and filings, concall transcripts, shareholding/pledge data, corporate actions, credit-rating events, MF/NAV data (AMFI), Indian corporate-action-adjusted prices. Phase 2 must establish precisely what UAA's existing pipelines (Yahoo, EDGAR, screener.in per repo docs) actually cover for Indian securities, what's stale/missing, and what is legally/technically obtainable (licensing, scraping terms, MF Central/CAS access). EDGAR-centric features are US-shaped; the audit should flag every module with US-only assumptions.
2. **Map UAA's engines onto the opportunity map.** Assess the IC report platform, valuation engine (already INR lakh/crore aware per repo docs), thematic engine, event screener, and portfolio-alignment engine against O1–O4: which validated workflow does each engine already serve, with what Indian-specific deltas (accounting formats, segment reporting, promoter-pledge red flags, Ind AS quirks)?
3. **Segment-fit analysis, not segment assumption.** Test UAA's current UX and depth against the two most evidence-backed segments — active/sophisticated self-directed investors (O1/O2/O3) and mid-market professionals/advisors (O5) — and explicitly evaluate whether UAA should NOT chase beginners/traders (O6/O7 are weak).
4. **Trust & compliance posture.** Given SEBI's advice regime and the "AI must cite sources" trust finding, audit how UAA's AI outputs carry provenance today, and what an India-compliant framing of "decision support without regulated advice" would require (RIA/RA boundaries).
5. **Competitive delta vs the real competitors.** For the cognition layer, UAA's competitors are not Groww/Zerodha but Screener.in (+Screener AI), Trendlyne, Tickertape, Tijori, and the 2025–26 AI-research wave. Phase 2 should produce a feature/quality delta against these, since they set user expectations and price anchors (₹3,000–5,000/yr).

**Explicitly out of scope until Phase 2 is approved:** building anything, changing UAA, or committing to a target segment.

---

## Appendix: Source Index (primary references)

- Groww: groww.in product/help pages (stocks, charges, MTF, bonds, GTT, screeners, updates), Groww Annual Report 2025-26, SEBI settlement order (May 2025), Inc42/ET/BusinessLine coverage of IPO, Fisdom, W by Groww, US-stocks discontinuation.
- Zerodha: kite.trade docs, support.zerodha.com, Z-Connect (Tijori widget/stock pages, Console Timeline, Performance Curve, tax reports, family portfolio, Nudge, Kill Switch, SEBI F&O explainer), zerodha.com/varsity, Nithin Kamath blog/Forbes/NDTV Profit, TradingQnA threads (102970, 157070, 192816).
- Market data: CDSL periodic stats, AMFI annual/monthly reports, NSE active-client data via Business Standard/CNBC-TV18/Moneycontrol, SEBI F&O loss studies (FY24, FY22–24, FY26), SEBI board files on RIA counts, EY/Julius Baer family-office studies.
- Workflow evidence: ValuePickr (data-sources thread 19596, equity checklist 102117, BQ framework 27415), r/IndianStreetBets, freefincal, HonestMoney.in, inve.money, TaxBuddy, DeltaView/Invesh/Arthavi/MProfit/INDmoney product pages, Screener.in docs/AI page, Tickertape/Trendlyne/Tijori pricing pages.

Full sub-reports with per-claim citations are preserved in the Phase 1 research transcripts (five research streams).
