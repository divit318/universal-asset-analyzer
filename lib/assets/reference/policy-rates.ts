/**
 * Central bank policy rates, inflation, and stance — and the currency pair
 * universe built on top of them.
 *
 * ⚠️  READ THIS BEFORE TRUSTING A CARRY NUMBER.
 *
 * This is a SHIPPED STATIC TABLE, not a live feed. UAA has no rates provider
 * wired (no FRED, no BIS, no central-bank scraper), and Yahoo's CURRENCY
 * screener returns zero rows, so there is nothing to pull these from at
 * runtime. Everything derived from this table — interest rate differential,
 * carry, real rate differential, central bank stance — is therefore marked
 * `reference` in the Asset Registry and rendered with an "as of" badge in the
 * UI, so a stale rate can never masquerade as a live one.
 *
 * Rates move roughly eight times a year per bank. THESE VALUES WILL GO STALE.
 * Update `POLICY_RATES` and bump `POLICY_RATES_AS_OF` whenever a central bank
 * moves; that is the single edit required, and every carry/differential figure
 * in the screener follows from it.
 *
 * The honest alternative — declaring carry `unavailable` outright — was
 * rejected because interest rate differential *is* the thing that makes forex
 * screening worth doing, and a clearly-dated, user-editable table that the
 * user can correct in ten seconds is more useful than an empty column. But it
 * is a table someone has to maintain, and it is not market data.
 */

/** Bump this whenever POLICY_RATES below is edited. Surfaced in the UI. */
export const POLICY_RATES_AS_OF = "2026-01";

export type PolicyStance = "Hiking" | "Holding" | "Cutting";

export interface CurrencyRef {
  code: string;
  name: string;
  /** Central bank policy rate, %. */
  policyRate: number;
  /** Headline CPI, % year-over-year. */
  inflation: number;
  /** The bank's current direction of travel. */
  stance: PolicyStance;
  centralBank: string;
}

export const CURRENCIES: Record<string, CurrencyRef> = {
  USD: { code: "USD", name: "US Dollar", policyRate: 3.875, inflation: 2.8, stance: "Holding", centralBank: "Federal Reserve" },
  EUR: { code: "EUR", name: "Euro", policyRate: 2.0, inflation: 2.1, stance: "Holding", centralBank: "ECB" },
  JPY: { code: "JPY", name: "Japanese Yen", policyRate: 0.5, inflation: 2.7, stance: "Hiking", centralBank: "Bank of Japan" },
  GBP: { code: "GBP", name: "British Pound", policyRate: 4.0, inflation: 3.2, stance: "Cutting", centralBank: "Bank of England" },
  CHF: { code: "CHF", name: "Swiss Franc", policyRate: 0.0, inflation: 0.3, stance: "Holding", centralBank: "SNB" },
  AUD: { code: "AUD", name: "Australian Dollar", policyRate: 3.6, inflation: 3.0, stance: "Holding", centralBank: "RBA" },
  NZD: { code: "NZD", name: "New Zealand Dollar", policyRate: 2.25, inflation: 2.4, stance: "Holding", centralBank: "RBNZ" },
  CAD: { code: "CAD", name: "Canadian Dollar", policyRate: 2.25, inflation: 2.2, stance: "Holding", centralBank: "Bank of Canada" },
  SEK: { code: "SEK", name: "Swedish Krona", policyRate: 1.75, inflation: 1.9, stance: "Holding", centralBank: "Riksbank" },
  NOK: { code: "NOK", name: "Norwegian Krone", policyRate: 4.0, inflation: 3.0, stance: "Cutting", centralBank: "Norges Bank" },
  MXN: { code: "MXN", name: "Mexican Peso", policyRate: 7.25, inflation: 3.8, stance: "Cutting", centralBank: "Banxico" },
  BRL: { code: "BRL", name: "Brazilian Real", policyRate: 12.25, inflation: 4.5, stance: "Cutting", centralBank: "BCB" },
  ZAR: { code: "ZAR", name: "South African Rand", policyRate: 7.0, inflation: 3.6, stance: "Holding", centralBank: "SARB" },
  INR: { code: "INR", name: "Indian Rupee", policyRate: 5.5, inflation: 4.2, stance: "Holding", centralBank: "RBI" },
  TRY: { code: "TRY", name: "Turkish Lira", policyRate: 39.5, inflation: 32.0, stance: "Cutting", centralBank: "CBRT" },
  CNY: { code: "CNY", name: "Chinese Yuan", policyRate: 3.0, inflation: 0.6, stance: "Cutting", centralBank: "PBoC" },
  SGD: { code: "SGD", name: "Singapore Dollar", policyRate: 2.5, inflation: 1.4, stance: "Holding", centralBank: "MAS" },
  KRW: { code: "KRW", name: "South Korean Won", policyRate: 2.5, inflation: 2.0, stance: "Holding", centralBank: "Bank of Korea" },
};

export const PAIR_TYPES = ["Major", "Minor", "Exotic"] as const;
export type PairType = (typeof PAIR_TYPES)[number];

export interface PairRef {
  /** Yahoo symbol, e.g. EURUSD=X. */
  symbol: string;
  base: string;
  quote: string;
  type: PairType;
  /**
   * Liquidity tier, 1 (deepest) to 3. Yahoo reports zero volume on FX, so this
   * stands in for the spread/depth data we cannot see. It follows directly
   * from the pair's classification: majors are the deepest, exotics the
   * thinnest, and that ordering is stable enough to ship.
   */
  liquidityTier: 1 | 2 | 3;
}

const majors: [string, string][] = [
  ["EUR", "USD"],
  ["USD", "JPY"],
  ["GBP", "USD"],
  ["USD", "CHF"],
  ["AUD", "USD"],
  ["USD", "CAD"],
  ["NZD", "USD"],
];

const minors: [string, string][] = [
  ["EUR", "GBP"],
  ["EUR", "JPY"],
  ["EUR", "CHF"],
  ["EUR", "AUD"],
  ["EUR", "CAD"],
  ["GBP", "JPY"],
  ["GBP", "CHF"],
  ["GBP", "AUD"],
  ["GBP", "CAD"],
  ["AUD", "JPY"],
  ["AUD", "NZD"],
  ["AUD", "CAD"],
  ["CAD", "JPY"],
  ["CHF", "JPY"],
  ["NZD", "JPY"],
  ["EUR", "SEK"],
  ["EUR", "NOK"],
  ["USD", "SEK"],
  ["USD", "NOK"],
  ["USD", "SGD"],
];

const exotics: [string, string][] = [
  ["USD", "MXN"],
  ["USD", "BRL"],
  ["USD", "ZAR"],
  ["USD", "INR"],
  ["USD", "TRY"],
  ["USD", "CNY"],
  ["USD", "KRW"],
  ["EUR", "TRY"],
  ["EUR", "INR"],
];

function build(pairs: [string, string][], type: PairType, tier: 1 | 2 | 3): PairRef[] {
  return pairs.map(([base, quote]) => ({
    symbol: `${base}${quote}=X`,
    base,
    quote,
    type,
    liquidityTier: tier,
  }));
}

/** The screenable forex universe: 36 pairs. Yahoo's CURRENCY screener returns zero rows, so this list *is* the universe. */
export const FX_PAIRS: PairRef[] = [
  ...build(majors, "Major", 1),
  ...build(minors, "Minor", 2),
  ...build(exotics, "Exotic", 3),
];

export function getPair(symbol: string): PairRef | null {
  return FX_PAIRS.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}

/**
 * Carry for holding one unit of the pair long: you earn the base currency's
 * rate and pay the quote currency's. Long EURUSD with EUR at 2% and USD at
 * 3.875% is a *negative* carry of −1.875%.
 */
export function rateDifferential(pair: PairRef): number | null {
  const b = CURRENCIES[pair.base];
  const q = CURRENCIES[pair.quote];
  if (!b || !q) return null;
  return b.policyRate - q.policyRate;
}

/** Real (inflation-adjusted) rate differential — the version that actually predicts FX over long horizons. */
export function realRateDifferential(pair: PairRef): number | null {
  const b = CURRENCIES[pair.base];
  const q = CURRENCIES[pair.quote];
  if (!b || !q) return null;
  return b.policyRate - b.inflation - (q.policyRate - q.inflation);
}

export function inflationDifferential(pair: PairRef): number | null {
  const b = CURRENCIES[pair.base];
  const q = CURRENCIES[pair.quote];
  if (!b || !q) return null;
  return b.inflation - q.inflation;
}

/**
 * Policy divergence: base bank tightening while quote bank eases is the
 * strongest fundamental tailwind a pair can have. +1 per notch of divergence.
 */
export function policyDivergence(pair: PairRef): number | null {
  const score: Record<PolicyStance, number> = { Hiking: 1, Holding: 0, Cutting: -1 };
  const b = CURRENCIES[pair.base];
  const q = CURRENCIES[pair.quote];
  if (!b || !q) return null;
  return score[b.stance] - score[q.stance];
}
