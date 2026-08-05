import { describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  buildModelOptions,
  fitsInMemory,
  genericSpec,
  isHostedProvider,
  pickDefaultModel,
  specForInstalled,
} from "@/lib/ai/models";

describe("specForInstalled", () => {
  it("resolves a routable id to its exact registry entry", () => {
    expect(specForInstalled("claude-opus-5-high").label).toBe("Claude Opus 5 (high effort)");
    expect(specForInstalled("claude-opus-5-low").label).toBe("Claude Opus 5 (low effort)");
  });

  it("does NOT collapse two effort tiers onto one spec", () => {
    // The tiers are the whole task→depth mapping: the Router must be able to
    // tell them apart or every task gets the same reasoning budget.
    const high = specForInstalled("claude-opus-5-high");
    const low = specForInstalled("claude-opus-5-low");
    expect(high.id).not.toBe(low.id);
    expect(high.quality).toBeGreaterThan(low.quality);
    expect(high.tokensPerSecond).toBeLessThan(low.tokensPerSecond);
  });

  it("gives an unknown model no capabilities rather than guessing from its name", () => {
    expect(genericSpec("mystery-model-fast").capabilities).toEqual([]);
    expect(specForInstalled("totally-unknown:1b").capabilities).toEqual([]);
  });
});

describe("MODEL_REGISTRY", () => {
  it("registers exactly the three claude-opus-5 effort tiers, all anthropic, all enabled", () => {
    expect(MODEL_REGISTRY.map((m) => m.id).sort()).toEqual([
      "claude-opus-5-high",
      "claude-opus-5-low",
      "claude-opus-5-medium",
    ]);
    for (const spec of MODEL_REGISTRY) {
      expect(spec.provider).toBe("anthropic");
      expect(spec.enabled).toBe(true);
    }
  });

  it("declares a speed and a quality band for every model", () => {
    for (const spec of MODEL_REGISTRY) {
      expect(spec.tokensPerSecond, `${spec.id} has no speed`).toBeGreaterThan(0);
      expect(spec.quality).toBeGreaterThanOrEqual(1);
      expect(spec.quality).toBeLessThanOrEqual(10);
    }
  });

  it("hosted models claim no weights size and are never memory-gated", () => {
    process.env.AI_MAX_MODEL_GB = "0.001";
    try {
      for (const spec of MODEL_REGISTRY) {
        expect(spec.sizeGb, `${spec.id} is hosted and must not claim a size`).toBe(0);
        expect(fitsInMemory(spec), `${spec.id} was memory-gated`).toBe(true);
      }
    } finally {
      delete process.env.AI_MAX_MODEL_GB;
    }
  });
});

describe("isHostedProvider", () => {
  it("knows anthropic is hosted", () => {
    expect(isHostedProvider("anthropic")).toBe(true);
  });

  it("gives an UNRECOGNISED provider id the conservative local treatment", () => {
    // Test doubles ("fake") and any future unregistered provider must get the
    // full local path (gate, warm probe, cold budget) — safe to apply when
    // unneeded, breaking to skip when needed.
    expect(isHostedProvider("fake")).toBe(false);
    expect(isHostedProvider("")).toBe(false);
  });
});

describe("pickDefaultModel", () => {
  it("returns null when nothing is available", () => {
    expect(pickDefaultModel([])).toBeNull();
  });

  it("picks the best available model by quality", () => {
    expect(
      pickDefaultModel(["claude-opus-5-low", "claude-opus-5-high", "claude-opus-5-medium"]),
    ).toBe("claude-opus-5-high");
  });

  it("honors an override only when that model is available", () => {
    expect(pickDefaultModel(["claude-opus-5-low", "claude-opus-5-medium"], "claude-opus-5-low")).toBe(
      "claude-opus-5-low",
    );
    // An override must not pin the app to a model that isn't offered.
    expect(pickDefaultModel(["claude-opus-5-low"], "claude-opus-5-high")).toBe("claude-opus-5-low");
  });
});

describe("buildModelOptions", () => {
  it("lists available models first, then registry models not currently routable", () => {
    const opts = buildModelOptions(["claude-opus-5-low"]);
    expect(opts[0].id).toBe("claude-opus-5-low");
    expect(opts[0].installed).toBe(true);
    expect(opts.some((o) => !o.installed)).toBe(true);
  });
});
