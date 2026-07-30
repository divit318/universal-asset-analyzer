/**
 * Ollama Service Layer — the only module that talks HTTP to Ollama.
 *
 * Everything inference-related funnels through here: health checks, the list of
 * installed models, streaming chat completions, retry/backoff on transient
 * failures, and segregation of reasoning-model <think> output from the answer.
 * Higher layers never touch fetch or parse Ollama's wire format.
 *
 * Local-only by construction: the host defaults to localhost and there is no
 * code path to any hosted/paid provider.
 */

import { JSON_ONLY_INSTRUCTION } from "./prompts";

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/** Raised when Ollama can't be reached at all (daemon not running). */
export class OllamaUnavailableError extends Error {
  code = "ollama_unavailable" as const;
  constructor(host = OLLAMA_HOST) {
    super(`Could not reach Ollama at ${host}. Is it running? (\`ollama serve\`)`);
    this.name = "OllamaUnavailableError";
  }
}

/** Raised when the requested model isn't pulled locally. */
export class ModelMissingError extends Error {
  code = "model_missing" as const;
  constructor(model: string) {
    super(`Model "${model}" is not installed. Run \`ollama pull ${model}\`.`);
    this.name = "ModelMissingError";
  }
}

interface TagsResponse {
  models?: { name?: string; model?: string; size?: number }[];
}

/** An installed model as Ollama reports it, including its on-disk footprint. */
export interface InstalledModel {
  id: string;
  /**
   * Weights size in GB, straight from Ollama. The Router compares this against
   * the machine's memory budget: a model larger than RAM isn't "slower", it
   * thrashes (measured: an 18.6GB model on a 17GB host ran at 0.9 tok/s, ~11x
   * slower than a 4.4GB one). Read from the daemon rather than hardcoded in the
   * registry so the number can never drift from what's actually installed.
   */
  sizeGb: number;
}

/**
 * List installed models with their sizes. Best-effort: returns [] when Ollama
 * is unreachable so callers (e.g. the model picker) degrade gracefully.
 */
export async function listModelInfo(): Promise<InstalledModel[]> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as TagsResponse;
    return (data.models ?? [])
      .map((m) => ({ id: m.model ?? m.name ?? "", sizeGb: (m.size ?? 0) / 1e9 }))
      .filter((m) => Boolean(m.id));
  } catch {
    return [];
  }
}

/**
 * List installed model ids. Best-effort: returns [] when Ollama is unreachable
 * so callers (e.g. the model picker) can degrade gracefully instead of throwing.
 */
export async function listInstalledModels(): Promise<string[]> {
  return (await listModelInfo()).map((m) => m.id);
}

export interface HealthStatus {
  reachable: boolean;
  models: string[];
}

/** Single round-trip health probe used by the UI and chat route. */
export async function checkHealth(): Promise<HealthStatus> {
  const models = await listInstalledModels();
  // /api/tags succeeding (even with no models) means the daemon answered.
  let reachable = models.length > 0;
  if (!reachable) {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/version`, {
        signal: AbortSignal.timeout(3000),
      });
      reachable = res.ok;
    } catch {
      reachable = false;
    }
  }
  return { reachable, models };
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatTurn[];
  temperature?: number;
  /** Upper bound on context tokens Ollama keeps in the window. */
  numCtx?: number;
  /** Cap on generated tokens. Omit to let the model run to its natural stop. */
  maxTokens?: number;
  /**
   * Toggle a hybrid reasoning model's chain-of-thought (Qwen3 et al).
   *
   * Left unset, Qwen3 thinks by default, and thinking is expensive and — under
   * `format: "json"` — outright broken:
   *   - prose:  143s with thinking vs 28s without, for a comparable answer (5x).
   *   - json:   thinking + format:"json" returns the literal string `{}` in two
   *             tokens, 0/3 valid vs 3/3 with thinking off. `{}` *parses*, so
   *             this failed silently — every JSON task got an empty object.
   * The Router therefore forces this to false whenever `json` is set.
   */
  think?: boolean;
  /** Receives reasoning deltas when `think` is on; answer deltas are yielded. */
  onThinking?: (delta: string) => void;
  /**
   * Constrain the model to emit JSON only — the streaming counterpart of
   * {@link GenerateOptions.json}.
   *
   * Without this, a streamed JSON task free-forms: the model wraps its object in
   * a ```json fence, adds a preamble and a sign-off, and generally writes more
   * tokens than asked. Measured on the report route, that made the streamed
   * verdict ~45% slower than the identical non-streamed one — which would have
   * made streaming a net downgrade rather than a pure latency win.
   */
  json?: boolean;
  /**
   * Deadline for the whole request — the streaming counterpart of
   * {@link GenerateOptions.timeoutMs}.
   *
   * Was missing entirely, which made a task's declared `timeoutMs` a
   * suggestion rather than a bound: {@link generate} honoured it, `streamChat`
   * had no field to receive it, and `ollama-provider.complete()` routes any
   * multi-turn request (i.e. any conversation with history) down this path. So
   * `app-assistant`, which declares 45s, could and did run for minutes — the
   * Router's per-model fallback then multiplied that by the candidate count.
   *
   * Deliberately no blanket default here, unlike {@link generate}'s 120s: a
   * genuinely streamed generation is *meant* to run long, and a default would
   * truncate it mid-answer. The Router always resolves a value from the task
   * and model registries, so in practice one is always supplied.
   */
  timeoutMs?: number;
  /**
   * How long Ollama keeps the model resident after answering (its `keep_alive`),
   * e.g. "30m". Omitted → Ollama's own 5-minute default.
   *
   * Load time dominates everything else on a modest host: measured here, a
   * 4.4GB model took **69.6s to load and 0.4s to generate**. At Ollama's
   * default the model is evicted after five idle minutes, so an occasional
   * user pays that 69.6s on essentially every visit — and an interactive task
   * whose whole deadline is 45s could therefore never complete, no matter how
   * trivial the question. Keeping the interactive model warm is what makes the
   * declared latency budget achievable rather than aspirational.
   */
  keepAlive?: string;
  signal?: AbortSignal;
}

interface OllamaChatChunk {
  /**
   * `thinking` is Ollama's *native* reasoning channel — modern builds return
   * chain-of-thought here rather than as inline <think> tags in `content`.
   * Anything that only scans `content` for tags (see {@link splitThinking})
   * silently sees no reasoning at all on these models.
   */
  message?: { content?: string; thinking?: string };
  done?: boolean;
  error?: string;
}

function withJsonInstruction(messages: ChatTurn[]): ChatTurn[] {
  return messages.map((m, i) =>
    i === messages.length - 1 && m.role === "user"
      ? { ...m, content: `${m.content}\n\n${JSON_ONLY_INSTRUCTION}` }
      : m,
  );
}

/**
 * Ollama request options common to both call shapes. `think` is sent only when
 * explicitly set, so non-reasoning models (mistral) never see an unknown field.
 */
function buildBody(opts: ChatOptions, stream: boolean) {
  return JSON.stringify({
    model: opts.model,
    messages: opts.json ? withJsonInstruction(opts.messages) : opts.messages,
    stream,
    ...(opts.json ? { format: "json" } : {}),
    ...(opts.think === undefined ? {} : { think: opts.think }),
    ...(opts.keepAlive ? { keep_alive: opts.keepAlive } : {}),
    options: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
      ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
    },
  });
}

/**
 * Stream a chat completion token-by-token from Ollama's /api/chat. Yields raw
 * content deltas (reasoning tags still embedded — see {@link splitThinking}).
 *
 * Connection failures and a missing model are mapped to typed errors so the
 * route layer can return the right status + machine-readable code. Only the
 * initial connection is retried; once tokens are flowing we never replay.
 */
export async function* streamChat(
  opts: ChatOptions,
): AsyncGenerator<string, void, unknown> {
  const body = buildBody(opts, true);

  const res = await withRetry(() =>
    fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: deadlineSignal(opts.signal, opts.timeoutMs),
    }),
  );

  if (!res.ok || !res.body) {
    // Try to read Ollama's JSON error for a precise message.
    let message = `Ollama request failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    if (/not found|no such model|try pulling/i.test(message)) {
      throw new ModelMissingError(opts.model);
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Ollama emits one JSON object per line.
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let chunk: OllamaChatChunk;
      try {
        chunk = JSON.parse(line) as OllamaChatChunk;
      } catch {
        continue; // skip partial/garbled line
      }
      if (chunk.error) {
        if (/not found|no such model/i.test(chunk.error)) {
          throw new ModelMissingError(opts.model);
        }
        throw new Error(chunk.error);
      }
      // Native reasoning channel — routed to the caller's sink, never yielded
      // into the answer stream.
      const thought = chunk.message?.thinking;
      if (thought) opts.onThinking?.(thought);
      const piece = chunk.message?.content;
      if (piece) yield piece;
      if (chunk.done) return;
    }
  }
}

export interface GenerateOptions {
  /** Required: the Router always resolves a model. There is no ambient default. */
  model: string;
  system?: string;
  temperature?: number;
  /** Append a strict JSON-only instruction to the prompt. */
  json?: boolean;
  /** See {@link ChatOptions.think}. Forced false by the Router under `json`. */
  think?: boolean;
  numCtx?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** See {@link ChatOptions.keepAlive}. */
  keepAlive?: string;
}

export interface GenerateResult {
  /** The answer text. */
  content: string;
  /** Native chain-of-thought, when the model emitted one. */
  thinking: string;
}

/**
 * Single-shot (non-streaming) completion via /api/chat. The blocking
 * counterpart to {@link streamChat} for callers that want one string back —
 * same retry, same typed errors.
 */
export async function generate(
  prompt: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const messages: ChatTurn[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    { role: "user" as const, content: prompt },
  ];

  const res = await withRetry(() =>
    fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildBody({ ...opts, messages }, false),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    }),
  );

  const data = (await res.json().catch(() => ({}))) as OllamaChatChunk;
  if (!res.ok || data.error) {
    const message = data.error ?? `Ollama request failed (${res.status}).`;
    if (/not found|no such model|try pulling/i.test(message)) {
      throw new ModelMissingError(opts.model);
    }
    throw new Error(message);
  }
  return {
    content: (data.message?.content ?? "").trim(),
    thinking: (data.message?.thinking ?? "").trim(),
  };
}

/**
 * Combine a caller's abort signal with a deadline. Returns whichever of the two
 * exists, or a signal that fires on the first of them when both do.
 *
 * Both matter and neither subsumes the other: the caller's signal carries
 * client disconnects (so an abandoned request stops occupying Ollama, which
 * serializes generations and makes one zombie request everyone else's queue),
 * while the deadline is what stops a memory-starved model running unbounded.
 */
export function deadlineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (timeoutMs == null) return signal;
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/**
 * Did a DEADLINE expire, as opposed to the caller cancelling?
 *
 * `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError" —
 * distinct from a caller's own `AbortController.abort()`, which defaults to
 * "AbortError". The distinction matters for two different reasons downstream:
 * a timeout says something about the model/host (worth a health-cooldown
 * ding, worth logging as `timeout` rather than `cancelled`), while a caller
 * abort says nothing about the model at all (see {@link isCallerAbort}).
 */
export function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

/**
 * Did the CALLER deliberately cancel this request (e.g. the user navigated
 * away, changed symbols, or re-triggered a re-analysis before the first one
 * finished)? Nobody is waiting for this answer any more — it must never be
 * retried, never count against the model's health, and never be reported to
 * the user as a failure.
 */
export function isCallerAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Did this rejection come from us cancelling the request, rather than from the
 * connection failing? Covers both {@link isTimeout} and {@link isCallerAbort} —
 * kept for call sites (like {@link withRetry}) that only need to know "don't
 * retry this", not which of the two happened. Call sites that need to tell
 * them apart (the Router's fallback and health-tracking policy, error
 * classification for the UI) use the two specific predicates instead.
 */
export function isDeliberateAbort(err: unknown): boolean {
  return isTimeout(err) || isCallerAbort(err);
}

interface PsResponse {
  models?: { model?: string; name?: string }[];
}

/**
 * Best-effort: is `model` already resident in Ollama, or would running it now
 * have to cold-load the weights from disk first?
 *
 * Load time, not generation, is what makes a local model feel broken —
 * measured elsewhere in this module at 69.6s to load a 4.4GB model vs 0.4s to
 * answer, and far worse under memory pressure (a 9.3GB model observed taking
 * the model's full 300s budget to load alone on a contended host). Knowing
 * "cold" in advance lets the Router (a) widen the timeout budget for just
 * this attempt instead of killing a legitimate cold load prematurely, and
 * (b) tell the UI to say "model warming up" instead of a confusing failure.
 *
 * Never throws and never affects correctness — a failed probe is treated as
 * "unknown", which callers fold into "assume warm" so behavior degrades to
 * exactly what it was before this existed.
 */
export async function isModelResident(model: string): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/ps`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = (await res.json()) as PsResponse;
    return (data.models ?? []).some((m) => (m.model ?? m.name) === model);
  } catch {
    return false;
  }
}

/**
 * Retry a fetch that fails to connect, with linear backoff. A failed *fetch*
 * (network/DNS/connection-refused) rejects, which we treat as "daemon down" and
 * retry; an HTTP error response resolves and is returned untouched. After the
 * final attempt we surface a typed {@link OllamaUnavailableError}.
 */
async function withRetry(
  fn: () => Promise<Response>,
  attempts = 3,
): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      // An aborted request is intentional — don't retry it.
      //
      // "Intentional" has to include the DEADLINE, not just a caller abort.
      // `AbortSignal.timeout()` rejects with a DOMException named
      // "TimeoutError", not "AbortError", so a guard that only named the latter
      // silently retried every expiry: each attempt waited out the full
      // timeout, so a task's declared budget was multiplied by `attempts`, and
      // then by the Router's candidate count on top. app-assistant declares
      // 45s and took 6m40s — 45s x 3 attempts x 3 candidate models.
      //
      // Worse, exhausting the retries throws OllamaUnavailableError below, so a
      // model that was merely slow was reported as a daemon that was not
      // running — which is what the assistant panel told users to fix.
      if (isDeliberateAbort(err)) throw err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
  }
  throw new OllamaUnavailableError();
}

/* -------------------------------------------------------------------------- */
/* Reasoning-model output handling                                            */
/* -------------------------------------------------------------------------- */

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * Split a completed response into hidden reasoning and the user-facing answer,
 * for models that wrap chain-of-thought in inline <think>…</think> tags.
 *
 * Legacy path. Current Ollama builds return reasoning in a separate `thinking`
 * field instead (see {@link OllamaChatChunk}), which is what the provider reads
 * first. This remains as a fallback for models/runtimes that still inline the
 * tags — but it must not be the *only* reasoning handling, which is what let
 * chain-of-thought leak into answers unnoticed. Pure / testable.
 */
export function splitThinking(text: string): { reasoning: string; answer: string } {
  const open = text.indexOf(THINK_OPEN);
  if (open === -1) return { reasoning: "", answer: text };
  const close = text.indexOf(THINK_CLOSE, open);
  if (close === -1) {
    // Unterminated think block: everything after <think> is still reasoning.
    return { reasoning: text.slice(open + THINK_OPEN.length).trim(), answer: "" };
  }
  const reasoning = text.slice(open + THINK_OPEN.length, close).trim();
  const answer = (text.slice(0, open) + text.slice(close + THINK_CLOSE.length)).trim();
  return { reasoning, answer };
}

/**
 * Streaming-aware splitter. Feed it raw deltas; it routes text to `onReasoning`
 * while inside a <think> block and to `onAnswer` otherwise, handling tags that
 * arrive split across chunk boundaries. Stateful by design.
 */
export function createThinkingSplitter(handlers: {
  onReasoning: (t: string) => void;
  onAnswer: (t: string) => void;
}) {
  let buffer = "";
  let inThink = false;

  const flushPlain = (emit: (t: string) => void) => {
    // Hold back a tail that could be the start of a tag spanning chunks.
    const tag = inThink ? THINK_CLOSE : THINK_OPEN;
    let safe = buffer.length;
    for (let keep = 1; keep < tag.length; keep++) {
      if (buffer.endsWith(tag.slice(0, keep))) {
        safe = buffer.length - keep;
        break;
      }
    }
    if (safe > 0) {
      emit(buffer.slice(0, safe));
      buffer = buffer.slice(safe);
    }
  };

  return {
    push(delta: string) {
      buffer += delta;
      // Resolve as many complete tags as are present.
      for (;;) {
        const tag = inThink ? THINK_CLOSE : THINK_OPEN;
        const idx = buffer.indexOf(tag);
        if (idx === -1) break;
        const before = buffer.slice(0, idx);
        if (before) (inThink ? handlers.onReasoning : handlers.onAnswer)(before);
        buffer = buffer.slice(idx + tag.length);
        inThink = !inThink;
      }
      flushPlain(inThink ? handlers.onReasoning : handlers.onAnswer);
    },
    end() {
      if (buffer) (inThink ? handlers.onReasoning : handlers.onAnswer)(buffer);
      buffer = "";
    },
  };
}
