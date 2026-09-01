# UAA — Full Indian Investing Ecosystem & Product Gap Audit

**Date**: 2026-08-16
**Method**: Full codebase inspection (22 page routes, 161 API routes, 42 SQLite tables, all engines in `lib/`) + competitive research on Groww, Zerodha (Kite/Console/Coin/Varsity), INDmoney, ET Money, Kuvera, Value Research, Paytm Money, Angel One, Upstox, Screener.in, Tickertape, Trendlyne, Moneycontrol, StockEdge, smallcase + FY2025-26 tax rules + SEBI RIA/RA regulatory boundaries.
**Question answered**: Is UAA actually the best product for helping an Indian investor understand, manage, research, and improve their investments — or a collection of overlapping features that leaves major parts of the journey unsolved?

---

## 1. Executive Verdict

**UAA is an institutional-grade equity research workstation with a genuinely novel personalization core — pointed slightly to the side of the Indian investor's actual life.**

The honest summary:

- UAA's **policy → alignment → decisions → memory** chain (`lib/portfolio/alignment/`, `lib/portfolio/engines/decision-memory.ts`) is something **no Indian platform has**. Not Groww, not ET Money Genius (black-box robo), not Tickertape (community-relative diversification score), not Trendlyne (generic portfolio analytics). Measured facts scored against the investor's *own stated policy*, with per-holding exceptions, dismissal memory, and evidence-led revival — this is the germ of a category-defining product.
- But UAA **cannot see most of an Indian household's portfolio**. Mutual funds are the default Indian retail vehicle (₹75L+ crore industry AUM, ~5 crore SIP accounts) and UAA's Indian MF support is a TER lookup (`lib/amfi.ts`) bolted onto Yahoo fund profiles. No NAV history, no Indian MF discovery, no rolling returns, no overlap for Indian schemes, no CAS import. An Indian investor's UAA portfolio is structurally incomplete on day one.
- UAA has **zero tax intelligence** — `lib/portfolio/engines/decision.ts` explicitly disclaims: *"No tax rate is modeled."* In India, tax-aware selling, ₹1.25L LTCG-exemption harvesting, and STCG/LTCG-aware trims are deterministic, quantifiable, personalized value — exactly UAA's ethos ("engines decide, AI explains") — and the biggest annual rupee value any tool can deliver a retail investor. Kuvera charges coins for a weaker version of this.
- UAA answers "should I buy X?" from **up to six surfaces with different numbers** (screener composite, `lib/scoring.ts` recommendation, AI verdict, IC report thesis, valuation blend, engine signal tier) — some portfolio-aware, most not. The band vocabulary is shared (`lib/recommendation.ts`) but the *inputs* differ by design and nothing reconciles them for the user.
- There is **no onboarding**. The product's magic (policy, alignment, decision memory) is invisible until a user manually assembles holdings and completes a policy wizard they aren't led to.

**Verdict: UAA is not yet the best product for an Indian investor — it is the best-engineered *half* of one.** The half that exists (equity research depth, portfolio judgment, decision discipline) is ahead of everything in the Indian market. The half that's missing (mutual funds, taxes, goals/planning, household completeness, delivery channels) is what makes an Indian investor open an app every week. The gap is closable, and closing it does not require becoming Groww — it requires becoming the intelligence layer Groww structurally cannot build.

---

## 2. What UAA Currently Does Well

| Capability | Where | Why it's genuinely good |
|---|---|---|
| **Portfolio Alignment** | `lib/portfolio/alignment/` (policy.ts, engine.ts), Portfolio → Dashboard | 7 themes scored against the investor's own priorities/tolerances; opt-outs are facts not judgments; per-holding exceptions; policy conflicts detected, never scored; verdict-led output. No Indian competitor evaluates a portfolio against *the investor's own policy*. ET Money Genius is closest and it's a subscription black box. |
| **Decision memory & anti-repetition** | `lib/portfolio/engines/decision-memory.ts`, `decision_dismissal` | Dismissals persist per thesis-key with revival only on *material change* (policy changed, position grew ≥5pp, theme fell ≥12pts). No retail product anywhere respects a considered "no" like this. |
| **Idea workflow with derived states** | `lib/ideas/evidence.ts`, Watchlist board | `new → working → ready → waiting → owned/passed/exited` derived from observed evidence (research recency, notes, valuation cases, journal), never hand-set. Passing requires a reason and writes a journal decision. This is thesis discipline no Indian app attempts. |
| **Decision Journal + calibration** | `/journal`, `decision` table | Conviction (1-5), thesis, fit-at-decision, price-at-decision, outcome tracking, calibration by conviction. Zerodha's trade-tagging is the nearest competitor feature and it's a text field. |
| **Indian equity research depth** | `lib/screener-in.ts`, `lib/india-news.ts`, `lib/india-ownership*.ts`, `/api/india/results-*` | screener.in fundamentals + shareholding **with promoter/FII/DII QoQ deltas and multi-quarter streaks** in the screener universe (`lib/screener/universes/india-equity.ts`), NSE corporate announcements as first-class filings, results radar, curated alias news matching for 136 Indian companies, NIFTY sectoral benchmarks, INR lakh/crore formatting throughout, India-aware DCF terminal growth. This is Screener.in-grade data inside a decision system. |
| **Deterministic valuation with provenance** | `lib/ic/canonical.ts`, `valuation-engine.ts`, `valuation-inputs.ts` | Every figure computed deterministically; the model proposes inputs only, inside validated bands, with rejection tracking. DCF + reverse DCF + scenarios + sensitivity + multiples with applicability logic (no DCF on banks). Safer than anything the Indian market ships as "AI valuation". |
| **Multi-asset lot-level ledger** | `portfolio_lot`, `lib/portfolio/model/types.ts` | 12 asset classes, per-lot cost basis with fees, multi-currency (`costBasisBase`), multi-portfolio, XIRR + benchmark-relative (same cash flows into SPY/NIFTY), CVaR, factor exposures, stress scenarios. Console-grade math without a broker. |
| **Portfolio Intelligence (look-through)** | `lib/portfolio/intelligence/` | "You own more NVDA than you think" via fund constituent look-through, correlation clusters, hidden sector bets, behavioral patterns — evidence labelled observed/derived, honest `allClear` state. Tickertape/Trendlyne have nothing at this rigor. |
| **AI architecture** | `lib/ai/` | Provider chain with keyless default, task registry with effort tiers, structured outputs, grounding verification (`lib/ai/grounding.ts`), deterministic fallbacks everywhere, prompt/response caching, eval harness. "AI narrates, engines decide" is the correct answer to SEBI-era AI safety and most competitors have it backwards. |
| **Scenario simulator** | `lib/portfolio/simulator/` | Mandate interview → generated book → identical analytics as the real ledger by construction → promote to holdings. This is a *portfolio planning engine* already — it's just not framed as one. |
| **Attention management** | Watchlist pulse, home attention queue, Wire personal impact | "What changed since your last visit" with session-aware baselines; reasons displayed, scores hidden. Genuinely thoughtful monitoring. |

---

## 3. What UAA Currently Does Poorly

1. **Indian mutual funds barely exist.** `lib/amfi.ts` fetches TER only. No NAV history pipeline, no Indian scheme universe in the screener (fund universes page *Yahoo's ETF screener* — US-listed funds; `lib/screener/universes/fund-shared.ts`), no rolling returns, no category rank, no direct-vs-regular, no exit-load awareness, no MF overlap for Indian schemes. For the median Indian investor, this makes UAA a partial mirror of their financial life.
2. **No tax awareness anywhere.** No STCG/LTCG distinction, no ₹1.25L exemption tracking, no loss set-off logic, no harvesting, no capital-gains report. Trim/exit recommendations state raw realized gain with an explicit "no tax modeled" disclaimer. In India this is the most quantifiable missing value in the product.
3. **Research-surface sprawl with unreconciled answers.** Screener composite (5 sub-scores, no momentum/analyst inputs), `lib/scoring.ts` (market-aware multi-signal), AI verdict (grounded in scoring), IC report (9 agents + deterministic valuation), valuation workspace (living case), quant engine (factor z-scores + Kelly). A stock can be 82/100 in the screener, HOLD in research, and above fair value in the IC report — *by design* — and no surface explains the disagreement.
4. **Flagship research surfaces ignore the portfolio.** AI verdict (`lib/ai/verdict.ts`), Compare (`lib/ai-compare.ts`), IC report (`lib/ic-agents.ts`), Screener AI summary — all asset-only. The fit panel exists on Research, but the verdict a user reads doesn't know they already own the stock through three funds.
5. **No onboarding or aggregation.** Screenshot import is clever but MF-hostile (brokerage screenshots show stocks, not CAS-registered folios). No CAS/statement import, no Account Aggregator path. Every competitor onboards a full portfolio in minutes (CAS email/PDF: INDmoney, Kuvera, Value Research, Paytm Money; AA: Groww Stocks Track).
6. **No goals/planning layer.** Policy captures tolerances and horizon bands, but nothing captures *what the money is for* or projects contributions. No SIP/step-up/SWP planning of any kind — the single most-used tool category in Indian investing (every competitor's top SEO asset) is absent even in portfolio-aware form.
7. **Monitoring without delivery.** Alerts are in-app bell only (`notification` table). No email, no push, no PWA install path. A monitoring product that requires opening the app to learn you should open the app.
8. **Record-keeping gaps Indians feel immediately**: no corporate-action processing (a bonus issue silently corrupts lot math until manually fixed), no dividend payment history (income theme uses estimated yield, not received cash), no IPO calendar/pipeline (India had 90+ mainboard IPOs in 2025), no NFO awareness.
9. **Navigation coherence**: 4 objectives is right, but Discover holds 4 idea tools with different scoring vocabularies and Research holds 4 depth levels presented as sibling tools. Primary feedback ("UAA feels overwhelming") is structurally correct: the product presents its engines as destinations instead of presenting *answers*.
10. **Single-user, desktop, local-first** — a strategic identity (privacy, own-your-data) that also means: no mobile experience for a mobile-first market, and no household view (spouse/parents) that INDmoney/Kuvera treat as table stakes.

---

## 4. Indian Competitor Landscape

**Brokers/execution (Groww, Zerodha, Angel One, Upstox, Paytm Money)**
- **Groww** (~1.6cr investors): the default beginner platform. Strengths: onboarding, MF discovery (1,740+ funds, ratings, risk grades, manager pages, AMC pages, NFOs), 17 calculators, XIRR + NIFTY benchmarking, custom portfolios, AA-based multi-broker tracking, IPO flow, MTF, gold/FD/bonds; shipping GR-1 (AI assistant), W (HNI wealth), Prime. Weaknesses: shallow research, support quality, glitches. **Lesson for UAA**: Groww owns execution + discovery breadth; it does not *reason* about your portfolio.
- **Zerodha** (~1.6cr): traders + serious DIY. Kite (GTT, baskets, 20-depth), **Console** (true P&L, corporate-action-aware, tax P&L, dividends, family portfolios, Tijori insights), Coin (direct MF, NPS), Varsity (best free education), Nudge/Kill Switch (behavioral protection), Kite MCP (read-only AI access), Quicko tax filing. **Philosophically refuses to give advice.** **Lesson**: Console is the record-keeping bar; the advice vacuum is deliberate — and is exactly the space UAA occupies.
- **Angel One**: super-app + ARQ Prime rule-based recommendations. **Upstox**: education + Trading Insights (imports any broker's P&L and analyzes behavior). **Paytm Money**: SIP baskets, MF report.

**Wealth/MF platforms (INDmoney, ET Money, Kuvera, Value Research)**
- **INDmoney**: net-worth aggregation king (CAS, EPF, NPS, banks, credit, US stocks via IFSCA), family accounts, IND fund ranks, MF portfolio scan (overlap, concentration), Claude MCP integration. Weak: support, performance, overwhelm.
- **ET Money**: behavioral profiling (8 investor personas), Genius dynamic asset allocation with monthly rebalancing (RIA-licensed, ₹99+/mo), fund report card, tax maximizer. Pivoted to subscriptions; charged ₹999 for capital-gains reports (backlash).
- **Kuvera**: **tax harvesting** (₹1.25L LTCG exemption automation) and TradeSmart (tax/exit-load-aware switching) — the proof that deterministic tax intelligence is a loved feature. CRED acquisition degraded it; users mourn it. That grief is a market signal.
- **Value Research**: the credibility brand. Star ratings, Analysts' Choice, portfolio manager with fund/stock overlap, premium advice. Dated UX.

**Research/intelligence (Screener.in, Tickertape, Trendlyne, Moneycontrol, StockEdge, smallcase)**
- **Screener.in**: query-language screens, 10yr financials, shareholding, credit ratings, concalls, Excel automation, results alerts; Screener AI answers from filings with citations. Deliberately minimal; zero portfolio awareness. ₹4,999/yr.
- **Tickertape**: scorecards (+red flags: pledging, ASM/GSM, default probability), MMI sentiment index, basket/smallcase integration, broker-linked portfolio analysis (diversification score, red-flagged holdings). ₹2,399/yr.
- **Trendlyne**: DVM scores, superstar (Jhunjhunwala-class) portfolio tracking, the deepest alert system in India (results, technicals, screeners at 15-min frequency), forecaster, portfolio NAV/rolling returns, MarketMind AI. Cluttered, complex pricing.
- **Moneycontrol**: news dominance (47M+ UV/mo), broadest portfolio tracker by asset class (incl. FDs, property, ULIPs), MC Pro recommendations. Shallow analytics.
- **smallcase**: model-portfolio marketplace (RA/RIA managers), rebalance workflows. **StockEdge**: scans + learning.

**Regulatory context (matters for any "advice" ambition)**: SEBI RIA/RA regimes gate *personalized recommendations delivered as a service*. Tickertape/Trendlyne operate under RA registrations; ET Money Genius under RIA (INA100006898, and was fined ₹3L in 2021); Zerodha avoids the question entirely; SEBI's 2024-25 finfluencer crackdown (Asmita Patel: ₹53.67cr impounded) killed "education-only" fig leaves that use live data + specific calls. **UAA's construction — deterministic measured facts scored against the user's own saved policy, decisions framed as "an opportunity to investigate, not an instruction to buy" (`resolveDecisionExecution`) — is not just better product, it is the legally safest architecture for personalization in India.** Keep it.

---

## 5. Competitor Feature Matrix

Legend: **E** = Excellent, **G** = Good, **B** = Basic, **—** = Missing, **★** = UAA advantage.

| Capability | Groww | Zerodha | INDmoney | ET Money | Screener.in | Tickertape | Trendlyne | Value Research | **UAA** | Importance (IN) | UAA opportunity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Execution (stocks/MF/IPO) | E | E | G | G | — | — (gateway) | — | — | **—** | High | Don't build; deep-link out |
| Stock fundamentals (India) | B | G (Tijori) | B | — | **E** | G | G | G | **G** | High | Close gap w/ docs-AI on concalls/ARs |
| Stock screener | B | — | B | — | **E** (query) | G | **E** (3,500 params) | B | **G★** (multi-asset, NL, saved) | High | NL + portfolio-aware ranking is the differentiator |
| MF discovery/research (India) | **E** | G (Coin) | G | **E** | B | G | G | **E** | **— (TER only)** | **Critical** | **P0 gap** |
| MF overlap / look-through | — | B (Console top-40) | **G** | B | — | B | B | **G** | **G★ for US funds, — for Indian MFs** | High | Extend existing engine to Indian schemes |
| Portfolio tracker (multi-asset) | G | G | **E** (net worth) | G | — | G | G | G (MF) | **E★** (12 classes, lots, multi-ccy) | High | Import is the bottleneck, not the model |
| CAS/statement import | AA-based | own book | **E** | E | — | broker link | manual | E | **— (screenshot only)** | **Critical** | **P0 gap** |
| XIRR / benchmark-relative | G | G | G | G | — | G | G | G | **E★** (same-cash-flows benchmark) | High | Surface it louder |
| Tax P&L / capital gains report | G | **E** | G | G (was ₹999) | — | — | — | B | **—** | **Critical** | **P0 gap** |
| Tax harvesting | — | — | — | B | — | — | — | — | **—** | High | Kuvera proved demand; field is open post-CRED |
| Corporate actions & dividend ledger | G | **E** (Console) | G | B | — | G (calendar) | G | B | **—** | High | Needed for ledger integrity |
| Goal planning / SIP planning | G | B | G | **E** | — | — | — | G | **—** (simulator exists, unframed) | High | Portfolio-aware planner beats every calculator |
| Calculators (SEO suite) | **E** (17) | G | G | E | — | — | — | G | **—** | Low for UAA | Skip generic; build contextual |
| Alerts (delivery + breadth) | G | G | G | G | G (results/phrase) | B | **E** | B | **B** (in-app only; good engine) | High | Add channels, not another engine |
| Thesis/journal/decision discipline | — | B (tags) | — | — | B (notes) | — | B | — | **E★** | Medium (differentiator) | Own this category |
| Policy-based portfolio evaluation | — | — | — | G (Genius, black-box) | — | B (div. score) | B | B | **E★** | High (differentiator) | Own this category |
| Scenario simulation | — | — | — | B | — | — | B (hedge) | — | **E★** (simulator + custom scenarios) | Medium | Reframe as planning |
| Institutional-depth reports | — | — | — | — | — | — | G (PDF) | G | **E★** (IC, 9 agents + det. valuation) | Medium | Consolidate entry points |
| AI research (grounded) | B (GR-1 beta) | B (MCP) | G (MCP) | B | **G** (filings AI) | — | **G** (MarketMind) | — | **E★** (grounding, provenance, fallbacks) | High | Add portfolio context everywhere |
| Superstar/insider tracking (India) | — | — | — | — | G | G (deals) | **E** | — | **B** (ownership trends only) | Medium | Cheap add via existing screener.in data |
| IPO/NFO radar | **E** | G | G | G | — | B | G | B | **—** | Medium | Radar + fit framing, not application flow |
| Behavioral protection / self-insight | B | **E** (Nudge/Kill) | — | G (personas) | — | — | — | — | **G★** (journal calibration, unsurfaced) | Medium | Make calibration teach |
| Education | B | **E** (Varsity) | B | G | G | B | B | **E** | **—** | Low | Skip; explain-in-context instead |
| Mobile experience | **E** | E | G | G | B | G | G | B | **—** (desktop web) | High | Strategic decision needed (PWA at minimum) |

---

## 6. Major Missing Capabilities (Gap Map)

| # | Feature | Competitor evidence | User problem | Build? | UAA differentiator | Existing connection | Location | Complexity | Priority |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Indian MF data platform** (AMFI NAV history, scheme master, category mapping, rolling returns, drawdowns, category rank) | Groww/ET Money/VR fund pages; Kuvera; INDmoney ranks | "Most of my money is in MFs and UAA can't analyze any of it" | **Yes** | Fund analytics feeding the *alignment/overlap engines*, not a fund supermarket | Platform data layer (`registry.ts` dataset), fund-scoring.ts, research fund page | Research Hub fund pages + Screener new `indiaFund` universe | Medium-High | **P0** |
| 2 | **CAS / statement import** (CAMS/KFintech CAS PDF + broker tax P&L parse → lots + folios) | INDmoney, Kuvera, VR, Paytm Money all onboard via CAS | "I'm not typing 40 holdings and 6 folios by hand" | **Yes** | Import → instant alignment report is a 10-minute wow no competitor can follow (they have no policy engine) | `lib/portfolio/import/` (extend extract/reconcile/validate), `portfolio_lot` | Portfolio → Import | Medium | **P0** |
| 3 | **India tax engine** (FY25-26: 12.5%/₹1.25L LTCG, 20% STCG, slab-rate debt, loss set-off, buyback-as-dividend; lot-level holding-period tags; harvesting scanner; capital-gains export) | Zerodha Console tax P&L; Kuvera harvesting/TradeSmart; ClearTax | "What will this sale cost me?" / "What free tax savings am I leaving?" | **Yes** | Tax cost/benefit *inside every decision card* — deterministic, personal, no license needed for your own tool | `lib/portfolio/engines/decision.ts` (replace the disclaimer), lots, exports | Portfolio → new Taxes tab + inline in Decisions | Medium | **P0** |
| 4 | **MF overlap & look-through for Indian schemes** | INDmoney portfolio scan; VR overlap | "These 4 funds are the same 12 companies" | **Yes** | Already built for US funds (`lib/portfolio/intelligence/lookthrough.ts`) — extend with Indian MF holdings data | Portfolio Intelligence detectors | Portfolio → Intelligence | Medium (data-bound) | **P0/P1** |
| 5 | **Plan module** (goal → SIP/step-up/SWP projected against the *real* portfolio; scenario compare; Monte Carlo bands from engine) | Every competitor's calculators; ET Money goals | "Will I get there? What does ₹20k/mo actually do to MY book?" | **Yes** | Simulator engines already produce identical analytics as the ledger — planning without a second math stack | `lib/portfolio/simulator/`, alignment engine, quant engine bands | Portfolio → Plan | Medium | **P1** |
| 6 | **Unified verdict layer** (one reconciled answer per asset; explains engine disagreements; portfolio-aware by default) | Nobody does this (Tickertape scorecard is single-engine) | "Screener says 82, Research says HOLD — which is it?" | **Yes** | Turns the overlap liability into a stated feature: "cheap on fundamentals, weak on momentum, oversized for your policy" | `lib/recommendation.ts`, scoring, composite, valuation case, fit | Research Hub hero + everywhere scores render | Medium | **P1** |
| 7 | **Onboarding journey** (import → policy interview → first alignment report) | Groww's onboarding polish; ET Money persona quiz | "I opened UAA and saw an empty table" | **Yes** | The policy interview IS the onboarding — no one else has one | Policy wizard (`/api/portfolio/policy/interpret`), import | First-run flow on `/` | Low-Medium | **P1** |
| 8 | **Alert delivery channels** (email digest, browser/PWA push) + corporate-action & dividend ledger | Trendlyne alerts; Console dividends; MC WhatsApp AI alerts | "Tell me when it matters without me opening the app" / "my bonus issue broke my P&L" | **Yes** | Alert *quality* already exists (crossing-based, deduped, thesis-aware) — just deliver it | `lib/monitor.ts`, `notification`, `portfolio_lot` adjustments | Settings → Notifications; ledger automation invisible | Low (email/push) + Medium (corp actions) | **P1** |
| 9 | **IPO/NFO radar with fit framing** | Groww IPO flow; NFO pages | "What's coming, and does it solve anything in MY portfolio?" | Yes (radar only) | Every listing framed by portfolio fit + policy, not hype | Calendar, Wire, fit engine | Calendar (new event types) + Wire | Low-Medium | **P2** |
| 10 | **Superstar/bulk-block-insider tracking (India)** | Trendlyne superstars; Tickertape deals | "What are Kacholia/DII/FII doing in my names?" | Yes (scoped to holdings/watchlist) | Only surfaced when it touches *your* book or watchlist | `lib/india-ownership.ts`, timeline, watchlist pulse | Timeline/Watchlist events | Low-Medium | **P2** |
| 11 | Rolling returns, TWR, attribution depth | Trendlyne NAV/rolling; VR | "Is my performance luck or skill, and when?" | Yes | Ties into journal calibration | `lib/portfolio-performance.ts` | Portfolio → Performance | Low-Medium | **P2** |
| 12 | Family/household portfolios | INDmoney, Kuvera, Console (10 members) | "I manage my parents' money too" | Later | Multi-portfolio schema already exists (`portfolios` table) | portfolio_id plumbing (write routes) | Portfolio switcher | Medium | **P2/P3** |
| 13 | Mobile/PWA | All | "I live on my phone" | PWA yes; native later | Local-first PWA with push | manifest.ts exists | — | Medium | **P2** |

---

## 7. Calculator / Tool Opportunities

**Do NOT build 17 standalone calculators.** Competitor calculators are SEO products (Groww's 17 calculators exist to rank on "SIP calculator" searches). UAA is a local-first product with no SEO funnel; a generic calculator inside UAA is dead weight. Every worthwhile calculator collapses into a *portfolio-aware planner* built on engines UAA already has:

| Generic calculator | Competitor version | UAA-native version | Integration | Output | Next action |
|---|---|---|---|---|---|
| SIP / Step-up SIP | ₹10k/mo @12% × 10y → ₹23.2L | **Contribution plan on the real book**: "₹10k/mo into your current mix → projected value, allocation drift, concentration in 5y; into a NIFTY index fund instead → X; your large-cap overlap rises to 41% under option A" | Simulator (`generate/evaluate`), alignment engine, quant engine P10/P50/P90 bands | 3 scenario cards with alignment deltas + projected theme scores | Save as plan; send scenario to Research; arm as recurring intent |
| SWP / retirement | Corpus − withdrawals @ return | **Drawdown against YOUR portfolio**: sequence-of-returns via existing stress scenarios; liquidity theme flags illiquid share; income theme covers yield gap | Alignment (liquidity/income themes), stress engine | "Your book sustains ₹60k/mo for 22-31 years; the binding constraint is your 18% illiquid sleeve" | Trim proposals via decision engine |
| Lumpsum | FV of one deposit | "Deploy ₹5L now": already exists — `/api/portfolio/allocate-cash` water-fills tranches by alignmentDelta | Cash engine | Existing decision cards | Execute in ledger |
| Capital gains / tax | ClearTax static form | **Real numbers from lots**: this-FY realized ST/LT, exemption headroom, harvest candidates, "sell HDFC lot 3 not lot 1 (LTCG in 22 days)" | Tax engine (P0 #3) on `portfolio_lot` | Tax position card + harvesting list + ITR-ready export | One-click harvest plan → journal |
| Brokerage/costs | Per-trade charge sheet | **Cost drag on YOUR history**: fees already stored per lot; annualized drag vs returns | Ledger, performance | "Costs consumed 0.4% of your XIRR" | — |
| XIRR | Standalone input form | Already computed properly (`lib/portfolio-performance.ts`) — expose per-position and per-goal views | Performance | — | — |
| Goal/inflation/retirement corpus | ET Money FIRE | Part of Plan module: goal object + funding status vs policy | Plan (P1 #5) | "Retirement goal 64% funded; on-track band assumes your stated 60% drawdown tolerance" | Adjust plan |
| EMI, GST, HRA, SSY, gratuity, income-tax-regime | Groww/ClearTax | **Skip entirely.** Not investing decisions; pure SEO artifacts. | — | — | — |

**Placement**: no "Calculators" nav item, no Tools section. The Plan module (Portfolio → Plan) + inline contextual actions ("What if I add ₹X/mo?" on Portfolio; "Project this SIP" on a fund page; "Tax cost" on every trim card).

---

## 8. Mutual Fund / AMC / Fund Manager Gaps

**Current truth**: Indian MF support = AMFI TER lookup matched by fund-name similarity (`lib/amfi.ts`, genuinely well-built) + whatever Yahoo happens to carry for `.BO` fund tickers. Fund screener universes are Yahoo's **US-listed** ETF/bond fund screener. `lib/fund-scoring.ts`/`ai-fund-research.ts` exist but are starved of Indian data. Portfolio Intelligence look-through works only where Yahoo reports top-10 constituents (US ETFs).

**What to build (in order):**
1. **Data spine (P0)**: AMFI NAVAll + historical NAV per scheme (free, official, daily), scheme master (category, plan type, ISIN), benchmark mapping. New platform datasets (`inFundNav`, `inFundMeta`) with long TTLs. This is days of work, not months, and unlocks everything below.
2. **Fund analytics that answer investor questions (P0/P1)**: rolling 1/3/5y returns vs category and benchmark (consistency, not point returns — ET Money's report-card insight is correct), drawdowns, SIP-XIRR on the user's own folio cash flows, expense drag (TER already available; direct-vs-regular delta in ₹ on *their* balance), exit-load and tax-class awareness (equity ≥65% vs debt slab-rate — classification rules from scheme category).
3. **Portfolio-aware fund intelligence (P1) — the differentiator**: overlap % with existing holdings (both fund×fund and fund×direct-equity: "you already own this fund's top 8 names directly"), what the fund *solves* ("this fund adds nothing your book lacks; your gap is duration, not more large-cap equity"), alignment simulation before buying (the discovery engine already simulates candidates against policy — extend to funds).
4. **AMC / manager intelligence (P2, scoped)**: Don't build Groww-style AMC brochure pages. Build the *actionable slice only*: manager-change events on **held/watched** funds (timeline event + alert), style drift vs category on held funds, AMC-level concentration ("62% of your MF money is one AMC — a business risk, not a market risk"). Fund-manager career pages are content marketing; UAA needs manager *change detection*, not biographies.
5. **NFO handling (P2)**: NFO radar entries in Calendar/Wire with a default-skeptical framing (NFOs are marketing events; "no track record, nothing your portfolio lacks" is usually the right answer — and saying so honestly is a differentiator).

---

## 9. MTF / Leverage / Advanced Investing Analysis

**Landscape**: MTF is a broker product (Groww 14.95% p.a./4x on 1,552 stocks; Zerodha 0.04%/day/5x/₹50cr cap; m.Stock 8.99%+). Pledging gives collateral margin with haircuts. SEBI mandates risk disclosure; **no platform explains portfolio-level consequences of leverage** — they disclose per-trade mechanics and sell the product.

**Recommendation: build zero execution/leverage features.** UAA has no broker license, no execution rail, and leverage products contradict its judgment-first identity (Zerodha itself launched MTF "reluctantly").

**Build instead (P2, conditional)**: a **leverage consequence lens** that activates only when the imported book contains MTF/pledged positions (CAS and broker statements reveal them): effective exposure vs equity ("your ₹10L book is ₹13.2L exposed"), interest drag vs expected return ("this position must return 15% before you earn rupee one"), stress amplification through the existing scenario engine, and margin-call distance. This reuses the factor/stress machinery and is the *only* MTF feature in India that would be genuinely novel.

**Options/F&O**: `lib/black-scholes.ts` + derivatives research already exist as analysis. Keep as research context (covered-call yield on held names is a reasonable P3); do not build option strategy execution — Sensibull/Trendlyne SmartOptions own that and it drags UAA toward trader-tool identity.

---

## 10. AI Quality Audit

Inventory of all 14 AI surfaces (context actually passed, from code):

| Surface | Portfolio context? | Verdict |
|---|---|---|
| Portfolio thesis / audit memo / new positions / home brief / watchlist digest | **Full** (holdings, alignment, policy, attribution, constraints, watchlist) | **Genuinely personalized** — best-in-class; the model reuses pre-computed directional verdicts rather than re-deriving |
| Research copilot | Optional block (objective, sector weights, fit, held?) | Good, but portfolio context should be default, not optional |
| App assistant | Snapshot (holdings, watchlist, cash) | Fine for navigation |
| **Research AI verdict** | **None** | The hero card of the flagship research page could be shown to any user — the single biggest AI personalization miss |
| **Compare verdict** | **None** | Ranks assets with no knowledge that you own two of them |
| **IC report (9 agents)** | **None** | Deliberate ("institutional independence") — defensible, but the *synthesis* should carry a fit addendum |
| Screener AI summary | None | Should reference portfolio gaps when ranking |
| Chart QA / valuation AI / import extraction / intel rail | None | Correct — these are asset/task-scoped |

**Evidence & safety: strong.** Grounding verification traces model figures to evidence (`lib/ai/grounding.ts`); valuation AI proposes inputs only, inside bands; verdict direction is *computed* from the deterministic score, the model only narrates; deterministic fallbacks everywhere; honest attribution ("figures computed locally"). This is materially safer than GR-1/MarketMind-class competitors and is the right posture under SEBI's AI-accountability amendments.

**Consistency: the real weakness.** Shared bands (`lib/recommendation.ts`) prevent label chaos, but six engines with different inputs will disagree numerically and nothing explains it. Fix is product, not prompts (see §16, Unified Verdict).

**Feedback loop: half-built.** Decision dismissals persist with revival context (excellent; nobody else has this). But: no capture of *accepted* recommendations, no thumbs/corrections on AI output, journal calibration data (conviction vs outcome) is computed and **never fed back** into sizing or AI context. The system measures whether you're a good decision-maker and then doesn't use it.

**Actions**: (1) portfolio context into verdict/compare/screener-summary by default; (2) IC synthesis fit addendum; (3) log accepts alongside dismissals; (4) thread `journal` calibration into `position-size.ts` conviction weighting and portfolio-AI prompts; (5) keep "AI narrates, engines decide" as an inviolable rule.

---

## 11. Personalization Audit

Places UAA already knows something about the user and doesn't use it:

1. **Policy is invisible outside Portfolio.** The user stated drawdown tolerance, liquidity needs, income needs, exceptions — Research/Compare/Screener/IC never mention them. Every research surface should be able to say "this conflicts with your 15% single-position cap" or "you opted out of income; ignore the yield pitch."
2. **Ownership through funds is known but unspoken at research time.** Look-through exists in Portfolio Intelligence; the Research page for RELIANCE doesn't say "you already hold 2.1% via two index funds."
3. **Watchlist theses/triggers are known** — but the AI verdict for a watched name doesn't reference the user's own thesis or target ("your buy trigger was ₹2,400; it's ₹2,380 with results in 6 days").
4. **Journal history is known** — "you passed on this in March citing valuation; it's 18% cheaper now" is computable today (decision table + prices) and shown nowhere.
5. **Cost basis is known** — research on a held name never frames valuation vs *your* entry or the tax status of your lots.
6. **Calibration is known** (journal by conviction/fit) — never turned into guidance ("your 5-conviction buys underperform your 3s — evidence attached").
7. **Behavioral patterns are detected** (anchoring, winner concentration, home bias in Portfolio Intelligence) — quietly, in one tab, once; never at the moment of a new decision that repeats the pattern.
8. **Policy exceptions are known** — Wire/Screener still surface "reduce QQQM" style ideas that the user has explicitly excepted (decision memory catches some; make exceptions first-class in idea relevance).

The philosophy to enforce everywhere: **"Don't tell me whether it's good. Tell me whether it makes sense for ME"** — UAA has the data model for this today; it's a context-threading problem, not a data problem.

---

## 12. Missing Connections Between Existing Features

| From | To | The missing thread |
|---|---|---|
| Screener results | Portfolio gaps | Results ranked only by composite; add "solves your gap" badge using discovery's simulate-against-policy (already built in `computeDiscovery`) |
| Compare | Portfolio | "Which of these fits MY book" column (fit engine exists; Compare never calls it) |
| Research verdict | Fit/exposure panels on the same page | They render side by side and don't read each other; verdict prompt should ingest fit + look-through exposure |
| IC report | Valuation workspace | IC computes a valuation suite; the living case in `/valuation` is separate — one valuation object should flow both ways (partially connected via case summary; complete it) |
| Journal calibration | Position sizing / AI | Computed, never consumed (§10) |
| Watchlist triggers | Alerts/monitor | Buy/sell triggers are free text; parse the numeric ones into crossing alerts automatically ("waiting" state should self-arm) |
| Timeline events | Thesis drift → Decisions | Drift is shown in Watchlist drawer; a sustained "weakening" never generates a decision card ("thesis broke — review or exit") |
| Simulator | Plan/goals | The engine that could answer every SIP/goal question is framed as a hypothetical-portfolio toy |
| Wire opportunities | Decision memory | Dismissed Wire ideas and dismissed portfolio theses are separate memories; unify on thesis keys |
| Calendar | Portfolio weights | Calendar knows events; give holdings-weighted prominence ("earnings for 34% of your book this week") if not already weighted |
| Exports | Taxes | Portfolio export exists; the ITR-relevant export (Schedule CG shape) is the one Indians actually need annually |

---

## 13. Features We Should NOT Build

1. **Execution/broking of any kind** (orders, MTF, pledging, IPO applications, gold/FD/bond sales). Licensing, ops, and it converts UAA into a worse Groww. Deep-link out instead.
2. **Generic SEO calculators** (EMI, GST, HRA, SSY, gratuity, income-tax-regime). Not investing decisions; clutter.
3. **F&O trading tools / option strategy builders.** Sensibull/Trendlyne own it; wrong identity.
4. **News portal ambitions.** Moneycontrol has 47M UVs; UAA needs *event intelligence about your names*, which the Wire already is.
5. **Community/forums/social feeds, finfluencer content, superstar-copying portfolios.** Regulatory minefield (SEBI 2024-26) and antithetical to policy-driven investing. (Tracking superstar *activity in your names* is fine; "copy Kacholia" is not.)
6. **Insurance, loans, credit scores, expense tracking.** INDmoney's super-app sprawl is its most-cited weakness.
7. **smallcase-style model-portfolio marketplace.** Requires RA/RIA licensing and manager ops; the simulator gives users their own model portfolios instead.
8. **Digital gold / crypto expansion.** Crypto is already priced as an asset class; that's enough.
9. **A Varsity-style education academy.** Explain-in-context (which UAA does well) beats a courseware business someone else already gives away free.
10. **Another discovery engine or another score.** Six is already three too many.

---

## 14. Features to Consolidate / Remove

1. **Research depth levels, one front door.** Research Hub stays the single research surface; IC Report becomes "Commission deep dive" *inside* it (a mode/action, not a sibling nav tool); the valuation workspace is reached from the research valuation strip (already linked — make it the only path). Nav: Research objective goes 4 tools → 2 (Research Hub, Compare).
2. **Discover: 4 tools → 2 visible.** Wire (event-driven) + Screener (criteria-driven) are the two real entry intents. Quant Engine becomes an expert surface linked from Screener/Home ("systematic desk"); Thematic becomes an action inside Research/Wire ("map this theme") rather than a destination. Both keep their URLs; they leave the top nav.
3. **Exposure page → Portfolio Intelligence tab.** Both answer "what do I actually own and what moves together"; two surfaces for one question. Keep the route as a deep link.
4. **One reconciliation layer for scores** (§16 Unified Verdict) — this *is* consolidation: composite/scoring/valuation/engine stop being four user-facing answers and become four inputs to one.
5. **Journal + decision cards + watchlist "decide"** — already converging; ensure a single decision write path (`decision` table) with one UI vocabulary.
6. **Dead/legacy cleanup**: legacy `portfolio` table (superseded by lots), `scanner_cache` remnants vs `platform_cache`, `real_estate_lookup_cache` (no consumers), `/stocks/[symbol]` and `/research/india` redirects (keep, they're cheap), dead `position-recommendations.tsx` noted in roadmap, `sector_rotation_snapshot` consumers audit.
7. **Manual-asset chat vs research copilot vs app assistant**: one assistant surface with scoped context, not three chat implementations.

Net effect: **top-level tools go 14 → ~9 visible** with zero capability loss — directly answers the "overwhelming" feedback.

---

## 15. UAA-Specific White Space (What Competitors Structurally Can't Do)

1. **Policy-driven judgment.** Brokers monetize activity (conflict), Zerodha refuses advice (vacuum), research platforms have no user model, robo products hide the reasoning. UAA's alignment engine — transparent, deterministic, user-owned policy — is alone in the market.
2. **Decision memory + calibration.** "This system remembers my reasoning, respects my no, and shows me my own track record honestly." No platform in India (or the US retail market) does this.
3. **Cross-asset truth (look-through).** "You think you're diversified across 4 funds and 12 stocks; you're actually 38% four business groups." Data exists at Tickertape/INDmoney in fragments; nobody computes it with UAA's rigor — extend it to Indian MFs and it's unanswerable.
4. **Tax-aware decisions** (not tax filing — tax *inside the decision*). Kuvera proved the appetite, then CRED buried it. Zerodha reports taxes after the fact; UAA can prevent them before the trade.
5. **Scenario planning against the real book.** The simulator's identical-engines guarantee means "what if" answers are exactly as trustworthy as the portfolio page — no competitor's calculator can claim that.
6. **Thesis lifecycle.** Thesis → triggers → drift detection → decision → outcome → calibration is a closed loop nobody else even attempts (Trendlyne alerts are stateless; Console tags are inert).
7. **Local-first privacy.** Post-AMFI-data-ban, post-account-aggregator-consent-fatigue, "your ledger and your policy never leave your machine; AI sees only what's needed" is a real trust position INDmoney (privacy complaints) structurally can't take.
8. **Honest AI.** Provenance-carrying facts, computed verdicts, "AI interpretation" labels, reachable all-clear states. In a market SEBI is actively policing, honesty is a feature.

---

## 16. Top 10 Recommended Additions

Each: what → why → competitors → UAA difference → where → connects to → priority.

1. **India Tax Engine** — Lot-level STCG/LTCG tagging (FY25-26 rules incl. ₹1.25L exemption, slab-rate debt classes, loss set-off & carry-forward, buyback-as-dividend), harvesting scanner, tax cost on every trim/exit card, ITR-ready capital-gains export. *Why*: largest quantifiable annual value; deterministic; personalized. *Competitors*: Console (reporting only), Kuvera (harvesting, degraded), ClearTax (static). *UAA difference*: tax inside the decision, before the trade. *Where*: Portfolio → Taxes + inline everywhere. *Connects*: lots, decision engine, exports, calendar (FY-end reminders), advance-tax nudges. **P0**
2. **CAS & Statement Import** — CAMS/KFintech CAS PDF + broker tax-P&L parse → folios, lots, dates; reuse screenshot-import's reconcile/validate machinery. *Why*: onboarding is currently UAA's tallest wall. *Competitors*: universal. *UAA difference*: import lands directly in a policy-scored ledger. *Where*: Portfolio → Import (and first-run). *Connects*: `lib/portfolio/import/`, tax engine (needs dates), MF layer. **P0**
3. **Indian Mutual Fund Platform Layer** — AMFI NAV history + scheme master datasets; fund pages with rolling returns/category rank/drawdowns/expense drag; `indiaFund` screener universe. *Why*: the default Indian instrument is invisible today. *Competitors*: Groww/VR/ET Money fund pages. *UAA difference*: funds analyzed as portfolio components, not products. *Where*: Research Hub (fund pages), Screener. *Connects*: platform registry, fund-scoring, alignment, intelligence. **P0**
4. **MF Overlap & Indian Look-Through** — fund×fund and fund×stock overlap, group-level aggregation (Tata/Adani/HDFC across everything). *Where*: Portfolio → Intelligence + fund pages ("42% overlap with what you hold"). *Connects*: `lookthrough.ts`, MF layer (#3). **P0/P1**
5. **Plan Module (the calculator killer)** — goals with funding status; SIP/step-up/SWP scenarios projected on the real book via simulator engines; quant-engine probability bands; scenario compare with alignment deltas. *Competitors*: 17 generic calculators each. *UAA difference*: same engines as the ledger — projections you can trust; tradeoffs explained. *Where*: Portfolio → Plan; contextual "What if" entry points. *Connects*: simulator, alignment, cash engine, journal (plans become decisions). **P1**
6. **Unified Verdict Layer** — one reconciled per-asset answer: composite + scoring + valuation + engine signal as labeled *perspectives* with a one-line disagreement explanation, portfolio/policy context always attached. *Why*: fixes the most dangerous UX flaw (contradictions) and IS the consolidation strategy. *Where*: Research hero; every score chip links to it. *Connects*: recommendation.ts (extend), all engines, fit. **P1**
7. **Onboarding Journey** — import (#2) → policy interview (exists: `/api/portfolio/policy/interpret`) → first alignment report + 3 decision cards, in ~10 minutes. *Why*: the wow exists; it's just unreachable. *Where*: first-run on `/`. **P1**
8. **Alert Delivery + Corporate-Action/Dividend Ledger** — email digest & PWA push over the existing monitor; auto lot-adjustment for splits/bonuses (Yahoo events + NSE announcements already fetched), dividend receipts ledger (income theme gets real cash, tax engine gets dividend income). *Competitors*: Console (actions), Trendlyne (alerts). *Where*: Settings → Notifications; ledger automation invisible. **P1**
9. **IPO/NFO Radar with Fit Framing** — calendar/wire entries with policy-framed one-liners ("adds nothing your book lacks" / "your small-cap gap could be addressed cheaper via X"). Explicitly not an application flow. *Where*: Calendar + Wire. **P2**
10. **Calibration-Fed Conviction ("the mirror")** — journal outcomes by conviction/fit/pattern feed sizing and AI context; behavioral detectors fire *at decision time* ("this repeats your anchoring pattern — 3 prior instances attached"). *Competitors*: Zerodha Nudge (generic warnings); ET Money personas (static quiz). *UAA difference*: warnings from the user's own measured history. *Where*: decision cards, journal. **P2**

---

## 17. Recommended Information Architecture

**Keep 4 objectives. Reduce visible tools 14 → 9. Add zero new nav categories.**

- **Today** `/` — unchanged + first-run onboarding journey (#7).
- **Discover** — **Wire**, **Screener** (+ gap-aware ranking). *Engine and Thematic leave the nav*: Engine linked from Screener/Home as "Systematic desk"; Thematic becomes a contextual action ("Map this theme") in Wire/Research.
- **Research** — **Research Hub** (single front door: verdict = unified layer #6; fund pages #3; IC deep-dive as an action inside it; valuation via the strip), **Compare** (+ "fits my book" column).
- **Portfolio** — **Portfolio** (+ **Taxes** tab #1, **Plan** tab #5; Exposure folds into Intelligence), **Watchlist**, **Calendar** (+ IPO/NFO/results-season + FY-end tax events #9), **Journal** (+ calibration mirror #10). Valuation Register moves under the Valuation workspace ("cases needing attention" chip surfaces on Today).
- **Contextual, never nav**: every planner/calculator ("What if ₹20k/mo?", "Tax cost of this trim", "Project this SIP", "Simulate this decision"), leverage lens (only when leverage detected), AMC/manager alerts (timeline events).
- **Command-K**: add verbs — "harvest", "plan", "import", "what changed", "tax".

This is the direct answer to §14's "cleaner, simpler, more intentional": capability grows, surface area shrinks.

---

## 18. How Each Addition Connects to Existing Systems

| Addition | Reuses (no new engines) | New code honestly required |
|---|---|---|
| Tax engine | `portfolio_lot` (dates/fees exist), decision engine cards, export routes, calendar | Tax rule tables + lot-tagger + harvesting scanner (`lib/tax/`), one report builder |
| CAS import | `lib/portfolio/import/` extract→reconcile→validate pattern, AI vision task exists | CAS PDF parser (CAMS/KFintech formats), folio→scheme mapping |
| Indian MF layer | Platform data layer (registry datasets, SWR), `fund-scoring.ts`, `ai-fund-research.ts`, research fund components | AMFI NAV/scheme fetchers, category benchmark map, `indiaFund` universe |
| MF overlap | `lib/portfolio/intelligence/lookthrough.ts` + detectors | Indian holdings source (monthly AMC disclosures) + group-entity map |
| Plan module | Simulator (intake/generate/evaluate/edit), alignment deltas, quant bands, cash engine | Goal object + projection UI; contribution-schedule math |
| Unified verdict | `recommendation.ts`, both scorers, valuation case, fit engine, verdict prompt | One reconciliation function + hero component rework |
| Onboarding | Policy wizard + interpret route, import, alignment report | Flow shell + empty-state rewiring |
| Delivery + corp actions | `lib/monitor.ts`, notifications, Yahoo chart events (splits/divs already fetched), NSE announcements | SMTP/push adapters; lot-adjustment writer + dividend ledger table |
| IPO/NFO radar | Calendar buckets, Wire pipeline, fit engine | NSE IPO + AMFI NFO fetchers |
| Calibration feedback | `journal` calibration math, `position-size.ts`, portfolio AI prompts, behavioral detectors | Thread outputs into inputs; decision-time pattern check |

The pattern is consistent: **UAA's engines are ahead of its product.** Almost everything above is data plumbing + context threading + framing, not new science.

---

## 19. Ideal End-to-End Investor Journey (Post-Gaps)

1. **Arrive** → first-run: "Import your money" — CAS PDF + broker statement drag-drop → full household ledger (stocks, MFs, folios, dates) in minutes.
2. **Policy interview** (existing wizard + free-text interpret): goals, horizon, tolerances, exceptions. UAA reflects it back: "Here is the policy UAA believes you're describing."
3. **First verdict**: alignment report — "Well aligned (74). Where the points went: concentration (−11: three funds are the same 12 companies), liquidity (−8)." With the evidence.
4. **First decisions**: 3 cards, sized by measured search, tax-costed, framed as "opportunities to investigate."
5. **Research** any idea → one front door, one reconciled verdict, always in *your* context: owned-through-funds exposure, policy conflicts, your old journal notes on it, your trigger levels.
6. **Simulate** before acting: "add ₹2L" / "SIP ₹15k/mo" / "swap fund A→B" → before/after alignment, projected bands, tax cost, overlap change.
7. **Decide** → journal writes itself (thesis, conviction, fit, price, case version).
8. **Live** → UAA monitors: crossing alerts, thesis drift, results, corporate actions auto-ledgered, dividends received, earnings-week weighting — delivered to email/push, not just a bell.
9. **Something breaks** → "Thesis weakening on 2 of your names; TCS results missed your trigger assumption" → decision card, not noise. Dismissals remembered; revivals only on material change.
10. **FY rhythm** → December: "₹78k of harvestable LTCG headroom; here's the lot-exact plan." March: advance-tax nudge. April: ITR-ready export.
11. **Improve** → the mirror: calibration by conviction, pattern warnings at decision time, plan funding status quarterly.
12. **Repeat** → every quarter the policy question returns: "Life changed? Your policy hasn't been reviewed in 180 days."

Steps 2-7 and 9 are 70-90% built today. Steps 1, 8 (delivery/corp-actions), 10 are the missing spine.

---

## 20. Final Questions, Answered Brutally

### "If I gave an Indian investor Groww + UAA tomorrow, why would they keep opening UAA?"

**Today's honest answer: a serious direct-equity investor would open UAA weekly** — for research depth Groww doesn't have (shareholding streaks, IC reports, valuation cases, the journal) and portfolio judgment nobody has (alignment, decisions, memory). **Everyone else would stop opening it within a month**, because: their mutual funds aren't really in it, their taxes aren't in it, their goals aren't in it, it doesn't ping them, and the first session shows an empty table instead of their financial life. Groww keeps the daily loop (execution, SIPs, IPOs, mobile); UAA today is a brilliant second opinion that only sees half the patient. **That answer is weak, and the weakness is concentrated in five buildable gaps (§16 #1-5), not in the product's identity.**

### The capabilities that make UAA genuinely indispensable

1. **Import my whole financial life in minutes** (CAS + statements) — table stakes that unlock everything else.
2. **Score it against MY policy, transparently** (exists — make it the spine of every surface).
3. **Tax intelligence inside every decision** — the only feature on this list that pays for itself in rupees, every year, provably.
4. **Cross-asset truth**: fund overlap + look-through + group concentration for *Indian* portfolios — "what do I actually own?"
5. **One reconciled verdict, always in my context** — never two contradicting numbers again; never advice that ignores what I hold.
6. **Plans, not calculators**: SIP/SWP/goal scenarios on my real book with trustworthy math.
7. **Monitoring that respects me**: thesis drift, results, corporate actions auto-processed — delivered, deduped, dismissal-memoried.
8. **The mirror**: my own decision track record, calibrated, fed back into how UAA sizes and warns.

Groww can't build 2-8 (its economics are execution volume). Zerodha won't (advice vacuum by philosophy). Research platforms can't (no ledger, no policy). Robo products won't show their work. **The product that does all eight, transparently, on the user's own machine, is not "Groww + AI" — it is the intelligent investment system this audit was asked to find. UAA is closer to it than anyone, and further from it than it thinks.**

---

*Prepared by Devin. Codebase evidence: see file references inline. Competitive evidence: agent research reports (Groww/Zerodha, wealth platforms, research platforms, tax/MTF/regulatory), 2025-2026 sources cited therein.*
