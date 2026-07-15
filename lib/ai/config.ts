/**
 * AI Platform configuration — routing policy that can change without code.
 *
 * Everything here is env-overridable. Repointing a task at a different model,
 * benching a model, or moving the memory ceiling is a config change, never an
 * edit to the Router or to feature code.
 *
 *   AI_MAX_MODEL_GB      — memory ceiling for a routable model (default: 75% of RAM)
 *   AI_DISABLED_MODELS   — comma-separated model ids to take out of routing
 *   AI_TASK_<TASK>       — pin one task to an ordered model list, e.g.
 *                          AI_TASK_NL_SCREENER="mistral:latest,qwen3:14b"
 *                          (task name upper-cased, '-' → '_')
 */

import { totalmem } from "node:os";
import type { TaskType } from "./task-registry";

/**
 * Fraction of system RAM a model's weights may occupy and still be considered
 * routable. The rest is headroom for the KV cache, the OS, and Next.js itself.
 *
 * This is the single most consequential number in the platform. Measured on a
 * 17GB M4: an 18.6GB model ran at 0.9 tok/s (302s for one answer) because it
 * could not stay resident, while a 4.4GB model on the same prompt ran at 10.5
 * tok/s. Exceeding memory is not "slower", it is broken.
 */
const DEFAULT_MEMORY_FRACTION = 0.75;

function envNumber(key: string): number | null {
  const raw = process.env[key];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Largest model (GB of weights) the Router will consider on this machine.
 *
 * Derived from actual system memory rather than hardcoded, so the same registry
 * is correct on a 17GB laptop (→ ~12.7GB budget, excludes the 30B models) and on
 * a 64GB workstation (→ 48GB, includes them). Not cached: `totalmem()` is a cheap
 * syscall and tests override the env var between cases.
 */
export function memoryBudgetGb(): number {
  return envNumber("AI_MAX_MODEL_GB") ?? (totalmem() / 1e9) * DEFAULT_MEMORY_FRACTION;
}

/** Model ids taken out of routing entirely, via AI_DISABLED_MODELS. */
export function disabledModels(): Set<string> {
  const raw = process.env.AI_DISABLED_MODELS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Static per-task model pins. An entry here overrides the Router's scoring
 * entirely and is tried in the order given (still subject to the memory and
 * installed checks — a pin cannot conjure a model that can't run).
 *
 * Deliberately empty: the scorer derives good routing from each task's declared
 * requirements, and a hand-maintained list per task is exactly the duplication
 * that let the old registry drift out of sync with reality. Add an entry only to
 * override a specific scoring decision, and say why.
 */
export const TASK_MODEL_PINS: Partial<Record<TaskType, string[]>> = {};

/** Env-var pin for a task, e.g. AI_TASK_NL_SCREENER="mistral:latest". */
function envPin(taskType: TaskType): string[] | null {
  const key = `AI_TASK_${taskType.toUpperCase().replace(/-/g, "_")}`;
  const raw = process.env[key];
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/** The pinned model list for a task, if any. Env wins over the static table. */
export function pinnedModels(taskType: TaskType): string[] | null {
  return envPin(taskType) ?? TASK_MODEL_PINS[taskType] ?? null;
}
