# Universal Asset Analyzer

An institutional-grade research platform, local-first, across seven asset
classes (equities, crypto, forex, commodities, funds/ETFs, derivatives, real
estate, private markets) plus manual/macro tracking: live market data (Yahoo
Finance for US equities, screener.in for Indian markets, RentCast for real
estate), AI narration on Claude via the Anthropic API using **your own API
key**, quant scoring (Python + DuckDB), and user-owned state (SQLite on your
disk, no cloud sync, no accounts). Every metric, score, and valuation is
computed locally by deterministic engines — the model only writes the
narrative. Built on Next.js 16 (App Router, Turbopack, React 19).

## Getting started

Prerequisites:
- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com) (optional) — required
  only for AI-backed features (research copilot, IC report, portfolio brief,
  verdict/compare, etc.). Enter it once at `/settings` in the app; it is stored
  at `~/.uaa/anthropic_api_key` with owner-only permissions, sent to
  `api.anthropic.com` and nowhere else. Everything computed (screener, scores,
  DCF, portfolio analytics) works without it.
- Python 3.12+ (optional) — only needed to run the quant engine (`engine/daily_run.py`);
  the Next.js app runs fully without it, `/engine` will just show no data

```bash
npm install
cp .env.example .env.local   # defaults work out of the box; see file for optional keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

No database setup is required: `lib/db.ts` opens (and creates, via
`CREATE TABLE IF NOT EXISTS`) a SQLite file at `data/app.db` on first run. There
are no migrations to run.

To run the Python quant engine (optional):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m engine.daily_run
```

> The venv location matters: the app spawns the engine's Python itself (reading
> the scorecard, building the market brief, running the engine from `/engine`),
> and `lib/engine-python.ts` resolves the interpreter as `.venv/bin/python` at
> the project root, falling back to whatever `python3` is on `PATH`. Installing
> the requirements anywhere else (system Python, conda, a differently named
> venv) leaves the app spawning an interpreter without the engine's
> dependencies, and `/engine` fails with `ModuleNotFoundError`.

## Scripts

| Command         | Description                                       |
| --------------- | -------------------------------------------------- |
| `npm run dev`   | Start the dev server (Turbopack)                    |
| `npm run build` | Production build                                    |
| `npm run start` | Serve the production build (run `npm run build` first) |
| `npm run lint`  | Run ESLint                                          |
| `npm run test`  | Run the Vitest test suite                           |
| `npm run test:e2e` | Run the Playwright e2e smoke suite (builds + boots its own server on port 3111 with an isolated DB, see `playwright.config.ts`) |
| `npm run monitor` | Standalone alert-monitor poller (`scripts/monitor.mjs`); see `scripts/README.md` |

> Note: as of Next.js 16, `next build` no longer runs the linter — run `npm run lint` separately.

## Production

```bash
npm run build
npm run start
```

Set `NEXT_PUBLIC_BASE_URL` in the production environment to the app's own public
URL (used for a couple of server-side self-calls) — see `.env.example`. Everything
else defaults sensibly; only `RENTCAST_API_KEY` / `NEWSAPI_KEY` need real values if
you want those integrations live.

## Modules

| Module | Route | Purpose |
|--------|-------|---------|
| Home | `/` | Personalized daily dashboard — today's brief, recent activity, watchlist/market intel, sector rotation — composed from an independent module registry (`lib/home/registry.ts`, `app/_home/module-map.ts`) |
| Research | `/research` | Deep research for any symbol; the page auto-detects asset class (equity, crypto, forex, commodity, fund/ETF, derivative) and renders the right module. `/research/india` covers India equities via screener.in |
| Manual assets | `/research/manual` | Real estate, private markets, and other non-quoted assets tracked by hand |
| Macro | `/research/macro` | Macro indicator dashboards |
| Screener | `/screener` | Universal screener across all asset classes — cached fundamentals, live prices, composite value/quality/momentum scoring |
| Scanner | `/scanner` | Event-driven signals: earnings surprises, insider transactions, technical breaks, causal thesis builder |
| Compare | `/compare` | Asset comparison across equities, ETFs, REITs, crypto, commodities, bonds and forex — deep, class-tailored frameworks, not one generic template |
| Portfolio | `/portfolio` | Holdings, lots/P&L, performance (XIRR + benchmark), decisions, rebalance/optimize, buy/allocate-cash flows across all asset classes |
| Watchlist | `/watchlist` | Tracked tickers with alerts, notes, portfolio-fit scoring |
| DCF | `/dcf` | Intrinsic value calculator with sensitivity analysis |
| Calendar | `/calendar` | Earnings calendar with pre/post event performance |
| IC Report | `/ic-report` | Multi-agent institutional research (business, industry, competition, valuation, risk, …) |
| Journal | `/journal` | Decision journal and calibration track record |
| Intelligence | `/intelligence` | Knowledge graph, opportunity map, and timeline in one focus view |
| Thematic | `/thematic` | Thematic analysis: supply chains, commodities, geopolitics, company tiers |
| Quant Engine | `/engine` | Systematic desk over the Python/DuckDB pipeline (`engine/daily_run.py`): market regime, adaptive factor weights, conviction book with probability bands and Kelly sizing, market breadth, model health, and on-demand model validation (the former `/backtest`) |

Asset-class coverage (equities/crypto/forex/commodities/funds/derivatives/real
estate/private markets) is centered on `lib/assets/` (the platform-wide asset
registry — see `ARCHITECTURE.md`) and `lib/portfolio/` (the universal
factor-based portfolio engine).

## Landing page

`/landing` is the public marketing experience — a story-driven page (hero →
problem → solution → local-first privacy → features → interactive demo →
comparison → pricing → FAQ → final CTA) built to become the future site root.
It ships its own chrome (the authenticated app header is suppressed on this
subtree) and is fully static, image-free, and dependency-free: repo design
tokens, CSS-keyframe motion via a native `IntersectionObserver`, and a canned
(no-network) demo.

- Structure is data-driven from `app/landing/landing-config.ts` (`SECTIONS`);
  each section is a component resolved by id in
  `app/landing/_components/section-registry.tsx`.
- **Migration path** — promoting `/landing` to `/` is routing-only: flip
  `LANDING_HOME` / `APP_ENTRY` in `landing-config.ts` and the suppression
  predicate in `app/_components/site-header.tsx`. No section component changes.
- Specs: `e2e/landing.spec.ts`.

## Project structure

```
app/            Next.js App Router — pages + API routes (app/api/*)
  _components/  Shared UI (used by 2+ modules)
  [module]/     Module pages + module-specific components
  landing/      Public marketing page (/landing) — future site root
lib/            Domain logic — market data, scoring, AI orchestration, DB
lib/ai/         AI provider routing layer (router, orchestrator, task registry) — see lib/ai/ARCHITECTURE.md
lib/assets/     Cross-asset-class registry (source of truth for all 7 asset classes)
lib/platform/   Shared fetch/cache/dedup/orchestration layer — every data fetch goes through here
lib/portfolio/  Universal (12-class, factor-based) portfolio engine
lib/screener/   Universal screener engine + per-asset-class universes
engine/         Python quant pipeline (separate process, optional, outputs Parquet)
data/           SQLite + DuckDB + Parquet (persistent local state, gitignored)
tests/          Vitest unit/integration tests
e2e/            Playwright e2e specs
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
