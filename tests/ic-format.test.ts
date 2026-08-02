import { describe, it, expect } from "vitest";
import {
  fmtMoney,
  fmtMoneyCompact,
  fmtNumber,
  fmtPercent,
  fmtPp,
  fmtMultiple,
  fmtDate,
  fmtDateTime,
  fmtFiscalPeriod,
  fmtUnavailable,
  deltaPp,
  relativeChange,
  currencySymbol,
  NOT_AVAILABLE,
} from "@/lib/ic/format";

describe("ic/format money", () => {
  it("formats USD with en-US grouping and thousands separators", () => {
    expect(fmtMoney(1234567.891, "USD")).toBe("$1,234,568");
    expect(fmtMoney(183.4, "USD")).toBe("$183.40");
  });

  it("formats INR with Indian digit grouping", () => {
    expect(fmtMoney(1234567, "INR")).toBe("₹12,34,567");
    expect(fmtMoney(1450, "INR")).toBe("₹1,450");
  });

  it("keeps precision for very low-priced stocks", () => {
    expect(fmtMoney(0.1234, "USD")).toBe("$0.1234");
  });

  it("handles very high-priced stocks (BRK-A class)", () => {
    expect(fmtMoney(747485, "USD")).toBe("$747,485");
  });

  it("renders negatives with a true minus and null as not available", () => {
    expect(fmtMoney(-12.5, "USD")).toBe("−$12.50");
    expect(fmtMoney(null, "USD")).toBe(NOT_AVAILABLE);
    expect(fmtMoney(Number.NaN, "USD")).toBe(NOT_AVAILABLE);
  });

  it("uses crore for large INR amounts and B for USD", () => {
    expect(fmtMoneyCompact(1.2e12, "INR")).toBe("₹1,20,000 Cr");
    expect(fmtMoneyCompact(2.5e5, "INR")).toBe("₹2.5 L");
    expect(fmtMoneyCompact(46_335_873_024, "USD")).toBe("$46.34B");
    expect(fmtMoneyCompact(-1.5e9, "USD")).toBe("−$1.5B");
  });

  it("falls back to ISO code prefix for unknown currencies", () => {
    expect(currencySymbol("PLN")).toBe("PLN ");
  });
});

describe("ic/format rates: percent vs percentage points", () => {
  it("formats a fraction as percent", () => {
    expect(fmtPercent(0.152)).toBe("15.2%");
    expect(fmtPercent(-0.034)).toBe("-3.4%");
    expect(fmtPercent(0.05, { signed: true })).toBe("+5.0%");
  });

  it("formats percentage points with the pp suffix, never %", () => {
    expect(fmtPp(5.2)).toBe("5.2pp");
    expect(fmtPp(-2.1, { signed: true })).toBe("-2.1pp");
  });

  it("deltaPp: a growth-rate change is a point delta, not a relative change", () => {
    // growth decelerates from 20% to 12%: that is -8pp, NOT -40%
    expect(deltaPp(0.20, 0.12)).toBeCloseTo(-8, 10);
    // the relative change is the different number
    expect(relativeChange(0.20, 0.12)).toBeCloseTo(-0.4, 10);
  });

  it("relativeChange handles zero and negative bases", () => {
    expect(relativeChange(0, 5)).toBeNull();
    expect(relativeChange(-10, -5)).toBeCloseTo(0.5, 10);
  });
});

describe("ic/format multiples, dates, fiscal periods", () => {
  it("formats multiples", () => {
    expect(fmtMultiple(23.42)).toBe("23.4x");
    expect(fmtMultiple(null)).toBe(NOT_AVAILABLE);
  });

  it("formats dates", () => {
    expect(fmtDate("2026-08-02T10:00:00Z")).toContain("2026");
    expect(fmtDate("garbage")).toBe(NOT_AVAILABLE);
    expect(fmtDate(null)).toBe(NOT_AVAILABLE);
  });

  it("stamps Indian-market datetimes in IST", () => {
    expect(fmtDateTime("2026-08-02T10:00:00Z", "IN")).toContain("IST");
    expect(fmtDateTime("2026-08-02T10:00:00Z", "US")).not.toContain("IST");
  });

  it("renders a non-December fiscal year with its actual end month", () => {
    expect(fmtFiscalPeriod({ fy: 2026, end: "2026-01-25" })).toBe("FY2026 (ended Jan 2026)");
    expect(fmtFiscalPeriod({ fy: 2025, end: "2025-12-31" })).toBe("FY2025");
    expect(fmtFiscalPeriod({ fy: 2025 })).toBe("FY2025");
  });

  it("renders missing values with a reason, never as zero", () => {
    expect(fmtUnavailable("no analyst coverage")).toBe("not available (no analyst coverage)");
    expect(fmtUnavailable()).toBe(NOT_AVAILABLE);
  });
});

describe("ic/format numbers", () => {
  it("groups per locale", () => {
    expect(fmtNumber(1234567, { currency: "INR", digits: 0 })).toBe("12,34,567");
    expect(fmtNumber(1234567, { currency: "USD", digits: 0 })).toBe("1,234,567");
  });
});
