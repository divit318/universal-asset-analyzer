/**
 * bench-e2e.ts — TEMPORARY end-to-end benchmark harness (measurement only).
 *
 * Times one full run of a feature pipeline, from handler invocation with user
 * input to the complete result payload being returned. No product code is
 * modified; this file is standalone and safe to delete after the benchmark.
 *
 * Instrumentation:
 *   - performance.now() timestamps around the handler call (start/end).
 *   - A global fetch wrapper (installed BEFORE any lib import) records every
 *     HTTP call: host category (ollama-chat / ollama-mgmt / yahoo / edgar /
 *     news / screener-in / other), start, headers-arrival, body-consumed end,
 *     and — for Ollama /api/chat — the model name, generation options and the
 *     eval/prompt_eval/load/total durations Ollama reports.
 *   - Pipeline progress events (the same ones the UI consumes) are timestamped
 *     on arrival to delimit named stages.
 *   - The Quant Engine is a Python subprocess (exactly how POST /api/engine
 *     spawns it); its timestamped stdout lines delimit stages.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/bench-e2e.ts \
 *     --feature <wire|thematic|ic|engine> --run <n> [--out bench-out] [--timeout-min 90]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import * as os from "node:os";

/* ── Inputs (fixed, identical across runs) ─────────────────────────────── */

const INPUTS = {
  wire: { india: false, global: true } as { query?: string; india: boolean; global: boolean },
  thematic: { theme: "artificial intelligence" },
  ic: { symbol: "RELIANCE.NS" },
  engine: { universe: "nifty50" },
};

/* ── Recorders ─────────────────────────────────────────────────────────── */

interface FetchRec {
  seq: number;
  url: string;
  host: string;
  category: string;
  method: string;
  tStart: number;
  tHeaders: number | null;
  tEnd: number | null;
  endBasis: "body" | "headers" | "error" | null;
  status: number | null;
  error?: string;
  model?: string;
  stream?: boolean;
  options?: Record<string, unknown>;
  ollama?: {
    evalCount?: number;
    promptEvalCount?: number;
    totalDurationMs?: number;
    loadDurationMs?: number;
    promptEvalDurationMs?: number;
    evalDurationMs?: number;
    doneReason?: string;
  };
}

interface Ev {
  t: number;
  kind: string; // "scanner" | "thematic" | "ic" | "engine-log" | "bench"
  stage?: string;
  message?: string;
  extra?: unknown;
}

const fetches: FetchRec[] = [];
const events: Ev[] = [];
let seq = 0;

function ev(kind: string, stage?: string, message?: string, extra?: unknown): void {
  events.push({ t: performance.now(), kind, stage, message, extra });
}

/* ── Global fetch wrapper ──────────────────────────────────────────────── */

const realFetch = globalThis.fetch.bind(globalThis);

function categorize(u: URL): string {
  const h = u.hostname;
  if ((h === "localhost" || h === "127.0.0.1") && u.port === "11434") {
    return u.pathname === "/api/chat" ? "ollama-chat" : "ollama-mgmt";
  }
  if (h.endsWith("yahoo.com")) return "yahoo";
  if (h.endsWith("sec.gov")) return "edgar";
  if (h.endsWith("screener.in")) return "screener-in";
  if (
    h.includes("news.google") || h.includes("economictimes") || h.includes("newsapi") ||
    h.includes("moneycontrol") || h.includes("feeds") || h.includes("rss")
  ) return "news";
  if (h === "localhost" || h === "127.0.0.1") return "local-other";
  return "other";
}

function parseOllamaStats(rec: FetchRec, text: string): void {
  try {
    const lines = text.trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    const ns = (v: unknown): number | undefined =>
      typeof v === "number" ? Math.round(v / 1e6) : undefined;
    rec.ollama = {
      evalCount: last.eval_count as number | undefined,
      promptEvalCount: last.prompt_eval_count as number | undefined,
      totalDurationMs: ns(last.total_duration),
      loadDurationMs: ns(last.load_duration),
      promptEvalDurationMs: ns(last.prompt_eval_duration),
      evalDurationMs: ns(last.eval_duration),
      doneReason: last.done_reason as string | undefined,
    };
  } catch { /* stats are best-effort */ }
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  let u: URL;
  try { u = new URL(urlStr); } catch { return realFetch(input as RequestInfo, init); }

  const rec: FetchRec = {
    seq: seq++,
    url: urlStr,
    host: u.hostname,
    category: categorize(u),
    method: init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET"),
    tStart: performance.now(),
    tHeaders: null,
    tEnd: null,
    endBasis: null,
    status: null,
  };
  fetches.push(rec);

  if (rec.category === "ollama-chat" && typeof init?.body === "string") {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      rec.model = body.model as string | undefined;
      rec.stream = body.stream as boolean | undefined;
      rec.options = body.options as Record<string, unknown> | undefined;
    } catch { /* non-JSON body */ }
  }

  let res: Response;
  try {
    res = await realFetch(input as RequestInfo, init);
  } catch (err) {
    rec.tEnd = performance.now();
    rec.endBasis = "error";
    rec.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw err;
  }
  rec.tHeaders = performance.now();
  rec.status = res.status;

  // Only Ollama chat responses get a body-monitoring wrapper (their duration is
  // dominated by generation streamed in the body). Other hosts keep the native
  // Response untouched (yahoo-finance2 relies on res.url/redirect semantics);
  // their end time is headers-arrival, which for JSON APIs is within ms of full body.
  if (rec.category !== "ollama-chat" || !res.body) {
    rec.tEnd = rec.tHeaders;
    rec.endBasis = "headers";
    return res;
  }

  let text = "";
  const decoder = new TextDecoder();
  const monitored = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        if (text.length < 8_000_000) text += decoder.decode(chunk, { stream: true });
        ctrl.enqueue(chunk);
      },
      flush() {
        rec.tEnd = performance.now();
        rec.endBasis = "body";
        parseOllamaStats(rec, text);
      },
    }),
  );
  return new Response(monitored, { status: res.status, statusText: res.statusText, headers: res.headers });
}) as typeof fetch;

/* ── Ollama residency snapshot (uses realFetch — not recorded) ─────────── */

async function ollamaPs(): Promise<unknown> {
  try {
    const r = await realFetch("http://localhost:11434/api/ps");
    return await r.json();
  } catch { return null; }
}

/* ── Feature runners ───────────────────────────────────────────────────── */

async function runWire(): Promise<unknown> {
  const { startScanJob, scanJobResult } = await import("../lib/scanner/job");
  ev("bench", "handler-invoke", "startScanJob");
  const job = startScanJob(INPUTS.wire, { detached: true });
  job.subscribe((e) => {
    const o = e as { type?: string; stage?: string; message?: string; pct?: number; key?: string; reason?: string; stalledMs?: number };
    ev("scanner", o.stage ?? o.type, o.message ?? o.reason ?? o.key, {
      type: o.type, pct: o.pct, stalledMs: o.stalledMs,
    });
  });
  const result = await scanJobResult(job);
  ev("bench", "result", "scan result received");
  const r = result as {
    opportunities?: unknown[]; emergingThemes?: unknown[]; causalChains?: unknown[];
    riskAlerts?: unknown[]; events?: unknown[]; stageFailures?: { stage: string; reason: string }[];
  };
  return {
    opportunities: r.opportunities?.length ?? 0,
    emergingThemes: r.emergingThemes?.length ?? 0,
    causalChains: r.causalChains?.length ?? 0,
    riskAlerts: r.riskAlerts?.length ?? 0,
    events: r.events?.length ?? 0,
    stageFailures: r.stageFailures ?? [],
  };
}

async function runThematic(): Promise<unknown> {
  const { runThematicEngine } = await import("../lib/thematic-engine");
  ev("bench", "handler-invoke", "runThematicEngine");
  const report = await runThematicEngine({ theme: INPUTS.thematic.theme }, (e) =>
    ev("thematic", e.stage, e.message),
  );
  ev("bench", "result", "thematic report received");
  const r = report as unknown as { companies?: unknown[]; stages?: unknown; generatedAt?: string };
  return { companies: (r.companies as unknown[] | undefined)?.length ?? null, generatedAt: r.generatedAt ?? null };
}

/** Mirrors executeRun in app/api/ic-report/route.ts (pre-flight included),
 *  minus the in-memory run-store bookkeeping that carries no work. */
async function runIC(): Promise<unknown> {
  const symbol = INPUTS.ic.symbol;
  const isIndian = symbol.endsWith(".NS") || symbol.endsWith(".BO");

  const { getQuote } = await import("../lib/yahoo");
  const { getFundamentals } = await import("../lib/fundamentals");
  const { getFinancialStatements, getFinancialStatementsYahoo } = await import("../lib/statements");
  const { getScreenerInCompany } = await import("../lib/screener-in");
  const { generateICReport } = await import("../lib/ic-report");
  const { appendValuationEvent, getValuationCase } = await import("../lib/db");
  const { computeCaseResult, seedAssumptions } = await import("../lib/valuation/case");
  const { canValue, fetchValuationFacts } = await import("../lib/valuation/prefill");
  const { getEnginePriorEnsured } = await import("../lib/valuation/engine-prior");
  const { pickModel } = await import("../lib/ai/router");

  ev("bench", "handler-invoke", "ic preflight");
  const [quoteCheck, modelCheck] = await Promise.allSettled([getQuote(symbol), pickModel("ic-agent-analysis")]);
  if (quoteCheck.status === "rejected") throw new Error(`preflight: ticker did not resolve`);
  if (modelCheck.status === "rejected" || modelCheck.value == null) throw new Error("preflight: no model available");

  ev("bench", "data-load", `Loading data for ${symbol}`);
  const [quoteResult, fundamentalsResult, statementsResult, screenerInResult, factsResult] =
    await Promise.allSettled([
      getQuote(symbol),
      getFundamentals(symbol),
      getFinancialStatements(symbol),
      isIndian ? getScreenerInCompany(symbol) : Promise.resolve(null),
      fetchValuationFacts(symbol),
    ]);

  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const fundamentals = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : null;
  let statements = statementsResult.status === "fulfilled" ? statementsResult.value : null;
  let statementsProvider: "sec-edgar" | "yahoo-timeseries" = "sec-edgar";
  if (!statements) {
    statements = await getFinancialStatementsYahoo(symbol).catch(() => null);
    statementsProvider = "yahoo-timeseries";
  }
  const screenerIn = screenerInResult.status === "fulfilled" ? screenerInResult.value : null;
  const vFacts = factsResult.status === "fulfilled" ? factsResult.value : null;
  if (!quote && !fundamentals) throw new Error(`Could not load any data for ${symbol}`);

  const financialCurrency = fundamentals?.snapshot?.financialCurrency ?? null;
  const tradingCurrency = quote?.currency ?? null;
  let fxToTrading: number | null = null;
  if (financialCurrency && tradingCurrency && financialCurrency !== tradingCurrency) {
    fxToTrading = await getQuote(`${financialCurrency}${tradingCurrency}=X`)
      .then((fxq) => (fxq.price > 0 ? fxq.price : null))
      .catch(() => null);
  }

  let valuationCase = getValuationCase(symbol);
  const seedSafe = !(financialCurrency && tradingCurrency && financialCurrency !== tradingCurrency);
  if (!valuationCase && vFacts && canValue(vFacts) && seedSafe) {
    try {
      const clampedGrowth = vFacts.deliveredGrowth.value != null
        ? Math.max(-0.10, Math.min(0.25, vFacts.deliveredGrowth.value))
        : null;
      const assumptions = seedAssumptions({
        baseFcf: vFacts.baseFcf!,
        sharesOutstanding: vFacts.sharesOutstanding!,
        netDebt: vFacts.netDebt ?? 0,
        price: vFacts.price,
        discountRate: vFacts.wacc.waccPercent,
        terminalGrowth: vFacts.terminalGrowth,
        deliveredGrowth: clampedGrowth,
        deliveredGrowthLabel: clampedGrowth !== vFacts.deliveredGrowth.value
          ? `${vFacts.deliveredGrowth.label ?? "delivered growth"} (clamped to 25% for the seed)`
          : vFacts.deliveredGrowth.label,
      });
      valuationCase = appendValuationEvent({
        symbol,
        currency: vFacts.currency,
        author: "reverse",
        kind: "seeded",
        assumptions,
        result: computeCaseResult(assumptions, vFacts.price),
        priceAt: vFacts.price,
        triggerSource: "ic_report",
      });
    } catch { /* non-fatal, same as the route */ }
  }

  const wacc = vFacts
    ? {
        value: vFacts.wacc.wacc,
        components: `CAPM: risk-free ${(vFacts.wacc.riskFree * 100).toFixed(1)}% + beta ${vFacts.wacc.beta?.toFixed(2) ?? "1.00"} × ERP ${(vFacts.wacc.erp * 100).toFixed(1)}%, debt weight ${(vFacts.wacc.debtWeight * 100).toFixed(0)}% (${vFacts.wacc.region})`,
      }
    : { value: 0.10, components: "platform default 10.0% (WACC inputs unavailable for this name)" };

  ev("bench", "report-generate", "generateICReport");
  const report = await generateICReport(
    {
      symbol,
      canonical: {
        symbol,
        quote,
        snapshot: fundamentals?.snapshot ?? null,
        analyst: fundamentals?.analyst ?? null,
        insider: fundamentals?.insider ?? null,
        statements,
        statementsProvider,
        screenerIn,
        fxToTrading,
      },
      wacc,
      valuationCase,
      enginePriorP50: (await getEnginePriorEnsured(symbol).catch(() => null))?.p50 ?? null,
    },
    (e) => ev("ic", e.stage, e.message),
  );
  ev("bench", "result", "IC report received");
  const r = report as unknown as { agentFindings?: unknown[]; market?: string };
  return { agents: r.agentFindings?.length ?? 0, market: r.market ?? null };
}

async function runEngine(): Promise<unknown> {
  const { enginePython } = await import("../lib/engine-python");
  ev("bench", "handler-invoke", "spawn engine.daily_run");
  return new Promise((resolve, reject) => {
    const py = spawn(enginePython(), ["-m", "engine.daily_run", "--universe", INPUTS.engine.universe], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stderr = "";
    let lines = 0;
    py.stdout.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n").filter(Boolean)) {
        lines++;
        ev("engine-log", undefined, line);
      }
    });
    py.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    py.on("close", (code) => {
      ev("bench", "result", `engine exited ${code}`);
      if (code !== 0) reject(new Error(`engine exit ${code}: ${stderr.trim().slice(0, 500)}`));
      else resolve({ exitCode: code, logLines: lines, stderrBytes: stderr.length });
    });
    py.on("error", reject);
  });
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (f: string): string | null => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  const feature = get("--feature") as keyof typeof INPUTS | null;
  const runN = Number(get("--run") ?? "0");
  const outRoot = get("--out") ?? "bench-out";
  const timeoutMin = Number(get("--timeout-min") ?? "90");
  if (!feature || !(feature in INPUTS) || !runN) {
    console.error("usage: --feature <wire|thematic|ic|engine> --run <n> [--out dir] [--timeout-min 90]");
    process.exit(2);
  }

  const outDir = path.join(outRoot, feature);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `run${runN}.json`);

  const meta = {
    feature,
    run: runN,
    input: INPUTS[feature],
    startedAt: new Date().toISOString(),
    node: process.version,
    machine: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9) },
    ollamaResidentBefore: await ollamaPs(),
  };

  const runners = { wire: runWire, thematic: runThematic, ic: runIC, engine: runEngine };

  let failed: string | null = null;
  let resultSummary: unknown = null;
  const t0 = performance.now();

  const guard = setTimeout(() => {
    const doc = { ...meta, failed: `bench timeout after ${timeoutMin} min`, totalMs: performance.now() - t0, events, fetches };
    fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));
    console.error(`TIMEOUT after ${timeoutMin} min — partial record written to ${outFile}`);
    process.exit(3);
  }, timeoutMin * 60_000);
  guard.unref();

  try {
    resultSummary = await runners[feature]();
  } catch (err) {
    failed = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  const totalMs = performance.now() - t0;
  clearTimeout(guard);

  const doc = {
    ...meta,
    finishedAt: new Date().toISOString(),
    totalMs,
    failed,
    resultSummary,
    ollamaResidentAfter: await ollamaPs(),
    events,
    fetches,
  };
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.log(`${feature} run ${runN}: ${failed ? `FAILED (${failed})` : "ok"} totalMs=${Math.round(totalMs)} → ${outFile}`);
  process.exit(failed ? 1 : 0);
}

void main();
