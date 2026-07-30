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

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", INR: "₹", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", KRW: "₩",
  HKD: "HK$", AUD: "A$", CAD: "C$", SGD: "S$", BRL: "R$", CHF: "CHF ",
};

/** Display symbol for an ISO 4217 code, falling back to the code itself. */
export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency ?? "USD").toUpperCase();
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

/** Compact large amounts with the right currency mark: -$1.23B, ₹4.50T. */
export function formatCompactCurrency(
  value: number | null | undefined,
  currency = "USD",
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}${currencySymbol(currency)}${formatCompact(Math.abs(value))}`;
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
