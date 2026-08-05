import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analysisIdempotencyKey,
  analysisInputHash,
  resolveProvider,
} from "@/lib/ai/analysis-provider";
import { TASK_REGISTRY, type TaskType } from "@/lib/ai/task-registry";
import { MovementAnalysisSchema, MovementWireSchema } from "@/lib/ai/schemas/movement";

const ENV_KEYS = ["AI_PROVIDER", "AI_TASK_EXPLAIN_MOVEMENT_PROVIDER", "AI_TASK_NL_SCREENER_PROVIDER"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveProvider (single-runtime, post sessions removal)", () => {
  it("routes every task to the chain runtime", () => {
    for (const task of Object.keys(TASK_REGISTRY) as TaskType[]) {
      expect(resolveProvider(task)).toBe("chain");
    }
  });

  it("the retired AI_PROVIDER and per-task provider pins no longer change routing", () => {
    process.env.AI_PROVIDER = "devin";
    process.env.AI_TASK_EXPLAIN_MOVEMENT_PROVIDER = "sessions";
    expect(resolveProvider("investment-thesis")).toBe("chain");
    expect(resolveProvider("explain-movement")).toBe("chain");
  });
});

describe("idempotency keys", () => {
  it("is stable for identical work and distinct for different work", () => {
    const h = analysisInputHash("the dossier");
    const a = analysisIdempotencyKey("explain-movement", "symbol:AAPL", h, 1);
    expect(a).toBe(analysisIdempotencyKey("explain-movement", "symbol:AAPL", h, 1));
    expect(a).not.toBe(analysisIdempotencyKey("explain-movement", "symbol:MSFT", h, 1));
    expect(a).not.toBe(analysisIdempotencyKey("explain-movement", "symbol:AAPL", h, 2));
    expect(a).not.toBe(analysisIdempotencyKey("explain-movement", "symbol:AAPL", analysisInputHash("other dossier"), 1));
  });
});

describe("MovementAnalysisSchema tolerances", () => {
  it("accepts a clean, wire-conformant output unchanged", () => {
    const clean = {
      summary: "The stock fell after earnings on heavy volume.",
      drivers: [
        { category: "earnings", description: "Earnings miss", evidence: "headline", direction: "bearish" },
      ],
      confidence: 62,
      persistence: "short-term",
    };
    const parsed = MovementAnalysisSchema.parse(clean);
    expect(parsed).toEqual(clean);
    expect(MovementWireSchema.safeParse(clean).success).toBe(true);
  });

  it("normalizes the documented small-model variants like the old parser", () => {
    const messy = {
      summary: "s",
      drivers: [
        { category: "Earnings", description: "d", evidence: ["a", "b"], direction: "Bullish" },
        { category: "made-up", description: "d2", evidence: "e", direction: "up" },
      ],
      confidence: "150",
      persistence: "Long-Term",
    };
    const parsed = MovementAnalysisSchema.parse(messy);
    expect(parsed.drivers[0].category).toBe("earnings");
    expect(parsed.drivers[0].evidence).toBe("a; b");
    expect(parsed.drivers[0].direction).toBe("bullish");
    expect(parsed.drivers[1].category).toBe("other");
    expect(parsed.drivers[1].direction).toBe("neutral");
    expect(parsed.confidence).toBe(100); // clamped
    expect(parsed.persistence).toBe("transient"); // unknown → fallback
  });

  it("survives missing drivers/confidence (defaults, no crash)", () => {
    const parsed = MovementAnalysisSchema.parse({ summary: "s", persistence: "durable" });
    expect(parsed.drivers).toEqual([]);
    expect(parsed.confidence).toBe(0);
  });
});

describe("text-mode schemas", () => {
  it("WatchlistDigest parse schema tolerates missing arrays", async () => {
    const { WatchlistDigestSchema } = await import("@/lib/ai/schemas/watchlist-digest");
    const parsed = WatchlistDigestSchema.parse({ summary: "s", topPicks: "not-an-array" });
    expect(parsed.topPicks).toEqual([]);
    expect(parsed.actionItems).toEqual([]);
  });
});
