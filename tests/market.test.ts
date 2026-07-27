import { describe, expect, it } from "vitest";
import { countryForSuggestion } from "@/lib/market";

describe("countryForSuggestion", () => {
  it("defaults suffix-less tickers to US", () => {
    expect(countryForSuggestion("AAPL")).toEqual({ code: "US", flag: "🇺🇸" });
    expect(countryForSuggestion("MSFT", "EQUITY")).toEqual({ code: "US", flag: "🇺🇸" });
  });

  it("resolves country from a known ticker suffix", () => {
    expect(countryForSuggestion("RELIANCE.NS")).toEqual({ code: "IN", flag: "🇮🇳" });
    expect(countryForSuggestion("RELIANCE.BO")).toEqual({ code: "IN", flag: "🇮🇳" });
    expect(countryForSuggestion("BMW.DE")).toEqual({ code: "DE", flag: "🇩🇪" });
    expect(countryForSuggestion("7203.T")).toEqual({ code: "JP", flag: "🇯🇵" });
    expect(countryForSuggestion("0700.HK")).toEqual({ code: "HK", flag: "🇭🇰" });
    expect(countryForSuggestion("SHOP.TO")).toEqual({ code: "CA", flag: "🇨🇦" });
    expect(countryForSuggestion("BP.L")).toEqual({ code: "GB", flag: "🇬🇧" });
  });

  it("falls back to US for an unrecognized suffix rather than guessing wrong", () => {
    expect(countryForSuggestion("BRK.B")).toEqual({ code: "US", flag: "🇺🇸" });
  });

  it("returns null for instruments not tied to one country", () => {
    expect(countryForSuggestion("BTC-USD", "CRYPTOCURRENCY")).toBeNull();
    expect(countryForSuggestion("EURUSD=X", "CURRENCY")).toBeNull();
    expect(countryForSuggestion("^GSPC", "INDEX")).toBeNull();
  });
});
