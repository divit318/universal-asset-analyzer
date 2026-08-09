/**
 * One verdict, one score — the hero, the Conviction tab, and the AI narration
 * must be provably consistent for any ticker.
 *
 * These tests pin the three structural guarantees added in the 2026-08 demo
 * hardening:
 *   1. The AI verdict direction is a pure function of the composite score,
 *      aligned to lib/recommendation.ts's canonical bands (a "Buy 62/100"
 *      page can never carry a NEUTRAL hero again).
 *   2. The model cannot override that direction — coerceFields discards
 *      whatever the model emitted when the plan carries a composite.
 *   3. Every score figure the narration may quote is interpolated into the
 *      prompt with EXACTLY the formula the UI renders (round(points/max·100)).
 */

import { describe, expect, it } from "vitest";
import { scoreDirection, scoreToRecommendation, RECOMMENDATION_LABEL } from "@/lib/recommendation";
import { verdictFromScore, assembleVerdict, type VerdictPlan } from "@/lib/ai/verdict";
import { buildVerdictPrompt } from "@/lib/ai/report-sections";
import { buildEquityFacts } from "@/lib/ai/facts";
import type { CompanyContext } from "@/lib/ai/types";
import type { Quote, ScoreResult } from "@/lib/types";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const quote: Quote = {
  symbol: "SYF",
  name: "Synchrony Financial",
  price: 79.25,
  change: 0.51,
  changePercent: 0.65,
  currency: "USD",
  marketCap: 25_790_000_000,
  exchange: "NYSE",
  assetType: "EQUITY",
} as unknown as Quote;

function scoreResult(composite: number): ScoreResult {
  return {
    total: 67,
    composite,
    recommendation: scoreToRecommendation(composite),
    confidence: 87,
    rationale: "",
    signals: { fundamentals: 73, analysts: 62, momentum: 69, capitalAllocation: 60, sectorRotation: 50 },
    buckets: [
      { name: "Valuation", points: 21, max: 30, factors: [] },
      { name: "Quality", points: 21, max: 25, factors: [] },
      { name: "Growth", points: 9, max: 25, factors: [] },
    ],
  } as unknown as ScoreResult;
}

function ctx(composite: number): CompanyContext {
  return {
    symbol: "SYF",
    name: "Synchrony Financial",
    quote,
    snapshot: null,
    statements: null,
    analyst: null,
    momentum: null,
    score: scoreResult(composite),
    risks: [],
    filings: [],
    news: [],
    peers: null,
    profile: null,
  } as unknown as CompanyContext;
}

function planFor(composite: number | null): VerdictPlan {
  return {
    kind: "equity",
    task: "investment-thesis",
    prompt: "",
    evidence: "",
    composite,
    fallback: { verdict: "neutral", name: "Synchrony Financial", subject: "stock", reviewHint: "" },
  };
}

/* ── 1. Direction ≡ recommendation bands ─────────────────────────────────── */

describe("verdict direction aligns with the canonical recommendation bands", () => {
  it("agrees with scoreToRecommendation for every score 0–100", () => {
    for (let s = 0; s <= 100; s++) {
      const rec = scoreToRecommendation(s);
      const dir = verdictFromScore(s);
      if (rec === "BUY" || rec === "STRONG_BUY") expect(dir).toBe("bullish");
      else if (rec === "SELL" || rec === "STRONG_SELL") expect(dir).toBe("bearish");
      else expect(dir).toBe("neutral");
      expect(dir).toBe(scoreDirection(s));
    }
  });

  it("a Buy-band composite (60–65) is bullish, not neutral — the old bug window", () => {
    for (const s of [60, 61, 62, 63, 64, 65]) {
      expect(scoreToRecommendation(s)).toBe("BUY");
      expect(verdictFromScore(s)).toBe("bullish");
    }
  });
});

/* ── 2. The model cannot override the computed direction ─────────────────── */

describe("assembleVerdict enforces the computed direction", () => {
  it("overrides a contradicting model verdict when the plan carries a composite", () => {
    const v = assembleVerdict(planFor(67), { verdict: "neutral", headline: "h", thesis: "t" }, "test-model");
    expect(v.verdict).toBe("bullish");
  });

  it("overrides in the bearish direction too", () => {
    const v = assembleVerdict(planFor(30), { verdict: "bullish", headline: "h", thesis: "t" }, "test-model");
    expect(v.verdict).toBe("bearish");
  });

  it("keeps the model's word only when there is no composite (macro)", () => {
    const v = assembleVerdict(planFor(null), { verdict: "bearish", headline: "h", thesis: "t" }, "test-model");
    expect(v.verdict).toBe("bearish");
  });
});

/* ── 3. Narration figures are interpolated, not free-written ─────────────── */

describe("the equity prompt states the established conclusions", () => {
  it("pins the exact verdict word and the composite in the REQUIREMENTS", () => {
    const { prompt } = buildVerdictPrompt(ctx(67), null);
    expect(prompt).toContain('MUST be exactly "bullish"');
    expect(prompt).toContain("67/100");
    expect(prompt).toContain("copied verbatim from the DATA block");
  });

  it("subscore percentages in the facts use the SAME formula the UI renders", () => {
    const c = ctx(67);
    const facts = buildEquityFacts(c).join("\n");
    for (const b of c.score!.buckets) {
      const uiPct = Math.round((b.points / b.max) * 100); // conviction-breakdown.tsx formula
      expect(facts).toContain(`${b.name}=${uiPct}%`);
    }
    expect(facts).toContain(`Composite score: ${c.score!.composite}/100`);
  });

  it("hero and conviction tab render the same label for the same score", () => {
    // Both components read RECOMMENDATION_LABEL[score.recommendation]; this
    // pins that a single ScoreResult produces a single label everywhere.
    const s = scoreResult(67);
    expect(RECOMMENDATION_LABEL[s.recommendation]).toBe("Buy");
    expect(verdictFromScore(s.composite)).toBe("bullish");
  });
});

/* ── 4. The narrated ACTION is pinned to the unified decision ────────────── */

describe("the prompt pins the unified portfolio action", () => {
  const portfolio = {
    fitScore: "71",
    fitTier: "good",
    reasons: "Strengthens underweight Technology",
    isInPortfolio: false,
    suggestedPct: "10.5",
    missingSectors: "Utilities",
    objective: "ai_optimized",
    action: "initiate",
    actionReason: "Research 82/100 (Strong Buy) and portfolio fit 71/100 both support a full-size position.",
  };

  it("states the computed decision as a hard requirement the model cannot change", () => {
    const { prompt, evidence } = buildVerdictPrompt(ctx(82), portfolio);
    expect(prompt).toContain('MUST be exactly "INITIATE"');
    expect(prompt).toContain("10.5% of the portfolio");
    expect(prompt).toContain("not yours to change");
    // The decision and its rationale are also in the evidence block, so the
    // grounding layer verifies any narrated action figure against them.
    expect(evidence).toContain("Computed portfolio decision");
    expect(evidence).toContain("Research 82/100");
  });

  it("omits the action requirement when no portfolio context was supplied", () => {
    const { prompt } = buildVerdictPrompt(ctx(82), null);
    expect(prompt).not.toContain("Computed portfolio decision");
    expect(prompt).not.toContain("recommended course of action");
  });
});
