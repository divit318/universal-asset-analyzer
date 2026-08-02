/**
 * Phase 4 spike — ONE real UAA analysis end-to-end through the Devin sessions
 * API, run N times, reporting exactly what the docs could not tell us:
 *
 *   1. Wall-clock latency, session create → validated structured output
 *   2. ACUs consumed per run (`acus_consumed` from GET session)
 *   3. Whether `structured_output` satisfies the Zod schema on the FIRST poll
 *      that returns it (no corrective messages sent — failures are reported,
 *      not repaired, because the point is to measure reliability)
 *   4. Variance across runs
 *   5. Bonus (run with --reuse): wake-from-suspend latency — send a follow-up
 *      message to the final session and time a second structured output.
 *      This single number decides whether the pseudo-chat pattern is viable.
 *
 * Usage:
 *   npx tsx scripts/devin-spike.ts [--runs 5] [--mode normal|fast] [--symbol NVDA] [--reuse]
 *
 * Requires DEVIN_API_KEY and DEVIN_ORG_ID in .env.local (never printed, never
 * passed into prompts). Real market data is fetched once via lib/yahoo and the
 * identical prompt is used for every run, so variance measures the platform,
 * not the inputs. Every session carries max_acu_limit and is terminated on
 * deadline — a spike must not leave runaway sessions behind.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getQuote } from "../lib/yahoo";
import { VerdictSchema, verdictJsonSchema, VERDICT_SCHEMA_VERSION } from "../lib/ai/schemas/verdict";
import { formatCurrency, formatMarketCap, formatPercent } from "../lib/format";

/* ----------------------------- env (.env.local) ---------------------------- */

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // absence handled below with a clear message
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvLocal();

const API_KEY = process.env.DEVIN_API_KEY;
const ORG_ID = process.env.DEVIN_ORG_ID;
const BASE = process.env.DEVIN_API_BASE ?? "https://api.devin.ai/v3";

if (!API_KEY || !ORG_ID) {
  console.error(
    "DEVIN_API_KEY and/or DEVIN_ORG_ID missing from .env.local — cannot run the spike.\n" +
      "Create a service user (Settings > Service users) with ManageOrgSessions + UseDevinSessions,\n" +
      "then add both values to .env.local. Neither is ever printed by this script.",
  );
  process.exit(1);
}

/* --------------------------------- args ----------------------------------- */

const args = process.argv.slice(2);
const argOf = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};
const RUNS = Number(argOf("runs", "5"));
const MODE = argOf("mode", "normal") as "normal" | "fast";
const SYMBOL = argOf("symbol", "NVDA").toUpperCase();
const DO_REUSE = args.includes("--reuse");
const MAX_ACU = Number(process.env.DEVIN_API_MAX_ACU ?? "5");
const DEADLINE_MS = Number(argOf("deadline-min", MODE === "fast" ? "8" : "15")) * 60_000;

/* ------------------------------- API helpers ------------------------------ */

const HEADERS = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

/** Fetch with retry on 429/5xx/network. Request-level only — never re-creates a session. */
async function api<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (attempt >= 4) throw err;
    await sleep(1000 * 2 ** attempt);
    return api<T>(method, path, body, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`${method} ${path} → ${res.status} after ${attempt + 1} attempts`);
    await sleep(1000 * 2 ** attempt);
    return api<T>(method, path, body, attempt + 1);
  }
  if (!res.ok) {
    // ProblemDetail body; safe to print — carries no credentials.
    const detail = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SessionState {
  session_id: string;
  url: string;
  status: string;
  status_detail?: string | null;
  structured_output?: unknown;
  acus_consumed?: number;
}

/* ------------------------------ the real task ----------------------------- */

async function buildPrompt(): Promise<string> {
  const q = await getQuote(SYMBOL);
  return [
    `Produce an investment verdict for ${q.symbol} (${q.name}) using ONLY the data below.`,
    "Do not browse the web, do not ask questions, do not use any tools other than",
    "provide_structured_output. If a judgment needs data you do not have, note it in `caveats`.",
    "Style: institutional buy-side memo — direct, specific, numbers-first.",
    "",
    `Price: ${formatCurrency(q.price, q.currency)} (${formatPercent(q.changePercent)} today)`,
    `Previous close: ${formatCurrency(q.previousClose, q.currency)}`,
    `Market cap: ${formatMarketCap(q.marketCap)}`,
    `P/E: ${q.peRatio ?? "n/a"}`,
    `52-week range: ${formatCurrency(q.fiftyTwoWeekLow, q.currency)} – ${formatCurrency(q.fiftyTwoWeekHigh, q.currency)}`,
    `Day range: ${formatCurrency(q.dayLow, q.currency)} – ${formatCurrency(q.dayHigh, q.currency)}`,
    `Volume: ${q.volume ?? "n/a"}  |  Exchange: ${q.exchange ?? "n/a"}`,
    "",
    "Call provide_structured_output exactly once with is_final=true, conforming to the schema.",
  ].join("\n");
}

/* --------------------------------- one run -------------------------------- */

interface RunResult {
  run: number;
  sessionId: string;
  createMs: number;
  totalMs: number;
  polls: number;
  acus: number | null;
  firstAttemptValid: boolean;
  zodIssues: string[];
  verdict: string;
  outcome: "ok" | "invalid_output" | "timeout" | "session_error";
}

async function oneRun(run: number, prompt: string, schema: Record<string, unknown>): Promise<RunResult> {
  const t0 = Date.now();
  const created = await api<SessionState>("POST", `/organizations/${ORG_ID}/sessions`, {
    prompt,
    structured_output_schema: schema,
    structured_output_required: true,
    devin_mode: MODE,
    max_acu_limit: MAX_ACU,
    resumable: true, // run N's session doubles as the --reuse target
    tags: ["uaa", "uaa-spike", `uaa-spike-v${VERDICT_SCHEMA_VERSION}`],
    title: `UAA spike: ${SYMBOL} verdict (run ${run})`,
  });
  const createMs = Date.now() - t0;
  process.stdout.write(`  run ${run}: session ${created.session_id} created in ${(createMs / 1000).toFixed(1)}s `);

  let polls = 0;
  let delay = 3000;
  for (;;) {
    if (Date.now() - t0 > DEADLINE_MS) {
      await api("DELETE", `/organizations/${ORG_ID}/sessions/${created.session_id}`).catch(() => {});
      console.log("— DEADLINE, session terminated");
      return {
        run, sessionId: created.session_id, createMs, totalMs: Date.now() - t0, polls,
        acus: null, firstAttemptValid: false, zodIssues: ["deadline"], verdict: "-", outcome: "timeout",
      };
    }
    await sleep(delay);
    delay = Math.min(15_000, Math.round(delay * 1.5 * (0.8 + Math.random() * 0.4)));
    polls += 1;
    const s = await api<SessionState>("GET", `/organizations/${ORG_ID}/sessions/${created.session_id}`);
    process.stdout.write(".");

    if (s.status === "error") {
      console.log(` — status=error (${s.status_detail ?? "?"})`);
      return {
        run, sessionId: s.session_id, createMs, totalMs: Date.now() - t0, polls,
        acus: s.acus_consumed ?? null, firstAttemptValid: false,
        zodIssues: [`session error: ${s.status_detail ?? "?"}`], verdict: "-", outcome: "session_error",
      };
    }

    const finished =
      s.status_detail === "finished" || s.status === "exit" || s.status === "suspended";
    if (finished || s.structured_output != null) {
      if (s.structured_output == null) {
        if (finished) {
          console.log(` — finished with NO structured_output`);
          return {
            run, sessionId: s.session_id, createMs, totalMs: Date.now() - t0, polls,
            acus: s.acus_consumed ?? null, firstAttemptValid: false,
            zodIssues: ["finished without structured_output"], verdict: "-", outcome: "invalid_output",
          };
        }
        continue;
      }
      const totalMs = Date.now() - t0;
      const parsed = VerdictSchema.safeParse(s.structured_output);
      const verdict = parsed.success
        ? `${parsed.data.verdict} (conf ${parsed.data.confidence})`
        : "-";
      console.log(
        ` — ${(totalMs / 1000).toFixed(1)}s, ${s.acus_consumed ?? "?"} ACU, zod ${parsed.success ? "VALID" : "INVALID"}`,
      );
      return {
        run, sessionId: s.session_id, createMs, totalMs, polls,
        acus: s.acus_consumed ?? null, firstAttemptValid: parsed.success,
        zodIssues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        verdict, outcome: parsed.success ? "ok" : "invalid_output",
      };
    }
  }
}

/* ------------------------- reuse (wake-from-suspend) ----------------------- */

async function reuseProbe(sessionId: string, schema: Record<string, unknown>): Promise<void> {
  console.log("\n== Reuse probe: message → wake → second structured output ==");
  // Let the session suspend first (sleep threshold is usage-based; give it a nudge of idle time).
  console.log("  waiting 90s for the session to go idle…");
  await sleep(90_000);
  const before = await api<SessionState>("GET", `/organizations/${ORG_ID}/sessions/${sessionId}`);
  console.log(`  pre-message status: ${before.status} (${before.status_detail ?? "-"})`);

  const t0 = Date.now();
  await api("POST", `/organizations/${ORG_ID}/sessions/${sessionId}/messages`, {
    message:
      "Follow-up: rerun the same verdict but assume the price just fell 10% with no other change. " +
      "Call provide_structured_output again with is_final=true, conforming to the same schema.",
  });
  let delay = 2000;
  const firstOutput = JSON.stringify(before.structured_output ?? null);
  for (;;) {
    if (Date.now() - t0 > 10 * 60_000) {
      console.log("  reuse probe DEADLINE (10 min) — pattern 5 not viable at this latency");
      return;
    }
    await sleep(delay);
    delay = Math.min(10_000, delay * 1.5);
    const s = await api<SessionState>("GET", `/organizations/${ORG_ID}/sessions/${sessionId}`);
    if (s.structured_output != null && JSON.stringify(s.structured_output) !== firstOutput) {
      const parsed = VerdictSchema.safeParse(s.structured_output);
      console.log(
        `  second output in ${((Date.now() - t0) / 1000).toFixed(1)}s from message send ` +
          `(zod ${parsed.success ? "VALID" : "INVALID"}) — structured_output DOES update on follow-up`,
      );
      return;
    }
  }
}

/* --------------------------------- main ----------------------------------- */

async function main(): Promise<void> {
  console.log(`== Devin sessions-API spike ==`);
  console.log(`   task: ${SYMBOL} investment verdict | mode: ${MODE} | runs: ${RUNS} | max ACU/run: ${MAX_ACU}\n`);

  const schema = verdictJsonSchema();
  console.log(`   schema: ${JSON.stringify(schema).length} bytes of Draft-7 JSON Schema (limit 64KB)\n`);
  const prompt = await buildPrompt();
  console.log(`   prompt (${prompt.length} chars) built from live Yahoo data — identical across runs\n`);

  const results: RunResult[] = [];
  for (let i = 1; i <= RUNS; i++) {
    results.push(await oneRun(i, prompt, schema));
  }

  const ok = results.filter((r) => r.outcome === "ok");
  const times = ok.map((r) => r.totalMs / 1000).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)] ?? NaN;

  console.log("\n== Results ==");
  console.log("run  session                superseded-by-outcome   total     polls  ACU    zod-first-try  verdict");
  for (const r of results) {
    console.log(
      `${String(r.run).padEnd(4)} ${r.sessionId.padEnd(22)} ${r.outcome.padEnd(23)} ${(r.totalMs / 1000).toFixed(1).padStart(6)}s  ${String(r.polls).padEnd(6)} ${String(r.acus ?? "?").padEnd(6)} ${String(r.firstAttemptValid).padEnd(14)} ${r.verdict}`,
    );
    for (const issue of r.zodIssues) console.log(`       └ ${issue}`);
  }
  if (times.length > 0) {
    console.log(
      `\nlatency  min ${times[0].toFixed(1)}s | p50 ${p50.toFixed(1)}s | max ${times[times.length - 1].toFixed(1)}s   ` +
        `| valid-first-try ${ok.filter((r) => r.firstAttemptValid).length}/${results.length}   ` +
        `| total ACU ${results.reduce((a, r) => a + (r.acus ?? 0), 0).toFixed(2)}`,
    );
  }

  if (DO_REUSE && results.length > 0 && results[results.length - 1].outcome === "ok") {
    await reuseProbe(results[results.length - 1].sessionId, schema);
  }

  // Leave no running sessions behind: everything reached a terminal/suspended
  // state above or was terminated at deadline. Spike sessions stay listed under
  // the "uaa-spike" tag for ACU audit in the web app.
}

main().catch((err) => {
  console.error(`spike failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
