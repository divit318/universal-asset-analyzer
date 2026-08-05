import { describe, it, expect } from "vitest";
import { verifyGroundingWithFacts, type GroundedFact } from "@/lib/ai/grounding";

const NOW = Date.parse("2026-08-05T17:00:00");

const FACTS: GroundedFact[] = [
  { value: 16.4, kind: "percent", entity: "AAPL", metric: "revenue growth", period: "yoy" },
  { value: 12.1, kind: "percent", entity: "MSFT", metric: "revenue growth", period: "yoy" },
  { value: 32.6, kind: "percent", entity: "AAPL", metric: "operating margin" },
  { value: 27.6, kind: "percent", entity: "AAPL", metric: "net margin" },
  { value: 465.2e9, kind: "magnitude", entity: "AAPL", metric: "revenue", period: "fy" },
  { value: -8.7, kind: "percent", entity: "AAPL", metric: "price change", period: "day", sessionDate: "2026-07-31" },
  { value: 0.79, kind: "percent", entity: null, metric: "portfolio day change", period: "day", sessionDate: "2026-08-05" },
];

const verify = (text: string) => verifyGroundingWithFacts(text, FACTS, { now: NOW });

describe("verifyGroundingWithFacts — right number, wrong context (F-22f)", () => {
  it("catches an entity swap: AAPL's growth attributed to MSFT", () => {
    const r = verify("MSFT revenue growth reached 16.4% this year.");
    expect(r.contextViolations).toHaveLength(1);
    expect(r.contextViolations[0]).toContain("AAPL");
    expect(r.level).toBe("low");
  });

  it("catches a direction inversion: growth described as a decline", () => {
    const r = verify("AAPL revenue declined 16.4% year over year.");
    expect(r.contextViolations.length).toBeGreaterThan(0);
    expect(r.contextViolations[0]).toContain("opposite direction");
  });

  it("catches a metric swap: operating margin sold as net margin", () => {
    const r = verify("AAPL net margin is 32.6%.");
    expect(r.contextViolations).toHaveLength(1);
    expect(r.contextViolations[0]).toContain("operating margin");
  });

  it("catches a period swap: FY revenue sold as a quarter", () => {
    const r = verify("AAPL revenue was $465.2B in the most recent quarter.");
    expect(r.contextViolations).toHaveLength(1);
    expect(r.contextViolations[0]).toContain("fy");
  });

  it("catches the F-22 case itself: a finished session's move sold as today", () => {
    const r = verify("AAPL is down 8.7% today.");
    expect(r.contextViolations).toHaveLength(1);
    expect(r.contextViolations[0]).toContain("2026-07-31");
    expect(r.level).toBe("low");
  });

  it("passes the same claims stated correctly", () => {
    for (const text of [
      "AAPL revenue growth reached 16.4% year over year.",
      "AAPL operating margin is 32.6% and net margin is 27.6%.",
      "AAPL revenue was $465.2B for the fiscal year.",
      "The portfolio is up 0.8% today.",
    ]) {
      const r = verify(text);
      expect(r.contextViolations).toEqual([]);
      expect(r.unsupportedNumbers).toEqual([]);
    }
  });

  it("still catches plain fabrications through the base pass", () => {
    const r = verify("AAPL services revenue hit $131.4B.");
    expect(r.unsupportedNumbers.length).toBeGreaterThan(0);
    expect(r.level).not.toBe("high");
  });

  it("a current-session 'today' claim passes the as-of check", () => {
    const r = verify("The portfolio moved +0.79% today.");
    expect(r.contextViolations).toEqual([]);
  });

  it("does not cry wolf on a dense multi-metric stat sentence", () => {
    const r = verify("AAPL operating margin 32.6%, net margin 27.6%, revenue growth +16.4% year over year.");
    expect(r.contextViolations).toEqual([]);
    expect(r.unsupportedNumbers).toEqual([]);
  });

  it("a metric named in an earlier clause does not govern a later figure", () => {
    // "revenue growth" belongs to the first clause; 27.6% in the second clause
    // is correctly the net margin and must not be tested against "revenue growth".
    const r = verify("AAPL revenue growth hit 16.4%, while net margin held at 27.6%.");
    expect(r.contextViolations).toEqual([]);
  });

  it("attributes claims by nearest mention when two entities share a sentence", () => {
    const r = verifyGroundingWithFacts(
      "Microsoft's revenue grew 12.1% while Apple's grew 16.4%.",
      FACTS,
      { now: NOW, entityAliases: { AAPL: ["Apple"], MSFT: ["Microsoft"] } },
    );
    expect(r.contextViolations).toEqual([]);
    const swapped = verifyGroundingWithFacts(
      "Microsoft's revenue grew 16.4% while Apple's grew 12.1%.",
      FACTS,
      { now: NOW, entityAliases: { AAPL: ["Apple"], MSFT: ["Microsoft"] } },
    );
    expect(swapped.contextViolations).toHaveLength(2);
  });
});
