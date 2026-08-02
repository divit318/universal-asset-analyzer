/**
 * IC Report — shared formatting module.
 *
 * Every currency, percent, multiple, large-number, date and fiscal-period
 * string rendered by the IC Report (prompt context, UI, PDF, Markdown) is
 * produced here. Locale and currency aware: INR uses Indian digit grouping
 * and lakh/crore compact units; everything else uses en-US grouping with
 * K/M/B/T. Ad-hoc `toFixed` + hardcoded "$" formatting is banned in the
 * feature — route through this module.
 *
 * Percent vs percentage points: a change from one rate to another is a
 * percentage-POINT delta; the relative change is a different number. The two
 * are distinct branded types here so they cannot be confused (Phase 1.9).
 */

/* ── Branded rate types ─────────────────────────────────────────────────── */

/** A rate expressed as a fraction of 1 (0.15 = 15%). */
export type Fraction = number & { readonly __unit?: "fraction" };
/** A difference between two rates, in percentage points (5 = 5pp). */
export type PercentagePoints = number & { readonly __unit?: "pp" };

/** Delta between two fractional rates, in percentage points. */
export function deltaPp(from: Fraction, to: Fraction): PercentagePoints {
  return (to - from) * 100;
}

/** Relative change between two values, as a fraction (0.2 = +20%). */
export function relativeChange(from: number, to: number): Fraction | null {
  if (!Number.isFinite(from) || from === 0) return null;
  return (to - from) / Math.abs(from);
}

/* ── Locale plumbing ────────────────────────────────────────────────────── */

export type Market = "US" | "IN" | "OTHER";

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", INR: "₹", EUR: "€", GBP: "£", GBp: "p", JPY: "¥", CNY: "¥",
  HKD: "HK$", CAD: "C$", AUD: "A$", CHF: "CHF ", KRW: "₩", TWD: "NT$",
  SGD: "S$", BRL: "R$", ZAR: "R", SEK: "kr ", NOK: "kr ", DKK: "kr ",
};

export function currencySymbol(currency: string | null | undefined): string {
  if (!currency) return "$";
  return CURRENCY_SYMBOL[currency] ?? `${currency} `;
}

function localeFor(currency: string | null | undefined): string {
  return currency === "INR" ? "en-IN" : "en-US";
}

const NA = "not available";

/* ── Numbers ────────────────────────────────────────────────────────────── */

/** Locale-grouped plain number ("1,234,567.89" / "12,34,567.89" for INR). */
export function fmtNumber(
  v: number | null | undefined,
  opts: { digits?: number; currency?: string | null } = {},
): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const digits = opts.digits ?? decimalsForValue(v);
  return v.toLocaleString(localeFor(opts.currency), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Consistent decimal precision by value class (Phase 1.8). */
function decimalsForValue(v: number): number {
  const a = Math.abs(v);
  if (a >= 1000) return 0;
  if (a >= 1) return 2;
  if (a === 0) return 0;
  return 4; // sub-1 prices (very low-priced stocks) keep meaningful precision
}

/** A per-share money amount: "$183.42", "₹1,450.00". */
export function fmtMoney(
  v: number | null | undefined,
  currency: string | null | undefined,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const sym = currencySymbol(currency);
  const sign = opts.signed && v > 0 ? "+" : v < 0 ? "−" : "";
  const digits = opts.digits ?? decimalsForValue(v);
  return `${sign}${sym}${Math.abs(v).toLocaleString(localeFor(currency), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * Compact large money amount.
 * INR: lakh (≥1e5) and crore (≥1e7) — "₹2.4 L Cr" style is avoided; values
 * ≥1e7 are expressed in crore ("₹1,84,532 Cr"), following screener.in and
 * Indian filing convention. Other currencies: K/M/B/T.
 */
export function fmtMoneyCompact(
  v: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const sym = currencySymbol(currency);
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (currency === "INR") {
    if (a >= 1e7) return `${sign}${sym}${(a / 1e7).toLocaleString("en-IN", { maximumFractionDigits: a >= 1e12 ? 0 : 1 })} Cr`;
    if (a >= 1e5) return `${sign}${sym}${(a / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
    return `${sign}${sym}${a.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (a >= size) return `${sign}${sym}${(a / size).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: a / size >= 100 ? 0 : 1 })}${suffix}`;
  }
  return `${sign}${sym}${a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/* ── Rates ──────────────────────────────────────────────────────────────── */

/** A fractional rate as a percent: fmtPercent(0.152) → "15.2%". */
export function fmtPercent(
  v: Fraction | null | undefined,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const digits = opts.digits ?? 1;
  const sign = opts.signed && v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(digits)}%`;
}

/** A percentage-point delta: fmtPp(5.2) → "5.2pp". Sign always shown when signed. */
export function fmtPp(
  v: PercentagePoints | null | undefined,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const digits = opts.digits ?? 1;
  const sign = opts.signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}pp`;
}

/** A valuation multiple: fmtMultiple(23.4) → "23.4x". */
export function fmtMultiple(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${v.toFixed(digits)}x`;
}

/* ── Dates and fiscal periods ───────────────────────────────────────────── */

/** "2 Aug 2026" (en-US) — dates are unambiguous day-month-year everywhere. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** Timestamp with timezone; Indian-market data is stamped in IST (Phase 4). */
export function fmtDateTime(iso: string | null | undefined, market: Market = "US"): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  const timeZone = market === "IN" ? "Asia/Kolkata" : undefined;
  const tzLabel = market === "IN" ? " IST" : "";
  return d.toLocaleString("en-US", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }) + tzLabel;
}

export interface FiscalPeriodRef {
  /** Fiscal year label as reported by the filer (e.g. 2026). */
  fy: number;
  /** Period end date, ISO, when known. */
  end?: string | null;
}

/**
 * "FY2026" or, when the period end is known and the fiscal year does not end
 * in December, "FY2026 (ended Jan 2026)" — the label and the end date are
 * rendered together so a non-calendar fiscal year can never read as the wrong
 * calendar year (Phase 1.2).
 */
export function fmtFiscalPeriod(p: FiscalPeriodRef): string {
  if (p.end) {
    const d = new Date(p.end);
    if (!Number.isNaN(d.getTime()) && d.getUTCMonth() !== 11) {
      return `FY${p.fy} (ended ${d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })})`;
    }
  }
  return `FY${p.fy}`;
}

/* ── Explicit not-available rendering (Phase 1.7) ───────────────────────── */

/** Render a missing value with its reason, never as zero or silence. */
export function fmtUnavailable(reason?: string | null): string {
  return reason ? `${NA} (${reason})` : NA;
}

export const NOT_AVAILABLE = NA;
