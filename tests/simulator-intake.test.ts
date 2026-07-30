/**
 * Simulator intake (lib/portfolio/simulator/intake.ts) — the contract between
 * the Step B interview and the model. The AI decides WHAT to ask; these tests
 * pin the guards that stop a misbehaving model from corrupting the profile or
 * trapping the user: response validation, loop detection, the question cap.
 */
import { describe, expect, it } from "vitest";
import {
  buildIntakePrompt,
  cleanOptions,
  intakeAtCap,
  nextGap,
  parseIntakeResponse,
  MAX_FOLLOW_UPS,
} from "../lib/portfolio/simulator/intake";
import { PREFERENCE_QUESTIONS } from "../lib/portfolio/simulator/preferences";
import type { SimProfile } from "../lib/portfolio/simulator/types";

function profile(overrides: Partial<SimProfile> = {}): SimProfile {
  return {
    cash: 250_000,
    currency: "USD",
    horizon: "long",
    targetDate: null,
    objective: "growth",
    riskAppetite: 7,
    maxDrawdownPct: 35,
    role: "standalone",
    complementRef: null,
    preferences: {},
    followUps: [],
    intakeComplete: false,
    ...overrides,
  };
}

describe("buildIntakePrompt", () => {
  it("includes every Step A fact the AI needs to spot gaps and conflicts", () => {
    const p = buildIntakePrompt(profile());
    expect(p).toContain("250,000 USD");
    expect(p).toContain("long (7+ years)");
    expect(p).toContain("Growth"); // objective label from OBJECTIVES, not the raw id
    expect(p).toContain("7/10");
    expect(p).toContain("~35%");
    expect(p).toContain("standalone");
  });

  it("lists prior Q&A — including skipped questions with their assumptions — so the AI never re-asks", () => {
    const p = buildIntakePrompt(
      profile({
        followUps: [
          { question: "Any ESG exclusions?", answer: "No tobacco or weapons", assumption: null },
          { question: "Tax context?", answer: null, assumption: "Taxable US account" },
        ],
      }),
    );
    expect(p).toContain("Any ESG exclusions?");
    expect(p).toContain("No tobacco or weapons");
    expect(p).toContain("skipped — assume: Taxable US account");
  });

  /**
   * The model asked ONE open-ended question about asset allocation — a topic the
   * form now covers as `geography` plus `objective` — and the user skipped it. So
   * every standard topic must be in the prompt as CLOSED, whether the user
   * answered it or took the default: a topic the prompt does not mention is a
   * topic the model will happily re-ask.
   */
  it("declares every standard topic settled, answered or defaulted, so none is re-asked", () => {
    const p = buildIntakePrompt(profile());
    expect(p).toContain("ALREADY ASKED AND SETTLED");
    for (const q of PREFERENCE_QUESTIONS) expect(p).toContain(q.question);
    // Unanswered still appears — with its default — rather than being omitted.
    expect(p).toMatch(/not answered; ASSUME:/);
    expect(p).toMatch(/Do NOT ask about: anything in the settled block/);
  });

  it("passes an answered preference through with what it MEANS for the design", () => {
    const p = buildIntakePrompt(
      profile({ preferences: { geography: { optionIds: ["us_only"], other: null } } }),
    );
    expect(p).toContain("US only");
    expect(p).toContain("No ex-US equity instruments");
    expect(p).not.toMatch(/Where should the equity exposure sit\?[^\n]*\n\s*\(not answered/);
  });

  it("demands multiple choice, because an open question is a skipped question", () => {
    const p = buildIntakePrompt(profile());
    expect(p).toContain("MULTIPLE CHOICE");
    expect(p).toMatch(/Never ask an open-ended question/);
    expect(p).toContain("options");
    expect(p).toContain("assumptionIfSkipped");
    expect(p).toContain('{"done": true}');
    // "done" must read as the expected answer, not the last resort.
    expect(p).toMatch(/"done" is the expected answer/);
  });

  it("marks a complement mandate so the AI designs against the existing book", () => {
    const p = buildIntakePrompt(
      profile({ role: "complement", complementRef: { kind: "real", id: "real" } }),
    );
    expect(p).toContain("COMPLEMENT");
    expect(p).toContain("real portfolio");
  });
});

/**
 * The contradiction checks that removed the model from the common path entirely.
 * A coherent profile must reach generation without a single model call, because
 * every turn was measured at 25-195 seconds.
 */
describe("nextGap", () => {
  it("finds nothing to ask about a coherent profile", () => {
    expect(nextGap(profile({ objective: "balanced", riskAppetite: 5 }))).toBeNull();
  });

  it("asks which wins when the objective and the risk slider disagree", () => {
    const gap = nextGap(profile({ objective: "preserve_capital", riskAppetite: 9 }));
    expect(gap).not.toBeNull();
    expect(gap!.question).toMatch(/capital preservation.*9\/10/);
    // Options, and each one a complete answer — the whole point of the redesign.
    expect(gap!.options.length).toBeGreaterThanOrEqual(2);
    expect(gap!.assumptionIfSkipped).toBeTruthy();
    expect(gap!.source).toBe("gap");
  });

  it("catches an income objective contradicted by the income answer", () => {
    const gap = nextGap(
      profile({
        objective: "maximize_income",
        riskAppetite: 5,
        preferences: { income: { optionIds: ["none"], other: null } },
      }),
    );
    expect(gap!.question).toMatch(/maximum income/);
  });

  it("counts the remaining gaps exactly rather than estimating them", () => {
    // Two independent contradictions: defensive objective vs high risk, and a
    // short horizon vs the same high risk.
    const gap = nextGap(profile({ objective: "preserve_capital", riskAppetite: 9, horizon: "short" }));
    expect(gap!.estimatedRemaining).toBe(1);
  });

  it("does not re-ask a gap the user already answered or skipped", () => {
    const first = nextGap(profile({ objective: "preserve_capital", riskAppetite: 9 }))!;
    const after = nextGap(
      profile({
        objective: "preserve_capital",
        riskAppetite: 9,
        followUps: [{ question: first.question, answer: null, assumption: first.assumptionIfSkipped }],
      }),
    );
    expect(after).toBeNull();
  });
});

describe("parseIntakeResponse", () => {
  const base = profile();

  it("parses a valid question turn and clamps the remaining estimate", () => {
    const step = parseIntakeResponse(
      '{"done": false, "question": "How much must stay accessible same-day?", "options": ["None", "About 10%"], "assumptionIfSkipped": "10% held liquid", "estimatedRemaining": 99}',
      base,
    );
    expect(step).toEqual({
      done: false,
      question: "How much must stay accessible same-day?",
      options: ["None", "About 10%"],
      assumptionIfSkipped: "10% held liquid",
      estimatedRemaining: 5,
      source: "ai",
    });
  });

  /**
   * An option-less question is a degraded turn, not a failed one: the UI falls
   * back to free text. Failing the whole turn would replace a worse question with
   * no question, and the model does sometimes drop the field.
   */
  it("keeps a question that arrived with no options, for the free-text fallback", () => {
    const step = parseIntakeResponse('{"done": false, "question": "Anything else?"}', base);
    if (step.done) throw new Error("expected a question");
    expect(step.options).toEqual([]);
  });

  it("parses done:true, including when wrapped in markdown fences or preamble", () => {
    expect(parseIntakeResponse('{"done": true}', base)).toEqual({ done: true });
    expect(parseIntakeResponse('Here you go:\n```json\n{"done": true}\n```', base)).toEqual({
      done: true,
    });
  });

  it("substitutes a stated fallback when the model omits the skip assumption", () => {
    const step = parseIntakeResponse('{"done": false, "question": "Income needs?"}', base);
    if (step.done) throw new Error("expected a question");
    expect(step.assumptionIfSkipped.length).toBeGreaterThan(0);
    // 1, not 3: the follow-up round is now the exception, so the honest guess at
    // what remains is "probably nothing much".
    expect(step.estimatedRemaining).toBe(1);
  });

  it("treats a repeated question as done — a looping model is not a remaining gap", () => {
    const asked = profile({
      followUps: [{ question: "Any ESG exclusions?", answer: "None", assumption: null }],
    });
    const step = parseIntakeResponse(
      '{"done": false, "question": "Any ESG exclusions??", "assumptionIfSkipped": "none", "estimatedRemaining": 1}',
      asked,
    );
    expect(step).toEqual({ done: true });
  });

  it("throws on garbage, empty questions, and contract-breaking length", () => {
    expect(() => parseIntakeResponse("total nonsense", base)).toThrow();
    expect(() => parseIntakeResponse('{"done": false, "question": ""}', base)).toThrow();
    expect(() =>
      parseIntakeResponse(`{"done": false, "question": "${"x".repeat(500)}"}`, base),
    ).toThrow();
  });
});

describe("intakeAtCap", () => {
  it("ends the interview at the hard ceiling regardless of what the AI wants", () => {
    const many = Array.from({ length: MAX_FOLLOW_UPS }, (_, i) => ({
      question: `Q${i}?`,
      answer: "yes",
      assumption: null,
    }));
    expect(intakeAtCap(profile({ followUps: many }))).toBe(true);
    expect(intakeAtCap(profile({ followUps: many.slice(0, -1) }))).toBe(false);
  });
});
