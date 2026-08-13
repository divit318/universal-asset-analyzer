#!/usr/bin/env node
// Integration status + validation gate for the MERGE_POLICY.md workflow.
//
//   npm run integrate                → read-only survey: fetch, working tree,
//                                      branch topology, conflict preview
//   npm run integrate:check          → quick validation gate (tsc, vitest, eslint)
//   npm run integrate:check -- --full  → adds `npm run build` (refuses while a
//                                        dev server is running — .next/ race)
//
// This script NEVER modifies the working tree, branches, or history. The only
// network/ref operation is `git fetch` (updates remote-tracking refs). The
// actual merging is done by the agent following MERGE_POLICY.md.

import { execFileSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const VALIDATE = args.includes("--validate");
const FULL = args.includes("--full");

function git(...a) {
  try {
    return execFileSync("git", a, { encoding: "utf8" }).trimEnd();
  } catch (err) {
    return err.stdout ? String(err.stdout).trimEnd() : "";
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// Branches the policy cares about, in display order.
const CANONICAL = "origin/main";
const BRANCHES = [
  "main",
  "prisha-work",
  "f22/day-change",
  "origin/main",
  "origin/prisha-work",
  "origin/f22/day-change",
];

function branchExists(ref) {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      stdio: "ignore",
    }).status === 0
  );
}

function surveyStatus() {
  section("Fetching origin (read-only; updates remote-tracking refs)");
  const fetch = spawnSync("git", ["fetch", "origin", "--prune"], {
    stdio: "inherit",
  });
  if (fetch.status !== 0) {
    console.log("WARNING: fetch failed (offline?). Topology below may be stale.");
  }

  const current = git("rev-parse", "--abbrev-ref", "HEAD");
  section(`Working tree (on ${current})`);
  const status = git("status", "--short");
  if (!status) {
    console.log("Clean.");
  } else {
    const lines = status.split("\n");
    const staged = lines.filter((l) => /^[MADRC]/.test(l)).length;
    const modified = lines.filter((l) => /^.[MD]/.test(l)).length;
    const untracked = lines.filter((l) => l.startsWith("??")).length;
    console.log(
      `DIRTY: ${lines.length} entries (${staged} staged, ${modified} modified/deleted, ${untracked} untracked).`
    );
    console.log(
      "Per MERGE_POLICY.md §3: commit coherent work on the owner's branch BEFORE merging. Never reset/clean."
    );
  }

  section(`Branch topology vs ${CANONICAL} (ahead / behind)`);
  for (const b of BRANCHES) {
    if (!branchExists(b)) continue;
    const counts = git("rev-list", "--left-right", "--count", `${b}...${CANONICAL}`);
    const [ahead, behind] = counts.split(/\s+/);
    const upstream = b.startsWith("origin/")
      ? ""
      : ` (upstream: ${git("rev-parse", "--abbrev-ref", `${b}@{upstream}`) || "none"})`;
    const tip = git("log", "-1", "--format=%h %s", b).slice(0, 90);
    console.log(`${b.padEnd(24)} +${ahead} / -${behind}${upstream}`);
    console.log(`${"".padEnd(24)} tip: ${tip}`);
  }

  section(`Conflict preview: merging ${CANONICAL} into ${current}`);
  // git merge-tree --write-tree is in-memory only; it never touches the
  // working tree or index (requires git >= 2.38; repo uses 2.55).
  const preview = spawnSync(
    "git",
    ["merge-tree", "--write-tree", "--name-only", "HEAD", CANONICAL],
    { encoding: "utf8" }
  );
  if (preview.status === 0) {
    console.log("Clean — no conflicts expected.");
  } else if (preview.status === 1) {
    const conflicted = preview.stdout.split("\n").slice(1).filter(Boolean);
    console.log(`${conflicted.length} conflicted file(s):`);
    for (const f of conflicted) console.log(`  ${f}`);
    console.log(
      "\nResolve per MERGE_POLICY.md §4-§6 (combine both sides; never blanket ours/theirs)."
    );
  } else {
    console.log("merge-tree unavailable or failed; preview skipped.");
  }

  section("Next steps (MERGE_POLICY.md §2)");
  console.log(
    [
      "1. Dirty tree? Commit coherent work first (§3).",
      `2. On the feature branch: git merge ${CANONICAL}; resolve per policy.`,
      "3. npm run integrate:check   (add -- --full before pushing main)",
      "4. Merge the feature branch into main, re-check, push origin main.",
    ].join("\n")
  );
}

function run(name, cmd, cmdArgs) {
  console.log(`\n--- ${name}: ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  const ok = r.status === 0;
  console.log(ok ? `--- ${name}: PASS` : `--- ${name}: FAIL`);
  return ok;
}

function validate() {
  const results = [];
  results.push(["typecheck", run("typecheck", "npx", ["tsc", "--noEmit"])]);
  results.push(["tests", run("tests", "npx", ["vitest", "run"])]);
  results.push(["lint", run("lint", "npx", ["eslint", "app", "lib"])]);

  if (FULL) {
    const devServer = spawnSync("pgrep", ["-f", "next dev"], { stdio: "ignore" });
    if (devServer.status === 0) {
      console.log(
        "\n--- build: SKIPPED — a `next dev` server is running and they race for .next/."
      );
      console.log("    Stop it first (scripts/ops/uaa stop), then re-run with --full.");
      results.push(["build", false]);
    } else {
      results.push(["build", run("build", "npm", ["run", "build"])]);
    }
  }

  section(`Validation gate (${FULL ? "full" : "quick"})`);
  let allOk = true;
  for (const [name, ok] of results) {
    console.log(`${name.padEnd(12)} ${ok ? "PASS" : "FAIL"}`);
    if (!ok) allOk = false;
  }
  if (!FULL) console.log("(run with -- --full to include the production build)");
  process.exit(allOk ? 0 : 1);
}

if (VALIDATE) validate();
else surveyStatus();
