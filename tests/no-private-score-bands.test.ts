/**
 * Structural drift guard.
 *
 * The 2026-08-17 consistency audit found nine private score-band tables that
 * had drifted from lib/recommendation.ts (India verdicts at 78/62/46/30,
 * Scanner verdicts at 75/60/45, Thematic at 80/65/50/35, meters at 65/45,
 * 70/40, 75/55/35, exports at 70/45, ...). Manual sweeps found them in three
 * waves, which proves manual sweeps are not a control. This test IS the
 * control: it statically scans lib/ and app/ and fails on any numeric
 * threshold table that interprets a 0-100 score — two or more graded numeric
 * comparisons feeding semantic tone tokens or canonical vocabulary labels —
 * in a file not present in tests/score-interpretation.allowlist.ts.
 *
 * If this test fails on your new code: route through scoreToRecommendation /
 * scoreGrade / scoreToOpportunityVerdict / scoreMeterTone / scoreArgb
 * (lib/recommendation.ts), or — for a genuinely different scale — add an
 * allowlist entry with a one-line justification and get it reviewed as a
 * methodology change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SCORE_INTERPRETATION_ALLOWLIST } from "./score-interpretation.allowlist";

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["lib", "app"];
const WINDOW_LINES = 8;

/** Graded numeric comparison: >= / > / <= / < against a constant that looks
 *  like a score edge (5–99, or a 0.05–0.99 fraction). `>= 0` sign checks and
 *  tiny epsilons don't count. */
const CMP = /[><]=?\s*(\d{1,2}(?:\.\d+)?)\b/g;

/** Interpretation outputs: semantic tone tokens (class names, quoted badge
 *  tones, ARGB export colors) or canonical vocabulary. */
const TONE =
  /(?:text|bg|border)-(?:positive|negative|warning)|"(?:positive|negative|warning)"|FFD1FAE5|FFFEF9C3|FFFEE2E2/;
const LABELS =
  /"(?:Strong Buy|Strong Sell|Accumulate|Reduce|Avoid|Excellent|Good|Fair|Weak|Poor)"|"(?:exceptional|strong|moderate|weak|avoid)"|"STRONG_BUY"|"STRONG_SELL"/;

function isScoreEdge(raw: string): boolean {
  const n = Number(raw);
  if (Number.isNaN(n)) return false;
  if (n >= 5 && n <= 99) return true; // 0-100 scale edges
  if (n >= 0.05 && n <= 0.99) return true; // same edges expressed as fractions
  return false;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) yield full;
  }
}

interface Hit {
  file: string;
  line: number;
  snippet: string;
}

function scanFile(fullPath: string, rel: string): Hit[] {
  const lines = readFileSync(fullPath, "utf8").split("\n");
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const window = lines.slice(i, i + WINDOW_LINES).join("\n");
    // Distinct graded comparison constants in the window.
    const edges = new Set<string>();
    for (const m of window.matchAll(CMP)) {
      if (isScoreEdge(m[1])) edges.add(m[1]);
    }
    if (edges.size < 2) continue;
    // Interpretation output in the same window.
    if (!TONE.test(window) && !LABELS.test(window)) continue;
    // One hit per contiguous region — skip ahead past this window.
    hits.push({ file: rel, line: i + 1, snippet: lines.slice(i, i + WINDOW_LINES).join("\n").slice(0, 400) });
    i += WINDOW_LINES;
  }
  return hits;
}

function scanAll(): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replaceAll("\\", "/");
      hits.push(...scanFile(file, rel));
    }
  }
  return hits;
}

describe("no private score-band tables outside lib/recommendation.ts", () => {
  const hits = scanAll();
  const allowed = new Set(Object.keys(SCORE_INTERPRETATION_ALLOWLIST));

  it("every threshold table that interprets a score is either canonical or allowlisted", () => {
    const violations = hits.filter((h) => !allowed.has(h.file));
    const report = violations
      .map((v) => `\n--- ${v.file}:${v.line} ---\n${v.snippet}`)
      .join("\n");
    expect(
      violations,
      `Private score-interpretation table(s) found. Route through lib/recommendation.ts ` +
        `or add a justified entry to tests/score-interpretation.allowlist.ts:${report}`,
    ).toEqual([]);
  });

  it("the allowlist carries no stale entries (every entry still matches something)", () => {
    const hitFiles = new Set(hits.map((h) => h.file));
    const stale = [...allowed].filter((f) => !hitFiles.has(f));
    expect(
      stale,
      "Allowlist entries whose files no longer contain a threshold table — remove them so the allowlist stays an honest census.",
    ).toEqual([]);
  });

  it("every allowlist entry states a justification", () => {
    for (const [file, why] of Object.entries(SCORE_INTERPRETATION_ALLOWLIST)) {
      expect(why.length, file).toBeGreaterThan(30);
    }
  });
});
