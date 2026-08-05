/**
 * Offline re-grading of recorded model outputs.
 *
 * `npx tsx scripts/ai-eval.ts --record` snapshots real model outputs into
 * tests/ai-eval/recorded/. This suite re-runs the SAME graders over those
 * snapshots in CI, so a grader, schema, or prompt-contract regression is
 * caught without a key and without spend. It does not prove the current
 * model still passes — that is the live runner's job — it proves the
 * grading contract still accepts known-good outputs.
 *
 * Skips (with a visible reason) when no recordings exist yet.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLDEN_CASES } from "./golden";

const RECORD_DIR = join(__dirname, "recorded");

interface Recording {
  case: string;
  recordedAt: string;
  model: string;
  output: string;
  gradedFailures: string[];
}

const recordings: Recording[] = existsSync(RECORD_DIR)
  ? readdirSync(RECORD_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(RECORD_DIR, f), "utf8")) as Recording)
  : [];

describe("recorded AI outputs still satisfy their graders", () => {
  it.skipIf(recordings.length > 0)("no recordings yet — run scripts/ai-eval.ts --record with a key", () => {
    expect(recordings).toEqual([]);
  });

  for (const rec of recordings) {
    const golden = GOLDEN_CASES.find((c) => c.name === rec.case);
    it(rec.case, () => {
      expect(golden, `recording for unknown case "${rec.case}" — re-record or delete it`).toBeDefined();
      // A recording that failed grading at record time is a known-bad
      // snapshot; keeping it green would freeze the failure in place.
      expect(rec.gradedFailures).toEqual([]);
      expect(golden!.grade(rec.output)).toEqual([]);
    });
  }
});
