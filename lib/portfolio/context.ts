/**
 * MarketContext assembly — the Portfolio's single data-fetching path.
 *
 * Two rules from CLAUDE.md that the Portfolio was breaking, and that this file
 * exists to obey:
 *
 *   "Never add a cache to a module."
 *       → /api/portfolio/report held a private `let cached: {report, at}` with its
 *         own 5-minute TTL, invisible to the platform layer, un-invalidatable, and
 *         unaware of the four other caches around it.
 *
 *   "Don't hand-roll Promise.all waterfalls in routes. Declare a plan and let
 *    runPlan() handle order, concurrency, failure isolation, and cancellation."
 *       → the report route built a hand-rolled Promise.all-inside-Promise.all
 *         waterfall, per position, with no failure isolation.
 *
 * Everything here goes through lib/yahoo.ts, which is already wired into the
 * platform data layer at the provider boundary — so caching, in-flight dedup, SWR
 * and persistence come for free, and Portfolio finally shares a cache with Research
 * and Screener instead of re-fetching the same quotes they just fetched.
 *
 * Server-only.
 */

import { runPlan, stepValue } from "../platform";
import { dayChange } from "../day-change";
import { datedReturns } from "./engines/series";
import { getQuotes, getHistory, getQuoteSummary } from "../yahoo";
import { getFundamentals } from "../fundamentals";
import { getFundDetails } from "../screener/universes/fund-shared";
import type {
  ContextFundamentals,
  ContextQuote,
  MarketContext,
  RawHolding,
} from "./model/types";
import { portfolioSymbols } from "./store";

const BENCHMARK = "SPY";
/**
 * The US 10-year Treasury yield index. ^TNX quotes the YIELD as its price (4.23 =
 * 4.23%), so first-differencing its closes gives daily yield changes in percentage
 * points — the regressor that turns a bond fund's rate sensitivity into a
 * measurement instead of an assumption. One extra fetch for the whole portfolio.
 */
const RATE_INDEX = "^TNX";
const HISTORY_DAYS = 400;

/** Dominant credit-rating bucket for a bond fund — drives credit-spread sensitivity. */
function dominantRating(ratings: Record<string, number> | null): string | null {
  if (!ratings) return null;
  // NOTE (from lib/assets/bond.ts): Yahoo's `us_government` bucket OVERLAPS the
  // letter buckets — it double-counts Treasuries. Checking it first is deliberate:
  // a fund that is majority US government IS a Treasury fund, whatever its letter
  // spread says, and that determines the SIGN of its credit-spread sensitivity.
  if ((ratings.us_government ?? 0) >= 50) return "us_government";

  const letters = Object.entries(ratings).filter(([k]) => k !== "us_government");
  if (letters.length === 0) return null;
  const top = letters.reduce((a, b) => (b[1] > a[1] ? b : a));
  return top[1] > 0 ? top[0] : null;
}

/**
 * FX rates to the base currency.
 *
 * Yahoo quotes a pair like EURUSD=X as "USD per 1 EUR", which is exactly the
 * multiplier we need to convert a EUR amount into USD. Any currency we cannot
 * resolve falls back to 1 — which would silently mis-total the portfolio, so it is
 * also logged. Getting FX wrong doesn't produce an obviously broken number; it
 * produces a plausible wrong one, which is worse.
 */
async function fetchFx(
  currencies: string[],
  base: string,
): Promise<{ fx: Record<string, number>; unresolved: string[] }> {
  const fx: Record<string, number> = { [base.toUpperCase()]: 1 };
  const needed = [...new Set(currencies.map((c) => c.toUpperCase()))].filter((c) => c !== base.toUpperCase());
  if (needed.length === 0) return { fx, unresolved: [] };

  const pairs = needed.map((c) => `${c}${base.toUpperCase()}=X`);
  try {
    const quotes = await getQuotes(pairs);
    for (const q of quotes) {
      const cur = q.symbol.replace(`${base.toUpperCase()}=X`, "").toUpperCase();
      if (q.price > 0) fx[cur] = q.price;
    }
  } catch {
    // Non-fatal: fall through to the 1:1 fallback below rather than failing the
    // whole portfolio over one unavailable rate.
  }

  // Which currencies fell back to 1:1, RETURNED rather than only logged.
  //
  // This used to be a console.warn and a comment claiming "the UI flags any
  // currency that didn't resolve". It did not. The only FX check in the UI is
  // `fxRate !== 1`, so a failed lookup — which sets the rate to exactly 1 — renders
  // identically to a genuine base-currency holding: no currency badge, no FX row,
  // no flag anywhere. A EUR position could be carried 10-40% wrong and flow
  // silently into total value, every weight, allocation, health, risk and
  // attribution figure on the page.
  //
  // Getting FX wrong does not produce an obviously broken number; it produces a
  // plausible wrong one, which is why it has to be surfaced rather than logged.
  const unresolved: string[] = [];
  for (const c of needed) {
    if (fx[c] == null) {
      fx[c] = 1;
      unresolved.push(c);
      console.warn(`[portfolio] No FX rate for ${c}→${base}; treating 1:1. Totals may be wrong.`);
    }
  }
  return { fx, unresolved };
}

interface RawProfile {
  assetProfile?: { sector?: string; industry?: string; country?: string };
  price?: { currency?: string };
  summaryDetail?: { beta?: number };
}

/**
 * Build the MarketContext for a set of holdings.
 *
 * `candidateSymbols` additionally fetches quotes/fundamentals for specific
 * recommendation-engine candidate instruments — necessary because those
 * candidates are valued and stress-tested by the SAME adapters as real
 * holdings, which is what makes their simulated impact real rather than
 * asserted.
 *
 * Callers should pass only the candidates they actually need, not the full
 * candidate universe. Every one of these costs a real history + fundamentals
 * + profile fetch per symbol — the report route used to pass ALL ~10
 * candidates unconditionally on every load (even when viewing tabs that never
 * show a recommendation), which is the single biggest reason a portfolio page
 * load was slow: it was fetching close to double the symbols it needed. See
 * `engines/recommend.ts`'s `getRelevantCandidateSymbols()` for how the report
 * route now narrows this to just the candidates relevant to detected gaps.
 */
export async function buildMarketContext(
  raws: RawHolding[],
  opts: { baseCurrency?: string; candidateSymbols?: string[] } = {},
): Promise<MarketContext> {
  const base = (opts.baseCurrency ?? "USD").toUpperCase();

  const held = portfolioSymbols(raws);
  const symbols = [...new Set([
    ...held,
    ...(opts.candidateSymbols ?? []),
  ])];

  const currencies = [...new Set(raws.map((r) => r.currency))];

  if (symbols.length === 0) {
    return {
      baseCurrency: base,
      fx: (await fetchFx(currencies, base)).fx,
      unresolvedCurrencies: [],
      quotes: new Map(),
      history: new Map(),
      fundamentals: new Map(),
      benchmarkReturns: [],
      asOf: new Date().toISOString(),
    };
  }

  /* ---- One declared plan. runPlan() owns concurrency + failure isolation. ---- */

  const plan = [
    {
      id: "quotes",
      run: () => getQuotes(symbols),
    },
    {
      id: "fx",
      run: () => fetchFx(currencies, base),
    },
    {
      id: "benchmark",
      run: () => getHistory(BENCHMARK, HISTORY_DAYS),
    },
    {
      id: "rateIndex",
      run: () => getHistory(RATE_INDEX, HISTORY_DAYS),
    },
    {
      id: "fundDetails",
      // Reuses the screener's fund extractor — this is where REAL bond duration and
      // credit ratings come from. Not reimplemented.
      run: () => getFundDetails(symbols),
    },
    ...symbols.map((sym) => ({
      id: `history:${sym}`,
      run: () => getHistory(sym, HISTORY_DAYS),
    })),
    ...symbols.map((sym) => ({
      id: `fundamentals:${sym}`,
      run: () => getFundamentals(sym),
    })),
    ...symbols.map((sym) => ({
      id: `profile:${sym}`,
      run: () => getQuoteSummary(sym, ["assetProfile", "price", "summaryDetail"]),
    })),
  ];

  // Failure isolation: one dead symbol must not take down the portfolio. Every step
  // is read with stepValue(), which yields null rather than throwing.
  const result = await runPlan(plan, { concurrency: 6 });

  /* ---- Assemble ---- */

  const quoteList = stepValue<Awaited<ReturnType<typeof getQuotes>>>(result, "quotes") ?? [];
  const quotes = new Map<string, ContextQuote>();
  for (const q of quoteList) {
    const dc = dayChange(q);
    quotes.set(q.symbol.toUpperCase(), {
      symbol: q.symbol.toUpperCase(),
      price: q.price,
      changePercent: q.changePercent ?? null,
      currency: q.currency ?? null,
      name: q.name ?? null,
      marketCap: q.marketCap ?? null,
      // Which session changePercent describes, so downstream "today" claims
      // can be honest about a closed market (audit F-22).
      sessionDate: dc.sessionDate,
      asOf: dc.asOf,
      // The instrument TYPE, carried through so the risk-model classifier can tell
      // a money-market fund from a stock without a second provider call.
      assetType: q.assetType ?? null,
    });
  }

  // Closes and their DATES, kept strictly parallel. Filtering must drop the date
  // alongside the close it belongs to — a `filter()` on the closes alone silently
  // shifts every later date by one, which is worse than having no dates at all.
  const history = new Map<string, number[]>();
  const historyDates = new Map<string, string[]>();
  for (const sym of symbols) {
    const h = stepValue<Awaited<ReturnType<typeof getHistory>>>(result, `history:${sym}`);
    if (!h || h.length === 0) continue;
    const closes: number[] = [];
    const dates: string[] = [];
    for (const p of h) {
      const c = p.adjClose ?? p.close;
      if (!(c > 0)) continue;
      closes.push(c);
      dates.push(p.date.slice(0, 10));
    }
    if (closes.length === 0) continue;
    history.set(sym.toUpperCase(), closes);
    historyDates.set(sym.toUpperCase(), dates);
  }

  const fundDetails = stepValue<Awaited<ReturnType<typeof getFundDetails>>>(result, "fundDetails")
    ?? new Map();

  const fundamentals = new Map<string, ContextFundamentals>();
  for (const sym of symbols) {
    const key = sym.toUpperCase();
    const f = stepValue<Awaited<ReturnType<typeof getFundamentals>>>(result, `fundamentals:${sym}`);
    const profile = stepValue<RawProfile>(result, `profile:${sym}`);
    const fund = fundDetails.get(sym) ?? fundDetails.get(key) ?? null;
    const snap = f?.snapshot ?? null;

    // Skip symbols where every provider came back empty rather than inserting an
    // all-null record — the adapters treat a MISSING entry as "no data" and an
    // all-null entry the same way, but omitting it keeps the map honest about size.
    if (!snap && !profile && !fund) continue;

    fundamentals.set(key, {
      sector: snap?.sector ?? profile?.assetProfile?.sector ?? null,
      industry: profile?.assetProfile?.industry ?? null,
      country: profile?.assetProfile?.country ?? null,
      currency: profile?.price?.currency ?? null,
      dividendYield: snap?.dividendYield ?? null,
      // Carried, but DEMOTED: this field is not effective duration (TLT 3.55,
      // USFR 3.88, VXUS 4.48 — see ContextFundamentals.duration). The risk model
      // measures duration from returns instead and only falls back to this.
      duration: fund?.duration ?? null,
      maturity: fund?.maturity ?? null,
      creditQuality: dominantRating(fund?.ratings ?? null),
      // The Morningstar category and the position mix. These decide WHICH RISK
      // MODEL the holding gets (classes/reference/risk-models.ts) — the fields the
      // portfolio used to discard while the screener relied on them.
      fundCategory: fund?.category ?? null,
      bondWeight: fund?.bondWeight ?? null,
      equityWeight: fund?.equityWeight ?? null,
      cashWeight: fund?.cashWeight ?? null,
      otherWeight: fund?.otherWeight ?? null,
      topSector: fund?.topSector ?? null,
      topSectorWeight: fund?.topSectorWeight ?? null,
      expenseRatio: fund?.expenseRatio ?? null,
      // marketCap lives on the Quote, not the fundamentals snapshot.
      marketCap: quotes.get(key)?.marketCap ?? null,
      peRatio: snap?.trailingPE ?? null,
      priceToBook: snap?.priceToBook ?? null,
      returnOnEquity: snap?.returnOnEquity ?? null,
      revenueGrowth: snap?.revenueGrowth ?? null,
      operatingMargins: snap?.operatingMargins ?? null,
      debtToEquity: snap?.debtToEquity ?? null,
      operatingCashflow: snap?.operatingCashflow ?? null,
      beta: profile?.summaryDetail?.beta ?? null,
    });
  }

  const fxResult = stepValue<Awaited<ReturnType<typeof fetchFx>>>(result, "fx");

  const benchHistory = stepValue<Awaited<ReturnType<typeof getHistory>>>(result, "benchmark") ?? [];
  const benchCloses: number[] = [];
  const benchCloseDates: string[] = [];
  for (const p of benchHistory) {
    const c = p.adjClose ?? p.close;
    if (!(c > 0)) continue;
    benchCloses.push(c);
    benchCloseDates.push(p.date.slice(0, 10));
  }
  const bench = datedReturns(benchCloses, benchCloseDates);

  // Daily CHANGES in the 10-year yield, in percentage points. Not returns —
  // ^TNX's "price" IS the yield, so the first difference is already in the unit
  // the `rates` factor is shocked in, and dividing by the previous close (what
  // datedReturns would do) would be meaningless here.
  const rateHistory = stepValue<Awaited<ReturnType<typeof getHistory>>>(result, "rateIndex") ?? [];
  const rateChanges: number[] = [];
  const rateChangeDates: string[] = [];
  let prevYield: number | null = null;
  for (const p of rateHistory) {
    const y = p.adjClose ?? p.close;
    if (!(y > 0)) continue;
    if (prevYield != null) {
      rateChanges.push(y - prevYield);
      rateChangeDates.push(p.date.slice(0, 10));
    }
    prevYield = y;
  }

  return {
    baseCurrency: base,
    fx: fxResult?.fx ?? { [base]: 1 },
    // Surfaced, not just logged: a currency that fell back to 1:1 mis-values its
    // holdings while looking exactly like a base-currency position.
    unresolvedCurrencies: fxResult?.unresolved ?? [],
    quotes,
    history,
    historyDates,
    fundamentals,
    benchmarkReturns: bench.returns,
    benchmarkDates: bench.dates,
    rateChanges,
    rateChangeDates,
    asOf: new Date().toISOString(),
  };
}
