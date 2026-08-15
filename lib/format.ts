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

/**
 * Round to display precision and normalize signed zero. A value like -0.004
 * rendered at one decimal is "-0.0%" — a negative zero, which reads as a
 * data bug. Rounding FIRST and collapsing -0 to 0 fixes the sign and keeps
 * the sign prefix ("+"/"-") consistent with the digits actually shown.
 */
export function roundForDisplay(value: number, digits: number): number {
  const r = Number(value.toFixed(digits));
  return r === 0 ? 0 : r; // `0 === -0`, so this collapses -0 to +0
}

/**
 * English ordinal, e.g. 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd,
 * 23rd, 101st. Replaces the naive `${n}th` that produced "1th pct" and
 * "23th pct" on the Compare page's percentile captions.
 */
export function ordinal(n: number): string {
  const abs = Math.abs(Math.round(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
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
  // Pence-quoted listings (LSE "GBp"/"GBX", JSE "ZAc"): Intl normalizes the
  // code to GBP/ZAR and prints "£521.74" for a 521.74p quote — a 100× lie.
  // Per-share values in these codes render with the minor-unit suffix, the
  // same convention the LSE itself prints. (Yahoo's MAGNITUDE fields — market
  // cap, AUM — arrive in the MAJOR unit even on GBp quotes, so
  // formatCompactCurrency correctly keeps "£" for them.)
  const suffix = MINOR_UNIT_SUFFIX[currency];
  if (suffix) {
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
  }
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
  const r = roundForDisplay(value, digits);
  const sign = r > 0 ? "+" : "";
  return `${sign}${r.toFixed(digits)}%`;
}

/**
 * Valuation ratio, e.g. "8.13x". THE formatter for P/E, P/B, EV/EBITDA and
 * friends — one ratio must not render as `8.13`, `8.1x`, and `7.5` on the
 * same page depending on which component drew it.
 */
export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (!isRenderable(value)) return "—";
  return `${value.toFixed(digits)}x`;
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

/**
 * Compact dollar amount for USD-QUOTED instruments ONLY (crypto "-USD" pairs,
 * USD futures, AI spend). Anything with a listing/reporting currency must use
 * {@link formatCompactCurrency} instead — this helper cannot say anything but
 * "$", and putting it in front of an INR/JPY/KRW figure mislabels the number
 * by the FX rate. (2026-08-14 audit: every non-USD-guaranteed call site was
 * migrated off this function; new call sites must be USD-guaranteed.)
 */
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
 * Quote currencies denominated in 1/100 of their major unit. Yahoo prices LSE
 * listings in "GBp" (pence) and JSE listings in "ZAc" (cents): a 435.5p quote
 * shown as "£435.50" would overstate the price 100×, and dividing by 100
 * would silently convert a value we were given. Brokers and the LSE itself
 * print pence with a suffix ("435.5p") — so do we. Lookup is case-sensitive:
 * uppercase "GBP" is real pounds and must keep the "£".
 *
 * Applies to PER-SHARE-scale values only (price, targets, EPS, dividends).
 * Yahoo's magnitude fields (marketCap, AUM) arrive in the MAJOR unit even on
 * pence-quoted listings — verified live 2026-08-14: BP.L price 521.7 (pence)
 * beside marketCap 8.06e10 (pounds) — so the compact formatters keep "£".
 */
const MINOR_UNIT_SUFFIX: Record<string, string> = {
  GBp: "p",
  GBX: "p",
  ZAc: "c",
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
 *
 * INR amounts use Indian units — crore (1e7) above ₹1 Cr, lakh (1e5) above
 * ₹1 L — with Indian digit grouping, matching screener.in / AMFI / every
 * Indian filing ("₹38,121 Cr", not "₹381.21B"). Same convention as
 * lib/ic/format.ts's fmtMoneyCompact, which is IC-scoped; this is the
 * app-wide counterpart.
 */
export function formatCompactCurrency(
  value: number | null | undefined,
  currency: string | null | undefined = "USD",
): string {
  if (!isRenderable(value)) return "—";
  const code = (currency ?? "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency ?? ""] ?? CURRENCY_SYMBOLS[code];
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (code === "INR") {
    const amount =
      abs >= 1e7
        ? `${(abs / 1e7).toLocaleString("en-IN", { maximumFractionDigits: abs >= 1e12 ? 0 : 1 })} Cr`
        : abs >= 1e5
          ? `${(abs / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`
          : abs.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    return `${sign}₹${amount}`;
  }
  const amount = formatCompact(abs);
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${code} ${amount}`;
}

/**
 * A per-share figure (EPS, dividend per share) in its reporting currency.
 * Separate from {@link formatCompactCurrency} because per-share values are
 * never compacted — "$1.2K EPS" would be nonsense — but they carry the same
 * currency hazard. `digits` exists for dividends, which are declared to the
 * tenth of a cent ($0.2575) and would be destroyed by 2dp rounding. A missing
 * currency renders a bare number — never an assumed "$".
 */
export function formatPerShare(
  value: number | null | undefined,
  currency: string | null | undefined,
  digits = 2,
): string {
  if (!isRenderable(value)) return "—";
  const amount = value.toFixed(digits);
  if (currency == null || currency === "") return amount;
  const suffix = MINOR_UNIT_SUFFIX[currency];
  if (suffix) return `${amount}${suffix}`; // per-share values on pence-quoted listings ARE pence
  const code = currency.toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency] ?? CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${amount}` : `${code} ${amount}`;
}

/* -------------------------------------------------------------------------- */
/* Chart currency formatting                                                  */
/*                                                                            */
/* THE formatter pair for monetary values on chart surfaces (y-axis ticks,   */
/* tooltips). Every Research Hub chart formats through these two functions   */
/* with the currency that travelled with the data — never a hardcoded "$".   */
/* The 7974.T chart rendered "¥14,655" as "$14655" because each chart owned  */
/* a private dollar-only fmtPrice; centralizing here is what makes that      */
/* class of bug structurally impossible to reintroduce per-chart.            */
/* -------------------------------------------------------------------------- */

/**
 * A price-scaled monetary value for chart axes and tooltips, in the
 * instrument's own currency.
 *
 * - Adaptive precision (2dp under 10, 1dp under 100, whole above) — the same
 *   ramp the charts always used, so US output is unchanged.
 * - Thousands separators (Indian grouping for INR), which four-digit-plus
 *   prices (7974.T ¥14,655, MRF ₹1,20,000) were missing entirely.
 * - Unknown ISO codes fall back to a "CODE 123" prefix — unambiguous, per
 *   {@link currencySymbol}.
 * - A null/undefined currency renders a bare number. Missing metadata must
 *   surface as "no unit", never as a silently assumed "$".
 */
export function formatChartPrice(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!isRenderable(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs < 10 ? 2 : abs < 100 ? 1 : 0;
  const code = (currency ?? "").toUpperCase();
  const amount = abs.toLocaleString(code === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = value < 0 ? "-" : "";
  if (currency == null || currency === "") return `${sign}${amount}`;
  const suffix = MINOR_UNIT_SUFFIX[currency];
  if (suffix) return `${sign}${amount}${suffix}`;
  const symbol = CURRENCY_SYMBOLS[currency] ?? CURRENCY_SYMBOLS[code];
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${code} ${amount}`;
}

/** 391.04 → "391", 48.04 → "48", 9.64 → "9.6" — one decimal only while it says something. */
function compactAmount(x: number): string {
  return x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, "");
}

/**
 * A large monetary magnitude compacted for chart axis ticks: "$391B",
 * "¥48T", "€250M". INR compacts in Indian units — "₹964 Cr", "₹3.9K Cr",
 * "₹9.6L Cr" — the same convention the India financial charts print, because
 * "₹9,640B" is not a number an Indian filing ever shows. Tooltips, which have
 * room for precision, should use {@link formatCompactCurrency} instead; this
 * is the tick-sized rendering. Same missing-currency contract as
 * {@link formatChartPrice}: no currency, no symbol — never an assumed "$".
 */
export function formatChartMoneyCompact(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!isRenderable(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const code = (currency ?? "").toUpperCase();
  if (code === "INR") {
    const amount =
      abs >= 1e12
        ? `${compactAmount(abs / 1e12)}L Cr` // lakh crore
        : abs >= 1e10
          ? `${compactAmount(abs / 1e10)}K Cr` // thousand crore
          : abs >= 1e7
            ? `${compactAmount(abs / 1e7)} Cr`
            : abs >= 1e5
              ? `${compactAmount(abs / 1e5)} L`
              : abs.toLocaleString("en-IN", { maximumFractionDigits: 0 });
    return `${sign}₹${amount}`;
  }
  let amount = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  for (const [threshold, unit] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (abs >= threshold) {
      amount = `${compactAmount(abs / threshold)}${unit}`;
      break;
    }
  }
  if (currency == null || currency === "") return `${sign}${amount}`;
  // No MINOR_UNIT_SUFFIX branch here on purpose: magnitude fields on
  // pence-quoted listings arrive in POUNDS (see MINOR_UNIT_SUFFIX doc), so
  // "GBp" on a magnitude keeps the "£" via CURRENCY_SYMBOLS.
  const symbol = CURRENCY_SYMBOLS[currency] ?? CURRENCY_SYMBOLS[code];
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${code} ${amount}`;
}

/**
 * ExcelJS numFmt string for a currency, so exported cells stay NUMBERS (sort,
 * sum, chart in Excel) while displaying the right unit: `"₹"#,##0.00`,
 * `"¥"#,##0.00`, `#,##0.00"p"` for pence-quoted listings, and a plain
 * `#,##0.00` when the currency is unknown — never an assumed "$".
 */
export function excelMoneyFormat(currency: string | null | undefined): string {
  if (currency == null || currency === "") return "#,##0.00";
  const suffix = MINOR_UNIT_SUFFIX[currency];
  if (suffix) return `#,##0.00"${suffix}"`;
  return `"${currencySymbol(currency)}"#,##0.00`;
}

/**
 * The currency financial-STATEMENT magnitudes are denominated in.
 *
 * Statements (lib/statements.ts) come primarily from Yahoo's fundamentals
 * time series, which reports in the company's own reporting currency —
 * `financialCurrency` — not the listing currency: an ADR like TSM trades in
 * USD but reports revenue in TWD. Falls back to the listing currency (they
 * are identical for non-ADRs) for snapshots cached before the field existed,
 * and to null — an explicit "unlabelled" — when neither is known.
 */
export function statementsCurrency(
  financialCurrency: string | null | undefined,
  listingCurrency: string | null | undefined,
): string | null {
  return financialCurrency ?? listingCurrency ?? null;
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

/* -------------------------------------------------------------------------- */
/* Indian fiscal calendar                                                     */
/* -------------------------------------------------------------------------- */

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Indian fiscal label for a screener.in period string ("Jun 2026", "Mar 2026",
 * "TTM"). The Indian fiscal year runs April–March, so the quarter ending
 * June 2026 is Q1 of FY27 — NOT "Q2 2026" as a US calendar labeling would say.
 *
 *   "Jun 2026" → "Q1 FY27"     "Mar 2026" → "Q4 FY26"
 *   "Mar 2026" (annual=true) → "FY26"      "TTM" → "TTM"
 *
 * Returns the input unchanged when it isn't a "Mon YYYY" period, so callers
 * can map over mixed period lists ("TTM", growth labels) safely.
 */
export function indianFiscalLabel(period: string, annual = false): string {
  const m = period.trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m) return period;
  const month = MONTH_INDEX[m[1].toLowerCase()];
  const year = Number(m[2]);
  if (month == null || !Number.isFinite(year)) return period;

  // FY is named for its END year: Apr 2026–Mar 2027 is FY27.
  const fyEnd = month >= 3 ? year + 1 : year;
  const fy = `FY${String(fyEnd % 100).padStart(2, "0")}`;
  if (annual) {
    // Annual columns are fiscal-year ends ("Mar 2026" = FY26).
    return month === 2 ? `FY${String(year % 100).padStart(2, "0")}` : fy;
  }
  const quarter = month >= 3 ? Math.floor((month - 3) / 3) + 1 : 4;
  return `Q${quarter} ${month >= 3 ? fy : `FY${String(year % 100).padStart(2, "0")}`}`;
}
