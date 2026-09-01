/**
 * India localization leak guards (Phase 3, ADR-002).
 *
 * These tests exist so US-market assumptions cannot silently leak back into
 * Indian analysis. Each case runs IDENTICAL fundamentals through the engines
 * under a US symbol and an NSE (.NS) symbol and asserts the documented
 * market-calibration differences — plus the hard gates: no US SPDR sector
 * rotation and no Yahoo (S&P 500-relative) beta for Indian listings.
 */
import { describe, expect, it } from "vitest";
import { computeScores, valueScore, growthScore, type ScorableMetrics } from "@/lib/composite";
import { computeScore, scoreValuation, scoreQuality, assessRisks } from "@/lib/scoring";
import { sectorRotationEntryFor } from "@/lib/sector-rotation-utils";
import { marketBenchmark } from "@/lib/benchmarks";
import type {
  AnalystConsensus,
  FundamentalsSnapshot,
  InsiderActivity,
  SectorRotationSnapshot,
} from "@/lib/types";

/* ── fixtures ─────────────────────────────────────────────────────────── */

const baseMetrics: Omit<ScorableMetrics, "symbol"> = {
  name: "Test Co",
  sector: "Technology",
  industry: "Software",
  price: 100,
  marketCap: 1e10,
  forwardPE: 30,
  evToEbitda: 20,
  fcfYield: 3,
  revenueGrowthYoY: 12,
  revenueCagr3y: 10,
  epsGrowthYoY: 14,
  epsCagr3y: 12,
  roic: 14,
  roe: 16,
  grossMargin: 45,
  operatingMargin: 20,
  fcfMargin: 12,
  debtToEquity: 0.8,
  netDebtToEbitda: 1.5,
  currentRatio: 1.6,
  oneYearReturn: 10,
  distanceFrom52WkHigh: -10,
  dividendYield: 1.5,
} as Omit<ScorableMetrics, "symbol">;

const metricsFor = (symbol: string): ScorableMetrics =>
  ({ ...baseMetrics, symbol }) as ScorableMetrics;

const snapshotFor = (symbol: string): FundamentalsSnapshot =>
  ({
    symbol,
    price: 100,
    sector: "Technology",
    trailingPE: 30,
    forwardPE: 27,
    pegRatio: 3.0,
    returnOnEquity: 0.16,
    returnOnAssets: 0.08,
    operatingMargins: 0.2,
    profitMargins: 0.15,
    revenueGrowth: 0.12,
    earningsGrowth: 0.14,
    debtToEquity: 0.8,
    currentRatio: 1.6,
    totalDebt: 1e9,
    totalCash: 5e8,
    ebitda: 8e8,
    dividendYield: 0.015,
    freeCashflow: 5e8,
    priceToBook: 6,
  }) as unknown as FundamentalsSnapshot;

const noAnalyst: AnalystConsensus = {
  upsidePercent: null,
  targetMean: null,
  epsSurprises: [],
} as unknown as AnalystConsensus;

const noInsider: InsiderActivity = { sellCount: 0, buyCount: 0, netValue: 0 } as unknown as InsiderActivity;

const rotationSnapshot: SectorRotationSnapshot = {
  asOf: "2026-09-01",
  primaryWindow: "1m",
  sectors: [
    {
      sector: "Technology",
      etfTicker: "XLK",
      rank: 4,
      rankChange: -1,
      relativeStrength: 2,
      momentum: -4.5,
      classification: "weakening",
      returns: { "1m": 1.2 },
    } as SectorRotationSnapshot["sectors"][number],
  ],
  leaders: ["Technology"],
  laggards: [],
  leadershipChanges: [],
};

/* ── composite (batch screener) bands ─────────────────────────────────── */

describe("composite.ts market bands", () => {
  it("scores the same fundamentals differently under IN calibration where norms differ", () => {
    const us = computeScores(metricsFor("TEST"));
    const ind = computeScores(metricsFor("TEST.NS"));
    // Valuation: 30x fwd P/E is less expensive against the IN band (45→10)
    // than the US band (40→8).
    expect(ind.value!).toBeGreaterThan(us.value!);
    // Growth: +12% revenue clears less of the IN band (5→28) than US (0→25).
    expect(ind.growth!).toBeLessThan(us.growth!);
    // Both remain valid 0-100 scores.
    for (const d of [us, ind]) {
      expect(d.overall).not.toBeNull();
      expect(d.overall!).toBeGreaterThanOrEqual(0);
      expect(d.overall!).toBeLessThanOrEqual(100);
    }
  });

  it("keeps US bands for US listings and for ADR-style unsuffixed symbols", () => {
    // The band switch keys on the suffix alone — INFY (NYSE ADR) stays US.
    expect(computeScores(metricsFor("INFY"))).toEqual(computeScores(metricsFor("AAPL")));
  });

  it("keeps market-neutral dimensions identical across markets", () => {
    const us = computeScores(metricsFor("TEST"));
    const ind = computeScores(metricsFor("TEST.NS"));
    // Momentum is price-vs-own-history and must not differ by market.
    expect(ind.momentum).toBe(us.momentum);
  });

  it("value/growth band selection reacts to .BO (BSE) suffixes too", () => {
    expect(valueScore(metricsFor("TEST.BO"))).toBe(valueScore(metricsFor("TEST.NS")));
    expect(growthScore(metricsFor("TEST.BO"))).toBe(growthScore(metricsFor("TEST.NS")));
  });
});

/* ── single-name engine bands ─────────────────────────────────────────── */

describe("scoring.ts market bands", () => {
  it("does not zero an Indian compounder's PEG the way the US band does", () => {
    // PEG 3.0: exactly the US worst (0 points) but inside the IN band (4→1).
    const us = scoreValuation(snapshotFor("TEST"), noAnalyst);
    const ind = scoreValuation(snapshotFor("TEST.NS"), noAnalyst);
    const peg = (b: ReturnType<typeof scoreValuation>) =>
      b.bucket.factors.find((f) => f.label === "PEG ratio")!;
    expect(peg(us).points).toBe(0);
    expect(peg(ind).points).toBeGreaterThan(0);
  });

  it("raises the Indian ROE floor to the G-sec hurdle", () => {
    // ROE 8%: at the IN floor (0 credit direction) but above the US 5% floor.
    const s = { ...snapshotFor("TEST"), returnOnEquity: 0.08 } as FundamentalsSnapshot;
    const sIn = { ...snapshotFor("TEST.NS"), returnOnEquity: 0.08 } as FundamentalsSnapshot;
    const roe = (b: ReturnType<typeof scoreQuality>) =>
      b.bucket.factors.find((f) => f.label === "Return on equity")!;
    expect(roe(scoreQuality(sIn, null)).points).toBeLessThan(roe(scoreQuality(s, null)).points);
  });

  it("does not flag PEG 3.0 as high valuation risk for an Indian listing", () => {
    const usRisks = assessRisks(snapshotFor("TEST"), null, noAnalyst, noInsider);
    const inRisks = assessRisks(snapshotFor("TEST.NS"), null, noAnalyst, noInsider);
    const val = (rs: ReturnType<typeof assessRisks>) => rs.find((r) => /valuation/i.test(r.category));
    expect(val(usRisks)?.level).toBe("high");
    expect(val(inRisks)?.level).not.toBe("high");
  });
});

/* ── US sector rotation must never reach non-US listings ──────────────── */

describe("sector rotation gate", () => {
  it("returns the entry for US listings and null for NSE/BSE listings", () => {
    expect(sectorRotationEntryFor("AAPL", rotationSnapshot, "Technology")).not.toBeNull();
    expect(sectorRotationEntryFor("TCS.NS", rotationSnapshot, "Technology")).toBeNull();
    expect(sectorRotationEntryFor("RELIANCE.BO", rotationSnapshot, "Energy")).toBeNull();
  });

  it("computeScore omits the Sector Rotation bucket for Indian symbols (gated upstream)", () => {
    // Callers gate by passing `undefined` for non-US listings; assert the
    // omitted bucket never surfaces and the signal stays null.
    const score = computeScore(snapshotFor("TCS.NS"), null, noAnalyst, null, undefined, "IN");
    expect(score.buckets.some((b) => b.name === "Sector Rotation")).toBe(false);
    expect(score.signals.sectorRotation).toBeNull();
  });
});

/* ── screener.in peer data feeds the India valuation judgment ─────────── */

describe("india-snapshot peer-relative valuation", () => {
  it("computes the peer median P/E from the screener.in peer table (3+ valid peers)", async () => {
    const { peerMedianPe } = await import("@/lib/india-snapshot");
    const peer = (pe: string | null) => ({ pe }) as never;
    expect(peerMedianPe([peer("20"), peer("30"), peer("40")])).toBe(30);
    expect(peerMedianPe([peer("20"), peer("30")])).toBeNull(); // too few
    expect(peerMedianPe([peer("20"), peer("-5"), peer("n/a"), peer("30"), peer("40")])).toBe(30);
  });
});

/* ── benchmarks stay market-correct ───────────────────────────────────── */

describe("India benchmark selection", () => {
  it("keeps NIFTY 50 as the IN market benchmark (beta regression + charts depend on it)", () => {
    expect(marketBenchmark("IN")).toEqual({ symbol: "^NSEI", label: "NIFTY 50" });
  });
});
