/**
 * Devin CLI Service Layer — the only module that spawns the `devin` binary.
 *
 * The hosted counterpart to ./ollama.ts: process spawning, the isolated
 * inference workspace, output sanitation, concurrency limiting, and typed
 * failures. Higher layers never see a child process.
 *
 * ## Why a subprocess and not an HTTP API
 *
 * Devin exposes no chat-completions endpoint. `devin -p` (print mode) is the
 * only text-in/text-out surface it has, so the "API" here is argv plus stdout.
 * That is less elegant than a POST, and it buys two things that matter more
 * than elegance (both measured on this host, on UAA's own verdict prompt):
 *
 *   - Latency: 3.9s (swe-1.6-fast) / 5.4s (sonnet-5) / 8.3s (opus-5) against
 *     28-115s for local Ollama.
 *   - Concurrency: nine IC-agent-shaped prompts finished in 5.3s wall-clock.
 *     Ollama serializes generations, so the same nine take 3-9 minutes. This
 *     is the bigger win, and it is why lib/platform/dedup.ts's warning about
 *     duplicate work doubling everyone's wait no longer applies on this path.
 *
 * ## Four things that are not optional
 *
 *   1. **An isolated workspace.** `devin` loads AGENTS.md / CLAUDE.md / .devin
 *      rules from its working directory. Run it in the repo and every single
 *      inference call silently carries UAA's ~20k tokens of coding rules as
 *      context — expensive, and actively harmful to answer quality on an
 *      equity-research prompt. The cwd is therefore a scratch directory
 *      outside the repo, with no rules in it.
 *   2. **Tools denied.** `devin -p` is an *agent*: left alone it may decide to
 *      grep the filesystem or fetch a URL before answering, which is
 *      nondeterministic latency and a data-egress surface. The generated
 *      config denies every tool, which reduces it to pure inference.
 *   3. **`--prompt-file`, never argv or stdin.** Piping to stdin panics
 *      (`print mode requires a prompt`), and UAA's dossier prompts run to tens
 *      of kilobytes — well past argv limits.
 *   4. **A concurrency cap.** Each call is a process; an unbounded IC report
 *      or scanner sweep would fork-bomb the machine.
 *
 * Env vars:
 *   DEVIN_CLI_BIN         — path to the devin binary (default: "devin")
 *   DEVIN_CLI_WORKSPACE   — scratch cwd (default: <tmpdir>/uaa-ai-devin)
 *   DEVIN_CLI_CONCURRENCY — max simultaneous processes (default: 8)
 *   DEVIN_CLI_DISABLED    — set to "1" to take the provider out of routing
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { JSON_ONLY_INSTRUCTION } from "./prompts";
import type { ProviderChatTurn, ProviderImageAttachment } from "./provider";

export const DEVIN_BIN = process.env.DEVIN_CLI_BIN ?? "devin";

/** Raised when the CLI is missing, unauthenticated, or explicitly disabled. */
export class DevinUnavailableError extends Error {
  code = "devin_unavailable" as const;
  constructor(reason: string) {
    super(`Devin CLI is not usable: ${reason}`);
    this.name = "DevinUnavailableError";
  }
}

/**
 * Raised when the account's usage quota is exhausted (the CLI reports
 * errorKind "resource_exhausted"). Typed because it needs TWO behaviours a
 * generic failure must not get: the Router skips this provider's REMAINING
 * candidates (same account, same quota — walking the other effort tiers is
 * pure spend on calls that cannot succeed), and lib/ai/errors.ts tells the
 * user the real fix (top up / another provider) instead of "try again".
 */
export class DevinQuotaExhaustedError extends Error {
  code = "quota_exhausted" as const;
  constructor(detail: string) {
    super(`Devin usage quota exhausted: ${detail}`);
    this.name = "DevinQuotaExhaustedError";
  }
}

/** Raised when a specific model id is rejected by the account or the CLI. */
export class DevinModelUnavailableError extends Error {
  code = "devin_model_unavailable" as const;
  constructor(model: string, detail?: string) {
    super(
      `Devin model "${model}" is unavailable${detail ? `: ${detail}` : ""}. ` +
        `Run \`devin models list\` to see what this account allows.`,
    );
    this.name = "DevinModelUnavailableError";
  }
}

/* -------------------------------------------------------------------------- */
/* Isolated inference workspace                                               */
/* -------------------------------------------------------------------------- */

/**
 * Config handed to every `devin -p` call.
 *
 * `permissions.deny` is the load-bearing part: it strips the agent of every
 * tool, so it cannot read files, run commands, or reach the network, and must
 * answer from the prompt alone. That is what turns an autonomous coding agent
 * into an inference backend with predictable latency.
 *
 * `read_config_from` is disabled for the same reason the cwd is isolated — it
 * would otherwise pull in Cursor/Windsurf/Claude rule files from the user's
 * machine and prepend them to financial-analysis prompts.
 */
const INFERENCE_CONFIG = {
  agent: { model: "swe-1-6-fast" },
  subagents_enabled: false,
  show_hints: false,
  auto_update: false,
  notify: "never",
  attribution: false,
  permissions: {
    deny: [
      "edit",
      "write",
      "exec",
      "read",
      "grep",
      "glob",
      "webfetch",
      "web_search",
      "notebook_edit",
      "notebook_read",
      "mcp__*",
    ],
  },
  read_config_from: { cursor: false, windsurf: false, claude: false },
} as const;

/**
 * The vision variant: identical lockdown, EXCEPT the `read` tool comes off the
 * deny list and a single scoped `Read(<imagesDir>/**)` allow is added. That is
 * how images reach the model through `devin -p` — the CLI forwards an image
 * file the agent reads as real multimodal input (verified 2026-08-10:
 * claude-opus-5-low transcribed a brokerage screenshot pixel-perfectly this
 * way). The scope is what keeps the isolation honest: deny rules are checked
 * before allows, and a read of any path OUTSIDE the images directory matches
 * no allow rule, so in print mode (no human to approve) it is auto-denied.
 * The agent can see exactly the screenshots this call wrote for it, and
 * nothing else on the machine.
 */
function visionInferenceConfig(imagesDir: string) {
  return {
    ...INFERENCE_CONFIG,
    permissions: {
      allow: [`Read(${imagesDir}/**)`],
      deny: INFERENCE_CONFIG.permissions.deny.filter((tool) => tool !== "read"),
    },
  };
}

function workspaceDir(): string {
  return process.env.DEVIN_CLI_WORKSPACE ?? join(tmpdir(), "uaa-ai-devin");
}

let workspaceReady = false;

/**
 * Create the scratch workspace and write the inference configs into it.
 *
 * Idempotent and cheap after the first call. The configs are rewritten on
 * every process boot rather than only when absent, so editing
 * INFERENCE_CONFIG takes effect on restart instead of being masked by a stale
 * file on disk.
 */
export function ensureWorkspace(): {
  cwd: string;
  configPath: string;
  visionConfigPath: string;
  imagesDir: string;
} {
  const cwd = workspaceDir();
  const configPath = join(cwd, "inference-config.json");
  const visionConfigPath = join(cwd, "inference-vision-config.json");
  const imagesDir = join(cwd, "images");
  if (!workspaceReady) {
    mkdirSync(imagesDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(INFERENCE_CONFIG, null, 2), "utf8");
    writeFileSync(visionConfigPath, JSON.stringify(visionInferenceConfig(imagesDir), null, 2), "utf8");
    workspaceReady = true;
  }
  return { cwd, configPath, visionConfigPath, imagesDir };
}

/** Test hook: force the next call to rebuild the workspace. */
export function resetWorkspaceForTests(): void {
  workspaceReady = false;
}

/* -------------------------------------------------------------------------- */
/* Output sanitation                                                          */
/* -------------------------------------------------------------------------- */

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * The CLI prints a one-time onboarding banner the first time it sees a config
 * file it hasn't recorded state for. It goes to stdout, ahead of the answer,
 * so on a cold workspace the "model output" would otherwise begin with
 * "Welcome to Devin CLI!". Everything up to and including the banner's last
 * line is discarded.
 */
const BANNER_TERMINATOR = /You're all set\.[^\n]*\n/;

/** Fenced-block wrapper that some models add around JSON despite being told not to. */
const FENCE_RE = /^\s*```(?:json|JSON)?\s*\n([\s\S]*?)\n?\s*```\s*$/;

/**
 * Turn raw stdout into the model's answer.
 *
 * Pure and exported so the banner/fence handling is testable without spawning
 * anything — both were real corruption sources, and both fail *silently*: a
 * fenced JSON body doesn't throw, it just fails every downstream `JSON.parse`
 * and renders the caller's empty state.
 */
export function cleanDevinOutput(raw: string, opts: { json?: boolean } = {}): string {
  let text = raw.replace(ANSI_RE, "");

  const banner = text.match(BANNER_TERMINATOR);
  if (banner && banner.index !== undefined) {
    text = text.slice(banner.index + banner[0].length);
  }

  text = text.trim();

  if (opts.json) {
    const fenced = text.match(FENCE_RE);
    if (fenced) text = fenced[1].trim();
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Prompt flattening                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Collapse a chat transcript into the single string `-p` accepts.
 *
 * Print mode has no system-message channel and no multi-turn input, so the
 * conversation is rendered as labelled text. A system message becomes a
 * leading instruction block; prior turns become a transcript; the final user
 * message is left last and unlabelled so the model answers *it* rather than
 * continuing the transcript.
 *
 * `imagePaths` (vision requests) become a leading directive to read each
 * screenshot file before answering — the CLI forwards a read image to the
 * model as real multimodal input, which is the only image channel print mode
 * has. The paths point inside the workspace's images directory, the only
 * location the vision config's scoped Read() allow can reach.
 *
 * Pure / testable.
 */
export function flattenMessages(
  messages: ProviderChatTurn[],
  opts: { json?: boolean; imagePaths?: string[] } = {},
): string {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");
  const last = turns[turns.length - 1];
  const history = turns.slice(0, -1);

  const parts: string[] = [];
  if (opts.imagePaths && opts.imagePaths.length > 0) {
    parts.push(
      [
        "## Attached images",
        "Before answering, use your read tool on each of these image files, in order. They are the image(s) the request below refers to:",
        ...opts.imagePaths.map((p, i) => `${i + 1}. ${p}`),
      ].join("\n"),
    );
  }
  if (system.length > 0) parts.push(system.join("\n\n"));
  if (history.length > 0) {
    parts.push(
      ["## Conversation so far", ...history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)].join(
        "\n\n",
      ),
    );
  }
  if (last) parts.push(last.content);
  if (opts.json) parts.push(JSON_ONLY_INSTRUCTION);
  return parts.join("\n\n");
}

/* -------------------------------------------------------------------------- */
/* Concurrency limiting                                                       */
/* -------------------------------------------------------------------------- */

function concurrencyLimit(): number {
  const raw = Number(process.env.DEVIN_CLI_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
}

/**
 * How many of the pool's slots BACKGROUND work may hold at once.
 *
 * Every print-mode completion is a full CLI subprocess, and background
 * fan-outs (the scanner's thesis stage runs up to 8 at a time) were observed
 * saturating the pool on a memory-tight host: interactive calls queued behind
 * them, and queued background calls recorded 620–980s of wall clock against
 * 300s budgets. Capping background work to a strict subset of the pool
 * guarantees interactive requests always have free slots, without slowing an
 * idle-machine scan by much — the excess items queue here, where waiting is
 * free, instead of as live subprocesses fighting for memory.
 */
function backgroundConcurrencyLimit(): number {
  const raw = Number(process.env.DEVIN_CLI_BACKGROUND_CONCURRENCY);
  const cap = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
  return Math.max(1, Math.min(cap, concurrencyLimit() - 1));
}

let active = 0;
let activeBackground = 0;
const waiting: { resolve: () => void; background: boolean }[] = [];

function admissible(background: boolean): boolean {
  if (active >= concurrencyLimit()) return false;
  if (background && activeBackground >= backgroundConcurrencyLimit()) return false;
  return true;
}

/** Wake every waiter that can now be admitted — interactive waiters first. */
function admitWaiters(): void {
  for (;;) {
    const idx = waiting.findIndex((w) => admissible(w.background));
    // Prefer an interactive waiter even if a background one is ahead of it.
    const interactiveIdx = waiting.findIndex((w) => !w.background && admissible(false));
    const pick = interactiveIdx !== -1 ? interactiveIdx : idx;
    if (pick === -1) return;
    const [w] = waiting.splice(pick, 1);
    active += 1;
    if (w.background) activeBackground += 1;
    w.resolve();
  }
}

async function acquire(background = false): Promise<() => void> {
  if (admissible(background)) {
    active += 1;
    if (background) activeBackground += 1;
  } else {
    await new Promise<void>((resolve) => waiting.push({ resolve, background }));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active -= 1;
    if (background) activeBackground -= 1;
    admitWaiters();
  };
}

/**
 * Acquire a slot in the shared Devin work pool.
 *
 * Exported for the ACP transport (../devin-acp.ts): BACKGROUND prompts take a
 * slot from the same pool as print-mode subprocesses, so moving a batch
 * pipeline from print mode to ACP cannot silently remove its concurrency cap
 * — the cap bounds background AI work as a class, not one transport.
 * Interactive ACP prompts deliberately do NOT take a slot: they multiplex
 * over one persistent child (no per-call subprocess) and run hosted-parallel,
 * so throttling them would only add queueing where none is needed.
 */
export function acquireDevinSlot(background: boolean): Promise<() => void> {
  return acquire(background);
}

/** Test-only view of the subprocess pool (the semaphore is module state). */
export const devinSlotsForTests = {
  acquire,
  snapshot: () => ({ active, activeBackground, waiting: waiting.length }),
  reset: () => {
    active = 0;
    activeBackground = 0;
    waiting.length = 0;
  },
};

/* -------------------------------------------------------------------------- */
/* Process execution                                                          */
/* -------------------------------------------------------------------------- */

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Spawn the CLI and collect its output.
 *
 * `spawn` rather than `exec` so a runaway answer can't blow a string buffer,
 * and so the child can be killed on timeout or caller abort. Never uses a
 * shell: every argument here is passed through argv, so a prompt (which is a
 * file path, not the prompt text) can't be interpreted as shell syntax.
 */
function runDevin(
  args: string[],
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(DEVIN_BIN, args, {
      cwd: opts.cwd,
      env: { ...process.env, NO_COLOR: "1", DEVIN_NO_UPDATE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // A SIGKILLed process normally closes within milliseconds, but under
      // extreme memory pressure this host has been observed taking minutes to
      // deliver the close event (Phase 1: 300s budgets recorded as 620–980s of
      // wall clock). The caller's deadline must not depend on the kernel's
      // mood: if close hasn't fired shortly after the kill, settle anyway —
      // the process is dead or dying and its output is forfeit either way.
      const forceSettle = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ stdout, stderr, code: null, timedOut: true });
      }, 5_000);
      forceSettle.unref?.();
    }, opts.timeoutMs);

    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      // ENOENT here means the binary isn't on PATH — a configuration problem,
      // not a transient one, so it maps to the typed unavailable error rather
      // than being retried.
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new DevinUnavailableError(`\`${DEVIN_BIN}\` was not found on PATH`)
          : err,
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Model catalogue                                                            */
/* -------------------------------------------------------------------------- */

interface ModelsListResponse {
  families?: { variants?: { model_uid?: string }[] }[];
}

const CATALOGUE_TTL_MS = 10 * 60_000;
let catalogue: { ids: string[]; fetchedAt: number } | null = null;

/**
 * Model ids this account is allowed to run, from `devin models list`.
 *
 * Cached for ten minutes: it is an auth-scoped list that changes only when an
 * admin edits team settings, and the Router asks for it on *every* request.
 * Paying a process spawn each time would give back a meaningful slice of the
 * latency win this provider exists for.
 *
 * Best-effort — returns [] rather than throwing, so an unreachable CLI
 * degrades into "no Devin models" and the Router falls through to Ollama.
 */
export async function listAllowedModelIds(): Promise<string[]> {
  if (process.env.DEVIN_CLI_DISABLED === "1") return [];
  if (catalogue && Date.now() - catalogue.fetchedAt < CATALOGUE_TTL_MS) {
    return catalogue.ids;
  }

  try {
    const { cwd } = ensureWorkspace();
    const res = await runDevin(["models", "list", "--format", "json"], { cwd, timeoutMs: 15_000 });
    if (res.code !== 0) return [];
    const parsed = JSON.parse(cleanDevinOutput(res.stdout)) as ModelsListResponse;
    const ids = (parsed.families ?? [])
      .flatMap((f) => f.variants ?? [])
      .map((v) => v.model_uid ?? "")
      .filter(Boolean);
    catalogue = { ids, fetchedAt: Date.now() };
    return ids;
  } catch {
    return [];
  }
}

/** Test hook: drop the cached model catalogue. */
export function resetCatalogueForTests(): void {
  catalogue = null;
}

/** Reachability probe: the CLI exists, is authenticated, and exposes models. */
export async function checkDevinHealth(): Promise<{ reachable: boolean; models: string[] }> {
  const models = await listAllowedModelIds();
  return { reachable: models.length > 0, models };
}

/* -------------------------------------------------------------------------- */
/* Inference                                                                  */
/* -------------------------------------------------------------------------- */

export interface DevinGenerateOptions {
  /** Required: the Router always resolves a model. There is no ambient default. */
  model: string;
  json?: boolean;
  /** Vision input — written to per-call files in the workspace's images dir and read by the agent. */
  images?: ProviderImageAttachment[];
  timeoutMs?: number;
  /** Background-task hint: capped to a subset of the subprocess pool and
   *  queued behind interactive work (see backgroundConcurrencyLimit). */
  background?: boolean;
  signal?: AbortSignal;
}

/** File extension for an image media type — the CLI sniffs content, but a truthful extension helps. */
function extensionFor(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "png";
  }
}

/**
 * Run one completion through `devin -p`.
 *
 * The prompt goes to a per-call temp file that is always removed, including on
 * failure — these files carry full financial dossiers and there is no reason
 * to leave them in tmp.
 *
 * Note what this deliberately does NOT forward: temperature, top-p, and
 * max-tokens have no print-mode equivalent. Silently accepting them and
 * dropping them would make the Router's `settingsFor()` a lie; the provider
 * documents the gap instead (see devin-provider.ts).
 */
export async function generateViaDevin(
  messages: ProviderChatTurn[],
  opts: DevinGenerateOptions,
): Promise<string> {
  if (process.env.DEVIN_CLI_DISABLED === "1") {
    throw new DevinUnavailableError("disabled via DEVIN_CLI_DISABLED=1");
  }

  const { cwd, configPath, visionConfigPath, imagesDir } = ensureWorkspace();
  const callId = randomUUID();

  // Vision input: each image becomes a per-call file inside the ONLY
  // directory the vision config's Read() scope can reach, referenced from the
  // prompt so the agent reads them (the CLI forwards a read image to the
  // model as real multimodal input). Removed in the finally below — these
  // are the user's financial screenshots and must not accumulate in tmp.
  const imagePaths = (opts.images ?? []).map((img, i) =>
    join(imagesDir, `img-${callId}-${i}.${extensionFor(img.mediaType)}`),
  );
  for (const [i, img] of (opts.images ?? []).entries()) {
    writeFileSync(imagePaths[i], Buffer.from(img.base64, "base64"));
  }

  const promptPath = join(cwd, `prompt-${callId}.txt`);
  writeFileSync(promptPath, flattenMessages(messages, { json: opts.json, imagePaths }), "utf8");

  const queuedAt = Date.now();
  const release = await acquire(opts.background === true);
  const queuedMs = Date.now() - queuedAt;
  try {
    const res = await runDevin(
      [
        "-p",
        "--prompt-file",
        promptPath,
        "--config",
        // The scoped-read vision config ONLY when this call actually carries
        // images; every text call keeps the fully tool-less lockdown.
        imagePaths.length > 0 ? visionConfigPath : configPath,
        "--model",
        opts.model,
        // Print mode cannot render the workspace-trust prompt and hard-fails
        // in an untrusted directory. The scratch cwd is ours and holds nothing
        // but a config file, so there is no trust decision to make.
        "--respect-workspace-trust",
        "false",
      ],
      { cwd, timeoutMs: opts.timeoutMs ?? 120_000, signal: opts.signal },
    );

    if (res.timedOut) {
      // Queue wait is reported separately so a ledger row reading "300s
      // timeout, 620s duration" is diagnosable as pool contention, not a
      // mystery: the generation budget starts when the subprocess spawns.
      throw new Error(
        `Devin CLI timed out after ${opts.timeoutMs ?? 120_000}ms (model: ${opts.model}${queuedMs > 1_000 ? `, queued ${Math.round(queuedMs / 1000)}s` : ""})`,
      );
    }
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const output = cleanDevinOutput(res.stdout, { json: opts.json });

    if (res.code !== 0) {
      const detail = cleanDevinOutput(res.stderr) || output || `exit code ${res.code}`;
      // Checked before the model/auth patterns: the quota message mentions
      // "usage", which the looser patterns below would misclassify.
      if (/quota has been exhausted|resource_exhausted/i.test(detail)) {
        throw new DevinQuotaExhaustedError(detail.slice(0, 300));
      }
      if (/model|not allowed|unknown model|unavailable/i.test(detail)) {
        throw new DevinModelUnavailableError(opts.model, detail.slice(0, 200));
      }
      if (/not logged in|unauthorized|auth/i.test(detail)) {
        throw new DevinUnavailableError(`not authenticated (${detail.slice(0, 120)})`);
      }
      throw new Error(`Devin CLI failed: ${detail.slice(0, 300)}`);
    }

    if (!output) {
      throw new Error(`Devin CLI returned no output (model: ${opts.model})`);
    }
    return output;
  } finally {
    release();
    if (existsSync(promptPath)) rmSync(promptPath, { force: true });
    for (const p of imagePaths) {
      if (existsSync(p)) rmSync(p, { force: true });
    }
  }
}
