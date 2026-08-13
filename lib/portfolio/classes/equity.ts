import { registerClass } from "../model/adapter";
import { marketValuation, yieldIncome, measuredBeta, fundamentalScore, riskModelFor } from "./market-base";
import type { PortfolioClassAdapter } from "../model/adapter";

export const equityAdapter: PortfolioClassAdapter = {
  id: "equity",
  valuationMode: "market",
  defaultLiquidity: "t0",
  unit: "shares",
  registryClass: "equity",
  manualStalenessDays: null,

  value: marketValuation,
  income: (raw, val, ctx) => yieldIncome(raw, val, ctx, "dividend"),

  /**
   * Measured beta plus the sector's own loadings, as before — and now the currency
   * exposure a foreign listing actually carries.
   *
   * A US-listed ADR is priced in dollars but earns in yen, won or new Taiwan
   * dollars: its dollar price mechanically absorbs the currency move, which is why
   * TSM's ADR fell ~62% in 2008 while its Taipei listing fell ~45%. The model had
   * no `usd` loading for any foreign company, so a book that was 24% non-US
   * registered zero currency risk in a dollar-rally scenario. See FX_PASS_THROUGH
   * in reference/risk-models.ts for the coefficients and why they are below 1.0.
   *
   * A gold or silver miner additionally gets levered bullion exposure: its margin
   * moves faster than the metal, and equity beta alone does not see that at all.
   */
  factors(raw, ctx) {
    return riskModelFor(raw, ctx).factors;
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      peRatio: f?.peRatio ?? null,
      priceToBook: f?.priceToBook ?? null,
      returnOnEquity: f?.returnOnEquity ?? null,
      revenueGrowth: f?.revenueGrowth ?? null,
      operatingMargins: f?.operatingMargins ?? null,
      debtToEquity: f?.debtToEquity ?? null,
      dividendYield: f?.dividendYield ?? null,
      marketCap: f?.marketCap ?? null,
      beta: measuredBeta(raw.symbol, ctx) ?? f?.beta ?? null,
    };
  },

  attributes(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      sector: f?.sector ?? null,
      industry: f?.industry ?? null,
      geography: f?.country ?? null,
      // The geography CONCEPT for a single name is the issuer's country per the
      // provider's profile (HQ/domicile — Yahoo has no revenue-split feed), and
      // the drill-down states that rather than letting "MELI → Uruguay" or
      // "CRDO → Cayman Islands" look like data errors.
      geographyBasis: f?.country
        ? "Issuer country from the provider's company profile (headquarters/domicile, not revenue split)"
        : "Provider profile has no country for this listing",
      currency: f?.currency ?? raw.currency,
      riskModel: riskModelFor(raw, ctx).label,
    };
  },

  score(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return fundamentalScore(f, [
      { key: "returnOnEquity",   weight: 0.25, worst: 0,    best: 0.30, label: "return on equity" },
      { key: "revenueGrowth",    weight: 0.20, worst: -0.10, best: 0.30, label: "revenue growth" },
      { key: "operatingMargins", weight: 0.20, worst: 0,    best: 0.30, label: "operating margin" },
      // Lower is better → worst/best inverted.
      { key: "peRatio",          weight: 0.20, worst: 45,   best: 8,    label: "valuation" },
      { key: "debtToEquity",     weight: 0.15, worst: 250,  best: 20,   label: "balance sheet" },
    ]);
  },

  row: {
    primary: ["peRatio", "returnOnEquity", "revenueGrowth"],
    secondary: ["operatingMargins", "debtToEquity", "dividendYield", "beta"],
  },
};

registerClass(equityAdapter);
