/**
 * Anthropic API key handling — BYO-key by default, env for demo builds.
 *
 * Resolution order:
 *   1. ANTHROPIC_API_KEY env var — for demo/CI builds where the operator
 *      injects a key at launch.
 *   2. The local key file, ~/.uaa/anthropic_api_key (override the directory
 *      with UAA_CONFIG_DIR) — the user's own key, saved from the in-app
 *      settings, chmod 600.
 *
 * Guarantees this module is responsible for:
 *   - The key is stored OUTSIDE the repository (never committed, never inside
 *     the project tree) and OUTSIDE the data/ directory (never swept into DB
 *     backups).
 *   - The key is never logged and never returned by any API route — reads by
 *     the UI go through {@link keyStatus}, which reports presence only.
 *   - The key is sent to exactly one host: https://api.anthropic.com (the
 *     provider constructs its client with an explicit baseURL, ignoring
 *     ANTHROPIC_BASE_URL overrides, so a stray env var cannot redirect it).
 *
 * Server-only (node:fs, node:os).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

function configDir(): string {
  return process.env.UAA_CONFIG_DIR ?? join(homedir(), ".uaa");
}

export function keyFilePath(): string {
  return join(configDir(), "anthropic_api_key");
}

/** Plausibility check only — real validation is the first API call. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{10,}$/.test(key.trim());
}

/** The resolved key, or null when none is configured. NEVER log the return value. */
export function resolveApiKey(): string | null {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return env;
  try {
    const file = keyFilePath();
    if (!existsSync(file)) return null;
    const key = readFileSync(file, "utf8").trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export type KeySource = "env" | "file" | null;

/** Presence + source, for the settings UI. Deliberately excludes the key itself. */
export function keyStatus(): { configured: boolean; source: KeySource } {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return { configured: true, source: "env" };
  try {
    if (existsSync(keyFilePath()) && readFileSync(keyFilePath(), "utf8").trim().length > 0) {
      return { configured: true, source: "file" };
    }
  } catch {
    /* unreadable file = not configured */
  }
  return { configured: false, source: null };
}

/** Persist the user's key to the local key file, mode 600. */
export function saveApiKey(key: string): void {
  const trimmed = key.trim();
  if (!looksLikeAnthropicKey(trimmed)) {
    throw new Error("That does not look like an Anthropic API key (expected sk-ant-…).");
  }
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(keyFilePath(), trimmed + "\n", { mode: 0o600 });
  // writeFileSync's mode only applies on create; enforce on overwrite too.
  chmodSync(keyFilePath(), 0o600);
}

/** Remove the stored key (the env var, if set, is the operator's to unset). */
export function deleteApiKey(): void {
  try {
    if (existsSync(keyFilePath())) unlinkSync(keyFilePath());
  } catch {
    /* already gone */
  }
}
