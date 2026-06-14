import { describe, expect, it } from "vitest";
import { applyFilters, parseCriteria } from "@/lib/screener";
import type { ScreenerRow } from "@/lib/types";

const rows: ScreenerRow[] = [
  { symbol: "AAA", name: "Alpha", sector: "Tech", price: 100, changePercent: 2, marketCap: 5e9 },
  { symbol: "BBB", name: "Beta", sector: "Energy", price: 20, changePercent: -3, marketCap: 1e9 },
  { symbol: "CCC", name: "Gamma", sector: "Tech", price: 250, changePercent: 0.5, marketCap: null },
];

describe("applyFilters", () => {
  it("returns all rows for empty criteria", () => {
    expect(applyFilters(rows, {})).toHaveLength(3);
  });

  it("filters by sector case-insensitively", () => {
    const r = applyFilters(rows, { sector: "tech" });
    expect(r.map((x) => x.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("filters by price range", () => {
    const r = applyFilters(rows, { minPrice: 50, maxPrice: 200 });
    expect(r.map((x) => x.symbol)).toEqual(["AAA"]);
  });

  it("filters by change percent", () => {
    const r = applyFilters(rows, { minChangePercent: 0 });
    expect(r.map((x) => x.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("excludes null market cap when minMarketCap is set", () => {
    const r = applyFilters(rows, { minMarketCap: 2e9 });
    expect(r.map((x) => x.symbol)).toEqual(["AAA"]);
  });

  it("preserves input order", () => {
    const r = applyFilters(rows, { maxChangePercent: 100 });
    expect(r.map((x) => x.symbol)).toEqual(["AAA", "BBB", "CCC"]);
  });
});

describe("parseCriteria", () => {
  it("coerces numeric strings and trims sector", () => {
    expect(
      parseCriteria({ sector: " Tech ", minPrice: "10", maxPrice: "" }),
    ).toEqual({
      sector: "Tech",
      minPrice: 10,
      maxPrice: null,
      minChangePercent: null,
      maxChangePercent: null,
      minMarketCap: null,
    });
  });

  it("rejects non-numeric values as null", () => {
    expect(parseCriteria({ minPrice: "abc" }).minPrice).toBeNull();
  });
});
