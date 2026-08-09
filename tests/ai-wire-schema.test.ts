/**
 * wireJsonSchema (lib/ai/providers/chain-analysis.ts) — the Zod→JSON-Schema
 * bridge behind native structured outputs. Must be best-effort: anything it
 * cannot compile falls back to undefined (prompt-directed JSON, exactly the
 * pre-existing behavior) rather than failing the analysis.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { wireJsonSchema } from "@/lib/ai/providers/chain-analysis";
import { MovementWireSchema } from "@/lib/ai/schemas/movement";
import { WatchlistDigestWireSchema } from "@/lib/ai/schemas/watchlist-digest";

describe("wireJsonSchema", () => {
  it("compiles a plain constraint-carrying schema", () => {
    const js = wireJsonSchema(z.object({ a: z.string().min(1), n: z.number().min(0).max(100) }));
    expect(js).toBeDefined();
    expect(js?.type).toBe("object");
    const props = js?.properties as Record<string, Record<string, unknown>>;
    expect(props.a.type).toBe("string");
    expect(props.n.maximum).toBe(100);
  });

  it("compiles the real wire schemas the analysis seam ships", () => {
    // These two are what movement-explainer and the watchlist digest send —
    // if either stops compiling, native structured outputs silently turn off
    // for that surface. Fail loudly here instead.
    expect(wireJsonSchema(MovementWireSchema)).toBeDefined();
    expect(wireJsonSchema(WatchlistDigestWireSchema)).toBeDefined();
  });

  it("returns undefined for a missing schema", () => {
    expect(wireJsonSchema(undefined)).toBeUndefined();
  });

  it("returns undefined (not a throw) for a schema JSON Schema cannot represent", () => {
    const withTransform = z.string().transform((s) => s.length);
    expect(wireJsonSchema(withTransform)).toBeUndefined();
  });
});
