/**
 * AI depth mode — the user-facing speed/quality preference.
 *
 * Three values, deliberately not model names: the user chooses a tradeoff,
 * the routing layer (lib/ai/config.ts) translates it into per-task model
 * pins. Raw model ids, effort tiers, and providers stay an implementation
 * detail — nothing in the UI ever says "Opus" or "priority serving".
 *
 *   fast     — lowest latency that still passes each task's eval gate
 *   balanced — the default: strongest speed/quality pins (Phase 4 benchmark)
 *   deep     — never trades reasoning effort down, even on fallback
 *
 * Persistence follows the provider-key pattern (lib/ai/keys.ts): a file under
 * ~/.uaa (UAA_CONFIG_DIR override), env override UAA_AI_MODE for demo/CI.
 * Server-side because routing happens server-side; the Settings page reads
 * and writes it through /api/settings/ai-mode.
 *
 * Cache safety: a non-default mode participates in the cache identity of the
 * artifacts whose content it changes (research verdict, portfolio thesis) —
 * see verdict-params.ts / portfolio/thesis.ts. `balanced` is deliberately
 * UNMARKED in cache keys so existing cached artifacts stay valid.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AiMode = "fast" | "balanced" | "deep";

export const AI_MODES: readonly AiMode[] = ["fast", "balanced", "deep"];

export function isAiMode(value: unknown): value is AiMode {
  return typeof value === "string" && (AI_MODES as readonly string[]).includes(value);
}

function configDir(): string {
  return process.env.UAA_CONFIG_DIR ?? join(homedir(), ".uaa");
}

function modeFile(): string {
  return join(configDir(), "ai_mode");
}

/** Tiny memo so per-request pin resolution doesn't stat the file every call. */
let cached: { mode: AiMode; at: number } | null = null;
const CACHE_MS = 2_000;

/** The active mode. Env (UAA_AI_MODE) wins; then the saved file; then balanced. */
export function resolveAiMode(): AiMode {
  const env = process.env.UAA_AI_MODE?.trim().toLowerCase();
  if (isAiMode(env)) return env;

  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.mode;

  let mode: AiMode = "balanced";
  try {
    const file = modeFile();
    if (existsSync(file)) {
      const raw = readFileSync(file, "utf8").trim().toLowerCase();
      if (isAiMode(raw)) mode = raw;
    }
  } catch {
    /* unreadable file = default */
  }
  cached = { mode, at: now };
  return mode;
}

/** Persist the user's choice. */
export function saveAiMode(mode: AiMode): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(modeFile(), mode + "\n", "utf8");
  cached = { mode, at: Date.now() };
}

/** Test hook. */
export function resetAiModeCacheForTests(): void {
  cached = null;
}
