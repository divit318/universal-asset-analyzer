import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": import.meta.dirname },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // Vitest defaults to CPUs-1 workers — 9 on this 10-core M4 — and each fork
    // loads the full module graph (scoring engines, IC valuation suite,
    // portfolio analytics). Measured on this repo, 2649 tests, peak RSS across
    // the whole vitest process tree:
    //
    //   workers   wall    peak RSS
    //     2       23s      569 MB
    //     6       10s     1003 MB   <-- chosen
    //     9       10s     1228 MB   (the old default)
    //
    // 6 is the knee: identical wall-clock to the uncapped default while giving
    // back 225 MB, because past 6 the suite is memory-bound rather than
    // CPU-bound and extra forks buy nothing. Dropping to 4 was measured too and
    // is a bad trade — 14s for only 173 MB more headroom.
    //
    // The 225 MB matters on a 16 GB host where the dev server, Chrome and
    // several agent tsservers are already resident: it is the difference
    // between a test run that is merely slow and one that tips the compressor
    // into swap and takes the machine down mid-suite.
    //
    // Note for future edits: `poolOptions.forks.maxForks` was REMOVED in
    // Vitest 4, and `minWorkers` is not in its InlineConfig. Top-level
    // `maxWorkers` is the whole supported surface.
    maxWorkers: 6,
  },
});
