/**
 * The sentiment gauge. Pure, so it is fully testable — which matters more than
 * usual here, because this is a number we invented and put on the homepage. If
 * we are going to show the user a score, its behaviour has to be pinned down.
 *
 * The case that earns its keep is the missing-input one: a component with no
 * data must be dropped and the remaining weights renormalized, NOT silently
 * treated as a neutral 50. Substituting 50 for "unknown" drags every partial
 * reading toward the middle and makes a one-input gauge look as confident as a
 * three-input one.
 */

import { describe, it, expect } from "vitest";
import { computeSentiment, scoreVolatility, scoreBreadth, scoreMomentum } from "@/lib/home/sentiment";

describe("component scales", () => {
  it("inverts the VIX — high volatility is fear", () => {
    expect(scoreVolatility(12)).toBe(100); // complacent
    expect(scoreVolatility(35)).toBe(0); // panic
    expect(scoreVolatility(10)).toBe(100); // clamped, not negative-greed
    expect(scoreVolatility(60)).toBe(0); // clamped
    expect(scoreVolatility(23.5)).toBeCloseTo(50, 0); // midpoint
  });

  it("passes breadth through, clamped", () => {
    expect(scoreBreadth(0)).toBe(0);
    expect(scoreBreadth(55)).toBe(55);
    expect(scoreBreadth(140)).toBe(100);
  });

  it("centres momentum on a flat tape", () => {
    expect(scoreMomentum(0)).toBe(50);
    expect(scoreMomentum(2)).toBe(100);
    expect(scoreMomentum(-2)).toBe(0);
    expect(scoreMomentum(10)).toBe(100); // saturates
  });
});

describe("computeSentiment", () => {
  it("returns null when nothing is available — an absent gauge, not a neutral one", () => {
    expect(computeSentiment({ vixLevel: null, breadthPct: null, sp500ChangePct: null })).toBeNull();
  });

  it("scores a fearful tape low", () => {
    const s = computeSentiment({ vixLevel: 34, breadthPct: 10, sp500ChangePct: -1.8 });
    expect(s).not.toBeNull();
    expect(s!.score).toBeLessThan(25);
    expect(s!.label).toBe("Extreme Fear");
    expect(s!.confidence).toBe("high");
  });

  it("scores a greedy tape high", () => {
    const s = computeSentiment({ vixLevel: 12.5, breadthPct: 95, sp500ChangePct: 1.5 });
    expect(s!.score).toBeGreaterThan(75);
    expect(s!.label).toBe("Extreme Greed");
  });

  it("renormalizes over present components rather than defaulting the missing ones to 50", () => {
    // Volatility alone, at maximum fear. If the missing breadth and momentum
    // were treated as a neutral 50, the 0.5 volatility weight would drag this
    // to ~25 and it would read as mere "Fear". Renormalized over the one
    // component we actually have, it is correctly 0 — extreme fear.
    const s = computeSentiment({ vixLevel: 35, breadthPct: null, sp500ChangePct: null });
    expect(s!.score).toBe(0);
    expect(s!.confidence).toBe("low");
  });

  it("reports confidence from how many components had data", () => {
    expect(computeSentiment({ vixLevel: 20, breadthPct: 50, sp500ChangePct: 0 })!.confidence).toBe("high");
    expect(computeSentiment({ vixLevel: 20, breadthPct: 50, sp500ChangePct: null })!.confidence).toBe("medium");
    expect(computeSentiment({ vixLevel: 20, breadthPct: null, sp500ChangePct: null })!.confidence).toBe("low");
  });

  it("gives a missing component zero contribution, not a fabricated one", () => {
    const s = computeSentiment({ vixLevel: 20, breadthPct: null, sp500ChangePct: null })!;
    const breadth = s.components.find((c) => c.name === "Market breadth")!;
    expect(breadth.value).toBeNull();
    expect(breadth.contribution).toBe(0);
  });

  it("stays inside 0-100 for absurd inputs", () => {
    const s = computeSentiment({ vixLevel: 900, breadthPct: -50, sp500ChangePct: -99 })!;
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });
});
