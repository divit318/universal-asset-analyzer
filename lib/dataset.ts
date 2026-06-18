import { enrichSymbol } from "./enrich";
import { getUniverse, type UniverseEntry } from "./universe";
import { getRichQuotes, type RichQuote } from "./yahoo";
import { computeScores } from "./composite";
import { clearFundamentals, getFreshFundamentals, putFundamentals } from "./db";
import type { DatasetStatus, StockFundamentals, StockMetrics } from "./types";

/**
 * Owns the screener's enriched dataset. Fundamentals are expensive (two Yahoo
 * calls per company) so they're built once, cached in memory, and persisted to
 * SQLite for ~12h. A cheap live price layer (one batch quote per 200 names) is
 * merged on top at screen time, and the composite scores are computed from the
 * merge. The build runs in the background; callers poll `status` until ready.
 */

const UNIVERSE_LIMIT = Number(process.env.SCREENER_UNIVERSE_LIMIT) || 1000;
const FUNDAMENTALS_TTL_MS = 12 * 60 * 60 * 1000;
const PRICE_TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;
const PERSIST_EVERY = 25;
const MAX_PASSES = 5; // retry rate-limited symbols in waves until coverage holds

const fundamentals = new Map<string, StockFundamentals>();
let universe: UniverseEntry[] = [];
let status: DatasetStatus = { stage: "empty", total: 0, ready: 0, builtAt: null };
let buildPromise: Promise<void> | null = null;
let priceLayer: { map: Map<string, RichQuote>; at: number } | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// OTC / pink-sheet listings are usually foreign ADRs whose financials are in a
// different currency than their USD market cap, which poisons ratios like FCF
// yield. Long-term investors want clean primary US listings, so we drop them.
const isOtc = (exchange: string | null | undefined): boolean =>
  exchange != null && /otc|pink|other/i.test(exchange);

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T | null> {
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn();
    } catch {
      // Exponential backoff with jitter to ride out Yahoo rate-limiting.
      await sleep(500 * 2 ** a + Math.random() * 400);
    }
  }
  return null;
}

async function build(): Promise<void> {
  try {
    status = { stage: "building", total: 0, ready: 0, builtAt: status.builtAt };
    universe = await getUniverse(UNIVERSE_LIMIT);
    const inUniverse = new Set(universe.map((u) => u.symbol));
    status.total = universe.length;

    // Hydrate from the SQLite cache first (survives restarts).
    const { rows, builtAt } = getFreshFundamentals(FUNDAMENTALS_TTL_MS);
    for (const row of rows) {
      if (inUniverse.has(row.symbol) && !isOtc(row.exchange)) fundamentals.set(row.symbol, row);
    }
    status.ready = fundamentals.size;
    if (builtAt) status.builtAt = new Date(builtAt).toISOString();

    // Enrich whatever's still missing, in waves. A symbol is "resolved" once we
    // either cache it or identify it as OTC; only genuine fetch failures (most
    // often rate-limit drops) are retried on the next pass, so the dataset
    // converges to near-full coverage instead of stalling at the first wave.
    let pending: StockFundamentals[] = [];
    const flush = () => {
      if (pending.length) {
        putFundamentals(pending);
        pending = [];
      }
    };

    const resolved = new Set(fundamentals.keys());
    let remaining = universe.filter((u) => !resolved.has(u.symbol));
    for (let pass = 0; pass < MAX_PASSES && remaining.length > 0; pass++) {
      await mapPool(remaining, CONCURRENCY, async (entry) => {
        const data = await withRetry(() => enrichSymbol(entry.symbol, entry.name));
        if (data) {
          resolved.add(entry.symbol);
          // Keep only clean US primary listings; OTC names are resolved-but-dropped.
          if (!isOtc(data.exchange)) {
            fundamentals.set(entry.symbol, data);
            pending.push(data);
            if (pending.length >= PERSIST_EVERY) flush();
          }
        }
        status.ready = fundamentals.size;
      });
      flush();
      const next = universe.filter((u) => !resolved.has(u.symbol));
      if (next.length === remaining.length) break; // a pass with zero progress
      remaining = next;
      if (remaining.length) await sleep(3000); // brief cool-off between waves
    }

    // Force the price layer to rebuild against the full symbol set next screen.
    priceLayer = null;
    status = {
      stage: "ready",
      total: universe.length,
      ready: fundamentals.size,
      builtAt: new Date().toISOString(),
    };
  } catch (err) {
    status = {
      ...status,
      stage: "error",
      error: err instanceof Error ? err.message : "Dataset build failed",
    };
  } finally {
    buildPromise = null;
  }
}

/** Kick off a build if the cache is empty/stale and one isn't already running. */
function ensureBuild(): void {
  const stale =
    status.builtAt == null || Date.now() - Date.parse(status.builtAt) > FUNDAMENTALS_TTL_MS;
  if (!buildPromise && (fundamentals.size === 0 || stale) && status.stage !== "ready") {
    buildPromise = build();
  } else if (!buildPromise && stale && status.stage === "ready") {
    // Cache aged out — rebuild in the background while still serving stale data.
    buildPromise = build();
  }
}

async function refreshPriceLayer(): Promise<Map<string, RichQuote>> {
  if (priceLayer && Date.now() - priceLayer.at < PRICE_TTL_MS) return priceLayer.map;
  const symbols = [...fundamentals.keys()];
  const map = new Map<string, RichQuote>();
  const CHUNK = 200;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const quotes = await withRetry(() => getRichQuotes(symbols.slice(i, i + CHUNK)));
    for (const q of quotes ?? []) map.set(q.symbol, q);
  }
  priceLayer = { map, at: Date.now() };
  return map;
}

/** Merge cached fundamentals with the live price layer and compute scores. */
function assembleMetrics(prices: Map<string, RichQuote>): StockMetrics[] {
  const out: StockMetrics[] = [];
  for (const f of fundamentals.values()) {
    const p = prices.get(f.symbol);
    if (isOtc(p?.exchange ?? null)) continue;
    const marketCap = p?.marketCap ?? null;
    const rawFcfYield =
      f.freeCashflow != null && marketCap && marketCap !== 0
        ? (f.freeCashflow / marketCap) * 100
        : null;
    // A |yield| above ~40% almost always means an FX mismatch (foreign-currency
    // FCF over a USD market cap), not a real bargain — drop it.
    const fcfYield = rawFcfYield != null && Math.abs(rawFcfYield) <= 40 ? rawFcfYield : null;

    const base = {
      symbol: f.symbol,
      name: f.name,
      sector: f.sector,
      industry: f.industry,
      price: p?.price ?? null,
      marketCap,
      forwardPE: f.forwardPE,
      evToEbitda: f.evToEbitda,
      fcfYield,
      revenueGrowthYoY: f.revenueGrowthYoY,
      revenueCagr3y: f.revenueCagr3y,
      epsGrowthYoY: f.epsGrowthYoY,
      epsCagr3y: f.epsCagr3y,
      roic: f.roic,
      roe: f.roe,
      grossMargin: f.grossMargin,
      operatingMargin: f.operatingMargin,
      debtToEquity: f.debtToEquity,
      netDebtToEbitda: f.netDebtToEbitda,
      currentRatio: f.currentRatio,
      fcfMargin: f.fcfMargin,
      fcfGrowthYoY: f.fcfGrowthYoY,
      dividendYield: f.dividendYield,
      buybackYield: f.buybackYield,
      oneYearReturn: p?.oneYearReturn ?? null,
      distanceFrom52WkHigh: p?.distanceFrom52WkHigh ?? null,
      institutionalOwnership: f.institutionalOwnership,
      earningsSurprisePct: f.earningsSurprisePct,
    };
    out.push({ ...base, scores: computeScores(base) });
  }
  return out;
}

export function getDatasetStatus(): DatasetStatus {
  ensureBuild();
  return status;
}

/**
 * The screener's main entry point: ensures a build is running, and — once
 * fundamentals exist — returns the fully merged, scored metrics. While the
 * dataset is still warming, returns whatever is ready so far.
 */
export async function getScreenerData(): Promise<{
  status: DatasetStatus;
  metrics: StockMetrics[];
}> {
  ensureBuild();
  if (fundamentals.size === 0) return { status, metrics: [] };
  const prices = await refreshPriceLayer();
  return { status, metrics: assembleMetrics(prices) };
}

/** Force a full rebuild (manual "Refresh data"). */
export function refreshScreenerData(): DatasetStatus {
  fundamentals.clear();
  priceLayer = null;
  clearFundamentals();
  status = { stage: "empty", total: 0, ready: 0, builtAt: null };
  buildPromise = build();
  return status;
}
