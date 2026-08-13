import { describe, expect, it } from "vitest";
import {
  announcementToNewsItem,
  categorizeIndianDevelopment,
  distinctivePhrase,
  isIndianEquitySymbol,
  isJunkStory,
  isRelevantToIndianCompany,
  isRoutineFiling,
  mapNseAnnouncement,
  nseBaseSymbol,
  parseNseDate,
  shortenNseType,
} from "@/lib/india-news";

describe("isIndianEquitySymbol", () => {
  it("detects NSE and BSE suffixes", () => {
    expect(isIndianEquitySymbol("RELIANCE.NS")).toBe(true);
    expect(isIndianEquitySymbol("500325.BO")).toBe(true);
    expect(isIndianEquitySymbol("reliance.ns")).toBe(true);
  });
  it("rejects US and other symbols", () => {
    expect(isIndianEquitySymbol("AAPL")).toBe(false);
    expect(isIndianEquitySymbol("BP.L")).toBe(false);
    expect(isIndianEquitySymbol("BTC-USD")).toBe(false);
    expect(isIndianEquitySymbol("^NSEI")).toBe(false);
  });
});

describe("nseBaseSymbol", () => {
  it("strips exchange suffixes", () => {
    expect(nseBaseSymbol("RELIANCE.NS")).toBe("RELIANCE");
    expect(nseBaseSymbol("TATAMOTORS.BO")).toBe("TATAMOTORS");
    expect(nseBaseSymbol("m&m.ns")).toBe("M&M");
  });
});

describe("distinctivePhrase", () => {
  it("keeps the first two distinctive words", () => {
    expect(distinctivePhrase("Reliance Industries Limited")).toBe("Reliance Industries");
    expect(distinctivePhrase("HDFC Bank Limited")).toBe("HDFC Bank");
    expect(distinctivePhrase("Adani Ports and Special Economic Zone Limited")).toBe("Adani Ports");
  });
  it("strips leading The and stacked legal suffixes", () => {
    expect(distinctivePhrase("The Tata Power Company Limited")).toBe("Tata Power");
  });
  it("handles single-word names", () => {
    expect(distinctivePhrase("Infosys Limited")).toBe("Infosys");
    expect(distinctivePhrase("Wipro Ltd.")).toBe("Wipro");
  });
  it("strips (India) parentheticals", () => {
    expect(distinctivePhrase("Info Edge (India) Limited")).toBe("Info Edge");
  });
});

describe("isRelevantToIndianCompany — the HDFC problem", () => {
  const bank = "HDFC Bank Limited";
  it("accepts stories naming the full phrase", () => {
    expect(isRelevantToIndianCompany("HDFC Bank AGM on August 5: new chairman on agenda", "HDFCBANK.NS", bank)).toBe(true);
    expect(isRelevantToIndianCompany("Why HDFC Bank has not made money for investors", "HDFCBANK.NS", bank)).toBe(true);
  });
  it("rejects stories about sibling HDFC entities", () => {
    expect(isRelevantToIndianCompany("HDFC Life launches new ULIP plan", "HDFCBANK.NS", bank)).toBe(false);
    expect(isRelevantToIndianCompany("HDFC AMC Q1 profit rises 20%", "HDFCBANK.NS", bank)).toBe(false);
  });
  it("rejects bare group-name mentions", () => {
    expect(isRelevantToIndianCompany("HDFC twins rally on merger news", "HDFCBANK.NS", bank)).toBe(false);
  });
});

describe("isRelevantToIndianCompany — Reliance group", () => {
  const ril = "Reliance Industries Limited";
  it("accepts Reliance Industries and the RIL alias", () => {
    expect(isRelevantToIndianCompany("Reliance Industries share price rallies 3%", "RELIANCE.NS", ril)).toBe(true);
    expect(isRelevantToIndianCompany("RIL Q1 results beat estimates", "RELIANCE.NS", ril)).toBe(true);
  });
  it("rejects other Reliance entities", () => {
    expect(isRelevantToIndianCompany("Reliance Power wins solar bid", "RELIANCE.NS", ril)).toBe(false);
    expect(isRelevantToIndianCompany("Reliance Infrastructure debt restructuring", "RELIANCE.NS", ril)).toBe(false);
  });
});

describe("isRelevantToIndianCompany — aliases and tickers", () => {
  it("accepts curated aliases", () => {
    expect(isRelevantToIndianCompany("TCS bags $1bn deal from European insurer", "TCS.NS", "Tata Consultancy Services Limited")).toBe(true);
    expect(isRelevantToIndianCompany("HUL raises soap prices", "HINDUNILVR.NS", "Hindustan Unilever Limited")).toBe(true);
    expect(isRelevantToIndianCompany("L&T wins metro contract", "LT.NS", "Larsen & Toubro Limited")).toBe(true);
  });
  it("matches phrases across punctuation", () => {
    expect(isRelevantToIndianCompany("Larsen & Toubro Q4 orders jump", "LT.NS", "Larsen & Toubro Limited")).toBe(true);
  });
  it("does not cross-match other Tata companies", () => {
    expect(isRelevantToIndianCompany("Tata Steel expands Kalinganagar plant", "TCS.NS", "Tata Consultancy Services Limited")).toBe(false);
    expect(isRelevantToIndianCompany("Tata Motors JLR sales up", "TATASTEEL.NS", "Tata Steel Limited")).toBe(false);
  });
  it("falls back to the ticker when the name is unknown", () => {
    expect(isRelevantToIndianCompany("IRCTC launches new tourist train", "IRCTC.NS", null)).toBe(true);
    expect(isRelevantToIndianCompany("Railways announces new trains", "IRCTC.NS", null)).toBe(false);
  });
});

describe("isRelevantToIndianCompany — generic single-word names (Astral)", () => {
  const astral = "Astral Limited";
  it("accepts the word as an early subject in a market-context headline", () => {
    expect(isRelevantToIndianCompany("Here's What We Like About Astral's (NSE:ASTRAL) Upcoming Dividend", "ASTRAL.NS", astral)).toBe(true);
    expect(isRelevantToIndianCompany("Astral Q1 profit rises 12% on plumbing demand", "ASTRAL.NS", astral)).toBe(true);
  });
  it("rejects unrelated uses of the word", () => {
    // ResMed's Astral ventilator — the token appears late, as a passing mention.
    expect(isRelevantToIndianCompany("ResMed Q4 FY26 slides: EPS beats, revenue growth amid Astral headwind", "ASTRAL.NS", astral)).toBe(false);
    // An art series — no market context at all.
    expect(isRelevantToIndianCompany("'Astral Bodies': The new series of meteorites by ENORME Studio", "ASTRAL.NS", astral)).toBe(false);
    // A different company sharing the word — foreign exchange marker + entity noun.
    expect(isRelevantToIndianCompany("Astral Resources (ASX:AAR) Rockets as Investors Chase this Gold-Mining Stock", "ASTRAL.NS", astral)).toBe(false);
    expect(isRelevantToIndianCompany("Astral Resources Pushes Mandilla Towards Development in Gold Stock Rally", "ASTRAL.NS", astral)).toBe(false);
    // A product code right after the token ("ROG Astral RTX 5090").
    expect(isRelevantToIndianCompany("$4,429 order for a ROG Astral RTX 5090 cancelled by Nvidia", "ASTRAL.NS", astral)).toBe(false);
  });
});

describe("isJunkStory", () => {
  it("drops SEO landing pages and price-tracker stubs", () => {
    expect(isJunkStory("RELIANCE INDUSTRIES LTD Option Chain - Live Option Chain Data, OI", "Upstox")).toBe(true);
    expect(isJunkStory("IRCTC Share Price Today, IRCTC Stock Price Live NSE/BSE Updates", "The Economic Times")).toBe(true);
    expect(isJunkStory("Astral Share Price", "Upstox")).toBe(true);
    expect(isJunkStory("Astral Limited (ASTRAL.NS) stock price, news, quote and history", "Yahoo Finance UK")).toBe(true);
  });
  it("drops social-network mirrors", () => {
    expect(isJunkStory("ICICI Bank threatens to dislodge HDFC Bank", "LinkedIn")).toBe(true);
    expect(isJunkStory("Anant Ambani features on special cover", "facebook.com")).toBe(true);
  });
  it("drops bare company-name stubs when the name is known", () => {
    expect(isJunkStory("Astral Limited", "Reuters", "Astral Limited")).toBe(true);
  });
  it("keeps real journalism, including price-move stories", () => {
    expect(isJunkStory("Reliance Industries Share Price Rallies 3%: What's Driving the Stock Higher?", "India Infoline")).toBe(false);
    expect(isJunkStory("Why SBI share price falling despite strong Q1 results?", "livemint.com")).toBe(false);
    expect(isJunkStory("HDFC Bank cuts MCLR by 5 bps: Cheaper loans ahead?", "Business Standard")).toBe(false);
  });
});

describe("categorizeIndianDevelopment", () => {
  it("categorizes NSE filing types", () => {
    expect(categorizeIndianDevelopment("Financial Results for the quarter ended June 30")).toBe("results");
    expect(categorizeIndianDevelopment("Dividend of Rs 10 per share declared")).toBe("corporate-action");
    expect(categorizeIndianDevelopment("Award of Order/Receipt of Order worth Rs 500 crore")).toBe("orders");
    expect(categorizeIndianDevelopment("Change in Directors/ Key Managerial Personnel")).toBe("management");
    expect(categorizeIndianDevelopment("Amalgamation / Merger scheme approved")).toBe("m&a");
    expect(categorizeIndianDevelopment("Credit Rating upgraded by CRISIL")).toBe("credit-rating");
    expect(categorizeIndianDevelopment("Clarification sought by SEBI")).toBe("regulatory");
    expect(categorizeIndianDevelopment("Outcome of Board Meeting held today")).toBe("board-meeting");
    expect(categorizeIndianDevelopment("Analysts/Institutional Investor Meet/Con. Call Updates")).toBe("investor-meet");
  });
  it("categorizes media headlines", () => {
    expect(categorizeIndianDevelopment("Infosys Q2 earnings: net profit rises 5%")).toBe("results");
    expect(categorizeIndianDevelopment("Tata Motors announces stock split")).toBe("corporate-action");
    expect(categorizeIndianDevelopment("New CEO appointed at Wipro")).toBe("management");
  });
  it("defaults to news", () => {
    expect(categorizeIndianDevelopment("Shares rise on strong monsoon outlook")).toBe("news");
  });
});

describe("isRoutineFiling", () => {
  it("flags compliance noise", () => {
    expect(isRoutineFiling("Copy of Newspaper Publication")).toBe(true);
    expect(isRoutineFiling("Trading Window closure intimation")).toBe(true);
    expect(isRoutineFiling("Loss of Share Certificates informed")).toBe(true);
    expect(isRoutineFiling("Allotment of ESOP shares")).toBe(true);
    expect(isRoutineFiling("Certificate under SEBI (Depositories) Regulations Reg. 74(5)")).toBe(true);
    expect(isRoutineFiling("Statement of Investor Complaints for the quarter")).toBe(true);
  });
  it("keeps material filings", () => {
    expect(isRoutineFiling("Financial Results for Q1 FY27")).toBe(false);
    expect(isRoutineFiling("Award of Order worth Rs 1,200 crore")).toBe(false);
    expect(isRoutineFiling("Resignation of Chief Financial Officer")).toBe(false);
  });
});

describe("parseNseDate", () => {
  it("parses DD-MMM-YYYY as IST", () => {
    // 17:07:35 IST == 11:37:35 UTC
    expect(parseNseDate("07-Aug-2026 17:07:35")).toBe("2026-08-07T11:37:35.000Z");
  });
  it("parses YYYY-MM-DD as IST", () => {
    expect(parseNseDate("2026-08-07 17:07:35")).toBe("2026-08-07T11:37:35.000Z");
  });
  it("never throws on malformed input", () => {
    expect(typeof parseNseDate("not a date")).toBe("string");
    expect(typeof parseNseDate(undefined)).toBe("string");
  });
});

describe("mapNseAnnouncement", () => {
  const raw = {
    symbol: "RELIANCE",
    sm_name: "Reliance Industries Limited",
    desc: "Award of Order/Receipt of Order",
    attchmntText: "The company has received an order worth Rs 5,000 crore for solar modules.",
    attchmntFile: "https://nsearchives.nseindia.com/corporate/order.pdf",
    sort_date: "2026-08-07 17:07:35",
    seq_id: "106731531",
  };

  it("maps, shortens the type, and categorizes from the original type", () => {
    const a = mapNseAnnouncement(raw);
    expect(a).not.toBeNull();
    expect(a!.type).toBe("Order Win");
    expect(a!.category).toBe("orders");
    expect(a!.routine).toBe(false);
    expect(a!.url).toBe(raw.attchmntFile);
    expect(a!.publishedAt).toBe("2026-08-07T11:37:35.000Z");
  });

  it("drops rows without a symbol", () => {
    expect(mapNseAnnouncement({ desc: "Financial Results" })).toBeNull();
  });

  it("flags routine announcements", () => {
    const routine = mapNseAnnouncement({ ...raw, desc: "Copy of Newspaper Publication", attchmntText: "Newspaper clippings enclosed." });
    expect(routine!.routine).toBe(true);
  });

  it("converts to a NewsItem with the .NS ticker and category", () => {
    const item = announcementToNewsItem(mapNseAnnouncement(raw)!);
    expect(item.tickers).toEqual(["RELIANCE.NS"]);
    expect(item.category).toBe("orders");
    expect(item.source).toBe("NSE Filing");
    expect(item.headline).toContain("Order Win");
  });
});

describe("shortenNseType", () => {
  it("shortens verbose NSE types", () => {
    expect(shortenNseType("Analysts/Institutional Investor Meet/Con. Call Updates")).toBe("Investor Meet");
    expect(shortenNseType("Change in Directors/ Key Managerial Personnel/ Auditor/ Compliance Officer")).toBe("Management Change");
  });
  it("passes short types through", () => {
    expect(shortenNseType("Financial Results")).toBe("Financial Results");
    expect(shortenNseType("Dividend")).toBe("Dividend");
  });
});
