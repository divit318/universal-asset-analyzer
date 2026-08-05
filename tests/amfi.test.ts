import { describe, expect, it } from "vitest";
import {
  amfiAmcId,
  isDirectPlan,
  matchAmfiScheme,
  parseTerRows,
  yahooSchemeBase,
} from "@/lib/amfi";

describe("amfiAmcId", () => {
  it("resolves Yahoo family strings to AMFI fund-house ids", () => {
    expect(amfiAmcId("HDFC Asset Management Co Ltd")).toBe(9);
    expect(amfiAmcId("Nippon Life India Asset Management Ltd")).toBe(21);
    expect(amfiAmcId("PPFAS Asset Management Pvt Ltd")).toBe(64);
    expect(amfiAmcId("UTI Asset Management Co Ltd")).toBe(28);
    expect(amfiAmcId("SBI Funds Management Ltd")).toBe(22);
  });

  it("keeps quant and Quantum distinct", () => {
    expect(amfiAmcId("Quant Money Managers Ltd")).toBe(13);
    expect(amfiAmcId("Quantum Asset Management Co Pvt Ltd")).toBe(41);
  });

  it("does not false-match on substrings (LIC inside 'public', ITI inside 'Securities')", () => {
    expect(amfiAmcId("Public Sector Asset Management")).toBeNull();
    expect(amfiAmcId("Securities Trust of America")).toBeNull();
  });

  it("returns null for unknown or missing families", () => {
    expect(amfiAmcId("Vanguard")).toBeNull();
    expect(amfiAmcId(null)).toBeNull();
  });
});

describe("yahooSchemeBase", () => {
  it("strips Morningstar's trailing share-class suffixes", () => {
    expect(yahooSchemeBase("HDFC Large Cap IDCW-R")).toBe("HDFC Large Cap");
    expect(yahooSchemeBase("Nippon India Small Cap Dir Gr")).toBe("Nippon India Small Cap");
    expect(yahooSchemeBase("UTI Healthcare Dir IDCW-P")).toBe("UTI Healthcare");
    expect(yahooSchemeBase("Nippon India Small Cap Gr Bns")).toBe("Nippon India Small Cap");
  });

  it("only strips from the end — 'Growth' inside a scheme's name survives", () => {
    expect(yahooSchemeBase("HDFC Growth Opportunities Dir Gr")).toBe("HDFC Growth Opportunities");
  });
});

describe("isDirectPlan", () => {
  it("detects both the compressed and spelled-out direct markers", () => {
    expect(isDirectPlan("Nippon India Small Cap Dir Gr")).toBe(true);
    expect(isDirectPlan("Parag Parikh Long Term Equity Direct Growth")).toBe(true);
    expect(isDirectPlan("HDFC Large Cap IDCW-R")).toBe(false);
  });
});

describe("matchAmfiScheme", () => {
  const schemes = [
    { schemeName: "HDFC Large Cap Fund" },
    { schemeName: "HDFC Large and Mid Cap Fund" },
    { schemeName: "HDFC Small Cap Fund" },
    { schemeName: "HDFC Flexi Cap Fund" },
  ];

  it("matches the right scheme despite Yahoo's abbreviated class suffixes", () => {
    expect(matchAmfiScheme("HDFC Large Cap IDCW-R", schemes)?.schemeName).toBe("HDFC Large Cap Fund");
    expect(matchAmfiScheme("HDFC Small Cap Dir Gr", schemes)?.schemeName).toBe("HDFC Small Cap Fund");
  });

  it("does not fall back to an unrelated scheme when the right one is absent", () => {
    expect(matchAmfiScheme("HDFC Balanced Advantage IDCW", schemes)).toBeNull();
  });

  it("treats a tie as an ambiguity, not a match", () => {
    // "Fund" and "Scheme" are stopwords, so both normalize to {hdfc, top}
    // and score identically — returning either would be a coin flip.
    const tied = [{ schemeName: "HDFC Top Fund" }, { schemeName: "HDFC Top Scheme" }];
    expect(matchAmfiScheme("HDFC Top", tied)).toBeNull();
  });
});

describe("parseTerRows", () => {
  it("dedupes daily rows keeping the latest date, and converts percent to fraction", () => {
    const parsed = parseTerRows([
      { Scheme_Name: "HDFC Large Cap Fund", R_TER: "1.5900", D_TER: "1.0500", TER_Date: "2026-07-01T00:00:00.000Z", SchemeCat_Desc: "Equity Scheme - Large Cap Fund" },
      { Scheme_Name: "HDFC Large Cap Fund", R_TER: "1.5600", D_TER: "1.0300", TER_Date: "2026-07-31T00:00:00.000Z", SchemeCat_Desc: "Equity Scheme - Large Cap Fund" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].regularTer).toBeCloseTo(0.0156);
    expect(parsed[0].directTer).toBeCloseTo(0.0103);
    expect(parsed[0].asOf).toBe("2026-07-31");
    expect(parsed[0].category).toBe("Equity Scheme - Large Cap Fund");
  });

  it("treats a zero TER as missing — no SEBI-regulated scheme charges nothing", () => {
    const parsed = parseTerRows([
      { Scheme_Name: "X Fund", R_TER: "0.0000", D_TER: "0.4600", TER_Date: "2026-07-31T00:00:00.000Z" },
    ]);
    expect(parsed[0].regularTer).toBeNull();
    expect(parsed[0].directTer).toBeCloseTo(0.0046);
  });

  it("drops nameless rows and survives an empty payload", () => {
    expect(parseTerRows([{ R_TER: "1.0" }])).toEqual([]);
    expect(parseTerRows([])).toEqual([]);
  });
});
