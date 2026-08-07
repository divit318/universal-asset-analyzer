/**
 * Demo seed: rebuild the full demo portfolio as a ~3-month investing journey
 * (2026-05-04 → 2026-08-06) with internally consistent state everywhere.
 *
 * Design goals (see YC_MASTER_PROMPT):
 *   - Every lot is priced at the ACTUAL close of its trade date (lib/yahoo history).
 *   - Every portfolio_snapshot is computed by the REAL engines (normalizeHoldings →
 *     evaluate → summaryOf) against as-of prices and as-of-truncated history, so the
 *     Trajectory panel, health deltas and allocation drift are genuine engine output,
 *     not hand-typed numbers.
 *   - The book is deliberately underweight financials/insurance, light on income and
 *     defensives, with a double-digit cash sleeve — so researching RGA live in the
 *     demo naturally scores as an exceptional portfolio fit without any hardcoding.
 *   - Wins AND losses: COIN exited −23%, XOM rotated out −6.7%, GOOGL held underwater,
 *     ABBV bought and currently down; AMD trimmed +35% realized, MSFT/LLY/DASH/AMZN
 *     compounding. Realized P&L nets slightly positive. Nothing is 100/100.
 *
 * Idempotent: wipes and re-inserts the curated rows. A timestamped backup of
 * data/app.db is written first.
 *
 * Run: npx tsx scripts/demo-seed.ts
 */
import { copyFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildMarketContext } from "../lib/portfolio/context";
import { normalizeHoldings } from "../lib/portfolio/model/holding";
import { evaluate } from "../lib/portfolio/engines/simulate";
import { summaryOf } from "../lib/portfolio/engines/transaction";
import { listRawHoldings } from "../lib/portfolio/store";
import { contentHash, type PortfolioThesis } from "../lib/portfolio/thesis";
import { putScannerCache, appendValuationEvent } from "../lib/db";
import { computeCaseResult, coerceAssumptionSet } from "../lib/valuation/case";
import type { ContextQuote, MarketContext } from "../lib/portfolio/model/types";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

/* ────────────────────────────── The journey ─────────────────────────────── */

interface Trade {
  symbol: string;
  name: string;
  shares: number;
  price: number; // actual close of the trade date
  kind: "buy" | "sell";
  assetClass: "equity" | "etf" | "bond" | "cash";
  reason?: string;
}

interface Batch {
  date: string;      // trade_date (YYYY-MM-DD)
  time: string;      // execution time-of-day (UTC, US market hours)
  objective: string | null; // snapshot label for the trajectory "changes" list
  deposit?: number;  // new external cash, if any
  trades: Trade[];
  snapshot: boolean; // write pre/post snapshots for this execution
}

const N = {
  VOO: "Vanguard S&P 500 ETF",
  IEF: "iShares 7-10 Year Treasury Bond ETF",
  MSFT: "Microsoft Corporation",
  AMD: "Advanced Micro Devices, Inc.",
  LLY: "Eli Lilly and Company",
  V: "Visa Inc.",
  GOOGL: "Alphabet Inc.",
  COIN: "Coinbase Global, Inc.",
  ABNB: "Airbnb, Inc.",
  DASH: "DoorDash, Inc.",
  XOM: "Exxon Mobil Corporation",
  AMZN: "Amazon.com, Inc.",
  ABBV: "AbbVie Inc.",
  CASH: "USD Cash",
} as const;

const eq = (symbol: keyof typeof N, shares: number, price: number, kind: "buy" | "sell", reason?: string): Trade => ({
  symbol, name: N[symbol], shares, price, kind,
  assetClass: symbol === "VOO" ? "etf" : symbol === "IEF" ? "bond" : "equity",
  reason,
});

/** Every price below is the real adjusted close for that date (scripts/demo-closes.ts). */
const BATCHES: Batch[] = [
  { date: "2026-05-04", time: "14:41:12", objective: "balanced", deposit: 850_000, trades: [], snapshot: true },
  { date: "2026-05-05", time: "15:02:44", objective: "balanced", snapshot: true, trades: [
    eq("VOO", 290, 663.37, "buy", "Core S&P 500 position"),
    eq("IEF", 950, 93.58, "buy", "Duration sleeve — rate-cut optionality"),
  ]},
  { date: "2026-05-06", time: "17:24:05", objective: "growth", snapshot: true, trades: [
    eq("MSFT", 190, 413.07, "buy", "Azure + AI monetization at a reasonable multiple"),
  ]},
  { date: "2026-05-07", time: "15:48:30", objective: "growth", snapshot: true, trades: [
    eq("AMD", 150, 408.46, "buy", "Datacenter GPU share gains"),
    eq("LLY", 75, 973.28, "buy", "Incretin franchise compounding"),
    eq("V", 140, 320.62, "buy", "Payments toll road"),
  ]},
  { date: "2026-05-08", time: "16:10:19", objective: "growth", snapshot: true, trades: [
    eq("GOOGL", 150, 400.56, "buy", "Search + cloud, cheap vs peers"),
  ]},
  { date: "2026-05-12", time: "15:33:57", objective: "growth", snapshot: true, trades: [
    eq("COIN", 160, 207.64, "buy", "Crypto volumes cycle play (speculative, sized small)"),
    eq("ABNB", 300, 135.48, "buy", "Marketplace with Experiences optionality"),
  ]},
  { date: "2026-05-15", time: "16:05:21", objective: "growth", snapshot: true, trades: [
    eq("DASH", 220, 159.20, "buy", "Order-frequency compounding; grocery attach"),
  ]},
  { date: "2026-05-19", time: "14:55:46", objective: "growth", snapshot: true, trades: [
    eq("XOM", 280, 162.55, "buy", "Energy momentum after crude breakout"),
  ]},
  { date: "2026-06-16", time: "17:41:33", objective: "growth", snapshot: true, trades: [
    eq("LLY", 35, 1122.50, "buy", "Adding to winner after orforglipron readout"),
  ]},
  { date: "2026-06-18", time: "15:27:08", objective: "growth", snapshot: true, trades: [
    eq("DASH", 80, 173.46, "buy", "Adding — advertising attach inflecting"),
  ]},
  { date: "2026-06-22", time: "14:36:52", objective: "balanced", deposit: 250_000, trades: [], snapshot: true },
  { date: "2026-06-23", time: "15:12:40", objective: "balanced", snapshot: true, trades: [
    eq("MSFT", 80, 373.94, "buy", "Adding on 12% drawdown — thesis unchanged"),
    eq("VOO", 126, 674.38, "buy", "Deploying new capital into core"),
  ]},
  { date: "2026-06-25", time: "17:58:14", objective: "growth", snapshot: true, trades: [
    eq("AMZN", 180, 227.01, "buy", "AWS re-acceleration; retail margin story intact"),
  ]},
  { date: "2026-07-01", time: "15:44:03", objective: null, snapshot: true, trades: [
    eq("COIN", 160, 159.24, "sell", "Thesis invalidated — volumes rolled over; cutting the loss"),
  ]},
  { date: "2026-07-07", time: "16:22:37", objective: null, snapshot: true, trades: [
    eq("DASH", 60, 195.72, "sell", "Trimming after +23% run — position size discipline"),
  ]},
  { date: "2026-07-21", time: "15:07:55", objective: "maximize_sharpe", snapshot: true, trades: [
    eq("XOM", 280, 151.71, "sell", "Rotation: crude range-bound, capital better in healthcare"),
    eq("ABBV", 200, 256.10, "buy", "Immunology franchise; defensive growth + income"),
  ]},
  { date: "2026-07-22", time: "14:49:26", objective: null, snapshot: true, trades: [
    eq("AMD", 70, 552.33, "sell", "Taking profits after +35% run; keeping core position"),
  ]},
  { date: "2026-07-24", time: "16:31:44", objective: "growth", snapshot: true, trades: [
    eq("GOOGL", 60, 319.74, "buy", "Averaging down — search-share fears overdone"),
  ]},
  { date: "2026-08-03", time: "15:19:08", objective: "balanced", snapshot: true, trades: [
    eq("VOO", 40, 696.40, "buy", "Deploying part of the cash sleeve into core"),
  ]},
];

/* ────────────────────────── Snapshot machinery ──────────────────────────── */

function tsOf(b: Batch, offsetSec = 0): string {
  const t = new Date(`${b.date}T${b.time}.000Z`);
  t.setSeconds(t.getSeconds() + offsetSec);
  return t.toISOString();
}

/** Clone the live MarketContext, re-priced as of `date` (inclusive). */
function asOf(full: MarketContext, date: string): MarketContext {
  const history = new Map<string, number[]>();
  const historyDates = new Map<string, string[]>();
  const quotes = new Map<string, ContextQuote>();

  for (const [sym, closes] of full.history) {
    const dates = full.historyDates?.get(sym) ?? [];
    let cut = 0;
    while (cut < dates.length && dates[cut] <= date) cut++;
    if (cut === 0) continue;
    history.set(sym, closes.slice(0, cut));
    historyDates.set(sym, dates.slice(0, cut));
    const price = closes[cut - 1];
    const prev = cut >= 2 ? closes[cut - 2] : price;
    const live = full.quotes.get(sym);
    quotes.set(sym, {
      symbol: sym,
      price,
      changePercent: prev > 0 ? ((price - prev) / prev) * 100 : null,
      currency: live?.currency ?? "USD",
      name: live?.name ?? sym,
      marketCap: live?.marketCap ?? null,
      sessionDate: dates[cut - 1],
      asOf: Date.parse(`${dates[cut - 1]}T20:00:00.000Z`),
      assetType: live?.assetType ?? null,
    });
  }

  const benchDates = full.benchmarkDates ?? [];
  let bCut = 0;
  while (bCut < benchDates.length && benchDates[bCut] <= date) bCut++;

  const rateDates = full.rateChangeDates ?? [];
  let rCut = 0;
  while (rCut < rateDates.length && rateDates[rCut] <= date) rCut++;

  return {
    ...full,
    quotes,
    history,
    historyDates,
    benchmarkReturns: full.benchmarkReturns.slice(0, bCut),
    benchmarkDates: benchDates.slice(0, bCut),
    rateChanges: (full.rateChanges ?? []).slice(0, rCut),
    rateChangeDates: rateDates.slice(0, rCut),
    asOf: `${date}T20:00:00.000Z`,
  };
}

/* ─────────────────────────────── Main ───────────────────────────────────── */

async function main() {
  const backup = `${DB_PATH}.bak-demo-${new Date().toISOString().slice(0, 10)}`;
  copyFileSync(DB_PATH, backup);
  console.log(`Backup written: ${backup}`);

  const raw = new DatabaseSync(DB_PATH);
  const run = (sql: string, ...args: (string | number | null)[]) => raw.prepare(sql).run(...args);

  /* ── Wipe demo-relevant state ─────────────────────────────────────────── */
  for (const t of [
    "portfolio_lot", "portfolio", "manual_asset", "portfolio_snapshot",
    "decision", "watchlist", "watchlist_member", "watchlist_target_history",
    "research_session", "research_message", "research_notes",
    "activity", "notification", "price_alert_state", "attention_dismissal",
    "home_fingerprint", "page_fingerprint", "chart_drawing",
    "valuation_case", "valuation_event",
  ]) run(`DELETE FROM ${t}`);

  /* ── Market data for the replay ───────────────────────────────────────── */
  const symbols = [...new Set(BATCHES.flatMap((b) => b.trades.map((t) => t.symbol)))];
  console.log("Building market context for:", symbols.join(", "));
  // A dummy raw holding per symbol so buildMarketContext fetches everything once.
  const ctxFull = await buildMarketContext(
    [{
      id: "lot:CASH-USD", assetClass: "cash", symbol: null, name: "USD Cash", currency: "USD",
      quantity: 1, unit: "currency", costBasis: 1, acquiredAt: "2026-05-04",
      manualValue: null, manualValueAsOf: null, meta: {},
    }],
    { candidateSymbols: symbols },
  );

  const insertLot = raw.prepare(
    `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at,
                                asset_class, currency, unit, meta, portfolio_id)
     VALUES (?,?,?,?,?,0,?,?,?, 'USD', ?, ?, 1)`,
  );
  const insertSnapshot = raw.prepare(
    `INSERT INTO portfolio_snapshot (id, label, objective, holdings, summary, created_at, portfolio_id)
     VALUES (?,?,?,?,?,?,1)`,
  );

  const evalAt = (date: string) => {
    const ctx = asOf(ctxFull, date);
    const normalized = normalizeHoldings(listRawHoldings(), ctx);
    return evaluate(normalized.holdings, ctx);
  };
  const writeSnapshot = (label: string, objective: string | null, date: string, createdAt: string) => {
    const summary = summaryOf(evalAt(date));
    const lots = raw.prepare("SELECT * FROM portfolio_lot WHERE portfolio_id = 1").all();
    insertSnapshot.run(
      crypto.randomUUID(), label, objective,
      JSON.stringify({ lots, manualAssets: [] }), JSON.stringify(summary), createdAt,
    );
    return summary;
  };

  /* ── Replay the ledger ────────────────────────────────────────────────── */
  let cash = 0;
  let firstBatch = true;
  for (const b of BATCHES) {
    // pre-execution snapshot (skip for the very first funding event: empty book)
    if (b.snapshot && !firstBatch) writeSnapshot("pre-execution", b.objective, b.date, tsOf(b, -25));

    if (b.deposit) {
      insertLot.run("CASH-USD", N.CASH, b.deposit, 1, "buy", b.date, tsOf(b), "cash", "currency",
        JSON.stringify({ source: "cash_allocation_deposit" }));
      cash += b.deposit;
    }

    let net = 0; // cash consumed by the batch (buys − sells)
    for (const t of b.trades) {
      insertLot.run(t.symbol, t.name, t.shares, t.price, t.kind, b.date, tsOf(b),
        t.assetClass, t.assetClass === "cash" ? "currency" : "shares",
        t.reason ? JSON.stringify({ reason: t.reason }) : null);
      net += (t.kind === "buy" ? 1 : -1) * t.shares * t.price;
    }
    if (Math.abs(net) > 0.01) {
      // The executor's cash-balancing lot: buys draw cash, sells park proceeds.
      const kind = net > 0 ? "sell" : "buy";
      insertLot.run("CASH-USD", N.CASH, Math.abs(net), 1, kind, b.date, tsOf(b, 2), "cash", "currency",
        JSON.stringify({ reason: net > 0 ? "Cash drawn to fund rebalance buys" : "Rebalance proceeds parked in cash", balancing: true }));
      cash -= net;
      if (cash < -0.01) throw new Error(`Cash went negative on ${b.date}: ${cash.toFixed(2)}`);
    }

    if (b.snapshot) {
      const s = writeSnapshot("post-execution", b.objective, b.date, tsOf(b, 20));
      console.log(`${b.date}  post: value=$${Math.round(s.totalValue).toLocaleString()}  health=${s.health} (${s.healthGrade})  vol=${s.volatility ?? "—"}  top=${s.topAssetClassWeight}%  cash=$${Math.round(cash).toLocaleString()}`);
    }
    firstBatch = false;
  }

  /* ── Pipeline / watchlist ─────────────────────────────────────────────── */
  const ms = (iso: string) => new Date(iso).getTime();
  const insWatch = raw.prepare(
    `INSERT INTO watchlist (symbol, name, added_at, target_price, alert_pct_drop, notes,
                            stage, stage_changed_at, target_direction, source, source_detail)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  type W = [string, string, string, number | null, number | null, string | null, string, number, string | null, string, string | null];
  const WATCHLIST: W[] = [
    // ── Researching ──
    ["RDDT", "Reddit, Inc.", "2026-07-21T14:05:12.000Z", 210.0, 8.0,
      "Fastest-growing ad platform at scale: +61% revenue YoY at 91% gross margin, forward P/E ~16. " +
      "Ad load and international ARPU still early vs. META; data-licensing revenue is pure upside. IC review in progress.",
      "researching", ms("2026-08-03T09:30:00Z"), "above", "screener", "Quality growth screen · rank #2"],
    ["GTLB", "GitLab Inc.", "2026-07-24T10:22:41.000Z", 45.0, null,
      "DevSecOps platform compounding 30%+ with FCF inflection. Watching net seat expansion and AI add-on attach.",
      "researching", ms("2026-08-01T08:15:00Z"), "above", "screener", "Quality growth screen · rank #6"],
    // ── Thesis ──
    ["DBX", "Dropbox, Inc.", "2026-06-30T11:19:55.000Z", 38.0, null,
      "9% FCF yield with an aggressive buyback shrinking the share count. IC memo drafted — decide by mid-August.",
      "thesis", ms("2026-07-28T15:40:00Z"), "above", "screener", "FCF yield screen · rank #4"],
    // ── Surfaced ──
    ["CRWD", "CrowdStrike Holdings, Inc.", "2026-08-04T16:12:45.000Z", null, null, null,
      "surfaced", ms("2026-08-04T16:12:45Z"), null, "wire", "Security spend theme"],
    ["TSM", "Taiwan Semiconductor Manufacturing Company", "2026-08-02T15:05:30.000Z", null, null, null,
      "surfaced", ms("2026-08-02T15:05:30Z"), null, "screener", "Quality growth screen · rank #9"],
    ["CART", "Maplebear Inc. (Instacart)", "2026-07-30T16:03:27.000Z", null, null, null,
      "surfaced", ms("2026-07-30T16:03:27Z"), null, "compare", "Compared with DASH, ABNB"],
    // ── Passed ──
    ["PLTR", "Palantir Technologies Inc.", "2026-06-10T13:30:00.000Z", null, null,
      "Exceptional business; the multiple leaves no margin for error at ~60x sales. Revisit under $120.",
      "passed", ms("2026-06-12T17:05:00Z"), null, "research", null],
    ["SBUX", "Starbucks Corporation", "2026-05-27T10:45:00.000Z", null, null,
      "Turnaround optionality is real but the timeline is unclear; pass until US traffic inflects.",
      "passed", ms("2026-06-02T14:20:00Z"), null, "scanner", "Turnaround scan"],
    // ── Exited ──
    ["COIN", "Coinbase Global, Inc.", "2026-05-09T14:22:00.000Z", null, null,
      "Exited 1 Jul at −23%: funding-rate tailwind faded and volumes rolled over; thesis invalidated. Post-mortem: sized correctly (2.8%), sold on the trigger, not the hope.",
      "exited", ms("2026-07-01T15:44:03Z"), null, "wire", "Crypto infrastructure theme"],
    ["XOM", "Exxon Mobil Corporation", "2026-05-16T09:58:00.000Z", null, null,
      "Rotated into ABBV on 21 Jul: crude range-bound, momentum thesis stale. Small realized loss taken deliberately.",
      "exited", ms("2026-07-21T15:07:55Z"), null, "scanner", "Momentum scan · energy"],
    // ── Owned ──
    ["MSFT", "Microsoft Corporation", "2026-05-06T17:24:05.000Z", 490.0, null,
      "Azure re-acceleration + AI monetization. Added on the June drawdown at $374 — thesis, not price, is the signal.",
      "owned", ms("2026-05-06T17:24:05Z"), "above", "research", "equity"],
    ["LLY", "Eli Lilly and Company", "2026-05-07T15:48:30.000Z", 1250.0, null,
      "Incretin franchise still supply-constrained; orforglipron opens the oral market. Core healthcare compounder.",
      "owned", ms("2026-05-07T15:48:30Z"), "above", "screener", "Quality growth screen · rank #1"],
    ["AMD", "Advanced Micro Devices, Inc.", "2026-05-07T15:48:30.000Z", 520.0, null,
      "Datacenter GPU share gains vs. NVDA. Trimmed 70 sh at $552 (22 Jul) after +35% run; core position stays.",
      "owned", ms("2026-05-07T15:48:30Z"), "above", "screener", "Momentum + quality screen"],
    ["V", "Visa Inc.", "2026-05-07T15:48:30.000Z", 400.0, null,
      "Payments toll road; only financials exposure in the book — deliberately light, revisit if rates fall.",
      "owned", ms("2026-05-07T15:48:30Z"), "above", "research", "equity"],
    ["GOOGL", "Alphabet Inc.", "2026-05-08T16:10:19.000Z", 450.0, null,
      "Underwater vs. $375 avg cost. Search-share fears overdone; averaged down at $320 (24 Jul). Review if cloud decelerates.",
      "owned", ms("2026-05-08T16:10:19Z"), "above", "research", "equity"],
    ["ABNB", "Airbnb, Inc.", "2026-05-12T15:33:57.000Z", 175.0, null,
      "Core marketplace position. Bookings growth durable; Experiences relaunch a free option.",
      "owned", ms("2026-05-12T15:33:57Z"), "above", "research", "equity"],
    ["DASH", "DoorDash, Inc.", "2026-05-15T16:05:21.000Z", 220.0, null,
      "Category leader still compounding order frequency; grocery + advertising attach inflecting. Trimmed 60 sh at $196.",
      "owned", ms("2026-05-15T16:05:21Z"), "above", "research", "equity"],
    ["AMZN", "Amazon.com, Inc.", "2026-06-25T17:58:14.000Z", 300.0, null,
      "Bought the June selloff at $227. AWS re-acceleration + retail margin expansion both playing out.",
      "owned", ms("2026-06-25T17:58:14Z"), "above", "scanner", "Oversold quality scan"],
    ["ABBV", "AbbVie Inc.", "2026-07-21T15:07:55.000Z", 290.0, null,
      "Immunology franchise (Skyrizi/Rinvoq) absorbing Humira erosion faster than guided. Defensive growth + 3.5% yield.",
      "owned", ms("2026-07-21T15:07:55Z"), "above", "research", "equity"],
  ];
  for (const w of WATCHLIST) {
    insWatch.run(...w);
    run("INSERT INTO watchlist_member (group_id, symbol, added_at) VALUES (1, ?, ?)", w[0], w[2]);
  }
  // Target revisions — the register of changed minds.
  run(`INSERT INTO watchlist_target_history (symbol, previous_target, new_target, previous_direction, new_direction, note, changed_at)
       VALUES ('MSFT', 460, 490, 'above', 'above', 'Raised after Q4 print: Azure re-acceleration and AI capex guide', ?)`,
    ms("2026-07-31T14:30:00Z"));
  run(`INSERT INTO watchlist_target_history (symbol, previous_target, new_target, previous_direction, new_direction, note, changed_at)
       VALUES ('RDDT', NULL, 210, NULL, 'above', 'Initial target from reverse DCF at 28x forward FCF', ?)`,
    ms("2026-07-21T14:05:12Z"));

  /* ── Decision journal ─────────────────────────────────────────────────── */
  const insDecision = raw.prepare(
    `INSERT INTO decision (symbol, name, action, conviction, thesis, price_at, currency, target_price,
                           horizon, fit_score, fit_tier, status, close_price, closed_at, created_at)
     VALUES (?,?,?,?,?,?, 'USD', ?,?,?,?,?,?,?,?)`,
  );
  type D = [string, string, string, number, string, number, number | null, string, number | null, string | null, string, number | null, string | null, string];
  const DECISIONS: D[] = [
    ["VOO", N.VOO, "buy", 5, "Core S&P 500 exposure — the benchmark I have to beat should also be my largest position.", 663.37, null, "long", null, null, "open", null, null, "2026-05-05T15:04:00.000Z"],
    ["MSFT", N.MSFT, "buy", 4, "Azure growth re-accelerating with AI workloads; margin structure intact. Entry at ~27x forward earnings for a franchise this durable is acceptable.", 413.07, 460, "long", 81, "excellent", "open", null, null, "2026-05-06T17:26:00.000Z"],
    ["LLY", N.LLY, "buy", 4, "Incretin demand still supply-constrained; pipeline (oral GLP-1) extends the runway past 2030. Paying up for the rare pharma with a decade of visibility.", 973.28, 1150, "medium", 77, "good", "open", null, null, "2026-05-07T15:50:00.000Z"],
    ["AMD", N.AMD, "buy", 3, "MI-series datacenter share gains are real; hyperscaler qualification broadening. Volatile — sized at 5% with a plan to trim strength.", 408.46, 520, "medium", 68, "good", "open", null, null, "2026-05-07T15:52:00.000Z"],
    ["V", N.V, "buy", 4, "Cross-border volumes compounding; buybacks shrink the float every quarter. The only financials exposure I want at this point in the cycle.", 320.62, 400, "long", 72, "good", "open", null, null, "2026-05-07T15:54:00.000Z"],
    ["GOOGL", N.GOOGL, "buy", 3, "Search monetization resilient despite AI-overview fears; cloud margin inflection underway. Cheapest of the mega-caps on forward earnings.", 400.56, 450, "long", 70, "good", "open", null, null, "2026-05-08T16:12:00.000Z"],
    ["COIN", N.COIN, "buy", 2, "Crypto volume cycle turning up; funding rates supportive. Explicitly speculative — sized under 3% with a hard invalidation: exit if volumes roll over.", 207.64, 260, "short", 41, "poor", "closed", 159.24, "2026-07-01T15:44:03.000Z", "2026-05-12T15:35:00.000Z"],
    ["ABNB", N.ABNB, "buy", 3, "Take-rate expansion via Experiences without heavier capital intensity. Bookings growth durable through the travel normalization.", 135.48, 175, "long", 66, "good", "open", null, null, "2026-05-12T15:37:00.000Z"],
    ["DASH", N.DASH, "buy", 4, "Order frequency still compounding; grocery attach and advertising are both early. Category winner with improving unit economics.", 159.20, 220, "medium", 74, "good", "open", null, null, "2026-05-15T16:07:00.000Z"],
    ["XOM", N.XOM, "buy", 3, "Crude momentum + Guyana volume growth; disciplined capex cycle. Momentum thesis — invalidated if crude stalls below $80.", 162.55, 185, "medium", 58, "neutral", "closed", 151.71, "2026-07-21T15:07:55.000Z", "2026-05-19T14:57:00.000Z"],
    ["PLTR", "Palantir Technologies Inc.", "avoid", 4, "Best-in-class execution, unpayable multiple: ~60x sales prices in a decade of flawless growth. The business is not the debate — the entry is. Revisit under $120.", 127.99, null, "long", 34, "poor", "open", null, null, "2026-06-12T17:05:00.000Z"],
    ["GOOGL", N.GOOGL, "hold", 3, "Down 8% from cost after the June selloff. Thesis (search resilience + cloud inflection) intact; the drawdown is multiple compression, not estimate cuts. Hold, add below $330.", 358.78, 450, "long", null, null, "open", null, null, "2026-06-03T18:30:00.000Z"],
    ["AMZN", N.AMZN, "buy", 4, "June selloff put it at ~13x forward EBITDA with AWS re-accelerating. Bought the fear — the estimates never moved.", 227.01, 300, "medium", 76, "good", "open", null, null, "2026-06-25T18:00:00.000Z"],
    ["ABBV", N.ABBV, "buy", 3, "Skyrizi + Rinvoq run-rate absorbing Humira erosion two years ahead of guidance. Defensive growth, 3.5% yield, and the book needed healthcare balance.", 256.10, 290, "long", 82, "excellent", "open", null, null, "2026-07-21T15:10:00.000Z"],
    ["AMD", N.AMD, "sell", 3, "Trim discipline: +35% in eleven weeks, position drifted to 6% of book. Sold a third at $552; core stays for the datacenter story.", 552.33, null, "medium", null, null, "closed", 552.33, "2026-07-22T14:49:26.000Z", "2026-07-22T14:49:00.000Z"],
    ["GTLB", "GitLab Inc.", "watch", 2, "FCF inflection confirmed but seat expansion decelerating two quarters straight. Wait for stabilization before committing capital.", 34.51, 45, "medium", null, null, "open", null, null, "2026-07-31T20:20:00.000Z"],
    ["RDDT", "Reddit, Inc.", "watch", 3, "Fastest ad-revenue grower at scale (+61% YoY, 91% GM); the 31 Jul selloff (−21%) put it at ~16x forward earnings. The ARPU gap vs META is the thesis. IC review before sizing — DAU volatility is the risk.", 154.71, 210, "medium", null, null, "open", null, null, "2026-08-03T11:45:00.000Z"],
  ];
  for (const d of DECISIONS) insDecision.run(...d);

  /* ── Research copilot history ─────────────────────────────────────────── */
  const insSession = raw.prepare("INSERT INTO research_session (id, symbol, created_at, updated_at) VALUES (?,?,?,?)");
  const insMessage = raw.prepare("INSERT INTO research_message (session_id, role, content, meta, created_at) VALUES (?,?,?,NULL,?)");

  const S1 = "9f2e41c8-53a1-4a6f-9b7e-2c8d17e4a501"; // RDDT — the live-demo centerpiece
  insSession.run(S1, "RDDT", "2026-08-05T18:20:11.000Z", "2026-08-06T09:06:02.000Z");
  const RDDT_MESSAGES: [string, string, string][] = [
    ["user", "Build the bull and bear case for Reddit ahead of our IC review.", "2026-08-05T18:20:11.000Z"],
    ["assistant",
      "**Bull case**\n\n" +
      "1. **Fastest-growing ad platform at scale.** Revenue grew ~61% YoY — faster than META, PINS or SNAP at " +
      "comparable scale — on a 91% gross margin, and the model has already turned GAAP-profitable (EPS +178% YoY).\n" +
      "2. **The ARPU gap is the thesis.** Reddit monetizes a US user at a fraction of Meta's rate. Ad load is still " +
      "low, international is barely monetized, and machine-translation is expanding the addressable inventory.\n" +
      "3. **Data licensing is pure-margin optionality.** LLM training deals (Google, OpenAI) already annualize in " +
      "the hundreds of millions and are not yet reflected in consensus estimates.\n" +
      "4. **Balance sheet is clean.** Effectively debt-free (D/E ~0.006) with ROE >30% — rare for a company at " +
      "this stage of the growth curve.\n\n" +
      "**Bear case**\n\n" +
      "1. **Traffic concentration.** A meaningful share of logged-out users arrive via Google search; algorithm " +
      "shifts can move DAU quarter to quarter.\n" +
      "2. **Ad diversification.** Advertiser base is still narrower than mature platforms; a soft brand-spend " +
      "cycle hits harder.\n" +
      "3. **Multiple compression risk.** At ~34x EV/EBITDA the stock needs continued execution; any growth " +
      "deceleration below ~40% re-rates it quickly.\n\n" +
      "**Net:** growth-adjusted, the valuation is undemanding — forward P/E ~16 against a 3-year revenue CAGR of " +
      "~49%. The risk is traffic dependence, not the business model. Recommend advancing to a full IC review with " +
      "a position size that respects the DAU volatility.",
      "2026-08-05T18:21:37.000Z"],
    ["user", "How does Reddit's ad monetization compare to Meta and Pinterest?", "2026-08-06T09:04:48.000Z"],
    ["assistant",
      "Reddit's ad business is roughly where Meta's was a decade ago — and that is the opportunity:\n\n" +
      "| Dimension | RDDT | PINS | META |\n" +
      "|---|---|---|---|\n" +
      "| Revenue growth (YoY) | **~61%** | ~mid-teens | ~20% |\n" +
      "| Gross margin | **91%** | ~80% | ~82% |\n" +
      "| Monetization maturity | Early | Mid | Late |\n\n" +
      "Three structural levers Meta has already pulled that Reddit has not:\n\n" +
      "1. **Ad load** — Reddit's feed carries materially fewer ads per session than Instagram or Facebook.\n" +
      "2. **International ARPU** — Reddit's non-US ARPU is a small fraction of its US ARPU; Meta closed that gap " +
      "over ~8 years.\n" +
      "3. **Performance tooling** — conversion APIs and automated bidding are 2-3 years behind Meta's stack, " +
      "which is why ROAS-driven budgets are only now arriving.\n\n" +
      "Unlike Pinterest, Reddit adds a second engine: **data licensing**. Its corpus is uniquely valuable for LLM " +
      "training and carries near-100% incremental margin.\n\n" +
      "The comparison supports the thesis: Reddit does not need to invent a model — it needs to execute a playbook " +
      "Meta has already validated.",
      "2026-08-06T09:06:02.000Z"],
  ];
  for (const [role, content, at] of RDDT_MESSAGES) insMessage.run(S1, role, content, at);

  const S2 = "3c7d92e5-8b14-4f2a-a6d3-91e04b7c2810"; // MSFT — the June add-on-weakness
  insSession.run(S2, "MSFT", "2026-06-22T19:12:40.000Z", "2026-06-22T19:15:02.000Z");
  insMessage.run(S2, "user", "MSFT is down 12% from the May high. Has anything changed in the fundamentals, or is this multiple compression?", "2026-06-22T19:12:40.000Z");
  insMessage.run(S2, "assistant",
    "The estimates have not moved — this is a multiple story, not an earnings story.\n\n" +
    "**What changed:** the whole megacap complex de-rated ~8-12% since early June on rate expectations; MSFT fell with it, " +
    "slightly more because it entered the drawdown at the richest multiple of the group.\n\n" +
    "**What did not change:**\n" +
    "1. Azure consensus growth for FY27 is unchanged.\n" +
    "2. Commercial bookings and RPO both accelerated last quarter.\n" +
    "3. Capex guide was reaffirmed — management is not seeing demand softness.\n\n" +
    "At $367 the stock is at ~24x forward earnings, its cheapest since early 2025 relative to its own growth. If the " +
    "original thesis justified $413, the same thesis at $367 is strictly better. The honest risks: AI capex payback " +
    "period is still unproven, and a genuine rate shock compresses multiples further from here.\n\n" +
    "**Verdict:** fundamentals intact; the drawdown is an entry, not a warning.",
    "2026-06-22T19:15:02.000Z");

  const S3 = "6e1fa8d4-2c95-4b7e-8f10-d3a5c8e94b27"; // COIN — the post-mortem
  insSession.run(S3, "COIN", "2026-07-01T14:30:15.000Z", "2026-07-01T14:33:41.000Z");
  insMessage.run(S3, "user", "Walk me through whether the COIN thesis is broken. Volumes look weak for the third straight week.", "2026-07-01T14:30:15.000Z");
  insMessage.run(S3, "assistant",
    "The thesis as written on 12 May had one invalidation condition: *exit if volumes roll over*. They have.\n\n" +
    "1. **Spot volumes** are down ~35% from the May peak and the decline is broadening across pairs, not concentrated in one.\n" +
    "2. **Funding rates** flipped neutral-to-negative in mid-June — the speculative tailwind the entry was predicated on is gone.\n" +
    "3. **Take-rate compression** is resuming as volume mix shifts back to advanced/institutional tiers.\n\n" +
    "The position is down ~23% and the invalidation trigger has fired. Holding from here would be a *new* decision to own a " +
    "volume-cyclical at declining volumes — a different, weaker thesis. The discipline that sized this at 2.8% is the same " +
    "discipline that says exit now.\n\n**Recommendation: exit, log the loss, write the post-mortem.** The process worked: " +
    "small size, explicit trigger, acted on the trigger.",
    "2026-07-01T14:33:41.000Z");

  const insNote = raw.prepare("INSERT INTO research_notes (symbol, content, created_at) VALUES (?,?,?)");
  insNote.run("COIN",
    "POST-MORTEM (1 Jul): Entered 12 May at $207.64 on the volume-cycle thesis, exited 1 Jul at $159.24 (−23.3%). " +
    "What worked: sizing (2.8% of book), explicit invalidation trigger, no averaging down. What failed: the entry chased a " +
    "6-week rally — the funding-rate signal was already decelerating. Lesson: for cyclical theses, demand the signal be " +
    "accelerating AT entry, not merely positive.", "2026-07-01T16:05:00.000Z");
  insNote.run("GOOGL",
    "Averaged down 60 sh at $319.74 (24 Jul) after the post-earnings selloff. Cloud backlog grew; the selloff was " +
    "search-share narrative, not numbers. New avg cost $374. Review trigger: two consecutive quarters of cloud deceleration.",
    "2026-07-24T16:35:00.000Z");
  insNote.run("RDDT",
    "Reverse DCF at $155: market is pricing ~22% FCF growth for 10y. Bull case (ARPU convergence to even 1/3 of META) " +
    "supports 30%+. Target $210 = 28x forward FCF. Size 3-4% if IC clears the DAU-concentration risk. " +
    "The 31 Jul guidance selloff (−21%) is why this is on the desk now.",
    "2026-08-03T11:50:00.000Z");

  /* ── Activity (continue where you left off) ───────────────────────────── */
  const ACTIVITY: [string, string, string][] = [
    ["RDDT", "RDDT — Reddit, Inc.", "2026-08-06T09:06:04.998Z"],
    ["GTLB", "GTLB — GitLab Inc.", "2026-08-06T08:58:48.428Z"],
    ["DBX", "DBX — Dropbox, Inc.", "2026-08-05T19:38:12.000Z"],
    ["ABBV", "ABBV — AbbVie Inc.", "2026-08-05T16:22:45.000Z"],
    ["GOOGL", "GOOGL — Alphabet Inc.", "2026-08-04T15:41:30.000Z"],
    ["DASH", "DASH — DoorDash, Inc.", "2026-08-03T15:05:30.000Z"],
    ["CRWD", "CRWD — CrowdStrike Holdings, Inc.", "2026-08-04T16:13:18.000Z"],
  ];
  for (const [ref, label, at] of ACTIVITY) {
    run("INSERT INTO activity (kind, ref, label, href, at) VALUES ('research', ?, ?, ?, ?)",
      ref, label, `/research?symbol=${ref}`, at);
  }

  /* ── Notifications ────────────────────────────────────────────────────── */
  const insNotif = raw.prepare(
    `INSERT INTO notification (dedup_key, symbol, kind, severity, title, body, read, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  insNotif.run("price_target:MSFT:490", "MSFT", "price_target", "info",
    "MSFT approaching your $490 target",
    "Microsoft closed at $487.65, within 0.5% of your $490 price target (set 31 Jul).", 0, "2026-08-03T21:05:00.000Z");
  insNotif.run("big_move:MSFT:2026-07-30", "MSFT", "big_move", "info",
    "MSFT +15.5% today",
    "Microsoft jumped 15.5% to $451.10 after Q4 earnings — Azure growth re-accelerated and the AI capex guide came in above consensus.", 1, "2026-07-30T20:10:00.000Z");
  insNotif.run("big_move:AMD:2026-06-05", "AMD", "big_move", "warning",
    "AMD −10.9% today",
    "Advanced Micro Devices fell 10.9% to $466.38 — sector-wide semis selloff on rate expectations. Your position remains +14% vs cost.", 1, "2026-06-05T20:15:00.000Z");
  insNotif.run("drop_alert:RDDT:2026-07-22", "RDDT", "drop_alert", "warning",
    "RDDT fell 8.3% — drop alert triggered",
    "Reddit fell 8.3% to $170.38, through your 8% daily-drop alert threshold. Watchlist idea, not held.", 1, "2026-07-22T20:20:00.000Z");
  insNotif.run("drop_alert:RDDT:2026-07-31", "RDDT", "drop_alert", "warning",
    "RDDT fell 21.0% — drop alert triggered",
    "Reddit fell 21.0% to $140.67 after earnings — guidance spooked the market while the quarter itself beat. Watchlist idea, not held — review whether the entry window is opening.", 1, "2026-07-31T20:15:00.000Z");

  /* ── Simulator ────────────────────────────────────────────────────────── */
  run("DELETE FROM simulation");
  const simProfile = {
    cash: 300_000, currency: "USD", horizon: "long", targetDate: null,
    objective: "maximize_income", riskAppetite: 4, maxDrawdownPct: 20,
    role: "complement", complementRef: { kind: "real", id: "1" },
    preferences: {}, followUps: [
      { question: "Your real portfolio is ~56% single-name equities with most income coming from one bond fund. Should this sleeve avoid overlapping with sectors you already own?", answer: "Yes — no tech, no consumer marketplaces. This sleeve is for what the main book lacks.", assumption: null },
      { question: "Do you want municipal bonds considered for the fixed-income allocation, or taxable only?", answer: null, assumption: "Taxable only (account type not specified)." },
    ], intakeComplete: true,
  };
  const simHoldings = [
    { symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF", assetClass: "etf", currency: "USD", quantity: 2200, targetWeight: 22, rationale: "Quality-screened dividend core: 100 names, 3.4% yield, zero overlap with the growth book's top holdings.", addedBy: "ai" },
    { symbol: "JNJ", name: "Johnson & Johnson", assetClass: "equity", currency: "USD", quantity: 260, targetWeight: 14, rationale: "AAA balance sheet, 60+ years of dividend growth; pharma exposure the main book gets only via LLY/ABBV growth names.", addedBy: "ai" },
    { symbol: "PG", name: "The Procter & Gamble Company", assetClass: "equity", currency: "USD", quantity: 280, targetWeight: 13, rationale: "Staples ballast — lowest earnings beta in the sleeve; pricing power through inflation cycles.", addedBy: "ai" },
    { symbol: "DUK", name: "Duke Energy Corporation", assetClass: "equity", currency: "USD", quantity: 300, targetWeight: 12, rationale: "Regulated utility yield (~4%); rate-cut beneficiary and recession-resilient demand.", addedBy: "ai" },
    { symbol: "O", name: "Realty Income Corporation", assetClass: "equity", currency: "USD", quantity: 550, targetWeight: 10, rationale: "Monthly-pay triple-net REIT; real-asset income the main portfolio has none of.", addedBy: "ai" },
    { symbol: "IEF", name: "iShares 7-10 Year Treasury Bond ETF", assetClass: "bond", currency: "USD", quantity: 640, targetWeight: 20, rationale: "Extends the duration sleeve; pairs with equity income to stabilize drawdowns.", addedBy: "ai" },
    { symbol: null, name: "USD Cash", assetClass: "cash", currency: "USD", quantity: 27_000, targetWeight: 9, rationale: "Settlement buffer + first tranche kept dry for entry staggering.", addedBy: "ai" },
  ];
  const simThesis = {
    summary: "A defensive income sleeve built to complement a growth-tilted main portfolio: dividend quality, regulated utility yield, real-asset income and duration — the four exposures the primary book deliberately lacks. Designed to cut whole-household drawdown, not to maximize its own return.",
    tags: ["Income", "Defensive", "Complement", "Low beta"],
    generatedAt: "2026-07-29T16:45:00.000Z", source: "ai",
  };
  const simHeadline = {
    totalValue: 300_000, healthScore: 79, healthGrade: "B", holdingCount: 7,
    assetClassCount: 4, annualIncome: 8_900, asOf: "2026-07-29T16:45:00.000Z",
  };
  run(`INSERT INTO simulation (id, name, status, profile, holdings, thesis, headline, promoted_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?)`,
    "b4c2f7e1-9a35-4d68-8c02-5e7f1a3b6d90", "Defensive Income Sleeve", "complete",
    JSON.stringify(simProfile), JSON.stringify(simHoldings), JSON.stringify(simThesis), JSON.stringify(simHeadline),
    "2026-07-29T16:30:00.000Z", "2026-07-29T16:45:00.000Z");

  /* ── Valuation cases (through the real engine, then backdated) ────────── */
  const seedCase = (
    symbol: string, priceAt: number, values: Record<string, number>,
    note: string, createdAt: string,
  ) => {
    const assumptionsRaw = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, { value: v, source: "user" }]),
    );
    const set = coerceAssumptionSet(assumptionsRaw);
    if (!set) throw new Error(`Bad assumption set for ${symbol}`);
    const result = computeCaseResult(set, priceAt);
    appendValuationEvent({
      symbol, currency: "USD", author: "user", kind: "seeded",
      assumptions: set, result, priceAt, triggerSource: "research", note,
    });
    // Backdate — the append helper stamps "now".
    run("UPDATE valuation_event SET created_at = ? WHERE symbol = ?", createdAt, symbol);
    run("UPDATE valuation_case SET created_at = ?, updated_at = ?, last_user_event_at = ? WHERE symbol = ?",
      createdAt, createdAt, createdAt, symbol);
    console.log(`Valuation ${symbol}: FV=$${result.fairValue?.toFixed(0)} (bear $${result.fairValueBear?.toFixed(0)} / bull $${result.fairValueBull?.toFixed(0)}), MOS=${result.marginOfSafety?.toFixed(1)}%`);
  };

  seedCase("RDDT", 154.71, {
    baseFcf: 5.5e8, growthRate1: 30, growthRate2: 14, terminalGrowth: 3,
    discountRate: 10.5, sharesOutstanding: 1.88e8, netDebt: -2.0e9,
  }, "IC prep: base case assumes ARPU convergence to ~1/3 of META's US rate by 2031; data licensing treated as margin, not revenue growth.", "2026-08-03T12:10:00.000Z");

  seedCase("LLY", 1169.86, {
    baseFcf: 1.4e10, growthRate1: 22, growthRate2: 12, terminalGrowth: 3.5,
    discountRate: 8.0, sharesOutstanding: 9.0e8, netDebt: 2.5e10,
  }, "Base FCF is FY27E (capacity buildout capex normalizing), not trailing — trailing FCF understates the franchise mid-buildout. Orforglipron oral launch is the swing factor between base and bull.", "2026-06-16T18:05:00.000Z");

  /* ── Portfolio thesis cache (AI summary; 15-min TTL — re-warm before demo) ── */
  const finalEval = evalAt("2026-08-06");
  const thesis: PortfolioThesis = {
    thesis:
      "A growth-tilted, US-centric book built in three months of deliberate weekly decisions: an S&P 500 core funding " +
      "concentrated bets on AI infrastructure, GLP-1 healthcare and marketplace winners, with a 13% cash sleeve held " +
      "back on purpose. It compounds through stock selection, and its record shows the discipline to cut losers as " +
      "readily as it adds to winners.",
    identity: ["Growth-tilted", "US-centric", "Quality bias", "Dry powder held"],
    strengths: [
      "Stock selection is doing the work: MSFT, LLY, AMD and DASH were each added to or trimmed at sensible points, and realized losses (COIN, XOM) were cut on explicit triggers rather than hope.",
      "The cash sleeve plus short-duration Treasuries give real optionality — the book can fund a new conviction idea without selling a winner.",
    ],
    risks: [
      "Financials exposure is a single payments name and income generation is thin — the book leans almost entirely on capital appreciation.",
      "Equity concentration is high: the top asset class is ~56% of value and the three largest sector bets (tech, healthcare, consumer platforms) are correlated in a risk-off tape.",
    ],
    bearCase:
      "This is a one-regime portfolio: if AI capex disappoints and multiples compress while rates stay high, the growth " +
      "names, the index core and the consumer platforms fall together — and the 7% bond sleeve is too small to matter.",
    mustBeTrue: "AI and GLP-1 capex cycles keep translating into earnings, not just narrative, through 2027.",
    generatedAt: new Date().toISOString(),
    source: "ai",
  };
  putScannerCache(`v3:${contentHash(finalEval)}`, JSON.stringify(thesis));

  /* ── Final report ─────────────────────────────────────────────────────── */
  const finalSummary = summaryOf(finalEval);
  console.log("\n=== FINAL BOOK (as of 2026-08-06, engine-computed) ===");
  console.log(`Value $${Math.round(finalSummary.totalValue).toLocaleString()}  cost $${Math.round(finalSummary.totalCost).toLocaleString()}  health ${finalSummary.health} (${finalSummary.healthGrade})  vol ${finalSummary.volatility}%  top class ${finalSummary.topAssetClassWeight}%`);
  for (const h of [...finalEval.holdings].sort((a, b) => b.weight - a.weight)) {
    const pl = h.unrealizedPL == null ? "—" : `${h.unrealizedPL >= 0 ? "+" : "-"}$${Math.abs(Math.round(h.unrealizedPL)).toLocaleString()}`;
    console.log(`  ${(h.symbol ?? h.name).padEnd(10)} ${h.weight.toFixed(1).padStart(5)}%  $${Math.round(h.valuation.valueBase).toLocaleString().padStart(10)}  P&L ${pl}`);
  }
  for (const t of ["portfolio_lot", "portfolio_snapshot", "decision", "watchlist", "research_session", "research_message", "research_notes", "activity", "notification", "simulation", "valuation_case", "valuation_event"]) {
    const n = (raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    console.log(`${t.padEnd(22)} ${n}`);
  }
  raw.close();
  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
