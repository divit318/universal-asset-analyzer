/**
 * IC Report headless harness.
 *
 * Runs the IC pipeline stage by stage for a list of tickers without the UI,
 * capturing per-stage output, wall-clock timings, prompt sizes and console
 * errors to <out>/<ticker>/.
 *
 * Usage:
 *   npx tsx scripts/ic-report-harness.ts                       # default adversarial set, no LLM
 *   npx tsx scripts/ic-report-harness.ts --tickers NVDA,TCS.NS # specific tickers
 *   npx tsx scripts/ic-report-harness.ts --llm                 # include LLM stages (slow: minutes/ticker)
 *   npx tsx scripts/ic-report-harness.ts --out /tmp/ic-after   # output directory (default /tmp/ic-baseline)
 *
 * Deterministic stages (ingest, signals, questions, run hot/cold, case maths)
 * always run. LLM stages (agents, thesis, valuation narration) only with --llm,
 * because a full run costs minutes per ticker on a local model.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getQuote, getHistory } from "../lib/yahoo";
import { getFundamentals } from "../lib/fundamentals";
import { getFinancialStatements, getFinancialStatementsYahoo } from "../lib/statements";
import { getScreenerInCompany } from "../lib/screener-in";
import { detectAllSignals } from "../lib/ic-signals";
import { generateQuestions, groupByAgent } from "../lib/ic-questions";
import { computeHistoryStats } from "../lib/ic/history-stats";
import { resolveMarket } from "../lib/ic/canonical";
import { fetchValuationFacts, canValue, type ValuationFacts } from "../lib/valuation/prefill";
import { seedAssumptions, computeCaseResult } from "../lib/valuation/case";
import { generateICReport } from "../lib/ic-report";

/* ── Adversarial baseline ticker set (Phase 4) ─────────────────────────── */

export const BASELINE_TICKERS: { symbol: string; why: string }[] = [
  { symbol: "NVDA", why: "large-cap profitable US tech" },
  { symbol: "AAPL", why: "non-December fiscal year end (Sep)" },
  { symbol: "RIVN", why: "loss-making, negative earnings and FCF" },
  { symbol: "MCD", why: "negative book equity" },
  { symbol: "CCL", why: "heavily indebted, net debt dominates bridge" },
  { symbol: "JPM", why: "financial institution — EBITDA/EV inappropriate" },
  { symbol: "O", why: "REIT — standard metrics mislead" },
  { symbol: "RDDT", why: "recent IPO, <3y history" },
  { symbol: "ABNB", why: "<15y history, breaks long-window percentiles" },
  { symbol: "TSM", why: "ADR" },
  { symbol: "SNDL", why: "very low-priced stock (formatting extreme)" },
  { symbol: "BRK-A", why: "very high-priced stock (formatting extreme)" },
  { symbol: "PSNY", why: "no/thin analyst coverage, distressed" },
  { symbol: "RELIANCE.NS", why: "Indian large cap, NSE, conglomerate" },
  { symbol: "TCS.NS", why: "Indian large cap IT exporter, NSE" },
  { symbol: "TATAELXSI.NS", why: "Indian mid cap, NSE" },
  { symbol: "RELIANCE.BO", why: "BSE resolution of the same name" },
  { symbol: "ZZZZZZ", why: "invalid ticker" },
  { symbol: "TWTR", why: "delisted ticker" },
  { symbol: "ABC", why: "ambiguous / recycled symbol" },
];

/* ── Capture helpers ───────────────────────────────────────────────────── */

interface StageRecord {
  stage: string;
  ok: boolean;
  ms: number;
  error?: string;
  meta?: Record<string, unknown>;
}

interface TickerResult {
  symbol: string;
  why?: string;
  startedAt: string;
  stages: StageRecord[];
  consoleErrors: string[];
  totalMs: number;
}

function writeJson(dir: string, name: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, replacer, 2));
}

// Map serialisation for questionsByAgent etc.
function replacer(_k: string, v: unknown): unknown {
  if (v instanceof Map) return Object.fromEntries(v.entries());
  return v;
}

async function timed<T>(
  result: TickerResult,
  dir: string,
  stage: string,
  fn: () => Promise<T>,
  meta?: (v: T) => Record<string, unknown>,
): Promise<T | null> {
  const t0 = performance.now();
  try {
    const v = await fn();
    const ms = Math.round(performance.now() - t0);
    result.stages.push({ stage, ok: true, ms, meta: meta?.(v) });
    writeJson(dir, `stage-${stage}.json`, v);
    return v;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    result.stages.push({ stage, ok: false, ms, error: msg });
    writeJson(dir, `stage-${stage}.json`, { error: msg });
    return null;
  }
}

/* ── Per-ticker pipeline ───────────────────────────────────────────────── */

async function runTicker(symbol: string, why: string | undefined, outRoot: string, llm: boolean): Promise<TickerResult> {
  const dir = path.join(outRoot, symbol.replace(/[^A-Za-z0-9.\-]/g, "_"));
  const result: TickerResult = {
    symbol,
    why,
    startedAt: new Date().toISOString(),
    stages: [],
    consoleErrors: [],
    totalMs: 0,
  };

  const origError = console.error;
  console.error = (...args: unknown[]) => {
    result.consoleErrors.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" "));
    origError(...args);
  };

  const t0 = performance.now();
  try {
    const isIndian = symbol.endsWith(".NS") || symbol.endsWith(".BO");

    const quote = await timed(result, dir, "quote", () => getQuote(symbol), (q) => ({
      price: q.price, currency: q.currency, marketCap: q.marketCap, name: q.name,
    }));
    const fundamentals = await timed(result, dir, "fundamentals", () => getFundamentals(symbol), (f) => ({
      hasSnapshot: !!f.snapshot, fcf: f.snapshot?.freeCashflow ?? null, analysts: f.analyst?.numberOfOpinions ?? null,
    }));
    const statements = await timed(result, dir, "statements-edgar", () => getFinancialStatements(symbol), (s) => ({
      years: s.fiscalYears,
    }));
    const statementsYahoo = statements ? null : await timed(result, dir, "statements-yahoo", () => getFinancialStatementsYahoo(symbol), (s) => ({
      years: s?.fiscalYears ?? [],
    }));
    const screenerIn = isIndian
      ? await timed(result, dir, "screener-in", () => getScreenerInCompany(symbol), (c) => ({ found: !!c }))
      : null;

    const effectiveStatements = statements ?? statementsYahoo ?? null;

    // Stage 1-2: deterministic
    const market = resolveMarket(symbol, quote);
    const signals = await timed(result, dir, "signals", async () =>
      detectAllSignals({
        snapshot: fundamentals?.snapshot,
        statements: effectiveStatements,
        insider: fundamentals?.insider,
        epsSurprises: fundamentals?.analyst?.epsSurprises,
        screenerIn,
        currency: quote?.currency ?? "USD",
        market,
      }),
    (s) => ({ count: s.length, categories: s.map((x) => x.category) }));

    await timed(result, dir, "questions", async () => {
      const qs = generateQuestions(signals ?? [], quote?.name ?? symbol, symbol);
      const byAgent = groupByAgent(qs);
      return { questions: qs, agentDomains: [...byAgent.keys()], perAgentCounts: Object.fromEntries([...byAgent.entries()].map(([k, v]) => [k, v.length])) };
    }, (v) => ({ questions: v.questions.length, agents: v.agentDomains.length }));

    // History statistics on up to 20y of closes
    const history = await timed(result, dir, "history", () => getHistory(symbol, 7300), (h) => ({ points: h.length }));
    await timed(result, dir, "history-stats", async () => computeHistoryStats(history ?? []), (r) => ({
      verdict: r?.verdict ?? null, windows: r?.windows.filter((w) => w.available).length ?? 0,
    }));

    // Valuation case maths (no DB writes — compute in memory)
    const vFacts = await timed(result, dir, "valuation-case", async () => {
      const facts = await fetchValuationFacts(symbol);
      if (!canValue(facts)) return { canValue: false, facts };
      const assumptions = seedAssumptions({
        baseFcf: facts.baseFcf!,
        sharesOutstanding: facts.sharesOutstanding!,
        netDebt: facts.netDebt ?? 0,
        price: facts.price,
        discountRate: facts.wacc.waccPercent,
        terminalGrowth: facts.terminalGrowth,
        deliveredGrowth: facts.deliveredGrowth.value,
        deliveredGrowthLabel: facts.deliveredGrowth.label,
      });
      const caseResult = computeCaseResult(assumptions, facts.price);
      return { canValue: true, facts, assumptions, caseResult };
    }, (v) => ({ canValue: (v as { canValue: boolean }).canValue }));

    // Full pipeline — deterministic always; with model calls when --llm
    if (quote || fundamentals) {
      const facts: ValuationFacts | null = (vFacts as { facts?: ValuationFacts } | null)?.facts ?? null;
      const wacc = facts
        ? { value: facts.wacc.wacc, components: `CAPM (${facts.wacc.region})` }
        : { value: 0.10, components: "default 10%" };
      // ADR-class currency mismatch: fetch the FX rate the same way the route does.
      const financialCurrency = fundamentals?.snapshot?.financialCurrency ?? null;
      let fxToTrading: number | null = null;
      if (financialCurrency && quote?.currency && financialCurrency !== quote.currency) {
        fxToTrading = await getQuote(`${financialCurrency}${quote.currency}=X`)
          .then((fxq) => (fxq.price > 0 ? fxq.price : null))
          .catch(() => null);
      }

      const canonical = {
        symbol,
        quote,
        snapshot: fundamentals?.snapshot ?? null,
        analyst: fundamentals?.analyst ?? null,
        insider: fundamentals?.insider ?? null,
        statements: effectiveStatements,
        statementsProvider: (statements ? "sec-edgar" : "yahoo-timeseries") as "sec-edgar" | "yahoo-timeseries",
        screenerIn,
        fxToTrading,
      };

      await timed(result, dir, "report-deterministic", async () => {
        const events: { stage: string; message: string; at: string }[] = [];
        const report = await generateICReport(
          { symbol, canonical, wacc, skipModelCalls: true },
          (e) => events.push({ stage: e.stage, message: e.message, at: e.at }),
        );
        return { report, events };
      }, (v) => {
        const rep = (v as { report: { valuation: { headline: { perShare: number; vsSpot: number | null } | null; blockingViolations: unknown[]; warnings: unknown[] }; signalChecks: unknown[]; market: string } }).report;
        return {
          market: rep.market,
          headline: rep.valuation.headline,
          blocking: rep.valuation.blockingViolations.length,
          warnings: rep.valuation.warnings.length,
          checks: rep.signalChecks.length,
        };
      });

      if (llm) {
        await timed(result, dir, "full-report-llm", async () => {
          const events: { stage: string; message: string; at: string }[] = [];
          const report = await generateICReport(
            { symbol, canonical, wacc },
            (e) => events.push({ stage: e.stage, message: e.message, at: e.at }),
          );
          return { report, events };
        }, (v) => ({ agents: (v as { report: { agentFindings: unknown[] } }).report.agentFindings.length }));
      }
    }
  } finally {
    console.error = origError;
  }

  result.totalMs = Math.round(performance.now() - t0);
  writeJson(dir, "summary.json", result);
  return result;
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  const llm = args.includes("--llm");
  const outRoot = get("--out") ?? "/tmp/ic-baseline";
  const tickersArg = get("--tickers");
  const set = tickersArg
    ? tickersArg.split(",").map((s) => ({ symbol: s.trim().toUpperCase(), why: undefined as string | undefined }))
    : BASELINE_TICKERS;

  fs.mkdirSync(outRoot, { recursive: true });
  const all: TickerResult[] = [];

  for (const { symbol, why } of set) {
    process.stdout.write(`\n=== ${symbol}${why ? ` (${why})` : ""} ===\n`);
    const r = await runTicker(symbol, why, outRoot, llm);
    for (const s of r.stages) {
      process.stdout.write(`  ${s.ok ? "ok  " : "FAIL"} ${s.stage.padEnd(18)} ${String(s.ms).padStart(6)}ms${s.error ? ` — ${s.error.slice(0, 120)}` : ""}\n`);
    }
    if (r.consoleErrors.length) process.stdout.write(`  console.error x${r.consoleErrors.length}\n`);
    all.push(r);
    await new Promise((res) => setTimeout(res, 500)); // be polite to providers
  }

  writeJson(outRoot, "all-summaries.json", all);
  const failures = all.flatMap((r) => r.stages.filter((s) => !s.ok).map((s) => `${r.symbol}/${s.stage}: ${s.error}`));
  process.stdout.write(`\n${all.length} tickers, ${failures.length} stage failures. Output: ${outRoot}\n`);
  failures.forEach((f) => process.stdout.write(`  - ${f}\n`));
}

void main();
