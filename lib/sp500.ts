import type { Sp500Constituent } from "./types";

/**
 * A curated set of S&P 500 constituents with GICS sectors. This is a
 * representative subset (the large/mid-cap names across all 11 sectors) kept
 * static so the screener has a fixed universe without a paid index feed.
 */
export const SP500: Sp500Constituent[] = [
  // Information Technology
  { symbol: "AAPL", name: "Apple Inc.", sector: "Information Technology" },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Information Technology" },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Information Technology" },
  { symbol: "AVGO", name: "Broadcom Inc.", sector: "Information Technology" },
  { symbol: "ORCL", name: "Oracle Corp.", sector: "Information Technology" },
  { symbol: "CRM", name: "Salesforce Inc.", sector: "Information Technology" },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Information Technology" },
  { symbol: "ADBE", name: "Adobe Inc.", sector: "Information Technology" },
  { symbol: "CSCO", name: "Cisco Systems", sector: "Information Technology" },
  { symbol: "ACN", name: "Accenture plc", sector: "Information Technology" },
  { symbol: "INTC", name: "Intel Corp.", sector: "Information Technology" },
  { symbol: "QCOM", name: "Qualcomm Inc.", sector: "Information Technology" },
  { symbol: "TXN", name: "Texas Instruments", sector: "Information Technology" },
  { symbol: "IBM", name: "IBM Corp.", sector: "Information Technology" },
  { symbol: "NOW", name: "ServiceNow Inc.", sector: "Information Technology" },

  // Communication Services
  { symbol: "GOOGL", name: "Alphabet Inc. Class A", sector: "Communication Services" },
  { symbol: "META", name: "Meta Platforms Inc.", sector: "Communication Services" },
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Communication Services" },
  { symbol: "DIS", name: "Walt Disney Co.", sector: "Communication Services" },
  { symbol: "CMCSA", name: "Comcast Corp.", sector: "Communication Services" },
  { symbol: "T", name: "AT&T Inc.", sector: "Communication Services" },
  { symbol: "VZ", name: "Verizon Communications", sector: "Communication Services" },
  { symbol: "TMUS", name: "T-Mobile US Inc.", sector: "Communication Services" },

  // Consumer Discretionary
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer Discretionary" },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Consumer Discretionary" },
  { symbol: "HD", name: "Home Depot Inc.", sector: "Consumer Discretionary" },
  { symbol: "MCD", name: "McDonald's Corp.", sector: "Consumer Discretionary" },
  { symbol: "NKE", name: "Nike Inc.", sector: "Consumer Discretionary" },
  { symbol: "LOW", name: "Lowe's Companies", sector: "Consumer Discretionary" },
  { symbol: "SBUX", name: "Starbucks Corp.", sector: "Consumer Discretionary" },
  { symbol: "BKNG", name: "Booking Holdings", sector: "Consumer Discretionary" },
  { symbol: "TJX", name: "TJX Companies", sector: "Consumer Discretionary" },

  // Consumer Staples
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer Staples" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Staples" },
  { symbol: "COST", name: "Costco Wholesale", sector: "Consumer Staples" },
  { symbol: "KO", name: "Coca-Cola Co.", sector: "Consumer Staples" },
  { symbol: "PEP", name: "PepsiCo Inc.", sector: "Consumer Staples" },
  { symbol: "PM", name: "Philip Morris Intl.", sector: "Consumer Staples" },
  { symbol: "MDLZ", name: "Mondelez Intl.", sector: "Consumer Staples" },
  { symbol: "CL", name: "Colgate-Palmolive", sector: "Consumer Staples" },

  // Health Care
  { symbol: "LLY", name: "Eli Lilly & Co.", sector: "Health Care" },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Health Care" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Health Care" },
  { symbol: "MRK", name: "Merck & Co.", sector: "Health Care" },
  { symbol: "ABBV", name: "AbbVie Inc.", sector: "Health Care" },
  { symbol: "PFE", name: "Pfizer Inc.", sector: "Health Care" },
  { symbol: "TMO", name: "Thermo Fisher Scientific", sector: "Health Care" },
  { symbol: "ABT", name: "Abbott Laboratories", sector: "Health Care" },
  { symbol: "DHR", name: "Danaher Corp.", sector: "Health Care" },
  { symbol: "AMGN", name: "Amgen Inc.", sector: "Health Care" },

  // Financials
  { symbol: "BRK-B", name: "Berkshire Hathaway B", sector: "Financials" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", sector: "Financials" },
  { symbol: "V", name: "Visa Inc.", sector: "Financials" },
  { symbol: "MA", name: "Mastercard Inc.", sector: "Financials" },
  { symbol: "BAC", name: "Bank of America", sector: "Financials" },
  { symbol: "WFC", name: "Wells Fargo & Co.", sector: "Financials" },
  { symbol: "GS", name: "Goldman Sachs Group", sector: "Financials" },
  { symbol: "MS", name: "Morgan Stanley", sector: "Financials" },
  { symbol: "AXP", name: "American Express", sector: "Financials" },
  { symbol: "BLK", name: "BlackRock Inc.", sector: "Financials" },

  // Industrials
  { symbol: "CAT", name: "Caterpillar Inc.", sector: "Industrials" },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrials" },
  { symbol: "HON", name: "Honeywell Intl.", sector: "Industrials" },
  { symbol: "UNP", name: "Union Pacific Corp.", sector: "Industrials" },
  { symbol: "BA", name: "Boeing Co.", sector: "Industrials" },
  { symbol: "RTX", name: "RTX Corp.", sector: "Industrials" },
  { symbol: "DE", name: "Deere & Co.", sector: "Industrials" },
  { symbol: "LMT", name: "Lockheed Martin", sector: "Industrials" },
  { symbol: "UPS", name: "United Parcel Service", sector: "Industrials" },

  // Energy
  { symbol: "XOM", name: "Exxon Mobil Corp.", sector: "Energy" },
  { symbol: "CVX", name: "Chevron Corp.", sector: "Energy" },
  { symbol: "COP", name: "ConocoPhillips", sector: "Energy" },
  { symbol: "SLB", name: "Schlumberger NV", sector: "Energy" },
  { symbol: "EOG", name: "EOG Resources", sector: "Energy" },

  // Utilities
  { symbol: "NEE", name: "NextEra Energy", sector: "Utilities" },
  { symbol: "DUK", name: "Duke Energy Corp.", sector: "Utilities" },
  { symbol: "SO", name: "Southern Co.", sector: "Utilities" },

  // Materials
  { symbol: "LIN", name: "Linde plc", sector: "Materials" },
  { symbol: "SHW", name: "Sherwin-Williams", sector: "Materials" },
  { symbol: "FCX", name: "Freeport-McMoRan", sector: "Materials" },
  { symbol: "APD", name: "Air Products & Chemicals", sector: "Materials" },

  // Real Estate
  { symbol: "PLD", name: "Prologis Inc.", sector: "Real Estate" },
  { symbol: "AMT", name: "American Tower Corp.", sector: "Real Estate" },
  { symbol: "EQIX", name: "Equinix Inc.", sector: "Real Estate" },
];

/** Sorted unique sector list for filter dropdowns. */
export const SECTORS: string[] = [...new Set(SP500.map((c) => c.sector))].sort();

export function constituentsForSector(sector?: string | null): Sp500Constituent[] {
  if (!sector) return SP500;
  return SP500.filter((c) => c.sector.toLowerCase() === sector.toLowerCase());
}
