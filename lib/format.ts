/** Pure number/currency formatting helpers shared across the UI. */

/** Text color for a signed value: green above zero, red below, muted at zero or unknown. */
export function toneClass(value: number | null): string {
  if (value == null) return "text-muted";
  return value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-muted";
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(
  value: number | null | undefined,
  currency = "USD",
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Signed percentage, e.g. +1.23% / -0.45%. Input is already in percent units. */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** Compact large numbers: 1.2K, 3.4M, 5.6B, 7.8T. */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
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
  if (value == null || Number.isNaN(value)) return "—";
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

/** Display symbol for an ISO 4217 code, falling back to the code itself. */
export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency ?? "USD").toUpperCase();
  return CURRENCY_SYMBOLS[currency ?? ""] ?? CURRENCY_SYMBOLS[code] ?? `${code} `;
}

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
  currency: string | null | undefined = "USD",
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const code = (currency ?? "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency ?? ""] ?? CURRENCY_SYMBOLS[code];
  const sign = value < 0 ? "-" : "";
  const amount = formatCompact(Math.abs(value));
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${code} ${amount}`;
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
  if (value == null || Number.isNaN(value)) return "—";
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
