/**
 * Devin v3 API client — the only module that talks HTTP to api.devin.ai.
 *
 * Deliberately mirrors lib/ai/ollama.ts's role for the other provider: typed
 * endpoints, transient-failure retry, and typed errors. Auth comes from env
 * only; the key is never logged and never appears in error messages.
 *
 * Endpoint contracts are documented (with live-doc citations) in
 * ai-migration/02-devin-capabilities.md §1b–1h.
 */

export class DevinConfigError extends Error {
  code = "devin_config" as const;
  constructor() {
    super("Devin provider is not configured. Set DEVIN_API_KEY and DEVIN_ORG_ID in .env.local.");
    this.name = "DevinConfigError";
  }
}

export class DevinApiError extends Error {
  code = "devin_api" as const;
  constructor(
    public status: number,
    detail: string,
  ) {
    super(`Devin API ${status}: ${detail}`);
    this.name = "DevinApiError";
  }
}

export interface DevinSession {
  session_id: string;
  url: string;
  status: "new" | "claimed" | "running" | "exit" | "error" | "suspended" | "resuming";
  status_detail?: string | null;
  structured_output?: Record<string, unknown> | null;
  acus_consumed?: number | null;
  tags?: string[];
  created_at?: number;
  updated_at?: number;
}

export interface CreateSessionBody {
  prompt: string;
  title?: string;
  playbook_id?: string;
  knowledge_ids?: string[];
  structured_output_schema?: Record<string, unknown>;
  structured_output_required?: boolean;
  devin_mode?: string;
  resumable?: boolean;
  max_acu_limit?: number;
  tags?: string[];
}

function credentials(): { key: string; org: string } {
  const key = process.env.DEVIN_API_KEY;
  const org = process.env.DEVIN_ORG_ID;
  if (!key || !org) throw new DevinConfigError();
  return { key, org };
}

export function devinConfigured(): boolean {
  return Boolean(process.env.DEVIN_API_KEY && process.env.DEVIN_ORG_ID);
}

/**
 * Fetch with retry on transient failures (network reject, 429, 5xx) using
 * jittered exponential backoff. 4xx responses other than 429 are returned to
 * the caller — retrying a validation error just burns time.
 */
async function devinFetch(pathname: string, init: RequestInit = {}, attempts = 5): Promise<Response> {
  const { key, org } = credentials();
  const base = `https://api.devin.ai/v3/organizations/${org}`;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${base}${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000;
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 500 * 2 ** i * (0.5 + Math.random());
        await new Promise((r) => setTimeout(r, Math.min(backoff, 8_000)));
        continue;
      }
      return res;
    } catch (err) {
      // Caller aborts propagate — nobody is waiting for a retry.
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** i, 8_000)));
    }
  }
  throw new DevinApiError(0, `unreachable after ${attempts} attempts (${lastErr instanceof Error ? lastErr.message : "network error"})`);
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new DevinApiError(res.status, (body.detail as string) ?? (body.title as string) ?? "unknown error");
  }
  return body as T;
}

export async function createSession(body: CreateSessionBody, signal?: AbortSignal): Promise<DevinSession> {
  return readJson<DevinSession>(await devinFetch(`/sessions`, { method: "POST", body: JSON.stringify(body), signal }));
}

export async function getSession(sessionId: string, signal?: AbortSignal): Promise<DevinSession> {
  return readJson<DevinSession>(await devinFetch(`/sessions/${sessionId}`, { signal }));
}

export async function sendMessage(sessionId: string, message: string, signal?: AbortSignal): Promise<void> {
  await readJson(await devinFetch(`/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ message }), signal }));
}

/** Best-effort terminate — cleanup must never mask the original failure. */
export async function terminateSession(sessionId: string): Promise<boolean> {
  try {
    const res = await devinFetch(`/sessions/${sessionId}`, { method: "DELETE" }, 3);
    return res.ok;
  } catch {
    return false;
  }
}

/** Cursor-paginated session list (used by idempotency recovery + the sweeper). */
export async function listSessions(): Promise<DevinSession[]> {
  const sessions: DevinSession[] = [];
  let after = "";
  for (let page = 0; page < 20; page++) {
    const d = await readJson<{ items?: DevinSession[]; has_next_page?: boolean; end_cursor?: string }>(
      await devinFetch(`/sessions?first=100${after ? `&after=${encodeURIComponent(after)}` : ""}`),
    );
    sessions.push(...(d.items ?? []));
    if (!d.has_next_page || !d.end_cursor) break;
    after = d.end_cursor;
  }
  return sessions;
}

/** Reachability probe for the provider health surface. */
export async function checkDevinHealth(): Promise<{ reachable: boolean; detail?: string }> {
  if (!devinConfigured()) return { reachable: false, detail: "not configured" };
  try {
    const { key } = credentials();
    const res = await fetch("https://api.devin.ai/v3/self", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? { reachable: true } : { reachable: false, detail: `HTTP ${res.status}` };
  } catch {
    return { reachable: false, detail: "network error" };
  }
}
