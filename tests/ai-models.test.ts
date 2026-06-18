import { describe, expect, it } from "vitest";
import {
  buildModelOptions,
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
