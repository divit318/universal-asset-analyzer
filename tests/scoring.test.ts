import { describe, expect, it } from "vitest";
import {
  analystSignal,
  assessRisks,
  computeMomentum,
  computeScore,
  scoreGrowth,
  scoreHealth,
  scoreValuation,
} from "@/lib/scoring";
import type {
  AnalystConsensus,
  FundamentalsSnapshot,
  HistoryPoint,
  InsiderActivity,
  SectorRotationEntry,
} from "@/lib/types";

const snap = (o: Partial<FundamentalsSnapshot> = {}): FundamentalsSnapshot => ({
  symbol: "X",
  price: 100,
  trailingPE: 25,
  forwardPE: 20,
  pegRatio: 1.2,
  priceToBook: 5,
  dividendYield: 0.01,
  returnOnEquity: 0.25,
  returnOnAssets: 0.1,
  grossMargins: 0.5,
  operatingMargins: 0.3,
  profitMargins: 0.2,
  ebitdaMargins: 0.35,
  revenueGrowth: 0.2,
  earningsGrowth: 0.25,
  debtToEquity: 0.5,
  currentRatio: 2,
  quickRatio: 1.5,
  freeCashflow: 1e9,
  operatingCashflow: null,
  totalCash: 5e9,
  totalDebt: 3e9,
  ebitda: 4e9,
  enterpriseToEbitda: null,
  priceToSalesTrailing12Months: null,
  ...o,
});

const analyst = (o: Partial<AnalystConsensus> = {}): AnalystConsensus => ({
  targetMean: 130,
  targetHigh: 160,
  targetLow: 100,
  upsidePercent: 30,
  recommendationKey: "buy",
  numberOfOpinions: 30,
  strongBuy: 5,
  buy: 10,
  hold: 3,
  sell: 1,
  strongSell: 0,
  epsRevisionsUp30d: 5,
  epsRevisionsDown30d: 1,
  epsSurprises: [0.05, 0.03, 0.04, 0.02],
  ...o,
});

const insider = (o: Partial<InsiderActivity> = {}): InsiderActivity => ({
  transactions: [],
  netValue: 0,
  buyCount: 0,
  sellCount: 0,
  ...o,
});

const sectorEntry = (o: Partial<SectorRotationEntry> = {}): SectorRotationEntry => ({
  sector: "Technology",
  etfTicker: "XLK",
  returns: { "1w": 1, "1m": 4, "3m": 9, "6m": 15 },
  relativeStrength: 2.5,
  momentum: 1.2,
  rank: 2,
  rankChange: 1,
  classification: "leading",
  ...o,
});

describe("computeScore", () => {
  it("the original 4 fundamental buckets still max out at 30/25/25/20 = 100 (unaffected by the new buckets)", () => {
    const r = computeScore(snap(), null, analyst());
    const original = r.buckets.filter((b) => b.name !== "Capital Allocation" && b.name !== "Sector Rotation");
    const maxes = original.map((b) => b.max);
    expect(maxes).toEqual([30, 25, 25, 20]);
    expect(maxes.reduce((a, b) => a + b)).toBe(100);
    expect(r.total).toBe(original.reduce((s, b) => s + b.points, 0));
  });

  it("always includes a Capital Allocation bucket, even without statements or a sector rotation entry", () => {
    const r = computeScore(snap(), null, analyst());
    const capAlloc = r.buckets.find((b) => b.name === "Capital Allocation");
    expect(capAlloc).toBeDefined();
    expect(r.signals.capitalAllocation).not.toBeNull();
    expect(r.buckets.find((b) => b.name === "Sector Rotation")).toBeUndefined();
    expect(r.signals.sectorRotation).toBeNull();
  });

  it("adds a Sector Rotation bucket only when a rotation entry is explicitly passed (including null)", () => {
    const withEntry = computeScore(snap(), null, analyst(), null, sectorEntry());
    expect(withEntry.buckets.find((b) => b.name === "Sector Rotation")).toBeDefined();
    expect(withEntry.signals.sectorRotation).not.toBeNull();

    const explicitNull = computeScore(snap(), null, analyst(), null, null);
    expect(explicitNull.buckets.find((b) => b.name === "Sector Rotation")).toBeDefined();
    expect(explicitNull.signals.sectorRotation).not.toBeNull(); // degrades to half-credit, not absent
  });

  it("India weighting leans on fundamentals/sector over analyst consensus vs. the US default", () => {
    const bearishAnalystOnly = analyst({ upsidePercent: -20, recommendationKey: "sell", strongBuy: 0, buy: 0, hold: 1, sell: 8, strongSell: 5 });
    const us = computeScore(snap(), null, bearishAnalystOnly, null, sectorEntry(), "US");
    const india = computeScore(snap(), null, bearishAnalystOnly, null, sectorEntry(), "IN");
    // Strong fundamentals + bearish analysts: India's lower analyst weight
    // should let the strong fundamentals pull the composite higher than US's.
    expect(india.composite).toBeGreaterThan(us.composite);
  });

  it("total equals the sum of the 4 original bucket points and is within 0-100", () => {
    const r = computeScore(snap(), null, analyst());
    const original = r.buckets.filter((b) => b.name !== "Capital Allocation" && b.name !== "Sector Rotation");
    expect(r.total).toBe(original.reduce((s, b) => s + b.points, 0));
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });

  it("rates strong fundamentals on the buy side", () => {
    const r = computeScore(snap(), null, analyst());
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(["BUY", "STRONG_BUY"]).toContain(r.recommendation);
    expect(r.rationale).toMatch(/Buy/);
  });

  it("rates weak fundamentals on the sell side", () => {
    const weak = snap({
      pegRatio: 4,
      forwardPE: 40,
      trailingPE: 30,
      returnOnEquity: 0.02,
      operatingMargins: 0.02,
      revenueGrowth: -0.05,
      earningsGrowth: -0.1,
      debtToEquity: 2.5,
      currentRatio: 0.7,
      totalDebt: 20e9,
      totalCash: 1e9,
      ebitda: 2e9,
    });
    const bearish = analyst({
      upsidePercent: -20,
      recommendationKey: "sell",
      strongBuy: 0,
      buy: 1,
      hold: 3,
      sell: 8,
      strongSell: 5,
    });
    const r = computeScore(weak, null, bearish);
    expect(r.total).toBeLessThan(45);
    expect(["SELL", "STRONG_SELL"]).toContain(r.recommendation);
  });

  it("blends momentum into the composite", () => {
    const bullish = computeScore(snap(), null, analyst(), {
      score: 90,
      pctFrom52WkHigh: -2,
      pctFrom52WkLow: 60,
      vsSma50: 8,
      vsSma200: 20,
      return3m: 18,
      trend: "up",
    });
    const bearish = computeScore(snap(), null, analyst(), {
      score: 10,
      pctFrom52WkHigh: -40,
      pctFrom52WkLow: 2,
      vsSma50: -12,
      vsSma200: -25,
      return3m: -22,
      trend: "down",
    });
    expect(bullish.composite).toBeGreaterThan(bearish.composite);
    expect(bullish.signals.momentum).toBe(90);
  });

  it("confidence stays within 0-95", () => {
    const r = computeScore(snap(), null, analyst());
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(95);
  });
});

describe("computeMomentum", () => {
  const series = (closes: number[]): HistoryPoint[] =>
    closes.map((close, i) => ({ date: `2024-01-${i + 1}`, close }));

  it("returns null without enough history", () => {
    expect(computeMomentum(series([1, 2, 3]))).toBeNull();
  });

  it("scores a steady uptrend higher than a downtrend", () => {
    const up = computeMomentum(series(Array.from({ length: 220 }, (_, i) => 100 + i)));
    const down = computeMomentum(series(Array.from({ length: 220 }, (_, i) => 320 - i)));
    expect(up!.score).toBeGreaterThan(down!.score);
    expect(up!.trend).toBe("up");
    expect(down!.trend).toBe("down");
  });
});

describe("analystSignal", () => {
  it("rates a buy-heavy consensus above a sell-heavy one", () => {
    const buy = analystSignal(analyst({ strongBuy: 10, buy: 8, hold: 1, sell: 0, strongSell: 0 }));
    const sell = analystSignal(analyst({ strongBuy: 0, buy: 0, hold: 1, sell: 6, strongSell: 8, upsidePercent: -15 }));
    expect(buy!).toBeGreaterThan(sell!);
  });

  it("returns null with no coverage", () => {
    const none = analystSignal(
      analyst({
        strongBuy: 0,
        buy: 0,
        hold: 0,
        sell: 0,
        strongSell: 0,
        recommendationKey: null,
        upsidePercent: null,
        epsRevisionsUp30d: null,
        epsRevisionsDown30d: null,
      }),
    );
    expect(none).toBeNull();
  });
});

describe("scoreValuation", () => {
  it("awards full marks for large upside", () => {
    const { factors } = scoreValuation(snap(), analyst({ upsidePercent: 40 })).bucket;
    const upside = factors.find((f) => f.label === "Analyst upside")!;
    expect(upside.points).toBe(upside.max);
  });

  it("gives half credit when PEG is missing", () => {
    const { factors } = scoreValuation(snap({ pegRatio: null }), analyst()).bucket;
    const peg = factors.find((f) => f.label === "PEG ratio")!;
    expect(peg.detail).toBe("n/a");
    expect(peg.points).toBe(Math.round(peg.max * 0.5));
  });
});

describe("bank scoring discrimination", () => {
  // Five banks with materially different leverage and growth must NOT
  // collapse onto one score. The old financials bands saturated: every bank's
  // D/E cleared the "best" threshold (full credit) while Net Debt/EBITDA was
  // always null (identical half credit), pinning Financial Health at exactly
  // 70% for all of them; growth bands topped out at 12/15/8%, which four of
  // five banks exceeded, pinning Growth at a saturated 100.
  const bank = (o: Partial<FundamentalsSnapshot>) =>
    snap({ sector: "Financial Services", ebitda: null, currentRatio: null, quickRatio: null, ...o });
  const healthPct = (debtToEquity: number) => {
    const { bucket } = scoreHealth(bank({ debtToEquity }));
    return (bucket.points / bucket.max) * 100;
  };
  const growthPct = (revenueGrowth: number, earningsGrowth: number) => {
    const { bucket } = scoreGrowth(bank({ revenueGrowth, earningsGrowth }), null);
    return (bucket.points / bucket.max) * 100;
  };

  it("materially different bank leverage produces materially different Financial Health scores", () => {
    const scores = [0.59, 0.62, 0.93, 1.28, 1.44].map(healthPct);
    // Strictly decreasing as leverage rises...
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    // ...with a real spread between the least and most levered, not a constant.
    expect(scores[0] - scores[scores.length - 1]).toBeGreaterThan(15);
    expect(new Set(scores.map(Math.round)).size).toBeGreaterThan(2);
  });

  it("materially different bank growth rates produce materially different Growth scores", () => {
    const fast = growthPct(0.24, 0.28);
    const mid = growthPct(0.15, 0.18);
    const slow = growthPct(0.08, 0.06);
    expect(fast).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(slow);
    expect(fast - slow).toBeGreaterThan(15);
  });

  it("normal big-bank growth no longer saturates at the ceiling", () => {
    // ~15% revenue / ~18% EPS growth — a good but unexceptional year for a
    // large Indian private bank — must leave headroom above it.
    expect(growthPct(0.15, 0.18)).toBeLessThan(95);
  });
});

describe("assessRisks", () => {
  it("flags high financial risk for heavy leverage", () => {
    const risks = assessRisks(snap({ debtToEquity: 2.0, currentRatio: 0.8 }), null, analyst(), insider());
    expect(risks.find((r) => r.category === "Financial")!.level).toBe("high");
  });

  it("flags high execution risk on repeated EPS misses", () => {
    const risks = assessRisks(snap(), null, analyst({ epsSurprises: [-0.05, -0.02, 0.01, -0.03] }), insider());
    expect(risks.find((r) => r.category === "Execution")!.level).toBe("high");
  });

  it("keeps risk low for a clean profile", () => {
    const risks = assessRisks(snap(), null, analyst(), insider());
    expect(risks.find((r) => r.category === "Financial")!.level).toBe("low");
  });
});
