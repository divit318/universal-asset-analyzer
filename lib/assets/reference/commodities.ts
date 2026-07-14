/**
 * The commodity universe.
 *
 * Deliberately a curated list rather than Yahoo's FUTURE screener. That
 * endpoint does return ~1,500 rows, but they are individual dated contracts —
 * including TAS (trade-at-settlement) and micro/mini variants — so screening
 * it directly yields things like "Gold TAS Futures, Oct-2026" ranked by a
 * percent change computed off a near-zero base. The investable commodity
 * universe is genuinely small (a few dozen liquid contracts), so enumerating
 * the front-month continuous contracts is both more correct and far cheaper.
 *
 * `root` is what makes the futures curve real: Yahoo quotes dated contracts as
 * ROOT + MONTHCODE + YY + . + EXCHANGE (crude for Aug 2026 is CLQ26.NYM), so
 * from the root we can fetch the next N expiries and measure the actual slope
 * of the curve — contango vs backwardation — rather than guessing at it.
 * See lib/screener/universes/commodity.ts.
 */

export const COMMODITY_SECTORS = [
  "Energy",
  "Precious Metals",
  "Industrial Metals",
  "Agriculture",
  "Livestock",
  "Softs",
] as const;

export type CommoditySector = (typeof COMMODITY_SECTORS)[number];

/** Structural supply-concentration risk. A stable property of where the stuff comes from, not a market view. */
export type GeopoliticalExposure = "Low" | "Medium" | "High";

export interface CommodityRef {
  /** Yahoo continuous front-month symbol. */
  symbol: string;
  name: string;
  sector: CommoditySector;
  /** Contract root + exchange suffix for building dated symbols, e.g. "CL" + "NYM" → CLQ26.NYM. */
  root: string;
  exchange: string;
  /** Whether the contract's supply is concentrated in geopolitically fragile regions. */
  geopolitical: GeopoliticalExposure;
  /** Why that exposure rating — shown in the UI so the label isn't an unexplained assertion. */
  geopoliticalNote: string;
}

/** Last review of the sector tags and geopolitical notes below. */
export const COMMODITIES_AS_OF = "2026-01";

export const COMMODITIES: CommodityRef[] = [
  // Energy
  { symbol: "CL=F", name: "Crude Oil (WTI)", sector: "Energy", root: "CL", exchange: "NYM", geopolitical: "High", geopoliticalNote: "OPEC+ supply policy and Middle East transit routes" },
  { symbol: "BZ=F", name: "Brent Crude", sector: "Energy", root: "BZ", exchange: "NYM", geopolitical: "High", geopoliticalNote: "Global seaborne benchmark; exposed to OPEC+ and shipping chokepoints" },
  { symbol: "NG=F", name: "Natural Gas", sector: "Energy", root: "NG", exchange: "NYM", geopolitical: "Medium", geopoliticalNote: "US benchmark is largely domestic; LNG exports link it to European demand shocks" },
  { symbol: "RB=F", name: "RBOB Gasoline", sector: "Energy", root: "RB", exchange: "NYM", geopolitical: "Medium", geopoliticalNote: "Refining capacity is concentrated and outage-prone" },
  { symbol: "HO=F", name: "Heating Oil", sector: "Energy", root: "HO", exchange: "NYM", geopolitical: "Medium", geopoliticalNote: "Distillate stocks run tight; diesel is the crisis fuel" },

  // Precious metals
  { symbol: "GC=F", name: "Gold", sector: "Precious Metals", root: "GC", exchange: "CMX", geopolitical: "Low", geopoliticalNote: "Mine supply is diversified; gold is usually the hedge, not the hostage" },
  { symbol: "SI=F", name: "Silver", sector: "Precious Metals", root: "SI", exchange: "CMX", geopolitical: "Low", geopoliticalNote: "Diversified supply, much of it a by-product of base-metal mining" },
  { symbol: "PL=F", name: "Platinum", sector: "Precious Metals", root: "PL", exchange: "NYM", geopolitical: "High", geopoliticalNote: "Roughly three-quarters of supply comes from South Africa, with chronic power constraints" },
  { symbol: "PA=F", name: "Palladium", sector: "Precious Metals", root: "PA", exchange: "NYM", geopolitical: "High", geopoliticalNote: "Supply is dominated by Russia and South Africa" },

  // Industrial metals
  { symbol: "HG=F", name: "Copper", sector: "Industrial Metals", root: "HG", exchange: "CMX", geopolitical: "Medium", geopoliticalNote: "Chile and Peru dominate mine supply; permitting and strikes drive shocks" },
  { symbol: "ALI=F", name: "Aluminium", sector: "Industrial Metals", root: "ALI", exchange: "CMX", geopolitical: "Medium", geopoliticalNote: "Smelting is energy-intensive; Chinese and Russian supply carry policy and sanction risk" },

  // Agriculture (grains & oilseeds)
  { symbol: "ZC=F", name: "Corn", sector: "Agriculture", root: "ZC", exchange: "CBT", geopolitical: "Medium", geopoliticalNote: "US and Black Sea supply; ethanol policy is a demand swing factor" },
  { symbol: "ZW=F", name: "Wheat (SRW)", sector: "Agriculture", root: "ZW", exchange: "CBT", geopolitical: "High", geopoliticalNote: "Black Sea exports are a large share of global trade and are war-exposed" },
  { symbol: "ZS=F", name: "Soybeans", sector: "Agriculture", root: "ZS", exchange: "CBT", geopolitical: "Medium", geopoliticalNote: "US/Brazil supply; Chinese demand and tariff policy dominate the flow" },
  { symbol: "ZL=F", name: "Soybean Oil", sector: "Agriculture", root: "ZL", exchange: "CBT", geopolitical: "Medium", geopoliticalNote: "Linked to biofuel mandates and palm-oil substitution" },
  { symbol: "ZM=F", name: "Soybean Meal", sector: "Agriculture", root: "ZM", exchange: "CBT", geopolitical: "Medium", geopoliticalNote: "Animal-feed demand; tracks the soybean crush" },
  { symbol: "ZO=F", name: "Oats", sector: "Agriculture", root: "ZO", exchange: "CBT", geopolitical: "Low", geopoliticalNote: "Mostly North American supply, thin but stable" },
  { symbol: "ZR=F", name: "Rough Rice", sector: "Agriculture", root: "ZR", exchange: "CBT", geopolitical: "Medium", geopoliticalNote: "Asian export bans (notably India) can move the market hard" },

  // Livestock
  { symbol: "LE=F", name: "Live Cattle", sector: "Livestock", root: "LE", exchange: "CME", geopolitical: "Low", geopoliticalNote: "Domestic US herd cycle; disease is the main tail risk" },
  { symbol: "GF=F", name: "Feeder Cattle", sector: "Livestock", root: "GF", exchange: "CME", geopolitical: "Low", geopoliticalNote: "Follows the cattle cycle and feed costs" },
  { symbol: "HE=F", name: "Lean Hogs", sector: "Livestock", root: "HE", exchange: "CME", geopolitical: "Low", geopoliticalNote: "Domestic supply; export demand to China is the swing factor" },

  // Softs
  { symbol: "KC=F", name: "Coffee", sector: "Softs", root: "KC", exchange: "NYB", geopolitical: "High", geopoliticalNote: "Brazil and Vietnam dominate; frost and drought cause step-changes in price" },
  { symbol: "SB=F", name: "Sugar", sector: "Softs", root: "SB", exchange: "NYB", geopolitical: "Medium", geopoliticalNote: "Brazil and India; ethanol economics and export policy drive supply" },
  { symbol: "CC=F", name: "Cocoa", sector: "Softs", root: "CC", exchange: "NYB", geopolitical: "High", geopoliticalNote: "Côte d'Ivoire and Ghana supply the large majority; disease and weather are acute" },
  { symbol: "CT=F", name: "Cotton", sector: "Softs", root: "CT", exchange: "NYB", geopolitical: "Medium", geopoliticalNote: "US, Brazil, India, China; trade policy and forced-labour sanctions bite" },
  { symbol: "OJ=F", name: "Orange Juice", sector: "Softs", root: "OJ", exchange: "NYB", geopolitical: "Medium", geopoliticalNote: "Florida and Brazil; hurricanes and citrus greening drive shortages" },
  { symbol: "LBS=F", name: "Lumber", sector: "Softs", root: "LBS", exchange: "CME", geopolitical: "Low", geopoliticalNote: "North American supply; tracks US housing starts" },
];

/** Month codes used in dated futures symbols (F=Jan … Z=Dec). */
export const FUTURES_MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"] as const;

export function getCommodity(symbol: string): CommodityRef | null {
  return COMMODITIES.find((c) => c.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}
