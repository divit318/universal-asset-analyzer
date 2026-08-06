/**
 * Per-provider API key handling for the BYO-key hosted providers.
 *
 * Generalizes the pattern anthropic-key.ts established (that module predates
 * this one and keeps its own exports — several routes and guarantees hang off
 * it; for "anthropic" this module simply delegates to it so there is exactly
 * one truth for that path).
 *
 * Resolution order per provider, mirroring anthropic-key.ts:
 *   1. The provider's env var(s) — for demo/CI builds.
 *   2. The local key file under ~/.uaa/ (override the directory with
 *      UAA_CONFIG_DIR) — the user's own key, saved from /settings, chmod 600.
 *
 * Same guarantees: keys live OUTSIDE the repository and OUTSIDE data/
 * backups, are never logged, and are never returned by any API route (the
 * settings UI reads {@link providerKeyStatus}, which reports presence only).
 *
 * The Devin CLI and Ollama take no API key at all — their "credential" is the
 * user's `devin login` and a local daemon respectively — so they do not
 * appear here.
 *
 * Server-only (node:fs, node:os).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  deleteApiKey as deleteAnthropicKey,
  keyStatus as anthropicKeyStatus,
  resolveApiKey as resolveAnthropicKey,
  saveApiKey as saveAnthropicKey,
  type KeySource,
} from "./anthropic-key";
import type { ProviderId } from "./models";

export type { KeySource };

/** The providers that authenticate with a stored API key. */
export type KeyedProviderId = "anthropic" | "openai" | "gemini" | "openrouter";

export const KEYED_PROVIDERS: readonly KeyedProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
];

export function isKeyedProvider(provider: ProviderId | string): provider is KeyedProviderId {
  return (KEYED_PROVIDERS as readonly string[]).includes(provider);
}

interface KeyConfig {
  /** Env vars checked in order — first non-empty wins. */
  envVars: string[];
  /** File name under the UAA config dir. */
  fileName: string;
  /** Plausibility check only — real validation is the first API call. */
  looksValid: (key: string) => boolean;
  /** Human label for user-facing copy. */
  label: string;
}

const KEY_CONFIGS: Record<Exclude<KeyedProviderId, "anthropic">, KeyConfig> = {
  openai: {
    envVars: ["OPENAI_API_KEY"],
    fileName: "openai_api_key",
    looksValid: (k) => /^sk-[A-Za-z0-9_-]{10,}$/.test(k),
    label: "OpenAI",
  },
  gemini: {
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    fileName: "gemini_api_key",
    looksValid: (k) => k.length >= 10 && !/\s/.test(k),
    label: "Google Gemini",
  },
  openrouter: {
    envVars: ["OPENROUTER_API_KEY"],
    fileName: "openrouter_api_key",
    looksValid: (k) => /^sk-or-[A-Za-z0-9_-]{10,}$/.test(k),
    label: "OpenRouter",
  },
};

export function providerKeyLabel(provider: KeyedProviderId): string {
  return provider === "anthropic" ? "Anthropic" : KEY_CONFIGS[provider].label;
}

function configDir(): string {
  return process.env.UAA_CONFIG_DIR ?? join(homedir(), ".uaa");
}

function keyFileFor(provider: Exclude<KeyedProviderId, "anthropic">): string {
  return join(configDir(), KEY_CONFIGS[provider].fileName);
}

/** The resolved key, or null when none is configured. NEVER log the return value. */
export function resolveProviderKey(provider: KeyedProviderId): string | null {
  if (provider === "anthropic") return resolveAnthropicKey();
  const cfg = KEY_CONFIGS[provider];
  for (const envVar of cfg.envVars) {
    const env = process.env[envVar]?.trim();
    if (env) return env;
  }
  try {
    const file = keyFileFor(provider);
    if (!existsSync(file)) return null;
    const key = readFileSync(file, "utf8").trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** Presence + source, for the settings UI. Deliberately excludes the key itself. */
export function providerKeyStatus(provider: KeyedProviderId): {
  configured: boolean;
  source: KeySource;
} {
  if (provider === "anthropic") return anthropicKeyStatus();
  const cfg = KEY_CONFIGS[provider];
  if (cfg.envVars.some((v) => process.env[v]?.trim())) return { configured: true, source: "env" };
  try {
    const file = keyFileFor(provider);
    if (existsSync(file) && readFileSync(file, "utf8").trim().length > 0) {
      return { configured: true, source: "file" };
    }
  } catch {
    /* unreadable file = not configured */
  }
  return { configured: false, source: null };
}

/** Persist the user's key to the provider's local key file, mode 600. */
export function saveProviderKey(provider: KeyedProviderId, key: string): void {
  if (provider === "anthropic") return saveAnthropicKey(key);
  const cfg = KEY_CONFIGS[provider];
  const trimmed = key.trim();
  if (!cfg.looksValid(trimmed)) {
    throw new Error(`That does not look like a ${cfg.label} API key.`);
  }
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const file = keyFileFor(provider);
  writeFileSync(file, trimmed + "\n", { mode: 0o600 });
  // writeFileSync's mode only applies on create; enforce on overwrite too.
  chmodSync(file, 0o600);
}

/** Remove the stored key (the env var, if set, is the operator's to unset). */
export function deleteProviderKey(provider: KeyedProviderId): void {
  if (provider === "anthropic") return deleteAnthropicKey();
  try {
    const file = keyFileFor(provider);
    if (existsSync(file)) unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/* -------------------------------------------------------------------------- */
/* Typed key failures — provider-generic counterparts of the Anthropic ones   */
/* -------------------------------------------------------------------------- */

/** No key configured for a keyed provider. Classified as `no_api_key` (lib/ai/errors.ts). */
export class ProviderKeyMissingError extends Error {
  code = "api_key_missing" as const;
  readonly provider: KeyedProviderId;
  constructor(provider: KeyedProviderId) {
    super(`No ${providerKeyLabel(provider)} API key is configured.`);
    this.name = "ProviderKeyMissingError";
    this.provider = provider;
  }
}

/** The key was presented and rejected. Classified as `bad_api_key` (lib/ai/errors.ts). */
export class ProviderKeyInvalidError extends Error {
  code = "api_key_invalid" as const;
  readonly provider: KeyedProviderId;
  /** Where the rejected key came from — env-sourced keys mask Settings (see errors.ts). */
  readonly source: KeySource;
  constructor(provider: KeyedProviderId, source: KeySource = providerKeyStatus(provider).source) {
    // Static message on purpose: never echo anything derived from the key.
    super(`The ${providerKeyLabel(provider)} API rejected the configured API key (invalid or revoked).`);
    this.name = "ProviderKeyInvalidError";
    this.provider = provider;
    this.source = source;
  }
}
