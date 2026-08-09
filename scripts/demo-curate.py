#!/usr/bin/env python3
"""
Demo curation: rebuild user state around one coherent investment story —
Reddit (RDDT) as the centerpiece, surrounded by a small set of recognizable,
high-quality public companies (GTLB, COIN, ABNB, DASH, CART, DBX).

Idempotent: deletes the demo-irrelevant rows and re-inserts the curated set.
A backup of the previous state lives at data/app.db.bak-demo-prep.
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "data" / "app.db"

def ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)

con = sqlite3.connect(DB)
cur = con.cursor()

# ── Watchlist ────────────────────────────────────────────────────────────────
# RDDT is the centerpiece (researching, with a live target). ABNB/DASH are
# owned. The rest are surfaced by real platform surfaces (screener/wire/compare).
WATCHLIST = [
    # symbol, name, added_at, target, alert_drop, notes, stage, stage_at, dir, source, detail
    ("RDDT", "Reddit, Inc.", "2026-07-21T14:05:12.000Z", 210.0, 8.0,
     "Fastest-growing ad platform at scale: +61% revenue YoY at 91% gross margin, forward P/E ~16. "
     "Ad load and international ARPU still early vs. META; data-licensing revenue is pure upside. IC review in progress.",
     "researching", ms("2026-08-03T09:30:00Z"), "above", "screener", "Quality growth screen · rank #2"),
    ("GTLB", "GitLab Inc.", "2026-07-24T10:22:41.000Z", 45.0, None,
     "DevSecOps platform compounding 30%+ with FCF inflection. Watching net seat expansion and AI add-on attach.",
     "researching", ms("2026-08-01T08:15:00Z"), "above", "screener", "Quality growth screen · rank #6"),
    ("COIN", "Coinbase Global, Inc.", "2026-07-28T09:41:03.000Z", None, None, None,
     "surfaced", None, None, "wire", "Crypto infrastructure theme"),
    ("CART", "Maplebear Inc. (Instacart)", "2026-07-30T16:03:27.000Z", None, None, None,
     "surfaced", None, None, "compare", "Compared with RDDT, DASH"),
    ("DBX", "Dropbox, Inc.", "2026-07-31T11:19:55.000Z", None, None, None,
     "surfaced", None, None, "screener", "FCF yield screen · rank #4"),
    ("ABNB", "Airbnb, Inc.", "2026-04-10T13:12:00.000Z", 175.0, None,
     "Core marketplace position. Bookings growth durable; Experiences relaunch a free option.",
     "owned", ms("2026-04-15T15:40:00Z"), "above", "research", "equity"),
    ("DASH", "DoorDash, Inc.", "2026-05-08T10:05:00.000Z", 220.0, None,
     "Category leader still compounding order frequency; grocery + advertising attach inflecting.",
     "owned", ms("2026-05-15T16:05:00Z"), "above", "research", "equity"),
]

cur.execute("DELETE FROM watchlist")
cur.execute("DELETE FROM watchlist_member")
for (sym, name, added, tgt, drop, notes, stage, stage_at, tdir, src, detail) in WATCHLIST:
    cur.execute(
        """INSERT INTO watchlist (symbol, name, added_at, target_price, alert_pct_drop, notes,
                                  stage, stage_changed_at, target_direction, source, source_detail)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (sym, name, added, tgt, drop, notes, stage, stage_at, tdir, src, detail))
    cur.execute("INSERT INTO watchlist_member (group_id, symbol, added_at) VALUES (1, ?, ?)", (sym, added))

# ── Portfolio ledger ─────────────────────────────────────────────────────────
# A deliberate, diversified book: S&P 500 core, quality mega-cap compounders,
# two owned marketplace names (ABNB, DASH), duration via IEF, and a cash sleeve
# that funds the RDDT decision at the end of the flow. Every lot is priced at
# the actual close of its trade date.
LOTS = [
    # symbol, name, shares, price, trade_date, asset_class, unit, meta
    ("VOO",      "Vanguard S&P 500 ETF",                320,   627.99, "2026-02-17", "etf",    "shares",   None),
    ("IEF",      "iShares 7-10 Year Treasury Bond ETF", 1600,  97.20,  "2026-02-17", "bond",   "shares",   None),
    ("GOOGL",    "Alphabet Inc.",                       240,   302.02, "2026-02-17", "equity", "shares",   None),
    ("CASH-USD", "USD Cash",                            250000, 1.0,   "2026-02-17", "cash",   "currency", '{"yieldPct":null,"vehicle":null}'),
    ("MSFT",     "Microsoft Corporation",               180,   399.95, "2026-03-16", "equity", "shares",   None),
    ("JPM",      "JPMorgan Chase & Co.",                220,   286.16, "2026-03-16", "equity", "shares",   None),
    ("ABNB",     "Airbnb, Inc.",                        400,   137.51, "2026-04-15", "equity", "shares",   None),
    ("VOO",      "Vanguard S&P 500 ETF",                130,   679.44, "2026-05-15", "etf",    "shares",   None),
    ("DASH",     "DoorDash, Inc.",                      300,   159.20, "2026-05-15", "equity", "shares",   None),
    ("META",     "Meta Platforms, Inc.",                110,   593.48, "2026-06-15", "equity", "shares",   None),
    ("MSFT",     "Microsoft Corporation",               70,    395.63, "2026-07-15", "equity", "shares",   None),
]

cur.execute("DELETE FROM portfolio_lot")
cur.execute("DELETE FROM portfolio")          # legacy table, superseded by the lot ledger
cur.execute("DELETE FROM manual_asset")       # placeholder/test assets removed
cur.execute("DELETE FROM portfolio_snapshot") # snapshots of the old test ledger
for (sym, name, shares, price, date, cls, unit, meta) in LOTS:
    cur.execute(
        """INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date,
                                      created_at, asset_class, currency, unit, meta, portfolio_id)
           VALUES (?,?,?,?, 'buy', 0.0, ?, ?, ?, 'USD', ?, ?, 1)""",
        (sym, name, shares, price, date, f"{date}T15:30:00.000Z", cls, unit, meta))

# ── Decision journal ─────────────────────────────────────────────────────────
cur.execute("DELETE FROM decision")
DECISIONS = [
    ("ABNB", "Airbnb, Inc.", "buy", 4,
     "Travel demand proving durable; bookings growth with expanding margins at a reasonable multiple. "
     "Experiences relaunch is a free option on the core network.",
     137.51, "USD", 175.0, "12-18m", "2026-04-15T15:42:00.000Z"),
    ("DASH", "DoorDash, Inc.", "buy", 4,
     "Category leader still compounding order frequency; grocery and advertising attach rates inflecting. "
     "Sized at ~5% with room to add on weakness.",
     159.20, "USD", 220.0, "12-18m", "2026-05-15T16:05:00.000Z"),
]
for (sym, name, action, conv, thesis, price, ccy, tgt, horizon, created) in DECISIONS:
    cur.execute(
        """INSERT INTO decision (symbol, name, action, conviction, thesis, price_at, currency,
                                 target_price, horizon, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,'open',?)""",
        (sym, name, action, conv, thesis, price, ccy, tgt, horizon, created))

# ── Research copilot history ─────────────────────────────────────────────────
cur.execute("DELETE FROM research_message")
cur.execute("DELETE FROM research_session")

SESSION_ID = "9f2e41c8-53a1-4a6f-9b7e-2c8d17e4a501"
cur.execute("INSERT INTO research_session (id, symbol, created_at, updated_at) VALUES (?,?,?,?)",
            (SESSION_ID, "RDDT", "2026-08-05T18:20:11.000Z", "2026-08-06T09:06:02.000Z"))

MESSAGES = [
    ("user", "Build the bull and bear case for Reddit ahead of our IC review.", "2026-08-05T18:20:11.000Z"),
    ("assistant",
     "**Bull case**\n\n"
     "1. **Fastest-growing ad platform at scale.** Revenue grew ~61% YoY — faster than META, PINS or SNAP at "
     "comparable scale — on a 91% gross margin, and the model has already turned GAAP-profitable (EPS +178% YoY).\n"
     "2. **The ARPU gap is the thesis.** Reddit monetizes a US user at a fraction of Meta's rate. Ad load is still "
     "low, international is barely monetized, and machine-translation is expanding the addressable inventory.\n"
     "3. **Data licensing is pure-margin optionality.** LLM training deals (Google, OpenAI) already annualize in "
     "the hundreds of millions and are not yet reflected in consensus estimates.\n"
     "4. **Balance sheet is clean.** Effectively debt-free (D/E ~0.006) with ROE >30% — rare for a company at "
     "this stage of the growth curve.\n\n"
     "**Bear case**\n\n"
     "1. **Traffic concentration.** A meaningful share of logged-out users arrive via Google search; algorithm "
     "shifts can move DAU quarter to quarter.\n"
     "2. **Ad diversification.** Advertiser base is still narrower than mature platforms; a soft brand-spend "
     "cycle hits harder.\n"
     "3. **Multiple compression risk.** At ~34x EV/EBITDA the stock needs continued execution; any growth "
     "deceleration below ~40% re-rates it quickly.\n\n"
     "**Net:** growth-adjusted, the valuation is undemanding — forward P/E ~16 against a 3-year revenue CAGR of "
     "~49%. The risk is traffic dependence, not the business model. Recommend advancing to a full IC review with "
     "a position size that respects the DAU volatility.",
     "2026-08-05T18:21:37.000Z"),
    ("user", "How does Reddit's ad monetization compare to Meta and Pinterest?", "2026-08-06T09:04:48.000Z"),
    ("assistant",
     "Reddit's ad business is roughly where Meta's was a decade ago — and that is the opportunity:\n\n"
     "| Dimension | RDDT | PINS | META |\n"
     "|---|---|---|---|\n"
     "| Revenue growth (YoY) | **~61%** | ~mid-teens | ~20% |\n"
     "| Gross margin | **91%** | ~80% | ~82% |\n"
     "| Monetization maturity | Early | Mid | Late |\n\n"
     "Three structural levers Meta has already pulled that Reddit has not:\n\n"
     "1. **Ad load** — Reddit's feed carries materially fewer ads per session than Instagram or Facebook.\n"
     "2. **International ARPU** — Reddit's non-US ARPU is a small fraction of its US ARPU; Meta closed that gap "
     "over ~8 years.\n"
     "3. **Performance tooling** — conversion APIs and automated bidding are 2-3 years behind Meta's stack, "
     "which is why ROAS-driven budgets are only now arriving.\n\n"
     "Unlike Pinterest, Reddit adds a second engine: **data licensing**. Its corpus is uniquely valuable for LLM "
     "training and carries near-100% incremental margin.\n\n"
     "The comparison supports the thesis: Reddit does not need to invent a model — it needs to execute a playbook "
     "Meta has already validated.",
     "2026-08-06T09:06:02.000Z"),
]
for role, content, created in MESSAGES:
    cur.execute(
        "INSERT INTO research_message (session_id, role, content, meta, created_at) VALUES (?,?,?,NULL,?)",
        (SESSION_ID, role, content, created))

# ── Recent activity (home "continue where you left off") ────────────────────
cur.execute("DELETE FROM activity")
ACTIVITY = [
    ("RDDT", "RDDT — Reddit, Inc.",        "2026-08-06T09:06:04.998Z"),
    ("GTLB", "GTLB — GitLab Inc.",         "2026-08-06T09:05:48.428Z"),
    ("DASH", "DASH — DoorDash, Inc.",      "2026-08-06T09:04:41.655Z"),
    ("ABNB", "ABNB — Airbnb, Inc.",        "2026-08-05T19:38:12.000Z"),
    ("COIN", "COIN — Coinbase Global, Inc.", "2026-08-04T16:12:45.000Z"),
    ("CART", "CART — Maplebear Inc. (Instacart)", "2026-08-03T15:05:30.000Z"),
    ("DBX",  "DBX — Dropbox, Inc.",        "2026-08-02T11:47:18.000Z"),
]
for ref, label, at in ACTIVITY:
    cur.execute("INSERT INTO activity (kind, ref, label, href, at) VALUES ('research', ?, ?, ?, ?)",
                (ref, label, f"/research?symbol={ref}", at))

# ── Valuation register / IC reports: clear off-story artifacts ──────────────
# (RDDT/ABNB/DASH cases are re-seeded through the live API after this script.)
cur.execute("DELETE FROM valuation_case")
cur.execute("DELETE FROM valuation_event")
cur.execute("DELETE FROM ic_report")

# ── Misc cleanup ─────────────────────────────────────────────────────────────
cur.execute("DELETE FROM notification")          # referenced a removed holding (NEM)
cur.execute("DELETE FROM price_alert_state")     # rebuilt by the monitor for the new watchlist
cur.execute("DELETE FROM chart_drawing")         # stray QQQ test drawing
cur.execute("DELETE FROM attention_dismissal")   # stale dismissal for a removed signal
cur.execute("UPDATE simulation SET name = 'Balanced Growth Mandate' WHERE name = 'Big Account'")

con.commit()

# ── Report ───────────────────────────────────────────────────────────────────
for table in ["watchlist", "portfolio_lot", "decision", "research_session",
              "research_message", "activity", "valuation_case", "ic_report"]:
    n = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    print(f"{table:20s} {n}")
con.close()
print("Done.")
