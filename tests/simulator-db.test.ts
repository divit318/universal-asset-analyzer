/**
 * Simulator persistence (lib/db.ts simulation CRUD) and intake profile
 * validation (lib/portfolio/simulator/profile.ts) against an isolated
 * throwaway database.
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-simulator-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const {
  createSimulation,
  getSimulation,
  listSimulations,
  updateSimulation,
  deleteSimulation,
  duplicateSimulation,
} = await import("../lib/db");
const { parseSimProfile, parseSimHoldings, parseSimFollowUps } = await import(
  "../lib/portfolio/simulator/profile"
);
const { drawdownForRiskAppetite } = await import("../lib/portfolio/simulator/types");
import type { SimProfile } from "../lib/portfolio/simulator/types";

function profile(overrides: Partial<SimProfile> = {}): SimProfile {
  return {
    cash: 100_000,
    currency: "USD",
    horizon: "long",
    targetDate: null,
    objective: "balanced",
    riskAppetite: 5,
    maxDrawdownPct: 25,
    role: "standalone",
    complementRef: null,
    preferences: {},
    followUps: [],
    intakeComplete: false,
    ...overrides,
  };
}

describe("parseSimProfile", () => {
  it("accepts a valid quick-form payload and derives the drawdown", () => {
    const res = parseSimProfile({
      cash: "50000",
      currency: "usd",
      horizon: "medium",
      objective: "maximize_income",
      riskAppetite: 7,
    });
    expect("profile" in res).toBe(true);
    if ("profile" in res) {
      expect(res.profile.cash).toBe(50_000);
      expect(res.profile.currency).toBe("USD");
      expect(res.profile.maxDrawdownPct).toBe(drawdownForRiskAppetite(7));
      expect(res.profile.followUps).toEqual([]);
      expect(res.profile.intakeComplete).toBe(false);
    }
  });

  it("rejects non-positive cash, bad horizons, unknown objectives and out-of-range risk", () => {
    const base = { cash: 1000, currency: "USD", horizon: "long", objective: "balanced", riskAppetite: 5 };
    expect(parseSimProfile({ ...base, cash: 0 })).toHaveProperty("error");
    expect(parseSimProfile({ ...base, cash: -5 })).toHaveProperty("error");
    expect(parseSimProfile({ ...base, horizon: "forever" })).toHaveProperty("error");
    expect(parseSimProfile({ ...base, objective: "get_rich" })).toHaveProperty("error");
    expect(parseSimProfile({ ...base, riskAppetite: 11 })).toHaveProperty("error");
    expect(parseSimProfile({ ...base, currency: "DOLLARS" })).toHaveProperty("error");
  });

  it("drops a complement ref when the role is standalone", () => {
    const res = parseSimProfile({
      cash: 1000,
      currency: "USD",
      horizon: "long",
      objective: "growth",
      riskAppetite: 5,
      role: "standalone",
      complementRef: { kind: "real", id: "real" },
    });
    if ("profile" in res) expect(res.profile.complementRef).toBeNull();
    else throw new Error(res.error);
  });

  it("keeps a valid complement ref for the complement role", () => {
    const res = parseSimProfile({
      cash: 1000,
      currency: "USD",
      horizon: "long",
      objective: "growth",
      riskAppetite: 5,
      role: "complement",
      complementRef: { kind: "simulation", id: "abc" },
    });
    if ("profile" in res) expect(res.profile.complementRef).toEqual({ kind: "simulation", id: "abc" });
    else throw new Error(res.error);
  });
});

describe("parseSimHoldings", () => {
  const voo = {
    symbol: "voo",
    name: " Vanguard S&P 500 ETF ",
    assetClass: "etf",
    currency: "usd",
    quantity: "10",
    targetWeight: 60,
    rationale: "Core US equity exposure",
    addedBy: "ai",
  };

  it("normalizes symbol/currency casing, trims names and coerces numerics", () => {
    const res = parseSimHoldings([voo]);
    if ("error" in res) throw new Error(res.error);
    expect(res.holdings[0]).toEqual({
      symbol: "VOO",
      name: "Vanguard S&P 500 ETF",
      assetClass: "etf",
      currency: "USD",
      quantity: 10,
      targetWeight: 60,
      rationale: "Core US equity exposure",
      addedBy: "ai",
    });
  });

  it("allows a symbol-less cash sleeve but nothing else without a symbol", () => {
    const cash = { ...voo, symbol: null, assetClass: "cash", name: "Cash" };
    expect("holdings" in parseSimHoldings([cash])).toBe(true);
    expect(parseSimHoldings([{ ...voo, symbol: null }])).toHaveProperty("error");
  });

  it("rejects NaN/zero/negative quantities — a persisted NaN would poison every evaluation", () => {
    expect(parseSimHoldings([{ ...voo, quantity: "abc" }])).toHaveProperty("error");
    expect(parseSimHoldings([{ ...voo, quantity: 0 }])).toHaveProperty("error");
    expect(parseSimHoldings([{ ...voo, quantity: -1 }])).toHaveProperty("error");
    expect(parseSimHoldings([{ ...voo, quantity: Infinity }])).toHaveProperty("error");
  });

  it("rejects bad symbols, unknown asset classes, bad weights and non-arrays", () => {
    expect(parseSimHoldings([{ ...voo, symbol: "not a ticker!!" }])).toHaveProperty("error");
    expect(parseSimHoldings([{ ...voo, assetClass: "meme" }])).toHaveProperty("error");
    expect(parseSimHoldings([{ ...voo, targetWeight: 101 }])).toHaveProperty("error");
    expect(parseSimHoldings([{ ...voo, targetWeight: -1 }])).toHaveProperty("error");
    expect(parseSimHoldings("VOO")).toHaveProperty("error");
    expect(parseSimHoldings([null])).toHaveProperty("error");
  });

  it("defaults an unknown addedBy to 'user', never to 'ai'", () => {
    const res = parseSimHoldings([{ ...voo, addedBy: "hacker" }]);
    if ("error" in res) throw new Error(res.error);
    expect(res.holdings[0].addedBy).toBe("user");
  });
});

describe("parseSimFollowUps", () => {
  it("accepts a valid history and defaults missing nullables", () => {
    const res = parseSimFollowUps([
      { question: "Liquidity needs?", answer: "20% same-day", assumption: null },
      { question: "Tax context?", answer: null, assumption: "Assumed taxable account" },
    ]);
    if ("error" in res) throw new Error(res.error);
    expect(res.followUps).toHaveLength(2);
    expect(res.followUps[1].answer).toBeNull();
  });

  it("treats undefined as empty and rejects malformed entries", () => {
    const empty = parseSimFollowUps(undefined);
    if ("error" in empty) throw new Error(empty.error);
    expect(empty.followUps).toEqual([]);
    expect(parseSimFollowUps("chat")).toHaveProperty("error");
    expect(parseSimFollowUps([{ answer: "no question" }])).toHaveProperty("error");
    expect(parseSimFollowUps([{ question: "Q?", answer: 42 }])).toHaveProperty("error");
  });
});

describe("drawdownForRiskAppetite", () => {
  it("maps the 1-10 scale to 5%-50% linearly and clamps out-of-range input", () => {
    expect(drawdownForRiskAppetite(1)).toBe(5);
    expect(drawdownForRiskAppetite(5)).toBe(25);
    expect(drawdownForRiskAppetite(10)).toBe(50);
    expect(drawdownForRiskAppetite(0)).toBe(5);
    expect(drawdownForRiskAppetite(99)).toBe(50);
  });
});

describe("simulation CRUD", () => {
  it("creates a draft with empty holdings and round-trips the profile", () => {
    const sim = createSimulation("Retirement 2045", profile());
    expect(sim.status).toBe("draft");
    expect(sim.holdings).toEqual([]);
    expect(sim.thesis).toBeNull();
    expect(sim.headline).toBeNull();
    expect(getSimulation(sim.id)?.profile).toEqual(profile());
  });

  it("lists newest-updated first", async () => {
    const a = createSimulation("A", profile());
    createSimulation("B", profile());
    // updated_at has millisecond precision; make sure the update is strictly later.
    await new Promise((r) => setTimeout(r, 5));
    updateSimulation(a.id, { name: "A2" });
    const names = listSimulations().map((s) => s.name);
    expect(names.indexOf("A2")).toBeLessThan(names.indexOf("B"));
  });

  it("applies partial updates without clobbering other fields", () => {
    const sim = createSimulation("Partial", profile());
    updateSimulation(sim.id, {
      holdings: [
        {
          symbol: "VOO",
          name: "Vanguard S&P 500 ETF",
          assetClass: "etf",
          currency: "USD",
          quantity: 10,
          targetWeight: 60,
          rationale: "Core US equity exposure",
          addedBy: "ai",
        },
      ],
    });
    const after = getSimulation(sim.id)!;
    expect(after.holdings).toHaveLength(1);
    expect(after.name).toBe("Partial");
    expect(after.profile).toEqual(profile());
    expect(after.updatedAt >= sim.updatedAt).toBe(true);
  });

  it("returns null when updating a missing id", () => {
    expect(updateSimulation("nope", { name: "X" })).toBeNull();
  });

  it("duplicates everything except identity, and never duplicates a promotion", () => {
    const sim = createSimulation("Promoted one", profile());
    updateSimulation(sim.id, { status: "promoted", promotedAt: new Date().toISOString() });
    const copy = duplicateSimulation(sim.id)!;
    expect(copy.id).not.toBe(sim.id);
    expect(copy.name).toBe("Promoted one (copy)");
    expect(copy.status).toBe("complete");
    expect(copy.promotedAt).toBeNull();
    expect(copy.profile).toEqual(profile());
  });

  it("deletes and reports missing ids", () => {
    const sim = createSimulation("Doomed", profile());
    expect(deleteSimulation(sim.id)).toBe(true);
    expect(deleteSimulation(sim.id)).toBe(false);
    expect(getSimulation(sim.id)).toBeNull();
  });

  it("caps a duplicate's name at the same 80 characters the API enforces", () => {
    const longName = "X".repeat(80);
    const sim = createSimulation(longName, profile());
    const copy = duplicateSimulation(sim.id)!;
    expect(copy.name.length).toBeLessThanOrEqual(80);
    expect(copy.name.endsWith("(copy)")).toBe(true);
  });

  it("round-trips unicode names and rich profiles byte-exactly", () => {
    const p = profile({
      followUps: [{ question: "ESG exclusions?", answer: "No tobacco — «zéro» 🍀", assumption: null }],
      intakeComplete: true,
    });
    const sim = createSimulation("Rentenportfolio « México » 日本 🚀", p);
    const back = getSimulation(sim.id)!;
    expect(back.name).toBe("Rentenportfolio « México » 日本 🚀");
    expect(back.profile).toEqual(p);
  });

  it("is durable across connections: a second, independent SQLite connection reads what this one wrote", async () => {
    const sim = createSimulation("Cross-process", profile());
    // Same guarantee a server restart relies on: the row lives in the file,
    // not in the writing connection's memory.
    const { DatabaseSync } = await import("node:sqlite");
    const second = new DatabaseSync(process.env.DB_PATH!);
    const row = second
      .prepare("SELECT name, status FROM simulation WHERE id = ?")
      .get(sim.id) as unknown as { name: string; status: string } | undefined;
    second.close();
    expect(row).toEqual({ name: "Cross-process", status: "draft" });
  });
});

/**
 * ── Backward compatibility for pre-`preferences` rows ────────────────────────
 *
 * `preferences` was added to `SimProfile` as a REQUIRED field after simulations
 * had already been saved. `rowToSimulation()` deserializes with a bare
 * `JSON.parse` and a cast, so every historical row yielded
 * `preferences === undefined` at runtime while the type insisted otherwise —
 * and `generatePortfolio()` dereferences it on its first two lines. The
 * observed effect was a `TypeError` before any generation stage ran, on a code
 * path whose only recovery was a "Try again" button that could never succeed.
 *
 * These write genuinely legacy JSON straight into the table with a second
 * SQLite connection — the only way to reproduce a row that no current write
 * path can produce — and then read it back through the normal accessors.
 */
describe("legacy simulation rows (written before `preferences` existed)", () => {
  /** Exactly the shape a pre-`preferences` row holds on disk. */
  const LEGACY_PROFILE = {
    cash: 100_000_000,
    currency: "USD",
    horizon: "long",
    targetDate: null,
    objective: "balanced",
    riskAppetite: 5,
    maxDrawdownPct: 25,
    role: "standalone",
    complementRef: null,
    // NO `preferences` key — that is the whole point.
    followUps: [
      {
        question:
          "What is your preferred approach to asset allocation — a globally diversified 60/40 split across public markets, or do you have a preference for regional or sector-specific tilts?",
        answer: null,
        assumption: "A globally diversified 60/40 split across public markets",
      },
    ],
    intakeComplete: true,
  };

  /** Insert a row with a hand-written profile blob, bypassing every validator. */
  async function insertLegacyRow(id: string, profileJson: unknown): Promise<void> {
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(process.env.DB_PATH!);
    const now = new Date().toISOString();
    raw
      .prepare(
        `INSERT INTO simulation (id, name, status, profile, holdings, created_at, updated_at)
         VALUES (?, ?, 'complete', ?, '[]', ?, ?)`,
      )
      .run(id, `Legacy ${id}`, JSON.stringify(profileJson), now, now);
    raw.close();
  }

  it("proves the fixture really lacks `preferences`, so this tests what it claims to", () => {
    expect("preferences" in LEGACY_PROFILE).toBe(false);
  });

  it("gives a legacy row the canonical default `preferences` on read", async () => {
    await insertLegacyRow("legacy-basic", LEGACY_PROFILE);
    const sim = getSimulation("legacy-basic")!;
    // `{}` is the canonical default: every consumer treats an absent topic as
    // "not answered" and applies the documented default, which is exactly true
    // of a row that predates the question being asked.
    expect(sim.profile.preferences).toEqual({});
  });

  it("preserves every other legacy field byte for byte", async () => {
    await insertLegacyRow("legacy-preserve", LEGACY_PROFILE);
    const p = getSimulation("legacy-preserve")!.profile;
    expect(p.cash).toBe(100_000_000);
    expect(p.currency).toBe("USD");
    expect(p.horizon).toBe("long");
    expect(p.objective).toBe("balanced");
    expect(p.riskAppetite).toBe(5);
    expect(p.maxDrawdownPct).toBe(25);
    expect(p.role).toBe("standalone");
    expect(p.targetDate).toBeNull();
    expect(p.complementRef).toBeNull();
    // The interview history survives intact, including the skipped answer and
    // its stated assumption — no user data is dropped to fix the crash.
    expect(p.followUps).toEqual(LEGACY_PROFILE.followUps);
    // Load-bearing: `intakeComplete` is what lets generation be attempted at
    // all, so flattening it would hide the bug rather than fix it.
    expect(p.intakeComplete).toBe(true);
  });

  it("normalizes through listSimulations too, not just getSimulation", async () => {
    await insertLegacyRow("legacy-list", LEGACY_PROFILE);
    const found = listSimulations().find((s) => s.id === "legacy-list")!;
    expect(found.profile.preferences).toEqual({});
  });

  it("defaults a missing `followUps` array as well — the same failure class", async () => {
    // `followUps` is dereferenced unguarded by profileFacts, buildIntakePrompt,
    // nextGap and two components. An empty history invents nothing.
    const { preferences: _p, followUps: _f, ...noCollections } = {
      ...LEGACY_PROFILE,
      preferences: undefined,
    };
    await insertLegacyRow("legacy-nofollowups", noCollections);
    const p = getSimulation("legacy-nofollowups")!.profile;
    expect(p.followUps).toEqual([]);
    expect(p.preferences).toEqual({});
  });

  it("falls back to the canonical default for a corrupt preferences blob", async () => {
    // An unreadable answer is an unanswered question, not a broken simulation.
    await insertLegacyRow("legacy-corrupt", { ...LEGACY_PROFILE, preferences: "not an object" });
    expect(getSimulation("legacy-corrupt")!.profile.preferences).toEqual({});
  });

  it("keeps a legacy row's answers out of the way of a modern one on the same read", async () => {
    // Regression guard against a shared-mutable default: two rows read in one
    // pass must not observe each other's preferences object.
    await insertLegacyRow("legacy-iso", LEGACY_PROFILE);
    const modern = createSimulation(
      "Modern iso",
      profile({ preferences: { geography: { optionIds: ["us_only"], other: null } } }),
    );
    const legacy = getSimulation("legacy-iso")!;
    expect(legacy.profile.preferences).toEqual({});
    expect(getSimulation(modern.id)!.profile.preferences).toEqual({
      geography: { optionIds: ["us_only"], other: null },
    });
  });

  it("duplicateSimulation copies a legacy row into a compatible, healed one", async () => {
    await insertLegacyRow("legacy-dup", LEGACY_PROFILE);
    const copy = duplicateSimulation("legacy-dup")!;
    expect(copy.profile.preferences).toEqual({});
    // The duplicate reads through getSimulation before writing, so the copy is
    // persisted already-normalized: the stored JSON now has the key.
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(process.env.DB_PATH!);
    const row = raw.prepare("SELECT profile FROM simulation WHERE id = ?").get(copy.id) as unknown as
      | { profile: string }
      | undefined;
    raw.close();
    expect("preferences" in JSON.parse(row!.profile)).toBe(true);
    // And the spec itself is still the same spec.
    expect(copy.profile.cash).toBe(100_000_000);
    expect(copy.profile.followUps).toEqual(LEGACY_PROFILE.followUps);
  });

  it("leaves a modern row completely unchanged — normalization is idempotent", async () => {
    const rich = profile({
      intakeComplete: true,
      preferences: {
        liquidity: { optionIds: ["moderate"], other: null },
        exclusions: { optionIds: ["fossil", "sin"], other: "nothing from my employer" },
        breadth: { optionIds: ["reits", "commodities"], other: null },
      },
      followUps: [{ question: "Which wins?", answer: "Preserve capital", assumption: null }],
    });
    const sim = createSimulation("Modern untouched", rich);
    // Round-trips to exactly what was handed in, twice — a second read must not
    // drift either.
    expect(getSimulation(sim.id)!.profile).toEqual(rich);
    expect(getSimulation(sim.id)!.profile).toEqual(getSimulation(sim.id)!.profile);
    expect(updateSimulation(sim.id, { name: "Renamed" })!.profile).toEqual(rich);
  });

  /**
   * The actual release-blocker assertion: a legacy row and a modern row with no
   * preferences answered must drive generation identically. Every deterministic
   * input is compared — the permitted asset classes, the fallback allocation
   * used when the AI fails, and the two prompts the model sees. If those are
   * equal, generation is equal.
   */
  it("produces identical generation inputs for a legacy row and an equivalent modern row", async () => {
    const { allowedClassesFor } = await import("../lib/portfolio/simulator/preferences");
    const {
      buildAllocationPrompt,
      buildSelectionPrompt,
      candidateFilterFor,
      fallbackAllocation,
    } = await import("../lib/portfolio/simulator/generate");

    await insertLegacyRow("legacy-gen", LEGACY_PROFILE);
    const legacy = getSimulation("legacy-gen")!.profile;
    const modern = createSimulation(
      "Modern gen",
      profile({
        cash: 100_000_000,
        intakeComplete: true,
        followUps: LEGACY_PROFILE.followUps,
      }),
    ).profile;

    // 1. Neither throws. These four are the lines that used to TypeError.
    expect(() => allowedClassesFor(legacy.preferences)).not.toThrow();
    expect(() => candidateFilterFor(legacy.preferences)).not.toThrow();
    expect(() => fallbackAllocation(legacy)).not.toThrow();
    expect(() => buildAllocationPrompt(legacy)).not.toThrow();

    // 2. And they agree with the modern row, exactly.
    expect([...allowedClassesFor(legacy.preferences)].sort()).toEqual(
      [...allowedClassesFor(modern.preferences)].sort(),
    );
    expect(fallbackAllocation(legacy)).toEqual(fallbackAllocation(modern));
    expect(buildAllocationPrompt(legacy)).toBe(buildAllocationPrompt(modern));

    const alloc = fallbackAllocation(legacy);
    expect(buildSelectionPrompt(legacy, alloc)).toBe(buildSelectionPrompt(modern, alloc));
  });
});
