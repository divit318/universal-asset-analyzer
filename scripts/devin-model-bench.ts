/**
 * Empirical per-task model selection for the Devin CLI provider.
 *
 * Enumerates candidates from the LIVE catalogue (`devin models list`), runs
 * REAL UAA prompts from each task tier against each candidate, and reports
 * what actually matters per tier: wall-clock latency, schema adherence
 * (strict wire-schema validation, not just "parses"), and output substance.
 * The winning mapping is recorded in lib/ai/config.ts TASK_MODEL_PINS with
 * these measurements cited.
 *
 * Real inputs, no synthetics:
 *   - nl-screener: the real system prompt from lib/screener/nl-filters
 *   - movement:    the persisted AAPL dossier from the parity records
 *   - calendar:    the persisted real-week prompt from the parity records
 *   - thesis:      a deep bull/bear/base synthesis over the same real dossiers
 *
 * Usage: npx tsx scripts/devin-model-bench.ts [--runs 2]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { generateViaDevin, listAllowedModelIds } from "@/lib/ai/devin-cli";
import { buildSystemPrompt } from "@/lib/screener/nl-filters";
import { MovementWireSchema } from "@/lib/ai/schemas/movement";
import type { ProviderChatTurn } from "@/lib/ai/provider";

const { values: args } = parseArgs({ options: { runs: { type: "string", default: "2" } } });
const RUNS = Math.max(1, Number.parseInt(args.runs ?? "2", 10) || 2);

/* ------------------------------ real prompts ----------------------------- */

function latestParity(prefix: string): { key: string; prompt: string }[] {
  const files = fs
    .readdirSync("bench-out/parity")
    .filter((f) => f.startsWith(prefix))
    .sort();
  const file = files[files.length - 1];
  if (!file) throw new Error(`no parity record with prefix ${prefix} — run scripts/ai-parity.ts first`);
  const data = JSON.parse(fs.readFileSync(path.join("bench-out/parity", file), "utf8")) as {
    subject: { key: string; prompt: string };
  }[];
  return data.map((d) => ({ key: d.subject.key, prompt: d.subject.prompt }));
}

// The original movement parity record predates the --task filename prefix.
function movementRecord(): { key: string; prompt: string }[] {
  try {
    return latestParity("parity-movement");
  } catch {
    return latestParity("parity-2026");
  }
}
const movementPrompt = movementRecord().find((s) => s.key === "AAPL")!.prompt;
const calendarPrompt = latestParity("parity-calendar")[0].prompt;
const watchlistPrompt = latestParity("parity-watchlist")[0].prompt;

const NL_QUERY = "profitable US tech companies under $50B market cap with strong revenue growth and low debt";

const ThesisSchema = z.object({
  bull: z.string().min(100),
  bear: z.string().min(100),
  base: z.string().min(100),
  variantPerception: z.string().min(50),
  keyCatalysts: z.array(z.string().min(1)).min(2).max(6),
  keyRisks: z.array(z.string().min(1)).min(2).max(6),
});

const thesisPrompt = `You are a buy-side analyst forming an investment thesis on AAPL for an investment committee.

Work ONLY from the two evidence blocks below (a price-movement dossier and a
watchlist scan that includes AAPL). Do not invent figures.

=== MOVEMENT DOSSIER ===
${movementPrompt}

=== WATCHLIST SCAN ===
${watchlistPrompt}

Respond ONLY with JSON: {
  "bull": "<the strongest honest bull case, 3-5 sentences, citing dossier facts>",
  "bear": "<the strongest honest bear case, 3-5 sentences, citing dossier facts>",
  "base": "<your base case and what it hinges on, 3-5 sentences>",
  "variantPerception": "<what the market is getting wrong, if anything, 2-3 sentences>",
  "keyCatalysts": ["<2-6 specific catalysts from the evidence>"],
  "keyRisks": ["<2-6 specific risks from the evidence>"]
}`;

/* ------------------------------ task defs -------------------------------- */

interface BenchTask {
  name: string;
  tier: "light" | "standard" | "deep";
  messages: ProviderChatTurn[];
  json: boolean;
  timeoutMs: number;
  /** Returns a defect string, or null when the output meets the bar. */
  validate(output: string): string | null;
}

const TASKS: BenchTask[] = [
  {
    name: "nl-screener",
    tier: "light",
    messages: [
      { role: "system", content: buildSystemPrompt("equity") },
      { role: "user", content: NL_QUERY },
    ],
    json: true,
    timeoutMs: 60_000,
    validate(output) {
      try {
        const parsed = JSON.parse(output) as Record<string, unknown>;
        const keys = Object.keys(parsed);
        if (keys.length < 2) return `only ${keys.length} filters for a 4-constraint query`;
        return null;
      } catch {
        return "not valid JSON";
      }
    },
  },
  {
    name: "calendar-brief",
    tier: "light",
    messages: [{ role: "user", content: calendarPrompt }],
    json: false,
    timeoutMs: 60_000,
    validate(output) {
      if (output.length < 400) return `too short (${output.length}ch) for a 150-200 word brief`;
      if (/^#|^\*\*/.test(output)) return "markdown despite plain-text instruction";
      return null;
    },
  },
  {
    name: "movement (JSON)",
    tier: "standard",
    messages: [{ role: "user", content: movementPrompt }],
    json: true,
    timeoutMs: 90_000,
    validate(output) {
      try {
        const res = MovementWireSchema.safeParse(JSON.parse(output));
        return res.success ? null : res.error.issues.map((i) => i.path.join(".")).join(",");
      } catch {
        return "not valid JSON";
      }
    },
  },
  {
    name: "thesis (deep JSON)",
    tier: "deep",
    messages: [{ role: "user", content: thesisPrompt }],
    json: true,
    timeoutMs: 180_000,
    validate(output) {
      try {
        const res = ThesisSchema.safeParse(JSON.parse(output));
        return res.success ? null : res.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ").slice(0, 120);
      } catch {
        return "not valid JSON";
      }
    },
  },
];

/** Candidates per tier — incumbents from MODEL_REGISTRY plus newer catalogue
 * entries the registry has not tried (swe-1-7-lightning, gemini flash, fable). */
const CANDIDATES: Record<BenchTask["tier"], string[]> = {
  light: ["swe-1-6-fast", "swe-1-7-lightning", "gemini-3-6-flash-minimal", "gpt-5-6-luna-low"],
  standard: ["claude-sonnet-5-low", "gpt-5-6-terra-low", "claude-5-fable-low", "gemini-3-6-flash-medium"],
  deep: ["claude-opus-5-medium", "claude-opus-5-low", "claude-sonnet-5-medium", "gpt-5-6-terra-medium"],
};

/* -------------------------------- runner --------------------------------- */

interface Sample {
  task: string;
  model: string;
  run: number;
  ms: number;
  ok: boolean;
  defect: string | null;
  chars: number;
  output?: string;
}

async function one(task: BenchTask, model: string, run: number): Promise<Sample> {
  const t0 = performance.now();
  try {
    const output = await generateViaDevin(task.messages, { model, json: task.json, timeoutMs: task.timeoutMs });
    const defect = task.validate(output);
    return { task: task.name, model, run, ms: performance.now() - t0, ok: defect === null, defect, chars: output.length, output: run === 1 ? output.slice(0, 2000) : undefined };
  } catch (err) {
    return { task: task.name, model, run, ms: performance.now() - t0, ok: false, defect: `ERROR: ${err instanceof Error ? err.message.slice(0, 120) : err}`, chars: 0 };
  }
}

async function main() {
  const allowed = new Set(await listAllowedModelIds());
  console.log(`[bench] catalogue: ${allowed.size} models available to this account`);
  for (const [tier, models] of Object.entries(CANDIDATES)) {
    for (const m of models) if (!allowed.has(m)) console.log(`[bench] ⚠ ${tier} candidate ${m} NOT in catalogue — will fail fast`);
  }

  const jobs: Promise<Sample>[] = [];
  for (const task of TASKS) {
    for (const model of CANDIDATES[task.tier]) {
      for (let run = 1; run <= RUNS; run++) jobs.push(one(task, model, run));
    }
  }
  console.log(`[bench] ${jobs.length} calls (${RUNS} run(s) each), CLI concurrency cap applies…\n`);
  const samples = await Promise.all(jobs);

  console.log(`task              | model                     | mean s | runs ok | defects`);
  const byKey = new Map<string, Sample[]>();
  for (const s of samples) {
    const k = `${s.task}|${s.model}`;
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  for (const [k, ss] of byKey) {
    const [task, model] = k.split("|");
    const mean = ss.reduce((a, s) => a + s.ms, 0) / ss.length / 1000;
    const ok = ss.filter((s) => s.ok).length;
    const defects = [...new Set(ss.map((s) => s.defect).filter(Boolean))].join(" / ").slice(0, 60);
    console.log(`${task.padEnd(17)} | ${model.padEnd(25)} | ${mean.toFixed(1).padStart(6)} | ${ok}/${ss.length}     | ${defects || "-"}`);
  }

  const outDir = "bench-out/model-bench";
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `bench-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(samples, null, 2));
  console.log(`\n[bench] full record → ${outFile}`);
}

main().catch((err) => {
  console.error(`[bench] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
