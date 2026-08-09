/**
 * parseModelId — the seam between routable ids and the Anthropic wire.
 * Effort-tier ids carry their depth; anything else must resolve to "no
 * effort", which buildParams translates into sending neither
 * output_config.effort nor a thinking config (the model's own defaults).
 */
import { describe, expect, it } from "vitest";
import { parseModelId } from "@/lib/ai/providers/anthropic-provider";

describe("parseModelId", () => {
  it("splits the three effort tiers", () => {
    expect(parseModelId("claude-opus-5-high")).toEqual({ model: "claude-opus-5", effort: "high" });
    expect(parseModelId("claude-opus-5-medium")).toEqual({ model: "claude-opus-5", effort: "medium" });
    expect(parseModelId("claude-opus-5-low")).toEqual({ model: "claude-opus-5", effort: "low" });
  });

  it("returns null effort for ids without a tier suffix — their wire defaults apply", () => {
    expect(parseModelId("claude-haiku-4-5")).toEqual({ model: "claude-haiku-4-5", effort: null });
    expect(parseModelId("claude-opus-5")).toEqual({ model: "claude-opus-5", effort: null });
  });
});
