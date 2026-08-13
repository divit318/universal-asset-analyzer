/**
 * "If I want this exposure, is this the best vehicle for it?"
 *
 * A curated map, deliberately, rather than a screen. The useful answer to that
 * question is structural — same index vs different index, broader vs purer,
 * built for trading vs built for holding — and structure is stable knowledge
 * that does not need a network call. Screening for it at request time would
 * mean fetching several funds' profiles to say something the relationship
 * between the products already determines.
 *
 * The rule every entry here follows: NO numbers. Expense ratios, AUM and
 * returns all move, and a hardcoded one would be wrong within a quarter and
 * indistinguishable from a live figure on screen. What is asserted is only what
 * is true by construction — which index a fund tracks, what it includes and
 * excludes. The UI pairs each suggestion with a Compare link so the current
 * numbers come from the live data path, where they belong.
 *
 * Unmapped symbols fall back to their Morningstar category, which is the same
 * question asked one level up: "what else does this job?".
 */

export interface FundAlternative {
  symbol: string;
  name: string;
  /** What you gain or give up by choosing it instead — structural, never numeric. */
  tradeoff: string;
}

/** Symbol → alternatives, for funds where the vehicle question has a real answer. */
const BY_SYMBOL: Record<string, FundAlternative[]> = {
  QQQM: [
    { symbol: "QQQ",  name: "Invesco QQQ Trust",                 tradeoff: "The same Nasdaq-100 index in an older, far more heavily traded wrapper. QQQ is the better instrument to trade; QQQM is the share class built for holding." },
    { symbol: "SCHG", name: "Schwab U.S. Large-Cap Growth ETF",  tradeoff: "Broad US large-cap growth rather than the Nasdaq-100 — it is not restricted to companies that happen to list on one exchange, so it picks up growth names QQQM structurally cannot own." },
    { symbol: "VGT",  name: "Vanguard Information Technology ETF", tradeoff: "A pure technology-sector fund. QQQM's technology weight is a by-product of the index; VGT's is the mandate — and it drops the consumer and communications names that make up the rest of the Nasdaq-100." },
    { symbol: "VOO",  name: "Vanguard S&P 500 ETF",              tradeoff: "The diversified alternative: the same mega-caps at much lower weights, plus the financials, healthcare and industrials the Nasdaq-100 largely omits." },
  ],
  QQQ: [
    { symbol: "QQQM", name: "Invesco NASDAQ 100 ETF",            tradeoff: "Identical index, lower-cost share class. For a long-term hold the cost difference compounds; for active trading QQQ's liquidity is worth more." },
    { symbol: "SCHG", name: "Schwab U.S. Large-Cap Growth ETF",  tradeoff: "Broad US large-cap growth, not tied to one listing venue." },
    { symbol: "VOO",  name: "Vanguard S&P 500 ETF",              tradeoff: "Broad-market exposure instead of a growth-and-tech tilt." },
  ],
  SPY: [
    { symbol: "VOO",  name: "Vanguard S&P 500 ETF",              tradeoff: "The same index in a cheaper fund structure — SPY is a unit investment trust, which cannot reinvest dividends between distributions. VOO is the buy-and-hold choice; SPY's options market and liquidity are the reason to prefer it." },
    { symbol: "SPLG", name: "SPDR Portfolio S&P 500 ETF",        tradeoff: "SPDR's own low-cost S&P 500 fund — same index, built for holding rather than trading." },
    { symbol: "VTI",  name: "Vanguard Total Stock Market ETF",   tradeoff: "Extends past the S&P 500 into US mid- and small-caps, so it owns the whole market rather than its large-cap segment." },
  ],
  VOO: [
    { symbol: "IVV",  name: "iShares Core S&P 500 ETF",          tradeoff: "The same index from a different issuer — a genuine coin-flip; pick on cost and on which brokerage you hold." },
    { symbol: "SPY",  name: "SPDR S&P 500 ETF Trust",            tradeoff: "The same index with the deepest liquidity and options market, at a higher cost of ownership." },
    { symbol: "VTI",  name: "Vanguard Total Stock Market ETF",   tradeoff: "Adds US mid- and small-caps on top of the same large-cap core." },
  ],
  IVV: [
    { symbol: "VOO",  name: "Vanguard S&P 500 ETF",              tradeoff: "Same index, different issuer — decide on cost and platform, not exposure." },
    { symbol: "VTI",  name: "Vanguard Total Stock Market ETF",   tradeoff: "The whole US market rather than its large-cap segment." },
  ],
  VTI: [
    { symbol: "ITOT", name: "iShares Core S&P Total U.S. Stock Market ETF", tradeoff: "The same total-market job from a different issuer and index provider." },
    { symbol: "VOO",  name: "Vanguard S&P 500 ETF",              tradeoff: "Large-cap only. In practice it tracks VTI closely, because the mid- and small-caps VTI adds are a small share of its weight." },
  ],
  VGT: [
    { symbol: "XLK",  name: "Technology Select Sector SPDR",     tradeoff: "Technology within the S&P 500 only — a mega-cap-heavier, more concentrated version of the same sector, without VGT's mid- and small-cap tail." },
    { symbol: "SMH",  name: "VanEck Semiconductor ETF",          tradeoff: "Narrows the bet to semiconductors, the most cyclical part of the sector." },
    { symbol: "QQQM", name: "Invesco NASDAQ 100 ETF",            tradeoff: "Technology-heavy but not technology-only — it dilutes the sector bet with the Nasdaq's consumer and communications names." },
  ],
  XLK: [
    { symbol: "VGT",  name: "Vanguard Information Technology ETF", tradeoff: "Broader technology: it reaches past the S&P 500 into mid- and small-cap tech, so it is less concentrated in the sector's giants." },
    { symbol: "SMH",  name: "VanEck Semiconductor ETF",          tradeoff: "Semiconductors only — higher beta to the same cycle." },
  ],
  SMH: [
    { symbol: "SOXX", name: "iShares Semiconductor ETF",         tradeoff: "The same industry through a different index, with different single-name caps — the two diverge mostly on how much of the top few names they allow." },
    { symbol: "VGT",  name: "Vanguard Information Technology ETF", tradeoff: "Steps back out to the whole technology sector, diluting semiconductor cyclicality with software and hardware." },
  ],
  SCHD: [
    { symbol: "VYM",  name: "Vanguard High Dividend Yield ETF",  tradeoff: "Screens on yield alone across a much wider list, where SCHD adds quality and dividend-consistency screens — VYM is broader, SCHD is more selective." },
    { symbol: "DGRO", name: "iShares Core Dividend Growth ETF",  tradeoff: "Targets dividend GROWTH rather than current yield — a lower starting income for a faster-rising one." },
    { symbol: "VIG",  name: "Vanguard Dividend Appreciation ETF", tradeoff: "The longest-record dividend-growers, which tilts it toward quality large-caps and away from the higher-yielding value names." },
  ],
  VYM: [
    { symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF",   tradeoff: "Adds quality and consistency screens on top of yield, producing a much more concentrated list." },
    { symbol: "VIG",  name: "Vanguard Dividend Appreciation ETF", tradeoff: "Dividend growth instead of dividend level." },
  ],
  VIG: [
    { symbol: "DGRO", name: "iShares Core Dividend Growth ETF",  tradeoff: "The same dividend-growth idea with a shorter required history, so it holds companies VIG's screen excludes." },
    { symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF",   tradeoff: "Higher current yield, quality-screened, more concentrated." },
  ],
  BND: [
    { symbol: "AGG",  name: "iShares Core U.S. Aggregate Bond ETF", tradeoff: "The same US investment-grade aggregate exposure from a different issuer — close to interchangeable." },
    { symbol: "VGIT", name: "Vanguard Intermediate-Term Treasury ETF", tradeoff: "Strips out corporate and mortgage credit, leaving pure interest-rate exposure. The better diversifier against equity risk; the lower yield." },
    { symbol: "BNDX", name: "Vanguard Total International Bond ETF", tradeoff: "Moves the rate exposure outside the US, currency-hedged." },
  ],
  AGG: [
    { symbol: "BND",  name: "Vanguard Total Bond Market ETF",    tradeoff: "The same aggregate exposure from a different issuer." },
    { symbol: "VGIT", name: "Vanguard Intermediate-Term Treasury ETF", tradeoff: "Rate risk without credit risk." },
  ],
  VXUS: [
    { symbol: "IXUS", name: "iShares Core MSCI Total International Stock ETF", tradeoff: "The same all-world ex-US job through MSCI rather than FTSE indices — the main divergence is their treatment of South Korea." },
    { symbol: "VEA",  name: "Vanguard FTSE Developed Markets ETF", tradeoff: "Developed markets only. Pair it with an emerging-markets fund if you want to control that weight yourself rather than accept the index's." },
    { symbol: "VWO",  name: "Vanguard FTSE Emerging Markets ETF", tradeoff: "The emerging half on its own — much higher dispersion and a large China weight." },
  ],
  VEA: [
    { symbol: "IEFA", name: "iShares Core MSCI EAFE ETF",        tradeoff: "The same developed ex-US exposure on MSCI indices; VEA includes Canada and South Korea where IEFA does not." },
    { symbol: "VXUS", name: "Vanguard Total International Stock ETF", tradeoff: "Adds emerging markets, making it a single-fund answer to non-US equity." },
  ],
  VWO: [
    { symbol: "IEMG", name: "iShares Core MSCI Emerging Markets ETF", tradeoff: "MSCI's emerging list, which includes South Korea — a meaningful difference in country and sector mix." },
    { symbol: "VXUS", name: "Vanguard Total International Stock ETF", tradeoff: "Wraps emerging and developed into one holding." },
  ],
  IWM: [
    { symbol: "IJR",  name: "iShares Core S&P Small-Cap ETF",    tradeoff: "The S&P small-cap index applies a profitability screen the Russell 2000 does not, which historically changes the character of the exposure more than the size band does." },
    { symbol: "VB",   name: "Vanguard Small-Cap ETF",            tradeoff: "A broader, cheaper small-cap definition that reaches further up into mid-caps." },
  ],
  GLD: [
    { symbol: "IAU",  name: "iShares Gold Trust",                tradeoff: "The same physical bullion exposure in a lower-cost trust — for a long-term hold the cost difference is the whole decision." },
    { symbol: "GLDM", name: "SPDR Gold MiniShares",              tradeoff: "SPDR's own cheaper gold trust, aimed at holders rather than traders." },
  ],
  VNQ: [
    { symbol: "SCHH", name: "Schwab U.S. REIT ETF",              tradeoff: "US REITs with a tighter definition — VNQ's index includes specialised property companies SCHH's excludes." },
    { symbol: "XLRE", name: "Real Estate Select Sector SPDR",    tradeoff: "Real estate inside the S&P 500 only: fewer names, larger companies." },
  ],
};

/** Morningstar category → the funds that do that job, for unmapped symbols. */
const BY_CATEGORY: [RegExp, string[]][] = [
  [/large growth/i,              ["VUG", "SCHG", "QQQM"]],
  [/large blend/i,               ["VOO", "VTI", "SPLG"]],
  [/large value/i,               ["VTV", "SCHD", "VYM"]],
  [/mid-cap/i,                   ["VO", "IJH"]],
  [/small/i,                     ["IJR", "VB", "IWM"]],
  [/technology/i,                ["VGT", "XLK", "SMH"]],
  [/health/i,                    ["XLV", "VHT"]],
  [/financial/i,                 ["XLF", "VFH"]],
  [/energy/i,                    ["XLE", "VDE"]],
  [/utilit/i,                    ["XLU", "VPU"]],
  [/real estate/i,               ["VNQ", "SCHH"]],
  [/foreign large/i,             ["VXUS", "IEFA", "VEA"]],
  [/emerging/i,                  ["VWO", "IEMG"]],
  [/world|global/i,              ["VT", "ACWI"]],
  [/(intermediate|core).*bond/i, ["BND", "AGG"]],
  [/treasury|government/i,       ["VGIT", "GOVT"]],
  [/high yield bond/i,           ["HYG", "JNK"]],
  [/commodit/i,                  ["PDBC", "DBC"]],
];

const FALLBACK_TRADEOFF =
  "Fills the same slot in a portfolio from a different index provider — the differences are in construction rules and cost, which is what the side-by-side comparison is for.";

/** Display names for fallback suggestions, so a row is never a bare ticker. */
const NAMES: Record<string, string> = {
  VUG: "Vanguard Growth ETF",
  SCHG: "Schwab U.S. Large-Cap Growth ETF",
  QQQM: "Invesco NASDAQ 100 ETF",
  VOO: "Vanguard S&P 500 ETF",
  VTI: "Vanguard Total Stock Market ETF",
  SPLG: "SPDR Portfolio S&P 500 ETF",
  VTV: "Vanguard Value ETF",
  SCHD: "Schwab U.S. Dividend Equity ETF",
  VYM: "Vanguard High Dividend Yield ETF",
  VO: "Vanguard Mid-Cap ETF",
  IJH: "iShares Core S&P Mid-Cap ETF",
  IJR: "iShares Core S&P Small-Cap ETF",
  VB: "Vanguard Small-Cap ETF",
  IWM: "iShares Russell 2000 ETF",
  VGT: "Vanguard Information Technology ETF",
  XLK: "Technology Select Sector SPDR",
  SMH: "VanEck Semiconductor ETF",
  XLV: "Health Care Select Sector SPDR",
  VHT: "Vanguard Health Care ETF",
  XLF: "Financial Select Sector SPDR",
  VFH: "Vanguard Financials ETF",
  XLE: "Energy Select Sector SPDR",
  VDE: "Vanguard Energy ETF",
  XLU: "Utilities Select Sector SPDR",
  VPU: "Vanguard Utilities ETF",
  VNQ: "Vanguard Real Estate ETF",
  SCHH: "Schwab U.S. REIT ETF",
  VXUS: "Vanguard Total International Stock ETF",
  IEFA: "iShares Core MSCI EAFE ETF",
  VEA: "Vanguard FTSE Developed Markets ETF",
  VWO: "Vanguard FTSE Emerging Markets ETF",
  IEMG: "iShares Core MSCI Emerging Markets ETF",
  VT: "Vanguard Total World Stock ETF",
  ACWI: "iShares MSCI ACWI ETF",
  BND: "Vanguard Total Bond Market ETF",
  AGG: "iShares Core U.S. Aggregate Bond ETF",
  VGIT: "Vanguard Intermediate-Term Treasury ETF",
  GOVT: "iShares U.S. Treasury Bond ETF",
  HYG: "iShares iBoxx High Yield Corporate Bond ETF",
  JNK: "SPDR Bloomberg High Yield Bond ETF",
  PDBC: "Invesco Optimum Yield Diversified Commodity",
  DBC: "Invesco DB Commodity Index Tracking Fund",
};

export interface AlternativesResult {
  alternatives: FundAlternative[];
  /** "curated" carries real per-pair reasoning; "category" is the weaker fallback. */
  basis: "curated" | "category" | null;
}

export function findAlternatives(symbol: string, category: string | null): AlternativesResult {
  const key = symbol.trim().toUpperCase();

  const curated = BY_SYMBOL[key];
  if (curated) return { alternatives: curated, basis: "curated" };

  if (category) {
    const match = BY_CATEGORY.find(([re]) => re.test(category));
    if (match) {
      const alternatives = match[1]
        .filter((s) => s !== key)
        .map((s) => ({ symbol: s, name: NAMES[s] ?? s, tradeoff: FALLBACK_TRADEOFF }));
      if (alternatives.length > 0) return { alternatives, basis: "category" };
    }
  }

  return { alternatives: [], basis: null };
}
