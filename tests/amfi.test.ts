import { describe, expect, it } from "vitest";
import {
  amfiAmcId,
  isDirectPlan,
  matchAmfiScheme,
  matchAmfiSchemeInfo,
  mergeTerPages,
  normalizeAmfiCategory,
  parseNavAll,
  parseTerRows,
  terPageCount,
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

describe("terPageCount", () => {
  it("reads the API's pageCount — PPFAS MF_ID=64 reports {page:1,pageSize:100,total:217,pageCount:3} live (2026-09)", () => {
    expect(terPageCount({ page: 1, pageSize: 100, total: 217, pageCount: 3 })).toBe(3);
  });

  it("derives from total/pageSize when pageCount is absent", () => {
    expect(terPageCount({ pageSize: 100, total: 217 })).toBe(3);
    expect(terPageCount({ pageSize: 100, total: 100 })).toBe(1);
  });

  it("defaults to a single page on missing or garbage meta", () => {
    expect(terPageCount(undefined)).toBe(1);
    expect(terPageCount({})).toBe(1);
    expect(terPageCount({ pageCount: NaN })).toBe(1);
    expect(terPageCount({ pageCount: 0 })).toBe(1);
  });

  it("clamps a runaway pageCount", () => {
    expect(terPageCount({ pageCount: 1_000_000 })).toBe(500);
  });
});

describe("mergeTerPages", () => {
  it("concatenates pages in order", () => {
    expect(mergeTerPages([[1, 2], [3], [4, 5]])).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns null when any page is missing — a partial table must not silently match", () => {
    expect(mergeTerPages([[1, 2], null, [4]])).toBeNull();
    expect(mergeTerPages([undefined])).toBeNull();
  });

  it("handles the single-page case", () => {
    expect(mergeTerPages([[1]])).toEqual([1]);
    expect(mergeTerPages([[]])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* NAVAll scheme master                                                       */
/* -------------------------------------------------------------------------- */

// Fixture mirrors the live NAVAll.txt shape verbatim (fetched 2026-09-01 via
// www.amfiindia.com/spages/NAVAll.txt → portal redirect): a global header
// line, blank-line-separated section headers, bare AMC lines, and 8-column
// scheme rows. Codes/ISINs/NAVs below are the live values for those schemes.
const NAVALL_FIXTURE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
 
Open Ended Schemes(Equity Scheme - Flexi Cap Fund)
 
PPFAS Mutual Fund
 
122639;INF879O01027;-;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;90.7827;31-Aug-2026
153964;-;INF879O01308;Parag Parikh Flexi Cap Fund;Direct Plan;Monthly IDCW Payout;90.7827;31-Aug-2026
122640;INF879O01019;-;Parag Parikh Flexi Cap Fund;Regular Plan;Growth;82.7201;31-Aug-2026
153965;-;INF879O01324;Parag Parikh Flexi Cap Fund;Regular Plan;Monthly IDCW Payout;82.7195;31-Aug-2026
 
quant Mutual Fund
 
109830;INF966L01457;-;Quant Flexi Cap Fund;Regular Plan;Growth Option;107.9699;31-Aug-2026
 
Open Ended Schemes(Debt Scheme - Liquid Fund)
 
PPFAS Mutual Fund
 
141685;INF879O01100;INF879O01118;Parag Parikh Liquid Fund;Regular Plan;Growth;1425.1234;31-Aug-2026
garbage;INF000000000;-;Broken Row Without Numeric Code;Regular Plan;Growth;10.0;31-Aug-2026
141686;too;few;fields
148888;-;-;Nav Unavailable Fund;Regular Plan;Growth;N.A.;31-Aug-2026
`;

describe("parseNavAll", () => {
  const entries = parseNavAll(NAVALL_FIXTURE);

  it("parses scheme rows under their section + AMC context", () => {
    const flexi = entries.find((e) => e.schemeCode === 122640);
    expect(flexi).toMatchObject({
      schemeName: "Parag Parikh Flexi Cap Fund",
      isins: ["INF879O01019"],
      nav: 82.7201, // live Regular-Growth NAV, 31-Aug-2026
      amcName: "PPFAS Mutual Fund",
      schemeType: "Open Ended",
      rawCategory: "Equity Scheme - Flexi Cap Fund",
      plan: "Regular Plan",
      option: "Growth",
    });
  });

  it("tracks AMC changes within a section and section changes across the file", () => {
    expect(entries.find((e) => e.schemeCode === 109830)?.amcName).toBe("quant Mutual Fund");
    const liquid = entries.find((e) => e.schemeCode === 141685);
    expect(liquid?.amcName).toBe("PPFAS Mutual Fund");
    expect(liquid?.rawCategory).toBe("Debt Scheme - Liquid Fund");
    expect(liquid?.isins).toEqual(["INF879O01100", "INF879O01118"]);
  });

  it("skips the header line and malformed rows, and nulls an N.A. NAV", () => {
    expect(entries.map((e) => e.schemeCode)).toEqual([122639, 153964, 122640, 153965, 109830, 141685, 148888]);
    const na = entries.find((e) => e.schemeCode === 148888);
    expect(na?.nav).toBeNull();
    expect(na?.isins).toEqual([]);
  });
});

describe("normalizeAmfiCategory", () => {
  // Every raw string below is a real NAVAll section name (live file, 2026-09).
  it("normalizes the SEBI equity categories", () => {
    expect(normalizeAmfiCategory("Equity Scheme - Large Cap Fund")).toMatchObject({ group: "equity", category: "Large Cap" });
    expect(normalizeAmfiCategory("Equity Scheme - Large & Mid Cap Fund")).toMatchObject({ group: "equity", category: "Large & Mid Cap" });
    expect(normalizeAmfiCategory("Equity Scheme - Small Cap Fund")).toMatchObject({ group: "equity", category: "Small Cap" });
    expect(normalizeAmfiCategory("Equity Scheme - Flexi Cap Fund")).toMatchObject({ group: "equity", category: "Flexi Cap" });
    expect(normalizeAmfiCategory("Equity Scheme - ELSS")).toMatchObject({ group: "equity", category: "ELSS" });
    // Both spellings of the sectoral/thematic section exist in the live file.
    expect(normalizeAmfiCategory("Equity Scheme - Sectoral/ Thematic")).toMatchObject({ group: "equity", category: "Sectoral/Thematic" });
    expect(normalizeAmfiCategory("Equity Schemes - Thematic Fund")).toMatchObject({ group: "equity", category: "Sectoral/Thematic" });
    expect(normalizeAmfiCategory("Equity Schemes - ELSS- Tax Saver Fund")).toMatchObject({ group: "equity", category: "ELSS" });
  });

  it("normalizes debt categories", () => {
    expect(normalizeAmfiCategory("Debt Scheme - Liquid Fund")).toMatchObject({ group: "debt", category: "Liquid" });
    expect(normalizeAmfiCategory("Debt Scheme - Corporate Bond Fund")).toMatchObject({ group: "debt", category: "Corporate Bond" });
    expect(normalizeAmfiCategory("Debt Scheme - Ultra Short Duration Fund")).toMatchObject({ group: "debt", category: "Ultra Short Duration" });
    expect(normalizeAmfiCategory("Debt Scheme - Medium to Long Duration Fund")).toMatchObject({ group: "debt", category: "Medium to Long Duration" });
    expect(normalizeAmfiCategory("Debt Scheme - Banking and PSU Fund")).toMatchObject({ group: "debt", category: "Banking and PSU" });
    expect(normalizeAmfiCategory("Income/Debt Oriented Schemes - 10-year Constant Maturity Gilt Fund")).toMatchObject({ group: "debt", category: "Gilt with 10 year Constant Duration" });
    expect(normalizeAmfiCategory("Debt Scheme - Floater Fund")).toMatchObject({ group: "debt", category: "Floater" });
  });

  it("normalizes hybrid and solution categories, including both balanced-advantage spellings", () => {
    expect(normalizeAmfiCategory("Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage")).toMatchObject({ group: "hybrid", category: "Balanced Advantage" });
    expect(normalizeAmfiCategory("Hybrid Schemes - Balanced Advantage Fund/ Dynamic Asset Allocation")).toMatchObject({ group: "hybrid", category: "Balanced Advantage" });
    expect(normalizeAmfiCategory("Hybrid Scheme - Arbitrage Fund")).toMatchObject({ group: "hybrid", category: "Arbitrage" });
    expect(normalizeAmfiCategory("Solution Oriented Scheme - Retirement Fund")).toMatchObject({ group: "solution", category: "Retirement" });
    expect(normalizeAmfiCategory("Solution Oriented Scheme - Children’s Fund")).toMatchObject({ group: "solution", category: "Children's" });
  });

  it("normalizes the 'other' group", () => {
    expect(normalizeAmfiCategory("Other Scheme - Index Funds")).toMatchObject({ group: "other", category: "Index Fund" });
    expect(normalizeAmfiCategory("Index Funds - Equity Funds")).toMatchObject({ group: "other", category: "Index Fund" });
    expect(normalizeAmfiCategory("Other Scheme - Gold ETF")).toMatchObject({ group: "other", category: "Gold ETF" });
    expect(normalizeAmfiCategory("Other Scheme - FoF Overseas")).toMatchObject({ group: "other", category: "FoF Overseas" });
    expect(normalizeAmfiCategory("Exchange Traded Funds (ETFs) - Equity ETF")).toMatchObject({ group: "other", category: "ETF" });
  });

  it("keeps unknown sections best-effort: group inferred, category = raw", () => {
    // "Growth" and "Income" are legacy (pre-2017) close-ended section names in the live file.
    expect(normalizeAmfiCategory("Growth")).toMatchObject({ group: "equity", category: "Growth" });
    expect(normalizeAmfiCategory("Income")).toMatchObject({ group: "debt", category: "Income" });
    expect(normalizeAmfiCategory("Something Entirely New")).toMatchObject({ group: "other", category: "Something Entirely New" });
    expect(normalizeAmfiCategory("Equity Scheme - Quantum Leap Fund").group).toBe("equity");
  });
});

describe("matchAmfiSchemeInfo", () => {
  const master = parseNavAll(NAVALL_FIXTURE);

  it("resolves a Regular Growth Yahoo name to the Regular/Growth entry (never the Direct plan)", () => {
    // Yahoo's live name for schemeCode 122640 is "Parag Parikh Flexi Cap Reg Gr".
    const info = matchAmfiSchemeInfo("Parag Parikh Flexi Cap Reg Gr", "PPFAS Asset Management Pvt. Ltd", master);
    expect(info).toMatchObject({
      schemeCode: 122640,
      schemeName: "Parag Parikh Flexi Cap Fund",
      isDirect: false,
      isGrowth: true,
      nav: 82.7201,
    });
    expect(info?.category).toMatchObject({ group: "equity", category: "Flexi Cap" });
  });

  it("resolves the Direct plan and the IDCW option to their own entries", () => {
    expect(matchAmfiSchemeInfo("Parag Parikh Flexi Cap Dir Gr", "PPFAS Asset Management Pvt. Ltd", master)?.schemeCode).toBe(122639);
    const idcw = matchAmfiSchemeInfo("Parag Parikh Flexi Cap Reg IDCW", "PPFAS Asset Management Pvt. Ltd", master);
    expect(idcw?.schemeCode).toBe(153965);
    expect(idcw?.isGrowth).toBe(false);
  });

  it("restricts to the AMC when the family maps — quant's Flexi Cap does not shadow PPFAS's", () => {
    const info = matchAmfiSchemeInfo("Quant Flexi Cap Gr", "Quant Money Managers Ltd", master);
    expect(info?.schemeCode).toBe(109830);
    expect(info?.isDirect).toBe(false);
  });

  it("searches all schemes when the family is unknown, still unambiguous", () => {
    expect(matchAmfiSchemeInfo("Parag Parikh Liquid Reg Gr", null, master)?.schemeCode).toBe(141685);
  });

  it("returns null rather than guessing across an ambiguity or a missing scheme", () => {
    expect(matchAmfiSchemeInfo("PPFAS Balanced Advantage Reg Gr", "PPFAS Asset Management Pvt. Ltd", master)).toBeNull();
    // Two distinct schemes, identical token sets after stopword removal → tie → null.
    const tied = parseNavAll(NAVALL_FIXTURE.replace("Quant Flexi Cap Fund", "Parag Parikh Flexi Cap Scheme"));
    expect(matchAmfiSchemeInfo("Parag Parikh Flexi Cap Reg Gr", null, tied)).toBeNull();
  });

  it("detects growth vs IDCW on legacy 6-column rows where the option lives in the name", () => {
    const legacy = parseNavAll(
      [
        "Open Ended Schemes(Equity Scheme - Large Cap Fund)",
        "HDFC Mutual Fund",
        "100119;INF179K01BE2;-;HDFC Large Cap Fund - Regular Plan - Growth;1050.50;31-Aug-2026",
        "100122;INF179K01BC6;INF179K01BD4;HDFC Large Cap Fund - Regular Plan - IDCW;45.20;31-Aug-2026",
      ].join("\n"),
    );
    expect(legacy).toHaveLength(2);
    expect(legacy[0].plan).toBeNull();
    const info = matchAmfiSchemeInfo("HDFC Large Cap Gr", "HDFC Asset Management Co Ltd", legacy);
    expect(info?.schemeCode).toBe(100119);
    expect(info?.isGrowth).toBe(true);
    expect(info?.isDirect).toBe(false);
  });
});
