import { describe, expect, it } from "vitest";
import {
  analyzeConcentration,
  deriveFundExposure,
  describeMandate,
  parseMandate,
} from "@/lib/research-engines/fund/exposure";
import { analyzeOverlap, OVERLAP_BANDS, type OverlapPosition } from "@/lib/research-engines/fund/overlap";
import { analyzeRegimeBehavior } from "@/lib/research-engines/fund/behavior";
import { assessVehicle, LIQUIDITY_FLOORS } from "@/lib/research-engines/fund/vehicle";
import { deriveVerdictTriggers } from "@/lib/research-engines/fund/triggers";
import { buildThesisCase } from "@/lib/research-engines/fund/evidence";
import { findAlternatives } from "@/lib/research-engines/fund/alternatives";
import { computeFundScore } from "@/lib/fund-scoring";
import type { FundHolding, FundProfileData, HistoryPoint, ScoreResult } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const holdings = (weights: [string, number][]): FundHolding[] =>
  weights.map(([symbol, weightPercent]) => ({ symbol, name: `${symbol} Inc`, weightPercent }));

/** A QQQM-shaped fund: mega-cap growth, tech-clustered, top-heavy. */
const fundFixture = (o: Partial<FundProfileData> = {}): FundProfileData => ({
  family: "Invesco",
  category: "Large Growth",
  legalType: "Exchange Traded Fund",
  expenseRatio: 0.0015,
  expenseRatioSource: "yahoo",
  turnoverPercent: 0.12,
  totalNetAssets: 45_000_000_000,
  currency: "USD",
  morningstarRating: 4,
  inceptionDate: "2020-10-13",
  holdings: holdings([
    ["AAPL", 9.0], ["NVDA", 8.2], ["MSFT", 7.8], ["AMZN", 5.4], ["AVGO", 4.6],
    ["META", 3.5], ["TSLA", 3.0], ["GOOGL", 2.6], ["GOOG", 2.5], ["COST", 2.4],
  ]),
  sectorWeights: [
    { sector: "Technology", weightPercent: 58 },
    { sector: "Communication Services", weightPercent: 15 },
    { sector: "Consumer Cyclical", weightPercent: 13 },
    { sector: "Healthcare", weightPercent: 6 },
    { sector: "Industrials", weightPercent: 4 },
    { sector: "Consumer Defensive", weightPercent: 4 },
  ],
  assetAllocation: { stock: 99.5, bond: 0, cash: 0.5, other: 0 },
  trailingReturns: { ytd: 12, oneYear: 24, threeYear: 15, fiveYear: 18 },
  categoryRelativeReturns: { oneYear: 2.1, threeYear: 1.4 },
  risk: { beta: 1.15, alpha: 1.2, stdDev: 18, sharpeRatio: 0.9 },
  ...o,
});

/** Deterministic daily series: `n` sessions compounding at `drift` with a
 *  reproducible sawtooth so drawdowns and volatility are non-degenerate. */
function series(n: number, drift: number, amplitude: number, startDate = "2021-01-04"): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  let price = 100;
  const start = new Date(startDate);
  for (let i = 0; i < n; i++) {
    price *= 1 + drift + amplitude * Math.sin(i / 7) ;
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push({ date: d.toISOString().slice(0, 10), close: price, adjClose: price, volume: 1_000_000 });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Mandate parsing                                                             */
/* -------------------------------------------------------------------------- */

describe("parseMandate", () => {
  it("reads size, style and inferred US geography from a Morningstar equity category", () => {
    const m = parseMandate("Large Growth", true);
    expect(m).toMatchObject({ size: "large", style: "growth", geography: "US", assetKind: "equity" });
    expect(m.geographyInferred).toBe(true);
  });

  it("prefers a stated geography over the US default and does not flag it inferred", () => {
    const m = parseMandate("Foreign Large Blend", true);
    expect(m.geography).toBe("Foreign developed");
    expect(m.geographyInferred).toBe(false);
    expect(m.style).toBe("blend");
  });

  it("never reads size or style off a bond mandate", () => {
    // "Intermediate Core Bond" contains neither a cap size nor a style, but a
    // naive /mid/ or /core/ match would invent one.
    const m = parseMandate("Intermediate Core Bond", true);
    expect(m.assetKind).toBe("bond");
    expect(m.size).toBeNull();
    expect(m.style).toBeNull();
  });

  it("identifies a single-sector mandate", () => {
    expect(parseMandate("Technology", true).sectorFocus).toBe("Technology");
    expect(parseMandate("Large Blend", true).sectorFocus).toBeNull();
  });

  it("returns an all-null mandate when no category was reported", () => {
    const m = parseMandate(null, true);
    expect(m.category).toBeNull();
    expect(m.geography).toBeNull();
    expect(describeMandate(m)).toBeNull();
  });

  it("describes emerging-market and commodity mandates without equity words", () => {
    expect(describeMandate(parseMandate("Diversified Emerging Mkts", true))).toContain("Emerging markets");
    expect(describeMandate(parseMandate("Commodities Broad Basket", true))).toContain("commodity");
  });
});

/* -------------------------------------------------------------------------- */
/* Concentration                                                               */
/* -------------------------------------------------------------------------- */

describe("analyzeConcentration", () => {
  it("sums the disclosed top 5 and top 10 and reports the coverage denominator", () => {
    const c = analyzeConcentration(fundFixture());
    expect(c.disclosedCount).toBe(10);
    expect(c.top5Pct).toBeCloseTo(35.0, 5);
    expect(c.top10Pct).toBeCloseTo(49.0, 5);
    expect(c.disclosedWeightPct).toBeCloseTo(49.0, 5);
  });

  it("refuses a top-10 figure when fewer than ten positions were disclosed", () => {
    const c = analyzeConcentration(fundFixture({ holdings: holdings([["A", 5], ["B", 4], ["C", 3]]) }));
    expect(c.top10Pct).toBeNull();
    expect(c.top5Pct).toBeNull();
    expect(c.disclosedWeightPct).toBeCloseTo(12, 5);
  });

  it("finds the smallest sector cluster clearing half the fund", () => {
    const c = analyzeConcentration(fundFixture());
    // Technology 58 alone clears 50, so the cluster is one sector.
    expect(c.clusterSectors).toEqual(["Technology"]);
    expect(c.clusterPct).toBeCloseTo(58, 5);
    expect(c.clusterShockPct).toBeCloseTo(5.8, 5);
  });

  it("reports no cluster for a fund no set of leading sectors dominates", () => {
    const flat = fundFixture({
      sectorWeights: Array.from({ length: 11 }, (_, i) => ({ sector: `S${i}`, weightPercent: 100 / 11 })),
    });
    const c = analyzeConcentration(flat);
    // Six of eleven equal sectors DO clear 50 — but that is six names, which
    // the UI treats as "no cluster worth naming" via the length check.
    expect(c.clusterSectors.length).toBeGreaterThan(3);
    expect(c.sectorHhi).toBeLessThan(1000);
  });

  it("computes single-name shock as pure weight arithmetic", () => {
    const c = analyzeConcentration(fundFixture());
    expect(c.largest?.symbol).toBe("AAPL");
    expect(c.largestNameShockPct).toBeCloseTo(1.8, 5); // 9.0% × 20%
  });

  it("returns nulls rather than zeros when nothing was disclosed", () => {
    const c = analyzeConcentration(fundFixture({ holdings: [], sectorWeights: [] }));
    expect(c.largest).toBeNull();
    expect(c.topSector).toBeNull();
    expect(c.sectorHhi).toBeNull();
    expect(c.largestNameShockPct).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Exposure                                                                    */
/* -------------------------------------------------------------------------- */

describe("deriveFundExposure", () => {
  it("produces a headline naming the cluster and the top-10 weight", () => {
    const e = deriveFundExposure(fundFixture(), true);
    expect(e.headline).toContain("technology");
    expect(e.headline).toMatch(/ten largest positions are 49%/);
    expect(e.headline).toContain("concentrated bet");
  });

  it("does not call a broadly-spread fund concentrated", () => {
    const broad = fundFixture({
      holdings: holdings(Array.from({ length: 10 }, (_, i) => [`S${i}`, 1.2] as [string, number])),
      sectorWeights: Array.from({ length: 11 }, (_, i) => ({ sector: `Sector ${i}`, weightPercent: 100 / 11 })),
    });
    const e = deriveFundExposure(broad, true);
    expect(e.headline).toContain("spread broadly");
    expect(e.headline).not.toContain("concentrated bet");
  });

  it("flags single-name risk with the arithmetic behind it", () => {
    const e = deriveFundExposure(fundFixture(), true);
    const bet = e.bets.find((b) => b.text.includes("Single-name risk"));
    expect(bet?.text).toContain("AAPL");
    expect(bet?.text).toContain("1.8pp");
    expect(bet?.basis).toBe("read");
  });

  it("calls a bond-heavy fund a rates instrument rather than an equity bet", () => {
    const bondFund = fundFixture({
      category: "Intermediate Core Bond",
      assetAllocation: { stock: 0, bond: 98, cash: 2, other: 0 },
      sectorWeights: [],
      holdings: [],
    });
    const e = deriveFundExposure(bondFund, true);
    expect(e.bets.some((b) => b.text.includes("rates instrument"))).toBe(true);
    expect(e.bets.some((b) => b.text.includes("no bond or cash ballast"))).toBe(false);
  });

  it("emits no chips or headline for a fund with no category and no holdings", () => {
    const e = deriveFundExposure(
      fundFixture({ category: null, holdings: [], sectorWeights: [], assetAllocation: { stock: null, bond: null, cash: null, other: null } }),
      false,
    );
    expect(e.headline).toBeNull();
    expect(e.chips).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Portfolio overlap                                                           */
/* -------------------------------------------------------------------------- */

const position = (symbol: string, weightPct: number, o: Partial<OverlapPosition> = {}): OverlapPosition => ({
  symbol,
  name: `${symbol} Inc`,
  weightPct,
  sector: "Technology",
  isFund: false,
  ...o,
});

describe("analyzeOverlap", () => {
  const fund = fundFixture();

  it("measures overlap as a floor and reports the denominator it was measured over", () => {
    const r = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("AAPL", 6), position("NVDA", 5), position("KO", 4, { sector: "Consumer Defensive" })],
      addAllocationPct: 5,
    });
    // AAPL 9.0 + NVDA 8.2 — KO is not in the fund.
    expect(r.overlapWeightPct).toBeCloseTo(17.2, 5);
    expect(r.disclosedWeightPct).toBeCloseTo(49.0, 5);
    expect(r.overlapOfDisclosedPct).toBeCloseTo((17.2 / 49) * 100, 5);
  });

  it("dilutes existing weights by the new money rather than only adding to them", () => {
    const r = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("AAPL", 10)],
      addAllocationPct: 20,
    });
    const aapl = r.matches.find((m) => m.symbol === "AAPL")!;
    // 10% × (1 − 0.20) + 20% × 9.0% = 8 + 1.8 = 9.8 — a DECREASE, which naive
    // additive maths would have reported as a rise to 11.8%.
    expect(aapl.projectedWeightPct).toBeCloseTo(9.8, 5);
    expect(aapl.deltaPct).toBeCloseTo(-0.2, 5);
  });

  it("sees names held inside other funds via look-through and names the fund", () => {
    const r = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("VOO", 50, { isFund: true, sector: null })],
      addAllocationPct: 10,
      lookThrough: { VOO: holdings([["AAPL", 7], ["MSFT", 6]]) },
    });
    expect(r.lookThroughApplied).toBe(true);
    const aapl = r.matches.find((m) => m.symbol === "AAPL")!;
    expect(aapl.directWeightPct).toBe(0);
    expect(aapl.indirectWeightPct).toBeCloseTo(3.5, 5); // 50% × 7%
    expect(aapl.viaFunds).toEqual(["VOO"]);
    expect(r.unlookedFunds).toHaveLength(0);
  });

  it("names funds it could not see through instead of assuming they hold nothing", () => {
    const r = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("ARKK", 30, { isFund: true })],
      addAllocationPct: 5,
    });
    expect(r.lookThroughApplied).toBe(false);
    expect(r.unlookedFunds).toEqual(["ARKK"]);
  });

  it("bands the verdict on the share of measurable weight already owned", () => {
    const heavy = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("AAPL", 5), position("NVDA", 5), position("MSFT", 5), position("AMZN", 5)],
      addAllocationPct: 5,
    });
    // 30.4 of 49 disclosed = 62% → reinforces
    expect(heavy.overlapOfDisclosedPct).toBeGreaterThanOrEqual(OVERLAP_BANDS.reinforces);
    expect(heavy.verdict).toBe("reinforces");

    const light = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("COST", 3, { sector: "Consumer Defensive" })],
      addAllocationPct: 5,
    });
    expect(light.verdict).toBe("diversifies");
  });

  it("projects the sector mix from both sides", () => {
    const r = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("KO", 100, { sector: "Consumer Defensive" })],
      addAllocationPct: 10,
    });
    const tech = r.sectorShifts.find((s) => s.sector === "Technology")!;
    expect(tech.currentPct).toBe(0);
    expect(tech.projectedPct).toBeCloseTo(5.8, 5); // 10% × 58%
    const defensive = r.sectorShifts.find((s) => s.sector === "Consumer Defensive")!;
    expect(defensive.projectedPct).toBeCloseTo(90.4, 5); // 100 × 0.9 + 10 × 4%
  });

  it("refuses to call zero-of-zero matches diversification when the fund itemises nothing", () => {
    // Live case: BND discloses no holdings. Reading "0 matches" as new exposure
    // would be the page's most confident lie — absence of evidence, reported as
    // evidence of absence.
    const r = analyzeOverlap({
      fundHoldings: [],
      fundSectorWeights: [],
      positions: [position("AAPL", 10)],
      addAllocationPct: 8,
    });
    expect(r.holdingsDisclosed).toBe(false);
    expect(r.verdict).toBe("unknown");
    expect(r.headline).toContain("can't be measured");
    expect(r.headline).not.toContain("new exposure");
  });

  it("still projects the sector mix for a fund that itemises no positions", () => {
    // Sector weights are reported in full even when holdings are not, so
    // dilution of the book's existing sectors is exact.
    const r = analyzeOverlap({
      fundHoldings: [],
      fundSectorWeights: [],
      positions: [position("AAPL", 100, { sector: "Technology" })],
      addAllocationPct: 10,
    });
    const tech = r.sectorShifts.find((s) => s.sector === "Technology")!;
    expect(tech.projectedPct).toBeCloseTo(90, 5);
  });

  it("reports the share of new capital that lands back in names already held", () => {
    const r = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [position("AAPL", 10), position("NVDA", 10)],
      addAllocationPct: 8,
    });
    // (9.0 + 8.2)% of the fund × 8% of the book.
    expect(r.recycledCapitalPct).toBeCloseTo((17.2 * 8) / 100, 5);
  });

  it("says so plainly when there is no portfolio to compare against", () => {
    const r = analyzeOverlap({
      fundHoldings: fund.holdings,
      fundSectorWeights: fund.sectorWeights,
      positions: [],
      addAllocationPct: 5,
    });
    expect(r.matches).toHaveLength(0);
    expect(r.overlapWeightPct).toBe(0);
    expect(r.headline).toContain("No positions");
  });

  it("matches a symbol-less holding on its normalized name", () => {
    const r = analyzeOverlap({
      fundHoldings: [{ symbol: "", name: "Berkshire Hathaway Inc.", weightPercent: 4 }],
      fundSectorWeights: [],
      positions: [position("", 3, { name: "Berkshire Hathaway Inc" })],
      addAllocationPct: 5,
    });
    expect(r.matches).toHaveLength(1);
    expect(r.overlapWeightPct).toBeCloseTo(4, 5);
  });
});

/* -------------------------------------------------------------------------- */
/* Regime behaviour                                                            */
/* -------------------------------------------------------------------------- */

describe("analyzeRegimeBehavior", () => {
  it("returns nulls rather than noise when the shared sample is too short", () => {
    const r = analyzeRegimeBehavior(series(40, 0.001, 0.002), series(40, 0.001, 0.002), "S&P 500");
    expect(r.beta).toBeNull();
    expect(r.upCapturePct).toBeNull();
    expect(r.summary).toBeNull();
  });

  it("measures a beta near 2 for a fund that moves twice the benchmark", () => {
    const bench = series(600, 0.0003, 0.004);
    // Same shape, double amplitude and drift — beta should land near 2.
    const fund = series(600, 0.0006, 0.008);
    const r = analyzeRegimeBehavior(fund, bench, "S&P 500");
    expect(r.alignedDays).toBe(600);
    expect(r.beta).toBeGreaterThan(1.6);
    expect(r.correlation).toBeGreaterThan(0.95);
    expect(r.volatilityRatio).toBeGreaterThan(1.5);
  });

  it("only aligns dates present in both series", () => {
    const bench = series(400, 0.0003, 0.004);
    const fund = series(400, 0.0003, 0.004).filter((_, i) => i % 2 === 0);
    const r = analyzeRegimeBehavior(fund, bench, "S&P 500");
    expect(r.alignedDays).toBe(200);
  });

  it("finds the benchmark's drawdown episodes and the fund's move through them", () => {
    // Amplitude chosen so the sawtooth's half-cycle drawdown clears the 8%
    // episode threshold with room to spare — at 0.006 it lands within a
    // percentage point of the cutoff and the test measures rounding, not logic.
    const bench = series(600, 0.0002, 0.012);
    const fund = series(600, 0.0002, 0.024);
    const r = analyzeRegimeBehavior(fund, bench, "S&P 500");
    expect(r.episodes.length).toBeGreaterThan(0);
    for (const e of r.episodes) {
      expect(e.benchmarkPct).toBeLessThanOrEqual(-8);
      expect(e.fromDate <= e.toDate).toBe(true);
      expect(e.edgePct).toBeCloseTo(e.fundPct - e.benchmarkPct, 6);
    }
  });

  it("writes a summary that names the capture ratios it is reading", () => {
    const r = analyzeRegimeBehavior(series(700, 0.0006, 0.008), series(700, 0.0003, 0.004), "S&P 500");
    expect(r.summary).toBeTruthy();
    expect(r.upCapturePct).not.toBeNull();
    expect(r.summary).toContain(String(Math.round(r.upCapturePct!)));
  });
});

/* -------------------------------------------------------------------------- */
/* Vehicle quality                                                             */
/* -------------------------------------------------------------------------- */

describe("assessVehicle", () => {
  it("converts the expense ratio into a cost per 10,000 held", () => {
    const v = assessVehicle(fundFixture({ expenseRatio: 0.0015 }), []);
    expect(v.expenseRatioPct).toBeCloseTo(0.15, 6);
    expect(v.annualCostPer10k).toBe(15);
  });

  it("tiers liquidity off median traded value", () => {
    const deep = series(120, 0.0001, 0.001).map((p) => ({ ...p, volume: LIQUIDITY_FLOORS.deep / p.close * 2 }));
    expect(assessVehicle(fundFixture(), deep).liquidity).toBe("deep");

    const thin = series(120, 0.0001, 0.001).map((p) => ({ ...p, volume: 1_000_000 / p.close }));
    expect(assessVehicle(fundFixture(), thin).liquidity).toBe("thin");
  });

  it("reports no liquidity at all for a NAV-priced fund with no volume", () => {
    const noVolume = series(120, 0.0001, 0.001).map((p) => ({ ...p, volume: undefined }));
    const v = assessVehicle(fundFixture(), noVolume);
    expect(v.medianDailyValue).toBeNull();
    expect(v.liquidity).toBeNull();
  });

  it("names the fields the data source does not carry", () => {
    const v = assessVehicle(fundFixture(), []);
    expect(v.omissions.join(" ")).toContain("tracking error");
    expect(v.omissions.join(" ")).toContain("premium/discount");
  });

  it("leaves cost fields null rather than assuming zero when nothing was reported", () => {
    const v = assessVehicle(fundFixture({ expenseRatio: null, expenseRatioSource: null, turnoverPercent: null }), []);
    expect(v.expenseRatioPct).toBeNull();
    expect(v.annualCostPer10k).toBeNull();
    expect(v.summary === null || !v.summary.includes("0.00%")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Verdict triggers                                                            */
/* -------------------------------------------------------------------------- */

describe("deriveVerdictTriggers", () => {
  const history = series(600, 0.0004, 0.004);

  it("reports thresholds that genuinely cross the band when applied to the real scorer", () => {
    const fund = fundFixture();
    const score = computeFundScore(fund, history);
    const t = deriveVerdictTriggers(fund, history, score);

    const expense = t.upgrades.find((u) => u.lever === "Expense ratio");
    if (expense && t.upgradeAt != null) {
      // Feed the reported threshold back through the ACTUAL scorer: if the
      // inversion is right, the composite must reach the band edge.
      const target = Number.parseFloat(expense.to);
      const moved = computeFundScore({ ...fund, expenseRatio: target / 100 }, history);
      expect(moved.composite).toBeGreaterThanOrEqual(t.upgradeAt);
    }

    const sharpe = t.downgrades.find((d) => d.lever === "Sharpe ratio");
    if (sharpe && t.downgradeAt != null) {
      const target = Number.parseFloat(sharpe.to);
      const moved = computeFundScore({ ...fund, risk: { ...fund.risk!, sharpeRatio: target } }, history);
      expect(moved.composite).toBeLessThanOrEqual(t.downgradeAt);
    }
  });

  it("derives band edges from the shared recommendation bands, not its own", () => {
    const fund = fundFixture();
    const score = computeFundScore(fund, history);
    const t = deriveVerdictTriggers(fund, history, score);
    for (const edge of [t.upgradeAt, t.downgradeAt != null ? t.downgradeAt + 1 : null]) {
      if (edge != null) expect([25, 42, 60, 78]).toContain(edge);
    }
  });

  it("never proposes a condition on a factor the data source did not report", () => {
    const fund = fundFixture({ expenseRatio: null, risk: null, categoryRelativeReturns: { oneYear: null, threeYear: null } });
    const score = computeFundScore(fund, history);
    const t = deriveVerdictTriggers(fund, history, score);
    const levers = [...t.upgrades, ...t.downgrades].map((x) => x.lever);
    expect(levers).not.toContain("Expense ratio");
    expect(levers).not.toContain("Sharpe ratio");
    expect(levers).not.toContain("1-year return vs category");
  });

  it("offers no upgrade path from the top tier", () => {
    const score = { composite: 95, recommendation: "STRONG_BUY" as const };
    const t = deriveVerdictTriggers(fundFixture(), history, score);
    expect(t.upgradeAt).toBeNull();
    expect(t.upgrades).toHaveLength(0);
    expect(t.downgradeAt).toBe(77);
  });
});

/* -------------------------------------------------------------------------- */
/* Thesis / evidence                                                           */
/* -------------------------------------------------------------------------- */

describe("buildThesisCase", () => {
  const score = (): ScoreResult => computeFundScore(fundFixture(), series(600, 0.0004, 0.004));

  it("splits the scorer's own factors into support and objections", () => {
    const s = score();
    const c = buildThesisCase({ name: "Test Fund", score: s, mandate: parseMandate("Large Growth", true) });
    expect(c.supports.length + c.against.length).toBeGreaterThan(0);
    for (const line of [...c.supports, ...c.against]) expect(line.detail).not.toBe("n/a");
  });

  it("never treats an unreported factor as evidence either way", () => {
    const bare = computeFundScore(
      fundFixture({ expenseRatio: null, turnoverPercent: null, risk: null, categoryRelativeReturns: { oneYear: null, threeYear: null }, trailingReturns: { ytd: null, oneYear: null, threeYear: null, fiveYear: null } }),
      series(600, 0.0004, 0.004),
    );
    const c = buildThesisCase({ name: "Bare Fund", score: bare, mandate: parseMandate(null, true) });
    for (const line of [...c.supports, ...c.against]) expect(line.detail).not.toBe("n/a");
  });

  it("folds caller-supplied evidence in alongside the scored factors", () => {
    const s = score();
    const c = buildThesisCase({
      name: "Test Fund",
      score: s,
      mandate: parseMandate("Large Growth", true),
      extras: { against: [{ label: "Capture profile", detail: "131% down capture", strength: 0.8 }] },
    });
    expect(c.against.some((l) => l.label === "Capture profile")).toBe(true);
  });

  it("quotes the same composite and call the score card shows", () => {
    const s = score();
    const c = buildThesisCase({ name: "Test Fund", score: s, mandate: parseMandate("Large Growth", true) });
    expect(c.verdict).toContain(`${s.composite}/100`);
  });
});

/* -------------------------------------------------------------------------- */
/* Alternatives                                                                */
/* -------------------------------------------------------------------------- */

describe("findAlternatives", () => {
  it("returns curated pairs with a structural reason", () => {
    const { alternatives, basis } = findAlternatives("QQQM", "Large Growth");
    expect(basis).toBe("curated");
    expect(alternatives.map((a) => a.symbol)).toContain("QQQ");
    for (const a of alternatives) {
      expect(a.tradeoff.length).toBeGreaterThan(30);
      // Structural claims only — a hardcoded percentage would rot silently.
      expect(a.tradeoff).not.toMatch(/\d+(\.\d+)?%/);
    }
  });

  it("falls back to the category and excludes the fund itself", () => {
    const { alternatives, basis } = findAlternatives("SPLG", "Large Blend");
    expect(basis).toBe("category");
    expect(alternatives.map((a) => a.symbol)).not.toContain("SPLG");
    expect(alternatives.every((a) => a.name !== a.symbol)).toBe(true);
  });

  it("returns nothing rather than guessing for an unknown fund and category", () => {
    expect(findAlternatives("XYZQ", "Some Bespoke Category").alternatives).toHaveLength(0);
    expect(findAlternatives("XYZQ", null).basis).toBeNull();
  });
});
