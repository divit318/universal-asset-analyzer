"""DuckDB data layer — schema init, SQLite migration, OHLCV fetch, price matrix."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import duckdb
import polars as pl
import yfinance as yf

DB_PATH = Path(__file__).parents[2] / "data" / "engine.duckdb"
SQLITE_PATH = Path(__file__).parents[2] / "data" / "app.db"
# Read-only snapshot written atomically after each engine run.
# All API reads go here — zero DuckDB lock contention.
SCORECARD_SNAPSHOT = Path(__file__).parents[2] / "data" / "scorecard_snapshot.parquet"
DETAIL_SNAPSHOT_DIR = Path(__file__).parents[2] / "data" / "detail_snapshots"
# The Monte Carlo intrinsic-value prior for every scored symbol, in one small
# JSON map. The TypeScript side reads this file directly (see
# lib/valuation/engine-prior.ts) instead of spawning a Python reader per symbol:
# the per-symbol Parquet snapshots need polars to open, so serving one valuation
# prior used to cost a whole interpreter start-up. One flat map, read once and
# cached in memory, serves the Research Hub strip and the whole Register.
VALUATION_PRIORS = Path(__file__).parents[2] / "data" / "valuation_priors.json"

_DDL = """
CREATE TABLE IF NOT EXISTS price_daily (
    symbol      VARCHAR NOT NULL,
    date        DATE NOT NULL,
    open        DOUBLE,
    high        DOUBLE,
    low         DOUBLE,
    close       DOUBLE,
    adj_close   DOUBLE,
    volume      BIGINT,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS fundamentals (
    symbol                  VARCHAR PRIMARY KEY,
    name                    VARCHAR,
    sector                  VARCHAR,
    industry                VARCHAR,
    forward_pe              DOUBLE,
    ev_to_ebitda            DOUBLE,
    revenue_growth_yoy      DOUBLE,
    revenue_cagr_3y         DOUBLE,
    eps_growth_yoy          DOUBLE,
    eps_cagr_3y             DOUBLE,
    roic                    DOUBLE,
    roe                     DOUBLE,
    gross_margin            DOUBLE,
    operating_margin        DOUBLE,
    debt_to_equity          DOUBLE,
    net_debt_to_ebitda      DOUBLE,
    current_ratio           DOUBLE,
    fcf_margin              DOUBLE,
    fcf_growth_yoy          DOUBLE,
    dividend_yield          DOUBLE,
    buyback_yield           DOUBLE,
    institutional_ownership DOUBLE,
    earnings_surprise_pct   DOUBLE,
    ebitda                  DOUBLE,
    free_cashflow           DOUBLE,
    shares_outstanding      DOUBLE,
    market_cap              DOUBLE,
    updated_at              TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS features_daily (
    symbol  VARCHAR NOT NULL,
    date    DATE NOT NULL,
    feature VARCHAR NOT NULL,
    value   DOUBLE,
    PRIMARY KEY (symbol, date, feature)
);

CREATE TABLE IF NOT EXISTS regime_daily (
    symbol          VARCHAR NOT NULL,
    date            DATE NOT NULL,
    regime          INTEGER,        -- 0=Bull 1=Bear 2=Range 3=Crash 4=Recovery
    regime_label    VARCHAR,
    prob_bull       DOUBLE,
    prob_bear       DOUBLE,
    prob_range      DOUBLE,
    prob_crash      DOUBLE,
    prob_recovery   DOUBLE,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS factors_daily (
    symbol          VARCHAR NOT NULL,
    date            DATE NOT NULL,
    momentum        DOUBLE,
    quality         DOUBLE,
    value           DOUBLE,
    low_vol         DOUBLE,
    revision        DOUBLE,
    composite       DOUBLE,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS forecasts (
    symbol          VARCHAR NOT NULL,
    date            DATE NOT NULL,
    horizon_days    INTEGER NOT NULL,
    p10             DOUBLE,
    p25             DOUBLE,
    p50             DOUBLE,
    p75             DOUBLE,
    p90             DOUBLE,
    prob_up         DOUBLE,
    PRIMARY KEY (symbol, date, horizon_days)
);

CREATE TABLE IF NOT EXISTS mc_valuation (
    symbol          VARCHAR NOT NULL,
    date            DATE NOT NULL,
    intrinsic_p10   DOUBLE,
    intrinsic_p25   DOUBLE,
    intrinsic_p50   DOUBLE,
    intrinsic_p75   DOUBLE,
    intrinsic_p90   DOUBLE,
    wacc            DOUBLE,
    terminal_growth DOUBLE,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS scorecard_daily (
    symbol          VARCHAR NOT NULL,
    date            DATE NOT NULL,
    momentum_score  DOUBLE,
    quality_score   DOUBLE,
    value_score     DOUBLE,
    low_vol_score   DOUBLE,
    revision_score  DOUBLE,
    regime_score    DOUBLE,
    forecast_score  DOUBLE,
    mc_upside       DOUBLE,
    kelly_fraction  DOUBLE,
    composite_score DOUBLE,
    signal          VARCHAR,
    confidence      DOUBLE,
    PRIMARY KEY (symbol, date)
);

-- IC-derived factor weights, one row per run date. Lets the UI show that the
-- model's factor weighting adapts over time (not hardcoded), and chart the
-- historical evolution of which factor has been carrying the most signal.
CREATE TABLE IF NOT EXISTS ic_weights_daily (
    date        DATE NOT NULL,
    universe    VARCHAR NOT NULL,
    momentum    DOUBLE,
    quality     DOUBLE,
    value       DOUBLE,
    low_vol     DOUBLE,
    revision    DOUBLE,
    regime      DOUBLE,
    mc_upside   DOUBLE,
    PRIMARY KEY (date, universe)
);
"""

_CAMEL_TO_SNAKE = {
    "symbol": "symbol",
    "name": "name",
    "sector": "sector",
    "industry": "industry",
    "forwardPE": "forward_pe",
    "evToEbitda": "ev_to_ebitda",
    "revenueGrowthYoY": "revenue_growth_yoy",
    "revenueCagr3y": "revenue_cagr_3y",
    "epsGrowthYoY": "eps_growth_yoy",
    "epsCagr3y": "eps_cagr_3y",
    "roic": "roic",
    "roe": "roe",
    "grossMargin": "gross_margin",
    "operatingMargin": "operating_margin",
    "debtToEquity": "debt_to_equity",
    "netDebtToEbitda": "net_debt_to_ebitda",
    "currentRatio": "current_ratio",
    "fcfMargin": "fcf_margin",
    "fcfGrowthYoY": "fcf_growth_yoy",
    "dividendYield": "dividend_yield",
    "buybackYield": "buyback_yield",
    "institutionalOwnership": "institutional_ownership",
    "earningsSurprisePct": "earnings_surprise_pct",
    "ebitda": "ebitda",
    "freeCashflow": "free_cashflow",
    "sharesOutstanding": "shares_outstanding",
    "marketCap": "market_cap",
}


def get_db() -> duckdb.DuckDBPyConnection:
    """Return a DuckDB connection, initialising schema on first call."""
    conn = duckdb.connect(str(DB_PATH))
    conn.execute("PRAGMA threads=8")  # use all P-cores on Apple Silicon
    conn.execute(_DDL)
    # Idempotent migrations for columns added after initial schema creation
    _migrate_schema(conn)
    return conn


def _migrate_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Add columns that were not present in the initial schema. Safe to call repeatedly."""
    fund_cols = {r[0] for r in conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name='fundamentals'"
    ).fetchall()}
    if "shares_outstanding" not in fund_cols:
        conn.execute("ALTER TABLE fundamentals ADD COLUMN shares_outstanding DOUBLE")
    if "market_cap" not in fund_cols:
        conn.execute("ALTER TABLE fundamentals ADD COLUMN market_cap DOUBLE")
    # When enrichment last *attempted* this symbol, as opposed to when it last
    # succeeded. Selecting enrichment candidates on "CAGR is still NULL" alone
    # meant every symbol whose upstream has no CAGR data was re-fetched on every
    # single run, forever — the condition it waits on can never become false.
    if "enrichment_attempted_at" not in fund_cols:
        conn.execute("ALTER TABLE fundamentals ADD COLUMN enrichment_attempted_at TIMESTAMP")

    scorecard_cols = {r[0] for r in conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name='scorecard_daily'"
    ).fetchall()}
    if "low_vol_score" not in scorecard_cols:
        conn.execute("ALTER TABLE scorecard_daily ADD COLUMN low_vol_score DOUBLE")
    if "revision_score" not in scorecard_cols:
        conn.execute("ALTER TABLE scorecard_daily ADD COLUMN revision_score DOUBLE")


def prune_derived_history(conn: duckdb.DuckDBPyConnection) -> dict[str, int]:
    """
    Drop derived rows that no reader consumes, and report how many went.

    `features_daily` is read at exactly one date per symbol (its own MAX), by the
    detail panel. The engine nonetheless wrote the full five-year long-format
    expansion — about 70,000 rows per symbol per run — which grew the table to
    15.4M rows and engine.duckdb to 1.1GB. The cost was not only disk: DuckDB's
    checkpoint on close took ~25s, and the per-symbol scans it forced exhausted
    the process file-descriptor limit and crashed 250-name runs outright.

    `regime_daily` is read at most 90 days back (dashboard) / 60 rows (detail),
    so anything past a year of per-symbol history is also dead weight.

    Everything removed here is recomputed from price_daily on the next run, so
    this is a cache eviction, not a data loss. Cheap and idempotent — running it
    on an already-pruned database deletes nothing.
    """
    removed: dict[str, int] = {}

    for table, sql in (
        ("features_daily", """
            DELETE FROM features_daily
            WHERE (symbol, date) NOT IN (
                SELECT symbol, MAX(date) FROM features_daily GROUP BY symbol
            )
        """),
        ("regime_daily", """
            DELETE FROM regime_daily
            WHERE date < (SELECT MAX(date) FROM regime_daily) - INTERVAL 365 DAY
        """),
    ):
        try:
            before = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.execute(sql)
            after = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            removed[table] = before - after
        except Exception:
            removed[table] = 0

    return removed


def migrate_sqlite_to_duckdb(force: bool = False) -> int:
    """
    Migrate fundamentals_cache from SQLite JSON blobs → DuckDB columnar table.
    Returns number of rows upserted.  Idempotent when force=False.
    """
    conn = get_db()

    if not force:
        existing = conn.execute("SELECT COUNT(*) FROM fundamentals").fetchone()[0]
        if existing > 0:
            conn.close()
            return existing

    if not SQLITE_PATH.exists():
        conn.close()
        return 0

    sqlite_conn = sqlite3.connect(str(SQLITE_PATH))
    rows = sqlite_conn.execute(
        "SELECT symbol, data FROM fundamentals_cache"
    ).fetchall()
    sqlite_conn.close()

    records: list[dict] = []
    for symbol, raw in rows:
        try:
            blob = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        rec: dict = {}
        for camel, snake in _CAMEL_TO_SNAKE.items():
            val = blob.get(camel)
            rec[snake] = val
        if rec.get("symbol") is None:
            rec["symbol"] = symbol
        records.append(rec)

    if not records:
        conn.close()
        return 0

    df = pl.DataFrame(records, infer_schema_length=len(records))

    # Ensure all expected columns exist (fill missing with null)
    target_cols = list(_CAMEL_TO_SNAKE.values())
    for col in target_cols:
        if col not in df.columns:
            df = df.with_columns(pl.lit(None).alias(col))

    # Cast numeric columns to Float64
    float_cols = [c for c in target_cols if c not in ("symbol", "name", "sector", "industry")]
    df = df.with_columns([pl.col(c).cast(pl.Float64, strict=False) for c in float_cols])

    conn.register("_mig_tmp", df.to_arrow())
    conn.execute("""
        INSERT OR REPLACE INTO fundamentals (
            symbol, name, sector, industry,
            forward_pe, ev_to_ebitda,
            revenue_growth_yoy, revenue_cagr_3y,
            eps_growth_yoy, eps_cagr_3y,
            roic, roe, gross_margin, operating_margin,
            debt_to_equity, net_debt_to_ebitda, current_ratio,
            fcf_margin, fcf_growth_yoy,
            dividend_yield, buyback_yield,
            institutional_ownership, earnings_surprise_pct,
            ebitda, free_cashflow,
            shares_outstanding, market_cap,
            updated_at
        )
        SELECT
            symbol, name, sector, industry,
            forward_pe, ev_to_ebitda,
            revenue_growth_yoy, revenue_cagr_3y,
            eps_growth_yoy, eps_cagr_3y,
            roic, roe, gross_margin, operating_margin,
            debt_to_equity, net_debt_to_ebitda, current_ratio,
            fcf_margin, fcf_growth_yoy,
            dividend_yield, buyback_yield,
            institutional_ownership, earnings_surprise_pct,
            ebitda, free_cashflow,
            shares_outstanding, market_cap,
            now()
        FROM _mig_tmp
    """)
    conn.unregister("_mig_tmp")

    n = conn.execute("SELECT COUNT(*) FROM fundamentals").fetchone()[0]
    conn.close()
    return n


def fetch_ohlcv(
    symbols: list[str],
    period: str = "5y",
    interval: str = "1d",
    fetch_share_counts: bool = True,
) -> int:
    """
    Download OHLCV from yfinance and upsert into price_daily.
    Returns total rows inserted.

    `fetch_share_counts=False` skips the per-symbol `fast_info` round-trip that
    refreshes shares_outstanding / market_cap. Those move on corporate-action
    timescales, not daily, so a same-day price top-up has no reason to pay ~250
    sequential HTTP requests for them. See `daily_run` for who opts out.
    """
    conn = get_db()

    tickers = yf.download(
        symbols,
        period=period,
        interval=interval,
        auto_adjust=True,
        progress=False,
        threads=True,
    )

    if tickers.empty:
        conn.close()
        return 0

    # yfinance returns MultiIndex columns (field, symbol) even for a single
    # ticker (confirmed on 1.5.2). The previous single-symbol branch read
    # row.get("Open") against those tuple keys, got None for every field, and
    # silently wrote a full history of NULL prices — which is why ^GSPC/^NSEI
    # held 1254 all-NULL rows and the index-level HMM never trained.
    frames: list[pl.DataFrame] = []
    fields = ["Open", "High", "Low", "Close", "Volume"]

    if tickers.columns.nlevels == 1:
        per_symbol = [(symbols[0], tickers)] if len(symbols) == 1 else []
    else:
        available = set(tickers.columns.get_level_values(1))
        per_symbol = [(s, tickers.xs(s, axis=1, level=1)) for s in symbols if s in available]

    for sym, sub in per_symbol:
        if sub.empty or not all(f in sub.columns for f in fields):
            continue
        # Vectorized: one Arrow-backed frame per symbol instead of a Python
        # dict per (symbol, date). A 250-name 5y pull is ~310k rows, and
        # building those dicts row by row cost more than the download.
        dates = pl.Series("date", sub.index.strftime("%Y-%m-%d").to_numpy(), dtype=pl.Utf8)
        frames.append(pl.DataFrame({
            "symbol":    pl.Series("symbol", [sym] * len(sub), dtype=pl.Utf8),
            "date":      dates,
            "open":      pl.Series(sub["Open"].to_numpy(),   dtype=pl.Float64),
            "high":      pl.Series(sub["High"].to_numpy(),   dtype=pl.Float64),
            "low":       pl.Series(sub["Low"].to_numpy(),    dtype=pl.Float64),
            "close":     pl.Series(sub["Close"].to_numpy(),  dtype=pl.Float64),
            "adj_close": pl.Series(sub["Close"].to_numpy(),  dtype=pl.Float64),
            "volume":    pl.Series(sub["Volume"].to_numpy(), dtype=pl.Float64),
        }))

    if not frames:
        conn.close()
        return 0

    # NaN → NULL so downstream null checks (and the >0 filters in regime/factor
    # code) see missing bars as missing rather than as NaN floats.
    df = pl.concat(frames).with_columns(
        [pl.col(c).fill_nan(None) for c in ("open", "high", "low", "close", "adj_close", "volume")]
    )
    conn.register("_price_tmp", df.to_arrow())
    conn.execute("""
        INSERT OR REPLACE INTO price_daily
        SELECT symbol, date::DATE, open, high, low, close, adj_close, volume::BIGINT
        FROM _price_tmp
    """)
    conn.unregister("_price_tmp")

    # Fetch shares_outstanding + market_cap and upsert into fundamentals.
    # Network I/O per symbol — threaded since yfinance's HTTP calls release
    # the GIL while waiting, so this parallelizes for real.
    if fetch_share_counts:
        def _fetch_fast_info(sym: str) -> tuple[str, float | None, float | None]:
            try:
                fi = yf.Ticker(sym).fast_info
                shares = getattr(fi, "shares", None)
                mktcap = getattr(fi, "market_cap", None)
                return sym, (float(shares) if shares else None), (float(mktcap) if mktcap else None)
            except Exception:
                return sym, None, None

        updates: list[tuple[str, float | None, float | None]] = []
        with ThreadPoolExecutor(max_workers=min(16, max(1, len(symbols)))) as ex:
            for sym, shares, mktcap in ex.map(_fetch_fast_info, symbols):
                if shares or mktcap:
                    updates.append((sym, shares, mktcap))
        if updates:
            # One statement instead of one UPDATE per symbol.
            upd = pl.DataFrame(
                {
                    "symbol": [u[0] for u in updates],
                    "shares_outstanding": [u[1] for u in updates],
                    "market_cap": [u[2] for u in updates],
                },
                schema={"symbol": pl.Utf8, "shares_outstanding": pl.Float64, "market_cap": pl.Float64},
            )
            conn.register("_fastinfo_tmp", upd.to_arrow())
            conn.execute("""
                UPDATE fundamentals f
                SET shares_outstanding = t.shares_outstanding,
                    market_cap         = t.market_cap
                FROM _fastinfo_tmp t
                WHERE f.symbol = t.symbol
            """)
            conn.unregister("_fastinfo_tmp")

    conn.close()
    return len(df)


_FINANCIAL_SECTORS = frozenset({
    "Financial Services", "Banking", "Insurance", "Banks—Diversified",
    "Banks—Regional", "Capital Markets", "Insurance—Life", "Insurance—Property & Casualty",
    "Financials", "Asset Management", "Mortgage Finance",
})


def _compute_roic_safe(ticker, info: dict) -> float | None:
    """
    ROIC = NOPAT / Invested Capital from balance sheet.
    NOPAT = EBIT × (1 - effective_tax_rate)
    Invested Capital = Total Assets - Cash - Accounts Payable

    For financial sector: use ROE as proxy (ROIC is not meaningful for banks).
    Falls back to ROA-based approximation when balance sheet is unavailable.
    """
    def _sf(v) -> float | None:
        try:
            f = float(v)
            return f if f == f else None
        except (TypeError, ValueError):
            return None

    sector = info.get("sector", "")
    if sector in _FINANCIAL_SECTORS:
        roe = _sf(info.get("returnOnEquity"))
        return roe * 100.0 if roe is not None else None

    try:
        bs = ticker.balance_sheet
        if bs is None or bs.empty:
            raise ValueError("no balance sheet")

        # EBIT: try direct, fall back to operating income
        ebit = _sf(info.get("ebit"))
        if ebit is None:
            ebitda = _sf(info.get("ebitda"))
            da = _sf(info.get("depreciation"))
            if ebitda is not None and da is not None:
                ebit = ebitda - da
        if ebit is None or ebit <= 0:
            raise ValueError("no ebit")

        tax_rate = _sf(info.get("effectiveTaxRate")) or 0.21
        nopat = ebit * (1.0 - min(max(tax_rate, 0.0), 0.50))

        def _bs_row(labels):
            for lbl in labels:
                try:
                    v = float(bs.loc[lbl].iloc[0])
                    if v == v:
                        return v
                except (KeyError, IndexError, TypeError):
                    continue
            return None

        total_assets = _bs_row(["Total Assets"])
        cash = _bs_row(["Cash And Cash Equivalents", "Cash", "Cash Cash Equivalents And Short Term Investments"])
        ap   = _bs_row(["Accounts Payable", "Payables"])

        if total_assets is None or total_assets <= 0:
            raise ValueError("no total assets")

        invested_capital = total_assets - (cash or 0) - (ap or 0)
        if invested_capital <= 0:
            raise ValueError("invested capital <= 0")

        return float(nopat / invested_capital * 100.0)

    except Exception:
        # Fallback: ROA-based approximation
        roa = _sf(info.get("returnOnAssets"))
        d_e = _sf(info.get("debtToEquity"))
        if roa is not None and d_e is not None:
            return roa * 100.0 * (1.0 + max(d_e, 0) / 100.0)
        if roa is not None:
            return roa * 100.0
        return None


def _fetch_one_fundamental(sym: str) -> tuple[str, list] | None:
    """
    Fetch + compute one symbol's fundamentals row (all network I/O; no DB
    access). Split out of fetch_fundamentals so the network-bound part can
    run on a thread pool — yf.Ticker(...).info / .balance_sheet are blocking
    HTTP calls that release the GIL while waiting, so this parallelizes for
    real even under CPython's GIL.
    """
    def _sf(v) -> float | None:
        try:
            f = float(v)
            return f if f == f else None
        except (TypeError, ValueError):
            return None

    try:
        ticker = yf.Ticker(sym)
        info = ticker.info
        if not info or info.get("quoteType") not in ("EQUITY", "ETF", "MUTUALFUND", None):
            # quoteType missing on some tickers — try anyway
            if not info:
                return None

        # Revenue growth: yfinance gives revenueGrowth as a fraction (0.125 = 12.5%)
        rev_growth = _sf(info.get("revenueGrowth"))
        rev_growth_pct = rev_growth * 100.0 if rev_growth is not None else None

        # Margins: yfinance gives as fractions — convert to %
        def _pct(key):
            v = _sf(info.get(key))
            return v * 100.0 if v is not None else None

        # ROE/ROA are fractions in yfinance
        roe = _sf(info.get("returnOnEquity"))
        roe_pct = roe * 100.0 if roe is not None else None

        # ROIC: use NOPAT / Invested Capital from balance sheet when available.
        # Falls back to ROA-based approximation for financials and missing data.
        roic = _compute_roic_safe(ticker, info)

        # FCF margin: freeCashflow / totalRevenue
        fcf = _sf(info.get("freeCashflow"))
        rev = _sf(info.get("totalRevenue"))
        fcf_margin = (fcf / rev * 100.0) if (fcf is not None and rev and rev > 0) else None

        # EPS growth YoY: (forwardEps - trailingEps) / |trailingEps|
        fwd_eps = _sf(info.get("forwardEps"))
        trail_eps = _sf(info.get("trailingEps"))
        if fwd_eps and trail_eps and abs(trail_eps) > 1e-6:
            eps_growth = (fwd_eps - trail_eps) / abs(trail_eps) * 100.0
        else:
            eps_growth = None

        # Dividend yield: yfinance gives as fraction
        div_yield = _sf(info.get("dividendYield"))
        div_yield_pct = div_yield * 100.0 if div_yield is not None else None

        return sym, [
            sym,
            info.get("longName") or info.get("shortName"),
            info.get("sector"),
            info.get("industry"),
            _sf(info.get("forwardPE")),
            _sf(info.get("enterpriseToEbitda")),
            rev_growth_pct,
            eps_growth,
            roic,
            roe_pct,
            _pct("grossMargins"),
            _pct("operatingMargins"),
            _sf(info.get("debtToEquity")),
            _sf(info.get("currentRatio")),
            fcf_margin,
            div_yield_pct,
            _sf(info.get("ebitda")),
            fcf,
            _sf(info.get("sharesOutstanding")),
            _sf(info.get("marketCap")),
        ]
    except Exception:
        return None


def fetch_fundamentals(symbols: list[str], max_workers: int = 8) -> int:
    """
    Fetch fundamentals from yfinance Ticker.info for each symbol and upsert
    into the fundamentals table. Covers all symbols — US and Indian (.NS).
    Network fetch is parallelized across a thread pool; DB writes stay
    sequential on the caller's connection. Returns number of rows upserted.
    """
    conn = get_db()
    upserted = 0

    with ThreadPoolExecutor(max_workers=min(max_workers, max(1, len(symbols)))) as ex:
        for result in ex.map(_fetch_one_fundamental, symbols):
            if result is None:
                continue
            _sym, values = result
            conn.execute("""
                INSERT OR REPLACE INTO fundamentals (
                    symbol, name, sector, industry,
                    forward_pe, ev_to_ebitda,
                    revenue_growth_yoy,
                    eps_growth_yoy,
                    roic, roe,
                    gross_margin, operating_margin,
                    debt_to_equity, current_ratio,
                    fcf_margin,
                    dividend_yield,
                    ebitda, free_cashflow,
                    shares_outstanding, market_cap,
                    updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,now())
            """, values)
            upserted += 1

    conn.close()
    return upserted


def get_price_matrix(
    symbols: list[str],
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> pl.LazyFrame:
    """
    Return a zero-copy DuckDB→Polars LazyFrame of adj_close prices.
    Shape: rows=dates, cols=symbols (pivoted).
    """
    conn = get_db()

    where_parts = [f"symbol IN ({','.join('?' for _ in symbols)})"]
    params: list = list(symbols)
    if start:
        where_parts.append("date >= ?::DATE")
        params.append(start)
    if end:
        where_parts.append("date <= ?::DATE")
        params.append(end)

    where = " AND ".join(where_parts)
    df = conn.execute(
        f"SELECT symbol, date, adj_close FROM price_daily WHERE {where} ORDER BY date",
        params,
    ).fetchdf()
    conn.close()

    lf = pl.from_pandas(df).lazy()
    # Pivot: date × symbol
    lf = lf.collect().pivot(
        index="date", on="symbol", values="adj_close"
    ).lazy()
    return lf


def get_symbols_with_prices(min_days: int = 252) -> list[str]:
    """Return symbols that have at least min_days of price history."""
    conn = get_db()
    rows = conn.execute("""
        SELECT symbol FROM price_daily
        GROUP BY symbol
        HAVING COUNT(*) >= ?
        ORDER BY symbol
    """, [min_days]).fetchall()
    conn.close()
    return [r[0] for r in rows]


def save_ic_weights(
    conn: duckdb.DuckDBPyConnection,
    run_date,
    weights: dict[str, float],
    universe: str = "default",
) -> None:
    """
    Persist this run's IC-derived factor weights so the UI can show that the
    composite isn't a fixed formula — it's re-weighted from realized
    predictive power every run — and chart how factor leadership rotates
    over time.
    """
    conn.execute("""
        INSERT OR REPLACE INTO ic_weights_daily
            (date, universe, momentum, quality, value, low_vol, revision, regime, mc_upside)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        run_date, universe,
        weights.get("momentum", 0.0), weights.get("quality", 0.0), weights.get("value", 0.0),
        weights.get("low_vol", 0.0), weights.get("revision", 0.0),
        weights.get("regime", 0.0), weights.get("mc_upside", 0.0),
    ])


def export_scorecard_snapshot(
    conn: duckdb.DuckDBPyConnection,
    scored_df: "pl.DataFrame",
) -> None:
    """
    Write an atomic Parquet snapshot of THIS run's scorecard joined with fundamentals.
    Only contains symbols from the current run — never mixes universes.
    Uses write-to-tmp + rename to prevent partial reads from the API.
    """
    SCORECARD_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)

    if scored_df.is_empty():
        return

    # Join current run's scorecard with fundamentals name/sector
    fund_df = conn.execute("SELECT symbol, name, sector FROM fundamentals").pl()
    df = scored_df.join(fund_df, on="symbol", how="left")

    # Reorder: symbol, date, name, sector first for readability
    front_cols = ["symbol", "date", "name", "sector"]
    rest = [c for c in df.columns if c not in front_cols]
    df = df.select(front_cols + rest)

    tmp = SCORECARD_SNAPSHOT.with_suffix(".parquet.tmp")
    df.write_parquet(str(tmp))
    tmp.rename(SCORECARD_SNAPSHOT)


def export_valuation_priors(conn: duckdb.DuckDBPyConnection) -> None:
    """
    Write the Monte Carlo intrinsic-value prior for every symbol to one JSON map.

    Consumed by lib/valuation/engine-prior.ts, which reads it with plain fs and
    caches it against the file's mtime — so in steady state a valuation prior
    costs no subprocess at all. Written atomically via a temp file so a reader
    never observes a half-written map.
    """
    try:
        rows = conn.execute(
            """
            SELECT m.symbol, m.date, m.intrinsic_p10, m.intrinsic_p25, m.intrinsic_p50,
                   m.intrinsic_p75, m.intrinsic_p90, m.wacc, m.terminal_growth
            FROM mc_valuation m
            JOIN (SELECT symbol, MAX(date) AS d FROM mc_valuation GROUP BY symbol) latest
              ON m.symbol = latest.symbol AND m.date = latest.d
            """
        ).fetchall()
    except Exception:
        return

    priors: dict[str, dict] = {}
    run_date = None
    for (sym, date, p10, p25, p50, p75, p90, wacc, tg) in rows:
        if p50 is None:
            continue
        run_date = run_date or (str(date) if date is not None else None)
        priors[str(sym)] = {
            "p10": p10, "p25": p25, "p50": p50, "p75": p75, "p90": p90,
            "wacc": wacc, "terminalGrowth": tg,
            "asOf": str(date) if date is not None else None,
        }

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "runDate": run_date,
        "count": len(priors),
        "priors": priors,
    }

    VALUATION_PRIORS.parent.mkdir(parents=True, exist_ok=True)
    tmp = VALUATION_PRIORS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, default=str))
    tmp.rename(VALUATION_PRIORS)


def export_detail_snapshots(conn: duckdb.DuckDBPyConnection, symbols: list[str]) -> None:
    """
    Write per-symbol detail Parquet snapshots for all scored symbols.
    Each file: data/detail_snapshots/{symbol}.parquet
    Contains regime, forecasts, MC, features, factor history, prices, fundamentals.

    Each of the eight tables is read once for the whole symbol list and
    partitioned in-process. The previous shape was eight queries *per symbol* —
    ~2,000 DuckDB round-trips for a 250-name universe, against a database large
    enough that each scan was not free.
    """
    DETAIL_SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    if not symbols:
        return

    # Per-table batched query + how to trim each symbol's partition.
    # `n` is the per-symbol row cap, matching the single-symbol LIMITs.
    specs: list[tuple[str, str, int | None]] = [
        ("fundamentals",
         "SELECT * FROM fundamentals WHERE symbol IN (SELECT UNNEST(?))", None),
        ("scorecard",
         "SELECT * FROM scorecard_daily WHERE symbol IN (SELECT UNNEST(?)) "
         "ORDER BY symbol, date DESC", 1),
        ("regime",
         "SELECT * FROM regime_daily WHERE symbol IN (SELECT UNNEST(?)) "
         "ORDER BY symbol, date DESC", 90),
        ("forecasts",
         "SELECT * FROM forecasts WHERE symbol IN (SELECT UNNEST(?)) "
         "ORDER BY symbol, date DESC, horizon_days", None),
        ("mc",
         "SELECT * FROM mc_valuation WHERE symbol IN (SELECT UNNEST(?)) "
         "ORDER BY symbol, date DESC", 1),
        ("factor_history",
         "SELECT * FROM factors_daily WHERE symbol IN (SELECT UNNEST(?)) "
         "ORDER BY symbol, date DESC", 90),
        ("prices",
         "SELECT symbol, date, close, volume FROM price_daily "
         "WHERE symbol IN (SELECT UNNEST(?)) ORDER BY symbol, date DESC", 252),
    ]

    by_table: dict[str, dict[str, pl.DataFrame]] = {}
    for tname, sql, cap in specs:
        try:
            df = conn.execute(sql, [symbols]).pl()
        except Exception:
            by_table[tname] = {}
            continue
        parts: dict[str, pl.DataFrame] = {}
        if not df.is_empty():
            # `prices` was selected without a symbol column when queried per
            # symbol; keep the snapshot schema byte-for-byte the same.
            drop_symbol = tname == "prices"
            for part in df.partition_by("symbol", maintain_order=True):
                sym = part["symbol"][0]
                if cap is not None:
                    part = part.head(cap)
                parts[sym] = part.drop("symbol") if drop_symbol else part
        by_table[tname] = parts

    # features_daily is keyed on each symbol's own latest date, so it needs a
    # per-symbol max rather than a flat row cap.
    try:
        feat = conn.execute("""
            SELECT f.symbol, f.feature, f.value
            FROM features_daily f
            JOIN (SELECT symbol, MAX(date) AS d FROM features_daily
                  WHERE symbol IN (SELECT UNNEST(?)) GROUP BY symbol) latest
              ON f.symbol = latest.symbol AND f.date = latest.d
            ORDER BY f.symbol, f.feature
        """, [symbols]).pl()
    except Exception:
        feat = pl.DataFrame()
    feat_parts: dict[str, pl.DataFrame] = {}
    if not feat.is_empty():
        for part in feat.partition_by("symbol", maintain_order=True):
            feat_parts[part["symbol"][0]] = part.select(["feature", "value"])
    by_table["features"] = feat_parts

    order = ["fundamentals", "scorecard", "regime", "forecasts", "mc",
             "features", "factor_history", "prices"]

    for sym in symbols:
        try:
            tables = {t: by_table.get(t, {}).get(sym, pl.DataFrame()) for t in order}
            if all(df.is_empty() for df in tables.values()):
                continue

            # JSON packing keeps heterogeneous schemas in one Parquet file.
            meta = {t: df.to_pandas().to_json(orient="records", date_format="iso")
                    for t, df in tables.items()}
            meta_df = pl.DataFrame({"key": list(meta.keys()), "json": list(meta.values())})

            tmp = DETAIL_SNAPSHOT_DIR / f"{sym}.parquet.tmp"
            out = DETAIL_SNAPSHOT_DIR / f"{sym}.parquet"
            meta_df.write_parquet(str(tmp))
            tmp.rename(out)
        except Exception:
            pass
