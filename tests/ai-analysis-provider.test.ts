import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analysisIdempotencyKey,
  analysisInputHash,
  resolveProvider,
} from "@/lib/ai/analysis-provider";
import { TASK_REGISTRY, type TaskType } from "@/lib/ai/task-registry";
import { toStructuredOutputSchema, SchemaConversionError } from "@/lib/ai/providers/devin/schema";
import { normalizeEpochMs } from "@/lib/ai/providers/devin/sweeper";
import {
  MovementAnalysisSchema,
  MovementWireSchema,
} from "@/lib/ai/schemas/movement";
import { z } from "zod";

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

describe("resolveProvider (Devin-primary policy, 2026-08-02)", () => {
  it("routes background tasks to the sessions runtime, everything else to the chain", () => {
    for (const [task, cfg] of Object.entries(TASK_REGISTRY) as [TaskType, { latency: string }][]) {
      expect(resolveProvider(task)).toBe(cfg.latency === "background" ? "sessions" : "chain");
    }
  });

  it("the retired AI_PROVIDER global flag no longer changes routing", () => {
    process.env.AI_PROVIDER = "ollama";
    expect(resolveProvider("investment-thesis")).toBe("sessions");
    expect(resolveProvider("explain-movement")).toBe("chain");
    process.env.AI_PROVIDER = "devin";
    expect(resolveProvider("explain-movement")).toBe("chain");
  });

  it("an explicit env pin overrides the policy, with legacy aliases accepted", () => {
    process.env.AI_TASK_EXPLAIN_MOVEMENT_PROVIDER = "sessions";
    expect(resolveProvider("explain-movement")).toBe("sessions");
    process.env.AI_TASK_EXPLAIN_MOVEMENT_PROVIDER = "devin"; // legacy alias
    expect(resolveProvider("explain-movement")).toBe("sessions");
    process.env.AI_TASK_NL_SCREENER_PROVIDER = "ollama"; // legacy alias → chain
    expect(resolveProvider("nl-screener")).toBe("chain");
  });

  it("ignores a garbage pin value", () => {
    process.env.AI_TASK_EXPLAIN_MOVEMENT_PROVIDER = "chatgpt";
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

describe("toStructuredOutputSchema", () => {
  it("converts the movement wire schema to self-contained Draft 7", () => {
    const json = toStructuredOutputSchema(MovementWireSchema);
    expect(json.$schema).toContain("draft-07");
    const s = JSON.stringify(json);
    expect(s.length).toBeLessThan(64 * 1024);
    expect(s).toContain('"confidence"');
    expect(s).toContain('"enum"');
  });

  it("rejects a schema over 64KB", () => {
    const big = z.object(
      Object.fromEntries(
        Array.from({ length: 2000 }, (_, i) => [`field_${i}`, z.string().describe("x".repeat(50))]),
      ),
    );
    expect(() => toStructuredOutputSchema(big)).toThrow(SchemaConversionError);
  });
});

describe("MovementAnalysisSchema tolerances (Ollama-path parity)", () => {
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
  it("TextWireSchema converts cleanly to Draft 7", async () => {
    const { TextWireSchema } = await import("@/lib/ai/schemas/text");
    const json = toStructuredOutputSchema(TextWireSchema);
    expect(JSON.stringify(json)).toContain('"text"');
  });

  it("WatchlistDigest wire schema converts; parse schema tolerates missing arrays", async () => {
    const { WatchlistDigestWireSchema, WatchlistDigestSchema } = await import("@/lib/ai/schemas/watchlist-digest");
    expect(() => toStructuredOutputSchema(WatchlistDigestWireSchema)).not.toThrow();
    const parsed = WatchlistDigestSchema.parse({ summary: "s", topPicks: "not-an-array" });
    expect(parsed.topPicks).toEqual([]);
    expect(parsed.actionItems).toEqual([]);
  });
});

describe("sweeper epoch normalization", () => {
  it("treats seconds and milliseconds timestamps alike", () => {
    const ms = Date.UTC(2026, 7, 2);
    expect(normalizeEpochMs(ms)).toBe(ms);
    expect(normalizeEpochMs(Math.floor(ms / 1000))).toBe(Math.floor(ms / 1000) * 1000);
  });
});
