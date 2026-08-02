/**
 * The ETF universe. Pages Yahoo's ETF screener by net assets (largest first),
 * then enriches the top slice with holdings data.
 *
 * The screener row itself carries netExpenseRatio, netAssets, dividendYield,
 * ytdReturn, volume and the 52-week range — verified against a live response —
 * so cost, size, income and liquidity are all available for the whole universe
 * with zero extra calls. Only concentration, sector exposure and style need the
 * per-fund enrichment pass, and only the largest ETFs get it.
 *
 * Volatility and drawdown need daily history, which is another call per fund.
 * They're computed for the enriched slice only, for the same reason.
 */

import { pageRawScreener, q, type RawQuoteRow } from "../../yahoo-screener";
import { getHistory } from "../../yahoo";
import { annualizedVolatility, drawdown, mapPool, trailingReturn, withRetry } from "../metrics-util";
import { createUniverseCache, type UniverseProvider } from "../universe-cache";
import type { ScreenerCandidate } from "../types";
import { getFundDetails, type FundDetail } from "./fund-shared";
import { BOND_CATEGORIES } from "../../assets/bond";

/** How many funds to pull from the screener. */
const UNIVERSE_LIMIT = Number(process.env.SCREENER_ETF_LIMIT) || 600;
/**
 * How many of those (largest by AUM) get the holdings + history enrichment
 * pass. Used to default to half of UNIVERSE_LIMIT (300), which nulled 1-year
 * return, volatility, region and focus for the smaller half of the universe
 * by construction — not a data-availability gap, just a cap nobody raised
 * once the pipeline moved to a background-built, 12h-cached universe (this
 * build never blocks a page load; raising it only costs background time).
 * Defaults to the full universe; still overridable for local/dev runs.
 */
const ENRICH_LIMIT = Number(process.env.SCREENER_ETF_ENRICH) || UNIVERSE_LIMIT;
const TTL_MS = 12 * 60 * 60 * 1000;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/* -------------------------------------------------------------------------- */
/* Category → region / focus / style                                          */
/* -------------------------------------------------------------------------- */

/**
 * Yahoo's Morningstar-style `categoryName` is the only geography/style signal
 * available (there is no country-weight breakdown in any free endpoint), but it
 * is a real one: "China Region", "Japan Stock", "Large Growth", "Technology"
 * all say exactly what the fund is. These three mappers read it.
 */
export function categoryRegion(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("china")) return "China";
  if (c.includes("japan")) return "Japan";
  if (c.includes("india")) return "India";
  if (c.includes("latin america")) return "Latin America";
  if (c.includes("europe")) return "Europe";
  if (c.includes("emerging")) return "Emerging Markets";
  if (c.includes("foreign") || c.includes("international")) return "Developed ex-US";
  if (c.includes("global") || c.includes("world")) return "Global";
  if (c.includes("diversified pacific") || c.includes("pacific")) return "Developed ex-US";
  // Everything else in the US screener with no geographic qualifier is US.
  return "US";
}

export function categoryFocus(category: string | null, topSector: string | null): string | null {
  const c = (category ?? "").toLowerCase();
  if (c.includes("technology")) return "Technology";
  if (c.includes("health")) return "Healthcare";
  if (c.includes("financial")) return "Financials";
  if (c.includes("energy")) return "Energy";
  if (c.includes("real estate")) return "Real Estate";
  if (c.includes("utilities")) return "Utilities";
  if (c.includes("industrial")) return "Industrials";
  if (c.includes("consumer")) return "Consumer";
  if (c.includes("natural resources") || c.includes("materials")) return "Materials";
  if (c.includes("communication")) return "Communication";
  if (c.includes("commodit") || c.includes("precious metals")) return "Commodities";
  if (c.includes("blend") || c.includes("growth") || c.includes("value") || c.includes("total")) {
    return "Broad Market";
  }

  // No sector in the category name — fall back to what the fund actually holds.
  const known = [
    "Technology", "Healthcare", "Energy", "Real Estate", "Utilities",
    "Industrials", "Materials", "Communication",
  ];
  if (topSector && known.includes(topSector)) return topSector;
  if (topSector === "Financial Services") return "Financials";
  if (topSector?.startsWith("Consumer")) return "Consumer";
  if (topSector === "Basic Materials") return "Materials";
  return category ? "Other" : null;
}

export function categoryStyle(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("value")) return "Value";
  if (c.includes("growth")) return "Growth";
  if (c.includes("blend")) return "Blend";
  if (c.includes("dividend") || c.includes("income") || c.includes("preferred")) return "Income";
  // A sector/regional/commodity fund with no value/growth/blend qualifier is a
  // targeted bet — Morningstar calls these "miscellaneous sector"/thematic.
  if (
    c.includes("miscellaneous") ||
    c.includes("trading") ||
    c.includes("leveraged") ||
    c.includes("digital") ||
    c.includes("infrastructure")
  ) {
    return "Thematic";
  }
  const sectorish = [
    "technology", "health", "financial", "energy", "real estate", "utilities",
    "industrial", "consumer", "natural resources", "communication", "equity precious metals",
  ];
  if (sectorish.some((s) => c.includes(s))) return "Sector";
  return "Other";
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Structure: what kind of vehicle is this, really                             */
/* -------------------------------------------------------------------------- */

/**
 * The wrapper, as opposed to the exposure.
 *
 * This is the filter an institutional user reaches for first and no consumer
 * screener offers: **exclude the leveraged and inverse products**. A 3x daily-reset
 * fund is not a small-cap fund with more risk, it is a different instrument with
 * path-dependent decay, and its presence in a ranked list of "small cap ETFs" is
 * a category error rather than an aggressive option. Covered-call funds are
 * flagged for the same reason in reverse: their yield is option premium, not
 * income, and a dividend screen that ranks them alongside dividend payers is
 * comparing a sold call to a cash flow.
 *
 * Derived from the fund's Morningstar category plus its name, both already
 * fetched. Names are load-bearing here because Morningstar files many
 * covered-call and buffer products under plain equity categories.
 */
export function fundStructure(category: string | null, name: string): string {
  const haystack = `${category ?? ""} ${name}`.toLowerCase();

  // Order matters: leverage and inversion dominate everything else about a
  // vehicle, and a "-3x inverse" product must not be filed under "Inverse" only.
  if (/\b(-?[23](\.\d)?x|ultrapro|ultrashort|triple|double)\b/.test(haystack) || /leveraged/.test(haystack)) {
    return /\b(inverse|short|bear)\b/.test(haystack) ? "Leveraged Inverse" : "Leveraged";
  }
  if (/\b(inverse|bear)\b/.test(haystack)) return "Inverse";
  if (/covered call|buywrite|premium income|option income/.test(haystack)) return "Covered Call";
  if (/\bbuffer|defined outcome|target outcome\b/.test(haystack)) return "Buffered";
  if (/currency hedged|\bhedged\b/.test(haystack)) return "Currency Hedged";
  return "Plain";
}

/**
 * Raw `fundProfile.family` → the canonical issuer name the filter offers.
 *
 * Necessary because the raw strings do not match anything a user would type, and
 * a categorical filter compares against them exactly: Yahoo says "State Street
 * Investment Management", "Dimensional Fund Advisors", "Global X Funds". Offering
 * "Dimensional" as an option and storing "Dimensional Fund Advisors" as the
 * attribute produces a filter that is present, selectable, and matches nothing —
 * the worst of the three possible outcomes.
 *
 * iShares and BlackRock are folded together deliberately: they are one firm, and
 * the question this filter answers ("issuers I have diligenced") is about the
 * firm, not the brand. Verified against the live 447-fund universe; anything
 * unrecognised becomes "Other" rather than fragmenting the option list.
 */
const ISSUER_PATTERNS: [RegExp, string][] = [
  [/ishares|blackrock/i, "iShares / BlackRock"],
  [/vanguard/i, "Vanguard"],
  [/state street|spdr/i, "State Street"],
  [/invesco/i, "Invesco"],
  [/first trust/i, "First Trust"],
  [/dimensional/i, "Dimensional"],
  [/j\.?p\.? ?morgan/i, "JPMorgan"],
  [/schwab/i, "Schwab"],
  [/fidelity/i, "Fidelity"],
  [/global x/i, "Global X"],
  [/capital group/i, "Capital Group"],
  [/avantis/i, "Avantis"],
  [/vaneck/i, "VanEck"],
  [/wisdomtree/i, "WisdomTree"],
  [/franklin/i, "Franklin Templeton"],
  [/proshares/i, "ProShares"],
  [/goldman/i, "Goldman Sachs"],
  [/direxion/i, "Direxion"],
  [/pacer/i, "Pacer"],
];

export function fundIssuer(family: string | null): string | null {
  if (!family) return null;
  for (const [pattern, name] of ISSUER_PATTERNS) if (pattern.test(family)) return name;
  return "Other";
}

/* -------------------------------------------------------------------------- */
/* What is (and isn't) an ETF for this class                                   */
/* -------------------------------------------------------------------------- */

/** Bond categories are screened as the `bond` asset class, not as generic ETFs. */
const BOND_CATEGORY_SET = new Set<string>(BOND_CATEGORIES.map((c) => c.toLowerCase()));

/**
 * Fixed-income and cash categories that are NOT in BOND_CATEGORIES, because the
 * bond universe doesn't query them — so nothing else in the app filters them
 * out. All three verified live against real `fundProfile.categoryName` values.
 *
 * `Convertibles` is here on the strength of what the funds actually are: ICVT is
 * named "iShares Convertible Bond ETF" and reports 0.1% stocks against 16%
 * bonds, with the balance in convertible paper. Note that this class is the only
 * place it currently appears — see the note in the audit about extending
 * BOND_CATEGORIES so convertibles are screenable as bonds instead.
 *
 * Preferred-stock funds are deliberately NOT here: the registry already models
 * them (`categoryStyle` maps "preferred" to the Income style), they have nowhere
 * else to live, and unlike a bond ladder they are legitimately screened as ETFs.
 * They are kept out of the low-volatility *template* instead, which is where
 * their bond-like volatility was actually doing damage.
 */
const NON_EQUITY_CATEGORY_PATTERNS = [/money market/, /target maturity/, /convertible/];

/**
 * Names that give a bond or cash fund away when holdings data is unavailable.
 * Deliberately narrow: this only runs for the handful of funds Yahoo returned
 * nothing for, where the alternative is admitting them blind.
 */
const FIXED_INCOME_NAME_RE =
  /\b(bond|bonds|treasury|treasuries|muni|municipal|money market|t-bill|ultra[- ]?short|floating rate)\b/i;

/**
 * Is this fund something other than an equity/commodity/crypto ETF — i.e. a bond
 * fund, a money-market fund or a bond ladder that happens to trade on an
 * exchange?
 *
 * Such funds belong to the `bond` class (where duration and credit quality are
 * first-class) or nowhere, and they are actively harmful in this one: the ETF
 * ranking weights volatility, so cash vehicles sweep any low-volatility screen
 * by construction. Live verification of the "Low Volatility" template returned
 * SBIL (a money-market fund, 0.26% vol), BSCQ and IBDR (bond ladders) as its
 * top three results — ahead of every actual low-volatility equity ETF.
 *
 * The rules are ordered cheapest-and-sharpest first, and every threshold below
 * was set against real payloads rather than intuition. The two traps:
 *
 *  - **0% equity does not mean "not an equity ETF".** GLD, SLV, USO and BITO all
 *    report `stockPosition: 0`. Excluding on low equity weight would delete the
 *    entire commodity and crypto shelf.
 *  - **A big cash position does not mean "cash fund".** Futures-backed funds post
 *    collateral: BITO holds 67.5% cash, USO 57.3%, TQQQ 34.5%. Only cash *plus*
 *    bonds at ~100% with no equity is actually a cash vehicle.
 */
export function isNonEquityFund(detail: FundDetail | undefined, name: string): boolean {
  // Nothing known at all — fall back to the name rather than admitting blind.
  // (This is why `available` exists: an enrichment timeout used to produce the
  // same all-null detail as a genuine "holds no bonds", and NXUS — an aggregate
  // bond ETF — rode that ambiguity straight into the equity ETF universe.)
  if (!detail?.available) return FIXED_INCOME_NAME_RE.test(name);

  const category = detail.category?.toLowerCase() ?? null;
  if (category) {
    if (BOND_CATEGORY_SET.has(category)) return true;
    if (NON_EQUITY_CATEGORY_PATTERNS.some((re) => re.test(category))) return true;
  }

  const bond = detail.bondWeight;
  const cash = detail.cashWeight;
  const equity = detail.equityWeight ?? 0;

  // Majority bonds: a bond fund, or an allocation fund dominated by its bond
  // sleeve (FREI — 61.6% bonds against 22% equity — wearing "Miscellaneous
  // Allocation" as a category).
  if (bond != null && bond >= 50 && bond > equity) return true;

  // Effectively all bonds and cash with no equity at all: a money-market fund or
  // a maturity-dated ladder. SBIL reports 31.2% bonds + 68.8% cash; BSCQ and
  // IBDR both 48% + 52%. The 90% floor is what keeps BITO (67.5% cash) and USO
  // (57.3%) — which are real, screenable funds — on the right side of the line.
  if (bond != null && cash != null && bond + cash >= 90 && equity < 5) return true;

  return false;
}

export function toCandidate(
  row: RawQuoteRow,
  detail: FundDetail | undefined,
  history: { volatility: number | null; maxDrawdown: number | null; oneYearReturn: number | null } | undefined,
): ScreenerCandidate {
  const symbol = row.symbol as string;
  // The screener row's netExpenseRatio is already a percentage; fundProfile's
  // annualReportExpenseRatio is a fraction (0.0003) and fund-shared scales it.
  // Prefer the screener's, fall back to the enriched one.
  const expenseRatio = num(row.netExpenseRatio) ?? detail?.expenseRatio ?? null;
  const name = str(row.longName) ?? str(row.shortName) ?? symbol;

  /*
   * Everything below is derived from fields already on the cached screener row —
   * no additional request, and nothing computed at screen time. Coverage was
   * measured across a live 250-fund page before each was added, because a filter
   * backed by a 30%-populated field is worse than no filter: it silently deletes
   * the other 70% of the universe.
   *
   *   firstTradeDateMilliseconds  100%   averageDailyVolume3Month  100%
   *   fiftyTwoWeekHigh            100%   trailingThreeMonthReturns  99%
   *   trailingPE                   78%
   *
   * Deliberately NOT added: `sharesOutstanding` (33%) and `priceToBook` (31%).
   * The first is the input to the standard flows construction
   * (Δshares × NAV), so ETF fund flows are not honestly derivable from this
   * source — they stay declared-unavailable rather than shipped two-thirds empty.
   */
  const price = num(row.regularMarketPrice);
  const avgVolume = num(row.averageDailyVolume3Month);
  const fiftyTwoWeekHigh = num(row.fiftyTwoWeekHigh);
  const firstTrade = num(row.firstTradeDateMilliseconds);
  const tenDayVolume = num(row.averageDailyVolume10Day);

  return {
    symbol,
    name,
    assetClass: "etf",
    price: num(row.regularMarketPrice),
    changePercent: num(row.regularMarketChangePercent),
    metrics: {
      expenseRatio,
      aum: num(row.netAssets),
      avgVolume: num(row.averageDailyVolume3Month),
      dividendYield: num(row.dividendYield),
      ytdReturn: num(row.ytdReturn),
      oneYearReturn: history?.oneYearReturn ?? null,
      volatility: history?.volatility ?? null,
      maxDrawdown: history?.maxDrawdown ?? null,
      top10Concentration: detail?.top10Concentration ?? null,
      topSectorWeight: detail?.topSectorWeight ?? null,
      equityWeight: detail?.equityWeight ?? null,

      /* --- Liquidity: can I actually build a position in this? ------------- */
      // Dollar volume, not share volume. 3m ADV of 500k shares means nothing
      // until you know whether the shares are $4 or $600 — this is the number
      // that decides whether a fund is tradeable at institutional size.
      dollarVolume: price != null && avgVolume != null ? price * avgVolume : null,
      // 10-day against 3-month volume: is interest in this fund building or
      // fading? A fund whose recent volume is a third of its average is quietly
      // being abandoned, which is the leading indicator of a closure.
      liquidityTrend:
        tenDayVolume != null && avgVolume != null && avgVolume > 0 ? tenDayVolume / avgVolume : null,

      /* --- Size, age and diversification ---------------------------------- */
      // Track record and closure risk. A fund launched eight months ago has no
      // through-cycle behaviour to evaluate, however good its backtest looks.
      fundAge: firstTrade != null ? (Date.now() - firstTrade) / (365.25 * 24 * 3600 * 1000) : null,
      effectiveSectors: detail?.effectiveSectors ?? null,
      cashWeight: detail?.cashWeight ?? null,
      bondWeight: detail?.bondWeight ?? null,

      /* --- Look-through valuation ----------------------------------------- */
      // The fund's own trailing P/E *is* the weighted P/E of its holdings, which
      // makes "show me cheap ETFs by what they actually own" answerable without
      // a holdings feed. This is the one metric here an institutional user would
      // normally need N-PORT ingestion or a vendor to get.
      lookThroughPE: num(row.trailingPE),

      /* --- Return path ---------------------------------------------------- */
      threeMonthReturn: num(row.trailingThreeMonthReturns),
      distanceFrom52WkHigh:
        price != null && fiftyTwoWeekHigh != null && fiftyTwoWeekHigh > 0
          ? ((price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100
          : null,
    },
    attributes: {
      region: categoryRegion(detail?.category ?? null),
      focus: categoryFocus(detail?.category ?? null, detail?.topSector ?? null),
      style: categoryStyle(detail?.category ?? null),
      // The wrapper, so leveraged/inverse/covered-call products can be excluded
      // outright rather than silently ranked against plain funds.
      structure: fundStructure(detail?.category ?? null, name),
      issuer: fundIssuer(detail?.family ?? null),
    },
    topHoldings: detail?.topHoldings ?? null,
  };
}

async function build(report: (ready: number, total: number) => void): Promise<ScreenerCandidate[]> {
  const rows = await pageRawScreener(
    {
      quoteType: "ETF",
      query: q.and(q.eq("region", "us")),
      sortField: "fundnetassets",
      sortDir: "desc",
    },
    UNIVERSE_LIMIT,
  );

  report(0, rows.length);

  const toEnrich = rows.slice(0, ENRICH_LIMIT).map((r) => r.symbol as string);
  const details = await getFundDetails(toEnrich);

  // History for the enriched slice, for volatility / drawdown / 1-year return.
  const histories = new Map<string, { volatility: number | null; maxDrawdown: number | null; oneYearReturn: number | null }>();
  let done = 0;
  await mapPool(toEnrich, 4, async (symbol) => {
    const h = await withRetry(() => getHistory(symbol, 400));
    if (h && h.length > 20) {
      histories.set(symbol, {
        volatility: annualizedVolatility(h, 252),
        maxDrawdown: drawdown(h),
        oneYearReturn: trailingReturn(h, 252),
      });
    }
    report(++done, rows.length);
  });

  // Bond funds, money-market funds and maturity-dated bond ladders belong to the
  // `bond` asset class, where duration and credit quality are first-class;
  // judging them on top-10 concentration and sector weight would be meaningless,
  // and leaving them here lets cash instruments win every low-volatility screen.
  //
  // The ETF *screener row* carries no category field (verified — it has
  // netExpenseRatio and netAssets but no categoryName), so the classification
  // has to come from what enrichment says the fund actually holds. See
  // `isNonEquityFund` for the rules and the payloads behind each threshold.
  return rows
    .filter((r) => {
      const symbol = r.symbol as string;
      const name = str(r.longName) ?? str(r.shortName) ?? symbol;
      return !isNonEquityFund(details.get(symbol), name);
    })
    .map((r) =>
      toCandidate(r, details.get(r.symbol as string), histories.get(r.symbol as string)),
    );
}

export const etfUniverse: UniverseProvider = createUniverseCache({
  assetClass: "etf",
  ttlMs: TTL_MS,
  build,
});
