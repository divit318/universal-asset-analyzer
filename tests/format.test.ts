import { describe, expect, it } from "vitest";
import {
  excelMoneyFormat,
  formatChartMoneyCompact,
  formatChartPrice,
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatPerShare,
  formatSignedCurrency,
  statementsCurrency,
} from "@/lib/format";

describe("formatNumber", () => {
  it("formats with thousands separators", () => {
    expect(formatNumber(1234567.891)).toBe("1,234,567.89");
  });
  it("returns em dash for null/NaN", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(NaN)).toBe("—");
  });
});

describe("formatCurrency", () => {
  it("formats USD", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
  });
  it("respects currency", () => {
    expect(formatCurrency(10, "EUR")).toBe("€10.00");
  });
  it("renders pence-quoted listings as pence, not 100x-overstated pounds/rand", () => {
    // BP.L quotes 521.735 GBp — Intl would print £521.74, wrong by 100×.
    expect(formatCurrency(521.735, "GBp")).toBe("521.74p");
    expect(formatCurrency(3289, "GBp")).toBe("3,289.00p");
    expect(formatCurrency(3289, "GBX")).toBe("3,289.00p");
    expect(formatCurrency(15000, "ZAc")).toBe("15,000.00c");
    // Real pounds keep the pound sign.
    expect(formatCurrency(12.35, "GBP")).toBe("£12.35");
  });
  it("keeps signed variant consistent with the pence rule", () => {
    expect(formatSignedCurrency(5.2, "GBp")).toBe("+5.20p");
    expect(formatSignedCurrency(-5.2, "GBp")).toBe("-5.20p");
  });
});

describe("formatCompactCurrency", () => {
  it("uses K/M/B/T units for non-INR currencies", () => {
    expect(formatCompactCurrency(781_188_857_856, "USD")).toBe("$781.19B");
    expect(formatCompactCurrency(-1_500_000, "EUR")).toBe("-€1.50M");
  });

  it("uses crore/lakh with Indian digit grouping for INR", () => {
    // HDFC Large Cap IDCW-Regular plan net assets: ₹3,626 crore, not "₹36.26B".
    expect(formatCompactCurrency(36_261_556_224, "INR")).toBe("₹3,626.2 Cr");
    // Reliance-scale market cap: whole crore, Indian grouping.
    expect(formatCompactCurrency(19_940_000_000_000, "INR")).toBe("₹19,94,000 Cr");
    expect(formatCompactCurrency(250_000, "INR")).toBe("₹2.5 L");
    expect(formatCompactCurrency(9_000, "INR")).toBe("₹9,000");
    expect(formatCompactCurrency(-36_261_556_224, "INR")).toBe("-₹3,626.2 Cr");
  });

  it("returns em dash for null", () => {
    expect(formatCompactCurrency(null, "INR")).toBe("—");
  });

  it("keeps the pound on GBp MAGNITUDES — Yahoo reports them in the major unit", () => {
    // Verified live 2026-08-14: BP.L price 521.7 (pence) but marketCap
    // 8.06e10 (pounds) on the same GBp quote. Magnitudes keep "£".
    expect(formatCompactCurrency(80_618_766_336, "GBp")).toBe("£80.62B");
  });
});

describe("formatPerShare", () => {
  it("formats per-share values in their own currency", () => {
    expect(formatPerShare(6.42, "USD")).toBe("$6.42");
    expect(formatPerShare(402.11, "JPY")).toBe("¥402.11");
    expect(formatPerShare(21.6, "INR")).toBe("₹21.60");
  });
  it("supports dividend precision via digits", () => {
    expect(formatPerShare(0.2575, "USD", 4)).toBe("$0.2575");
  });
  it("renders pence per-share values as pence", () => {
    expect(formatPerShare(6.61, "GBp")).toBe("6.61p");
  });
  it("renders a bare number when currency is unknown — never an assumed dollar", () => {
    expect(formatPerShare(0.2575, null, 4)).toBe("0.2575");
    expect(formatPerShare(1.23, undefined)).toBe("1.23");
  });
  it("prefixes unknown ISO codes with the code", () => {
    expect(formatPerShare(84.5, "KRW")).toBe("₩84.50");
    expect(formatPerShare(84.5, "SEK")).toBe("SEK 84.50");
  });
});

describe("excelMoneyFormat", () => {
  it("builds a symbol-prefixed numFmt per currency", () => {
    expect(excelMoneyFormat("USD")).toBe('"$"#,##0.00');
    expect(excelMoneyFormat("INR")).toBe('"₹"#,##0.00');
    expect(excelMoneyFormat("JPY")).toBe('"¥"#,##0.00');
  });
  it("uses a pence suffix for pence-quoted listings", () => {
    expect(excelMoneyFormat("GBp")).toBe('#,##0.00"p"');
  });
  it("falls back to a plain number format when currency is unknown", () => {
    expect(excelMoneyFormat(null)).toBe("#,##0.00");
    expect(excelMoneyFormat("")).toBe("#,##0.00");
  });
});

describe("formatPercent", () => {
  it("adds a + for positive", () => {
    expect(formatPercent(1.234)).toBe("+1.23%");
  });
  it("keeps the - for negative", () => {
    expect(formatPercent(-0.5)).toBe("-0.50%");
  });
  it("handles null", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatCompact", () => {
  it("scales by magnitude", () => {
    expect(formatCompact(1500)).toBe("1.50K");
    expect(formatCompact(2_300_000)).toBe("2.30M");
    expect(formatCompact(3_400_000_000)).toBe("3.40B");
    expect(formatCompact(1_200_000_000_000)).toBe("1.20T");
  });
  it("leaves small numbers whole", () => {
    expect(formatCompact(42)).toBe("42");
  });
});

describe("formatMarketCap", () => {
  it("prefixes a dollar sign", () => {
    expect(formatMarketCap(2_900_000_000_000)).toBe("$2.90T");
  });
  it("handles null", () => {
    expect(formatMarketCap(null)).toBe("—");
  });
  it("keeps USD output identical when the currency is passed explicitly (or missing)", () => {
    expect(formatMarketCap(2_900_000_000_000, "USD")).toBe("$2.90T");
    expect(formatMarketCap(2_900_000_000_000, null)).toBe("$2.90T");
    expect(formatMarketCap(2_900_000_000_000, undefined)).toBe("$2.90T");
  });
  it("labels non-USD quote currencies with their own symbol/units, never a blanket dollar", () => {
    // INR compacts in Indian units via formatCompactCurrency: ₹, crore.
    expect(formatMarketCap(1.5e12, "INR")).toBe("₹1,50,000 Cr");
    expect(formatMarketCap(3_400_000_000, "JPY")).toBe("¥3.40B");
    expect(formatMarketCap(3_400_000_000, "INR")).not.toContain("$");
  });
});

/* All expected strings below are hand-computed from the documented rules
   (adaptive decimals: 2dp < 10, 1dp < 100, whole ≥ 100; INR in Indian units). */
describe("formatChartPrice", () => {
  it("renders each market's own currency — never a blanket dollar", () => {
    expect(formatChartPrice(465.5, "USD")).toBe("$466");      // 🇺🇸
    expect(formatChartPrice(14655, "JPY")).toBe("¥14,655");   // 🇯🇵 the 7974.T bug
    expect(formatChartPrice(123456, "INR")).toBe("₹1,23,456"); // 🇮🇳 Indian grouping
    expect(formatChartPrice(99.5, "EUR")).toBe("€99.5");      // 🇪🇺
    expect(formatChartPrice(55.25, "CAD")).toBe("C$55.3");    // 🇨🇦
    expect(formatChartPrice(30.55, "AUD")).toBe("A$30.6");    // 🇦🇺
    expect(formatChartPrice(100, "CHF")).toBe("CHF 100");     // 🇨🇭
  });

  it("keeps the adaptive precision ramp US charts always had", () => {
    expect(formatChartPrice(1.234, "USD")).toBe("$1.23");
    expect(formatChartPrice(42.55, "USD")).toBe("$42.6");
    expect(formatChartPrice(146.55, "USD")).toBe("$147");
    expect(formatChartPrice(0, "USD")).toBe("$0.00");
  });

  it("renders LSE pence quotes as pence, not 100x-overstated pounds", () => {
    expect(formatChartPrice(435.5, "GBp")).toBe("436p");
    expect(formatChartPrice(4355, "GBp")).toBe("4,355p");
    expect(formatChartPrice(4355, "GBX")).toBe("4,355p");
    // Real pounds keep the pound sign.
    expect(formatChartPrice(9.35, "GBP")).toBe("£9.35");
  });

  it("prefixes unknown ISO codes with the code — unambiguous, never a guessed symbol", () => {
    expect(formatChartPrice(123.45, "SEK")).toBe("SEK 123");
  });

  it("renders a bare number when currency metadata is missing — never assumes USD", () => {
    expect(formatChartPrice(14655, null)).toBe("14,655");
    expect(formatChartPrice(14655, undefined)).toBe("14,655");
    expect(formatChartPrice(14655, "")).toBe("14,655");
  });

  it("keeps the sign ahead of the symbol and dashes non-finite input", () => {
    expect(formatChartPrice(-5.25, "USD")).toBe("-$5.25");
    expect(formatChartPrice(null, "USD")).toBe("—");
    expect(formatChartPrice(Infinity, "USD")).toBe("—");
  });
});

describe("formatChartMoneyCompact", () => {
  it("compacts axis ticks in each currency's own convention", () => {
    expect(formatChartMoneyCompact(391_000_000_000, "USD")).toBe("$391B");
    expect(formatChartMoneyCompact(48_040_000_000_000, "JPY")).toBe("¥48T");
    expect(formatChartMoneyCompact(250_000_000, "EUR")).toBe("€250M");
    expect(formatChartMoneyCompact(1_500_000_000, "USD")).toBe("$1.5B");
    expect(formatChartMoneyCompact(950, "USD")).toBe("$950");
  });

  it("compacts INR in Indian units (Cr → K Cr → L Cr), matching the India charts", () => {
    expect(formatChartMoneyCompact(9_640_000_000, "INR")).toBe("₹964 Cr");
    expect(formatChartMoneyCompact(39_000_000_000, "INR")).toBe("₹3.9K Cr");
    expect(formatChartMoneyCompact(9_640_000_000_000, "INR")).toBe("₹9.6L Cr");
    expect(formatChartMoneyCompact(450_000, "INR")).toBe("₹4.5 L");
  });

  it("falls back to a bare magnitude without currency metadata — never an assumed dollar", () => {
    expect(formatChartMoneyCompact(391_000_000_000, null)).toBe("391B");
    expect(formatChartMoneyCompact(391_000_000_000, "SEK")).toBe("SEK 391B");
  });

  it("handles sign and non-finite input", () => {
    expect(formatChartMoneyCompact(-1_500_000_000, "USD")).toBe("-$1.5B");
    expect(formatChartMoneyCompact(null, "USD")).toBe("—");
  });
});

describe("statementsCurrency", () => {
  it("prefers the reporting currency (ADRs report in their home currency)", () => {
    expect(statementsCurrency("TWD", "USD")).toBe("TWD"); // TSM: TWD figures, USD listing
  });
  it("falls back to the listing currency when the snapshot predates the field", () => {
    expect(statementsCurrency(null, "JPY")).toBe("JPY");
    expect(statementsCurrency(undefined, "USD")).toBe("USD");
  });
  it("returns null — an explicit unlabelled state — when nothing is known", () => {
    expect(statementsCurrency(null, null)).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats ISO dates", () => {
    expect(formatDate("2024-03-15")).toBe("Mar 15, 2024");
  });
  it("passes through unparseable input", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate(null)).toBe("—");
  });
});
