import { describe, it, expect } from "vitest";
import {
  getRatio,
  getPromoterHolding,
  getFIIHolding,
  getDIIHolding,
} from "../lib/screener-in";
import type { ScreenerInCompany } from "../lib/screener-in";

function makeCompany(overrides: Partial<ScreenerInCompany> = {}): ScreenerInCompany {
  return {
    name: "Test Co",
    symbol: "TEST",
    bseCode: "500001",
    marketCap: 10000,
    currentPrice: 1200,
    high52w: 1500,
    low52w: 900,
    pe: 22.5,
    bookValue: 400,
    dividendYield: 1.5,
    roce: 18,
    roe: 14,
    debt: 2000,
    changePercent: 1.2,
    ratios: [
      {
        name: "Price to Earning",
        values: [
          { period: "Mar 2020", value: "18" },
          { period: "Mar 2021", value: "20" },
          { period: "Mar 2022", value: "22" },
          { period: "Mar 2023", value: "25" },
        ],
      },
      {
        name: "EV / EBITDA",
        values: [{ period: "Mar 2023", value: "14.2" }],
      },
    ],
    peers: [],
    shareholding: [
      { holding: "promoter", name: "Promoters", values: ["55.0", "54.5", "54.2"] },
      { holding: "fii", name: "FIIs", values: ["12.3", "13.1", "14.0"] },
      { holding: "dii", name: "DIIs", values: ["8.0", "8.5", "9.0"] },
      { holding: "retail", name: "Public", values: ["24.7", "23.9", "22.8"] },
    ],
    ...overrides,
  };
}

describe("getRatio", () => {
  it("returns the last value for a matching ratio", () => {
    const c = makeCompany();
    expect(getRatio(c, "Price to Earning")).toBe(25);
  });

  it("returns the EV/EBITDA ratio", () => {
    const c = makeCompany();
    expect(getRatio(c, "EV / EBITDA")).toBe(14.2);
  });

  it("returns null for a missing ratio", () => {
    const c = makeCompany();
    expect(getRatio(c, "Nonexistent Ratio")).toBeNull();
  });

  it("handles case-insensitive matching", () => {
    const c = makeCompany();
    expect(getRatio(c, "price to earning")).toBe(25);
  });
});

describe("getPromoterHolding", () => {
  it("returns latest promoter holding", () => {
    const c = makeCompany();
    expect(getPromoterHolding(c)).toBe(54.2);
  });

  it("returns null when no promoter row", () => {
    const c = makeCompany({ shareholding: [] });
    expect(getPromoterHolding(c)).toBeNull();
  });
});

describe("getFIIHolding", () => {
  it("returns latest FII holding", () => {
    const c = makeCompany();
    expect(getFIIHolding(c)).toBe(14.0);
  });
});

describe("getDIIHolding", () => {
  it("returns latest DII holding", () => {
    const c = makeCompany();
    expect(getDIIHolding(c)).toBe(9.0);
  });
});
