"""DuckDB data layer — schema init, SQLite migration, OHLCV fetch, price matrix."""

from __future__ import annotations

import json
import sqlite3
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

    scorecard_cols = {r[0] for r in conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name='scorecard_daily'"
    ).fetchall()}
    if "low_vol_score" not in scorecard_cols:
        conn.execute("ALTER TABLE scorecard_daily ADD COLUMN low_vol_score DOUBLE")
    if "revision_score" not in scorecard_cols:
        conn.execute("ALTER TABLE scorecard_daily ADD COLUMN revision_score DOUBLE")


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
        INSERT OR REPLACE INTO fundamentals
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
) -> int:
    """
    Download OHLCV from yfinance and upsert into price_daily.
    Returns total rows inserted.
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

    # yfinance multi-ticker returns MultiIndex columns: (field, symbol)
    single = len(symbols) == 1
    rows: list[dict] = []

    def _safe_float(v) -> float | None:
        try:
            f = float(v)
            return f if f == f else None  # NaN check
        except (TypeError, ValueError):
            return None

    def _safe_int(v) -> int | None:
        f = _safe_float(v)
        return int(f) if f is not None else None

    if single:
        sym = symbols[0]
        for date, row in tickers.iterrows():
            rows.append({
                "symbol": sym,
                "date": str(date.date()),
                "open": _safe_float(row.get("Open")),
                "high": _safe_float(row.get("High")),
                "low": _safe_float(row.get("Low")),
                "close": _safe_float(row.get("Close")),
                "adj_close": _safe_float(row.get("Close")),
                "volume": _safe_int(row.get("Volume")),
            })
    else:
        for sym in symbols:
            try:
                sub = tickers.xs(sym, axis=1, level=1)
            except KeyError:
                continue
            for date, row in sub.iterrows():
                rows.append({
                    "symbol": sym,
                    "date": str(date.date()),
                    "open": _safe_float(row.get("Open")),
                    "high": _safe_float(row.get("High")),
                    "low": _safe_float(row.get("Low")),
                    "close": _safe_float(row.get("Close")),
                    "adj_close": _safe_float(row.get("Close")),
                    "volume": _safe_int(row.get("Volume")),
                })

    if not rows:
        conn.close()
        return 0

    # Explicit schema prevents type-inference failures when yfinance returns
    # mixed int/float volumes or nulls scattered across the batch.
    df = pl.DataFrame(rows, schema={
        "symbol":    pl.Utf8,
        "date":      pl.Utf8,
        "open":      pl.Float64,
        "high":      pl.Float64,
        "low":       pl.Float64,
        "close":     pl.Float64,
        "adj_close": pl.Float64,
        "volume":    pl.Float64,   # cast to BIGINT in SQL; Float64 accepts int/float/null
    })
    conn.register("_price_tmp", df.to_arrow())
    conn.execute("""
        INSERT OR REPLACE INTO price_daily
        SELECT symbol, date::DATE, open, high, low, close, adj_close, volume::BIGINT
        FROM _price_tmp
    """)
    conn.unregister("_price_tmp")

    # Fetch shares_outstanding + market_cap and upsert into fundamentals
    for sym in symbols:
        try:
            fi = yf.Ticker(sym).fast_info
            shares = getattr(fi, "shares", None)
            mktcap = getattr(fi, "market_cap", None)
            if shares or mktcap:
                conn.execute("""
                    UPDATE fundamentals
                    SET shares_outstanding = ?, market_cap = ?
                    WHERE symbol = ?
                """, [float(shares) if shares else None,
                      float(mktcap) if mktcap else None,
                      sym])
        except Exception:
            pass

    conn.close()
    return len(rows)


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


def fetch_fundamentals(symbols: list[str]) -> int:
    """
    Fetch fundamentals from yfinance Ticker.info for each symbol and upsert
    into the fundamentals table. Covers all symbols — US and Indian (.NS).
    Returns number of rows upserted.
    """
    conn = get_db()

    def _sf(v) -> float | None:
        try:
            f = float(v)
            return f if f == f else None
        except (TypeError, ValueError):
            return None

    upserted = 0
    for sym in symbols:
        try:
            info = yf.Ticker(sym).info
            if not info or info.get("quoteType") not in ("EQUITY", "ETF", "MUTUALFUND", None):
                # quoteType missing on some tickers — try anyway
                if not info:
                    continue

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
            roic = _compute_roic_safe(yf.Ticker(sym), info)

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
            """, [
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
            ])
            upserted += 1
        except Exception:
            pass

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


def export_detail_snapshots(conn: duckdb.DuckDBPyConnection, symbols: list[str]) -> None:
    """
    Write per-symbol detail Parquet snapshots for all scored symbols.
    Each file: data/detail_snapshots/{symbol}.parquet
    Contains regime, forecasts, MC, features, factor history, prices, fundamentals.
    """
    DETAIL_SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

    for sym in symbols:
        try:
            tables: dict[str, pl.DataFrame] = {}

            tables["fundamentals"] = conn.execute(
                "SELECT * FROM fundamentals WHERE symbol = ?", [sym]
            ).pl()

            tables["scorecard"] = conn.execute(
                "SELECT * FROM scorecard_daily WHERE symbol = ? ORDER BY date DESC LIMIT 1", [sym]
            ).pl()

            tables["regime"] = conn.execute(
                "SELECT * FROM regime_daily WHERE symbol = ? ORDER BY date DESC LIMIT 90", [sym]
            ).pl()

            tables["forecasts"] = conn.execute(
                "SELECT * FROM forecasts WHERE symbol = ? ORDER BY date DESC, horizon_days", [sym]
            ).pl()

            tables["mc"] = conn.execute(
                "SELECT * FROM mc_valuation WHERE symbol = ? ORDER BY date DESC LIMIT 1", [sym]
            ).pl()

            tables["features"] = conn.execute(
                "SELECT feature, value FROM features_daily WHERE symbol = ? "
                "AND date = (SELECT MAX(date) FROM features_daily WHERE symbol = ?) "
                "ORDER BY feature", [sym, sym]
            ).pl()

            tables["factor_history"] = conn.execute(
                "SELECT * FROM factors_daily WHERE symbol = ? ORDER BY date DESC LIMIT 90", [sym]
            ).pl()

            tables["prices"] = conn.execute(
                "SELECT date, close, volume FROM price_daily WHERE symbol = ? "
                "ORDER BY date DESC LIMIT 252", [sym]
            ).pl()

            # Pack all tables into one Parquet using a metadata key column
            parts = []
            for tname, df in tables.items():
                if df.is_empty():
                    continue
                df = df.with_columns(pl.lit(tname).alias("_table"))
                parts.append(df)

            if not parts:
                continue

            # Write each table as separate columns — use JSON packing for heterogeneous schemas
            meta = {tname: df.to_pandas().to_json(orient="records", date_format="iso")
                    for tname, df in tables.items()}
            meta_df = pl.DataFrame({"key": list(meta.keys()), "json": list(meta.values())})

            tmp = DETAIL_SNAPSHOT_DIR / f"{sym}.parquet.tmp"
            out = DETAIL_SNAPSHOT_DIR / f"{sym}.parquet"
            meta_df.write_parquet(str(tmp))
            tmp.rename(out)
        except Exception:
            pass
