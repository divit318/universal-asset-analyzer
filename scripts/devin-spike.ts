/**
 * Phase 4 spike — one REAL UAA analysis through the Devin v3 sessions API.
 *
 * Task: the Movement Explainer ("why did this stock move"), chosen as
 * migration step 1 in ai-migration/03-architecture.md. Evidence gathering is
 * the app's own deterministic code (lib/yahoo, lib/news, the pure helpers
 * from lib/movement-explainer); only the narrative synthesis goes to Devin,
 * with the output shape enforced by structured_output_schema (Zod → JSON
 * Schema Draft 7).
 *
 * Prints, per run: wall-clock latency (create → validated structured output),
 * ACUs consumed, whether the output validated against the Zod schema on the
 * FIRST attempt, and the session URL for auditing.
 *
 * Usage:
 *   npx tsx scripts/devin-spike.ts                       # 1 run, AAPL
 *   npx tsx scripts/devin-spike.ts --runs 5              # 5 concurrent runs
 *   npx tsx scripts/devin-spike.ts --runs 5 --sequential # 5 sequential runs
 *   npx tsx scripts/devin-spike.ts --symbol NVDA --mode normal
 *
 * Env (read from process.env, else parsed from .env.local): DEVIN_API_KEY,
 * DEVIN_ORG_ID, optional DEVIN_MODE. The key is never printed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { getQuote, getHistory } from "@/lib/yahoo";
import { getCompanyNews } from "@/lib/news";
import { windowReturn, volumeAnomaly } from "@/lib/movement-explainer";

/* ----------------------------- env ------------------------------------- */

function loadEnvLocal(): void {
  if (process.env.DEVIN_API_KEY && process.env.DEVIN_ORG_ID) return;
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnvLocal();

const API_KEY = process.env.DEVIN_API_KEY ?? "";
const ORG_ID = process.env.DEVIN_ORG_ID ?? "";
if (!API_KEY || !ORG_ID) {
  console.error(
    "[spike] DEVIN_API_KEY and/or DEVIN_ORG_ID missing. Add them to .env.local (see .env.example) and re-run.",
  );
  process.exit(1);
}
const BASE = `https://api.devin.ai/v3/organizations/${ORG_ID}`;

/* ----------------------------- CLI ------------------------------------- */

const { values: args } = parseArgs({
  options: {
    symbol: { type: "string", default: "AAPL" },
    runs: { type: "string", default: "1" },
    mode: { type: "string", default: process.env.DEVIN_MODE ?? "fast" },
    sequential: { type: "boolean", default: false },
    "max-acu": { type: "string", default: "4" },
    "budget-min": { type: "string", default: "15" },
  },
});
const SYMBOL = (args.symbol ?? "AAPL").toUpperCase();
const RUNS = Math.max(1, Number.parseInt(args.runs ?? "1", 10) || 1);
const BUDGET_MS = Number.parseFloat(args["budget-min"] ?? "15") * 60_000;

/* --------------------------- Zod schema -------------------------------- */
/** Mirrors RawMovementResponse in lib/movement-explainer.ts (schema v1). */

const DriverSchema = z.object({
  category: z
    .enum(["earnings", "analyst", "macro", "sector", "valuation", "news", "technical", "volume", "sentiment", "other"])
    .describe("The kind of driver"),
  description: z.string().min(1).describe("What happened, one sentence"),
  evidence: z.string().min(1).describe("The specific fact from the EVIDENCE section that supports this driver — quote it, do not invent"),
  direction: z.enum(["bullish", "bearish", "neutral"]),
});

const MovementSchema = z.object({
  summary: z.string().min(20).describe("2-3 sentence plain-English explanation of the movement"),
  drivers: z.array(DriverSchema).min(1).max(4).describe("Most important driver first"),
  confidence: z.number().int().min(0).max(100).describe("How well the evidence explains the move; lower it if evidence is thin"),
  persistence: z.enum(["transient", "short-term", "durable"]),
});
type Movement = z.infer<typeof MovementSchema>;
const SCHEMA_VERSION = 1;

/* ------------------------- evidence (real data) ------------------------ */

async function buildDossier(symbol: string): Promise<string> {
  const windowDays = 5;
  const [quote, history, news] = await Promise.all([
    getQuote(symbol).catch(() => null),
    getHistory(symbol, 30).catch(() => []),
    getCompanyNews(symbol, 6).catch(() => []),
  ]);
  const changePercent = windowReturn(history, windowDays) ?? quote?.changePercent ?? null;
  const volPct = volumeAnomaly(history);

  const moveDesc =
    changePercent != null
      ? `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% over the last ${windowDays} trading days`
      : "no reliable price history available";
  const volumeDesc =
    volPct != null ? `Volume is ${volPct >= 0 ? "up" : "down"} ${Math.abs(volPct).toFixed(0)}% vs. the prior 3-week average.` : "";
  const newsDesc = news.length
    ? news.map((n) => `• [${n.publishedAt.slice(0, 10)}] ${n.headline}${n.summary ? ` — ${n.summary}` : ""}`).join("\n")
    : "No recent company-specific news found.";

  return `You are an institutional equity analyst explaining a price movement to a client.

This is a NON-INTERACTIVE API session: do not ask questions, do not browse the
web, do not clone or use any repository, and do not write any files. Work only
from the EVIDENCE below. Deliver your answer EXCLUSIVELY by calling
provide_structured_output with is_final=true, then end your turn. Do not
summarize the answer in chat.

SUBJECT: stock ${symbol}${quote?.name ? ` (${quote.name})` : ""}
OBSERVED MOVE: ${moveDesc}
${volumeDesc}

EVIDENCE — RECENT NEWS:
${newsDesc}

Identify the most likely drivers of this movement. For each driver, cite the
specific evidence above that supports it — do not invent facts not present in
the evidence. If the evidence is too thin to explain the move confidently, say
so in the summary and lower the confidence score accordingly.`;
}

/* --------------------------- Devin client ------------------------------ */

interface SessionResponse {
  session_id: string;
  url: string;
  status: "new" | "claimed" | "running" | "exit" | "error" | "suspended" | "resuming";
  status_detail?: string | null;
  structured_output?: Record<string, unknown> | null;
  acus_consumed?: number;
}

async function devinFetch(pathname: string, init?: RequestInit, attempts = 5): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}${pathname}`, {
        ...init,
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** i;
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 8000)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** i, 8000)));
    }
  }
  throw new Error(`Devin API unreachable after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(body.detail as string) ?? (body.title as string) ?? "unknown error"}`);
  return body;
}

/* ----------------------------- one run --------------------------------- */

interface RunResult {
  run: number;
  sessionId: string;
  sessionUrl: string;
  createMs: number;
  totalMs: number;
  polls: number;
  acus: number | null;
  firstAttemptValid: boolean;
  validAfterRetry: boolean;
  outcome: "ok" | "invalid_output" | "timeout" | "error";
  transitions: string[];
  output: Movement | null;
  rawOutput: unknown;
  error?: string;
}

const jsonSchema = z.toJSONSchema(MovementSchema, { target: "draft-7" });
const activeSessions = new Set<string>();

async function terminate(sessionId: string): Promise<void> {
  try {
    await devinFetch(`/sessions/${sessionId}`, { method: "DELETE" }, 2);
  } catch {
    /* best-effort */
  }
}

async function runOnce(run: number, prompt: string): Promise<RunResult> {
  const t0 = performance.now();
  const idem = `spike-${SCHEMA_VERSION}-${Date.now()}-${run}`;
  const createRes = await devinFetch(`/sessions`, {
    method: "POST",
    body: JSON.stringify({
      prompt,
      title: `UAA spike explain-movement ${SYMBOL} #${run}`,
      structured_output_schema: jsonSchema,
      structured_output_required: true,
      devin_mode: args.mode,
      resumable: false,
      max_acu_limit: Number.parseInt(args["max-acu"] ?? "4", 10),
      knowledge_ids: [],
      tags: ["uaa", "spike", "explain-movement", `idem:${idem}`],
    }),
  });
  const created = (await readBody(createRes)) as unknown as SessionResponse;
  const createMs = performance.now() - t0;
  activeSessions.add(created.session_id);
  console.log(`[run ${run}] session ${created.session_id} created in ${(createMs / 1000).toFixed(1)}s → ${created.url}`);

  const transitions: string[] = [];
  let lastState = "";
  let polls = 0;
  let correctiveSent = false;
  let firstAttemptValid = false;
  let validAfterRetry = false;
  let output: Movement | null = null;
  let rawOutput: unknown = null;
  let outcome: RunResult["outcome"] = "timeout";
  let acus: number | null = null;
  let error: string | undefined;

  const delays = [3000, 5000, 8000, 13000];
  while (performance.now() - t0 < BUDGET_MS) {
    await new Promise((r) => setTimeout(r, delays[Math.min(polls, delays.length - 1)] ?? 15000));
    polls++;
    const s = (await readBody(await devinFetch(`/sessions/${created.session_id}`))) as unknown as SessionResponse;
    acus = s.acus_consumed ?? acus;
    const state = `${s.status}${s.status_detail ? `/${s.status_detail}` : ""}`;
    if (state !== lastState) {
      transitions.push(`${((performance.now() - t0) / 1000).toFixed(0)}s ${state}`);
      lastState = state;
      console.log(`[run ${run}] ${transitions[transitions.length - 1]}`);
    }

    const terminal = s.status === "exit" || s.status === "error" || s.status_detail === "finished";
    if (s.structured_output && (terminal || s.status_detail === "waiting_for_user")) {
      rawOutput = s.structured_output;
      const parsed = MovementSchema.safeParse(s.structured_output);
      if (parsed.success) {
        if (!correctiveSent) firstAttemptValid = true;
        else validAfterRetry = true;
        output = parsed.data;
        outcome = "ok";
        break;
      }
      if (!correctiveSent && !terminal) {
        correctiveSent = true;
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        console.log(`[run ${run}] output failed Zod validation (${issues}) — sending one corrective message`);
        await devinFetch(`/sessions/${created.session_id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            message: `Your structured output failed validation: ${issues}. Call provide_structured_output again with a corrected object, is_final=true, then stop.`,
          }),
        });
        continue;
      }
      outcome = "invalid_output";
      error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      break;
    }

    if (s.status === "error") {
      outcome = "error";
      error = `session error (${state})`;
      break;
    }
    if (s.status_detail === "waiting_for_user" && !s.structured_output) {
      if (!correctiveSent) {
        correctiveSent = true;
        console.log(`[run ${run}] session is waiting_for_user — sending corrective message`);
        await devinFetch(`/sessions/${created.session_id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            message: "Do not wait for input. State any assumption inside the summary field and deliver the result now via provide_structured_output with is_final=true.",
          }),
        });
      } else {
        outcome = "error";
        error = "session stuck in waiting_for_user after corrective message";
        break;
      }
    }
    if ((s.status === "exit" || s.status === "suspended") && !s.structured_output) {
      outcome = "error";
      error = `session ended (${state}) without structured output`;
      break;
    }
  }

  if (outcome === "timeout") {
    console.log(`[run ${run}] budget exhausted — terminating session`);
    await terminate(created.session_id);
  } else {
    // Disposable analysis session: clean up rather than leaving it to idle-sleep.
    await terminate(created.session_id);
    // ACU accounting lags the output; one delayed re-read to capture it.
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const fin = (await readBody(await devinFetch(`/sessions/${created.session_id}`))) as unknown as SessionResponse;
      acus = fin.acus_consumed ?? acus;
    } catch {
      /* keep last observed value */
    }
  }
  activeSessions.delete(created.session_id);

  return {
    run,
    sessionId: created.session_id,
    sessionUrl: created.url,
    createMs,
    totalMs: performance.now() - t0,
    polls,
    acus,
    firstAttemptValid,
    validAfterRetry,
    outcome,
    transitions,
    output,
    rawOutput,
    error,
  };
}

/* ------------------------------ main ----------------------------------- */

process.on("SIGINT", async () => {
  console.log(`\n[spike] interrupted — terminating ${activeSessions.size} in-flight session(s)`);
  await Promise.allSettled([...activeSessions].map(terminate));
  process.exit(130);
});

async function main() {
  console.log(`[spike] task=explain-movement symbol=${SYMBOL} runs=${RUNS} mode=${args.mode} ${args.sequential ? "sequential" : "concurrent"}`);
  console.log(`[spike] building dossier from live Yahoo data…`);
  const prompt = await buildDossier(SYMBOL);
  console.log(`[spike] dossier: ${prompt.length} chars; schema: ${JSON.stringify(jsonSchema).length} bytes (limit 65536)\n`);

  const results: RunResult[] = [];
  if (args.sequential) {
    for (let i = 1; i <= RUNS; i++) results.push(await runOnce(i, prompt));
  } else {
    results.push(...(await Promise.all(Array.from({ length: RUNS }, (_, i) => runOnce(i + 1, prompt)))));
  }

  console.log(`\n========== STRUCTURED RESULT (run 1) ==========`);
  console.log(JSON.stringify(results[0].outcome === "ok" ? results[0].output : results[0].rawOutput, null, 2));

  console.log(`\n========== SUMMARY (${RUNS} run${RUNS > 1 ? "s" : ""}, ${args.sequential ? "sequential" : "concurrent"}) ==========`);
  console.log(`run | outcome        | total    | create | polls | ACUs  | valid-1st-try | session`);
  for (const r of results) {
    console.log(
      `${String(r.run).padStart(3)} | ${r.outcome.padEnd(14)} | ${(r.totalMs / 1000).toFixed(1).padStart(6)}s | ${(r.createMs / 1000).toFixed(1).padStart(5)}s | ${String(r.polls).padStart(5)} | ${String(r.acus ?? "?").padStart(5)} | ${String(r.firstAttemptValid).padEnd(13)} | ${r.sessionUrl}`,
    );
    if (r.error) console.log(`      error: ${r.error}`);
  }
  const ok = results.filter((r) => r.outcome === "ok");
  if (ok.length) {
    const times = ok.map((r) => r.totalMs / 1000).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)];
    console.log(
      `\nlatency: min ${times[0].toFixed(1)}s  p50 ${p50.toFixed(1)}s  max ${times[times.length - 1].toFixed(1)}s | ` +
        `ACUs total ${ok.reduce((a, r) => a + (r.acus ?? 0), 0).toFixed(2)} | first-attempt-valid ${ok.filter((r) => r.firstAttemptValid).length}/${ok.length}`,
    );
  }

  const outDir = path.join(process.cwd(), "bench-out", "devin-spike");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ symbol: SYMBOL, mode: args.mode, sequential: args.sequential, promptChars: prompt.length, results }, null, 2));
  console.log(`\n[spike] full record written to ${outFile}`);

  process.exit(results.every((r) => r.outcome === "ok") ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`[spike] fatal: ${err instanceof Error ? err.message : err}`);
  await Promise.allSettled([...activeSessions].map(terminate));
  process.exit(1);
});
