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

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/** Default model when a caller doesn't pick one explicitly. */
export const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

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
  models?: { name?: string; model?: string }[];
}

/**
 * List installed model ids. Best-effort: returns [] when Ollama is unreachable
 * so callers (e.g. the model picker) can degrade gracefully instead of throwing.
 */
export async function listInstalledModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as TagsResponse;
    return (data.models ?? [])
      .map((m) => m.model ?? m.name)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
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
  signal?: AbortSignal;
}

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
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
  const body = JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    stream: true,
    options: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
    },
  });

  const res = await withRetry(() =>
    fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: opts.signal,
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
      const piece = chunk.message?.content;
      if (piece) yield piece;
      if (chunk.done) return;
    }
  }
}

export interface GenerateOptions {
  model?: string;
  system?: string;
  temperature?: number;
  /** Append a strict JSON-only instruction to the prompt. */
  json?: boolean;
  timeoutMs?: number;
}

/**
 * Single-shot (non-streaming) completion via /api/chat. The blocking
 * counterpart to {@link streamChat} for callers that want one string back —
 * same retry, same typed errors.
 */
export async function generate(
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const model = opts.model ?? DEFAULT_MODEL;
  const content = opts.json
    ? `${prompt}\n\nRespond ONLY with valid JSON. No markdown, no explanation.`
    : prompt;
  const messages: ChatTurn[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    { role: "user" as const, content },
  ];

  const res = await withRetry(() =>
    fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0.4 },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    }),
  );

  const data = (await res.json().catch(() => ({}))) as OllamaChatChunk;
  if (!res.ok || data.error) {
    const message = data.error ?? `Ollama request failed (${res.status}).`;
    if (/not found|no such model|try pulling/i.test(message)) {
      throw new ModelMissingError(model);
    }
    throw new Error(message);
  }
  return (data.message?.content ?? "").trim();
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
      if (err instanceof DOMException && err.name === "AbortError") throw err;
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
 * Split a completed reasoning-model response into its hidden reasoning and the
 * user-facing answer. DeepSeek-R1 / Qwen3 wrap chain-of-thought in
 * <think>…</think>; we strip it from the answer but keep it for an optional
 * "show reasoning" toggle. Pure / testable.
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
