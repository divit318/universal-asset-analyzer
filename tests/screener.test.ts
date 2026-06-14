import { describe, expect, it } from "vitest";
import { applyFilters, parseCriteria } from "@/lib/screener";
import { buildQuery, mapScreenerRow } from "@/lib/yahoo-screener";
import type { ScreenerRow } from "@/lib/types";

const rows: ScreenerRow[] = [
  { symbol: "AAA", name: "Alpha", sector: "Tech", price: 100, changePercent: 2, marketCap: 5e9, peRatio: 18, volume: 1e6 },
  { symbol: "BBB", name: "Beta", sector: "Energy", price: 20, changePercent: -3, marketCap: 1e9, peRatio: null, volume: 5e5 },
  { symbol: "CCC", name: "Gamma", sector: "Tech", price: 250, changePercent: 0.5, marketCap: null, peRatio: 40, volume: 2e6 },
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
      parseCriteria({ sector: " Tech ", minPrice: "10", maxPrice: "", maxPE: "25" }),
    ).toEqual({
      sector: "Tech",
      minPrice: 10,
      maxPrice: null,
      minChangePercent: null,
      maxChangePercent: null,
      minMarketCap: null,
      maxMarketCap: null,
      minPE: null,
      maxPE: 25,
      minVolume: null,
      sortField: null,
      sortDir: null,
    });
  });

  it("rejects non-numeric values as null", () => {
    expect(parseCriteria({ minPrice: "abc" }).minPrice).toBeNull();
  });

  it("only accepts known sort fields and directions", () => {
    expect(parseCriteria({ sortField: "peRatio", sortDir: "asc" })).toMatchObject({
      sortField: "peRatio",
      sortDir: "asc",
    });
    expect(parseCriteria({ sortField: "bogus", sortDir: "sideways" })).toMatchObject({
      sortField: null,
      sortDir: null,
    });
  });
});

describe("buildQuery (universal screener)", () => {
  it("always scopes to US-listed equities", () => {
    const q = buildQuery({});
    expect(q.operator).toBe("and");
    expect(q.operands).toContainEqual({ operator: "eq", operands: ["region", "us"] });
  });

  it("maps min/max filters onto the right Yahoo fields", () => {
    const q = buildQuery({ minMarketCap: 1e10, maxPE: 20, sector: "Technology" });
    expect(q.operands).toContainEqual({ operator: "gte", operands: ["intradaymarketcap", 1e10] });
    expect(q.operands).toContainEqual({ operator: "lte", operands: ["peratio.lasttwelvemonths", 20] });
    expect(q.operands).toContainEqual({ operator: "eq", operands: ["sector", "Technology"] });
  });
});

describe("mapScreenerRow", () => {
  it("maps a raw quote and drops rows without a price", () => {
    expect(
      mapScreenerRow({ symbol: "AAPL", longName: "Apple Inc.", sectorDisp: "Technology", regularMarketPrice: 200, marketCap: 3e12, trailingPE: 30, regularMarketVolume: 5e7 }),
    ).toEqual({
      symbol: "AAPL",
      name: "Apple Inc.",
      sector: "Technology",
      price: 200,
      changePercent: 0,
      marketCap: 3e12,
      peRatio: 30,
      volume: 5e7,
    });
    expect(mapScreenerRow({ symbol: "NOPRICE" })).toBeNull();
  });
});
