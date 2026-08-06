/**
 * Data-quality guards added in the 2026-08 research-page hardening:
 *   - the financials Quality bucket can no longer trivially saturate at max
 *     (every profitable lender used to score a fake-looking 25/25);
 *   - per-symbol news is filtered to stories actually about the symbol;
 *   - the options summary completeness gate hides half-populated chains.
 */

import { describe, expect, it } from "vitest";
import { scoreQuality } from "@/lib/scoring";
import { isRelevantToSymbol } from "@/lib/news";
import { computeDerivativesSummary, isDerivativesSummaryComplete } from "@/lib/derivatives-analysis";
import type { FundamentalsSnapshot, NewsItem, OptionsChainData } from "@/lib/types";

/* ── Quality bucket calibration (financials) ─────────────────────────────── */

function bankSnapshot(overrides: Partial<FundamentalsSnapshot> = {}): FundamentalsSnapshot {
  return {
    symbol: "SYF",
    sector: "Financial Services",
    returnOnEquity: 0.208,
    returnOnAssets: 0.029,
    profitMargins: 0.355,
    operatingMargins: 0.50,
    ...overrides,
  } as unknown as FundamentalsSnapshot;
}

describe("financials Quality bucket", () => {
  it("a strong (but not historic) bank does NOT saturate at max", () => {
    // SYF-like: ROE 20.8%, ROA 2.9%, net margin 35.5% — genuinely strong,
    // but "perfect" would read as fake. Must land below max.
    const { bucket } = scoreQuality(bankSnapshot(), null);
    expect(bucket.points).toBeLessThan(bucket.max);
    expect(bucket.points / bucket.max).toBeGreaterThan(0.6);
  });

  it("a mediocre bank scores clearly lower", () => {
    const strong = scoreQuality(bankSnapshot(), null).bucket;
    const weak = scoreQuality(
      bankSnapshot({ returnOnEquity: 0.07, returnOnAssets: 0.006, profitMargins: 0.12 }),
      null,
    ).bucket;
    expect(weak.points).toBeLessThan(strong.points * 0.5);
  });
});

/* ── News relevance ──────────────────────────────────────────────────────── */

function newsItem(headline: string, tickers: string[]): NewsItem {
  return { headline, source: "test", url: "https://x", publishedAt: "2026-08-06T00:00:00Z", tickers, summary: null };
}

describe("isRelevantToSymbol", () => {
  it("keeps stories whose PRIMARY tag is the symbol", () => {
    expect(isRelevantToSymbol(newsItem("Raising target price to $89.00", ["SYF", "SYF-PB"]), "SYF")).toBe(true);
  });

  it("drops stories tagged only with OTHER tickers", () => {
    expect(isRelevantToSymbol(newsItem("Petco Appoints Jeffrey Naylor to Board of Directors", ["WOOF"]), "SYF")).toBe(false);
  });

  it("drops secondary-tagged stories that never mention the company (the real Petco/COIN feed)", () => {
    // Yahoo tags these with SYF because of a shared director / passing mention.
    expect(isRelevantToSymbol(newsItem("Petco Appoints Jeffrey Naylor to Board of Directors", ["TJX", "WOOF", "SYF", "W"]), "SYF", "Synchrony Financial")).toBe(false);
    expect(isRelevantToSymbol(newsItem("COIN Q2 Earnings & Revenues Miss on Lower Transaction Revenues", ["VIRT", "BFH", "SYF"]), "SYF", "Synchrony Financial")).toBe(false);
  });

  it("keeps secondary-tagged stories that name the company", () => {
    expect(isRelevantToSymbol(newsItem("UBS Adjusts Price Target on Synchrony Financial", ["UBS", "SYF"]), "SYF", "Synchrony Financial")).toBe(true);
  });

  it("keeps untagged stories only when the headline names the ticker", () => {
    expect(isRelevantToSymbol(newsItem("SYF announces buyback", []), "SYF")).toBe(true);
    expect(isRelevantToSymbol(newsItem("Indian government bonds extend post-RBI-policy rally", []), "SYF")).toBe(false);
  });

  it("matches suffixed listings by base ticker", () => {
    expect(isRelevantToSymbol(newsItem("Reliance results", ["RELIANCE.NS"]), "RELIANCE.NS")).toBe(true);
  });

  it("keeps macro-context stories for futures/forex symbols", () => {
    expect(isRelevantToSymbol(newsItem("Gold rallies on Fed cut bets", []), "GC=F")).toBe(true);
  });
});

/* ── Options completeness gate ───────────────────────────────────────────── */

function contract(strike: number, iv: number | null, oi: number, bid = 1, ask = 1.2) {
  return {
    contractSymbol: `T${strike}`,
    strike,
    lastPrice: 1,
    bid,
    ask,
    volume: 10,
    openInterest: oi,
    impliedVolatility: iv,
    inTheMoney: false,
  };
}

describe("options chain quality gating", () => {
  it("placeholder IVs with no quoted market produce a null ATM IV (and the card hides)", () => {
    // The observed SYF chain: binary-fraction IVs (0.0156, 0.0625) and bid=ask=0.
    const chain: OptionsChainData = {
      underlyingSymbol: "SYF",
      underlyingPrice: 79.25,
      expirationDates: ["2026-08-21"],
      chains: [
        {
          expirationDate: "2026-08-21",
          calls: [contract(80, 0.0156, 100, 0, 0), contract(82.5, 0.0625, 50, 0, 0)],
          puts: [contract(77.5, 0.0313, 80, 0, 0)],
        },
      ],
    };
    const summary = computeDerivativesSummary(chain);
    expect(summary.atmIV).toBeNull();
    expect(isDerivativesSummaryComplete(summary)).toBe(false);
  });

  it("a live, plausible chain passes the gate", () => {
    const near = {
      expirationDate: "2026-09-18",
      calls: [contract(80, 0.32, 500), contract(85, 0.30, 300)],
      puts: [contract(77.5, 0.34, 400), contract(75, 0.36, 200)],
    };
    const far = {
      expirationDate: "2026-12-18",
      calls: [contract(80, 0.29, 250)],
      puts: [contract(77.5, 0.31, 150)],
    };
    const chain: OptionsChainData = {
      underlyingSymbol: "SYF",
      underlyingPrice: 79.25,
      expirationDates: [near.expirationDate, far.expirationDate],
      chains: [near, far],
    };
    const summary = computeDerivativesSummary(chain);
    expect(summary.atmIV).toBeGreaterThan(20);
    expect(summary.atmIV).toBeLessThan(60);
    expect(summary.atmPutGreeks).not.toBeNull();
    expect(isDerivativesSummaryComplete(summary)).toBe(true);
  });
});
