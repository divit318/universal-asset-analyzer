import { describe, expect, it } from "vitest";
import { parseFilings, parseTickerMap, parseFormDSearchHits, parseFormDXml } from "@/lib/edgar";

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

describe("parseFormDSearchHits", () => {
  // Fixture shaped like a real efts.sec.gov/LATEST/search-index response.
  const raw = {
    hits: {
      hits: [
        {
          _source: {
            ciks: ["0002012115", "0002006833"],
            display_names: [
              "MAV OpenAI Fund I, a series of MAV Alternate Investments, LP  (CIK 0002012115)",
              "QP-MAV OpenAI Fund I, a series of MAV Alternate Investments, LP  (CIK 0002006833)",
            ],
            form: "D",
            file_date: "2024-03-22",
            adsh: "0002012115-24-000002",
          },
        },
        {
          _source: {
            ciks: ["0002041780"],
            display_names: ["OPENAI - FUTURUM A SERIES OF MASTER FUND I LLC  (CIK 0002041780)"],
            form: "D/A",
            file_date: "2025-02-18",
            adsh: "0002041780-25-000003",
          },
        },
      ],
    },
  };

  it("strips the (CIK ...) suffix and takes the first cik/name pair per hit", () => {
    const filings = parseFormDSearchHits(raw);
    expect(filings).toHaveLength(2);
    expect(filings[0]).toEqual({
      cik: "0002012115",
      entityName: "MAV OpenAI Fund I, a series of MAV Alternate Investments, LP",
      form: "D",
      filedDate: "2024-03-22",
      accessionNumber: "0002012115-24-000002",
    });
    expect(filings[1].entityName).toBe("OPENAI - FUTURUM A SERIES OF MASTER FUND I LLC");
    expect(filings[1].form).toBe("D/A");
  });

  it("respects the max limit", () => {
    expect(parseFormDSearchHits(raw, 1)).toHaveLength(1);
  });

  it("skips hits missing a cik, name, or accession number", () => {
    const incomplete = { hits: { hits: [{ _source: { display_names: ["No CIK Inc"], form: "D", file_date: "2024-01-01", adsh: "x" } }] } };
    expect(parseFormDSearchHits(incomplete)).toEqual([]);
  });

  it("returns [] when there are no hits", () => {
    expect(parseFormDSearchHits({})).toEqual([]);
  });
});

describe("parseFormDXml", () => {
  it("extracts entity name, date of first sale, and offering amounts from real Form D XML shape", () => {
    const xml = `<?xml version="1.0"?>
<edgarSubmission>
  <primaryIssuer>
    <entityName>OpenAI-01, a Series of OpenAI Opp Fund LLC</entityName>
  </primaryIssuer>
  <offeringData>
    <typeOfFiling>
      <dateOfFirstSale>
        <value>2026-04-14</value>
      </dateOfFirstSale>
    </typeOfFiling>
    <offeringSalesAmountsList>
      <totalOfferingAmount>8475135</totalOfferingAmount>
      <totalAmountSold>8475135</totalAmountSold>
      <totalRemaining>0</totalRemaining>
    </offeringSalesAmountsList>
  </offeringData>
</edgarSubmission>`;
    expect(parseFormDXml(xml)).toEqual({
      entityName: "OpenAI-01, a Series of OpenAI Opp Fund LLC",
      dateOfFirstSale: "2026-04-14",
      totalOfferingAmount: 8475135,
      totalAmountSold: 8475135,
    });
  });

  it("returns null fields instead of throwing when a value is non-numeric (e.g. 'Indefinite')", () => {
    const xml = `<edgarSubmission><offeringData><offeringSalesAmountsList><totalOfferingAmount>Indefinite</totalOfferingAmount></offeringSalesAmountsList></offeringData></edgarSubmission>`;
    const result = parseFormDXml(xml);
    expect(result.totalOfferingAmount).toBeNull();
    expect(result.entityName).toBeNull();
  });

  it("returns all nulls for empty input", () => {
    expect(parseFormDXml("")).toEqual({
      entityName: null,
      dateOfFirstSale: null,
      totalOfferingAmount: null,
      totalAmountSold: null,
    });
  });
});
