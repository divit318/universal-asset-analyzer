/**
 * DevinAnalysisProvider — one structured analysis per disposable Devin session.
 *
 * Lifecycle (hardened per the Phase 5 amendments, ai-migration/04):
 *   create (schema + playbook + dossier)
 *     → poll with backoff
 *     → harvest structured_output the moment it exists AND Zod-validates
 *       (empirical finding: output arrives while the session is still
 *        running/waiting_for_user; sessions never self-terminate)
 *     → ONE corrective message turn on Zod failure or a clarifying question
 *     → terminate UNCONDITIONALLY in a finally block — success, invalid
 *       output, timeout, thrown error, or caller abort. A disposable
 *       analysis session must never outlive its harvest.
 *
 * Timeouts are sized off the observed MAX (amendment 3), declared per task
 * as `devinTimeoutMs` in the task registry; defaults here are the fallback.
 */

import type {
  AnalysisProvider,
  AnalysisRequest,
  AnalysisResult,
} from "../../analysis-provider";
import { analysisInputHash, analysisIdempotencyKey } from "../../analysis-provider";
import { TASK_REGISTRY } from "../../task-registry";
import { logAiEvent } from "../../log";
import {
  createSession,
  getSession,
  sendMessage,
  terminateSession,
  listSessions,
  checkDevinHealth,
  type DevinSession,
} from "./client";
import { toStructuredOutputSchema } from "./schema";

const POLL_DELAYS_MS = [3_000, 5_000, 8_000, 13_000];
const POLL_CAP_MS = 15_000;
const DEFAULT_TIMEOUT_STANDARD_MS = 8 * 60_000;
const DEFAULT_TIMEOUT_BACKGROUND_MS = 15 * 60_000;

/**
 * Session-protocol directive appended to every prompt — the Devin analogue of
 * lib/ai/ollama.ts's withJsonInstruction(). Wire protocol, not house style
 * (house style lives in the synced playbook): call sites keep building ONE
 * provider-agnostic dossier, and each provider adds its own delivery rules.
 */
const SESSION_DIRECTIVE = `
---
NON-INTERACTIVE API SESSION RULES:
- Do not ask questions. If information is missing, state the assumption inside the output itself and proceed.
- Do not browse the web, do not clone or use any repository, and do not write files, unless the dossier above explicitly provides SUPPLEMENTARY SOURCES.
- Deliver your answer EXCLUSIVELY by calling provide_structured_output with is_final=true, then end your turn. Do not restate the answer in chat.`;

export class DevinAnalysisError extends Error {
  constructor(
    public category: "timeout" | "invalid_response" | "unknown" | "cancelled",
    message: string,
    public sessionUrl?: string,
  ) {
    super(message);
    this.name = "DevinAnalysisError";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function isAlive(s: DevinSession): boolean {
  return s.status === "new" || s.status === "claimed" || s.status === "running" || s.status === "resuming";
}

/**
 * Idempotency across ambiguous creates: before retrying a create whose
 * outcome we never saw, look for a live session already tagged with our key.
 * (v3 dropped v1's `idempotent` flag — ai-migration/02 §1b.)
 */
async function findSessionByTag(idemTag: string): Promise<DevinSession | null> {
  try {
    const sessions = await listSessions();
    return sessions.find((s) => (s.tags ?? []).includes(idemTag) && isAlive(s)) ?? null;
  } catch {
    return null;
  }
}

export class DevinAnalysisProvider implements AnalysisProvider {
  readonly id = "sessions" as const;

  async healthCheck(): Promise<{ reachable: boolean; detail?: string }> {
    return checkDevinHealth();
  }

  async run<T>(req: AnalysisRequest<T>): Promise<AnalysisResult<T>> {
    const task = TASK_REGISTRY[req.taskType];
    // Amendment 3: the Devin budget is tail-based and must never be strangled
    // by a caller's Ollama-oriented timeoutMs (e.g. the calendar route's 50s,
    // barely above the observed 48.8s session max). The task's declared
    // devinTimeoutMs (or the defaults) is the FLOOR; a caller can only widen.
    const floor =
      task.devinTimeoutMs ??
      (task.latency === "background" ? DEFAULT_TIMEOUT_BACKGROUND_MS : DEFAULT_TIMEOUT_STANDARD_MS);
    const timeoutMs = Math.max(req.timeoutMs ?? 0, floor);
    const idemKey =
      req.idempotencyKey ??
      analysisIdempotencyKey(req.taskType, req.subjectKey, analysisInputHash(req.prompt), req.schemaVersion);
    const idemTag = `idem:${idemKey}`;
    const t0 = Date.now();

    logAiEvent({ category: "start", taskType: req.taskType, model: "devin-sessions" });

    // Recover an in-flight session for this exact work (restart / double-enqueue).
    let session = await findSessionByTag(idemTag);
    if (!session) {
      session = await createSession(
        {
          prompt: `${req.prompt}\n${SESSION_DIRECTIVE}`,
          title: `UAA ${req.taskType} ${req.subjectKey}`,
          ...(process.env.DEVIN_PLAYBOOK_ID ? { playbook_id: process.env.DEVIN_PLAYBOOK_ID } : {}),
          knowledge_ids: [], // deliberate: playbook only, no ambient org knowledge (03 §6)
          structured_output_schema: toStructuredOutputSchema(req.wireSchema ?? req.schema),
          structured_output_required: true,
          devin_mode: process.env.DEVIN_MODE ?? "fast",
          resumable: false,
          max_acu_limit: task.devinMaxAcu ?? (Number(process.env.DEVIN_MAX_ACU) || 4),
          tags: ["uaa", req.taskType, idemTag],
        },
        req.signal,
      );
    }

    const sessionId = session.session_id;
    const sessionUrl = session.url;
    let acus: number | null = null;
    let correctiveSent = false;

    try {
      let poll = 0;
      while (Date.now() - t0 < timeoutMs) {
        await sleep(Math.min(POLL_DELAYS_MS[Math.min(poll, POLL_DELAYS_MS.length - 1)], POLL_CAP_MS), req.signal);
        poll++;
        const s = await getSession(sessionId, req.signal);
        acus = s.acus_consumed ?? acus;

        if (s.structured_output) {
          const parsed = req.schema.safeParse(s.structured_output);
          if (parsed.success) {
            const durationMs = Date.now() - t0;
            logAiEvent({ category: "success", taskType: req.taskType, model: "devin-sessions", durationMs });
            return {
              data: parsed.data,
              provider: "sessions",
              meta: { sessionId, sessionUrl, durationMs, acus },
            };
          }
          const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          const terminal = s.status === "exit" || s.status === "error";
          if (!correctiveSent && !terminal) {
            correctiveSent = true;
            await sendMessage(
              sessionId,
              `Your structured output failed validation: ${issues}. Call provide_structured_output again with a corrected object (is_final=true), then stop.`,
              req.signal,
            );
            continue;
          }
          logAiEvent({ category: "invalid_response", taskType: req.taskType, model: "devin-sessions", message: issues });
          throw new DevinAnalysisError("invalid_response", `Devin output failed schema validation: ${issues}`, sessionUrl);
        }

        // Devin asked a clarifying question instead of producing output
        // (amendment 1): one corrective push, then the clock decides — this
        // loop must never poll forever on a conversational stall.
        if (s.status === "running" && s.status_detail === "waiting_for_user") {
          if (!correctiveSent) {
            correctiveSent = true;
            await sendMessage(
              sessionId,
              "Do not ask questions — this is a non-interactive API session. State any assumption inside the output itself and deliver it now via provide_structured_output with is_final=true.",
              req.signal,
            );
          }
          continue;
        }

        if (s.status === "error" || ((s.status === "exit" || s.status === "suspended") && !s.structured_output)) {
          logAiEvent({ category: "unknown", taskType: req.taskType, model: "devin-sessions", message: `session ${s.status}/${s.status_detail ?? ""} without output` });
          throw new DevinAnalysisError("unknown", `Devin session ended (${s.status}) without structured output`, sessionUrl);
        }
      }

      logAiEvent({ category: "timeout", taskType: req.taskType, model: "devin-sessions", durationMs: Date.now() - t0 });
      throw new DevinAnalysisError("timeout", `Devin session exceeded its ${Math.round(timeoutMs / 1000)}s budget`, sessionUrl);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        logAiEvent({ category: "cancelled", taskType: req.taskType, model: "devin-sessions", durationMs: Date.now() - t0 });
        throw new DevinAnalysisError("cancelled", "analysis cancelled by caller", sessionUrl);
      }
      throw err;
    } finally {
      // Amendment 1: unconditional. Success, Zod failure, timeout, abort, or
      // a thrown error — the disposable session dies with the request.
      await terminateSession(sessionId);
    }
  }
}

export const devinAnalysisProvider = new DevinAnalysisProvider();
