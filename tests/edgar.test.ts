import { describe, expect, it } from "vitest";
import { parseFilings, parseTickerMap } from "@/lib/edgar";

describe("parseTickerMap", () => {
  it("builds an upper-cased ticker map with zero-padded CIKs", () => {
    const map = parseTickerMap({
      "0": { cik_str: 320193, ticker: "aapl", title: "Apple Inc." },
      "1": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
    });
    expect(map.get("AAPL")).toEqual({ cik: "0000320193", name: "Apple Inc." });
    expect(map.get("NVDA")?.cik).toBe("0001045810");
  });
});

describe("parseFilings", () => {
  const submissions = {
    filings: {
      recent: {
        form: ["10-K", "8-K"],
        filingDate: ["2024-11-01", "2024-10-15"],
        primaryDocument: ["aapl-20240928.htm", "ex99.htm"],
        primaryDocDescription: ["Annual report", ""],
        accessionNumber: ["0000320193-24-000123", "0000320193-24-000100"],
      },
    },
  };

  it("maps filings and builds archive URLs without leading zeros in the path", () => {
    const filings = parseFilings(submissions, "0000320193");
    expect(filings).toHaveLength(2);
    expect(filings[0]).toMatchObject({
      form: "10-K",
      filedAt: "2024-11-01",
      description: "Annual report",
    });
    expect(filings[0].documentUrl).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
    );
  });

  it("falls back to the form name when description is empty", () => {
    const filings = parseFilings(submissions, "0000320193");
    expect(filings[1].description).toBe("8-K");
  });

  it("respects the max limit", () => {
    expect(parseFilings(submissions, "0000320193", 1)).toHaveLength(1);
  });

  it("returns [] when there are no recent filings", () => {
    expect(parseFilings({}, "0000320193")).toEqual([]);
  });
});
