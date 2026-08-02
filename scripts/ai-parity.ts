/**
 * Golden-output parity harness (ai-migration/03 §8; Phase 5 amendments 4 + the
 * semantic-agreement addition).
 *
 * Same inputs through BOTH providers, diff the structured fields, and check
 * EVIDENCE DISCIPLINE: claims must be traceable to the dossier. Two checks:
 *   - evidence grounding: `evidence` fields must token-overlap the dossier
 *   - number grounding: numeric tokens in ANY output text must appear in the
 *     dossier (this caught Ollama quoting "480,126 vehicles" that the cited
 *     evidence line did not contain — descriptions are checked, not just
 *     evidence fields)
 * The full prompt is persisted in the record so divergences can be
 * adjudicated later without rebuilding live dossiers.
 *
 * Tasks:
 *   npx tsx scripts/ai-parity.ts                          # movement, 15 symbols
 *   npx tsx scripts/ai-parity.ts --task insight           # financial insight
 *   npx tsx scripts/ai-parity.ts --task watchlist         # watchlist digest
 *   npx tsx scripts/ai-parity.ts --task calendar          # calendar brief
 *   … --devin-only | --ollama-only | --symbols AAPL,KOSS
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import type { z } from "zod";
import { getQuote, getHistory } from "@/lib/yahoo";
import { getCompanyNews } from "@/lib/news";
import { windowReturn, volumeAnomaly } from "@/lib/movement-explainer";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements } from "@/lib/statements";
import { computeScore } from "@/lib/scoring";
import { buildFinancialInsightPrompt } from "@/lib/ai-financial-insight";
import { buildDigestPrompt, summariseOne } from "@/lib/ai-watchlist";
import { buildCalendarBriefPrompt } from "@/lib/ai-calendar-brief";
import { getCalendarEvents } from "@/lib/calendar";
import {
  MovementAnalysisSchema, MovementWireSchema, MOVEMENT_SCHEMA_VERSION,
} from "@/lib/ai/schemas/movement";
import { TextAnalysisSchema, TextWireSchema, TEXT_SCHEMA_VERSION } from "@/lib/ai/schemas/text";
import {
  WatchlistDigestSchema, WatchlistDigestWireSchema, WATCHLIST_DIGEST_SCHEMA_VERSION,
} from "@/lib/ai/schemas/watchlist-digest";
import type { AnalysisRequest } from "@/lib/ai/analysis-provider";
import type { TaskType } from "@/lib/ai/task-registry";
import { devinAnalysisProvider } from "@/lib/ai/providers/devin/provider";
import { ollamaAnalysisProvider } from "@/lib/ai/providers/ollama-analysis";
import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
import type { WatchlistItem } from "@/lib/types";

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnvLocal();

const { values: args } = parseArgs({
  options: {
    task: { type: "string", default: "movement" },
    symbols: { type: "string" },
    "devin-only": { type: "boolean", default: false },
    "ollama-only": { type: "boolean", default: false },
  },
});

/* ------------------------------ grounding -------------------------------- */

/** Token-overlap: ≥60% of significant words (len>3) appear in the dossier. */
export function isGrounded(evidence: string, dossier: string): boolean {
  const words = evidence.toLowerCase().match(/[a-z0-9%$.]{4,}/g) ?? [];
  if (words.length === 0) return false;
  const hay = dossier.toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits / words.length >= 0.6;
}

/**
 * Numbers appearing in output text that are absent from the dossier. Strips
 * separators; ignores 1-digit numbers and list markers (too noisy) and
 * percentages of the number itself. Conservative: flags only ≥3-significant-
 * digit numbers, which is where invented facts (revenue, deliveries, price
 * targets) live.
 */
export function ungroundedNumbers(text: string, dossier: string): string[] {
  const clean = (s: string) => s.replace(/[,\s]/g, "");
  const hay = clean(dossier);
  // Values the dossier contains, for scaled-match checks ($108,807,000,000 →
  // "$108.81bn" is reformatting, not invention).
  const dossierValues = [...dossier.matchAll(/\d[\d,]*\.?\d*/g)]
    .map((m) => Number(clean(m[0])))
    .filter((n) => Number.isFinite(n) && n > 0);
  const scaledMatch = (v: number) =>
    dossierValues.some((d) =>
      [1, 1e3, 1e6, 1e9].some((s) => Math.abs(d / s - v) / Math.max(v, 1e-9) < 0.006),
    );
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*\.?\d*/g)) {
    const token = clean(m[0]).replace(/\.$/, "");
    const digits = token.replace(/\D/g, "");
    if (digits.length < 3) continue;
    if (hay.includes(token) || hay.includes(digits)) continue;
    const v = Number(token);
    if (Number.isFinite(v) && scaledMatch(v)) continue;
    out.push(m[0]);
  }
  return [...new Set(out)];
}

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, into));
  return into;
}

/* ------------------------------ task defs -------------------------------- */

interface Subject {
  key: string;
  label: string;
  prompt: string;
  /** For semantic checks that need it (e.g. watchlist symbol whitelist). */
  meta?: Record<string, unknown>;
}

interface TaskDef {
  taskType: TaskType;
  output: "json" | "text";
  schema: z.ZodType<unknown>;
  wireSchema: z.ZodType<unknown>;
  schemaVersion: number;
  buildSubjects(symbols: string[] | null): Promise<Subject[]>;
  /** Task-specific semantic summary of one output for the report table. */
  describe(output: unknown): string;
  /** Task-specific hallucination checks beyond number grounding. */
  extraChecks?(output: unknown, subject: Subject): string[];
}

const MOVEMENT_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "AAPL", label: "mega-cap, heavy news" },
  { symbol: "MSFT", label: "mega-cap" },
  { symbol: "NVDA", label: "mega-cap, volatile" },
  { symbol: "JPM", label: "financial" },
  { symbol: "XOM", label: "energy" },
  { symbol: "TSLA", label: "narrative-heavy" },
  { symbol: "KOSS", label: "DEGENERATE: microcap thin float" },
  { symbol: "BGFV", label: "DEGENERATE: microcap, sparse coverage" },
  { symbol: "NSRGY", label: "DEGENERATE: OTC ADR, no SEC filings" },
  { symbol: "RELIANCE.NS", label: "DEGENERATE: non-US listing (NSE India)" },
  { symbol: "7203.T", label: "DEGENERATE: non-US listing (Tokyo)" },
  { symbol: "CRCL", label: "DEGENERATE: recent IPO, short history" },
  { symbol: "PG", label: "DEGENERATE: quiet mover, ambiguous dossier" },
  { symbol: "PEP", label: "DEGENERATE: quiet mover, ambiguous dossier" },
  { symbol: "GLD", label: "DEGENERATE: commodity ETF (no company news)" },
];

const INSIGHT_SYMBOLS = ["AAPL", "MSFT", "KOSS", "BGFV", "NSRGY", "RELIANCE.NS", "CRCL", "PG"];

async function buildMovementPromptFor(symbol: string): Promise<{ prompt: string; note: string }> {
  const windowDays = 5;
  const [quote, history, news] = await Promise.all([
    getQuote(symbol).catch(() => null),
    getHistory(symbol, 30).catch(() => [] as Awaited<ReturnType<typeof getHistory>>),
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
  const prompt = `You are an institutional equity analyst explaining a price movement to a client.

SUBJECT: stock ${symbol}${quote?.name ? ` (${quote.name})` : ""}
OBSERVED MOVE: ${moveDesc}
${volumeDesc}

EVIDENCE — RECENT NEWS:
${newsDesc}

Identify the most likely drivers of this movement. For each driver, cite the
specific evidence above that supports it — do not invent facts not present in
the evidence. If the evidence is too thin to explain the move confidently, say
so in the summary and lower the confidence score accordingly.

${JSON_SCHEMA_LEAD_IN}
{
  "summary": "<2-3 sentence plain-English explanation of the movement>",
  "drivers": [
    {
      "category": "earnings" | "analyst" | "macro" | "sector" | "valuation" | "news" | "technical" | "volume" | "sentiment" | "other",
      "description": "<what happened>",
      "evidence": "<the specific fact above that supports this>",
      "direction": "bullish" | "bearish" | "neutral"
    }
  ],
  "confidence": <0-100 integer>,
  "persistence": "transient" | "short-term" | "durable"
}

Include 1-4 drivers, ranked most important first.`;
  return { prompt, note: `news=${news.length} move=${changePercent?.toFixed(2) ?? "n/a"}% history=${history.length}d` };
}

const TASKS: Record<string, TaskDef> = {
  movement: {
    taskType: "explain-movement",
    output: "json",
    schema: MovementAnalysisSchema,
    wireSchema: MovementWireSchema,
    schemaVersion: MOVEMENT_SCHEMA_VERSION,
    async buildSubjects(symbols) {
      const set = symbols
        ? symbols.map((s) => ({ symbol: s, label: "custom" }))
        : MOVEMENT_SYMBOLS;
      const out: Subject[] = [];
      for (const { symbol, label } of set) {
        const { prompt, note } = await buildMovementPromptFor(symbol);
        out.push({ key: symbol, label: `${label} (${note})`, prompt });
      }
      return out;
    },
    describe(output) {
      const o = output as z.infer<typeof MovementAnalysisSchema>;
      return `conf=${o.confidence} drivers=${o.drivers.map((d) => `${d.category}:${d.direction[0]}`).join(",")} ${o.persistence}`;
    },
    extraChecks(output, subject) {
      const o = output as z.infer<typeof MovementAnalysisSchema>;
      return o.drivers
        .filter((d) => !isGrounded(d.evidence, subject.prompt))
        .map((d) => `ungrounded evidence (${d.category}): "${d.evidence.slice(0, 80)}"`);
    },
  },

  insight: {
    taskType: "quick-summary",
    output: "text",
    schema: TextAnalysisSchema,
    wireSchema: TextWireSchema,
    schemaVersion: TEXT_SCHEMA_VERSION,
    async buildSubjects(symbols) {
      const set = symbols ?? INSIGHT_SYMBOLS;
      const out: Subject[] = [];
      for (const symbol of set) {
        try {
          const [parts, statements] = await Promise.all([
            getFundamentals(symbol),
            getFinancialStatements(symbol).catch(() => null),
          ]);
          const score = computeScore(parts.snapshot, statements, parts.analyst);
          const prompt = buildFinancialInsightPrompt({ symbol, snapshot: parts.snapshot, statements, score });
          out.push({ key: symbol, label: `statements=${statements ? "yes" : "NO"}`, prompt });
        } catch (err) {
          console.log(`  ${symbol.padEnd(14)} SKIPPED — dossier build failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      return out;
    },
    describe(output) {
      const o = output as z.infer<typeof TextAnalysisSchema>;
      return `${o.text.length}ch: ${o.text.slice(0, 70)}…`;
    },
  },

  watchlist: {
    taskType: "watchlist-intelligence",
    output: "json",
    schema: WatchlistDigestSchema,
    wireSchema: WatchlistDigestWireSchema,
    schemaVersion: WATCHLIST_DIGEST_SCHEMA_VERSION,
    async buildSubjects(symbols) {
      const lists: { key: string; label: string; symbols: string[] }[] = symbols
        ? [{ key: "custom", label: "custom", symbols }]
        : [
            { key: "mixed-8", label: "typical watchlist", symbols: ["AAPL", "MSFT", "NVDA", "JPM", "XOM", "PG", "GLD", "CRCL"] },
            { key: "degenerate-2", label: "DEGENERATE: two thin microcaps", symbols: ["KOSS", "BGFV"] },
          ];
      const out: Subject[] = [];
      for (const l of lists) {
        const items = l.symbols.map((s) => ({ symbol: s }) as WatchlistItem);
        const summaries = await Promise.all(items.map(summariseOne));
        out.push({
          key: l.key,
          label: l.label,
          prompt: buildDigestPrompt(summaries),
          meta: { symbols: l.symbols },
        });
      }
      return out;
    },
    describe(output) {
      const o = output as z.infer<typeof WatchlistDigestSchema>;
      return `picks=[${o.topPicks.map(firstSymbol).join(",")}] concerns=[${o.topConcerns.map(firstSymbol).join(",")}] actions=${o.actionItems.length}`;
    },
    extraChecks(output, subject) {
      const o = output as z.infer<typeof WatchlistDigestSchema>;
      const allowed = new Set((subject.meta?.symbols as string[]).map((s) => s.toUpperCase()));
      const problems: string[] = [];
      for (const [field, list] of [["topPicks", o.topPicks], ["topConcerns", o.topConcerns]] as const) {
        for (const entry of list) {
          const sym = firstSymbol(entry);
          if (sym && !allowed.has(sym)) problems.push(`${field} references non-watchlist symbol "${sym}"`);
        }
      }
      return problems;
    },
  },

  calendar: {
    taskType: "calendar-brief",
    output: "text",
    schema: TextAnalysisSchema,
    wireSchema: TextWireSchema,
    schemaVersion: TEXT_SCHEMA_VERSION,
    async buildSubjects() {
      const weekStart = new Date().toISOString().slice(0, 10);
      const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const calendar = await getCalendarEvents();
      const events = calendar.events.filter((e) => e.date >= weekStart && e.date <= weekEnd);
      const prompt = buildCalendarBriefPrompt(events.slice(0, 200), weekStart, weekEnd);
      return [
        { key: `week-${weekStart}`, label: `${events.length} real events`, prompt },
        // Degenerate: an empty calendar week — the brief must say "quiet", not invent events.
        { key: "empty-week", label: "DEGENERATE: zero events", prompt: buildCalendarBriefPrompt([], weekStart, weekEnd) },
      ];
    },
    describe(output) {
      const o = output as z.infer<typeof TextAnalysisSchema>;
      return `${o.text.length}ch: ${o.text.slice(0, 70)}…`;
    },
  },
};

function firstSymbol(entry: string): string | null {
  const m = entry.match(/\b([A-Z]{2,6}(?:\.[A-Z]{1,3})?)\b/);
  return m ? m[1] : null;
}

/* ------------------------------- runner ---------------------------------- */

interface ProviderOutcome {
  ok: boolean;
  ms: number;
  output?: unknown;
  problems?: string[];
  ungroundedNumbers?: string[];
  sessionUrl?: string;
  error?: string;
}

async function runProvider(kind: "ollama" | "devin", task: TaskDef, s: Subject): Promise<ProviderOutcome> {
  const req: AnalysisRequest<unknown> = {
    taskType: task.taskType,
    subjectKey: `parity:${s.key}`,
    prompt: s.prompt,
    schema: task.schema,
    wireSchema: task.wireSchema,
    schemaVersion: task.schemaVersion,
    output: task.output,
    idempotencyKey: `parity-${kind}-${task.taskType}-${s.key}-${Date.now()}`,
  };
  const t0 = performance.now();
  try {
    const provider = kind === "devin" ? devinAnalysisProvider : ollamaAnalysisProvider;
    const res = await provider.run(req);
    const texts = collectStrings(res.data);
    return {
      ok: true,
      ms: performance.now() - t0,
      output: res.data,
      problems: task.extraChecks?.(res.data, s) ?? [],
      ungroundedNumbers: ungroundedNumbers(texts.join("\n"), s.prompt),
      sessionUrl: res.meta.sessionUrl,
    };
  } catch (err) {
    return { ok: false, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const task = TASKS[args.task ?? "movement"];
  if (!task) {
    console.error(`[parity] unknown task "${args.task}" (know: ${Object.keys(TASKS).join(", ")})`);
    process.exit(1);
  }
  const only = args["devin-only"] ? "devin" : args["ollama-only"] ? "ollama" : null;
  const symbols = args.symbols ? args.symbols.split(",").map((s) => s.trim().toUpperCase()) : null;

  console.log(`[parity] task=${args.task} providers=${only ?? "both"}`);
  console.log(`[parity] building dossiers from live data…`);
  const subjects = await task.buildSubjects(symbols);
  for (const s of subjects) console.log(`  ${s.key.padEnd(14)} prompt=${s.prompt.length}ch  (${s.label})`);

  const results: Record<string, { subject: Subject; devin?: ProviderOutcome; ollama?: ProviderOutcome }> = {};
  for (const s of subjects) results[s.key] = { subject: s };

  if (only !== "ollama") {
    console.log(`\n[parity] devin: ${subjects.length} concurrent sessions…`);
    const outcomes = await Promise.all(subjects.map((s) => runProvider("devin", task, s)));
    outcomes.forEach((o, i) => {
      results[subjects[i].key].devin = o;
      logOutcome("devin", subjects[i], o, task);
    });
  }
  if (only !== "devin") {
    console.log(`\n[parity] ollama: ${subjects.length} sequential generations…`);
    for (const s of subjects) {
      const o = await runProvider("ollama", task, s);
      results[s.key].ollama = o;
      logOutcome("ollama", s, o, task);
    }
  }

  console.log(`\n========== PARITY SUMMARY (${args.task}) ==========`);
  let anyFailure = false;
  for (const { subject, devin, ollama } of Object.values(results)) {
    for (const [name, o] of [["devin", devin], ["ollama", ollama]] as const) {
      if (!o) continue;
      if (!o.ok) anyFailure = true;
      const flags = [...(o.problems ?? []), ...(o.ungroundedNumbers?.length ? [`ungrounded numbers: ${o.ungroundedNumbers.join(", ")}`] : [])];
      console.log(
        `${subject.key.padEnd(14)} ${name.padEnd(6)} ${o.ok ? "ok " : "FAIL"} ${(o.ms / 1000).toFixed(1).padStart(6)}s  ${o.ok ? task.describe(o.output) : o.error?.slice(0, 90)}`,
      );
      for (const f of flags) console.log(`${"".padEnd(22)}⚠ ${f}`);
    }
  }

  const outDir = path.join(process.cwd(), "bench-out", "parity");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `parity-${args.task}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      Object.values(results).map((r) => ({
        subject: { key: r.subject.key, label: r.subject.label, prompt: r.subject.prompt, meta: r.subject.meta },
        devin: r.devin,
        ollama: r.ollama,
      })),
      null,
      2,
    ),
  );
  console.log(`\n[parity] full record (including prompts) → ${outFile}`);
  process.exit(anyFailure ? 1 : 0);
}

function logOutcome(name: string, s: Subject, o: ProviderOutcome, task: TaskDef): void {
  console.log(
    `  ${name.padEnd(6)} ${s.key.padEnd(14)} ${o.ok ? "ok " : "FAIL"} ${(o.ms / 1000).toFixed(1)}s ${o.ok ? task.describe(o.output) : (o.error ?? "").slice(0, 90)}`,
  );
}

main().catch((err) => {
  console.error(`[parity] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
