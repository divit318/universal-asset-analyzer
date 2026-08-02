/**
 * bench-report.ts — TEMPORARY aggregator for bench-e2e.ts output (safe to delete).
 *
 * Reads bench-out/<feature>/run*.json, computes per-run stage attribution and
 * warm-run statistics, and prints a Markdown report to stdout.
 *
 * Stage attribution per run (priority order, non-overlapping):
 *   1. ollama    — wall-clock union of /api/chat call intervals (start → body fully consumed)
 *   2. dataFetch — wall-clock union of all other network calls (yahoo/edgar/news/screener/ollama-mgmt)
 *   3. assembly  — the pipeline's own final-assembly window (feature-specific, see below)
 *   4. compute   — everything else (total − 1 − 2 − 3)
 *
 * Usage: node --import tsx scripts/bench-report.ts [--out bench-out]
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface FetchRec {
  category: string; tStart: number; tHeaders: number | null; tEnd: number | null;
  status: number | null; error?: string; model?: string; options?: Record<string, unknown>;
  ollama?: Record<string, number | string | undefined>;
}
interface Ev { t: number; kind: string; stage?: string; message?: string; extra?: { type?: string } }
interface RunDoc {
  feature: string; run: number; input: unknown; startedAt: string; finishedAt?: string;
  totalMs: number; failed: string | null; resultSummary: unknown;
  machine: { cpu?: string; cores?: number; memGB?: number };
  events: Ev[]; fetches: FetchRec[];
}

type Interval = [number, number];

function union(intervals: Interval[]): Interval[] {
  const s = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}
function total(intervals: Interval[]): number {
  return intervals.reduce((a, [x, y]) => a + (y - x), 0);
}
/** a minus b */
function subtract(a: Interval[], b: Interval[]): Interval[] {
  let cur = a;
  for (const [bs, be] of b) {
    const next: Interval[] = [];
    for (const [as_, ae] of cur) {
      if (be <= as_ || bs >= ae) { next.push([as_, ae]); continue; }
      if (bs > as_) next.push([as_, bs]);
      if (be < ae) next.push([be, ae]);
    }
    cur = next;
  }
  return cur;
}

/** Feature-specific assembly window [start, end] within the run, or null. */
function assemblyWindow(doc: RunDoc): Interval | null {
  const t0 = doc.events.find((e) => e.kind === "bench" && e.stage === "handler-invoke")?.t ?? 0;
  const tEnd = doc.events.find((e) => e.kind === "bench" && e.stage === "result")?.t ?? t0 + doc.totalMs;
  switch (doc.feature) {
    case "wire": {
      const a = doc.events.find((e) => e.kind === "scanner" && e.stage === "assembling");
      return a ? [a.t, tEnd] : null;
    }
    case "thematic": {
      // opportunity_score is scoring; assembly = after the last non-terminal stage event
      const evs = doc.events.filter((e) => e.kind === "thematic" && e.stage !== "done" && e.stage !== "error");
      const last = evs[evs.length - 1];
      return last ? [last.t, tEnd] : null;
    }
    case "ic": {
      const done = doc.events.find((e) => e.kind === "ic" && e.stage === "done");
      const thesisEnd = [...doc.events].reverse().find((e) => e.kind === "ic" && e.stage === "thesis");
      return thesisEnd && done ? [thesisEnd.t, tEnd] : null;
    }
    case "engine": {
      const exp = doc.events.find((e) => e.kind === "engine-log" && /Exporting read snapshots/.test(e.message ?? ""));
      return exp ? [exp.t, tEnd] : null;
    }
  }
  return null;
}

interface Breakdown { totalMs: number; ollamaMs: number; fetchMs: number; assemblyMs: number; computeMs: number }

/** The engine's network I/O happens inside the Python subprocess, invisible to
 *  the fetch wrapper — derive its fetch window from the timestamped log lines. */
function engineFetchIntervals(doc: RunDoc): Interval[] {
  const logs = doc.events.filter((e) => e.kind === "engine-log");
  const at = (re: RegExp): number | null => logs.find((e) => re.test(e.message ?? ""))?.t ?? null;
  const ivs: Interval[] = [];
  const fetchStart = at(/Fetching OHLCV/);
  const fetchEnd = at(/Processing \d+ symbols/);
  if (fetchStart != null && fetchEnd != null) ivs.push([fetchStart, fetchEnd]);
  const macroStart = at(/Fetching macro features/);
  const macroEnd = at(/Training index-level HMM/);
  if (macroStart != null && macroEnd != null) ivs.push([macroStart, macroEnd]);
  return union(ivs);
}

function breakdown(doc: RunDoc): Breakdown {
  const t0 = doc.events.find((e) => e.kind === "bench" && e.stage === "handler-invoke")?.t ?? 0;
  const t1 = t0 + doc.totalMs;
  const clip = ([a, b]: Interval): Interval => [Math.max(a, t0), Math.min(b, t1)];
  const end = (f: FetchRec): number => f.tEnd ?? f.tHeaders ?? f.tStart;

  const ollamaIv = union(doc.fetches.filter((f) => f.category === "ollama-chat").map((f) => clip([f.tStart, end(f)])));
  const fetchIvRaw = doc.feature === "engine"
    ? engineFetchIntervals(doc)
    : union(doc.fetches.filter((f) => f.category !== "ollama-chat").map((f) => clip([f.tStart, end(f)])));
  const fetchIv = subtract(fetchIvRaw, ollamaIv);
  const aw = assemblyWindow(doc);
  const assemblyIv = aw ? subtract(subtract([clip(aw)], ollamaIv), fetchIv) : [];
  const ollamaMs = total(ollamaIv);
  const fetchMs = total(fetchIv);
  const assemblyMs = total(assemblyIv);
  return {
    totalMs: doc.totalMs,
    ollamaMs,
    fetchMs,
    assemblyMs,
    computeMs: Math.max(0, doc.totalMs - ollamaMs - fetchMs - assemblyMs),
  };
}

function stats(xs: number[]): { min: number; median: number; mean: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { min: s[0], median, mean: xs.reduce((a, b) => a + b, 0) / xs.length, max: s[s.length - 1] };
}
const sec = (ms: number): string => (ms / 1000).toFixed(1);

function failures(doc: RunDoc): string[] {
  const out: string[] = [];
  if (doc.failed) out.push(`run failed: ${doc.failed}`);
  for (const e of doc.events) {
    if (e.extra?.type === "stage_failed") out.push(`stage_failed ${e.stage}: ${e.message}`);
    if (e.stage === "error") out.push(`error event: ${e.message}`);
    if (e.kind === "engine-log" && /error/i.test(e.message ?? "")) out.push(`engine log: ${e.message}`);
  }
  for (const f of doc.fetches) {
    if (f.error) out.push(`fetch error ${f.category}: ${f.error}`);
    else if (f.status != null && f.status >= 400) out.push(`fetch HTTP ${f.status} ${f.category}`);
  }
  return out;
}

function modelSummary(docs: RunDoc[]): string {
  const models = new Map<string, { calls: number; opts: Set<string> }>();
  for (const d of docs) {
    for (const f of d.fetches) {
      if (f.category !== "ollama-chat") continue;
      const m = f.model ?? "unknown";
      const rec = models.get(m) ?? { calls: 0, opts: new Set<string>() };
      rec.calls++;
      if (f.options) rec.opts.add(JSON.stringify(f.options));
      models.set(m, rec);
    }
  }
  return [...models.entries()]
    .map(([m, r]) => `${m} (${r.calls} calls across runs; options: ${[...r.opts].join(" | ") || "default"})`)
    .join("; ") || "none (no Ollama calls)";
}

function main(): void {
  const outRoot = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "bench-out";
  const features = ["engine", "ic", "wire", "thematic"].filter((f) =>
    fs.existsSync(path.join(outRoot, f)),
  );

  for (const feature of features) {
    const dir = path.join(outRoot, feature);
    const docs: RunDoc[] = fs.readdirSync(dir)
      .filter((f) => /^run\d+\.json$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RunDoc);
    if (!docs.length) continue;

    const cold = docs[0];
    const warm = docs.slice(1).filter((d) => !d.failed);
    const bds = new Map(docs.map((d) => [d.run, breakdown(d)]));

    console.log(`\n## ${feature}`);
    console.log(`input: ${JSON.stringify(cold.input)}`);
    console.log(`models: ${modelSummary(docs)}`);
    console.log(`cold (run 1): ${sec(cold.totalMs)}s${cold.failed ? ` FAILED: ${cold.failed}` : ""}`);
    if (warm.length) {
      const t = stats(warm.map((d) => d.totalMs));
      console.log(`warm (${warm.length} runs): min ${sec(t.min)} / median ${sec(t.median)} / mean ${sec(t.mean)} / max ${sec(t.max)} s`);
      const med = (k: keyof Breakdown) => sec(stats(warm.map((d) => bds.get(d.run)![k])).median);
      console.log(`warm per-stage medians: dataFetch ${med("fetchMs")}s, compute ${med("computeMs")}s, ollama ${med("ollamaMs")}s, assembly ${med("assemblyMs")}s`);
    }
    console.log(`per-run: ${docs.map((d) => {
      const b = bds.get(d.run)!;
      return `run${d.run}${d.run === 1 ? "(cold)" : ""}=${sec(d.totalMs)}s [F ${sec(b.fetchMs)} / C ${sec(b.computeMs)} / O ${sec(b.ollamaMs)} / A ${sec(b.assemblyMs)}]${d.failed ? " FAILED" : ""}`;
    }).join(", ")}`);
    for (const d of docs) {
      const fs_ = failures(d);
      if (fs_.length) console.log(`run${d.run} incidents: ${fs_.join(" ;; ")}`);
    }
  }
}

main();
