import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatMarketCap,
  formatNumber,
  formatPercent,
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
