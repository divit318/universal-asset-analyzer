import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  selectCards,
  timelinessFromAge,
  INTEL_THRESHOLD,
  SUGGESTION_THRESHOLD,
  MAX_CARDS,
} from "@/lib/intel/score";
import type { IntelCandidate, IntelSignals } from "@/lib/intel/types";

const strong: IntelSignals = {
  relevance: 1,
  materiality: 0.9,
  timeliness: 0.9,
  novelty: 0.8,
  actionability: 0.8,
  confidence: 0.9,
  portfolioRelevance: 1,
};

const weak: IntelSignals = {
  relevance: 0.4,
  materiality: 0.3,
  timeliness: 0.3,
  novelty: 0.3,
  actionability: 0.3,
  confidence: 0.5,
  portfolioRelevance: 0,
};

function candidate(overrides: Partial<IntelCandidate> & { id: string }): IntelCandidate {
  return {
    category: "lead",
    eyebrow: "Research Lead",
    title: "Something worth investigating.",
    action: { label: "Investigate", kind: "navigate", href: "/research?symbol=TEST" },
    signals: strong,
    source: "computed",
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("scores strong signals above the threshold", () => {
    expect(scoreCandidate(strong)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("scores weak signals below the threshold", () => {
    expect(scoreCandidate(weak)).toBeLessThan(INTEL_THRESHOLD);
  });

  it("clamps out-of-range and non-finite dimensions", () => {
    const junk: IntelSignals = { ...strong, relevance: 5, materiality: -2, timeliness: NaN };
    const score = scoreCandidate(junk);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("weights relevance and materiality above timeliness", () => {
    const relevantStale = scoreCandidate({ ...weak, relevance: 1, materiality: 1 });
    const freshIrrelevant = scoreCandidate({ ...weak, timeliness: 1, novelty: 1 });
    expect(relevantStale).toBeGreaterThan(freshIrrelevant);
  });
});

describe("selectCards", () => {
  it("returns an empty array when nothing clears the threshold — the common case", () => {
    const cards = selectCards([candidate({ id: "a", signals: weak }), candidate({ id: "b", signals: weak })]);
    expect(cards).toEqual([]);
  });

  it("never returns more than MAX_CARDS", () => {
    const many = ["a", "b", "c", "d", "e"].map((id) => candidate({ id }));
    expect(selectCards(many).length).toBeLessThanOrEqual(MAX_CARDS);
  });

  it("suppresses dismissed/seen ids", () => {
    const cards = selectCards([candidate({ id: "a" }), candidate({ id: "b" })], {
      suppressedIds: new Set(["a"]),
    });
    expect(cards.map((c) => c.id)).toEqual(["b"]);
  });

  it("collapses duplicate ids to the highest-scored instance", () => {
    const cards = selectCards([
      candidate({ id: "dup", signals: { ...strong, materiality: 0.7 } }),
      candidate({ id: "dup", signals: strong }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].score).toBe(scoreCandidate(strong));
  });

  it("caps suggestions at one per set", () => {
    const cards = selectCards([
      candidate({ id: "s1", category: "suggestion" }),
      candidate({ id: "s2", category: "suggestion" }),
      candidate({ id: "s3", category: "suggestion" }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].category).toBe("suggestion");
  });

  it("holds suggestions to a stricter threshold than other categories", () => {
    const middling: IntelSignals = {
      relevance: 0.75,
      materiality: 0.6,
      timeliness: 0.5,
      novelty: 0.5,
      actionability: 0.6,
      confidence: 0.6,
      portfolioRelevance: 0.5,
    };
    const score = scoreCandidate(middling);
    expect(score).toBeGreaterThan(INTEL_THRESHOLD);
    expect(score).toBeLessThan(SUGGESTION_THRESHOLD);
    const asLead = selectCards([candidate({ id: "x", category: "lead", signals: middling })]);
    const asSuggestion = selectCards([candidate({ id: "x", category: "suggestion", signals: middling })]);
    expect(asLead).toHaveLength(1);
    expect(asSuggestion).toHaveLength(0);
  });

  it("prefers category diversity over a second card of the same category", () => {
    const slightlyWeaker: IntelSignals = { ...strong, materiality: 0.85 };
    const cards = selectCards(
      [
        candidate({ id: "lead1", category: "lead" }),
        candidate({ id: "lead2", category: "lead", signals: { ...strong, materiality: 0.88 } }),
        candidate({ id: "event1", category: "event", signals: slightlyWeaker }),
        candidate({ id: "pf1", category: "portfolio", signals: slightlyWeaker }),
      ],
      { maxCards: 3 },
    );
    const categories = cards.map((c) => c.category).sort();
    expect(categories).toEqual(["event", "lead", "portfolio"]);
  });

  it("fills remaining slots by score once each category is represented", () => {
    const cards = selectCards([
      candidate({ id: "lead1", category: "lead" }),
      candidate({ id: "lead2", category: "lead", signals: { ...strong, materiality: 0.85 } }),
    ]);
    expect(cards.map((c) => c.id)).toEqual(["lead1", "lead2"]);
  });

  it("orders the final set by score, highest first", () => {
    const cards = selectCards([
      candidate({ id: "low", category: "event", signals: { ...strong, materiality: 0.7 } }),
      candidate({ id: "high", category: "lead" }),
    ]);
    expect(cards[0].id).toBe("high");
    expect(cards[0].score).toBeGreaterThanOrEqual(cards[1].score);
  });
});

describe("timelinessFromAge", () => {
  it("is 1 for very fresh events", () => {
    expect(timelinessFromAge(30 * 60_000, 36)).toBe(1);
  });

  it("decays to 0 at the horizon", () => {
    expect(timelinessFromAge(36 * 3_600_000, 36)).toBe(0);
  });

  it("is monotonically non-increasing with age", () => {
    const a = timelinessFromAge(3 * 3_600_000, 36);
    const b = timelinessFromAge(20 * 3_600_000, 36);
    expect(a).toBeGreaterThan(b);
  });

  it("treats negative/invalid ages as stale, not fresh", () => {
    expect(timelinessFromAge(-100, 36)).toBe(0);
    expect(timelinessFromAge(NaN, 36)).toBe(0);
  });
});
