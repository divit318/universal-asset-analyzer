# Universal Asset Analyzer

An institutional-grade equity research platform that runs entirely locally: live
market data (Yahoo Finance for US equities, screener.in for Indian markets), offline
AI (Ollama — no external LLM APIs), quant scoring (Python + DuckDB), and user-owned
state (SQLite, no cloud sync). Built on Next.js 16 (App Router, Turbopack, React 19).

## Getting started

Prerequisites:
- Node.js 20+
- [Ollama](https://ollama.com) running locally, with a model pulled (e.g. `ollama pull mistral`) — required for AI-backed features (research copilot, IC report, watchlist digest, etc.)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.local` and adjust as needed:

```bash
OLLAMA_MODEL=mistral
AI_PROVIDER=ollama
```

## Scripts

| Command         | Description                                       |
| --------------- | -------------------------------------------------- |
| `npm run dev`   | Start the dev server (Turbopack)                    |
| `npm run build` | Production build                                    |
| `npm run start` | Serve the production build                          |
| `npm run lint`  | Run ESLint                                          |
| `npm run test`  | Run the Vitest test suite                           |

> Note: as of Next.js 16, `next build` no longer runs the linter — run `npm run lint` separately.

## Modules

| Module | Route | Purpose |
|--------|-------|---------|
| Research | `/research`, `/research/india` | Deep equity research: quote, history, filings, news, insider trades, AI copilot chat |
| Screener | `/screener` | Fundamental screening with cached data, live prices, composite value/quality/momentum scoring |
| Scanner | `/scanner` | Event-driven signals: earnings surprises, insider transactions, technical breaks |
| Compare | `/compare` | Multi-stock comparison across 14 metrics |
| Portfolio | `/portfolio` | Holdings, P&L, beta/correlation/sector concentration, position fit analysis |
| Watchlist | `/watchlist` | Tracked tickers with alerts, notes, portfolio-fit scoring |
| DCF | `/dcf` | Intrinsic value calculator with sensitivity analysis |
| Calendar | `/calendar` | Earnings calendar with pre/post event performance |
| IC Report | `/ic-report` | Multi-agent institutional research (business, industry, competition, valuation, risk, …) |
| Backtest | `/backtest` | Signal backtesting |
| Journal | `/journal` | Decision journal and calibration track record |
| Intelligence | `/intelligence` | Knowledge graph, opportunity map, and timeline in one focus view |
| Thematic | `/thematic` | Thematic analysis: supply chains, commodities, geopolitics, company tiers |
| Engine | `/engine` | Quant scorecard from the Python/DuckDB pipeline (`engine/daily_run.py`) |

## Project structure

```
app/            Next.js App Router — pages + API routes (app/api/*)
  _components/  Shared UI (used by 2+ modules)
  [module]/     Module pages + module-specific components
lib/            Domain logic — market data, scoring, AI orchestration, DB
lib/ai/         AI provider routing layer (router, orchestrator, task registry) — see lib/ai/ARCHITECTURE.md
engine/         Python quant pipeline (separate process, outputs Parquet)
data/           SQLite + DuckDB + Parquet (persistent local state, gitignored)
tests/          Vitest unit/integration tests
```

See `CLAUDE.md` and `ARCHITECTURE.md` for full architecture, data model, and
development conventions.

## Conventions (Next.js 16)

This project follows the conventions documented in `node_modules/next/dist/docs/`
(see `AGENTS.md`). Notably:

- `params` and `searchParams` are async (`Promise`) and must be awaited.
- API endpoints use `route.ts` with named method exports (`GET`, `POST`, …).
- Turbopack is the default bundler.
- The `@/*` import alias maps to the project root.
