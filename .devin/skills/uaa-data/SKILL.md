---
name: uaa-data
description: Inspect and debug UAA's data stores (SQLite app.db, DuckDB engine db, Parquet scorecard, caches) and its market-data pipelines (Yahoo, EDGAR, screener.in) safely
permissions:
  allow:
    - Exec(sqlite3 "file:data/app.db?mode=ro")
    - Exec(duckdb -readonly)
    - Exec(duckdb -c)
---

Toolkit for UAA's data layer. UAA is local-first: every store below is a file under `data/` (gitignored). Default to READ-ONLY access; writes go through `lib/db.ts` CRUD functions in code, never ad-hoc SQL, and any destructive SQL needs explicit user confirmation.

## The stores

| Store | File | Engine | Written by |
|---|---|---|---|
| App state | `data/app.db` | SQLite (`node:sqlite`, Node 26) | `lib/db.ts` only (~41 tables) |
| Quant engine | `data/engine.duckdb` | DuckDB | `engine/*.py` (Python venv) |
| Scorecard snapshot | `data/scorecard_snapshot.parquet` | Parquet (polars, atomic tmp+rename) | `engine/daily_run.py`; read-only from Next.js |
| Stage timings | `data/debug-pipeline.ndjson` | NDJSON | `lib/debug-pipeline.ts` |
| EDGAR cache | `data/edgar_cache/` | JSON files | `lib/edgar.ts` |

## Query patterns

**SQLite, read-only** (the `?mode=ro` URI is the safety mechanism — always use it):
```bash
sqlite3 "file:data/app.db?mode=ro" ".tables"
sqlite3 "file:data/app.db?mode=ro" "SELECT provider, outcome, count(*), round(avg(duration_ms)) FROM ai_call GROUP BY 1,2;"
```

**DuckDB CLI** (installed via Homebrew) — one tool for DuckDB + Parquet + SQLite + CSV/JSON:
```bash
duckdb -readonly data/engine.duckdb "SHOW TABLES;"
duckdb -c "SELECT * FROM 'data/scorecard_snapshot.parquet' LIMIT 5;"
duckdb -c "INSTALL sqlite; LOAD sqlite; SELECT count(*) FROM sqlite_scan('data/app.db','watchlist');"
```

**Python venv** (`.venv/` has the full quant stack: polars, duckdb, pandas, numpy, scipy, statsmodels, sklearn, xgboost, yfinance):
```bash
.venv/bin/python -c "import polars as pl; print(pl.read_parquet('data/scorecard_snapshot.parquet').describe())"
```

**Ad-hoc Python packages** — never install into `.venv` (it mirrors `requirements.txt`). Use uv's ephemeral env instead, e.g. to verify a generated PDF export:
```bash
uv run --no-project --with pypdf python -c "from pypdf import PdfReader; print(PdfReader('/tmp/report.pdf').pages[0].extract_text()[:500])"
```

## Key tables in app.db

- Caching: `platform_cache` (L2 of the Platform Data Layer; L1 is in-memory LRU), `fundamentals_cache` (24h TTL), `scanner_cache`
- AI instrumentation: `ai_call` (the ledger — task_type, provider, model, outcome, ttft_ms, cache_read_tokens, cost_usd), `ai_job`, `ai_result`
- Product state: `watchlist*`, `portfolio*`, `research_session/message/notes`, `valuation_case/event`, `decision`, `notification`, `activity`

## Market-data pipeline debugging

Data sources live in `lib/` and should be exercised through UAA's own code (that is what you are actually debugging), via tsx one-liners:
```bash
npx tsx -e "import('./lib/yahoo').then(async y => console.log(await y.getQuote('AAPL')))"
```
- `lib/yahoo.ts` — US equities (yahoo-finance2; free, no key)
- `lib/edgar.ts` — SEC filings. Requires `SEC_USER_AGENT` env (fair-use policy: identify yourself, stay ≤10 req/s). CIK-keyed cache in `data/edgar_cache/`. EDGAR full-text search is free at `https://efts.sec.gov/LATEST/search-index?q=...`
- `lib/screener-in.ts` — Indian equities (screener.in)
- `lib/news.ts` — news aggregation (free tier; `NEWSAPI_KEY` optional)

Failures from these sources are BY DESIGN non-fatal: partial data + error message, UI renders without them. Preserve that contract.

## The quant engine

`engine/daily_run.py` (invoked by `/api/engine` POST as a subprocess) → features → regime (HMM) → factors → Monte Carlo → Kelly → writes the Parquet scorecard. Run manually with `.venv/bin/python -m engine.daily_run` only if the user asks — it fetches live data and is slow. Read `engine/` docs before touching models.
