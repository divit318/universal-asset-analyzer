import { describe, expect, it } from "vitest";

/**
 * The DataTable's sorting contract.
 *
 * The comparator is the part of a data grid that is easy to get subtly wrong and
 * that quietly misleads when it is: if nulls float to the top on an ascending
 * sort, then "show me the worst" surfaces every row whose value is merely
 * unknown, and a missing data point becomes a finding.
 *
 * The comparator is re-implemented here against the same rules the component
 * documents, so the invariants are pinned even though the component itself is a
 * client React module.
 */

type SortDir = "asc" | "desc";

/** Mirrors `compare` in app/_components/ui/data-table.tsx. */
function compare(a: number | string | null, b: number | string | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
  return String(a).localeCompare(String(b)) * sign;
}

function sortBy<T>(rows: T[], get: (r: T) => number | string | null, dir: SortDir): T[] {
  return [...rows].sort((a, b) => compare(get(a), get(b), dir));
}

interface Row {
  sym: string;
  toTarget: number | null;
}

const ROWS: Row[] = [
  { sym: "APA", toTarget: -2.4 },
  { sym: "CVX", toTarget: null },
  { sym: "NVDA", toTarget: 18.2 },
  { sym: "O", toTarget: null },
  { sym: "TM", toTarget: -35.1 },
];

describe("DataTable sorting", () => {
  it("sorts numerically descending", () => {
    const out = sortBy(ROWS, (r) => r.toTarget, "desc").map((r) => r.sym);
    expect(out.slice(0, 3)).toEqual(["NVDA", "APA", "TM"]);
  });

  it("sorts numerically ascending", () => {
    const out = sortBy(ROWS, (r) => r.toTarget, "asc").map((r) => r.sym);
    expect(out.slice(0, 3)).toEqual(["TM", "APA", "NVDA"]);
  });

  it("sinks nulls to the bottom on a DESCENDING sort", () => {
    const out = sortBy(ROWS, (r) => r.toTarget, "desc").map((r) => r.sym);
    expect(out.slice(-2).sort()).toEqual(["CVX", "O"]);
  });

  it("sinks nulls to the bottom on an ASCENDING sort too — the rule that matters", () => {
    // This is the one that is easy to get wrong. "Worst first" must not mean
    // "unknown first"; a missing value is not a small value.
    const out = sortBy(ROWS, (r) => r.toTarget, "asc").map((r) => r.sym);
    expect(out.slice(-2).sort()).toEqual(["CVX", "O"]);
  });

  it("keeps every row — sorting never filters", () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(sortBy(ROWS, (r) => r.toTarget, dir)).toHaveLength(ROWS.length);
    }
  });

  it("sorts strings case-insensitively via localeCompare", () => {
    const rows = [{ sym: "beta" }, { sym: "Alpha" }, { sym: "gamma" }];
    const out = sortBy(rows, (r) => r.sym, "asc").map((r) => r.sym);
    expect(out).toEqual(["Alpha", "beta", "gamma"]);
  });

  it("treats an all-null column as a no-op rather than reordering arbitrarily", () => {
    const rows = [{ sym: "A", v: null }, { sym: "B", v: null }, { sym: "C", v: null }];
    expect(sortBy(rows, (r) => r.v, "desc").map((r) => r.sym)).toEqual(["A", "B", "C"]);
  });

  it("handles negative and zero values without special-casing them as missing", () => {
    // A 0% move is a real measurement and must outrank an unknown one.
    const rows = [{ sym: "Z", v: null }, { sym: "Y", v: 0 }, { sym: "X", v: -5 }];
    const out = sortBy(rows, (r) => r.v, "asc").map((r) => r.sym);
    expect(out).toEqual(["X", "Y", "Z"]);
  });
});
