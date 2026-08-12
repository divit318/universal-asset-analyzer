/**
 * Devin ACP Service Layer — REAL token streaming from the keyless default
 * provider, over one persistent `devin acp` child process.
 *
 * ## Why this exists (2026-08-10 performance audit)
 * `devin -p` (print mode, ./devin-cli.ts) buffers the whole answer, so the
 * platform's entire streaming pipeline — route → Router → NDJSON → React —
 * was being fed a single chunk after 30–67s. Every copilot turn measured
 * ttft ≈ total. The CLI's ACP server (`devin acp`, JSON-RPC over stdio) is
 * the same authenticated backend with genuine incremental output:
 *
 *   - `agent_message_chunk` deltas   → answer tokens     (measured: 40+ chunks)
 *   - `agent_thought_chunk` deltas   → reasoning channel (separated for us)
 *   - end-of-prompt `usage`          → real token accounting incl. cache hits
 *   - `session/set_config_option`    → per-session model (one process, all tiers)
 *
 * Measured on this host: process spawn+initialize ≈ 1s (paid once),
 * `session/new` ≈ 50ms warm, first answer token ≈ 2.2–3.0s after prompt,
 * concurrent sessions multiplex over the one process.
 *
 * ## Isolation
 * Same doctrine as ./devin-cli.ts and for the same reasons: the child runs in
 * the scratch workspace with the tool-less inference config, so the "agent"
 * is reduced to pure inference — no file reads, no shell, no network fetches,
 * and none of the repo's ~20k tokens of coding rules contaminating research
 * prompts. Sessions are deleted after each call so hundreds of one-shot
 * inference turns don't silt up the user's `devin ls`.
 *
 * ## Lifecycle discipline
 * One child, lazily spawned, respawned on crash, reaped after idling — this
 * host has documented history (AGENTS.md "Host Health") of orphaned AI
 * processes wiring gigabytes, so the exit paths matter: the child dies with
 * the server process (exit hook), on idle expiry, and is never left running
 * without a live parent.
 */

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { acquireDevinSlot, DEVIN_BIN, DevinUnavailableError, ensureWorkspace, flattenMessages } from "./devin-cli";
import type { ProviderChatTurn, ProviderTokenUsage } from "./provider";

/** Raised when the ACP transport itself fails — callers may fall back to print mode. */
export class DevinAcpError extends Error {
  constructor(message: string) {
    super(`Devin ACP: ${message}`);
    this.name = "DevinAcpError";
  }
}

export interface AcpStreamOptions {
  model: string;
  json?: boolean;
  timeoutMs?: number;
  /** Background-task hint — takes a slot from the shared Devin work pool so a
   *  batch fan-out stays capped regardless of transport (see devin-cli.ts). */
  background?: boolean;
  signal?: AbortSignal;
  onReasoning?: (delta: string) => void;
  onUsage?: (usage: ProviderTokenUsage) => void;
}

/**
 * How long a cancel (timeout or caller abort) waits for the server to
 * acknowledge before the promise is failed LOCALLY.
 *
 * `session/cancel` is advisory — measured 2026-08-11: a prompt whose 300s
 * timeout had fired kept its `session/prompt` RPC pending until the server
 * finally answered at 612s, so the caller's "deadline" was a fiction. The
 * grace period gives an honest server a moment to stop cleanly (and deliver
 * usage); after it, the local promise rejects no matter what the child does.
 */
const CANCEL_GRACE_MS = 10_000;

/* -------------------------------------------------------------------------- */
/* JSON-RPC connection                                                        */
/* -------------------------------------------------------------------------- */

interface RpcPending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface SessionSink {
  onAnswer: (text: string) => void;
  onThought: (text: string) => void;
}

/** Kill the child after this long with no active prompts. */
const IDLE_REAP_MS = 5 * 60_000;

class AcpConnection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private initialized: Promise<void> | null = null;
  private nextId = 0;
  private pending = new Map<number, RpcPending>();
  private sinks = new Map<string, SessionSink>();
  private buffer = "";
  private activePrompts = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** The model the child's config booted with; set_config_option covers the rest. */
  private defaultModel: string | null = null;

  /** Spawn + initialize exactly once per child; re-arms after a crash. */
  ensureStarted(): Promise<void> {
    if (this.initialized && this.child) return this.initialized;
    const { cwd, configPath } = ensureWorkspace();

    // `devin acp` does NOT exit when its stdin closes (verified), so a
    // SIGKILLed server (jetsam, `kill -9`) would orphan the child forever —
    // the exact leak class AGENTS.md documents for this host. The pid file
    // lets the NEXT boot reap what the previous parent couldn't: kill only a
    // process whose pid we recorded AND whose argv still names our unique
    // config path, so a recycled pid is never mistaken for our child.
    const pidFile = join(cwd, "acp.pid");
    try {
      const stale = Number(readFileSync(pidFile, "utf8").trim());
      if (Number.isInteger(stale) && stale > 1) {
        const argv = execFileSync("ps", ["-o", "command=", "-p", String(stale)], { encoding: "utf8" });
        if (argv.includes("acp") && argv.includes(configPath)) process.kill(stale, "SIGTERM");
      }
    } catch {
      /* no stale pid, or it's already gone */
    }

    const child = spawn(DEVIN_BIN, ["--config", configPath, "acp"], {
      cwd,
      env: { ...process.env, NO_COLOR: "1", DEVIN_NO_UPDATE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.buffer = "";
    this.defaultModel = null;
    if (child.pid) {
      try {
        writeFileSync(pidFile, String(child.pid), "utf8");
      } catch {
        /* reaping is best-effort */
      }
    }

    child.stdout.on("data", (d: Buffer) => this.onData(d));
    child.stderr.on("data", () => {
      /* CLI logs — already persisted to its own log file; not our channel. */
    });
    child.on("error", (err) => this.teardown(new DevinAcpError(`spawn failed: ${err.message}`)));
    child.on("exit", (code) => this.teardown(new DevinAcpError(`process exited (code ${code})`)));

    this.initialized = this.rpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    }).then(() => undefined);
    return this.initialized;
  }

  /** Fail everything in flight and reset so the next call respawns. */
  private teardown(err: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    this.sinks.clear();
    this.initialized = null;
    if (this.child) {
      this.child.removeAllListeners();
      try {
        this.child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      this.child = null;
      try {
        rmSync(join(ensureWorkspace().cwd, "acp.pid"), { force: true });
      } catch {
        /* best-effort */
      }
    }
    for (const p of pending) p.reject(err);
  }

  private onData(d: Buffer): void {
    this.buffer += d.toString();
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: {
        id?: number;
        result?: unknown;
        error?: { message?: string; code?: number };
        method?: string;
        params?: { sessionId?: string; update?: { sessionUpdate?: string; content?: { text?: string } } };
      };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new DevinAcpError(msg.error.message ?? `rpc error ${msg.error.code}`));
        else p.resolve(msg.result);
      } else if (msg.method === "session/update" && msg.params?.sessionId) {
        const sink = this.sinks.get(msg.params.sessionId);
        const update = msg.params.update;
        if (!sink || !update) continue;
        const text = update.content?.text ?? "";
        if (update.sessionUpdate === "agent_message_chunk" && text) sink.onAnswer(text);
        else if (update.sessionUpdate === "agent_thought_chunk" && text) sink.onThought(text);
      }
      // Permission requests cannot occur: the inference config denies every
      // tool outright, so there is nothing to ask about. Other notifications
      // (session_info_update, available_commands_update) are ignored.
    }
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new DevinAcpError("not started"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", (err) => {
        if (err && this.pending.has(id)) {
          this.pending.delete(id);
          reject(new DevinAcpError(`stdin write failed: ${err.message}`));
        }
      });
    });
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n", () => {
      /* best-effort */
    });
  }

  private armIdleReaper(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.activePrompts === 0) this.teardown(new DevinAcpError("idle reap"));
    }, IDLE_REAP_MS);
    this.idleTimer.unref?.();
  }

  /**
   * One streamed completion: fresh session → pin the model → prompt →
   * relay chunks → clean up the session. Chunks are pushed into `queue` and
   * consumed by the async generator in streamViaDevinAcp.
   */
  async run(
    prompt: string,
    opts: AcpStreamOptions,
    push: (delta: string) => void,
    pushThought: (delta: string) => void,
  ): Promise<void> {
    await this.ensureStarted();
    const { cwd } = ensureWorkspace();

    this.activePrompts += 1;
    let sessionId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    // The LOCAL deadline. `session/cancel` is only a request — if the server
    // never honors it, the prompt RPC stays pending forever and every budget
    // above this layer becomes meaningless (see CANCEL_GRACE_MS). Racing the
    // RPC against this promise makes the deadline enforceable from our side.
    // The orphaned pending-RPC entry is bounded: it resolves into nothing when
    // the server finally answers, or dies with the connection.
    let failLocally: (err: Error) => void = () => {};
    const localDeadline = new Promise<never>((_, reject) => {
      failLocally = reject;
    });
    const armGrace = (err: Error) => {
      if (graceTimer) return;
      graceTimer = setTimeout(() => failLocally(err), CANCEL_GRACE_MS);
      graceTimer.unref?.();
    };

    const onAbort = () => {
      if (sessionId) this.notify("session/cancel", { sessionId });
      armGrace(new DOMException("Aborted", "AbortError"));
    };

    try {
      const created = (await this.rpc("session/new", { cwd, mcpServers: [] })) as { sessionId?: string };
      if (!created?.sessionId) throw new DevinAcpError("session/new returned no sessionId");
      sessionId = created.sessionId;
      this.sinks.set(sessionId, { onAnswer: push, onThought: pushThought });

      // Per-session model pin — the config's boot model only covers one tier.
      if (opts.model !== this.defaultModel) {
        try {
          await this.rpc("session/set_config_option", { sessionId, configId: "model", value: opts.model });
        } catch (err) {
          throw new DevinAcpError(`model "${opts.model}" not settable: ${err instanceof Error ? err.message : err}`);
        }
      }

      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.timeoutMs) {
        timer = setTimeout(() => {
          timedOut = true;
          if (sessionId) this.notify("session/cancel", { sessionId });
          armGrace(new DOMException(`Devin ACP timed out after ${opts.timeoutMs}ms`, "TimeoutError"));
        }, opts.timeoutMs);
      }

      const result = (await Promise.race([
        this.rpc("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: prompt }],
        }),
        localDeadline,
      ])) as {
        stopReason?: string;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          cachedReadTokens?: number;
          cachedWriteTokens?: number;
        };
      };

      if (timedOut) throw new DOMException(`Devin ACP timed out after ${opts.timeoutMs}ms`, "TimeoutError");
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (result?.stopReason && result.stopReason !== "end_turn" && result.stopReason !== "max_turn_requests") {
        throw new DevinAcpError(`stopped: ${result.stopReason}`);
      }
      if (result?.usage && opts.onUsage) {
        opts.onUsage({
          promptTokens: result.usage.inputTokens,
          completionTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cachedReadTokens,
          cacheCreationTokens: result.usage.cachedWriteTokens,
        });
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (sessionId) {
        this.sinks.delete(sessionId);
        // Inference turns are throwaway — don't silt up the user's `devin ls`.
        this.rpc("session/delete", { sessionId }).catch(() => {
          /* best-effort */
        });
      }
      this.activePrompts -= 1;
      this.armIdleReaper();
    }
  }

  killForShutdown(): void {
    this.teardown(new DevinAcpError("shutdown"));
  }
}

const connection = new AcpConnection();

let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => connection.killForShutdown());
}

function acpDisabled(): boolean {
  return process.env.DEVIN_CLI_DISABLED === "1" || process.env.DEVIN_ACP_DISABLED === "1";
}

/** Whether the ACP transport may be used at all — the provider checks this
 *  BEFORE attempting a stream, so `DEVIN_ACP_DISABLED=1` degrades cleanly to
 *  print mode instead of surfacing as a provider failure. */
export function acpEnabled(): boolean {
  return !acpDisabled();
}

/**
 * Pre-warm the connection (spawn + initialize, ~1s) so the FIRST streamed
 * turn doesn't pay it. Fire-and-forget; failures stay quiet — the stream
 * call will surface a real error if one exists.
 */
export function warmDevinAcp(): void {
  if (acpDisabled()) return;
  installExitHook();
  void connection.ensureStarted().catch(() => {
    /* the actual call reports errors */
  });
}

/**
 * Stream one completion through the persistent ACP connection.
 * Yields answer deltas; reasoning deltas go to `onReasoning`.
 */
export async function* streamViaDevinAcp(
  messages: ProviderChatTurn[],
  opts: AcpStreamOptions,
): AsyncGenerator<string, void, unknown> {
  if (acpDisabled()) throw new DevinUnavailableError("disabled via env");
  installExitHook();

  const prompt = flattenMessages(messages, { json: opts.json });

  // Background work is capped by the SAME pool that bounds print-mode
  // subprocesses (see devin-cli.ts:acquireDevinSlot) — a batch fan-out that
  // migrates transports keeps its concurrency ceiling. Interactive prompts
  // skip the pool entirely.
  const slot = opts.background ? await acquireDevinSlot(true) : null;

  // Producer/consumer bridge: run() pushes deltas as JSON-RPC notifications
  // arrive; the generator drains them in order and finishes when run() does.
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const push = (delta: string) => {
    queue.push(delta);
    wake?.();
  };
  const pushThought = (delta: string) => opts.onReasoning?.(delta);

  let done = false;
  let failure: unknown = null;
  const running = connection
    .run(prompt, opts, push, pushThought)
    .catch((err) => {
      failure = err;
    })
    .finally(() => {
      done = true;
      slot?.();
      wake?.();
    });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (done || queue.length > 0) resolve();
      });
      wake = null;
      continue;
    }
    yield queue.shift()!;
  }
  await running;
  if (failure) throw failure;
}
