import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  buildModelOptions,
  fitsInMemory,
  genericSpec,
  pickDefaultModel,
  specForInstalled,
} from "@/lib/ai/models";

beforeEach(() => {
  process.env.AI_MAX_MODEL_GB = "12.75"; // a 17GB-class machine
});

afterEach(() => {
  delete process.env.AI_MAX_MODEL_GB;
});

describe("specForInstalled", () => {
  it("resolves an installed model to its exact registry entry", () => {
    expect(specForInstalled("qwen3:14b").label).toBe("Qwen 3 14B");
    expect(specForInstalled("mistral:latest").label).toBe("Mistral 7B");
  });

  it("does NOT collapse two different tags of the same family onto one spec", () => {
    // Regression, and the reason routing was broken: the old registry keyed on
    // the bare family name, so qwen3:14b (9.3GB, usable) and qwen3:30b-a3b
    // (18.6GB, thrashes at 0.9 tok/s) resolved to the SAME spec. The router was
    // structurally unable to tell them apart, and took whichever /api/tags
    // happened to list first.
    const small = specForInstalled("qwen3:14b");
    const big = specForInstalled("qwen3:30b-a3b");
    expect(small.id).not.toBe(big.id);
    expect(small.sizeGb).toBeLessThan(big.sizeGb);
    expect(small.quality).not.toBe(big.quality);
  });

  it("gives an unknown model no capabilities rather than guessing from its name", () => {
    // The old genericSpec() pattern-matched the model id, which is how devstral
    // — a 23.6B dense coding model — ended up tagged "fast".
    expect(genericSpec("devstral:24b").capabilities).toEqual([]);
    expect(specForInstalled("totally-unknown:1b").capabilities).toEqual([]);
  });
});

describe("fitsInMemory", () => {
  it("rejects a model larger than the budget", () => {
    expect(fitsInMemory(specForInstalled("qwen3:30b-a3b"))).toBe(false);
  });

  it("accepts a model that fits", () => {
    expect(fitsInMemory(specForInstalled("qwen3:14b"))).toBe(true);
    expect(fitsInMemory(specForInstalled("mistral:latest"))).toBe(true);
  });

  it("trusts the provider's reported size over the registry's declared one", () => {
    // The registry's size is only a fallback; Ollama reports the truth.
    expect(fitsInMemory(specForInstalled("qwen3:14b"), 20)).toBe(false);
    expect(fitsInMemory(specForInstalled("qwen3:30b-a3b"), 5)).toBe(true);
  });

  it("does not exclude a model whose size is unknown", () => {
    expect(fitsInMemory(genericSpec("mystery:latest"))).toBe(true);
  });

  it("scales with the machine — the same model becomes routable on a bigger box", () => {
    process.env.AI_MAX_MODEL_GB = "48";
    expect(fitsInMemory(specForInstalled("qwen3:30b-a3b"))).toBe(true);
  });
});

describe("MODEL_REGISTRY", () => {
  it("declares a measured speed and a quality band for every model", () => {
    for (const spec of MODEL_REGISTRY) {
      expect(spec.tokensPerSecond, `${spec.id} has no measured speed`).toBeGreaterThan(0);
      expect(spec.quality).toBeGreaterThanOrEqual(1);
      expect(spec.quality).toBeLessThanOrEqual(10);
    }
  });

  it("declares a weights size for local models and none for hosted ones", () => {
    // Size is what the memory gate reads, so it must be real for anything that
    // loads into this machine's RAM — and must be absent for anything that does
    // not, so a hosted model can never be excluded for "not fitting".
    for (const spec of MODEL_REGISTRY) {
      if (spec.provider === "ollama") {
        expect(spec.sizeGb, `${spec.id} has no declared size`).toBeGreaterThan(0);
      } else {
        expect(spec.sizeGb, `${spec.id} is hosted and must not claim a size`).toBe(0);
      }
    }
  });

  it("never memory-gates a hosted model, however small the budget", () => {
    process.env.AI_MAX_MODEL_GB = "0.001";
    for (const spec of MODEL_REGISTRY.filter((m) => m.provider === "devin")) {
      expect(fitsInMemory(spec), `${spec.id} was memory-gated`).toBe(true);
    }
    // The gate still bites for local models — this is not a blanket disable.
    expect(fitsInMemory(specForInstalled("qwen3:14b"))).toBe(false);
  });

  it("no longer references models that are not installed", () => {
    // The old registry listed deepseek-r1 and llama3.1 — neither installed — as
    // the FIRST preference of every reasoning-heavy task, so those preferences
    // silently resolved to nothing at all.
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(ids).not.toContain("deepseek-r1");
    expect(ids).not.toContain("llama3.1");
    expect(ids).not.toContain("llama3.2");
  });
});

describe("pickDefaultModel", () => {
  it("returns null when nothing is installed", () => {
    expect(pickDefaultModel([])).toBeNull();
  });

  it("picks the best installed model that actually fits in memory", () => {
    expect(pickDefaultModel(["mistral:latest", "qwen3:14b", "qwen3:30b-a3b"])).toBe("qwen3:14b");
  });

  it("honors an env override only when that model is installed AND fits", () => {
    expect(pickDefaultModel(["mistral:latest", "qwen3:14b"], "mistral:latest")).toBe(
      "mistral:latest",
    );
    // OLLAMA_MODEL must not be able to pin the app to a model that cannot run.
    expect(pickDefaultModel(["mistral:latest", "qwen3:30b-a3b"], "qwen3:30b-a3b")).toBe(
      "mistral:latest",
    );
    // ...nor to one that isn't installed at all.
    expect(pickDefaultModel(["mistral:latest"], "qwen3:14b")).toBe("mistral:latest");
  });
});

describe("buildModelOptions", () => {
  it("lists installed models first, then registry models still to be pulled", () => {
    const opts = buildModelOptions(["mistral:latest"]);
    expect(opts[0].id).toBe("mistral:latest");
    expect(opts[0].installed).toBe(true);
    expect(opts.some((o) => !o.installed)).toBe(true);
  });
});
