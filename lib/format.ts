/** Pure number/currency formatting helpers shared across the UI. */

/**
 * Nothing here formats a non-finite number.
 *
 * These guards used to test `Number.isNaN`, which lets ±Infinity through — so a
 * division by a zero denominator reached the screen as the literal string
 * "Infinity%" (the watchlist's old to-target column did exactly this whenever a
 * target of 0 was stored). An unrepresentable number is missing data, and every
 * one of these helpers already has a rendering for missing data.
 */
function isRenderable(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** Text color for a signed value: green above zero, red below, muted at zero or unknown. */
export function toneClass(value: number | null): string {
  if (value == null) return "text-muted";
  return value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-muted";
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (!isRenderable(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(
  value: number | null | undefined,
  currency = "USD",
): string {
  if (!isRenderable(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Currency with an explicit sign on gains, e.g. +$1,234.56 / -$1,234.56.
 *
 * `formatCurrency` renders a loss as "-$1,234.56" but a gain as a bare
 * "$1,234.56", so a P&L column formatted with it relies on colour alone to
 * distinguish the two — which fails for a colour-blind reader, in a printout,
 * and anywhere the value is read aloud. The sign is the information; colour is
 * the reinforcement.
 */
export function formatSignedCurrency(
  value: number | null | undefined,
  currency = "USD",
): string {
  if (!isRenderable(value)) return "—";
  const formatted = formatCurrency(value, currency);
  return value > 0 ? `+${formatted}` : formatted;
}

/** Signed percentage, e.g. +1.23% / -0.45%. Input is already in percent units. */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (!isRenderable(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** Compact large numbers: 1.2K, 3.4M, 5.6B, 7.8T. */
export function formatCompact(value: number | null | undefined): string {
  if (!isRenderable(value)) return "—";
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      return `${(value / threshold).toFixed(2)}${suffix}`;
    }
  }
  return value.toFixed(0);
}

export function formatMarketCap(value: number | null | undefined): string {
  if (!isRenderable(value)) return "—";
  return `$${formatCompact(value)}`;
}

/**
 * Currency symbols for the currencies UAA actually encounters. Anything else
 * falls back to the ISO code, which is unambiguous — an unknown symbol is a
 * worse outcome than a plain "SEK 1.2B".
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  GBp: "£",
  JPY: "¥",
  CNY: "¥",
  KRW: "₩",
  INR: "₹",
  CHF: "CHF ",
  CAD: "C$",
  AUD: "A$",
  HKD: "HK$",
  TWD: "NT$",
  BRL: "R$",
  SGD: "S$",
};

/**
 * Compact currency amount, labelled with the currency it is actually in.
 *
 * Exists because a hardcoded "$" in front of a provider figure is a real
 * correctness bug, not a cosmetic one: Yahoo reports estimates in a company's
 * own financial currency, so SK hynix's ₩84.1T revenue estimate was rendering
 * as "$84.12T" — off by ~1,400x and enough to discredit every other number
 * on the page. Pass the currency that travelled with the number.
 */
export function formatCompactCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!isRenderable(value)) return "—";
  const code = (currency ?? "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency ?? ""] ?? CURRENCY_SYMBOLS[code];
  const amount = formatCompact(value);
  return symbol ? `${symbol}${amount}` : `${code} ${amount}`;
}

/**
 * A per-share figure (EPS) in its reporting currency. Separate from
 * {@link formatCompactCurrency} because per-share values are never compacted —
 * "$1.2K EPS" would be nonsense — but they carry the same currency hazard.
 */
export function formatPerShare(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!isRenderable(value)) return "—";
  const code = (currency ?? "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency ?? ""] ?? CURRENCY_SYMBOLS[code];
  const amount = value.toFixed(2);
  return symbol ? `${symbol}${amount}` : `${code} ${amount}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A quoted instrument's name, with the provider's own redundancy removed.
 *
 * Yahoo names every crypto pair `<asset> <quote currency>`: `BTC-USD` is
 * "Bitcoin USD", `USDC-USD` is "USD Coin USD". The currency is already the
 * second half of the symbol, so repeating it says nothing — and on a token whose
 * *name* ends in USD it reads as a templating bug that isn't one:
 * `USD136148-USD` arrives from Yahoo as the literal string "World Liberty
 * Financial USD USD".
 *
 * So exactly one trailing quote-currency token is dropped, and only when the
 * symbol is a pair quoted in that currency. "World Liberty Financial USD USD"
 * becomes "World Liberty Financial USD" — the token's actual name — rather than
 * being stripped twice down to something it isn't called. The symbol itself is
 * never rewritten: it is the key every quote lookup and deep link uses, and
 * Yahoo's numeric disambiguator (`USD1` + `36148`) cannot be split back out
 * without guessing where the ticker ends.
 *
 * The suffix must be a three-letter currency code, so hyphenated US share
 * classes (`PBR-A`, `SCHW-PD`, `BRK-B`) can never have a letter shaved off the
 * end of a name that legitimately ends in one.
 */
export function displayAssetName(symbol: string | null | undefined, name: string): string {
  const quote = (symbol ?? "").trim().toUpperCase().split("-").at(-1) ?? "";
  if (!/^[A-Z]{3}$/.test(quote) || !symbol?.includes("-")) return name;
  const suffix = ` ${quote}`;
  if (!name.toUpperCase().endsWith(suffix)) return name;
  const stripped = name.slice(0, -suffix.length).trim();
  return stripped === "" ? name : stripped;
}
