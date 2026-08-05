/**
 * Live AI workflow evals — runs the golden cases (tests/ai-eval/golden.ts)
 * through the REAL orchestrator/router/provider and grades the outputs with
 * the same deterministic graders CI uses on recorded fixtures.
 *
 * This is the gate a model swap, effort-tier repin, or prompt change must
 * pass BEFORE it ships: same prompts features send, same schemas, same
 * grounding verifier — spend and latency printed per case.
 *
 * Usage:
 *   npx tsx scripts/ai-eval.ts                 # run all cases
 *   npx tsx scripts/ai-eval.ts --case screener # substring filter
 *   npx tsx scripts/ai-eval.ts --record        # also write outputs to tests/ai-eval/recorded/
 *   npx tsx scripts/ai-eval.ts --model claude-opus-5-low   # pin every case to one model
 *
 * Requires an Anthropic key. Bounded spend: 4 cases × ~1-2k prompt tokens ×
 * ≤1k output tokens per full run.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GOLDEN_CASES } from "../tests/ai-eval/golden";
import { runTask } from "../lib/ai/orchestrator";
import { estimateCostUsd } from "../lib/ai/telemetry";

const { values: args } = parseArgs({
  options: {
    case: { type: "string" },
    record: { type: "boolean", default: false },
    model: { type: "string" },
  },
});

const RECORD_DIR = join(process.cwd(), "tests", "ai-eval", "recorded");

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function main(): Promise<void> {
  const cases = GOLDEN_CASES.filter((c) => !args.case || c.name.includes(args.case));
  if (cases.length === 0) {
    console.error(`no golden case matches "${args.case}"`);
    process.exitCode = 2;
    return;
  }
  if (args.record) mkdirSync(RECORD_DIR, { recursive: true });

  let failed = 0;
  let totalCost = 0;
  for (const c of cases) {
    const startedAt = Date.now();
    try {
      const response = await runTask(c.taskType, c.prompt, {
        system: c.system,
        json: c.json,
        jsonSchema: c.jsonSchema,
        maxTokens: c.maxTokens,
        model: args.model,
        timeoutMs: 120_000,
      });
      const failures = c.grade(response.content);
      const cost = estimateCostUsd(response.model, response.tokenUsage) ?? 0;
      totalCost += cost;
      const status = failures.length === 0 ? "PASS" : "FAIL";
      if (failures.length > 0) failed += 1;
      console.log(
        `${status}  ${c.name}\n      model ${response.model} · ${Date.now() - startedAt}ms · ` +
          `in ${response.tokenUsage?.promptTokens ?? "?"} out ${response.tokenUsage?.completionTokens ?? "?"} · ~$${cost.toFixed(5)}`,
      );
      for (const f of failures) console.log(`      ✗ ${f}`);

      if (args.record) {
        const file = join(RECORD_DIR, `${slug(c.name)}.json`);
        writeFileSync(
          file,
          JSON.stringify(
            {
              case: c.name,
              recordedAt: new Date().toISOString(),
              model: response.model,
              output: response.content,
              gradedFailures: failures,
            },
            null,
            2,
          ) + "\n",
        );
        console.log(`      recorded → ${file}`);
      }
    } catch (err) {
      failed += 1;
      console.log(`ERROR ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed · total est. spend ~$${totalCost.toFixed(4)}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
