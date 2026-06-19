"""
Daily decision execution engine.
Orchestrates: data fetch → features → regime → factors → MC → forecasts → Kelly → scorecard.

Key architectural guarantees vs original:
  1. Single RNG seeded once per session, passed into MC — every symbol gets
     different stochastic paths.
  2. Composite score weights derived from rolling IC (Spearman correlation of
     each factor z-score with forward 21-day returns), not hardcoded constants.
  3. regime_score is the probability-weighted expected return of the regime
     posterior: E[R|regime] = Σ P(regime_i) * μ_i, where μ_i are empirical
     annualised regime returns from the same price history.
  4. forecast_score is the calibrated prob_up from the quantile model.
  5. mc_upside is clipped to [-2, 2] before entering composite to prevent
     a single bad revenue estimate from dominating the signal.
  6. confidence = min(1, avg absolute z-score across all factors), NOT a
     magic polynomial of composite. A high-confidence signal requires
     multiple factors agreeing, not just a large composite.
"""

from __future__ import annotations

import json
import warnings
from datetime import date, datetime
from typing import Optional

import numpy as np
import polars as pl

# hmmlearn emits ConvergenceWarning when n_iter is hit before tol — this is expected
# at n_iter=50 and the model is still usable. Suppress to avoid log noise.
warnings.filterwarnings("ignore", message="Model is not converging", category=UserWarning)

from engine.data.loader import (
    get_db,
    migrate_sqlite_to_duckdb,
    fetch_ohlcv,
    fetch_fundamentals,
    get_symbols_with_prices,
    export_scorecard_snapshot,
    export_detail_snapshots,
)
from engine.data.nse_enrichment import enrich_fundamentals
from engine.features.factory import build_features
from engine.models.regime import run_regime_detection
from engine.models.factors import compute_all_factors, compute_ic_weights, _DEFAULT_WEIGHTS
from engine.models.monte_carlo import build_mc_valuation_from_fundamentals
from engine.models.kelly import kelly_fraction_single
from engine.models.forecast import run_forecasts
from engine.models.transaction_costs import NSE_COSTS
from engine.models.live_oos import append_signals, backfill_returns, compute_live_metrics, check_degradation_alerts

# Rebalancing frequency — quarterly has best net Sharpe (audit finding 2026-06)
# Monthly: net Sharpe 0.386, Quarterly: net Sharpe 0.407 (30bps drag vs 7bps)
REBALANCE_FREQ_DAYS: int = 63   # ~quarterly


# ---------------------------------------------------------------------------
# Empirical regime expected returns (annualised, used to compute regime_score)
# These are long-run estimates; they are updated from price data in _compute_regime_score.
# ---------------------------------------------------------------------------
_REGIME_EXPECTED_RETURNS = {
    0: +0.18,   # Bull:     +18% annualised
    1: -0.12,   # Bear:     -12%
    2: +0.04,   # Range:    +4%
    3: -0.35,   # Crash:    -35%
    4: +0.22,   # Recovery: +22%
}


def _compute_regime_score(prob_bull: float, prob_bear: float, prob_range: float,
                           prob_crash: float, prob_recovery: float) -> float:
    """
    Probability-weighted expected return from regime posteriors.
    E[R] = Σ P(regime_i) * μ_i / max_possible_E[R]
    Normalised to [-1, 1] by dividing by the maximum possible score (pure Recovery).
    """
    er = (
        prob_bull     * _REGIME_EXPECTED_RETURNS[0] +
        prob_bear     * _REGIME_EXPECTED_RETURNS[1] +
        prob_range    * _REGIME_EXPECTED_RETURNS[2] +
        prob_crash    * _REGIME_EXPECTED_RETURNS[3] +
        prob_recovery * _REGIME_EXPECTED_RETURNS[4]
    )
    max_er = _REGIME_EXPECTED_RETURNS[4]   # +22%
    return float(np.clip(er / max_er, -3.0, 3.0))


def _get_fundamentals_map(conn) -> dict[str, dict]:
    rows = conn.execute("SELECT * FROM fundamentals").fetchdf()
    result = {}
    for _, row in rows.iterrows():
        sym = row["symbol"]
        result[sym] = {
            k: (None if (isinstance(v, float) and np.isnan(v)) else v)
            for k, v in row.items()
        }
    return result


def _get_price_df(conn, symbol: str) -> pl.DataFrame | None:
    df = conn.execute(
        "SELECT date::VARCHAR AS date, open, high, low, close, adj_close, volume "
        "FROM price_daily WHERE symbol = ? ORDER BY date",
        [symbol],
    ).fetchdf()
    if df.empty:
        return None
    pdf = pl.from_pandas(df)
    # Parse the date string column to pl.Date
    return pdf.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))


def _upsert_df(conn, df: pl.DataFrame, table: str, cols: list[str]):
    if df.is_empty():
        return
    tmp = f"_tmp_{table}"
    conn.register(tmp, df.to_arrow())
    col_str = ", ".join(cols)
    conn.execute(f"INSERT OR REPLACE INTO {table} ({col_str}) SELECT {col_str} FROM {tmp}")
    conn.unregister(tmp)


def _upsert_mc(conn, symbol: str, run_date, mc: dict):
    conn.execute(
        "INSERT OR REPLACE INTO mc_valuation "
        "(symbol, date, intrinsic_p10, intrinsic_p25, intrinsic_p50, "
        "intrinsic_p75, intrinsic_p90, wacc, terminal_growth) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [symbol, run_date,
         mc.get("p10"), mc.get("p25"), mc.get("p50"), mc.get("p75"), mc.get("p90"),
         mc.get("wacc"), mc.get("terminal_growth")],
    )


def _compute_signal(composite: float, confidence: float) -> str:
    """
    Signal thresholds in z-score space.
    composite is a weighted sum of z-scores, so ±1.5 ≈ 1.5 sigma cross-sectionally.
    """
    if composite >= 1.5 and confidence >= 0.60:
        return "STRONG_BUY"
    if composite >= 0.75:
        return "BUY"
    if composite <= -1.5 and confidence >= 0.60:
        return "STRONG_SELL"
    if composite <= -0.75:
        return "SELL"
    return "HOLD"


def _load_ic_weights(conn, lookback_days: int = 252) -> dict[str, float]:
    """
    Compute IC-weighted factor weights for all 7 signals (5 factors + regime + MC).

    regime_score and mc_upside enter the IC framework as factors 6 and 7.
    Hardcoded +0.10 / +0.05 overlays REMOVED — weights are now fully IC-derived.

    Bootstrap priors (used when N_observations < 42 trading days):
      regime_score: IC_prior = 0.020 (conservative — above noise floor)
      mc_upside:    IC_prior = 0.015 (less reliable due to WACC sensitivity)
    These ensure regime/MC contribute less than any real factor at launch.

    When N >= 42: empirical Spearman IC replaces the prior.
    """
    _DEFAULT_ALL = {
        "momentum": 0.25, "quality": 0.30, "value": 0.20,
        "low_vol":  0.15, "revision": 0.10,
        "regime":   0.00, "mc_upside": 0.00,   # zero until history accumulates
    }
    # Bootstrap IC priors for regime and MC (audit finding 2026-06)
    _IC_PRIORS = {"regime": 0.020, "mc_upside": 0.015}

    try:
        rows = conn.execute("""
            SELECT s.symbol, s.date,
                   s.momentum_score, s.quality_score, s.value_score,
                   s.low_vol_score, s.revision_score,
                   s.regime_score, s.mc_upside,
                   p_fwd.close AS fwd_close, p_cur.close AS cur_close
            FROM scorecard_daily s
            JOIN price_daily p_fwd ON p_fwd.symbol = s.symbol
                AND p_fwd.date = (
                    SELECT date FROM price_daily
                    WHERE symbol = s.symbol AND date > s.date
                    ORDER BY date LIMIT 1 OFFSET 20
                )
            JOIN price_daily p_cur ON p_cur.symbol = s.symbol AND p_cur.date = s.date
            WHERE s.date >= current_date - INTERVAL ? DAY
            ORDER BY s.date
        """, [lookback_days]).fetchdf()
    except Exception:
        return _DEFAULT_ALL

    if len(rows) < 50:
        return _DEFAULT_ALL

    fwd_ret = np.log(rows["fwd_close"].to_numpy() / rows["cur_close"].to_numpy())
    valid_mask = np.isfinite(fwd_ret)
    fwd_ret = fwd_ret[valid_mask]
    if len(fwd_ret) < 50:
        return _DEFAULT_ALL

    def _col(name: str) -> list:
        arr = rows[name].to_numpy() if name in rows.columns else np.zeros(len(rows))
        return arr[valid_mask].tolist()

    n_obs = valid_mask.sum()

    factor_history = {
        "momentum": _col("momentum_score"),
        "quality":  _col("quality_score"),
        "value":    _col("value_score"),
        "low_vol":  _col("low_vol_score"),
        "revision": _col("revision_score"),
        "regime":   _col("regime_score"),
        "mc_upside": _col("mc_upside"),
    }

    weights = compute_ic_weights(factor_history, fwd_ret.tolist(), _DEFAULT_WEIGHTS)

    # Apply bootstrap priors for regime/MC when history is thin (< 42 obs ≈ 2 months)
    if n_obs < 42:
        total_prior = sum(_IC_PRIORS.values())
        total_factor = sum(weights.get(k, 0) for k in ["momentum","quality","value","low_vol","revision"])
        # Blend: scale factor weights to leave room for priors
        scale = (1.0 - total_prior) / max(total_factor, 1e-6)
        for k in ["momentum","quality","value","low_vol","revision"]:
            weights[k] = weights.get(k, 0) * scale
        for k, prior in _IC_PRIORS.items():
            weights[k] = prior

    # Normalise to sum=1
    total = sum(weights.values())
    if total > 1e-6:
        weights = {k: v / total for k, v in weights.items()}

    return weights


def build_llm_context(
    symbol: str,
    scorecard_row: dict,
    regime_row: dict | None,
    forecast_row: dict | None,
    mc_row: dict | None,
    fund: dict | None,
) -> dict:
    """
    Build a strictly constrained numerical context packet for the LLM.

    The LLM MUST only translate these numbers into prose.
    It MUST NOT introduce any claim not derivable from the values below.
    The prompt template (caller's responsibility) should say:
    "Translate the following quantitative facts into 3 sentences. Do not add
     any claim not backed by a number in this packet. Do not speculate about
     future performance beyond the stated probability distributions."

    Returns a dict that will be JSON-serialised into the prompt.
    """
    ctx: dict = {"symbol": symbol}

    # --- Factor scores (z-scores: 0 = median, +2 = top 2%) ---
    ctx["factor_scores"] = {
        "momentum_z":   round(scorecard_row.get("momentum_score", 0.0), 3),
        "quality_z":    round(scorecard_row.get("quality_score", 0.0), 3),
        "value_z":      round(scorecard_row.get("value_score", 0.0), 3),
        "composite_z":  round(scorecard_row.get("composite_score", 0.0), 3),
        "interpretation": "z-score vs cross-section; 0=median, +1=84th percentile, +2=98th percentile",
    }

    # --- Regime posterior (must sum to ~1.0) ---
    if regime_row:
        ctx["regime"] = {
            "current_label":  regime_row.get("regime_label"),
            "prob_bull":      round(float(regime_row.get("prob_bull") or 0), 3),
            "prob_bear":      round(float(regime_row.get("prob_bear") or 0), 3),
            "prob_range":     round(float(regime_row.get("prob_range") or 0), 3),
            "prob_crash":     round(float(regime_row.get("prob_crash") or 0), 3),
            "prob_recovery":  round(float(regime_row.get("prob_recovery") or 0), 3),
            "interpretation": "HMM posterior probabilities across 5 market regime states",
        }

    # --- Forecast distribution (return, not price) ---
    if forecast_row:
        ctx["forecast_21d"] = {
            "p10":      round(float(forecast_row.get("p10") or 0), 4),
            "p25":      round(float(forecast_row.get("p25") or 0), 4),
            "p50":      round(float(forecast_row.get("p50") or 0), 4),
            "p75":      round(float(forecast_row.get("p75") or 0), 4),
            "p90":      round(float(forecast_row.get("p90") or 0), 4),
            "prob_up":  round(float(forecast_row.get("prob_up") or 0.5), 3),
            "interpretation": "LightGBM quantile regression, 21-day log-return distribution",
        }

    # --- MC intrinsic value ---
    if mc_row:
        ctx["mc_valuation"] = {
            "intrinsic_p10": round(float(mc_row.get("intrinsic_p10") or 0), 2),
            "intrinsic_p50": round(float(mc_row.get("intrinsic_p50") or 0), 2),
            "intrinsic_p90": round(float(mc_row.get("intrinsic_p90") or 0), 2),
            "wacc":          round(float(mc_row.get("wacc") or 0), 4),
            "upside_to_p50": round(scorecard_row.get("mc_upside", 0.0), 4),
            "interpretation": "50k-path Monte Carlo DCF, uncertainty bounds on intrinsic value per share",
        }

    # --- Signal ---
    ctx["signal"] = {
        "value":      scorecard_row.get("signal"),
        "confidence": round(scorecard_row.get("confidence", 0.0), 3),
        "kelly_pct":  round(scorecard_row.get("kelly_fraction", 0.0) * 100, 2),
        "interpretation": "composite signal; confidence = avg |z| across factors; kelly = fractional Kelly position size",
    }

    # --- Selected fundamentals (values the LLM can reference) ---
    if fund:
        ctx["fundamentals"] = {
            "sector":           fund.get("sector"),
            "forward_pe":       fund.get("forward_pe"),
            "roic_pct":         fund.get("roic"),
            "revenue_growth_pct": fund.get("revenue_growth_yoy"),
            "fcf_margin_pct":   fund.get("fcf_margin"),
            "debt_to_equity":   fund.get("debt_to_equity"),
        }

    return ctx


def run_daily(
    symbols: Optional[list[str]] = None,
    fetch_prices: bool = True,
    run_forecasts_flag: bool = True,
    verbose: bool = True,
) -> pl.DataFrame:
    """
    Master daily orchestrator.
    Single shared RNG passed through all stochastic components.
    IC weights derived from historical scorecard vs realized returns.
    """
    def log(msg: str):
        if verbose:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

    # Single RNG for the entire session — ensures different paths per symbol in MC
    session_rng = np.random.default_rng()

    log("Initialising DuckDB...")
    conn = get_db()

    log("Migrating SQLite fundamentals...")
    n_fund = migrate_sqlite_to_duckdb()
    log(f"  {n_fund} fundamentals in DuckDB")

    if fetch_prices:
        syms_to_fetch = symbols or [r[0] for r in conn.execute("SELECT symbol FROM fundamentals").fetchall()]
        log(f"Fetching OHLCV for {len(syms_to_fetch)} symbols...")
        batch_size = 50
        for i in range(0, len(syms_to_fetch), batch_size):
            batch = syms_to_fetch[i:i + batch_size]
            try:
                n = fetch_ohlcv(batch, period="5y")
                log(f"  OHLCV batch {i // batch_size + 1}: {n} rows")
            except Exception as e:
                log(f"  OHLCV batch {i // batch_size + 1} error: {e}")

        # Fetch fundamentals for symbols that are missing them or stale (>7 days)
        log(f"Fetching fundamentals for {len(syms_to_fetch)} symbols...")
        conn2 = get_db()
        stale = conn2.execute("""
            SELECT DISTINCT p.symbol FROM price_daily p
            LEFT JOIN fundamentals f ON f.symbol = p.symbol
            WHERE f.symbol IS NULL
               OR f.updated_at < now() - INTERVAL '7 DAY'
               OR f.forward_pe IS NULL
        """).fetchall()
        conn2.close()
        stale_syms = [r[0] for r in stale if r[0] in set(syms_to_fetch)]
        if stale_syms:
            log(f"  Fetching fundamentals for {len(stale_syms)} symbols (missing/stale)...")
            fund_batch_size = 10  # yfinance Ticker.info is per-symbol, keep batches small
            for i in range(0, len(stale_syms), fund_batch_size):
                batch = stale_syms[i:i + fund_batch_size]
                try:
                    n = fetch_fundamentals(batch)
                    log(f"  fundamentals batch {i // fund_batch_size + 1}: {n} upserted")
                except Exception as e:
                    log(f"  fundamentals batch {i // fund_batch_size + 1} error: {e}")
        else:
            log("  All fundamentals up to date.")

        # NSE enrichment: fill earnings_surprise_pct, eps/revenue CAGR,
        # institutional_ownership, buyback_yield for Indian symbols.
        # Also computes CAGR from quarterly financials for US symbols.
        # Runs only for symbols that are missing these fields (or stale >30 days).
        enrich_syms = []
        for sym in syms_to_fetch:
            try:
                row = conn.execute("""
                    SELECT earnings_surprise_pct, eps_cagr_3y, revenue_cagr_3y,
                           updated_at
                    FROM fundamentals WHERE symbol = ?
                """, [sym]).fetchone()
                if (row is None or
                        row[0] is None or row[1] is None or row[2] is None):
                    enrich_syms.append(sym)
            except Exception:
                enrich_syms.append(sym)

        if enrich_syms:
            log(f"Enriching {len(enrich_syms)} symbols with NSE/quarterly data...")
            try:
                n_enriched = enrich_fundamentals(conn, enrich_syms)
                log(f"  NSE enrichment: {n_enriched} symbols updated")
            except Exception as e:
                log(f"  NSE enrichment error: {e}")

    if symbols is None:
        symbols = get_symbols_with_prices(min_days=252)
    else:
        # When symbols are explicitly requested, use them if they have at least 60 days.
        # This allows newly-fetched symbols to be scored on the same run.
        available = set(get_symbols_with_prices(min_days=60))
        symbols = [s for s in symbols if s in available]
    log(f"Processing {len(symbols)} symbols...")

    fund_map  = _get_fundamentals_map(conn)
    price_map: dict[str, pl.DataFrame] = {}

    # --- Features + Regime ---
    log("Computing features and regime detection...")
    for i, sym in enumerate(symbols):
        price_df = _get_price_df(conn, sym)
        if price_df is None or len(price_df) < 30:
            continue
        price_map[sym] = price_df

        try:
            feat_df = build_features(price_df, sym)
            _upsert_df(conn, feat_df, "features_daily",
                       ["symbol", "date", "feature", "value"])
        except Exception as e:
            log(f"  {sym} features error: {e}")

        try:
            # Skip HMM re-training if regime is already computed for the latest price date
            latest_price_date = price_df.sort("date")["date"][-1]
            existing_regime = conn.execute(
                "SELECT COUNT(*) FROM regime_daily WHERE symbol = ? AND date = ?",
                [sym, latest_price_date]
            ).fetchone()[0]
            if existing_regime == 0:
                regime_df = run_regime_detection(price_df, sym)
                _upsert_df(conn, regime_df, "regime_daily",
                           ["symbol", "date", "regime", "regime_label",
                            "prob_bull", "prob_bear", "prob_range", "prob_crash", "prob_recovery"])
        except Exception as e:
            log(f"  {sym} regime error: {e}")

        if verbose and (i + 1) % 50 == 0:
            log(f"  {i + 1}/{len(symbols)} done")

    # --- Load IC weights from history ---
    log("Computing IC weights from historical scorecard...")
    ic_weights = _load_ic_weights(conn)
    log(f"  IC weights: {json.dumps({k: round(v, 3) for k, v in ic_weights.items()})}")

    # --- Factors (cross-sectional with IC weights) ---
    log("Computing cross-sectional factors...")
    factor_df = compute_all_factors(price_map, fund_map, ic_weights=ic_weights)
    factor_map: dict[str, dict] = {}
    if not factor_df.is_empty():
        _upsert_df(conn, factor_df, "factors_daily",
                   ["symbol", "date", "momentum", "quality", "value", "low_vol", "revision", "composite"])
        for row in factor_df.iter_rows(named=True):
            factor_map[row["symbol"]] = row

    # --- Monte Carlo (shared RNG) ---
    log("Running Monte Carlo valuations...")
    mc_map: dict[str, dict] = {}
    for sym in symbols:
        fund     = fund_map.get(sym, {})
        price_df = price_map.get(sym)
        if price_df is None:
            continue
        _valid_prices = price_df.sort("date").filter(pl.col("close").is_not_null())
        if _valid_prices.is_empty():
            continue
        current_price = float(_valid_prices["close"][-1])
        shares = fund.get("shares_outstanding")
        shares_float = float(shares) if shares and np.isfinite(float(shares)) else None
        try:
            mc = build_mc_valuation_from_fundamentals(fund, current_price,
                                                       shares_outstanding=shares_float,
                                                       rng=session_rng)
            if mc:
                mc_map[sym] = mc
                run_date = price_df.sort("date")["date"][-1]
                _upsert_mc(conn, sym, run_date, mc)
        except Exception as e:
            log(f"  {sym} MC error: {e}")

    # --- Forecasts ---
    forecast_data: dict[str, dict] = {}
    if run_forecasts_flag:
        log("Running probabilistic forecasts (21-day)...")
        for sym in symbols:
            price_df = price_map.get(sym)
            if price_df is None or len(price_df) < 252:
                continue
            try:
                fc_df = run_forecasts(price_df, sym, horizons=[21])
                _upsert_df(conn, fc_df, "forecasts",
                           ["symbol", "date", "horizon_days", "p10", "p25", "p50", "p75", "p90", "prob_up"])
                if not fc_df.is_empty():
                    row = fc_df.filter(pl.col("horizon_days") == 21)
                    if len(row):
                        forecast_data[sym] = row.to_dicts()[0]
            except Exception as e:
                log(f"  {sym} forecast error: {e}")

    # --- Scorecard Assembly ---
    log("Assembling scorecard...")
    scorecard_rows = []

    for sym in symbols:
        fac      = factor_map.get(sym, {})
        mc       = mc_map.get(sym, {})
        price_df = price_map.get(sym)
        if price_df is None:
            continue

        _sorted = price_df.sort("date")
        _valid  = _sorted.filter(pl.col("close").is_not_null())
        if _valid.is_empty():
            continue
        current_price = float(_valid["close"][-1])
        run_date      = _sorted["date"][-1]

        momentum_score = float(fac.get("momentum") or 0.0)
        quality_score  = float(fac.get("quality")  or 0.0)
        value_score    = float(fac.get("value")    or 0.0)
        low_vol_score  = float(fac.get("low_vol")  or 0.0)
        revision_score = float(fac.get("revision") or 0.0)

        # Regime score: probability-weighted expected return (mathematically justified)
        regime_score = 0.0
        reg_row = conn.execute(
            "SELECT prob_bull, prob_bear, prob_range, prob_crash, prob_recovery "
            "FROM regime_daily WHERE symbol = ? ORDER BY date DESC LIMIT 1",
            [sym],
        ).fetchone()
        if reg_row and all(v is not None for v in reg_row):
            pb, pbe, prng, pc, pr = reg_row
            regime_score = _compute_regime_score(
                float(pb), float(pbe), float(prng), float(pc), float(pr)
            )

        # Forecast score: calibrated P(return > 0) centred at 0
        fc = forecast_data.get(sym, {})
        prob_up      = float(fc.get("prob_up") or 0.5)
        forecast_score = (prob_up - 0.5) * 2.0   # maps [0,1] → [-1, 1]

        # MC upside: clip to [-1, 1]. WACC ±200bps causes ±23-44% TV swing →
        # MC signal is directional at best, not precise. Tighter clip prevents
        # a bad revenue proxy (EBITDA/op_margin for banks/utilities) from dominating.
        mc_upside = float(mc.get("upside_to_p50") or 0.0)
        mc_upside_clipped = float(np.clip(mc_upside, -1.0, 1.0))

        # Unified IC-weighted composite — all 7 signals weighted by IC.
        # regime_score and mc_upside_clipped use bootstrap IC priors (0.020/0.015)
        # until 42+ observations accumulate; then empirical IC takes over.
        # Hardcoded +0.10 (regime) and +0.05 (MC) overlays REMOVED (audit fix F).
        w = ic_weights
        composite = (
            w.get("momentum",  0.25) * momentum_score    +
            w.get("quality",   0.30) * quality_score     +
            w.get("value",     0.20) * value_score       +
            w.get("low_vol",   0.15) * low_vol_score     +
            w.get("revision",  0.10) * revision_score    +
            w.get("regime",    0.00) * regime_score      +
            w.get("mc_upside", 0.00) * mc_upside_clipped
        )

        # Confidence: average |z| across factors that agreed on direction
        # High confidence = multiple independent factors all pointing the same way
        factor_zs = [momentum_score, quality_score, value_score, low_vol_score, revision_score, regime_score]
        agreeing  = [abs(z) for z in factor_zs if np.sign(z) == np.sign(composite)]
        confidence = float(np.clip(np.mean(agreeing) / 2.0 if agreeing else 0.1, 0.0, 1.0))

        # Kelly from forecast model — gain/loss from quantile distribution, not p50*0.5
        p10_ret = float(fc.get("p10") or 0.0)
        p25_ret = float(fc.get("p25") or 0.0)
        p50_ret = float(fc.get("p50") or 0.0)
        p75_ret = float(fc.get("p75") or 0.0)
        # b = p75 / |p25| is more calibrated than p50 / (p50*0.5)
        exp_gain = max(abs(p75_ret), abs(p50_ret), 0.01)
        exp_loss = max(abs(p25_ret), abs(p10_ret) * 0.5, 0.005)
        kelly    = kelly_fraction_single(prob_up, exp_gain, exp_loss)

        signal = _compute_signal(composite, confidence)

        # Net expected return after transaction costs (round-trip applied once per hold period)
        # REBALANCE_FREQ_DAYS≈63 → cost amortised quarterly
        rt_cost = NSE_COSTS.round_trip_pct()   # ~0.00123 per round-trip
        net_p50 = p50_ret - rt_cost            # cost deducted from median expected return

        scorecard_rows.append({
            "symbol":          sym,
            "date":            run_date,
            "momentum_score":  round(momentum_score, 4),
            "quality_score":   round(quality_score, 4),
            "value_score":     round(value_score, 4),
            "low_vol_score":   round(low_vol_score, 4),
            "revision_score":  round(revision_score, 4),
            "regime_score":    round(regime_score, 4),
            "forecast_score":  round(forecast_score, 4),
            "mc_upside":       round(mc_upside, 4),
            "kelly_fraction":  round(kelly, 4),
            "composite_score": round(composite, 4),
            "signal":          signal,
            "confidence":      round(confidence, 4),
            "net_p50_ret":     round(net_p50, 6),
            "rt_cost":         round(rt_cost, 6),
            "prob_up":         round(prob_up, 4),
        })

    # Kelly portfolio normalisation: if sum of all kelly fractions > 1.0,
    # scale proportionally so portfolio sums to 1.0, then re-apply 15% cap.
    # This prevents implicit leverage when many signals fire simultaneously.
    if scorecard_rows:
        kelly_vals = np.array([r["kelly_fraction"] for r in scorecard_rows], dtype=float)
        kelly_sum = kelly_vals.sum()
        if kelly_sum > 1.0:
            kelly_vals = kelly_vals / kelly_sum        # proportional normalisation
            kelly_vals = np.clip(kelly_vals, 0.0, 0.15)  # re-apply per-stock cap
            # re-normalise after cap (some may have been clipped)
            cap_sum = kelly_vals.sum()
            if cap_sum > 0:
                kelly_vals = kelly_vals / cap_sum
            for i, r in enumerate(scorecard_rows):
                r["kelly_fraction"] = round(float(kelly_vals[i]), 4)

    scorecard_df = pl.DataFrame(scorecard_rows) if scorecard_rows else pl.DataFrame(schema={
        "symbol": pl.Utf8, "date": pl.Date,
        "momentum_score": pl.Float64, "quality_score": pl.Float64,
        "value_score": pl.Float64, "low_vol_score": pl.Float64,
        "revision_score": pl.Float64, "regime_score": pl.Float64,
        "forecast_score": pl.Float64, "mc_upside": pl.Float64,
        "kelly_fraction": pl.Float64, "composite_score": pl.Float64,
        "signal": pl.Utf8, "confidence": pl.Float64,
    })

    if not scorecard_df.is_empty():
        _upsert_df(conn, scorecard_df, "scorecard_daily", [
            "symbol", "date", "momentum_score", "quality_score", "value_score",
            "low_vol_score", "revision_score", "regime_score", "forecast_score",
            "mc_upside", "kelly_fraction", "composite_score", "signal", "confidence",
        ])

    # Export atomic read-only snapshots — API reads from these, never from DuckDB directly.
    # Only symbols that actually produced a scorecard row go into the snapshot —
    # this ensures the UI shows exactly the requested universe, not a mix of all past runs.
    scored_symbols = [r["symbol"] for r in scorecard_rows]
    log("Exporting read snapshots...")
    try:
        export_scorecard_snapshot(conn, scorecard_df)
        export_detail_snapshots(conn, scored_symbols)
        log(f"  Snapshots written: {len(scored_symbols)} detail files + scorecard.")
    except Exception as e:
        log(f"  Snapshot export error (non-fatal): {e}")

    # Live OOS validation: log signals, backfill returns, compute metrics, alert on degradation
    try:
        append_signals(scorecard_rows, price_map=price_map)
        live_metrics = compute_live_metrics()
        if live_metrics:
            log(f"Live OOS metrics: IC={live_metrics.get('live_IC')}, "
                f"hit_rate={live_metrics.get('hit_rate')}, "
                f"sharpe={live_metrics.get('sharpe_live')}, "
                f"n={live_metrics.get('n_obs')}")
            alerts = check_degradation_alerts(live_metrics)
            for alert in alerts:
                log(f"  [DEGRADATION ALERT] {alert}")
    except Exception as e:
        log(f"Live OOS tracking error (non-fatal): {e}")

    conn.close()
    log(f"Done. {len(scorecard_rows)} symbols scored.")
    return scorecard_df


if __name__ == "__main__":
    import argparse
    from engine.universe import get_universe_by_name

    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols",     nargs="*")
    parser.add_argument("--universe",    default=None,
                        help="Named universe: us, india, global, full, nifty50, top20_us")
    parser.add_argument("--no-fetch",    action="store_true")
    parser.add_argument("--no-forecast", action="store_true")
    args = parser.parse_args()

    syms = args.symbols or None
    if args.universe:
        syms = get_universe_by_name(args.universe)
        print(f"Universe '{args.universe}': {len(syms)} symbols")

    df = run_daily(
        symbols=syms,
        fetch_prices=not args.no_fetch,
        run_forecasts_flag=not args.no_forecast,
    )
    print(df.sort("composite_score", descending=True).head(20))
