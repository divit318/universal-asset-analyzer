/**
 * The intake question catalogue and the two answers that are hard constraints.
 *
 * These exist because of a specific, observed failure. The AI interview asked ONE
 * open-ended question — "what is your preferred approach to asset allocation, a
 * globally diversified 60/40 split across public markets, or a preference for
 * regional or sector-specific tilts?" — the user skipped it rather than compose
 * prose, and the portfolio was designed on a guessed default after 25-195 seconds
 * of local inference. Every topic in that interview's brief is now a fixed
 * multiple-choice question here.
 *
 * Two of them are instructions rather than preferences ("no tobacco", "funds and
 * ETFs only"), and a 7B model has been observed stating a constraint and then
 * violating it in the same response — so those two are enforced in code, and that
 * enforcement is what most of this file pins.
 */
import { describe, expect, it } from "vitest";
import {
  PREFERENCE_QUESTIONS,
  allowedClassesFor,
  answerLabel,
  describePreferences,
  exclusionReason,
  fundsOnly,
  isAnswered,
  profileGaps,
  type SimPreferences,
} from "../lib/portfolio/simulator/preferences";
import { parseSimPreferences } from "../lib/portfolio/simulator/profile";
import { CURATED_UNIVERSE } from "../lib/portfolio/simulator/universe";
import { OBJECTIVES } from "../lib/portfolio/engines/optimize";

describe("the question catalogue", () => {
  it("covers every topic the AI interview used to be told to probe", () => {
    // The intake prompt's old topic list, which is exactly what should no longer
    // need an open question.
    expect(PREFERENCE_QUESTIONS.map((q) => q.topic)).toEqual([
      "liquidity",
      "income",
      "tax",
      "exclusions",
      "geography",
      "concentration",
      "rebalancing",
      "breadth",
    ]);
  });

  /**
   * The user's requirement was explicit: options good enough that the large
   * majority never need "Other". Four is the floor for that; two-option questions
   * are the yes/no framings that push people to Other.
   */
  it("offers 4-6 distinct options per question, each with a stated implication", () => {
    for (const q of PREFERENCE_QUESTIONS) {
      expect(q.options.length, `${q.topic} option count`).toBeGreaterThanOrEqual(4);
      expect(q.options.length, `${q.topic} option count`).toBeLessThanOrEqual(6);

      const ids = q.options.map((o) => o.id);
      expect(new Set(ids).size, `${q.topic} duplicate ids`).toBe(ids.length);
      const labels = q.options.map((o) => o.label.toLowerCase());
      expect(new Set(labels).size, `${q.topic} duplicate labels`).toBe(labels.length);

      for (const o of q.options) {
        // The failure mode is VAGUENESS, not brevity — "US only" is a perfectly
        // clear seven-character answer, while "Moderate" is a non-answer at eight.
        // So this checks for the placeholder vocabulary directly.
        expect(o.label, `${q.topic}/${o.id} is a vague placeholder`).not.toMatch(
          /^(other|n\/?a|none|moderate|balanced|medium|average|some|it depends|not sure|standard|default)\.?$/i,
        );
        // The exclusive "none of these" option is exempt: "No exclusions." IS the
        // complete implication, and padding it would be worse than short.
        if (o.id === q.exclusiveId) continue;
        expect(o.implication.length, `${q.topic}/${o.id} implication`).toBeGreaterThan(20);
      }
    }
  });

  it("states a skip default for every question, in both the user's and the model's words", () => {
    for (const q of PREFERENCE_QUESTIONS) {
      expect(q.defaultLabel.length, `${q.topic} defaultLabel`).toBeGreaterThan(10);
      expect(q.defaultImplication.length, `${q.topic} defaultImplication`).toBeGreaterThan(10);
    }
  });

  it("gives the multi-select questions an exclusive 'none of these' option", () => {
    for (const q of PREFERENCE_QUESTIONS.filter((x) => x.multi)) {
      expect(q.exclusiveId, `${q.topic} needs an exclusive option`).toBeTruthy();
      expect(q.options.some((o) => o.id === q.exclusiveId)).toBe(true);
    }
  });
});

describe("describePreferences", () => {
  it("states an unanswered topic with its default rather than omitting it", () => {
    const text = describePreferences({});
    for (const q of PREFERENCE_QUESTIONS) expect(text).toContain(q.question);
    // Omitting a topic is what let the model decide it was still an open question.
    expect(text).toContain("not answered; ASSUME:");
  });

  it("renders an answer with the implication the design must honour", () => {
    const text = describePreferences({ tax: { optionIds: ["taxable_us_high"], other: null } });
    expect(text).toContain("high bracket");
    expect(text).toContain("municipal bonds (MUB)");
  });

  it("passes free-text 'Other' through verbatim — only the model can interpret it", () => {
    const text = describePreferences({
      exclusions: { optionIds: [], other: "nothing issued by my employer, Acme Corp" },
    });
    expect(text).toContain('The client also specified: "nothing issued by my employer, Acme Corp"');
  });
});

describe("allowedClassesFor", () => {
  it("defaults an unanswered breadth question to core plus listed REITs", () => {
    // Must match the question's own defaultLabel, or the prompt promises one thing
    // and the enforcement does another.
    expect([...allowedClassesFor({})].sort()).toEqual(["bond", "cash", "equity", "etf", "reit"]);
  });

  it("honours 'public stocks, ETFs and investment-grade bonds only'", () => {
    const allowed = allowedClassesFor({ breadth: { optionIds: ["core_only"], other: null } });
    expect(allowed.has("reit")).toBe(false);
    expect(allowed.has("commodity")).toBe(false);
    expect(allowed.has("crypto")).toBe(false);
    expect(allowed.has("etf")).toBe(true);
  });

  it("unlocks exactly what was ticked, and nothing else", () => {
    const allowed = allowedClassesFor({
      breadth: { optionIds: ["commodities", "crypto"], other: null },
    });
    expect(allowed.has("commodity")).toBe(true);
    expect(allowed.has("crypto")).toBe(true);
    expect(allowed.has("reit")).toBe(false);
  });

  /** Ticking crypto under breadth AND excluding it is the user contradicting
   *  themselves across two questions; the explicit exclusion is the stricter
   *  instruction and must win. */
  it("lets a crypto exclusion override a crypto breadth tick", () => {
    const allowed = allowedClassesFor({
      breadth: { optionIds: ["crypto"], other: null },
      exclusions: { optionIds: ["crypto"], other: null },
    });
    expect(allowed.has("crypto")).toBe(false);
  });

  /** The curated equity menu is single-company names by construction, so leaving
   *  `equity` allowed would have the generator try to fill a budget from a menu
   *  where every candidate is forbidden. */
  it("drops the single-name equity class entirely under 'funds and ETFs only'", () => {
    const prefs: SimPreferences = { exclusions: { optionIds: ["single_names"], other: null } };
    expect(fundsOnly(prefs)).toBe(true);
    expect(allowedClassesFor(prefs).has("equity")).toBe(false);
    expect(allowedClassesFor(prefs).has("etf")).toBe(true);
  });
});

describe("exclusionReason", () => {
  const equity = (symbol: string, name: string, role = "") =>
    ({ symbol, name, role, assetClass: "equity" as const });

  it("allows anything when no exclusions are set", () => {
    expect(exclusionReason(equity("XOM", "Exxon Mobil", "energy"), {})).toBeNull();
  });

  it("catches the curated candidates each exclusion is meant to remove", () => {
    // These are real entries in CURATED_UNIVERSE, which is what makes this a test
    // of the rules rather than of contrived strings.
    const fossil: SimPreferences = { exclusions: { optionIds: ["fossil"], other: null } };
    expect(exclusionReason(equity("XOM", "Exxon Mobil", "energy / inflation hedge"), fossil)).toMatch(
      /fossil fuels/,
    );
    expect(
      exclusionReason(
        { symbol: "USO", name: "United States Oil Fund", role: "crude oil (tactical only)", assetClass: "commodity" },
        { ...fossil, breadth: { optionIds: ["commodities"], other: null } },
      ),
    ).toMatch(/fossil fuels/);

    const crypto: SimPreferences = { exclusions: { optionIds: ["crypto"], other: null } };
    expect(
      exclusionReason({ symbol: "BTC-USD", name: "Bitcoin", role: "crypto core", assetClass: "crypto" }, crypto),
    ).toBeTruthy();
  });

  it("does not catch an unrelated holding", () => {
    const fossil: SimPreferences = { exclusions: { optionIds: ["fossil"], other: null } };
    expect(exclusionReason(equity("JNJ", "Johnson & Johnson", "defensive healthcare dividend"), fossil)).toBeNull();
  });

  it("reports a forbidden asset class as the reason, so the drop can be explained", () => {
    const reason = exclusionReason(
      { symbol: "GLD", name: "SPDR Gold Shares", role: "gold", assetClass: "commodity" },
      { breadth: { optionIds: ["core_only"], other: null } },
    );
    expect(reason).toMatch(/outside the instrument types this mandate permits/);
  });

  it("blocks a single-name REIT but keeps the REIT fund, under 'funds and ETFs only'", () => {
    const prefs: SimPreferences = {
      exclusions: { optionIds: ["single_names"], other: null },
      breadth: { optionIds: ["reits"], other: null },
    };
    const [fund] = CURATED_UNIVERSE.reit; // VNQ — Vanguard Real Estate ETF
    expect(exclusionReason({ ...fund, assetClass: "reit" }, prefs)).toBeNull();
    expect(
      exclusionReason(
        { symbol: "O", name: "Realty Income Corp", role: "single-name net-lease income REIT", assetClass: "reit" },
        prefs,
      ),
    ).toMatch(/funds and ETFs only/);
  });
});

describe("parseSimPreferences", () => {
  it("accepts an empty or absent payload as 'nothing answered'", () => {
    expect(parseSimPreferences(undefined)).toEqual({ preferences: {} });
    expect(parseSimPreferences({})).toEqual({ preferences: {} });
  });

  /** A stale id is a question the user effectively did not answer — already a
   *  supported state with a documented default. Rejecting it would make every
   *  saved profile containing a since-removed option unloadable. */
  it("drops unknown topics and unknown option ids instead of failing the load", () => {
    const out = parseSimPreferences({
      geography: { optionIds: ["us_only", "moon_only"], other: null },
      astrology: { optionIds: ["leo"] },
    });
    expect(out).toEqual({ preferences: { geography: { optionIds: ["us_only"], other: null } } });
  });

  it("keeps only one answer on a single-select topic", () => {
    const out = parseSimPreferences({ geography: { optionIds: ["us_only", "global"] } });
    if ("error" in out) throw new Error(out.error);
    expect(out.preferences.geography?.optionIds).toHaveLength(1);
  });

  it("lets the exclusive option clear the rest, so a cleared filter stays cleared", () => {
    const out = parseSimPreferences({ exclusions: { optionIds: ["fossil", "none", "sin"] } });
    if ("error" in out) throw new Error(out.error);
    expect(out.preferences.exclusions?.optionIds).toEqual(["none"]);
  });

  it("treats an empty selection with no free text as unanswered", () => {
    const out = parseSimPreferences({ income: { optionIds: [], other: "   " } });
    if ("error" in out) throw new Error(out.error);
    expect(isAnswered(out.preferences.income)).toBe(false);
  });

  it("rejects a structurally wrong payload — that is a caller bug, not a stale answer", () => {
    expect(parseSimPreferences([])).toEqual({ error: "preferences must be an object" });
    expect(parseSimPreferences({ income: "steady" })).toHaveProperty("error");
    expect(parseSimPreferences({ income: { optionIds: "steady" } })).toHaveProperty("error");
  });

  it("keeps 'Other' text, trimmed and bounded", () => {
    const out = parseSimPreferences({ exclusions: { optionIds: [], other: `  ${"x".repeat(400)}  ` } });
    if ("error" in out) throw new Error(out.error);
    expect(out.preferences.exclusions?.other).toHaveLength(300);
  });

  it("ignores 'Other' on a question that does not offer it", () => {
    // `breadth` is a closed set of instrument types — free text there could not be
    // enforced, so accepting it would be a promise the generator cannot keep.
    const out = parseSimPreferences({ breadth: { optionIds: ["reits"], other: "and some art" } });
    if ("error" in out) throw new Error(out.error);
    expect(out.preferences.breadth?.other).toBeNull();
  });
});

describe("answerLabel", () => {
  it("joins the picked options and any free text into one readable answer", () => {
    expect(answerLabel("exclusions", { optionIds: ["fossil", "sin"], other: "no Acme Corp" })).toBe(
      "Fossil fuels and high-carbon energy; Tobacco, alcohol and gambling; no Acme Corp",
    );
  });
});

describe("profileGaps", () => {
  // Typed so the compiler rejects an objective id that does not exist. An earlier
  // draft used invented ids (`max_income`, `min_volatility`) and every check that
  // referenced one silently never fired — a contradiction detector reporting a
  // clean profile is worse than no detector.
  const base: Parameters<typeof profileGaps>[0] = {
    objective: "balanced",
    riskAppetite: 5,
    horizon: "long",
    preferences: {},
  };

  it("finds nothing wrong with a coherent profile", () => {
    expect(profileGaps(base)).toEqual([]);
  });

  /**
   * The regression guard for the invented-id bug: a check keyed on an objective
   * that does not exist fails OPEN, reporting no contradiction. Every real
   * objective is exercised here so a renamed id shows up as a behaviour change
   * rather than as silence.
   */
  it("runs without error for every objective that actually exists", () => {
    for (const objective of Object.keys(OBJECTIVES) as (keyof typeof OBJECTIVES)[]) {
      expect(() => profileGaps({ ...base, objective }), objective).not.toThrow();
    }
    // And the two defensive/aggressive families really do fire, which is what
    // proves the ids are the ones OBJECTIVES uses.
    expect(profileGaps({ ...base, objective: "preserve_capital", riskAppetite: 9 })).toHaveLength(1);
    expect(profileGaps({ ...base, objective: "minimize_volatility", riskAppetite: 9 })).toHaveLength(1);
    expect(profileGaps({ ...base, objective: "maximize_return", riskAppetite: 2 })).toHaveLength(1);
    expect(profileGaps({ ...base, objective: "growth", riskAppetite: 2 })).toHaveLength(1);
  });

  it("catches each contradiction it is meant to, with options and a default", () => {
    const cases: Parameters<typeof profileGaps>[0][] = [
      { ...base, objective: "preserve_capital", riskAppetite: 9 },
      { ...base, objective: "maximize_return", riskAppetite: 2 },
      { ...base, objective: "maximize_income", preferences: { income: { optionIds: ["none"], other: null } } },
      { ...base, horizon: "short", riskAppetite: 8 },
      { ...base, preferences: { liquidity: { optionIds: ["all"], other: null } } },
      {
        ...base,
        preferences: {
          exclusions: { optionIds: ["single_names"], other: null },
          concentration: { optionIds: ["unlimited"], other: null },
        },
      },
      {
        ...base,
        objective: "maximize_income",
        preferences: { tax: { optionIds: ["taxable_us_high"], other: null } },
      },
    ];
    for (const c of cases) {
      const gaps = profileGaps(c);
      expect(gaps.length, JSON.stringify(c)).toBeGreaterThan(0);
      for (const g of gaps) {
        // Every gap must be answerable by picking, not by writing.
        expect(g.options.length).toBeGreaterThanOrEqual(2);
        expect(g.assumptionIfSkipped.length).toBeGreaterThan(10);
        expect(g.id).toBeTruthy();
      }
    }
  });

  it("gives every gap a distinct id, so none can silently shadow another", () => {
    const all = profileGaps({
      objective: "preserve_capital",
      riskAppetite: 9,
      horizon: "short",
      preferences: {
        liquidity: { optionIds: ["all"], other: null },
        exclusions: { optionIds: ["single_names"], other: null },
        concentration: { optionIds: ["unlimited"], other: null },
      },
    });
    expect(new Set(all.map((g) => g.id)).size).toBe(all.length);
  });
});
