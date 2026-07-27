import type { AssetClassId } from "@/lib/assets/types";

/**
 * Quick-start content for the Compare landing state — one curated set per
 * asset class, each entry a real, well-known instrument set (capped at 5,
 * the page's own MAX) rather than a placeholder. Pure data so the landing
 * component stays a renderer, not a copywriter.
 */

export interface QuickStartItem {
  label: string;
  symbols: string[];
}

export interface QuickStartGroup {
  title: string;
  items: QuickStartItem[];
}

export interface ClassLandingContent {
  /** One line under the asset-class tabs, contextual to the selected class. */
  subtitle: string;
  groups: QuickStartGroup[];
}

export const LANDING_CONTENT: Record<AssetClassId, ClassLandingContent> = {
  equity: {
    subtitle: "Popular company comparisons and investing themes.",
    groups: [
      {
        title: "Popular",
        items: [
          { label: "Magnificent 7", symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"] },
          { label: "AI Leaders", symbols: ["NVDA", "MSFT", "GOOGL", "AVGO", "AMD"] },
          { label: "Indian Banking", symbols: ["HDFCBANK.NS", "ICICIBANK.NS", "KOTAKBANK.NS", "AXISBANK.NS", "SBIN.NS"] },
          { label: "Semiconductor Giants", symbols: ["NVDA", "TSM", "AVGO", "ASML", "AMD"] },
        ],
      },
      {
        title: "Strategies",
        items: [
          { label: "Dividend Kings", symbols: ["KO", "JNJ", "PG", "MMM", "CL"] },
          { label: "Growth", symbols: ["NVDA", "CRM", "NOW", "SHOP", "NFLX"] },
          { label: "Value", symbols: ["JPM", "XOM", "CVX", "BRK-B", "WFC"] },
          { label: "Small Caps", symbols: ["SOFI", "CAVA", "ONON", "RIOT", "CROX"] },
        ],
      },
      {
        title: "Markets",
        items: [
          { label: "US Blue Chips", symbols: ["AAPL", "MSFT", "JPM", "JNJ", "PG"] },
          { label: "Nifty 50", symbols: ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS"] },
          { label: "FTSE 100", symbols: ["SHEL.L", "AZN.L", "HSBA.L", "ULVR.L", "BP.L"] },
          { label: "Nikkei 225", symbols: ["7203.T", "6758.T", "9984.T", "8306.T", "6501.T"] },
        ],
      },
    ],
  },

  etf: {
    subtitle: "Compare funds by strategy, sector and cost.",
    groups: [
      {
        title: "Popular",
        items: [
          { label: "S&P 500", symbols: ["SPY", "VOO", "IVV", "SPLG"] },
          { label: "Nasdaq 100", symbols: ["QQQ", "QQQM", "ONEQ", "QQQE"] },
          { label: "Dividend ETFs", symbols: ["SCHD", "VYM", "DVY", "HDV"] },
          { label: "Total Market", symbols: ["VTI", "ITOT", "SPTM", "SCHB"] },
        ],
      },
      {
        title: "Themes",
        items: [
          { label: "AI & Robotics", symbols: ["BOTZ", "ROBO", "ARKQ", "IRBO"] },
          { label: "Cybersecurity", symbols: ["CIBR", "HACK", "BUG", "IHAK"] },
          { label: "Clean Energy", symbols: ["ICLN", "TAN", "PBW", "QCLN"] },
          { label: "Healthcare", symbols: ["XLV", "VHT", "IBB", "IYH"] },
        ],
      },
      {
        title: "Strategies",
        items: [
          { label: "Growth", symbols: ["VUG", "IVW", "SCHG", "MGK"] },
          { label: "Value", symbols: ["VTV", "IVE", "SCHV", "VLUE"] },
          { label: "Income", symbols: ["SCHD", "JEPI", "DVY", "SPYD"] },
          { label: "Low Volatility", symbols: ["USMV", "SPLV", "LGLV", "SPHD"] },
        ],
      },
    ],
  },

  reit: {
    subtitle: "Compare property-type peers and yield profiles.",
    groups: [
      {
        title: "Popular",
        items: [
          { label: "Mega-Cap REITs", symbols: ["PLD", "AMT", "EQIX", "SPG"] },
          { label: "Data Centers", symbols: ["EQIX", "DLR", "AMT", "SBAC"] },
          { label: "Retail & Malls", symbols: ["SPG", "O", "REG", "KIM"] },
          { label: "Residential", symbols: ["AVB", "EQR", "MAA", "ESS"] },
        ],
      },
      {
        title: "Strategies",
        items: [
          { label: "High Yield", symbols: ["O", "VICI", "NNN", "WPC"] },
          { label: "Industrial & Logistics", symbols: ["PLD", "STAG", "FR", "EGP"] },
          { label: "Healthcare", symbols: ["WELL", "VTR", "DOC", "OHI"] },
          { label: "Net Lease", symbols: ["O", "NNN", "WPC", "ADC"] },
        ],
      },
    ],
  },

  crypto: {
    subtitle: "Compare networks, ecosystems and tokenomics.",
    groups: [
      {
        title: "Popular",
        items: [
          { label: "Bitcoin vs Ethereum", symbols: ["BTC-USD", "ETH-USD"] },
          { label: "Top Layer 1s", symbols: ["SOL-USD", "ADA-USD", "AVAX-USD", "DOT-USD"] },
          { label: "DeFi Leaders", symbols: ["UNI-USD", "AAVE-USD", "LINK-USD", "MKR-USD"] },
          { label: "AI Tokens", symbols: ["FET-USD", "RENDER-USD", "TAO-USD", "AGIX-USD"] },
        ],
      },
      {
        title: "Strategies",
        items: [
          { label: "Large Cap", symbols: ["BTC-USD", "ETH-USD", "BNB-USD", "XRP-USD"] },
          { label: "High Growth", symbols: ["SOL-USD", "AVAX-USD", "INJ-USD", "SUI-USD"] },
          { label: "Staking", symbols: ["ETH-USD", "SOL-USD", "ADA-USD", "DOT-USD"] },
          { label: "Stablecoins", symbols: ["USDT-USD", "USDC-USD", "DAI-USD", "PYUSD-USD"] },
        ],
      },
    ],
  },

  commodity: {
    subtitle: "Compare futures curves across sectors and geopolitical exposure.",
    groups: [
      {
        title: "Sectors",
        items: [
          { label: "Energy", symbols: ["CL=F", "BZ=F", "NG=F", "RB=F"] },
          { label: "Precious Metals", symbols: ["GC=F", "SI=F", "PL=F", "PA=F"] },
          { label: "Agriculture", symbols: ["ZC=F", "ZW=F", "ZS=F", "ZL=F"] },
          { label: "Softs", symbols: ["KC=F", "SB=F", "CC=F", "CT=F"] },
        ],
      },
      {
        title: "Signals",
        items: [
          { label: "Curve Watch", symbols: ["CL=F", "NG=F", "GC=F"] },
          { label: "Geopolitical Risk", symbols: ["BZ=F", "KC=F", "CC=F", "ZW=F"] },
          { label: "Industrial Metals", symbols: ["HG=F", "ALI=F"] },
          { label: "Livestock", symbols: ["LE=F", "GF=F", "HE=F"] },
        ],
      },
    ],
  },

  bond: {
    subtitle: "Compare yield, duration and credit quality across fund types.",
    groups: [
      {
        title: "Popular",
        items: [
          { label: "Core Aggregate", symbols: ["AGG", "BND", "SCHZ", "SPAB"] },
          { label: "Treasuries", symbols: ["SHY", "IEF", "TLT", "GOVT"] },
          { label: "Corporate", symbols: ["LQD", "VCIT", "SPIB", "IGSB"] },
          { label: "High Yield", symbols: ["HYG", "JNK", "SHYG", "USHY"] },
        ],
      },
      {
        title: "Strategies",
        items: [
          { label: "Municipal", symbols: ["MUB", "VTEB", "TFI", "SHM"] },
          { label: "TIPS (Inflation)", symbols: ["TIP", "SCHP", "VTIP", "STIP"] },
          { label: "Emerging Markets", symbols: ["EMB", "VWOB", "EMLC", "PCY"] },
          { label: "Short Duration", symbols: ["SHY", "VGSH", "SCHO", "BSV"] },
        ],
      },
    ],
  },

  forex: {
    subtitle: "Compare currency pairs by carry, policy divergence and momentum.",
    groups: [
      {
        title: "Popular",
        items: [
          { label: "Majors", symbols: ["EURUSD=X", "USDJPY=X", "GBPUSD=X", "USDCHF=X"] },
          { label: "Yen Crosses", symbols: ["EURJPY=X", "GBPJPY=X", "AUDJPY=X", "CADJPY=X"] },
          { label: "Commodity Currencies", symbols: ["AUDUSD=X", "USDCAD=X", "NZDUSD=X"] },
          { label: "Cross Pairs", symbols: ["EURGBP=X", "EURCHF=X", "GBPCHF=X", "EURAUD=X"] },
        ],
      },
      {
        title: "Strategies",
        items: [
          { label: "Carry Trade", symbols: ["AUDJPY=X", "NZDJPY=X", "USDMXN=X", "USDZAR=X"] },
          { label: "Emerging Markets", symbols: ["USDINR=X", "USDBRL=X", "USDZAR=X", "USDTRY=X"] },
          { label: "Safe Havens", symbols: ["USDCHF=X", "USDJPY=X", "EURCHF=X"] },
          { label: "Asia Pacific", symbols: ["AUDUSD=X", "NZDUSD=X", "USDSGD=X", "USDCNY=X"] },
        ],
      },
    ],
  },
};
