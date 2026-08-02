# AGENTS.md: AI Coding Agent Rules for UAA

Quick reference for AI agents (Claude Code, standalone agents, etc.) working on Universal Asset Analyzer.

Read this before reading CLAUDE.md, ARCHITECTURE.md, or PROJECT_ROADMAP.md.

> **The 2026-08 "terminal" redesign was ABANDONED** (owner decision, 2026-08-02 —
> it drifted too close to Bloomberg's identity). The current committed UI IS the
> product's visual identity; do not reintroduce the command-line chrome, The Desk,
> the docket, or any `.tm-*` styling. The full implementation is archived on the
> `redesign-terminal-archive` branch; `docs/redesign/PLAN.md` and
> `docs/brand-preview/terminal/SPEC.md` are historical records, not guidance.

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
- `lib/db.ts` — All SQLite operations. All reads/writes go here.
- `lib/ai/` — All inference. Call `runPrompt(taskType, …)`; never a provider
  directly. The Router walks a chain: Devin CLI (hosted) → Ollama (local).
  `lib/ai/devin-cli.ts` is the only place that spawns a process;
  `lib/ai/ollama.ts` the only place that talks HTTP to the daemon.

**Caching**:
- Fundamentals: 24h TTL in SQLite (refreshed on screener load)
- Prices: Always fresh (no cache)
- Filings: Cached by CIK internally
- Parquet: Daily output from quant engine (read-only)

**Error Handling**:
- API failures: Non-fatal. Return partial data + error message.
- EDGAR/news/analyst data: Optional. UI renders without them.
- Every AI provider offline: Fallback UI message, no crash. Never say "start Ollama" — use `AI_RECOVERY_HINT` from `lib/ai/availability.ts`, which names the hosted path too.

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
npx vitest run            # 1426 tests as of the 2026-07-27 audit
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

`lib/platform/data-layer.ts` claims "Nothing bypasses it. Not … AI generation
itself." AI generation was the one thing that did. **Treat doc comments as intent,
not as fact** — verify against the call graph.

---

## Quant Engine Performance (2026-07-31)

The Fast Run (`--no-forecast`) went from **~182-223s to ~9-13s** on `full_us`
(248 names, warm). Profile before touching it: `engine/profiling.py` prints a
per-stage breakdown at the end of every run (`UAA_ENGINE_TIMING=0` to silence).

What was actually wrong — nearly all of it was **work whose output nobody read**,
not slow algorithms:

| Finding | Cost |
|---|---|
| `^GSPC`/`^NSEI` were never fetched, so the "one HMM per market" design (fix 3.1) silently fell back to **12 HMM fits per stock** | 47s |
| `features_daily` wrote the full 5y long-format expansion (~70k rows/symbol/run); the only reader queries `MAX(date)` | 28s/run, 15.4M rows, 1.1GB |
| `fetch_ohlcv`'s single-symbol branch read `row.get("Open")` against yfinance's MultiIndex columns → **wrote all-NULL prices** | silent data corruption |
| `_yf_close` returned an (n,1) array, so every macro feature raised into a bare `except` | macro augmentation never ran, ever |
| `fast_info` refetched per symbol on same-day price top-ups | 49s |
| `forward_pe IS NULL` / `cagr IS NULL` as refetch conditions — a symbol whose upstream has no such data can never clear them | refetched forever |
| One query per symbol for prices, regime, and 8x for detail snapshots | ~2,000 round-trips |
| Universe resolution hit the Yahoo screener (10 paginated requests) every run | 3-9s |

**Rules this produced:**

- **A "NULL means retry" condition needs a recency guard.** If the upstream
  genuinely has no value, the condition never clears and the fetch runs forever.
  Pair it with an `*_attempted_at` timestamp, not just the value being absent.
- **Derived tables must be written at the granularity they are read.** Check the
  readers first (`grep` the table name) — `features_daily` is read at one date.
  `prune_derived_history()` enforces this; `engine/compact_db.py` reclaims the
  file, since DuckDB frees blocks on DELETE but never shrinks in place.
- **"Latest session" is per market and should be the modal date, not the max.**
  NSE closes before NYSE, and one index carrying a partial intraday bar will
  otherwise mark an entire market stale.
- **yfinance returns MultiIndex columns even for one ticker** (confirmed 1.5.2).
  Any `row.get("Close")` or `float(arr[-1])` against it fails — and both places
  it happened here were inside a bare `except`, so it looked like missing data
  rather than a bug.
- **Raise `RLIMIT_NOFILE` in any engine process** (`raise_fd_limit()`). macOS's
  256 soft limit surfaced as "unable to open database file", a polars
  `PanicException` mid-scan, and import errors from lazily-imported modules —
  never as anything resembling FD exhaustion. Import at module top level, not
  inside hot functions, for the same reason.
- **Per-symbol loops around market-level work.** Index regime posteriors are
  identical for every symbol in a market; check whether a loop body actually
  depends on the loop variable before optimizing what is inside it.

Equivalence is pinned by construction: every vectorized primitive in
`engine/features/factory.py` and `engine/models/regime.py` was diffed against
its original loop implementation (max |diff| 0.0 to 1e-13), and two consecutive
`--no-fetch` runs produce bit-identical scorecards with 248/248 signal agreement.

---

## Correctness Rules Learned The Hard Way

**Never infer a unit from a value's magnitude.** `Math.abs(v) <= 1 ? v*100 : v`
rendered AAPL's 1.4147 ROE as "1.41%" — 100x low on exactly the values an analyst
most wants to see. Declare units per metric key (see `METRIC_UNITS` in
`app/portfolio/_components/universal/holdings-panel.tsx`).

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

---

## Branding

**Never hand-roll the logo.** No `◆` glyph, no inline `<svg>`, no `h-[19px]`.
Import `<BrandMark>` / `<BrandLockup>` / `<BrandEmptyState>` from
`app/_components/brand.tsx`, and pick a size *token*. The mark's geometry has one
definition — `lib/brand/mark.ts` — shared by the React components, the animated
`<LoadingMark>`, the generated favicons, and the PDF exporter.

The single non-negotiable semantic: the terminus is a **diamond when resolved**
and an unrotated **square while work is in flight**. `<LoadingMark state="done">`
is pixel-identical to `<BrandMark>`. So never show the static logo to mean
"loading" — an empty state that is empty *because a fetch is running* takes
`<BrandEmptyState loading>`.

Placement is chrome + brand moments only: headers, footers, mobile nav, boot
splash, command palette, assistant resting state, empty states, exports, icons.
**Not** beside every page `<h1>`, not on cards or table rows, and never two
lockups in one view.

Full spec, including the size scale, spacing, hover/focus, responsive collapse
and how to regenerate `favicon.ico`/`icon.svg`/`apple-icon.png`
(`npm run brand:assets`): **`docs/BRAND.md`**.

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
