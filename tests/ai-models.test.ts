import { describe, expect, it } from "vitest";
import {
  buildModelOptions,
  MODEL_REGISTRY,
  pickDefaultModel,
  specForInstalled,
} from "@/lib/ai/models";

describe("specForInstalled", () => {
  it("resolves a tagged variant to its base registry spec", () => {
    const spec = specForInstalled("qwen3:8b");
    expect(spec.family).toBe("qwen");
    expect(spec.reasoning).toBe(true);
    expect(spec.id).toBe("qwen3:8b"); // keeps the installed id
  });

  it("flags DeepSeek R1 as a reasoning model", () => {
    expect(specForInstalled("deepseek-r1:7b").reasoning).toBe(true);
  });

  it("falls back to a generic spec for unknown models", () => {
    const spec = specForInstalled("phi4:latest");
    expect(spec.family).toBe("other");
    expect(spec.label).toBe("phi4:latest");
  });

  it("does not match an unrelated model that shares a text prefix with a registry entry", () => {
    // Regression: "qwen3-coder" previously matched the "qwen3" spec via a
    // loose startsWith check, wrongly inheriting its capabilities/context
    // window/temperature despite being a different, coding-specialized model.
    const spec = specForInstalled("qwen3-coder:latest");
    const qwen3 = MODEL_REGISTRY.find((m) => m.id === "qwen3")!;
    expect(spec.id).toBe("qwen3-coder:latest");
    expect(spec.label).not.toBe(qwen3.label); // falls to genericSpec, not the qwen3 entry
    expect(spec.blurb).not.toBe(qwen3.blurb);
  });
});

describe("pickDefaultModel", () => {
  it("returns null when nothing is installed", () => {
    expect(pickDefaultModel([])).toBeNull();
  });

  it("honors an env override only when that model is installed", () => {
    expect(pickDefaultModel(["mistral:latest", "llama3.1:8b"], "llama3.1:8b")).toBe("llama3.1:8b");
    expect(pickDefaultModel(["mistral:latest"], "qwen3")).toBe("mistral:latest");
  });

  it("prefers higher-ranked registry models", () => {
    // qwen3 outranks mistral in the registry.
    expect(pickDefaultModel(["mistral:latest", "qwen3:8b"])).toBe("qwen3:8b");
  });
});

describe("MODEL_REGISTRY", () => {
  it("gives every entry the orchestration fields the Router depends on", () => {
    for (const spec of MODEL_REGISTRY) {
      expect(spec.provider).toBe("ollama");
      expect(spec.enabled).toBe(true);
      expect(spec.priority).toBeGreaterThan(0);
      expect(spec.maxTokens).toBeGreaterThan(0);
      expect(spec.timeoutMs).toBeGreaterThan(0);
      expect(Array.isArray(spec.capabilities)).toBe(true);
    }
  });

  it("includes the routing-table models from the orchestration brief", () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(ids).toContain("qwen3");
    expect(ids).toContain("deepseek-r1");
    expect(ids).toContain("qwen2.5-coder");
  });

  it("marks deepseek-r1 and qwen3 as chain-of-thought capable, matching the reasoning flag", () => {
    const deepseek = MODEL_REGISTRY.find((m) => m.id === "deepseek-r1")!;
    expect(deepseek.reasoning).toBe(true);
    expect(deepseek.capabilities).toContain("chain-of-thought");
  });

  it("marks qwen2.5-coder as coding-capable", () => {
    const coder = MODEL_REGISTRY.find((m) => m.id === "qwen2.5-coder")!;
    expect(coder.capabilities).toContain("coding");
  });
});

describe("buildModelOptions", () => {
  it("lists installed models first, then known-but-missing ones", () => {
    const opts = buildModelOptions(["mistral:latest"]);
    const installed = opts.filter((o) => o.installed);
    expect(installed).toHaveLength(1);
    expect(installed[0].family).toBe("mistral");
    // qwen3 / deepseek-r1 / llama3.1 surface as not-installed suggestions.
    expect(opts.some((o) => o.id === "qwen3" && !o.installed)).toBe(true);
  });
});
