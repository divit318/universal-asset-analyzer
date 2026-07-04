# CLAUDE.md: Universal Asset Analyzer (UAA)

This file provides comprehensive guidance to Claude Code when working with the Universal Asset Analyzer codebase. It documents the current architecture, development patterns, and principles that should guide all future work.

## Vision & Philosophy

**UAA is an institutional-grade equity research platform** that runs entirely locally, powered by:
- **Live market data** (Yahoo Finance for US equities, screener.in for Indian markets)
- **Offline AI** (Ollama + llama3.2 for local inference — no external LLM APIs)
- **Quant scoring** (Python DuckDB engine for systematic signal generation)
- **User-owned state** (SQLite database, no cloud sync, no subscriptions)

The design philosophy is **transparency over convenience**: users see the research process, understand the scoring logic, and own their data entirely. Features are feature-complete, not minimum viable — deep research, not thumbnails.

---

## Development Workflow (Token-Efficient)

**Before writing any code, follow this sequence:**

1. **Locate relevant files** — Use Serena (`/serena find_symbol` or `find_implementations`)
   - Find function/type definitions: `find_symbol "function_name"`
   - Find where a symbol is used: `find_referencing_symbols "symbol"`
   - Find related implementations: `find_implementations "api_name"`
   - Never grep/bash search for symbols; let Serena do it

2. **Understand dependencies** — Use Graphify (`/graphify`)
   - Before modifying a module, run `/graphify "[module_name] dependencies"`
   - Before adding a feature, run `/graphify "[module_name] interactions"`
   - This shows what else would be affected
   - Prevents hidden ripple effects

3. **Prefer existing over new**
   - Check if a similar engine already exists (e.g., `lib/composite.ts` for scoring)
   - Reuse hooks and context before creating new ones
   - Search `lib/` for similar patterns before implementing
   - Add to existing modules rather than creating duplicates

4. **Read only what's necessary**
   - Use Serena to find the 2-3 files you actually need
   - Don't read entire modules; read targeted functions
   - Read ARCHITECTURE.md + relevant module docs first (saves reading code)
   - Check git history for similar patterns before implementing

**Result:** Minimal token usage, fewer files in context, faster implementation.

---

## Current Application Architecture

### Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Framework** | Next.js 16 (App Router, Turbopack) | React 19, `params`/`searchParams` are async |
| **Styling** | Tailwind CSS v4 | Utility classes only; no component library |
| **Data** | SQLite (node:sqlite) + DuckDB | Single app database at `data/app.db`; quant engine uses separate `data/engine.duckdb` |
| **Market data** | yahoo-finance2 (US), screener.in API (India) | Live quotes, fundamentals, history, filings |
| **AI/Inference** | Ollama (local) | HTTP `localhost:11434`, default model `llama3.2` |
| **Exports** | ExcelJS (server-side) + PDFKit | Never import in client components |
| **Charting** | Recharts | Real-time interactive charts with multi-line, candlestick, heatmap patterns |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Next.js App Router                    │
│  (Page Components: Research, Screener, Compare, Portfolio…)  │
└──────────┬──────────────────────────────────────────────────┘
           │
           ├─→ /api/* (Route Handlers)
           │   └─→ lib/* (Domain Logic)
           │
           ├─→ _components/* (Shared UI)
           │   └─→ Recharts, Forms, Tables, Cards
           │
           └─→ [module]/_components/* (Module-Specific UI)

┌─────────────────────────────────────────────────────────────┐
│                    Shared Domain Engines                      │
│  lib/yahoo.ts           (quote, history, fundamentals)       │
│  lib/edgar.ts           (SEC filings)                         │
│  lib/ollama.ts          (local LLM inference)                 │
│  lib/composite.ts       (scoring formulas)                    │
│  lib/dataset.ts         (screener data assembly)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Data Persistence                           │
│  SQLite: watchlist, portfolio, research_session, notes       │
│  DuckDB: quant signals (engine.duckdb)                       │
│  Parquet: scorecard_snapshot.parquet (engine output)         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Python Quant Engine                          │
│  engine/daily_run.py → data/scorecard_snapshot.parquet       │
│  (runs as separate process, not integrated with npm dev)     │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Directories

| Path | Role |
|------|------|
| `app/` | Next.js App Router (pages + API routes) |
| `app/_components/` | Shared UI components (used by 2+ modules) |
| `app/[module]/` | Module pages + subcomponents |
| `app/api/` | Route handlers |
| `lib/` | Domain logic (41 files total) |
| `engine/` | Python quant pipeline (separate process) |
| `data/` | SQLite, DuckDB, Parquet (persistent state) |
| `tests/` | Vitest unit tests |

---

## Existing Modules & Their Purposes

| Module | Purpose | Key Files |
|--------|---------|-----------|
| **Research** (`/research`, `/research/india`) | Deep equity research: quote, history, filings, news, insider trades, copilot chat (persisted per session). India variant uses screener.in API. | `lib/ai-research.ts`, `lib/edgar.ts`, `lib/news.ts`, `lib/screener-in.ts` |
| **Screener** (`/screener`) | Fundamental screening with 24h cached Yahoo data, live prices, composite scoring (value/quality/momentum). | `lib/fundamental-screener.ts`, `lib/composite.ts`, `lib/dataset.ts` |
| **Scanner** (`/scanner`) | Event-driven signals: earnings surprises, insider transactions, technical breaks. | `lib/event-screener.ts`, `lib/indicators.ts` |
| **Compare** (`/compare`) | Multi-stock comparison across 14 metrics (price, growth, profitability, valuation, leverage). | `lib/ai-compare.ts` |
| **Portfolio** (`/portfolio`) | Holdings tracking, P&L, portfolio metrics (beta, correlation, sector concentration), position fit analysis. | `lib/portfolio-analytics.ts`, `lib/db.ts` |
| **Watchlist** (`/watchlist`) | Tracked tickers with alerts, notes, bulk monitoring. | `lib/db.ts` |
| **DCF** (`/dcf`) | Intrinsic value calculator with sensitivity analysis. | `lib/fundamentals.ts` |
| **Calendar** (`/calendar`) | Earnings calendar with dates and pre/post event performance. | `app/api/calendar/route.ts` |
| **IC Report** (`/ic-report`) | Institutional research via multi-agent pipeline (9 agent domains: business, industry, competition, management, capitalAllocation, accounting, valuation, governance, risk). | `lib/ic-agents.ts`, `lib/ic-questions.ts`, `lib/ic-signals.ts` |
| **Engine** (`/engine`) | Quant scorecard powered by Python DuckDB pipeline. Runs separately, outputs Parquet, read-only from Next.js. | `engine/daily_run.py` |
| **Thematic** (`/thematic`) | 10-stage thematic analysis framework with supply chains, commodities, geopolitics, company tiers, opportunity scoring. | `lib/thematic-engine.ts` |
| **Analyze** (`/analyze`) | Asset upload → structured breakdown (legacy, minimal active development). | `app/analyze/page.tsx` |

---

## Key Libraries & Patterns

**Market Data**
- `lib/yahoo.ts` — Yahoo Finance wrapper (quote, history, summary, error handling is non-fatal)
- `lib/edgar.ts` — SEC filings (CIK cache, non-fatal failures)
- `lib/screener-in.ts` — screener.in API for India equities (different field names than Yahoo)
- `lib/news.ts` — Company news aggregation

**Scoring & Screening**
- `lib/composite.ts` — Deterministic scoring (value/quality/momentum). All changes must be tested in `tests/composite.test.ts`.
- `lib/fundamental-screener.ts` — Filter logic + cache management (24h TTL)
- `lib/dataset.ts` — Merge cached fundamentals + live prices for screener
- `lib/event-screener.ts` — Signal generation (earnings surprises, insider transactions, breaks)
- `lib/indicators.ts` — Technical indicators (RSI, moving averages, Bollinger bands)
- `lib/thematic-engine.ts` — 10-stage thematic analysis framework

**AI/Inference**
- `lib/ollama.ts` — Base integration (local, graceful offline degradation)
- `lib/ai.ts`, `lib/ai-research.ts`, `lib/ai-compare.ts` — Feature-specific prompt builders
- `lib/ic-agents.ts` — 9 agent domains (business, industry, competition, management, capitalAllocation, accounting, valuation, governance, risk) run in parallel. Results streamed via `ReadableStream`.

**State & Utilities**
- `lib/db.ts` — SQLite CRUD for watchlist, portfolio, research sessions, notes
- `lib/portfolio-analytics.ts` — Beta, correlation, sector concentration, P&L, fit analysis
- `lib/format.ts` — Locale-aware formatting (currency, percent, market cap)
- `lib/download.ts` — Excel/PDF export via server-only routes

---

## State Management

### User State (SQLite — persistent across sessions)

```typescript
// lib/db.ts — all tables and CRUD functions

watchlist
├── symbol (TEXT, PK)
├── name
├── added_at
├── target_price (nullable)
├── alert_pct_drop (nullable)
└── notes (nullable)

portfolio
├── symbol (TEXT, PK)
├── name
├── shares (REAL)
├── avg_cost (REAL)
└── added_at

research_session
├── id (TEXT, PK) — session UUID
├── symbol
├── created_at
└── updated_at

research_message
├── id (AUTOINCREMENT)
├── session_id (FK)
├── role ("user" | "assistant")
├── content (TEXT)
├── meta (JSON, nullable)
└── created_at

research_notes
├── id (AUTOINCREMENT)
├── symbol
├── content
└── created_at

fundamentals_cache
├── symbol (TEXT, PK)
├── data (JSON-serialized StockFundamentals)
└── updated_at (Unix timestamp)

scanner_cache
├── cache_key (TEXT, PK)
├── result (JSON)
└── created_at (Unix timestamp)
```

**Pattern**: All read/write operations go through `lib/db.ts`. No direct sqlite calls from pages or API routes.

### UI State (React — transient, per-session)

- **Search state** (symbol typeahead): stored in page component state
- **Scroll position**: preserved via browser history API
- **Toast notifications**: managed by `ToastProvider` in `app/_components/toast.tsx`
- **Dialog state** (watchlist editor, notes panel): managed by page component
- **Filtered screener results**: computed on render from form inputs; not persisted

### Quant Engine State (DuckDB + Parquet — read-only)

- `data/engine.duckdb` — intermediate tables (features, scores)
- `data/scorecard_snapshot.parquet` — daily output (read by `/engine` page)
- **Lifecycle**: Generated by `python engine/daily_run.py` (separate process, runs daily)
- **Consumption**: Next.js reads Parquet via API route, never writes

### Session State (API-level)

- **Research copilot**: multi-turn conversation persisted in `research_session` + `research_message` tables
- **Request deduplication**: `scanner_cache` prevents redundant event-screener runs

### Derivable State (Never persisted)

- Screen results (filtered stocks + scores) — computed from fundamentals_cache + live prices
- Portfolio metrics (beta, correlation) — computed from positions + price history
- Sector concentration — computed from portfolio positions + sector mappings
- Comparison metrics — computed from multi-year history

---

## Design & Styling

- **Tailwind CSS v4**: Utility classes only, no component library. CSS variables in `app/globals.css`.
- **Components**: Located in `app/_components/` if shared (2+ modules), otherwise `app/[module]/_components/`.
- **Charts**: Recharts for all interactive charts (line, multi-line, heatmap patterns).
- **Typography**: Geist (sans-serif), Geist Mono (code/data).
- **Accessibility**: Semantic HTML, focus rings, skip-to-content link in root layout.

---

## Code & Architecture Essentials

**TypeScript**
- Interfaces: `PascalCase` (no `I` prefix)
- Nullability: explicit `| null` (not `undefined`), DB columns map to NULL
- Keep constraints tight: `<T extends { symbol: string }>`

**React**
- Default to **Server Components** (no `'use client'`)
- Use `'use client'` only for interactivity, hooks, browser APIs
- Props: destructure, inline types for simplicity
- Hooks: `useState` (UI state), `useEffect` (external), `useCallback` (passing to children)
- Avoid: `useMemo` for simple values, Context for global state

**Next.js 16 App Router**
- `params`/`searchParams` are Promises — always `await` them
- Route handlers: add `runtime = "nodejs"` + `dynamic = "force-dynamic"` as needed
- Validate input early, handle errors with `try/catch`
- Use `ReadableStream` for long-running operations (IC report, copilot)

**Caching Strategy**
- **Fundamentals**: 24h TTL in SQLite (refreshed on screener load)
- **Live quotes**: No cache, always fresh
- **Filings**: Cached by CIK internally in `lib/edgar.ts`
- **Parquet**: Daily output from quant engine, read-only from Next.js

**Performance**
- Parallel fetch: `Promise.all([req1, req2, req3])` not serial
- Recharts: move expensive calculations to `useMemo()`
- N+1 avoidance: fetch all related data in one query
- Comments: only for hidden constraints, non-obvious decisions, workarounds

---

## Architecture Decisions

**Shared Components** (`app/_components/`): Used in 2+ modules, self-contained
- Examples: `site-header.tsx`, `toast.tsx`, `dialog.tsx`, `ollama-status.tsx`

**Module Components** (`app/[module]/_components/`): Used in 1 module only
- Examples: `research/_components/interactive-chart.tsx`, `screener/_components/score-chip.tsx`

**Extend Existing Modules When**:
- Same domain (e.g., add copilot feature → `lib/ai-research.ts`)
- Same data source (e.g., add signal → `lib/event-screener.ts`)
- Same workflow refinement (e.g., add export → `lib/download.ts`)

**Create New Modules When**:
- Distinct user workflow (e.g., `/dcf`, `/engine`, `/portfolio`)
- New data model (new DB tables or state structure)
- Cross-cutting concern (e.g., `/api/export/*`)

**Avoid Duplication**:
- Extract utility functions to `lib/` (e.g., `formatCurrency()`)
- Extract common components to `app/_components/` (e.g., `SymbolSearch`)
- Single source of truth for formulas (e.g., all scoring in `lib/composite.ts`)

---

## Testing Expectations

### What to Test

**Unit Tests** (100% coverage for domain logic)
- Scoring formulas (`lib/composite.ts`)
- Data parsing (EDGAR, screener.in)
- Signal generation (event detection)
- Formatting utilities

**Integration Tests** (critical workflows)
- Screener: filter + score + rank
- Comparison: multi-stock data merge
- IC report: agent pipeline + synthesis

**Not Tested**:
- React component rendering (covered by browser testing)
- External API calls (mocked or skipped with `test.skip`)
- UI interaction details

### Test Files

Place tests in `tests/` with name matching the module:
- `lib/composite.ts` → `tests/composite.test.ts`
- `lib/event-screener.ts` → `tests/event-screener.test.ts`
- `lib/screener-in.ts` → `tests/screener-in.test.ts`

### Test Framework (Vitest)

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scoreAsset } from "@/lib/composite";

describe("scoreAsset", () => {
  it("scores a quality stock (high ROE, low P/E)", () => {
    const score = scoreAsset({
      symbol: "AAPL",
      peRatio: 15,
      roe: 0.25,
      // ...
    });
    expect(score).toBeGreaterThan(60); // expect high score
  });

  it("returns 0 for missing data", () => {
    const score = scoreAsset({
      symbol: "BADSTOCK",
      peRatio: null,
      roe: null,
      // ...
    });
    expect(score).toBe(0);
  });
});
```

### Run Tests

```bash
npm run test              # all tests
npx vitest run tests/composite.test.ts  # single file
```

---

## Critical Mistakes to Avoid

| Mistake | Wrong | Right | Why |
|---------|-------|-------|-----|
| **Direct DB calls** | Page imports DatabaseSync | Use `lib/db.ts` CRUD functions | Single schema source of truth |
| **Server-only imports in client** | Client imports ExcelJS/PDFKit | Use `app/api/` routes only | Listed in `next.config.ts` as serverExternalPackages |
| **Hardcoded endpoints** | `fetch("http://localhost:11434/...")` | Use `process.env.OLLAMA_HOST` | Enables configuration via env vars |
| **Missing data handling** | `quote.peRatio / quote.roe` without null check | `if (x == null) return 0` before division | Financial data is frequently incomplete |
| **Mixing logic & UI** | Page component contains scoring logic | Move to `lib/`, expose via `app/api/` | Decouples testing, reuse, server/client |
| **Serial requests** | `await req1; await req2; await req3;` | `await Promise.all([req1, req2, req3])` | Parallel fetching is 2-3x faster |
| **Stale UI after mutation** | POST but don't refetch | Refetch or use cache invalidation | Users see old data otherwise |
| **No error handling in streams** | Agent failure crashes entire stream | Try/catch, enqueue error, continue | Partial results > complete failure |
| **Unvalidated input** | `getQuote(symbol)` directly from query param | Validate with regex before use | Prevents invalid API calls & DB entries |
| **Forgotten async params** | `props.params` in page component | `const params = await props.params` | Next.js 16 makes params Promises |

---

## Quick Reference: How to Build New Features

1. **Domain logic** → `lib/[module].ts` (testable, reusable)
2. **API route** → `app/api/[module]/route.ts` (validate input, call domain logic)
3. **Page** → `app/[module]/page.tsx` (fetch data, render)
4. **Subcomponents** → `app/[module]/_components/` (interactive UI)
5. **Shared component** → `app/_components/` (if used in 2+ modules)
6. **Tests** → `tests/[module].test.ts` (domain logic only)

---

## Common Patterns

**Scoring changes**: Update `lib/composite.ts` + always add test case in `tests/composite.test.ts`

**New data source**: Create `lib/[source].ts` (Yahoo, EDGAR, screener.in pattern), add error handling, export functions for callers to use

**Streaming API**: Use `ReadableStream` with `controller.enqueue()` for long-running operations (IC report pattern)

**State mutations**: Always in `lib/db.ts` CRUD functions, never direct SQLite calls from pages

**Server-only packages**: ExcelJS, PDFKit only in `app/api/` routes, never import in client components

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
