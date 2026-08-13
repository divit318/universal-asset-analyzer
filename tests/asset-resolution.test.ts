import { describe, expect, it } from "vitest";
import { nameTokens, rankCandidates } from "@/lib/asset-resolution";
import type { SymbolSuggestion } from "@/lib/types";

// Candidate sets captured from real Yahoo search responses (2026-08-10) — the
// exact payloads behind the audit's wrong-resolution bugs. Keep them realistic:
// the whole point of these tests is that Yahoo's fuzzy ranking is hostile.
const s = (symbol: string, name: string, type: string | null = "Equity", exchange: string | null = null): SymbolSuggestion => ({
  symbol,
  name,
  type,
  exchange,
  country: null,
});

const RELIANCE = [
  s("EZRA", "Reliance Global Group, Inc."),
  s("RS", "Reliance, Inc.", "Equity", "NYSE"),
  s("RELIANCE.NS", "Reliance Industries Limited", "Equity", "NSE"),
  s("RELINFRA.BO", "Reliance Infrastructure Limited", "Equity", "Bombay"),
  s("0EU.F", "Reliance Worldwide Corporation Limited", "Equity", "Frankfurt"),
];

const DOLLAR_RUPEE = [
  s("6C=F", "Canadian Dollar Futures,Sep-202", "Futures"),
  s("CJY=F", "Canadian Dollar/Japanese Yen Fu", "Futures"),
  s("AST=F", "BTIC on Adjusted Interest Rate ", "Futures"),
  s("ECD=F", "NASDAQ EM Asia Media Large Mid ", "Futures"),
  s("ESR=F", "EURO SHORT-TERM RATE (ESTR) FUT", "Futures"),
];

const SP500 = [
  s("VFV.TO", "Vanguard S&P 500 Index ETF", "ETF", "Toronto"),
  s("XUS.TO", "iShares Core S&P 500 Index ETF", "ETF", "Toronto"),
  s("^SPX", "S&P 500 INDEX", "Index"),
  s("MES=F", "MICRO E-MINI S&P 500 INDEX FUTU", "Futures"),
  s("SWPPX", "Schwab S&P 500 Index", "Fund"),
];

const BLORPTECH = [
  s("TEVA", "Teva Pharmaceutical Industries Limited"),
  s("DIA", "State Street SPDR Dow Jones Industrial Average ETF Trust", "ETF"),
  s("^DJI", "Dow Jones Industrial Average", "Index"),
  s("XAI=F", "E-mini Industrial Select Sector", "Futures"),
];

const HDFC = [
  s("HDFCBANK.NS", "HDFC Bank Limited", "Equity", "NSE"),
  s("HDB", "HDFC Bank Limited", "Equity", "NYSE"),
  s("H1DB34.SA", "HDFC Bank Limited", "Equity", "São Paulo"),
];

const APPLE = [
  s("AAPL", "Apple Inc.", "Equity", "NASDAQ"),
  s("APLE", "Apple Hospitality REIT, Inc.", "Equity", "NYSE"),
  s("APC.DE", "Apple Inc.", "Equity", "Frankfurt"),
  s("D90.F", "Apple International Co., Ltd.", "Equity", "Frankfurt"),
];

const TESLA = [
  s("TSLA", "Tesla, Inc.", "Equity", "NASDAQ"),
  s("TL0.F", "Tesla, Inc.", "Equity", "Frankfurt"),
  s("TSLZ", "T-Rex 2X Inverse Tesla Daily Ta", "ETF"),
];

const GOOGLE = [
  s("GOOG", "Alphabet Inc.", "Equity", "NASDAQ"),
  s("GOOP", "Kurv Yield Premium Strategy Google ETF", "ETF"),
  s("^VXGOG", "CBOE EQUITY VIXON GOOGLE", "Index"),
];

const USDINR = [
  s("USDT-INR", "Tether USDt INR", "Cryptocurrency"),
  s("INR=X", "USD/INR", "Currency"),
];

const NIFTY = [
  s("^NSEI", "NIFTY 50", "Index"),
  s("0P00005WVN.BO", "LIC MF Nifty 50 Index Fund", "Fund"),
  s("0P0001BALY.BO", "Bandhan Nifty 50 Index Fund", "Fund"),
];

describe("nameTokens", () => {
  it("strips corporate boilerplate but keeps identity words", () => {
    expect(nameTokens("Reliance, Inc.")).toEqual(new Set(["reliance"]));
    expect(nameTokens("Reliance Industries Limited")).toEqual(new Set(["reliance", "industries"]));
    expect(nameTokens("The Coca-Cola Company")).toEqual(new Set(["coca", "cola"]));
  });

  it("keeps & and ^ inside tokens", () => {
    expect(nameTokens("S&P 500 INDEX")).toEqual(new Set(["s&p", "500", "index"]));
  });
});

describe("rankCandidates — audit regression cases", () => {
  it("'Reliance' is AMBIGUOUS (Reliance, Inc. vs Reliance Industries), never a silent steel-company pick", () => {
    const r = rankCandidates("Reliance", RELIANCE);
    expect(r).not.toBeNull();
    expect(r!.resolution).toBe("ambiguous");
    // Both readings are surfaced so the confirm copy can name them.
    const offered = [r!.symbol, r!.alternative?.symbol];
    expect(offered).toContain("RS");
    expect(offered).toContain("RELIANCE.NS");
  });

  it("'Reliance Industries' resolves STRONG to the Indian listing", () => {
    const r = rankCandidates("Reliance Industries", RELIANCE);
    expect(r?.symbol).toBe("RELIANCE.NS");
    expect(r?.resolution).toBe("strong");
  });

  it("'dollar-rupee exchange rate' resolves to NOTHING (never Canadian Dollar futures)", () => {
    expect(rankCandidates("dollar-rupee exchange rate", DOLLAR_RUPEE)).toBeNull();
  });

  it("'USD/INR' resolves STRONG to the currency pair", () => {
    const r = rankCandidates("USD/INR", USDINR);
    expect(r?.symbol).toBe("INR=X");
    expect(r?.resolution).not.toBe("ambiguous");
  });

  it("'S&P 500 index' resolves to the index, never a futures contract", () => {
    const r = rankCandidates("S&P 500 index", SP500);
    expect(r?.symbol).toBe("^SPX");
    expect(r?.resolution).toBe("strong");
  });

  it("'Blorptech Industries' (fictitious) resolves to NOTHING — a generic shared word like 'Industries' is not a match", () => {
    expect(rankCandidates("Blorptech Industries", BLORPTECH)).toBeNull();
  });

  it("'HDFC Bank' is one company with many listings — not ambiguous; the first (home) listing wins", () => {
    const r = rankCandidates("HDFC Bank", HDFC);
    expect(r?.symbol).toBe("HDFCBANK.NS");
    expect(r?.resolution).toBe("strong");
  });

  it("bare 'Apple' is ambiguous against the real namesake Apple International Co. — confirm, don't auto-fire", () => {
    const r = rankCandidates("Apple", APPLE);
    expect(r?.symbol).toBe("AAPL");
    expect(r?.resolution).toBe("ambiguous");
  });

  it("the full official name 'Apple Inc.' suppresses namesake rivals — STRONG (the model's expansion path)", () => {
    const r = rankCandidates("Apple Inc.", APPLE);
    expect(r?.symbol).toBe("AAPL");
    expect(r?.resolution).toBe("strong");
  });

  it("'Tesla' resolves STRONG to Tesla, Inc.", () => {
    const r = rankCandidates("Tesla", TESLA);
    expect(r?.symbol).toBe("TSLA");
    expect(r?.resolution).toBe("strong");
  });

  it("'Nifty 50' resolves to the index — index funds wrapping its name are derived products, not rivals", () => {
    const r = rankCandidates("Nifty 50", NIFTY);
    expect(r?.symbol).toBe("^NSEI");
    expect(r?.resolution).toBe("strong");
  });

  it("plain 'S&P 500' also prefers the index over tracker funds", () => {
    const r = rankCandidates("S&P 500", SP500);
    expect(r?.symbol).toBe("^SPX");
    expect(r?.resolution).toBe("strong");
  });

  it("'Google' does NOT name-match Alphabet — the model's canonical-name expansion is the path for brand aliases", () => {
    // The Kurv/VIX products contain "Google" but are different instruments
    // with extra identity tokens; nothing here is a trustworthy match.
    expect(rankCandidates("Google", GOOGLE)).toBeNull();
  });
});

describe("rankCandidates — ticker mentions", () => {
  it("a typed full ticker is EXACT regardless of case", () => {
    expect(rankCandidates("tsla", TESLA)?.resolution).toBe("exact");
    expect(rankCandidates("TSLA", TESLA)?.symbol).toBe("TSLA");
  });

  it("an all-caps mention matches a listing's suffix-less base (RELIANCE → RELIANCE.NS)", () => {
    const r = rankCandidates("RELIANCE", RELIANCE);
    expect(r?.symbol).toBe("RELIANCE.NS");
    expect(r?.resolution).toBe("exact");
  });

  it("a name-cased mention does NOT get ticker treatment ('Reliance' stays ambiguous)", () => {
    expect(rankCandidates("Reliance", RELIANCE)?.resolution).toBe("ambiguous");
  });

  it("dot/dash listing variants match (BRK.B ↔ BRK-B)", () => {
    const berkshire = [s("BRK-B", "Berkshire Hathaway Inc.")];
    expect(rankCandidates("BRK.B", berkshire)?.resolution).toBe("exact");
  });
});

describe("rankCandidates — derivatives are opt-in", () => {
  it("futures never qualify for a plain mention, even as the only candidates", () => {
    expect(rankCandidates("S&P 500", [s("ES=F", "E-Mini S&P 500 Sep 26", "Futures")])).toBeNull();
  });

  it("a mention that asks for futures allows them", () => {
    const r = rankCandidates("S&P 500 futures", [s("ES=F", "E-Mini S&P 500 Sep 26", "Futures")]);
    expect(r?.symbol).toBe("ES=F");
  });

  it("allowDerivatives option opens them explicitly", () => {
    const r = rankCandidates("E-Mini S&P 500", [s("ES=F", "E-Mini S&P 500 Sep 26", "Futures")], { allowDerivatives: true });
    expect(r?.symbol).toBe("ES=F");
  });
});

describe("rankCandidates — degenerate input", () => {
  it("empty or all-boilerplate mentions resolve to nothing", () => {
    expect(rankCandidates("", APPLE)).toBeNull();
    expect(rankCandidates("the company inc", APPLE)).toBeNull();
  });

  it("no candidates resolves to nothing", () => {
    expect(rankCandidates("Apple", [])).toBeNull();
  });
});
