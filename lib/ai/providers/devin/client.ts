/**
 * Devin API client — the only module that talks HTTP to api.devin.ai.
 *
 * Deliberately mirrors lib/ai/ollama.ts's role for the other provider: typed
 * endpoints, transient-failure retry, and typed errors. Auth comes from env
 * only; the key is never logged and never appears in error messages.
 *
 * Speaks BOTH API generations, keyed off the credential prefix, because the
 * two machines this repo is developed on hold different key types:
 *
 *   cog_…        → v3 org-scoped API (needs DEVIN_ORG_ID). Full feature set:
 *                  structured_output_required, devin_mode, resumable,
 *                  acus_consumed on GET.
 *   apk_[user_]… → legacy v1 API (personal key; no org id). Lacks the three
 *                  fields above — reliability then rests on the playbook +
 *                  SESSION_DIRECTIVE contract, measured 5/5 first-attempt
 *                  valid in ai-migration/04b-spike-results-v1-key.md.
 *
 * v1 responses are TRANSLATED into the v3 status vocabulary here, at the
 * edge, so the provider's lifecycle logic exists exactly once: v1's
 * status_enum "blocked" becomes running/waiting_for_user, "finished" becomes
 * running/finished, "expired" becomes exit. Endpoint contracts for both
 * generations are documented (with live-doc citations) in
 * ai-migration/02-devin-capabilities.md §1b–1h and 04b.
 */

export class DevinConfigError extends Error {
  code = "devin_config" as const;
  constructor() {
    super(
      "Devin provider is not configured. Set DEVIN_API_KEY (cog_… plus DEVIN_ORG_ID, or a personal apk_… key) in .env.local.",
    );
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

function isLegacyKey(key: string): boolean {
  return key.startsWith("apk_");
}

function credentials(): { key: string; base: string; legacy: boolean } {
  const key = process.env.DEVIN_API_KEY;
  const org = process.env.DEVIN_ORG_ID;
  if (!key) throw new DevinConfigError();
  if (isLegacyKey(key)) return { key, base: "https://api.devin.ai/v1", legacy: true };
  if (!org) throw new DevinConfigError();
  return { key, base: `https://api.devin.ai/v3/organizations/${org}`, legacy: false };
}

export function devinConfigured(): boolean {
  const key = process.env.DEVIN_API_KEY;
  if (!key) return false;
  return isLegacyKey(key) || Boolean(process.env.DEVIN_ORG_ID);
}

/* -------------------------- v1 → v3 translation --------------------------- */

interface V1Session {
  session_id: string;
  url?: string;
  status?: string;
  status_enum?: string | null;
  structured_output?: Record<string, unknown> | null;
  tags?: string[] | null;
}

/**
 * Map v1's status vocabulary onto v3's so the provider has one lifecycle to
 * reason about. The mapping is behavioral, not cosmetic: "blocked" is v1's
 * only signal for "the agent asked a question", which the provider answers
 * with its one corrective turn; "expired" is a session the platform gave up
 * on, which must read as terminal-without-output rather than still-working.
 */
function fromV1(s: V1Session): DevinSession {
  const e = s.status_enum ?? "";
  let status: DevinSession["status"] = "running";
  let detail: string | null = null;
  if (e === "blocked") detail = "waiting_for_user";
  else if (e === "finished") detail = "finished";
  else if (e === "expired") status = "exit";
  else if (e.startsWith("suspend")) status = "suspended";
  else if (e === "working" || e === "resumed" || e.startsWith("resume")) detail = "working";
  else if (!e) status = "new"; // create response carries no status_enum
  return {
    session_id: s.session_id,
    url: s.url ?? `https://app.devin.ai/sessions/${s.session_id.replace(/^devin-/, "")}`,
    status,
    status_detail: detail,
    structured_output: s.structured_output ?? null,
    acus_consumed: null, // v1's GET has no ACU field (04b §Other observations)
    tags: s.tags ?? [],
  };
}

/** Fields the v1 create schema does not define — sending them 422s. */
const V3_ONLY_CREATE_FIELDS = ["structured_output_required", "devin_mode", "resumable"] as const;

function toV1CreateBody(body: CreateSessionBody): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body, idempotent: false };
  for (const f of V3_ONLY_CREATE_FIELDS) delete out[f];
  return out;
}

/**
 * Fetch with retry on transient failures (network reject, 429, 5xx) using
 * jittered exponential backoff. 4xx responses other than 429 are returned to
 * the caller — retrying a validation error just burns time.
 */
async function devinFetch(pathname: string, init: RequestInit = {}, attempts = 5): Promise<Response> {
  const { key, base } = credentials();
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
  const { legacy } = credentials();
  const wire = legacy ? toV1CreateBody(body) : body;
  const raw = await readJson<V1Session & DevinSession>(
    await devinFetch(`/sessions`, { method: "POST", body: JSON.stringify(wire), signal }),
  );
  return legacy ? fromV1(raw) : raw;
}

export async function getSession(sessionId: string, signal?: AbortSignal): Promise<DevinSession> {
  const { legacy } = credentials();
  const raw = await readJson<V1Session & DevinSession>(await devinFetch(`/sessions/${sessionId}`, { signal }));
  return legacy ? fromV1(raw) : raw;
}

export async function sendMessage(sessionId: string, message: string, signal?: AbortSignal): Promise<void> {
  // v1 named the endpoint in the singular; the body is identical.
  const path = credentials().legacy ? `/sessions/${sessionId}/message` : `/sessions/${sessionId}/messages`;
  await readJson(await devinFetch(path, { method: "POST", body: JSON.stringify({ message }), signal }));
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

/**
 * Session list (used by idempotency recovery + the sweeper). Cursor-paginated
 * on v3; offset-paginated on v1. v1 list entries may omit tags — consumers
 * already treat "no tags" as "not mine", so a degraded v1 list makes the
 * sweeper a safe no-op rather than a hazard to other sessions.
 */
export async function listSessions(): Promise<DevinSession[]> {
  const { legacy } = credentials();
  const sessions: DevinSession[] = [];
  if (legacy) {
    for (let page = 0; page < 20; page++) {
      const d = await readJson<{ sessions?: V1Session[]; items?: V1Session[] } | V1Session[]>(
        await devinFetch(`/sessions?limit=100&offset=${page * 100}`),
      );
      const items = Array.isArray(d) ? d : (d.sessions ?? d.items ?? []);
      sessions.push(...items.map(fromV1));
      if (items.length < 100) break;
    }
    return sessions;
  }
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
    const { key, legacy } = credentials();
    // v3 has a cheap identity endpoint; v1 has nothing equivalent, so the
    // smallest authenticated read stands in for it.
    const res = await fetch(
      legacy ? "https://api.devin.ai/v1/sessions?limit=1" : "https://api.devin.ai/v3/self",
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5_000) },
    );
    return res.ok ? { reachable: true } : { reachable: false, detail: `HTTP ${res.status}` };
  } catch {
    return { reachable: false, detail: "network error" };
  }
}
