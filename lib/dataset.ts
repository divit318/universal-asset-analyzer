import { enrichSymbol } from "./enrich";
import { getIndiaUniverse, getReitUniverse, getUniverse, type UniverseEntry } from "./universe";
import { getRichQuotes, type RichQuote } from "./yahoo";
import { computeScores } from "./composite";
import { clearFundamentals, getFreshFundamentals, putFundamentals } from "./db";
import type { DatasetStatus, StockFundamentals, StockMetrics } from "./types";

/**
 * Owns the enriched, scored datasets the screener runs on. Fundamentals are
 * expensive (two Yahoo calls per company) so they're built once, cached in
 * memory, and persisted to SQLite for ~12h. A cheap live price layer (one batch
 * quote per 200 names) is merged on top at screen time, and the composite
 * scores are computed from the merge. The build runs in the background; callers
 * poll `status` until ready.
 *
 * This was a single module-level singleton serving one universe (the top 1,000
 * US equities). It is now a **factory**, because REITs need a universe of their
 * own: they are mid-caps, so a top-1,000-by-market-cap list (which bottoms out
 * at $9.7B) contained only 55 of the 364 listed US REITs, and "REIT screening"
 * really meant "the sixth of the sector that happens to be large-cap".
 *
 * The two datasets share the SQLite `fundamentals_cache`, which is keyed by
 * symbol — so the ~55 REITs that also appear in the equity universe are
 * enriched once and read by both. That sharing is the reason a second dataset
 * costs far less than it looks like it should.
 */

const FUNDAMENTALS_TTL_MS = 12 * 60 * 60 * 1000;
const PRICE_TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;
const PERSIST_EVERY = 25;
const MAX_PASSES = 5; // retry rate-limited symbols in waves until coverage holds

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
  let lastErr: unknown;
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Exponential backoff with jitter to ride out Yahoo rate-limiting.
      await sleep(500 * 2 ** a + Math.random() * 400);
    }
  }
  // A persistent (non-transient) failure here silently nulled marketCap/fcfYield
  // for an entire 200-symbol price-layer chunk with zero visibility — logging it
  // is what makes that failure mode debuggable instead of invisible.
  console.warn(
    `[dataset] withRetry exhausted ${attempts} attempts:`,
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
  return null;
}

export interface EnrichedDataset {
  getStatus(): DatasetStatus;
  getData(): Promise<{ status: DatasetStatus; metrics: StockMetrics[] }>;
  refresh(): DatasetStatus;
}

/**
 * Build an enriched, scored dataset over whatever universe `getSymbols` returns.
 * Every instance gets the same lifecycle: background build, stale-serve while
 * rebuilding, SQLite-backed fundamentals, a live price layer merged at read time.
 */
function createEnrichedDataset(getSymbols: () => Promise<UniverseEntry[]>): EnrichedDataset {
  const fundamentals = new Map<string, StockFundamentals>();
  let universe: UniverseEntry[] = [];
  let status: DatasetStatus = { stage: "empty", total: 0, ready: 0, builtAt: null };
  let buildPromise: Promise<void> | null = null;
  let priceLayer: { map: Map<string, RichQuote>; at: number } | null = null;

  async function build(): Promise<void> {
    try {
      status = { stage: "building", total: 0, ready: 0, builtAt: status.builtAt };
      universe = await getSymbols();
      const inUniverse = new Set(universe.map((u) => u.symbol));
      status.total = universe.length;

      // Hydrate from the SQLite cache first (survives restarts, and is shared
      // with every other dataset — a symbol in two universes is fetched once).
      //
      // Rows cached before `operatingCashflow` was added deserialize without the
      // key at all, and that field is what the REIT screener's P/FFO is built
      // on — so a stale row would serve a permanent null rather than a multiple.
      // `undefined` (never fetched) is therefore treated as a cache miss and
      // re-enriched, while an explicit `null` (fetched, Yahoo had nothing) is
      // honoured as a real answer and left alone.
      const { rows, builtAt } = getFreshFundamentals(FUNDAMENTALS_TTL_MS);
      for (const row of rows) {
        if (!inUniverse.has(row.symbol) || isOtc(row.exchange)) continue;
        if (row.operatingCashflow === undefined) continue; // predates the field — refetch
        fundamentals.set(row.symbol, row);
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

  /** In-flight background price refresh, so N concurrent screens trigger one. */
  let priceRefresh: Promise<void> | null = null;

  /**
   * Serve the price layer, refreshing it in the background rather than making a
   * user wait for it.
   *
   * The price layer costs eight sequential batched network calls for 1,540
   * symbols, and it was `await`ed inside the request that happened to arrive
   * after the 5-minute TTL expired. So one screen in every five-minute window
   * paid for the whole refresh: measured at **3.7 seconds** against a 7ms median,
   * on the largest and most-used universe. From the user's side that is the
   * screener randomly hanging, with no relationship to what they did.
   *
   * Stale-while-revalidate fixes it, and it's the pattern this file's own
   * universe build already uses ("serve stale data while rebuilding"). Prices at
   * most a few minutes old are entirely adequate for screening — nobody sizes a
   * position off a screener row — whereas a multi-second stall is not.
   *
   * The one case that still blocks is the first call of the process's life, when
   * there is no price layer at all: serving no prices would mean serving null
   * market caps and FCF yields, which is worse than waiting once.
   */
  function servePriceLayer(): Map<string, RichQuote> | null {
    const stale = !priceLayer || Date.now() - priceLayer.at >= PRICE_TTL_MS;
    if (stale && !priceRefresh) {
      priceRefresh = rebuildPriceLayer()
        .then(() => undefined)
        .catch((err: unknown) => {
          // A failed background refresh must never reject into a request that has
          // already been served; the stale layer stays in place until it works.
          console.warn(
            "[dataset] background price refresh failed:",
            err instanceof Error ? err.message : err,
          );
        })
        .finally(() => {
          priceRefresh = null;
        });
    }
    return priceLayer?.map ?? null;
  }

  async function rebuildPriceLayer(): Promise<Map<string, RichQuote>> {
    const symbols = [...fundamentals.keys()];
    const map = new Map<string, RichQuote>();
    const CHUNK = 200;
    for (let i = 0; i < symbols.length; i += CHUNK) {
      const chunk = symbols.slice(i, i + CHUNK);
      const quotes = await withRetry(() => getRichQuotes(chunk));
      if (quotes == null) {
        console.warn(
          `[dataset] price layer chunk failed entirely (${chunk.length} symbols starting at ${chunk[0]}) — marketCap/fcfYield will be null for all of them this cycle`,
        );
        continue;
      }
      for (const q of quotes) map.set(q.symbol, q);
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
        netDebt: f.netDebt,
        currentRatio: f.currentRatio,
        fcfMargin: f.fcfMargin,
        fcfGrowthYoY: f.fcfGrowthYoY,
        // Carried through for the REIT screener's FFO proxy.
        operatingCashflow: f.operatingCashflow ?? null,
        ocfGrowthYoY: f.ocfGrowthYoY ?? null,
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

  return {
    getStatus() {
      ensureBuild();
      return status;
    },

    async getData() {
      ensureBuild();
      if (fundamentals.size === 0) return { status, metrics: [] };
      // Non-blocking in the steady state; only the very first call of the
      // process waits, because there is nothing stale to serve yet.
      const prices = servePriceLayer() ?? (await rebuildPriceLayer());
      return { status, metrics: assembleMetrics(prices) };
    },

    refresh() {
      // Only evict this dataset's own symbols: the fundamentals cache is shared,
      // so a blanket DELETE would make the other dataset re-fetch hundreds of
      // companies it already had.
      const symbols = [...fundamentals.keys()];
      fundamentals.clear();
      priceLayer = null;
      clearFundamentals(symbols);
      status = { stage: "empty", total: 0, ready: 0, builtAt: null };
      buildPromise = build();
      return status;
    },
  };
}

/** US equities: the large-cap core plus a liquid small/mid-cap tranche. */
export const equityDataset: EnrichedDataset = createEnrichedDataset(() => getUniverse());

/**
 * Indian equities (~500 largest NSE names). Shares the same enrichment
 * pipeline and SQLite fundamentals cache as the US dataset; symbols carry the
 * .NS suffix so cache rows never collide. Yahoo enrichment is INR-native for
 * NSE listings (financialCurrency INR), so every ratio is internally
 * consistent — only market cap needs ₹-aware formatting downstream.
 */
export const indiaEquityDataset: EnrichedDataset = createEnrichedDataset(() => getIndiaUniverse());

/** Listed real estate: its own universe, not the Real Estate slice of a large-cap list. */
export const reitDataset: EnrichedDataset = createEnrichedDataset(() => getReitUniverse());
