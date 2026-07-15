# PLAN — Universal Portfolio Manager

Transform Portfolio from a stock dashboard into an allocation-centric, multi-asset
portfolio operating system. One page, one experience, one set of engines.

Status: **Phase 2 (design) — written before implementation, per the workflow.**

---

## Phase 1 — Audit findings

### 1.1 Portfolio is orphaned from its own platform

`grep` for `lib/assets`, `lib/platform`, `asset-class` across `app/portfolio/**`,
`app/api/portfolio/**`, `lib/portfolio-*.ts` returns **zero hits**.

This is not an oversight to be papered over — the integration was *designed and never
connected*:

- `lib/assets/types.ts:196` declares `Capability = ... | "portfolio"` with the comment
  *"Portfolio asks `can(id, "portfolio")` before offering to hold it"*.
- `equity.ts`, `etf.ts`, `reit.ts`, `crypto.ts`, `bond.ts` each already list `"portfolio"`
  in `capabilities`.
- Nothing reads it.

Consequence: Portfolio hardcodes per-asset behaviour that the registry already owns
(metrics, labels, warnings, AI framing, chart config), and the registry's
data-availability honesty model (`live | derived | reference | unavailable`) is bypassed,
so Portfolio has no way to say "I can't score that" — it says 50 instead (see 1.4).

### 1.2 Assets the Portfolio silently drops

| Asset | Where it lives today | What Portfolio does |
|---|---|---|
| Real estate | `manual_asset` table + `computeRealEstateMetrics()` | Invisible |
| Private markets | `manual_asset` + `computePrivateMarketMetrics()` | Invisible |
| Alternatives | `manual_asset` + `computeAlternativeMetrics()` | Invisible |
| Structured products | `manual_asset` + `computeStructuredProductMetrics()` | Invisible |
| Cash | *nothing* | Unrepresentable |

`lib/types.ts:1096` states the gap outright: *"Standalone from Portfolio's aggregate
analytics for now — its own ledger + research view inside the Research Hub."*

So a user with a house, an angel investment and $50k cash sees a "total portfolio value"
that is **none of those things**. Every downstream number — weights, concentration, health,
risk, scenarios — is computed against a denominator that excludes a large part of the
actual portfolio. This is the single most important correctness bug in the module.

`DEFAULT_CONSTRAINTS.minCashPct = 2` is a constraint on a quantity the data model cannot
express.

### 1.3 The storage schema is share-of-a-ticker shaped

```sql
portfolio     (symbol PK, name, shares, avg_cost, added_at)
portfolio_lot (id, symbol, name, shares, price, kind, fees, trade_date, created_at)
```

No `asset_class`. No `currency` (everything is implicitly USD; `avgCost` is even commented
`// per share, in USD`). No valuation source. No quantity unit — "shares" cannot express
1.4 BTC, a $10k bond at 98.5, 0.5 acres, or 12% of a company. `symbol` as PRIMARY KEY means
an asset without a ticker cannot be held.

### 1.4 Equity-only assumptions in the engine (`lib/portfolio-analytics.ts`, 1786 lines)

- **`PositionInput`** requires `FundamentalsSnapshot | FinancialStatements |
  AnalystConsensus` — all equity-only. Non-equities supply `null`, so
  `computeScore()` is skipped and `composite` **defaults to 50** — a fabricated neutral
  score that then flows into target weights, actions, and opportunity ranking as if it
  were measured. Bonds don't have a P/E; the system doesn't say so, it says 50.
- **Sector fallback**: `snapshot?.sector ?? (quote?.name?.includes("ETF") ? "ETF" : "Unknown")`.
  Bitcoin's sector becomes `"Unknown"`; a Treasury ETF's becomes `"ETF"`.
- **Health score** — 8 dimensions, 5 of which (Quality, Growth, Valuation, Financial Health,
  and partly Momentum) read `ScoreResult.buckets` and return the "Insufficient data → 50"
  branch for every non-equity. Income = dividend yield only (ignores coupons, rent,
  staking, T-bill yield). **No** allocation, liquidity, inflation-protection, currency,
  correlation, or cash-management dimension exists.
- **Gap analysis** = the 11 GICS sectors with hardcoded US large-cap tickers (`JNJ`, `JPM`,
  …). It cannot express "you own no bonds" — asset class is not a gap dimension.
- **Factor exposure** = `SECTOR_FACTOR_MAP`, keyed by GICS sector. Crypto/gold/bonds map to
  `{}` and contribute **nothing** — silently dropped from the factor picture.
- **Scenarios** — 5 hardcoded, `shocks[p.sector] ?? -20`:
  > **This produces wrong numbers, not missing ones.** In "2008 Financial Crisis", gold
  > gets −20% (actual: ~+5%), long Treasuries get −20% (actual: strongly positive), BTC
  > gets −20%. The default shock silently mis-prices every diversifying asset — precisely
  > the assets one holds *for* their crisis behaviour.
- **Risk** — vol/beta/Sharpe/VaR from daily closes only. No duration, credit, liquidity, or
  FX risk; no CVaR. Illiquid holdings have no history, so they're excluded from the vol
  computation **but still counted in the weights** → portfolio volatility is systematically
  understated. Beta is vs SPY regardless of what's held.
- **Target weights** — equal-weight ± a composite premium, capped at 18%. A stock-sizing
  heuristic, not an asset-allocation model.
- **New cash** (`computeCashAllocation`) can only route cash into *existing* holdings or the
  top-composite names. It structurally cannot say "add a Treasury ETF" or "hold it as cash".
- **Constraints / alerts / benchmark** — `maxSectorPct`, `requireDividend`,
  `marketCapFilter`; "Add defensive positions (Healthcare, Consumer Staples, Utilities)";
  SPY-only benchmark.

### 1.5 Duplicated logic and infrastructure the platform already owns

- **`/api/portfolio/analytics/route.ts` is a second, independent portfolio calculator** —
  its own totals, weights, sector allocation and concentration warnings, duplicating
  `computePortfolioReport()`. It can disagree with the engine: it divides return by
  `totalCost`, the engine divides by `totalCostWithPrices`.
- **`/api/portfolio/report/route.ts` holds a private in-memory cache** (`let cached`) —
  exactly what `CLAUDE.md` forbids: *"Never add a cache to a module."*
- Both routes hand-roll `Promise.all` fetch waterfalls, which `CLAUDE.md` also forbids
  (*"Declare a plan and let `runPlan()` handle order, concurrency, failure isolation"*).
- HHI is computed in more than one place; `lib/ios/fit-scorer.ts` is a parallel scoring path.

### 1.6 Scalability limits

Adding an asset class today means editing 8+ functions inside one 1786-line file.
`PortfolioReport` is a single monolithic all-or-nothing JSON. No incremental refresh, no
dedup, no cancellation.

---

## Phase 2 — Design

### 2.1 Principle

> **Asset classes plug metrics into shared engines. Engines never branch on asset class.**

Every `switch (assetClass)` in an engine is a design failure. Class-specific knowledge lives
in exactly one place: the class definition. Engines consume a *normalized* contract.

### 2.2 Do not invent a third taxonomy

Two already exist and both stay authoritative:

- `lib/asset-class.ts` → `AssetClass` — *what kind of instrument* (detection).
- `lib/assets/types.ts` → `AssetClassId` — *screening domain* (equity, etf, reit, crypto,
  commodity, bond, forex).
- `lib/types.ts` → `ManualAssetCategory` — real_estate, private_market, alternative,
  structured_product.

Portfolio's key space is their **union**, plus the one thing neither models:

```ts
type PortfolioAssetClass = AssetClassId | ManualAssetCategory | "cash";
// equity | etf | reit | crypto | commodity | bond | forex
//   | real_estate | private_market | alternative | structured_product
//   | cash
```

This covers all ten classes the mandate requires, reuses both existing registries, and adds
no competing concept.

### 2.3 Universal Holdings Model

The break with the current model: **quantity × price is one of four valuation strategies,
not the definition of a holding.**

```ts
type ValuationMode =
  | "market"   // qty × live price          (equity, etf, reit, crypto, commodity, bond fund)
  | "manual"   // user-stated current value (real estate, private, alternative)
  | "derived"  // computed from a model     (structured product; ownership% × valuation)
  | "cash";    // face value, optionally yielding

type Liquidity = "t0" | "t1" | "t2" | "illiquid";  // same-day | days | weeks | no market

interface Holding {
  id: string;
  assetClass: PortfolioAssetClass;
  symbol: string | null;          // null is legal — a house has no ticker
  name: string;
  currency: string;               // no longer implicitly USD
  quantity: number;
  unit: "shares" | "units" | "coins" | "contracts" | "face" | "currency" | "stake";
  costBasis: number;
  acquiredAt: string;

  valuation: {
    mode: ValuationMode;
    value: number;                // always in `currency`
    valueBase: number;            // always in base currency — the ONLY field engines sum
    source: DataSourceId | "user";
    asOf: string;
    stale: boolean;               // manual valuation older than the class's staleness bound
  };

  liquidity: Liquidity;
  income: { annual: number; yieldPct: number; kind: IncomeKind } | null;
  factors: FactorSensitivities;   // §2.5 — how this holding responds to macro shocks
  metrics: Record<string, number | null>;   // class-native, from the class adapter
  attributes: Record<string, string | null>;// sector, geography, credit rating, property type…
}
```

Engines only ever read `valueBase`, `liquidity`, `income`, `factors`, and `attributes`. That
is what makes them class-agnostic. `metrics` is for *display* and for the class's own
scoring contribution — never summed across classes.

**Manual valuation staleness is a first-class concept.** A house valued 3 years ago is not
the same input as a quote from 60 seconds ago. `stale` propagates into confidence, and a
stale holding never silently anchors a recommendation.

### 2.4 Class adapters — the single extension point

```
lib/portfolio/classes/<class>.ts   → PortfolioClassAdapter
```

```ts
interface PortfolioClassAdapter {
  id: PortfolioAssetClass;
  valuationMode: ValuationMode;
  defaultLiquidity: Liquidity;
  unit: Holding["unit"];

  /** Reuse lib/assets/registry.ts where that class exists there. Do not restate metrics. */
  registryClass: AssetClassId | null;

  value(h: RawHolding, ctx: MarketContext): Holding["valuation"];
  income(h: Holding, ctx: MarketContext): Holding["income"];
  factors(h: Holding): FactorSensitivities;
  metrics(h: Holding, ctx: MarketContext): Record<string, number | null>;

  /** 0-100 + confidence. MUST return confidence 0 rather than a fabricated 50. */
  score(h: Holding, ctx: MarketContext): { score: number; confidence: number; why: string[] } | null;

  row: { primary: MetricKey[]; secondary: MetricKey[] };  // drives the holdings UI
}
```

Adding an 11th asset class = one adapter file. No engine, route, or page changes.

**Confidence, not fabrication.** The `50`-default bug is fixed at the contract level:
`score()` returns `null` when the class has no basis to score, and every aggregate is
**confidence-weighted** — the same lesson already learned in
`project_uaa_fit_scorer_overhaul` ("everything scores 73") and in the screener's
percentile ranking. Unknown must read as unknown.

### 2.5 Factor-based risk & scenario engine — the core abstraction

This replaces `shocks[sector] ?? -20`, and it is the change that makes stress testing
correct rather than merely broader.

A **scenario** is not a list of sector shocks. It is a set of **macro factor shocks**:

```ts
type Factor =
  | "equityBeta"      // broad equity market
  | "rates"           // level of interest rates      → duration is the sensitivity
  | "creditSpread"    // IG/HY spread widening
  | "inflation"
  | "usd"             // dollar strength
  | "oil" | "gold"    // commodity complexes
  | "cryptoBeta"
  | "realEstateCap"   // cap-rate expansion
  | "liquidityStress";
```

Each holding exposes `FactorSensitivities` (∂value/∂factor), supplied by its class adapter:

| Class | Sensitivities |
|---|---|
| Equity | `equityBeta` (measured β), sector modifier, `inflation`/`oil` via sector |
| Bond fund | `rates` = **−duration** (real, from Yahoo `topHoldings.bondHoldings.duration`), `creditSpread` from the rating mix |
| Gold | `gold` ≈ 1, `inflation` +, `usd` −, `equityBeta` ≈ 0 |
| Crypto | `cryptoBeta` ≈ 1, `equityBeta` ≈ 0.4 (measured), `liquidityStress` high |
| Cash | ~all zero; `inflation` negative (purchasing power) — **cash is not riskless, it is inflation-exposed** |
| Real estate | `realEstateCap`, `rates` (via mortgage), `inflation` + |
| Private | `equityBeta` (levered, lagged), `liquidityStress` very high |

Impact = `Σ_f sensitivity[f] × shock[f]`, then dollar-weighted. **Every asset class reacts
appropriately to every scenario, by construction** — gold rises in the 2008 scenario because
its gold/inflation sensitivities are positive, not because someone remembered to add a
`Gold:` key to a lookup table.

It also gives, for free: the required scenario list (rate hikes/cuts, inflation, deflation,
equity crash, oil shock, housing crash, crypto winter, AI bubble, USD ±, China slowdown,
European recession, global recession, credit-spread widening) as *factor vectors*, and the
Risk Lab's factor exposure, duration, credit, FX and liquidity risk from the same numbers.

**Honesty rule:** sensitivities that are *measured* (equity β, bond duration) are marked
`live`; those from a curated table (gold↔USD) are `reference` with an `asOf`; anything else
is `unavailable` and excluded — never guessed. This follows the registry's existing
availability model rather than inventing one.

### 2.6 Universal health score

Reweighted around allocation, not stock-picking. Every dimension must be computable for a
100%-bond or 100%-cash portfolio, or it must abstain (and redistribute its weight — never
score 0, per the screener's ranking lesson).

`Asset Allocation · Diversification · Concentration · Risk · Liquidity · Income ·
Inflation protection · Currency diversification · Geographic diversification ·
Correlation · Expected drawdown · Cash management · Quality · Valuation · Growth · Momentum`

The last four are equity/credit-native and simply abstain where they don't apply, rather
than dragging the score to 50.

### 2.7 Folder structure

```
lib/portfolio/
  model/
    types.ts          Holding, ValuationMode, Liquidity, Factor, FactorSensitivities
    holding.ts        RawHolding → Holding normalization (the Universal Holdings Engine)
    registry.ts       PortfolioClassAdapter registry; bridges to lib/assets/registry.ts
  classes/
    equity.ts  etf.ts  reit.ts  bond.ts  crypto.ts  commodity.ts  forex.ts
    cash.ts  real-estate.ts  private-market.ts  alternative.ts  structured-product.ts
  engines/
    allocation.ts     by class / sector / geography / currency / liquidity / factor
    risk.ts           vol, β, Sharpe, VaR, CVaR, drawdown, duration, credit, FX, liquidity
    scenario.ts       factor-shock engine + the scenario library
    health.ts         universal health score
    recommend.ts      cross-asset recommendations (the Decision Center's source)
    optimize.ts       objectives + constraints + what-if
    cash.ts           new-cash allocation across all classes
    opportunity.ts    cross-asset opportunity detection
  context.ts          MarketContext assembly — via lib/platform/, never direct fetches

app/portfolio/        one page; tabs reorganized around Decision Center + allocation
```

`lib/portfolio-analytics.ts` is **not deleted**. Its pure math (`mean`, `stddev`, `pearson`,
`dailyReturns`, `maxDrawdown`, `computeRiskAdjustedRatios`) is already asset-agnostic and
already reused by `lib/crypto-scoring.ts` — it stays as the shared math leaf and is imported
by `engines/risk.ts`. Only the equity-shaped orchestration above it is replaced.

### 2.8 Reuse ledger (what is NOT rebuilt)

| Need | Reuse |
|---|---|
| Class metrics, warnings, AI framing | `lib/assets/registry.ts` (+ `can(id, "portfolio")`) |
| Fetching / caching / dedup / SWR | `lib/platform/` — `getDataset`, `runPlan` |
| Real estate / private / alt metrics | `lib/manual-asset-analysis.ts` (already written) |
| Manual asset ledger | `manual_asset` table (already populated) |
| AI routing | `runPrompt(taskType, …)` — never a model name |
| Lots, avg cost, realized P&L | `lib/portfolio-lots.ts` |
| XIRR, benchmark | `lib/portfolio-performance.ts` |
| Sector rotation evidence | `lib/ai-portfolio-manager.ts` |
| Fit scoring | `lib/ios/fit-scorer.ts` |
| Pure math | `lib/portfolio-analytics.ts` |

### 2.9 Backward compatibility

- Existing `portfolio` / `portfolio_lot` rows migrate to `assetClass: "equity"`,
  `unit: "shares"`, `currency: "USD"`, `valuation.mode: "market"` — the identity mapping.
  Their numbers must not move. A migration test asserts this.
- `computePortfolioReport()` keeps its signature as a thin adapter over the new engines
  during the transition so no caller breaks.
- Every existing equity workflow (holdings, rebalance, risk lab, CIO memo, export) keeps
  working.

---

## Phase 3 — Self-review of this design

Challenges raised against the design above, and the resolutions:

1. **"Does the factor model actually handle a portfolio with no market history?"**
   Yes — factor sensitivities are *declared* by the adapter, not estimated from returns.
   A house with no price series still has `rates`/`inflation`/`realEstateCap` exposure.
   Where β *is* measurable it is measured; where it isn't, the reference value is used and
   flagged. This is the whole reason the scenario engine is factor-based rather than
   history-based.

2. **"Illiquid assets have no return series — won't portfolio volatility still be
   understated?"** This is the trap the current engine falls into. Fix: illiquid holdings
   contribute *proxy* volatility from their factor loadings (a levered-equity proxy for
   private markets, a smoothed real-estate index proxy for property), and the Risk Lab
   reports **coverage** — "vol computed on 78% of portfolio value" — rather than silently
   pretending the other 22% is riskless. Understating risk is a correctness failure, not a
   presentation gap.

3. **"Correlation across classes needs a common return series."** Market-priced classes use
   real daily returns. Illiquid classes have no honest series — so they are **excluded from
   the correlation matrix and labelled as such**, not assigned a fabricated correlation of 0
   (which would read as "perfectly diversifying" — the most dangerous possible lie in a
   portfolio tool).

4. **"Does this fabricate data the free providers don't have?"** No. Per the asset-registry
   memory, bonds have no CUSIP feed (we hold bond *funds*, where duration and ratings are
   real), crypto TVL/staking is unavailable, REIT cap rate is unavailable, commodity
   inventories are unavailable. Those metrics stay `unavailable` and are surfaced as such.
   The Portfolio inherits the registry's honesty model rather than working around it.

5. **"Cash as a zero-risk asset?"** Explicitly rejected. Cash carries negative inflation
   sensitivity and its yield is real income. A 40%-cash portfolio should score *worse* on
   inflation protection, not neutral.

6. **"Is `PortfolioAssetClass` a third taxonomy after all?"** It is a type *alias for the
   union* of the two existing ones plus `"cash"` — no new class identities, no new
   detection path, no competing registry. Accepted.

---

---

## Phase 4-5 — Implementation & validation results

**Status: built, validated live.** Typecheck clean · eslint clean · 898 tests pass (24 new,
0 regressions) · production build succeeds · verified live against a real 6-class portfolio.

### Two real bugs the tests caught in the new model

Both were found by `tests/portfolio-universal.test.ts` before any of this shipped, and both
are worth remembering because they are subtle and would have silently produced wrong numbers.

**1. Factor double-counting.** The first version gave gold both `gold: 1.0` and `usd: -0.80`.
The 2008 scenario states `gold: +5` *and* `usd: +12` — but the +5% gold shock IS gold's move
*during* that dollar rally. Applying the `usd` loading on top charged gold for the same dollar
move twice and turned its real +5% crisis gain into a fictitious **−6.8% loss** — reintroducing,
in subtler form, the exact bug this engine exists to kill.

→ **The own-factor rule** (now documented in `classes/reference/factor-sensitivities.ts`): an
asset priced BY a complex loads on that complex's factor and NOT on the macro drivers behind
it. Consequence: inflation sensitivity can no longer be read off the raw `inflation` exposure
(gold has none), so it is **measured** by running a standardized `INFLATION_1PP` shock vector
through the same engine — see `engines/scenario.ts`.

**2. Noise-derived beta overriding a real one.** `measuredBeta()` regressed two barely-related
series, got β≈0, and overrode the provider's real β of 1.25 — so a −50% equity shock did
nothing to the equity. A short or illiquid history would do the same in production, silently
reporting a portfolio as hedged when it is not.

→ `measuredBeta()` now gates on **R² ≥ 0.10** and returns `null` below it, falling back to the
provider's beta and then the class reference. *"I couldn't measure it" must never be reported
as "it measured zero."*

### Live verification (real Yahoo data, 6 asset classes)

Every class analysed as itself: bond → duration/maturity/expense (not P/E); crypto →
confidence-capped at 55% (no on-chain feed); cash → scored on yield, income kind `interest`;
equity → P/E, P/B, ROE. Factor exposure showed **interest rates −0.86** and **gold +0.17**
where the old engine showed exactly zero for both.

**The central claim, on live data — 2008 Financial Crisis scenario:**

| Holding | New engine | Old engine |
|---|---|---|
| IEF (7-10y Treasuries) | **+9.4%** | −20% |
| GLD (gold) | **+5.3%** | −20% |
| USD cash | **+0.1%** | −20% |
| AAPL | −40.7% | −53% (sector table) |
| BTC-USD | −90.6% | −20% |

Scenario coverage 100%. New-cash allocation on a tech-heavy portfolio recommended **SHY, TIP,
DBC** — bond and commodity exposures the portfolio lacked; the old engine could only ever have
said "buy more of what you already own."

---

## Remaining technical debt (honest)

1. **`lib/portfolio-analytics.ts` still exists and still has consumers.** Its pure math (`mean`,
   `stddev`, `pearson`, `maxDrawdown`, `computeRiskAdjustedRatios`) is asset-agnostic, is reused
   by `engines/risk.ts` and `lib/crypto-scoring.ts`, and should stay. But its *equity-shaped
   orchestration* (`computePortfolioReport`, the GICS scenario table, `SECTOR_FACTOR_MAP`) is now
   dead weight for Portfolio while still being imported by `/api/dashboard`, `lib/ios/*`,
   `app/research/_components/portfolio-decision-card.tsx` and `/api/portfolio/new-positions`.
   **Those consumers must be migrated to the universal report and the legacy orchestration
   deleted** — until then two portfolio engines coexist, which is exactly what §2.8 forbids.
   This is the single biggest remaining item.

2. **`manual_asset` has no currency column.** Manually-valued holdings are assumed USD in
   `store.ts`. Correct today (that is how the values were entered), wrong the moment someone
   records a property abroad.

3. **Old Portfolio components are orphaned, not deleted.** `_components/{brief,actions,risk-lab,
   holdings}-tab.tsx`, `cio-panel`, `rebalance-panel`, `new-positions-panel`, etc. are no longer
   reachable from `page.tsx`. They should be removed once (1) is done — several still power the
   CIO memo and daily brief, which have not yet been ported.

4. **`/api/portfolio/new-positions` and `/api/portfolio/audit` still run on the old engine**, so
   the AI CIO memo still reasons over an equity-only report. Porting them is what makes
   requirement #4 (AI portfolio intelligence) fully universal — the deterministic layer beneath
   it already is.

5. **Factor sensitivities are reference data and go stale.** `FACTOR_SENSITIVITIES_AS_OF =
   2026-07-12`. Regime changes (e.g. the 2022 breakdown of the stock/bond correlation) invalidate
   them. Same maintenance discipline as `lib/assets/reference/policy-rates.ts`.

6. **Objective target allocations are conventional, not optimizer output.** We do not have the
   return/covariance estimates a true mean-variance optimizer needs, and running an MVO on 90
   days of noisy history produces confident nonsense. Stated openly in `engines/optimize.ts`.

## Limitations by asset class (inherited from the provider reality)

Unchanged from `lib/assets/` — we surface these, never fabricate around them: individual CUSIP
bonds have no feed (we hold bond *funds*, where duration and ratings are real); crypto TVL /
staking / on-chain metrics are unavailable; REIT cap rate / occupancy / same-store NOI are
unavailable (P/FFO is an OCF proxy, null for mortgage REITs); commodity inventories are
unavailable. Manual classes rest on self-reported marks and are confidence-discounted and
staleness-flagged accordingly.
