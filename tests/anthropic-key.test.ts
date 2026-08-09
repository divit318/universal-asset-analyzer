/**
 * Key resolution and the no-key failure path.
 *
 * The precedence contract (lib/ai/anthropic-key.ts): ANTHROPIC_API_KEY env var
 * first (demo/CI builds), then the local key file (BYO-key, the default path),
 * then nothing — and "nothing" must fail loudly and typed, never hang or
 * half-work. Uses an isolated UAA_CONFIG_DIR so the developer's real key file
 * is never read or touched.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deleteApiKey,
  keyFilePath,
  keyStatus,
  looksLikeAnthropicKey,
  resolveApiKey,
  saveApiKey,
} from "@/lib/ai/anthropic-key";
import { AnthropicKeyMissingError, AnthropicProvider } from "@/lib/ai/providers/anthropic-provider";

const FAKE_ENV_KEY = "sk-ant-env-test-0123456789";
const FAKE_FILE_KEY = "sk-ant-file-test-0123456789";

const dir = mkdtempSync(path.join(tmpdir(), "uaa-key-test-"));
let savedEnvKey: string | undefined;
let savedConfigDir: string | undefined;

beforeEach(() => {
  savedEnvKey = process.env.ANTHROPIC_API_KEY;
  savedConfigDir = process.env.UAA_CONFIG_DIR;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.UAA_CONFIG_DIR = dir;
  deleteApiKey();
});

afterEach(() => {
  if (savedEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedEnvKey;
  if (savedConfigDir === undefined) delete process.env.UAA_CONFIG_DIR;
  else process.env.UAA_CONFIG_DIR = savedConfigDir;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveApiKey precedence", () => {
  it("resolves nothing when neither env nor file is set", () => {
    expect(resolveApiKey()).toBeNull();
    expect(keyStatus()).toEqual({ configured: false, source: null });
  });

  it("resolves the file key when only the file exists (the BYO-key default path)", () => {
    saveApiKey(FAKE_FILE_KEY);
    expect(resolveApiKey()).toBe(FAKE_FILE_KEY);
    expect(keyStatus()).toEqual({ configured: true, source: "file" });
  });

  it("the env var wins over the file (demo/CI exception)", () => {
    saveApiKey(FAKE_FILE_KEY);
    process.env.ANTHROPIC_API_KEY = FAKE_ENV_KEY;
    expect(resolveApiKey()).toBe(FAKE_ENV_KEY);
    expect(keyStatus()).toEqual({ configured: true, source: "env" });
  });

  it("a blank env var does not shadow the file", () => {
    saveApiKey(FAKE_FILE_KEY);
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(resolveApiKey()).toBe(FAKE_FILE_KEY);
  });
});

describe("saveApiKey / deleteApiKey", () => {
  it("writes the key file inside UAA_CONFIG_DIR with owner-only permissions", () => {
    saveApiKey(FAKE_FILE_KEY);
    const file = keyFilePath();
    expect(file.startsWith(dir)).toBe(true);
    expect(readFileSync(file, "utf8").trim()).toBe(FAKE_FILE_KEY);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("re-enforces mode 600 on overwrite", () => {
    saveApiKey(FAKE_FILE_KEY);
    saveApiKey(FAKE_FILE_KEY + "x");
    expect(statSync(keyFilePath()).mode & 0o777).toBe(0o600);
  });

  it("rejects something that is not an Anthropic key, without echoing it", () => {
    expect(() => saveApiKey("hunter2")).toThrowError(/sk-ant/);
    try {
      saveApiKey("my-secret-password");
    } catch (err) {
      expect((err as Error).message).not.toContain("my-secret-password");
    }
    expect(existsSync(keyFilePath())).toBe(false);
  });

  it("deleteApiKey removes the stored key and is idempotent", () => {
    saveApiKey(FAKE_FILE_KEY);
    deleteApiKey();
    expect(resolveApiKey()).toBeNull();
    expect(() => deleteApiKey()).not.toThrow();
  });
});

describe("looksLikeAnthropicKey", () => {
  it("accepts the sk-ant- shape and rejects everything else", () => {
    expect(looksLikeAnthropicKey(FAKE_FILE_KEY)).toBe(true);
    expect(looksLikeAnthropicKey("  " + FAKE_FILE_KEY + "  ")).toBe(true);
    expect(looksLikeAnthropicKey("sk-ant-")).toBe(false);
    expect(looksLikeAnthropicKey("sk-proj-abcdefghijkl")).toBe(false);
    expect(looksLikeAnthropicKey("")).toBe(false);
  });
});

describe("the no-key failure path", () => {
  it("the provider offers no models and reports unreachable without a key", async () => {
    const provider = new AnthropicProvider();
    expect(await provider.listModels()).toEqual([]);
    expect((await provider.healthCheck()).reachable).toBe(false);
  });

  it("complete() throws the typed key-missing error, before any network I/O", async () => {
    const provider = new AnthropicProvider();
    await expect(
      provider.complete({ model: "claude-opus-5-low", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toBeInstanceOf(AnthropicKeyMissingError);
  });

  it("stream() throws the same typed error", async () => {
    const provider = new AnthropicProvider();
    const gen = provider.stream({
      model: "claude-opus-5-low",
      messages: [{ role: "user", content: "hi" }],
    });
    await expect(gen.next()).rejects.toBeInstanceOf(AnthropicKeyMissingError);
  });

  it("the provider becomes routable the moment a key is saved", async () => {
    const provider = new AnthropicProvider();
    saveApiKey(FAKE_FILE_KEY);
    const models = await provider.listModels();
    expect(models.map((m) => m.id).sort()).toEqual([
      "claude-opus-5-high",
      "claude-opus-5-low",
      "claude-opus-5-medium",
    ]);
    expect((await provider.healthCheck()).reachable).toBe(true);
  });
});
