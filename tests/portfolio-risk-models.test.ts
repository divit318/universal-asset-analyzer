/**
 * The risk-model catalogue — one instrument, one model, and the model must match
 * the economics.
 *
 * WHAT THIS PINS DOWN. Every asset the app supports is classified from PROVIDER
 * SIGNALS, and the signals below are the real ones: every `category`, `bondWeight`,
 * `cashWeight`, `otherWeight` and quoteType in this file was read off Yahoo on
 * 2026-07-29 for that exact ticker. That matters, because the bug this replaces was
 * not a wrong coefficient — it was classifying on a field whose presence means
 * nothing (`bondHoldings.duration` exists for VXUS, an equity fund, and is absent
 * for VCLT, a corporate bond fund).
 *
 * The second half asserts the ECONOMICS rather than the mapping: gold rises in a
 * crisis, Treasuries rally, a T-bill fund does nothing, TIPS gain when inflation
 * outruns the policy response, high yield falls with equities, an energy fund
 * responds to oil, an international fund responds to the dollar. A model that
 * classifies correctly and still gets those backwards is not fixed.
 */
import { describe, expect, it } from "vitest";
import {
  RISK_MODELS,
  currencyPairLegs,
  isBondCategory,
  resolveAssetClass,
  resolveFactors,
  resolveRiskModel,
  type InstrumentSignals,
  type RiskModelId,
} from "@/lib/portfolio/classes/reference/risk-models";
import { applyShocks, getScenario, SCENARIOS } from "@/lib/portfolio/engines/scenario";
import type { FactorSensitivities, Holding, PortfolioAssetClass } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Real provider signals, per instrument                                       */
/* -------------------------------------------------------------------------- */

interface Case {
  sym: string;
  name: string;
  /** How the buy flow would store it — deliberately the WRONG-looking class for funds. */
  stored: PortfolioAssetClass;
  quoteType: string;
  /** Yahoo fundProfile.categoryName, verbatim. */
  category?: string | null;
  bondWeight?: number | null;
  equityWeight?: number | null;
  cashWeight?: number | null;
  otherWeight?: number | null;
  topSector?: string | null;
  topSectorWeight?: number | null;
  sector?: string | null;
  industry?: string | null;
  country?: string | null;
  currency?: string;
  expect: RiskModelId;
}

const CASES: Case[] = [
  /* ---- US broad equity funds ---- */
  { sym: "VOO", name: "Vanguard S&P 500 ETF", stored: "etf", quoteType: "ETF", category: "Large Blend", equityWeight: 99.57, bondWeight: 0, topSector: "Technology", topSectorWeight: 38.6, expect: "fund_equity_us_broad" },
  { sym: "QQQ", name: "Invesco QQQ Trust", stored: "etf", quoteType: "ETF", category: "Large Growth", equityWeight: 99.81, bondWeight: 0, topSector: "Technology", topSectorWeight: 60.9, expect: "fund_equity_us_broad" },
  { sym: "SCHD", name: "Schwab US Dividend Equity ETF", stored: "etf", quoteType: "ETF", category: "Large Value", equityWeight: 99.9, bondWeight: 0, expect: "fund_equity_us_broad" },

  /* ---- International equity funds: the VXUS bug ---- */
  { sym: "VXUS", name: "Vanguard Total International Stock ETF", stored: "etf", quoteType: "ETF", category: "Foreign Large Blend", equityWeight: 97.26, bondWeight: 0, topSector: "Technology", topSectorWeight: 22.6, expect: "fund_equity_developed_ex_us" },
  { sym: "EFA", name: "iShares MSCI EAFE ETF", stored: "etf", quoteType: "ETF", category: "Foreign Large Blend", equityWeight: 99.33, expect: "fund_equity_developed_ex_us" },
  { sym: "VWO", name: "Vanguard FTSE Emerging Markets ETF", stored: "etf", quoteType: "ETF", category: "Diversified Emerging Mkts", equityWeight: 95.49, expect: "fund_equity_em" },

  /* ---- Sector equity funds ---- */
  { sym: "XLE", name: "Energy Select Sector SPDR Fund", stored: "etf", quoteType: "ETF", category: "Equity Energy", equityWeight: 99.84, topSector: "Energy", topSectorWeight: 100, expect: "fund_equity_sector" },
  { sym: "XLK", name: "Technology Select Sector SPDR Fund", stored: "etf", quoteType: "ETF", category: "Technology", equityWeight: 99.94, topSector: "Technology", topSectorWeight: 99.1, expect: "fund_equity_sector" },
  { sym: "XLU", name: "Utilities Select Sector SPDR Fund", stored: "etf", quoteType: "ETF", category: "Utilities", equityWeight: 99.75, topSector: "Utilities", topSectorWeight: 100, expect: "fund_equity_sector" },

  /* ---- REITs: fund and single name ---- */
  { sym: "VNQ", name: "Vanguard Real Estate ETF", stored: "etf", quoteType: "ETF", category: "Real Estate", equityWeight: 98.78, topSector: "Real Estate", topSectorWeight: 99.5, expect: "reit" },
  { sym: "SCHH", name: "Schwab US REIT ETF", stored: "etf", quoteType: "ETF", category: "Real Estate", equityWeight: 99.9, expect: "reit" },
  { sym: "O", name: "Realty Income", stored: "reit", quoteType: "EQUITY", sector: "Real Estate", country: "United States", expect: "reit" },

  /* ---- Government bonds ---- */
  { sym: "SHY", name: "iShares 1-3 Year Treasury Bond ETF", stored: "bond", quoteType: "ETF", category: "Short Government", bondWeight: 99.34, expect: "bond_treasury_short" },
  { sym: "GOVT", name: "iShares US Treasury Bond ETF", stored: "bond", quoteType: "ETF", category: "Intermediate Government", bondWeight: 99.52, expect: "bond_treasury_intermediate" },
  { sym: "IEF", name: "iShares 7-10 Year Treasury Bond ETF", stored: "bond", quoteType: "ETF", category: "Long Government", bondWeight: 99.66, expect: "bond_treasury_long" },
  { sym: "TLT", name: "iShares 20+ Year Treasury Bond ETF", stored: "etf", quoteType: "ETF", category: "Long Government", bondWeight: 99.63, expect: "bond_treasury_long" },

  /* ---- Credit: the VCLT bug ---- */
  { sym: "BND", name: "Vanguard Total Bond Market ETF", stored: "etf", quoteType: "ETF", category: "Intermediate Core Bond", bondWeight: 98.62, expect: "bond_aggregate" },
  { sym: "LQD", name: "iShares iBoxx $ Investment Grade Corporate Bond ETF", stored: "etf", quoteType: "ETF", category: "Corporate Bond", bondWeight: 98.61, expect: "bond_corporate_ig" },
  { sym: "VCIT", name: "Vanguard Intermediate-Term Corporate Bond ETF", stored: "etf", quoteType: "ETF", category: "Corporate Bond", bondWeight: 99.86, expect: "bond_corporate_ig" },
  { sym: "VCLT", name: "Vanguard Long-Term Corporate Bond Index Fund ETF Shares", stored: "etf", quoteType: "ETF", category: "Long-Term Bond", bondWeight: 99.43, expect: "bond_corporate_long" },
  { sym: "HYG", name: "iShares iBoxx $ High Yield Corporate Bond ETF", stored: "etf", quoteType: "ETF", category: "High Yield Bond", bondWeight: 99.44, topSector: "Utilities", topSectorWeight: 99.6, expect: "bond_high_yield" },
  { sym: "SPHY", name: "State Street SPDR Portfolio High Yield Bond ETF", stored: "etf", quoteType: "ETF", category: "High Yield Bond", bondWeight: 99.71, topSector: "Financial Services", topSectorWeight: 99.9, expect: "bond_high_yield" },
  { sym: "EMB", name: "iShares JP Morgan USD Emerging Markets Bond ETF", stored: "etf", quoteType: "ETF", category: "Emerging Markets Bond", bondWeight: 98.75, expect: "bond_em" },
  { sym: "BNDX", name: "Vanguard Total International Bond ETF", stored: "etf", quoteType: "ETF", category: "Global Bond-USD Hedged", bondWeight: 98.34, topSector: "Technology", topSectorWeight: 100, expect: "bond_global_hedged" },

  /* ---- Municipals ---- */
  { sym: "MUB", name: "iShares National Muni Bond ETF", stored: "etf", quoteType: "ETF", category: "Muni National Interm", bondWeight: 99.24, expect: "bond_muni" },
  { sym: "TFI", name: "SPDR Nuveen Bloomberg Municipal Bond ETF", stored: "etf", quoteType: "ETF", category: "Muni National Long", bondWeight: 99.86, expect: "bond_muni_long" },

  /* ---- Inflation-protected ---- */
  { sym: "TIP", name: "iShares TIPS Bond ETF", stored: "etf", quoteType: "ETF", category: "Inflation-Protected Bond", bondWeight: 98.97, expect: "bond_tips" },
  { sym: "VTIP", name: "Vanguard Short-Term Inflation-Protected Securities ETF", stored: "etf", quoteType: "ETF", category: "Short-Term Inflation-Protected Bond", bondWeight: 95.17, expect: "bond_tips_short" },

  /* ---- Cash-like and floating rate: all filed as "Ultrashort Bond" ---- */
  { sym: "BIL", name: "SPDR Bloomberg 1-3 Month T-Bill ETF", stored: "etf", quoteType: "ETF", category: "Ultrashort Bond", bondWeight: 0, cashWeight: 100, expect: "cash_equivalent" },
  { sym: "SGOV", name: "iShares 0-3 Month Treasury Bond ETF", stored: "etf", quoteType: "ETF", category: "Ultrashort Bond", bondWeight: 5.01, cashWeight: 94.99, expect: "cash_equivalent" },
  { sym: "USFR", name: "WisdomTree Floating Rate Treasury Fund", stored: "bond", quoteType: "ETF", category: "Ultrashort Bond", bondWeight: 100, expect: "cash_equivalent" },
  { sym: "FLOT", name: "iShares Floating Rate Bond ETF", stored: "etf", quoteType: "ETF", category: "Ultrashort Bond", bondWeight: 94.61, expect: "bond_floating_rate" },
  { sym: "SPAXX", name: "Fidelity Government Money Market Fund", stored: "etf", quoteType: "MONEYMARKET", expect: "cash_equivalent" },
  { sym: "VMFXX", name: "Vanguard Federal Money Market Fund", stored: "equity", quoteType: "MONEYMARKET", expect: "cash_equivalent" },

  /* ---- Commodity funds: none of them hold stocks or bonds ---- */
  { sym: "GLD", name: "SPDR Gold Shares", stored: "etf", quoteType: "ETF", category: "Commodities Focused", bondWeight: 0, equityWeight: 0, otherWeight: 100, expect: "commodity_gold" },
  { sym: "IAU", name: "iShares Gold Trust", stored: "etf", quoteType: "ETF", category: "Commodities Focused", otherWeight: 100, expect: "commodity_gold" },
  { sym: "SLV", name: "iShares Silver Trust", stored: "etf", quoteType: "ETF", category: "Commodities Focused", otherWeight: 100, expect: "commodity_silver" },
  { sym: "USO", name: "United States Oil Fund LP", stored: "etf", quoteType: "ETF", category: "Commodities Focused", cashWeight: 57, otherWeight: 43, expect: "commodity_oil" },
  { sym: "UNG", name: "United States Natural Gas Fund LP", stored: "etf", quoteType: "ETF", category: "Commodities Focused", expect: "commodity_natural_gas" },
  { sym: "CPER", name: "United States Copper Index Fund", stored: "etf", quoteType: "ETF", category: "Commodities Focused", otherWeight: 50, expect: "commodity_copper" },
  { sym: "DBA", name: "Invesco DB Agriculture Fund", stored: "etf", quoteType: "ETF", category: "Commodities Focused", cashWeight: 48, otherWeight: 50, topSector: "Healthcare", topSectorWeight: 16.8, expect: "commodity_agriculture" },
  { sym: "DBC", name: "Invesco DB Commodity Index Tracking Fund", stored: "etf", quoteType: "ETF", category: "Commodities Broad Basket", cashWeight: 48, otherWeight: 47, bondWeight: 3.1, expect: "commodity_broad" },
  { sym: "GC=F", name: "Gold Futures", stored: "commodity", quoteType: "FUTURE", expect: "commodity_gold" },

  /* ---- Crypto ---- */
  { sym: "BTC-USD", name: "Bitcoin USD", stored: "crypto", quoteType: "CRYPTOCURRENCY", expect: "crypto_major" },
  { sym: "ETH-USD", name: "Ethereum USD", stored: "crypto", quoteType: "CRYPTOCURRENCY", expect: "crypto_alt" },
  { sym: "USDC-USD", name: "USD Coin", stored: "crypto", quoteType: "CRYPTOCURRENCY", expect: "crypto_stablecoin" },
  { sym: "USDT-USD", name: "Tether USDt", stored: "crypto", quoteType: "CRYPTOCURRENCY", expect: "crypto_stablecoin" },

  /* ---- Currency pairs ---- */
  { sym: "EURUSD=X", name: "EUR/USD", stored: "forex", quoteType: "CURRENCY", expect: "fx_short_base" },
  { sym: "USDCHF=X", name: "USD/CHF", stored: "forex", quoteType: "CURRENCY", expect: "fx_long_base" },
  { sym: "EURJPY=X", name: "EUR/JPY", stored: "forex", quoteType: "CURRENCY", expect: "fx_cross" },

  /* ---- Single equities, by domicile ---- */
  { sym: "AAPL", name: "Apple Inc.", stored: "equity", quoteType: "EQUITY", sector: "Technology", industry: "Consumer Electronics", country: "United States", expect: "equity_us" },
  { sym: "TM", name: "Toyota Motor Corporation", stored: "equity", quoteType: "EQUITY", sector: "Consumer Discretionary", industry: "Auto Manufacturers", country: "Japan", expect: "equity_developed_ex_us" },
  { sym: "TSM", name: "Taiwan Semiconductor Manufacturing", stored: "equity", quoteType: "EQUITY", sector: "Technology", industry: "Semiconductors", country: "Taiwan", expect: "equity_em" },
  { sym: "KB", name: "KB Financial Group Inc.", stored: "equity", quoteType: "EQUITY", sector: "Financials", industry: "Banks—Regional", country: "South Korea", expect: "equity_em" },
  { sym: "XOM", name: "Exxon Mobil", stored: "equity", quoteType: "EQUITY", sector: "Energy", industry: "Oil & Gas Integrated", country: "United States", expect: "equity_us" },

  /* ---- Gold miners: the name gives one away, the industry gives both ---- */
  { sym: "NEM", name: "Newmont Corporation", stored: "equity", quoteType: "EQUITY", sector: "Basic Materials", industry: "Gold", country: "United States", expect: "equity_gold_miner" },
  { sym: "ORLA", name: "Orla Mining Ltd.", stored: "equity", quoteType: "EQUITY", sector: "Basic Materials", industry: "Gold", country: "Canada", expect: "equity_gold_miner" },
];

function signalsOf(c: Case): InstrumentSignals {
  return {
    symbol: c.sym,
    name: c.name,
    assetClass: c.stored,
    quoteAssetType: c.quoteType,
    fundCategory: c.category ?? null,
    bondWeight: c.bondWeight ?? null,
    equityWeight: c.equityWeight ?? null,
    cashWeight: c.cashWeight ?? null,
    otherWeight: c.otherWeight ?? null,
    topSector: c.topSector ?? null,
    topSectorWeight: c.topSectorWeight ?? null,
    sector: c.sector ?? null,
    industry: c.industry ?? null,
    country: c.country ?? null,
    currency: c.currency ?? "USD",
    baseCurrency: "USD",
  };
}

/** Factors as they would be built with no measurable history (reference path). */
const referenceFactors = (c: Case): FactorSensitivities => resolveFactors(signalsOf(c)).factors;

/* -------------------------------------------------------------------------- */
/* 1. Classification                                                           */
/* -------------------------------------------------------------------------- */

describe("instrument → risk model", () => {
  for (const c of CASES) {
    it(`${c.sym} (${c.category ?? c.quoteType}) → ${c.expect}`, () => {
      const res = resolveRiskModel(signalsOf(c));
      expect(res.model.id, res.evidence.join(" | ")).toBe(c.expect);
      // Every classification must explain itself.
      expect(res.evidence.length).toBeGreaterThan(0);
    });
  }

  it("covers every model in the catalogue with at least a definition and a note", () => {
    for (const [id, def] of Object.entries(RISK_MODELS)) {
      expect(def.id, `${id} id mismatch`).toBe(id);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.notes.length, `${id} has no rationale`).toBeGreaterThan(20);
    }
  });

  it("stays in sync with the screener's definition of a bond category", () => {
    expect(isBondCategory("Long-Term Bond")).toBe(true);
    expect(isBondCategory("High Yield Bond")).toBe(true);
    expect(isBondCategory("Foreign Large Blend")).toBe(false);
    expect(isBondCategory(null)).toBe(false);
  });

  it("parses currency pairs, and only currency pairs", () => {
    expect(currencyPairLegs("EURUSD=X")).toEqual({ base: "EUR", quote: "USD" });
    expect(currencyPairLegs("USDCHF=X")).toEqual({ base: "USD", quote: "CHF" });
    expect(currencyPairLegs("AAPL")).toBeNull();
    expect(currencyPairLegs("BTC-USD")).toBeNull();
    expect(currencyPairLegs(null)).toBeNull();
  });

  /* ---- Yahoo's short FX form: the dollar leg is implied, and is the BASE ---- */

  it("parses every accepted FX representation to one canonical form", () => {
    // Explicit six-letter form — unchanged.
    expect(currencyPairLegs("USDJPY=X")).toEqual({ base: "USD", quote: "JPY" });
    expect(currencyPairLegs("EURUSD=X")).toEqual({ base: "EUR", quote: "USD" });
    expect(currencyPairLegs("USDCHF=X")).toEqual({ base: "USD", quote: "CHF" });
    expect(currencyPairLegs("EURJPY=X")).toEqual({ base: "EUR", quote: "JPY" });
    // Short three-letter form — `XXX=X` means USD/XXX, so USD is the base leg.
    expect(currencyPairLegs("JPY=X")).toEqual({ base: "USD", quote: "JPY" });
    expect(currencyPairLegs("GBP=X")).toEqual({ base: "USD", quote: "GBP" });
    expect(currencyPairLegs("CHF=X")).toEqual({ base: "USD", quote: "CHF" });
    expect(currencyPairLegs("CAD=X")).toEqual({ base: "USD", quote: "CAD" });
    expect(currencyPairLegs("AUD=X")).toEqual({ base: "USD", quote: "AUD" });
    // Case and surrounding whitespace are normalized, as before.
    expect(currencyPairLegs("jpy=x")).toEqual({ base: "USD", quote: "JPY" });
    expect(currencyPairLegs("  usdchf=x  ")).toEqual({ base: "USD", quote: "CHF" });
    // Still not pairs.
    expect(currencyPairLegs("USD=X")).toBeNull();   // would imply USD/USD
    expect(currencyPairLegs("AAPL")).toBeNull();
    expect(currencyPairLegs("BTC-USD")).toBeNull();
    expect(currencyPairLegs("JP=X")).toBeNull();
    expect(currencyPairLegs("JPYY=X")).toBeNull();
    expect(currencyPairLegs("JPY=Y")).toBeNull();
    expect(currencyPairLegs("JPY")).toBeNull();
    expect(currencyPairLegs("")).toBeNull();
    expect(currencyPairLegs(null)).toBeNull();
  });

  it("the short form is LONG the dollar, like its six-letter twin", () => {
    // The bug: JPY=X fell through to foreign-currency cash, loading usd -1 — the
    // sign for holding yen, and the inverse of holding a USD/JPY pair.
    const short = resolveFactors({ symbol: "JPY=X", name: "USD/JPY", assetClass: "forex", quoteAssetType: "CURRENCY", currency: "JPY", baseCurrency: "USD" });
    expect(short.modelId).toBe("fx_long_base");
    expect(short.factors.usd).toBe(1);
    expect(short.factors.inflation).toBeUndefined();
  });

  it("both representations of one pair produce byte-identical calculations", () => {
    const of = (symbol: string) =>
      resolveFactors({ symbol, name: "USD/JPY", assetClass: "forex", quoteAssetType: "CURRENCY", currency: "JPY", baseCurrency: "USD" });
    const a = of("JPY=X");
    const b = of("USDJPY=X");

    expect(a.modelId).toBe(b.modelId);
    expect(a.label).toBe(b.label);
    expect(a.duration).toBe(b.duration);
    expect(JSON.stringify(a.factors)).toBe(JSON.stringify(b.factors));
    expect(resolveAssetClass({ symbol: "JPY=X", name: "", assetClass: "forex", quoteAssetType: "CURRENCY", currency: "JPY", baseCurrency: "USD" }))
      .toBe(resolveAssetClass({ symbol: "USDJPY=X", name: "", assetClass: "forex", quoteAssetType: "CURRENCY", currency: "JPY", baseCurrency: "USD" }));

    // Whole-object identity, once the echoed symbol is normalized out of the
    // evidence strings — the evidence names the ticker the user actually typed,
    // which is the only thing that may legitimately differ.
    const norm = (r: typeof a, sym: string) => JSON.stringify(r).split(sym).join("<SYM>");
    expect(norm(a, "JPY=X")).toBe(norm(b, "USDJPY=X"));

    // And the calculation that the bug corrupted: every modelled scenario.
    const holdingFrom = (symbol: string): Holding => ({
      id: symbol, assetClass: "forex", symbol, name: "USD/JPY", currency: "USD",
      quantity: 100_000, unit: "units", costBasis: 100_000, costBasisBase: 100_000,
      acquiredAt: "2025-01-02",
      valuation: { mode: "market", value: 100_000, valueBase: 100_000, fxRate: 1, source: "yahoo", asOf: "", stale: false },
      weight: 100, unrealizedPL: 0, unrealizedPct: 0, liquidity: "t0", income: null,
      factors: of(symbol).factors, metrics: {}, attributes: {}, score: null, meta: {},
    });
    const hShort = holdingFrom("JPY=X");
    const hLong = holdingFrom("USDJPY=X");
    // Every field except the echoed id/symbol, which name the ticker the user typed.
    const calc = (i: ReturnType<typeof applyShocks>) =>
      JSON.stringify({ impactPct: i.impactPct, impactValue: i.impactValue, drivers: i.drivers });
    for (const s of SCENARIOS) {
      expect(calc(applyShocks(hShort, s.shocks)), `${s.id} differs between JPY=X and USDJPY=X`)
        .toBe(calc(applyShocks(hLong, s.shocks)));
    }
    // The specific number from the audit: a dollar rally is a GAIN, not a 13% loss.
    const usdUp = getScenario("usd_strength")!;
    expect(applyShocks(hShort, usdUp.shocks).impactPct).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The two reported bugs, pinned                                            */
/* -------------------------------------------------------------------------- */

describe("the reported mis-classifications", () => {
  const vclt = CASES.find((c) => c.sym === "VCLT")!;
  const vxus = CASES.find((c) => c.sym === "VXUS")!;

  it("VCLT is a long corporate bond fund: real duration and real spread risk", () => {
    const f = referenceFactors(vclt);
    // Was `{ equityBeta: 0.25 }` — no rate exposure and no credit exposure at all.
    expect(f.rates!).toBeLessThan(-7);
    expect(f.creditSpread!).toBeLessThan(-2);
    expect(f.equityBeta!).toBeGreaterThan(0);
    expect(f.equityBeta!).toBeLessThan(0.6);
  });

  it("VCLT keeps its duration even though the provider reports none for it", () => {
    // Yahoo returns no bondHoldings.duration for VCLT, which is exactly why the old
    // `if (duration != null)` test failed to recognise it as a bond fund.
    const f = resolveFactors(signalsOf(vclt), { providerDuration: null }).factors;
    expect(f.rates!).toBeLessThan(-7);
  });

  it("VXUS is an equity fund: no duration, no credit, real currency exposure", () => {
    // Provider hands us duration 4.48 for this equity fund. It must be ignored.
    const f = resolveFactors(signalsOf(vxus), { providerDuration: 4.48, measuredDuration: null }).factors;
    expect(f.rates).toBeUndefined();
    expect(f.creditSpread).toBeUndefined();
    expect(f.usd!).toBeLessThan(0);
    expect(f.equityBeta!).toBeGreaterThan(0.5);
  });

  it("ignores the provider's duration for every instrument that is not a bond", () => {
    for (const c of CASES) {
      const model = RISK_MODELS[c.expect];
      if (model.kind === "bond") continue;
      const f = resolveFactors(signalsOf(c), { providerDuration: 4.48 }).factors;
      expect(f.rates == null || Math.abs(f.rates) !== 4.48, `${c.sym} inherited a bond duration`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Measurement precedence and plausibility                                  */
/* -------------------------------------------------------------------------- */

describe("measured vs reference, and the plausibility gates", () => {
  const tlt = CASES.find((c) => c.sym === "TLT")!;
  const ief = CASES.find((c) => c.sym === "IEF")!;

  it("separates TLT from IEF using the MEASURED duration — the category cannot", () => {
    // Yahoo files both as "Long Government" and reports duration 3.55 / 4.19.
    expect(resolveRiskModel(signalsOf(tlt)).model.id).toBe(resolveRiskModel(signalsOf(ief)).model.id);

    const long = resolveFactors(signalsOf(tlt), { measuredDuration: 16.1 });
    const mid = resolveFactors(signalsOf(ief), { measuredDuration: 7.1 });
    expect(long.duration).toBe(16.1);
    expect(mid.duration).toBe(7.1);
    expect(long.factors.rates!).toBeLessThan(mid.factors.rates!);
  });

  it("rejects a measured duration that is implausible for the model", () => {
    // 3.88 years for a floating-rate fund (what the provider claims for USFR).
    const usfr = CASES.find((c) => c.sym === "USFR")!;
    const r = resolveFactors(signalsOf(usfr), { measuredDuration: 3.88 });
    expect(Math.abs(r.factors.rates ?? 0)).toBeLessThan(1);
    expect(r.evidence.join(" ")).toMatch(/outside the plausible band/);
  });

  it("rejects an implausible measured beta rather than propagating it", () => {
    const shy = CASES.find((c) => c.sym === "SHY")!;
    const r = resolveFactors(signalsOf(shy), { equityBeta: 2.4 });
    expect(r.factors.equityBeta ?? 0).toBeLessThan(0.6);
    expect(r.evidence.join(" ")).toMatch(/outside the plausible range/);
  });

  it("uses a plausible measured beta over the reference", () => {
    const hyg = CASES.find((c) => c.sym === "HYG")!;
    expect(resolveFactors(signalsOf(hyg), { equityBeta: 0.52 }).factors.equityBeta).toBe(0.52);
  });

  it("falls back to the provider's duration only when nothing else exists", () => {
    const unknown: InstrumentSignals = {
      symbol: "XBND", name: "Some Bond Fund", assetClass: "bond", quoteAssetType: "ETF",
      fundCategory: "Something Morningstar Invented Yesterday", bondWeight: 99, baseCurrency: "USD",
    };
    const r = resolveFactors(unknown, { providerDuration: 9.1 });
    // The position mix still identifies it as a bond fund, so the aggregate model's
    // reference duration wins over the provider — as documented.
    expect(r.duration).toBe(RISK_MODELS.bond_aggregate.referenceDuration);
    expect(r.evidence.join(" ")).toMatch(/position mix/);
  });

  it("keeps a measured duration when the CATEGORY lookup failed — same holding, same answer", () => {
    // Live regression: SHY's fund-details call missed on one render, so the model
    // fell back to the 6.0-year aggregate bucket and its narrow band REJECTED the
    // 1.65-year measurement. The Holdings tab then showed 6.0y for a 1-3 year
    // Treasury fund, and the number moved between page loads depending on whether
    // one provider call succeeded.
    const withCategory: InstrumentSignals = {
      symbol: "SHY", name: "iShares 1-3 Year Treasury Bond ETF", assetClass: "bond",
      quoteAssetType: "ETF", fundCategory: "Short Government", bondWeight: 99.34, baseCurrency: "USD",
    };
    const noCategory: InstrumentSignals = {
      symbol: "SHY", name: "iShares 1-3 Year Treasury Bond ETF", assetClass: "bond",
      quoteAssetType: "ETF", baseCurrency: "USD",
    };

    const a = resolveFactors(withCategory, { measuredDuration: 1.65 });
    const b = resolveFactors(noCategory, { measuredDuration: 1.65 });

    expect(a.duration).toBe(1.65);
    expect(b.duration).toBe(1.65);
    expect(resolveRiskModel(noCategory).confidence).toBe("fallback");
    expect(resolveRiskModel(withCategory).confidence).toBe("declared");
  });

  it("still rejects an implausible measurement when the category IS known", () => {
    const usfr: InstrumentSignals = {
      symbol: "USFR", name: "WisdomTree Floating Rate Treasury Fund", assetClass: "bond",
      quoteAssetType: "ETF", fundCategory: "Ultrashort Bond", bondWeight: 100, baseCurrency: "USD",
    };
    expect(Math.abs(resolveFactors(usfr, { measuredDuration: 3.88 }).factors.rates ?? 0)).toBeLessThan(1);
  });

  it("multiplies every loading by the leverage a property carries", () => {
    const house: InstrumentSignals = { symbol: null, name: "Home", assetClass: "real_estate", baseCurrency: "USD" };
    const unlevered = resolveFactors(house, { leverage: 1 }).factors;
    const levered = resolveFactors(house, { leverage: 4 }).factors;
    expect(levered.realEstateCap!).toBeCloseTo(unlevered.realEstateCap! * 4, 5);
    expect(levered.rates!).toBeCloseTo(unlevered.rates! * 4, 5);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Economic behaviour under the real scenarios                              */
/* -------------------------------------------------------------------------- */

function holdingOf(c: Case, measured: Parameters<typeof resolveFactors>[1] = {}): Holding {
  const factors = resolveFactors(signalsOf(c), measured).factors;
  return {
    id: c.sym, assetClass: c.stored, symbol: c.sym, name: c.name, currency: "USD",
    quantity: 1, unit: "shares", costBasis: 100_000, costBasisBase: 100_000,
    acquiredAt: "2024-01-01",
    valuation: { mode: "market", value: 100_000, valueBase: 100_000, fxRate: 1, source: "yahoo", asOf: "2026-07-29", stale: false },
    weight: 0, unrealizedPL: null, unrealizedPct: null, liquidity: "t0", income: null,
    factors, metrics: {}, attributes: {}, score: null, meta: {},
  };
}

const impact = (sym: string, scenario: string, measured?: Parameters<typeof resolveFactors>[1]) => {
  const c = CASES.find((x) => x.sym === sym)!;
  return applyShocks(holdingOf(c, measured), getScenario(scenario)!.shocks).impactPct;
};

describe("scenario behaviour is economically reasonable", () => {
  it("2008: Treasuries rally, gold rises, T-bills are flat, credit and equities fall", () => {
    const tlt = impact("TLT", "gfc_2008", { measuredDuration: 16.1 });
    const ief = impact("IEF", "gfc_2008", { measuredDuration: 7.1 });
    const bil = impact("BIL", "gfc_2008");
    const gld = impact("GLD", "gfc_2008");
    const bnd = impact("BND", "gfc_2008", { measuredDuration: 6 });
    const lqd = impact("LQD", "gfc_2008", { measuredDuration: 8.3 });
    const vclt = impact("VCLT", "gfc_2008", { measuredDuration: 13 });
    const hyg = impact("HYG", "gfc_2008", { measuredDuration: 3.4, equityBeta: 0.45 });
    const voo = impact("VOO", "gfc_2008", { equityBeta: 1 });

    // Direction first.
    expect(tlt).toBeGreaterThan(15);
    expect(ief).toBeGreaterThan(5);
    expect(gld).toBeGreaterThan(0);
    expect(Math.abs(bil)).toBeLessThan(2);
    expect(voo).toBeLessThan(-40);

    // Then the ORDERING that makes fixed income worth holding separately: long
    // Treasuries beat short beat cash beat aggregate beat IG beat long IG beat HY
    // beat equities.
    expect(tlt).toBeGreaterThan(ief);
    expect(bnd).toBeGreaterThan(lqd);
    expect(lqd).toBeGreaterThan(vclt);
    expect(vclt).toBeGreaterThan(hyg);
    expect(hyg).toBeGreaterThan(voo);

    // And the magnitudes, against what these funds actually did in 2008.
    expect(bnd).toBeGreaterThan(-4);
    expect(bnd).toBeLessThan(12);
    expect(lqd).toBeGreaterThan(-15);
    expect(vclt).toBeGreaterThan(-22);
    expect(hyg).toBeLessThan(-12);
    expect(hyg).toBeGreaterThan(-40);
  });

  it("TIPS gain when inflation outruns the policy response, and lose in deflation", () => {
    const inflation = impact("TIP", "high_inflation", { measuredDuration: 6.5 });
    const deflation = impact("TIP", "deflation", { measuredDuration: 6.5 });
    const nominal = impact("IEF", "high_inflation", { measuredDuration: 7.1 });

    expect(inflation).toBeGreaterThan(2);
    expect(inflation).toBeGreaterThan(nominal);   // the entire point of owning TIPS
    expect(deflation).toBeLessThan(0);
  });

  it("a rate shock hits long duration hardest and cash-likes not at all", () => {
    const tlt = impact("TLT", "rate_hikes", { measuredDuration: 16.1 });
    const shy = impact("SHY", "rate_hikes", { measuredDuration: 1.8 });
    const bil = impact("BIL", "rate_hikes");
    const usfr = impact("USFR", "rate_hikes");

    expect(tlt).toBeLessThan(-30);
    expect(shy).toBeGreaterThan(-10);
    expect(Math.abs(bil)).toBeLessThan(2);
    // A floating-rate fund is not a duration fund. The provider's 3.88y would have
    // cost it ~12% here.
    expect(Math.abs(usfr)).toBeLessThan(2);
  });

  it("a credit shock separates Treasuries, IG and high yield by segment", () => {
    const ief = impact("IEF", "credit_crunch", { measuredDuration: 7.1 });
    const lqd = impact("LQD", "credit_crunch", { measuredDuration: 8.3 });
    const hyg = impact("HYG", "credit_crunch", { measuredDuration: 3.4, equityBeta: 0.45 });
    expect(ief).toBeGreaterThan(0);
    expect(lqd).toBeLessThan(0);
    expect(hyg).toBeLessThan(lqd);
  });

  it("an energy fund responds to oil; a utility fund responds to rates", () => {
    const xleOil = impact("XLE", "oil_shock", { equityBeta: 1.1 });
    const xlkOil = impact("XLK", "oil_shock", { equityBeta: 1.2 });
    expect(xleOil).toBeGreaterThan(xlkOil);   // was identical: both plain beta

    const xluCuts = impact("XLU", "rate_cuts", { equityBeta: 0.6 });
    const vooCuts = impact("VOO", "rate_cuts", { equityBeta: 1 });
    expect(xluCuts).toBeGreaterThan(vooCuts);
  });

  it("a dollar rally hurts unhedged international holdings and helps a long-dollar pair", () => {
    const vxus = impact("VXUS", "usd_strength", { equityBeta: 1.05 });
    const voo = impact("VOO", "usd_strength", { equityBeta: 1 });
    expect(vxus).toBeLessThan(voo);

    expect(impact("USDCHF=X", "usd_strength")).toBeGreaterThan(0);
    expect(impact("EURUSD=X", "usd_strength")).toBeLessThan(0);

    // A hedged foreign bond fund must NOT take the currency hit.
    const bndx = impact("BNDX", "usd_strength", { measuredDuration: 7 });
    expect(Math.abs(bndx)).toBeLessThan(6);
  });

  it("gold funds rise in a crisis while oil funds collapse", () => {
    expect(impact("GLD", "gfc_2008")).toBeGreaterThan(0);
    expect(impact("IAU", "gfc_2008")).toBeGreaterThan(0);
    expect(impact("USO", "gfc_2008")).toBeLessThan(-30);
    // A gold MINER falls with equities but is cushioned by the metal, and it is not
    // the same instrument as bullion.
    const miner = impact("NEM", "gfc_2008", { equityBeta: 0.5 });
    expect(miner).toBeLessThan(impact("GLD", "gfc_2008"));
  });

  it("a stablecoin does not lose 70% in a crypto bear market", () => {
    const btc = impact("BTC-USD", "crypto_winter");
    const usdc = impact("USDC-USD", "crypto_winter");
    expect(btc).toBeLessThan(-50);
    expect(Math.abs(usdc)).toBeLessThan(3);
    // ETH is not BTC either.
    expect(impact("ETH-USD", "crypto_winter")).toBeLessThan(btc);
  });

  it("a money-market fund behaves like cash in an equity crash, not like a stock", () => {
    expect(Math.abs(impact("SPAXX", "equity_crash"))).toBeLessThan(2);
    expect(Math.abs(impact("VMFXX", "gfc_2008"))).toBeLessThan(2);
  });

  it("a REIT fund reprices on cap rates, unlike a broad equity fund", () => {
    const vnq = impact("VNQ", "housing_crash", { equityBeta: 0.95 });
    const voo = impact("VOO", "housing_crash", { equityBeta: 1 });
    expect(vnq).toBeLessThan(voo - 10);
  });

  it("physical bullion recorded as a manual alternative rises in a crisis", () => {
    const bar: InstrumentSignals = {
      symbol: null, name: "1kg gold bar", assetClass: "alternative",
      subcategory: "Precious Metals", baseCurrency: "USD",
    };
    const watch: InstrumentSignals = {
      symbol: null, name: "Rolex Daytona (2019)", assetClass: "alternative",
      subcategory: "Watches", baseCurrency: "USD",
    };
    const gfc = getScenario("gfc_2008")!.shocks;
    const asHolding = (s: InstrumentSignals): Holding => ({
      ...holdingOf(CASES[0]),
      factors: resolveFactors(s).factors,
    });

    expect(applyShocks(asHolding(bar), gfc).impactPct).toBeGreaterThan(0);
    // A luxury collectible is discretionary-spending exposed: it falls, and by more
    // than the generic alternative model said.
    expect(applyShocks(asHolding(watch), gfc).impactPct).toBeLessThan(-5);
  });

  it("foreign-currency cash is a currency position; base-currency cash is not", () => {
    const usd = resolveFactors({ symbol: null, name: "USD Cash", assetClass: "cash", currency: "USD", baseCurrency: "USD" }).factors;
    const chf = resolveFactors({ symbol: null, name: "CHF Cash", assetClass: "cash", currency: "CHF", baseCurrency: "USD" }).factors;
    expect(usd.usd).toBeUndefined();
    expect(chf.usd!).toBeLessThan(-0.5);
    // Both still lose purchasing power to inflation.
    expect(usd.inflation!).toBeLessThan(0);
    expect(chf.inflation!).toBeLessThan(0);
  });

  it("no supported instrument is left with an empty factor vector", () => {
    for (const c of CASES) {
      const f = referenceFactors(c);
      const loadings = Object.values(f).filter((v) => v != null && v !== 0);
      expect(loadings.length, `${c.sym} has no factor exposure at all`).toBeGreaterThan(0);
    }
  });

  it("every instrument responds to at least one crisis factor", () => {
    // A holding with no loading on any 2008 factor is invisible to the stress test,
    // which is how "coverage" silently drops below 100%.
    const gfc = getScenario("gfc_2008")!.shocks;
    for (const c of CASES) {
      if (c.expect === "fx_cross") continue;   // no dollar leg; carries only a risk-on loading
      const f = referenceFactors(c);
      const responds = (Object.keys(gfc) as (keyof typeof gfc)[]).some((k) => (f[k] ?? 0) !== 0);
      expect(responds, `${c.sym} has no exposure to any 2008 factor`).toBe(true);
    }
  });
});
