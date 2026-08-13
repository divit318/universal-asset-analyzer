import { describe, expect, it } from "vitest";
import { q, SCREENER_SECTORS } from "@/lib/yahoo-screener";

/**
 * The Yahoo screener query builder.
 *
 * This used to test `buildQuery`/`mapScreenerRow` — a criteria-object builder
 * hardcoded to EQUITY and to one fixed row shape. Both were removed once the
 * universal screener's universe providers took over: each builds its own query
 * from the `q` operand helpers below and narrows the raw response itself (an
 * ETF row and a crypto row share almost no fields). What is left to test is the
 * operand tree those helpers produce.
 */

describe("query operands", () => {
  it("builds a leaf equality operand", () => {
    expect(q.eq("region", "us")).toEqual({ operator: "eq", operands: ["region", "us"] });
  });

  it("builds numeric bound operands", () => {
    expect(q.gte("intradaymarketcap", 1e10)).toEqual({
      operator: "gte",
      operands: ["intradaymarketcap", 1e10],
    });
    expect(q.lte("dayvolume", 5e6)).toEqual({ operator: "lte", operands: ["dayvolume", 5e6] });
  });

  it("nests operands under and/or", () => {
    const query = q.and(q.eq("region", "us"), q.gte("intradaymarketcap", 3e8));
    expect(query.operator).toBe("and");
    expect(query.operands).toHaveLength(2);
    expect(query.operands).toContainEqual({ operator: "eq", operands: ["region", "us"] });
  });

  it("composes the small/mid-cap tranche query the equity universe actually sends", () => {
    const exchanges = q.or(
      q.eq("exchange", "NMS"),
      q.eq("exchange", "NYQ"),
      q.eq("exchange", "ASE"),
    );
    const query = q.and(
      q.eq("region", "us"),
      exchanges,
      q.gte("intradaymarketcap", 3e8),
      q.lte("intradaymarketcap", 1e10),
      q.gte("dayvolume", 200_000),
    );

    expect(query.operands).toHaveLength(5);
    expect(query.operands).toContainEqual(exchanges);
    // The market-cap band must be bounded on BOTH sides. Without the ceiling
    // this tranche would just re-fetch the mega-caps the first tranche already
    // has, and the small-cap universe would stay empty.
    expect(query.operands).toContainEqual({ operator: "gte", operands: ["intradaymarketcap", 3e8] });
    expect(query.operands).toContainEqual({ operator: "lte", operands: ["intradaymarketcap", 1e10] });
  });

  it("composes the REIT universe query", () => {
    const query = q.and(
      q.eq("region", "us"),
      q.eq("sector", "Real Estate"),
      q.gte("intradaymarketcap", 2e8),
    );
    expect(query.operands).toContainEqual({ operator: "eq", operands: ["sector", "Real Estate"] });
  });
});

describe("SCREENER_SECTORS", () => {
  it("exposes Yahoo's own 11-sector taxonomy (not GICS)", () => {
    expect(SCREENER_SECTORS).toHaveLength(11);
    expect(SCREENER_SECTORS).toContain("Real Estate");
    expect(SCREENER_SECTORS).toContain("Financial Services"); // GICS calls this "Financials"
  });
});

import { formatMetricValue } from "@/lib/screener/format";
import { getMetric } from "@/lib/assets/registry";

describe("india screener formatting", () => {
  it("formats Indian market caps in ₹ crores with Indian grouping", () => {
    const m = getMetric("indiaEquity", "marketCap")!;
    expect(formatMetricValue(m, 17_961_651_798_016)).toBe("₹17.96L Cr");   // Reliance-scale
    expect(formatMetricValue(m, 83_546_923_008)).toBe("₹8,355 Cr");        // small cap
    expect(formatMetricValue(m, null)).toBe("—");
  });

  it("declares Indian-specific metrics live now that screener.in extracts feed them", () => {
    // Was "unavailable" until lib/india-ownership.ts started populating these
    // from screener.in (see lib/assets/india-equity.ts); the honest label
    // followed the data.
    expect(getMetric("indiaEquity", "roce")?.availability).toBe("live");
    expect(getMetric("indiaEquity", "roce")?.source).toBe("screener_in");
    expect(getMetric("indiaEquity", "promoterHolding")?.availability).toBe("live");
  });
});
