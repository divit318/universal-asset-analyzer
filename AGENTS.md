# AGENTS.md: AI Coding Agent Rules for UAA

Quick reference for AI agents (Claude Code, standalone agents, etc.) working on Universal Asset Analyzer.

Read this before reading CLAUDE.md, ARCHITECTURE.md, or PROJECT_ROADMAP.md.

---

## Mandatory Rules

### 1. Use Serena for File Location
- **NEVER** grep/bash search for symbols
- Always: `/serena find_symbol "function_name"` to locate definitions
- Always: `/serena find_implementations "class_name"` to find variants
- Always: `/serena find_referencing_symbols "symbol"` to find usage
- Saves: 40% token usage (fewer files to read)

### 2. Use Graphify for Dependencies
- Before modifying a module: `/graphify "[module_name] dependencies"`
- Before adding a feature: `/graphify "[module_name] interactions"`
- Shows affected modules without reading 10+ files
- Saves: 50% token usage on feature work

### 3. Read Docs Before Code
- **ARCHITECTURE.md** → module interactions, inputs/outputs, caching strategy
- **PROJECT_ROADMAP.md** → what's complete, what's planned, priorities
- **CLAUDE.md** → development workflow, patterns, conventions
- Only then read source code (3-5 files max)
- Saves: 70% token usage on typical tasks

### 4. Reuse, Never Duplicate
- Scoring logic → `lib/composite.ts` only
- Signal detection → `lib/event-screener.ts` only
- Portfolio math → `lib/portfolio-analytics.ts` only
- DB operations → `lib/db.ts` CRUD functions only
- Format utilities → `lib/format.ts` only
- If logic exists, call it. Don't copy-paste.

### 5. Prefer Existing Over New
- Check `lib/` for similar engines before creating new modules
- Extend existing modules unless there's a distinct user workflow
- Ask: "Can I add this to an existing `lib/` file?" before creating a new one

### 6. Read Only Minimum Files
- Use Serena to find exact locations
- Read only the function/interface you need
- Don't read entire files; skim to target
- Typical task: 3-5 files, 10-15k tokens

---

## Architecture at a Glance

**Layers**:
- **Pages** (`app/*/page.tsx`) — Fetch data, render
- **API Routes** (`app/api/*/route.ts`) — Validate input, call domain logic
- **Domain Logic** (`lib/*.ts`) — Pure functions, testable, reusable
- **Components** (`app/_components/` or `app/[module]/_components/`) — UI, interactive
- **State** (`lib/db.ts`) — SQLite persistence, CRUD operations

**Key Files**:
- `lib/composite.ts` — batch dimensional scorer (Screener). `lib/scoring.ts` —
  single-name decision engine. Two engines by design; the shared score→recommendation
  bands/labels/tones live in `lib/recommendation.ts` (single source of truth).
- `lib/fundamental-screener.ts` — Filtering + caching. Use for screening workflows.
- `lib/event-screener.ts` — Signals. Use for event-driven workflows.
- `lib/thematic-engine.ts` — 10-stage thematic analysis framework.
- `lib/ic-agents.ts` — 9-domain multi-agent pipeline. Use for institutional research.
- `lib/ic/` — IC Report platform (2026-08-02 hardening): `canonical.ts` is the
  validated, provenance-carrying data object every IC stage reads from;
  `valuation-engine.ts`/`valuation-suite.ts` compute every valuation figure
  deterministically (the model proposes inputs only, validated in
  `valuation-inputs.ts`); `format.ts` is the ONLY formatter for IC surfaces
  (INR lakh/crore aware, pp-vs-% branded types). Harness:
  `npx tsx scripts/ic-report-harness.ts` (add `--llm` for full model runs).
  Full map + decision log: `docs/ic-report/00-map.md`, `docs/ic-report/99-report.md`.
- `lib/db.ts` — All SQLite operations. All reads/writes go here.
- `lib/ollama.ts` — Local LLM inference. Never external APIs.

**Caching**:
- Fundamentals: 24h TTL in SQLite (refreshed on screener load)
- Prices: Always fresh (no cache)
- Filings: Cached by CIK internally
- Parquet: Daily output from quant engine (read-only)

**Error Handling**:
- API failures: Non-fatal. Return partial data + error message.
- EDGAR/news/analyst data: Optional. UI renders without them.
- Ollama offline: Fallback UI message, no crash.

---

## Before You Code

**Checklist**:
1. Read ARCHITECTURE.md section for your module
2. Run `/graphify "[module] dependencies"` to see what you'll affect
3. Use `/serena find_symbol "similar_function"` to find existing patterns
4. Check if similar logic already exists in `lib/`
5. Plan: 5 min docs + 5 min graphify = 30 min saved reading code

**Typical Workflows**:

**Add a metric to screener**:
1. Read: ARCHITECTURE.md "Composite Scorer" section
2. Graphify: `/graphify "composite dependencies"`
3. Serena: `/serena find_implementations "scoreAsset"`
4. Modify: `lib/composite.ts` (add formula)
5. Test: `tests/composite.test.ts` (add test case)

**Add an API endpoint**:
1. Read: ARCHITECTURE.md "API Routes" pattern
2. Graphify: `/graphify "[domain] interactions"`
3. Serena: `/serena find_implementations "POST route"`
4. Create: `app/api/[domain]/route.ts` (validate, call lib, return JSON)
5. No need to create new lib files; call existing functions

**Add a feature to existing module**:
1. Read: ARCHITECTURE.md section for the module
2. Serena: `/serena find_symbol "[module]Page"` to locate the page
3. Check: Does `lib/` already have the logic? If yes, call it. If no, add to existing lib file.
4. Implement: Add page component, subcomponent, update lib function
5. Graphify: Verify dependencies haven't exploded

**Create a new module**:
1. Read: ARCHITECTURE.md "Adding a New Feature" section
2. Graphify: `/graphify "[new module] impacts"` (to see what it depends on)
3. Ask: Is this a distinct user workflow? If no, extend existing module instead.
4. Plan: Domain logic → API route → page → components → tests
5. Update: ARCHITECTURE.md + PROJECT_ROADMAP.md when done

---

## Token Budgets

**Typical Tasks**:
- Bug fix: 5-10k tokens (Serena locate, fix, verify)
- Add metric: 8-15k tokens (modify lib, add test, update UI)
- Add API endpoint: 10-15k tokens (create route, call lib, test)
- New feature (small): 15-25k tokens (plan, implement, test)
- New module: 30-50k tokens (full workflow, docs)

**How to Save Tokens**:
- Serena locate: -20% (vs. bash grep)
- Graphify dependency check: -30% (vs. reading files)
- Read docs first: -50% (vs. source code)
- Reuse existing logic: -40% (vs. understanding + reimplementing)

---

## Code Patterns (Copy-Paste)

**API Route Template**:
```typescript
// app/api/[module]/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  try {
    const data = await getDataFromLib(symbol);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**Parallel Fetching**:
```typescript
const [quote, history, filings, news] = await Promise.all([
  getQuote(symbol),
  getHistory(symbol, 1825),
  getRecentFilings(symbol),
  getCompanyNews(symbol, 8),
]);
```

**Domain Logic Pattern**:
```typescript
// lib/[module].ts — Pure, testable, no side effects
export function computeScore(data: InputType): OutputType {
  // No imports from pages or components
  // No database calls
  // No external API calls
  // Pure function: same input → same output
  return result;
}
```

**Component Pattern**:
```typescript
// app/[module]/_components/[name].tsx
'use client'; // only if interactive

export function MyComponent({ data, onSubmit }: Props) {
  const [state, setState] = useState(data);
  // Component is dumb: data in, callbacks out
  return <div>...</div>;
}
```

---

## Critical Mistakes

| Mistake | Why | Fix |
|---------|-----|-----|
| Direct DB calls in page | Multiple sources of truth | Use `lib/db.ts` CRUD |
| Import ExcelJS in client | Server-only package | Use `/api/export` route |
| Duplicate scoring logic | Maintenance nightmare | Call `lib/composite.ts` |
| Serial API calls | 3-4x slower | Use `Promise.all()` |
| No null checks | Crashes on missing data | Check before operations |
| Comments explaining code | Wastes tokens | Well-named functions instead |
| Creating new module for minor feature | Bloats codebase | Extend existing instead |
| Ignoring errors in streaming | Silent failures | Try/catch, enqueue error |
| Global imports of data sources | Tight coupling | Inject dependencies as args |

---

## When to Read What

| Goal | Read First | Then Read | Finally |
|------|-----------|-----------|---------|
| Fix a bug | CLAUDE.md workflow | ARCHITECTURE.md module section | Source files (Serena) |
| Add metric | ARCHITECTURE.md "Composite Scorer" | `lib/composite.ts` (Serena) | `tests/composite.test.ts` |
| Add API endpoint | ARCHITECTURE.md "API Routes" | Similar route (Serena) | Implementation |
| Understand interactions | PROJECT_ROADMAP.md | ARCHITECTURE.md "Interaction Map" | `/graphify [module]` |
| Plan new feature | PROJECT_ROADMAP.md priorities | ARCHITECTURE.md "Adding Feature" | Design doc (create) |
| Debug state issue | ARCHITECTURE.md "State Management" | `lib/db.ts` (Serena) | Source files |

---

## Tools You Have

| Tool | Use Case | Command |
|------|----------|---------|
| **Serena** | Locate symbol/function/file | `/serena find_symbol "name"` |
| **Graphify** | Understand dependencies | `/graphify "[module] dependencies"` |
| **Read** | Read entire file | Use when you know exact path |
| **Edit** | Modify file | Use after reading first |
| **Bash** | Run tests, git commands | `npm test`, `git log` |
| **Agent** | Delegate research/search | Rarely needed (Serena better) |

---

## Fast vs. Slow Agent Workflows

**Slow** (80-120k tokens):
1. Read all CLAUDE.md
2. Read all ARCHITECTURE.md
3. Grep for similar patterns
4. Read 10+ source files
5. Try, fail, re-read

**Fast** (15-30k tokens):
1. Read AGENTS.md (this file)
2. Run Serena to locate files
3. Run Graphify to check dependencies
4. Read ARCHITECTURE.md section
5. Read 3 files (Serena pointed out)
6. Implement confidently

**Difference**: Structured tool usage saves 70% tokens.

---

## Next Steps

- **First task?** Read CLAUDE.md "Development Workflow" section
- **New feature?** Read PROJECT_ROADMAP.md for context
- **Stuck?** Check ARCHITECTURE.md for the module you're working on
- **Implementing?** Use Serena + Graphify before reading code

---

## Verification Commands

Run these before considering any change complete:

```bash
npx tsc --noEmit          # must be silent
npx vitest run            # 1715 tests as of the 2026-07-28 watchlist Phase 2 audit
npx eslint app lib        # see "known pre-existing" below
npm run build             # catches Server/Client boundary errors tsc misses
```

**Known pre-existing lint issues** (do not "fix" as a drive-by, and do not treat
as a regression you caused):
- `app/_home/_atmosphere/use-count-up.ts:34` — setState-in-effect error
- `app/_home/modules/todays-brief.tsx:31` — unused `definition` warning

For UI work, verify in the browser (Playwright MCP) as well. `tsc` passes on JSX
that Turbopack cannot parse, so a green typecheck is **not** proof the page
renders — `npm run build` or a real page load is.

---

## Shipped-But-Unwired: Check Before You Build

The single most common finding of the 2026-07-27 product audit was **fully-built,
fully-documented infrastructure with zero callers**. Before implementing anything,
grep for it — it is often already there:

| What existed | Who was using it | Impact once wired |
|---|---|---|
| `/api/ai/report` streaming route | nobody | 103s → 28s to first content |
| `aiVerdict` cache policy in `lib/platform/registry.ts` | nobody | 115.3s → 0.04s on a repeat view |
| Scanner's staged progress UI | only the Scanner | reused as `<TaskProgress>` |
| `watchlist.stage` (§4.5) + `/api/pipeline` | only the Portfolio board | Watchlist — where the decision is actually made — got a Stage column |
| `PortfolioFitAnalysis.dimensions` / `.reasons` / `.confidence` | Research + Compare | answered "why is this an 83?" on the Watchlist with zero new backend |
| `Quote.fiftyTwoWeekHigh` / `Low` | the CSV export only | "From high" column + a range bar with the target plotted on it |
| `DataTable`'s `onDensityChange` | nobody (density reset every visit) | persisted view state |

`lib/platform/data-layer.ts` claims "Nothing bypasses it. Not … AI generation
itself." AI generation was the one thing that did. **Treat doc comments as intent,
not as fact** — verify against the call graph.

---

## Product Rules Learned The Hard Way

**Never let the local model derive a directional verdict.** Given the numbers and
asked for judgement, a 7B model asserted "USD Cash is fully hedged against
inflation" (health had scored Inflation 32/100 for the opposite reason), read 11.3
effective drivers as "a small number of holdings" (it means BROAD), and called
VCLT a large-cap equity ETF (the prompt had labelled it "(Bonds)"). A model that
contradicts the panel rendered beside it destroys the credibility of the panel too.
Compute every directional conclusion in code and hand it over as settled fact — see
the `ESTABLISHED CONCLUSIONS` block in `lib/portfolio/thesis.ts`. Label contributor
lists with their own direction ("POSITIONS THAT ADDED TO RETURN"), because neutral
headings let it file the top carrier under risks. Leave the model the job it is good
at: noticing that several settled facts combine into something.

**Label AI output as interpretation.** When everything else on a page is arithmetic,
visual consistency implies the AI card carries the same authority. Say which panel
is measured and which is interpreted, and which wins when they disagree.

**Rank a scorecard by severity, or it argues against itself.** Twelve health
dimensions rendered in declaration order produced ten green bars and two amber ones
— reading as "everything is fine" when two dimensions were genuinely poor and sat
fifth and sixth. Triage into needs-attention / adequate / strong, weakest first, and
collapse the strong ones: "this is fine" is worth one line, not five.

**Order sections by the question each answers, not by data model.** The Dashboard
opened on five allocation breakdowns — a quarterly question — and put the health
weaknesses at the bottom of a long scroll, with no answer to "what changed" anywhere
on the page. An investor opening their portfolio is asking what to do today.

**A percentage return needs a period, and the period must be cost-weighted.**
"+0.2%" is excellent over a week and dismal over six years. `min(acquiredAt)`
reported "+0.2% over 6.7y" for a book whose capital went in 17 days ago, because one
$600 collectible from 2019 set the window. Weight each holding's age by its cost.

**Never plot portfolio value as performance.** It rises when you deposit money — in
the real ledger it went $510k → $9.26M in one step. Health and concentration are
contribution-invariant and are the honest trend lines.

**Rank by contribution, not by P&L or by percent.** A +180% gain on a 0.4% position
and a −12% loss on a 30% position are a triumph and a scratch by percent, and
invisible by dollars against a large book. And the number that turns a return into a
judgement is how CONCENTRATED its sources are: `top3SharePct` /
`effectiveDrivers` in `engines/attribution.ts`. Any decomposition must be additive
against the same denominator as the headline, and `attributionResidual()` exists so
that can be asserted rather than trusted.

**Grade your own recommendations.** `portfolio_snapshot` had been capturing health
and allocation either side of every execution since the Transaction Engine shipped —
47 rows — read by nothing but the undo button. It showed the most recent rebalance
took health 78 → 75 while lifting the largest asset class 44% → 50.7%. An engine that
issues advice and never reports its own misses is a suggestion box.

**Qualify every score with the question it answers — including duplicates of the
same statistic.** The Risk Lab's position-level HHI read 689 ("Low") beside the
allocation panel's asset-class HHI of 3440, both labelled "HHI", both correct, on one
page. Also: `view.dimension` is a camelCase identifier, not a UI label.

**One figure, one direction — and enforce it in code, not only in the prompt.** The
thesis card sold a single measured number as reassuring on the left and alarming on
the right: Working said "the 3 biggest movers accounted for 49% of all movement …
suggesting diversification", Watch said "the top 3 movers accounted for nearly half
… heavily influenced by a small number of positions". Both readings are defensible
for a middle-band 49%, which is exactly the problem — an unassigned figure is an
invitation to spin, and a card that argues with itself is worth less than either
half alone. `groundTruthVerdicts()` in `lib/portfolio/thesis.ts` now tags every
verdict `STRENGTH` / `RISK` / `NEUTRAL`, and `resolveSectionConflicts()` prunes the
losing bullet when both columns discuss one subject. Two things that matter: match
on SUBJECT, not on digits (the contradictory pair shared no number at all — "49%"
vs "nearly half"), and on a `neutral` figure drop the FLATTERING side, because a
card one bullet shorter beats a card that flatters. Bump the cache version prefix
whenever what a cached entry MEANS changes, not just its shape — the key is a
content hash of the holdings, so an unchanged portfolio serves the old card forever.

**Never let a model discover what a form could have asked.** The Simulator's intake
promised "the AI asks only the follow-ups it actually needs". It asked ONE
open-ended question — "what is your preferred approach to asset allocation, a
globally diversified 60/40 split, or a preference for regional or sector-specific
tilts?" — the user skipped it rather than compose prose about portfolio
construction, and the book was designed on a guessed default. Measured: 25-195
SECONDS per turn, and `estimatedRemaining` returned `3` on every turn regardless of
history, so "Question 1 of ~2" was never a plan. Almost every topic in that
interview's brief (liquidity, income, tax, exclusions, geography, concentration,
rebalancing, instrument breadth) is answerable up front from a list. They are now
fixed MCQs in `lib/portfolio/simulator/preferences.ts`; the interview keeps only
what a form cannot ask — contradictions BETWEEN answers, which do not exist until
the answers do — and those are detected deterministically by `profileGaps()` with
question text and options written in code. A contradiction now surfaces in 0.0s
instead of 194s. **Make every question multiple choice with a persistent "Other".**
Recognising your view in a list is a far lower bar than writing it, and free text is
what makes a question skippable. Keep the skip-with-stated-assumption pattern: good
options make skipping unnecessary, not impossible.

**Type the parameter, or a contradiction detector fails silently open.** The first
draft of `profileGaps()` took `objective: string` and was written against invented
ids (`max_income`, `min_volatility`, `max_return`) that do not exist in
`OBJECTIVES`. Every check referencing one silently never fired — the worst possible
failure mode for a conflict detector, because it reports a clean profile. `tsc`
caught it only once a test passed a typed value. Any function branching on an id
from a union must take that union.

**Read a large number back in words.** `100000000` and `10000000` are one keystroke
and one order of magnitude apart and neither is legible in a number input. The
intake form now echoes "$100,000,000 · 100 million" live. A Cancel button on the
multi-minute generation is the safety net; the echo is the fix.

**A native `<input type="date">` renders in the BROWSER's locale, not the app's.**
It is not reachable from CSS or JS — no attribute, no pseudo-element, no override.
So `dd/mm/yyyy` appeared in the Simulator while `formatDate` showed `Jul 30, 2026`
two tabs away, making `05/07/2026` genuinely ambiguous. Rather than rebuild the
control, `app/_components/ui/date-input.tsx` keeps the native picker for entry and
echoes the resolved date through the same `formatDate` everything else uses. Use
`DateInput`, never a bare `type="date"`.

**Name every stage of a long job, including the ones not reached yet.** Generation
showed one bar captioned "Designing the asset-class allocation…" — accurate, and
still misleading, because it is stage one of five and for minutes it looks like the
whole job. `TaskProgress` now takes `stepLayout="checklist"`; default stays `strip`
so the Scanner is untouched. And any wait a user can be tempted to abandon needs an
elapsed clock AND a server-side `timeoutMs`: the intake turn had neither, which is
how a 195-second wait sat next to a prominent "Finish now — use defaults".

---

## Correctness Rules Learned The Hard Way

**A filtered list of instructions must state what the filter removed.** The
Optimize tab's sixteen rebalancing trades bought $1.95M and sold $1.71M, and
nothing explained the $242k gap — so it read exactly like a sizing bug. It was not:
`optimize()`'s invariant (target changes sum to zero across EVERY holding) was
exact to the cent, and the difference was four sub-`MATERIAL_WEIGHT_DELTA_PCT`
trims filtered out of the list plus the cash row, which is never listed. Both
legitimate, neither disclosed. The fix is never to re-size the trades (that breaks
idempotence and the "target weight IS the execution instruction" property) — it is
`computePlanFunding()` + `PlanFundingDisclosure`, rendered unconditionally by
`<FundingSummary>`, including when the plan balances, because "fully self-funded"
is precisely the fact a reader cannot verify by adding up the column. If you filter
rows out of a list the user acts on, the residual is a number you now owe them.

**A cap that silently absorbs an overflow is a value-fabrication bug.**
`cashBalancingLot()` correctly refused to write negative cash — it drew
`min(needed, available)` — but said nothing when `needed > available`, so the excess
buys still hit the ledger and tracked portfolio value grew out of nothing. Any
`Math.min(want, have)` on money needs a matching `unfundedAmount()` the caller must
surface. Clamping is the right arithmetic and the wrong ending.

**One predicate per question, and the optimizer asks the same questions the risk
engine does.** `optimize()` froze holdings on `liquidity === "illiquid"` while the
Risk Lab and the Holdings badge used `isIlliquid()` (which also counts `t2`). A
structured product was therefore badged ILLIQUID, counted illiquid, and cheerfully
proposed for sale in a same-day rebalance. `describeIlliquidWeight()` now owns the
WORDING as well, so the Risk Lab card and the Optimize banner cannot be re-worded
independently.

**A materiality threshold on a trade is not a materiality threshold on a label.**
The class-target rows suppressed their "(−0.1)" delta annotation below 1pp, so
Forex (0.1% → 0.0%) and Cash (13.6% → 13.0%) rendered identically to Alternatives /
Private Markets / Real Estate, which genuinely do not move. `delta` is already
rounded to a tenth by the engine, so `delta !== 0` is the honest test: cheap to
render, and the only version that distinguishes "too small to trade" from "did not
change".

**A toggle's appearance must be derived from state, never from the last click.**
"Select All" was the one `secondary`-variant button in a row of `ghost` ones, so it
rendered permanently in the pressed style — next to "0 of 16 trades selected" and
sixteen empty checkboxes. Compute each bulk action's candidate set ONCE
(`candidates` in `use-trade-selection.ts`) and use it for both performing the
action and deciding whether the button is active, so "active" can only ever mean
"true".

**Never coerce a missing price to zero.** `positionPerformance(lots, price ?? 0)`
valued every position without a live quote at zero against its full cost basis —
i.e. reported it as a total loss. It fired on the most ordinary holding there is:
cash is stored as a synthetic `CASH-USD` lot and no provider quotes a synthetic
ticker, so a real $9.28M book reported −$1,228,679 of P&L on a page whose headline
read +$14,920, and told the user they were $1.22M behind SPY. Exclude and disclose
(`unpricedSymbols`); never fabricate a value. Same rule as "unknown must read as
unknown" — a `?? 0` on a price is the most expensive form of that mistake.

**Never dispersion-of-losses where you mean shortfall-from-target.**
`stddev(returns.filter(r => r < mar))` measures how much the losses differ from
EACH OTHER, and collapses to ~0 exactly when losses are consistent. As a Sortino
denominator it produced 4.25e14 on a portfolio steadily losing money, and
overstated a normal series' Sortino by 64%. Use `downsideDeviation()` — shortfall
from the MAR, summed over ALL N periods.

**Resolve a classification ONCE, at the boundary, and let every engine read the
resolved value.** Two answers to "what is this instrument?" is not a labelling
problem, it is a contradictory-advice problem: the risk models classified VCLT from
what the fund holds (a long corporate bond fund) while Allocation, Health and the
optimizer read the `asset_class` column (Yahoo's quoteType, `etf`), so one plan
said "SELL VCLT — ETFs overweight" and "BUY SHY/TIP/IEF — Bonds underweight". The
fix is not reconciliation: `Holding.assetClass` is now RESOLVED in
`normalizeHoldings()` by the same authority that produces the factor loadings
(`resolveAssetClass`), the stored column is an input hint, and no engine derives a
class of its own. Declaring the class on each risk model makes the mapping
exhaustive at compile time. **One safety rule when re-bucketing: never cross a
VALUATION REGIME** — the class also picks the adapter that VALUES the holding, so a
gold bar booked as an `alternative` keeps its manual mark and only its factor
loadings change.

**The wrapper is not the risk — classify on what an instrument HOLDS, and never on
the PRESENCE of a provider field.** `if (fundamentals.duration != null) treat as a
bond fund` modelled VXUS (an international equity ETF) as a bond and VCLT (a
long-dated corporate bond ETF) as a generic equity fund, because Yahoo returns
`bondHoldings.duration` for VXUS and omits it for VCLT. Everything bought through
the normal flow arrives as `quoteType: ETF` — GLD, SCHH, BIL, a money-market fund —
so the stored asset class cannot carry the risk model either. Classify from
`fundProfile.categoryName` (Morningstar; present for 47/47 funds probed),
corroborate with the position mix, and keep it in ONE catalogue
(`lib/portfolio/classes/reference/risk-models.ts`).

**Yahoo's `bondHoldings.duration` / `.maturity` are not effective duration or
average maturity.** Measured 2026-07-29: TLT 3.55 (true ≈ 16), USFR 3.88 (a
floating-rate fund, true ≈ 0.02), TIP 1.30 (true ≈ 6.5), VXUS 4.48 (an equity
fund), VCLT absent. `bondRatings` buckets overlap and don't partition (BND sums to
~152%; equity ETFs return a ratings object); `sectorWeightings` is degenerate for
non-equity funds (HYG → "utilities 99.6%" off a 0.84% cash sweep);
`quoteType.legalType`, `summaryDetail.category` and `morningStarRiskRating` were
null for all 61 symbols probed. Regress the fund's own returns on ^TNX yield
changes instead — that is a measurement OF the instrument.

**A plausibility band may only overrule a measurement when the classification
itself is confirmed.** SHY's category lookup missed on one render, the model fell
back to the generic 6.0-year bucket, and its narrow band rejected the fund's own
measured 1.65 years — so the Holdings tab showed 6.0y for a 1-3 year Treasury fund,
and the number moved between page loads. Carry a confidence on the classification
and widen the band to what is physically possible on the fallback path.

**Compose sensitivities in LOG space, not by adding simple returns.** A factor
sensitivity (beta, duration, credit beta, cap-rate beta) is a derivative of LOG
price, so `Σ sensitivity × shock` read as a simple return is unbounded below: TSM's
measured beta of 2.14 against the 2008 scenario's −50% equity shock summed to
−105.2%, i.e. a long-only unlevered position losing more than it owns, and the
−100% floor then published that as a confident total wipeout. Sum
`sensitivity × ln(1 + shock)` for the elasticity factors and `sensitivity × shock`
for the per-pp ones, then `expm1()` back — bounded above −100% by construction,
exact at beta 1.0, and indistinguishable from the linear model at ordinary shock
sizes. **A clamp that actually binds in production is a bug report about the model
underneath it**, not a fix; likewise a "≤" prefix rendered next to it.

**Zero-check a variance against an epsilon, not `> 0`.** Summing 252 copies of
0.001 leaves ~1e-19 of float residue, so a numerically-constant series had
`stddev() > 0` and reported a Sharpe of 2.0e16.

**Align return series by DATE, never by array index.** `MarketContext.history`
discarded dates, so cross-holding statistics had to guess: `computeRisk` tail-
aligned while `computeCorrelation` handed unequal arrays to `pearson()`, which
truncates to the shorter and reads from index 0 — correlating each series' OLDEST
observations, i.e. two different calendar periods. A fixed 400-CALENDAR-day window
yields ~275 observations for an equity and ~400 for crypto, so the most
interesting pair in a multi-asset book was always the most wrong. Use
`lib/portfolio/engines/series.ts` (`datedReturns` / `alignReturns` / `alignPair`).

**A coverage disclosure must be gated on the coverage, not on one of its causes.**
The Risk Lab's "measured on X% of value" warning was gated on `proxiedPct > 0`,
and proxy volatility only exists for the manually-valued classes — so a
market-priced holding whose history simply failed to arrive was excluded from
every statistic and disclosed nowhere. Gate on `observedPct < 100`.

**A part-to-whole chart whose parts don't sum to the whole.** `groupBy` routes
unclassifiable value into `unclassifiedPct` and creates no slice, so a sector bar
for a book that is 45% bonds/crypto/cash rendered 55% full and 45% empty track —
reading as "no data" rather than "this 45% has no sector". Draw the remainder as a
labelled segment. Note also that HHI computed over the classified slices uses
weights that are shares of TOTAL value, so a large unclassified share makes the
dimension look MORE diversified than it is.

**A preview must not compute its numbers differently from the executor.** The cash
plan displayed `Math.floor(amount / price)` while `buildCashDepositLots()` wrote
`amount / price`, so "$1,000 · 3 sh" described $903 and a $1,000 allocation to BTC
read "0 sh".

**Backticks inside the SQL comments in `lib/db.ts` terminate the template
literal.** ``/* the `headline` column */`` inside ``db.exec(`…`)`` is a build-
breaking syntax error that reads as perfectly ordinary prose. Use plain words in
that block. (Twice in one day.)

**Never infer a unit from a value's magnitude.** `Math.abs(v) <= 1 ? v*100 : v`
rendered AAPL's 1.4147 ROE as "1.41%" — 100x low on exactly the values an analyst
most wants to see. Declare units per metric key (see `METRIC_UNITS` in
`app/portfolio/_components/universal/holdings-panel.tsx`).

**One threshold, one comparison operator, one module.** `lib/alerts.ts` fired a
watchlist price target on `price <= target` (a buy limit) while
`app/watchlist/page.tsx` and `app/api/export/watchlist` fired on `price >= target`
(a valuation target) — three implementations of one rule, two of them
contradictory, each pinned by its own passing test. For every target a user had
set, exactly one surface was firing permanently: the CSV exported INCY
("buy at $20", trading at $118) as **TARGET REACHED**. A threshold whose meaning
depends on the reader's intent must **store** that intent (`watchlist.target_direction`),
never re-derive it — once the price crosses an `above` target, `target < price`
is indistinguishable from an un-hit `below` target, so any price-based inference
silently stops firing the moment it becomes true. Shared math now lives in
`lib/watchlist-metrics.ts`; `runMonitor` backfills legacy rows because it is the
only caller holding both live prices and the database.

**Upside is `(target − price) / price`, positive green.** Used by the analyst
card, `/dcf`, `/compare`, `/ic-report` and `/watchlist`. The watchlist previously
computed `(price − target) / target` and coloured negatives green, so a name 23%
below its target read as a green "−18.86%" — wrong sign, wrong denominator, wrong
colour. Pinned in `tests/watchlist-metrics.test.ts`.

**`Number.isNaN` is not a finite check.** Every guard in `lib/format.ts` used it,
so ±Infinity reached the DOM as the literal string "Infinity%" whenever a zero
denominator got through. Validate at the API boundary too: a target of `0` was
storable because `targetPrice ? … : null` treats the *string* `"0"` as truthy.

**A `defaultX` prop is read once.** `DataTable`'s `defaultSortKey` lives in a
`useState` initializer, so "default to Portfolio fit when the user has a
portfolio" never happened — `ios.profileReady` is false on first render. Derive
and pass the controlled prop instead of defaulting on async state.

**A mean over a mixed sign convention means nothing.** "Avg upside" averaged
exit targets (+20%) with buy limits (−40%) and reported −18.77%, which reads as
"this watchlist is expected to lose 19%" when every target in it was a level to
buy at. Scope the aggregate (`above` targets only) and always render its
denominator — an average over 3 of 57 names is a different claim.

**Escape commas before joining a CSV row.** The watchlist export wrote
`toLocaleDateString` output raw; "Jul 26, 2026" split into two fields and shifted
the last three columns of all 57 rows. Prefer ISO dates, and assert
`fieldCount === headerCount` when verifying an export.

**A threshold alert is an EVENT, not a STATE.** `evaluateWatchlistAlerts` asked
"is the price past the target?", which is true continuously once satisfied — so
the only throttle was a 24h dedup window, which simultaneously re-announced a
January target every day AND suppressed a genuine second crossing on the same
day. Compare against the *previous observation* instead (`lib/price-crossing.ts`,
`price_alert_state`). Two rules fall out: a first sighting can only **arm**, never
fire; and the transition test must be strict (`!was && is`), or a price parked
exactly on the level re-fires every tick. Persist the baseline in SQLite, not in
memory, so a crossing during downtime is still detected.

**A React synthetic `stopPropagation` does not reliably stop a `document`
listener.** React binds to the app root, so an "outside click closes this menu"
handler on `document` still fires for clicks *inside* the menu — and because it
runs on `pointerdown`, the menu unmounted before the `click` that would have run
the action, making **every item in every row's action menu silently unclickable
by mouse**. Decide "outside" by `ref.current.contains(e.target)`, never by
`stopPropagation`. Testing that a menu *opens* does not test that its items work.

**An in-flight guard must be keyed, not boolean.** `if (inFlight) return` is
right for suppressing a duplicate poll and wrong for a superseding one: the
watchlist knows its benchmark one render before its holdings, so the opening
request was for 1 symbol and the real one for 58 skipped against a boolean the
aborted request had not yet cleared. Key by request identity, and release the slot
*synchronously on abort* — an aborted request will never deliver data, so it must
stop blocking immediately.

**Do not put a value in an effect's dependencies unless it changes what the
effect fetches.** `useLiveQuotes` took `regions` as a dep, but regions only set
the *cadence* — and since they are derived from the quotes themselves, the first
response changed them, tore down the schedule and immediately re-fetched. Three
requests per page load became one. Read such values from a ref at scheduling time.

**Virtualization must announce the size it hides.** Windowed rows need
`aria-rowcount` on the table and `aria-rowindex` per row, or a screen reader
reports "30 rows" for a 5,000-row list. Tab cannot reach an unmounted row either,
so arrow/Home/End navigation has to move by *index*, scroll the target in, and
apply focus from an effect once React has committed it — a fixed `requestAnimationFrame`
count silently drops focus to `<body>`. Keep the expanded row mounted even when
scrolled away, or the content height changes mid-scroll and the scrollbar jumps.
Gate the whole mechanism behind a row-count threshold: below it, full rendering is
strictly better and keeps browser find-in-page working.

**Deleting a record must delete what is keyed to it.** `removeFromWatchlist` left
`watchlist_target_history` and `price_alert_state` behind, so re-adding a symbol
months later resurrected "Target history: 3 changes" about a discarded position.

**Opt-in scoring arguments cause cross-surface divergence.** `computeScore`'s
`sectorRotation` parameter is documented as "omit entirely to leave existing
callers' output unchanged". `/compare` omitted it and reported NVDA at 86 while
`/research` said 80. If you add a caller of `computeScore`, pass **every**
argument, including the market region and the same history window (1825 days).
`tests/scoring-consistency.test.ts` pins this.

**Nulls sink in both sort directions.** "Worst first" must not surface every row
whose value is merely unknown. A missing value is not a small value.

**Never cache a failure.** Persisting an Ollama-offline fallback pins "Start
Ollama" for the whole TTL after Ollama comes back. See `cacheVerdict`.

**`isInitialLoading` includes the `idle` tick.** The client store starts at
`idle`, not `loading`. A page deriving `empty` from `!isInitialLoading && !data`
will flash its empty state before any request starts — `/portfolio` told a user
with 26 holdings "No holdings yet."

**Name a score by the question it answers.** UAA computes six different 0-100
numbers (`lib/score-kinds.ts`). Rendering any of them as "Score" or "Overall"
makes two correct answers look like a contradiction. Use `<ScoreChip kind=…>`,
and only band the kinds that are genuinely Buy/Hold/Sell calls.

**A paragraph explaining a label means the label is wrong.** Rename instead.

**Show a percentage's denominator, or the row cannot be checked.** GLD rendered
"Value $0.18 · Cost $0.18 · Realized +$2,856.18 · Return +0.8%" — four figures
that cannot describe one position, since $2,856 on $0.18 is 1,560,000%. All four
were correct: the return was measured against the $375,026 the position had
consumed over its life, and that number appeared nowhere on the page. Any ratio
whose denominator differs from the adjacent column must ship the denominator
(`PositionPerformance.grossInvested`).

**A dollar amount is a display figure; never let one become an execution
instruction.** `optimize.ts` rounded `dollarDelta` to whole dollars and the
executor divided it by the live price, so a "full exit" sold up to $0.50 less
than the position was worth — 0.000492 GLD, above the ledger's 9dp tidy
threshold, which then had a row, a weight, a P&L and a quality score forever.
`closeOutIfDust()` snaps a near-total sell to the whole position; keep it
whatever the caller does upstream.

**One gate, one constant, imported.** The Performance panel withheld its own
XIRR ("Needs 90+ days (have 18)") with a paragraph explaining that annualizing
that window multiplies it by ~20×, and two inches below printed "Underperforming
by 10.3pp/yr" from the same 18 days — because it owned a private copy of the
threshold and `outperformancePct` is a DIFFERENCE of two rates it had just
declared unfit. `MIN_DAYS_TO_ANNUALIZE` now lives beside the `holdingDays` it
gates, in `lib/portfolio-performance.ts`. Every derived rate inherits the gate.

**A column that is empty for every row is not a caveat, it is a broken column.**
Per-position IRR was `—` 25 times because the whole book was 18 days old. Say it
once in a header note and drop the column until a row can populate it.

**A permanently-empty state and a correct-but-withheld one look identical.** So do
"excluded" and "worth nothing". Carry the reason AND the value
(`ExcludedHolding`), and render the subtraction.

**Reconcile two totals with arithmetic, never with prose.** The Performance panel
said "manually-valued assets are excluded" and printed a figure $2,665.81 below
Total Value when those assets came to $1,750. The rest was an unpriced forex
position the copy never mentioned, plus price drift. A reader who checks a stated
exclusion and finds it doesn't account for the gap has learned the page cannot be
checked — worse than no explanation. Show every line, and render the residual
instead of absorbing it.

**Two surfaces over one portfolio must share one snapshot.** `quotes.batch` is
cached 15s and not persisted, so two routes that fetch their own quotes can never
agree. `/api/portfolio/performance` also keyed its batch differently (it sent the
synthetic `CASH-USD`), which additionally cost the CHF holding `USDCHF=X` its
quote inside the same Yahoo call. Never send a synthetic ticker to a provider, and
go through `buildMarketContext()` + `normalizeHoldings()` — the documented single
Portfolio data path — rather than a second `getQuotes()`.

**`shares × price` is a figure in the HOLDING's currency.** Summing it into a
base-currency total adds francs to dollars, and for a bond `quantity` is face
while `price` is a percent of par. Read `valuation.valueBase / quantity` off the
normalized holding instead of multiplying yourself; it has both applied. See
`UnitPricing`.

**A stale valuation must not arrive as a measured one.** `marketValuation()` falls
back to cost basis, which through a per-unit-price seam becomes "price == average
cost" — an unrealized P&L of exactly zero, rendered with full authority. On one
cold cache 86% of the book fell back this way and the only trace was a `stalePct`
field nothing prominent rendered. Treat `valuation.stale` as unpriced.

**A closed position still owes the table an explanation.** `positions` was filtered
to `shares > 0` while `realizedPnl` accrued from every position, so a fully-exited
holding contributed to the headline and appeared nowhere in the breakdown beneath
it — DBC's banked −$13,136 was invisible. Assert
`Σ positions.totalPnl === totalPnl`.

**"Total return" is ONE function, not one per panel.** Three surfaces computed it
three ways and two disagreed on the SIGN: Dashboard −$396.01, Performance
+$5,359.31. The Dashboard's `(value − cost)/cost` cannot see realized P&L (a sold
position leaves `holdings`); Performance couldn't see manually-valued assets (no
dated trades, so −$13,500 of write-down was omitted). Each was blind to a real
signed loss the other counted. `PortfolioPerformance.total` is now the only
definition — realized + unrealized over EVERY holding, over capital at risk — and
`report.totalReturn` is derived from it with a runtime assertion that its
denominator equals `totalCost`.

**A return denominator must be a balance-sheet quantity, never a sum of flows.**
`grossInvested` summed every buy, so a $4.5M deposit and the $4.5M of purchases it
funded were counted twice, plus $699,442.65 of `{balancing: true}` cash plugs the
Transaction Engine writes to conserve value across a rebalance. Result: a
$15,866,581 denominator on a $9.25M book (71.6% inflated), a reported return that
DECAYED with every rebalance at constant economics, and "Deployed $5,267,690" on a
$1,250,635 cash row. Cash is a funding account — excluding only the balancing plugs
fixes $699k of a $6.6M error and looks fixed. Use capital at risk; see
`isInternalCapitalLot()`.

**Two panels that render the same quantity must share one request, not one
formula.** `quotes.batch` lives 15 seconds and is not persisted, so two routes each
calling `buildMarketContext()` price the book at different instants — a measured
$2,074.82 gap between the page header and the Performance panel's own total. Passing
prices through is not enough; the gap returns the moment the window rolls. Compose
instead: `report.performance` is derived from the report's own evaluation and the
panel takes `totalValue` as a prop, so `report.generatedAt === performance.asOf` by
construction.

**Never label a figure as another panel's number unless it IS that number.** The
reconciliation line read "Total portfolio value" while showing a total the panel had
computed itself. It now reads "Total value (as shown at the top of this page)" and
is literally that prop — a claim the reader can check by scrolling.

**Realized P&L is a DATED fact and cannot be converted by a single scalar.** A
closed position has no `RawHolding` — `aggregateOpenPositions()` filters
`shares === 0` — so the valuation seam that supplies `fxRate` for open positions
returns nothing, and the rate defaulted to **1.0**: a position that banked CHF
20,000 was reported as $20,000. Two things were needed: `PortfolioLot.currency`
(the ledger is the only surviving record of a closed position's currency) and
`PositionAggregate.realizedEvents`, because one cumulative figure has no single
date to convert at. Convert per sell at that sell's own rate — see
`isInternalCapitalLot`'s neighbour `FxOnDate`. The fallback chain is
historical → today's → the live valuation's → 1, and it reaches 1 only for a
genuinely base-currency position.

**Mark-to-market uses today's rate; past cash flows use theirs.** `costBasis` stays
on the current rate because `normalizeHoldings()` computes `costBasisBase` that way
and `total.cost` is asserted equal to its `totalCost`. `grossInvested` and the XIRR
flows use dated rates. Consequence to know about: for a FOREIGN position with no
sells, "Deployed" and "Cost" now differ by the FX drift since purchase (live:
$4,654.14 vs $4,604.13 on a 15-day CHF holding). Both are correct — one is the USD
actually spent, the other the basis marked today — but they are not the same
measure, and for USD positions they remain identical.

**A reconciliation note gated on the wrong condition is worse than none.** The
Attribution panel only explained its difference from the headline when holdings
lacked a cost basis. The commonest cause is a closed position's realized P&L, which
has no contribution bar because it has no weight — so it silently read −0.9793%
against a headline of −1.1681%. Gate such notes on "do the numbers differ", not on
one known reason.

---

## Layout Conventions

- `<PageShell width="wide">` (1920px) for data grids: Screener, Portfolio,
  Compare, Engine, Knowledge Graph, Watchlist.
- `<PageShell>` (default `reading`, 1280px) for prose and reports: IC Report,
  Journal, Calendar.
- Use `<DataTable>` for any list of 10+ rows rather than a card list. Cards cost
  ~2.2x the vertical space and cannot be ranked.
- Page `description` text is an onboarding affordance. Hide it once the user has
  loaded real data.
- Use semantic tokens (`text-positive`, `text-negative`, `text-warning`,
  `text-brand`), never raw Tailwind palette values (`text-emerald-500`), which do
  not respond to `data-theme`.
- For d3-force graphs: `forceCenter` only moves the centroid. Without weak
  `forceX`/`forceY`, loosely-connected nodes drift thousands of units out and
  destroy any fit-to-viewport calculation.

---

## One More Thing

This is a single-user, self-hosted equity research platform. All data stays local. No cloud APIs, no subscriptions, no selling data. Code quality and architectural clarity matter because there's no DevOps team to fix problems.

Keep things simple. Prefer existing patterns. Document as you go (update ARCHITECTURE.md). Future agents will thank you.

Good luck.
