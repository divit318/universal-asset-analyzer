/**
 * The generic per-provider key store (lib/ai/keys.ts): resolution order,
 * save/delete round trips, plausibility validation, and the typed key errors
 * that classify into the platform's error taxonomy. Runs entirely in an
 * isolated UAA_CONFIG_DIR — no real key file is ever touched.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ProviderKeyInvalidError,
  ProviderKeyMissingError,
  deleteProviderKey,
  isKeyedProvider,
  providerKeyStatus,
  resolveProviderKey,
  saveProviderKey,
} from "@/lib/ai/keys";
import { classifyAiError } from "@/lib/ai/errors";

const dir = mkdtempSync(path.join(tmpdir(), "uaa-keys-test-"));
const ENV_VARS = ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.UAA_CONFIG_DIR = process.env.UAA_CONFIG_DIR;
  process.env.UAA_CONFIG_DIR = dir;
  for (const v of ENV_VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const p of ["openai", "gemini", "openrouter"] as const) deleteProviderKey(p);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("isKeyedProvider", () => {
  it("names exactly the BYO-key providers", () => {
    expect(isKeyedProvider("anthropic")).toBe(true);
    expect(isKeyedProvider("openai")).toBe(true);
    expect(isKeyedProvider("gemini")).toBe(true);
    expect(isKeyedProvider("openrouter")).toBe(true);
    // Devin authenticates via `devin login`; Ollama is a local daemon.
    expect(isKeyedProvider("devin")).toBe(false);
    expect(isKeyedProvider("ollama")).toBe(false);
  });
});

describe("save / resolve / delete round trip", () => {
  it("persists an OpenAI key with owner-only permissions and resolves it back", () => {
    saveProviderKey("openai", "sk-test1234567890abc");
    expect(resolveProviderKey("openai")).toBe("sk-test1234567890abc");
    expect(providerKeyStatus("openai")).toEqual({ configured: true, source: "file" });

    const file = path.join(dir, "openai_api_key");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // Stored with a trailing newline, resolved trimmed.
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);

    deleteProviderKey("openai");
    expect(resolveProviderKey("openai")).toBeNull();
    expect(providerKeyStatus("openai")).toEqual({ configured: false, source: null });
  });

  it("rejects an implausible key without writing anything", () => {
    expect(() => saveProviderKey("openrouter", "not-a-key")).toThrow(/OpenRouter/);
    expect(resolveProviderKey("openrouter")).toBeNull();
  });
});

describe("resolution order", () => {
  it("env var beats the stored file", () => {
    saveProviderKey("openai", "sk-fromfile1234567890");
    process.env.OPENAI_API_KEY = "sk-fromenv1234567890";
    expect(resolveProviderKey("openai")).toBe("sk-fromenv1234567890");
    expect(providerKeyStatus("openai")).toEqual({ configured: true, source: "env" });
  });

  it("gemini accepts GOOGLE_API_KEY as the fallback env var", () => {
    process.env.GOOGLE_API_KEY = "google-key-1234567890";
    expect(resolveProviderKey("gemini")).toBe("google-key-1234567890");
    expect(providerKeyStatus("gemini").source).toBe("env");
  });
});

describe("typed key errors classify into the platform taxonomy", () => {
  it("a missing key is no_api_key, non-retryable, naming the provider", () => {
    const c = classifyAiError(new ProviderKeyMissingError("openai"));
    expect(c.category).toBe("no_api_key");
    expect(c.retryable).toBe(false);
    expect(c.message).toMatch(/OpenAI/);
    expect(c.message).toMatch(/Settings/);
  });

  it("a rejected key is bad_api_key, naming the provider", () => {
    const c = classifyAiError(new ProviderKeyInvalidError("openrouter", "file"));
    expect(c.category).toBe("bad_api_key");
    expect(c.retryable).toBe(false);
    expect(c.message).toMatch(/OpenRouter/);
    expect(c.message).toMatch(/Settings/);
  });

  it("an env-sourced rejected key warns that Settings cannot fix it", () => {
    const c = classifyAiError(new ProviderKeyInvalidError("gemini", "env"));
    expect(c.category).toBe("bad_api_key");
    expect(c.message).toMatch(/environment variable/i);
    expect(c.message).not.toMatch(/^The Google Gemini API rejected your API key \(invalid or revoked\)\. Replace it in Settings/);
  });

  it("never leaks a key into the message", () => {
    for (const err of [
      new ProviderKeyMissingError("openai"),
      new ProviderKeyInvalidError("openai", "env"),
    ]) {
      expect(classifyAiError(err).message).not.toMatch(/sk-/);
    }
  });
});
