import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Solution section's contract with the Problem section and with the
 * truth constraint of the landing rebuild:
 *
 *  1. The five stream labels must be EXACTLY the Problem diagram's five
 *     sources, in the same order. The transformation (five severed islands
 *     become five converging streams) only reads if the names match.
 *  2. The trace demonstration's arithmetic must be internally consistent
 *     with the values it displays (free cash flow = operating cash flow
 *     minus capex, the derivation lib/statements.ts ships), so an edit to
 *     one baked figure cannot silently desync the chain.
 *
 * Source-text assertions by design: both arrays live in client components
 * and the correspondence is a copy contract, not a runtime import.
 */

const LANDING = join(__dirname, "..", "app", "landing", "_components");
const solution = readFileSync(join(LANDING, "sections", "solution.tsx"), "utf8");
const problem = readFileSync(join(LANDING, "sections", "problem-diagram.tsx"), "utf8");

function orderedTitles(src: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

describe("solution section: continuity with the problem section", () => {
  const sourcesBlock = solution.slice(solution.indexOf("const SOURCES"), solution.indexOf("];", solution.indexOf("const SOURCES")));

  it("streams carry the problem diagram's five sources, same names, same order", () => {
    const problemTitles = orderedTitles(problem, /title: "([^"]+)"/g);
    const solutionLabels = orderedTitles(sourcesBlock, /label: "([^"]+)"/g);
    expect(problemTitles).toHaveLength(5);
    expect(solutionLabels).toEqual(problemTitles);
  });

  it("streams reuse the problem diagram's icon vocabulary", () => {
    const problemIcons = orderedTitles(problem, /icon: ([A-Za-z]+),/g);
    const solutionIcons = orderedTitles(sourcesBlock, /icon: ([A-Za-z]+),/g);
    expect(solutionIcons).toEqual(problemIcons);
  });
});

describe("solution section: the trace demonstration is internally consistent", () => {
  const num = (label: string): number => {
    const m = solution.match(new RegExp(`label: "${label}"[^}]*value: "([\\d,]+)"`));
    expect(m, `trace row "${label}"`).toBeTruthy();
    return Number(m![1].replaceAll(",", ""));
  };

  it("free cash flow equals operating cash flow minus capex", () => {
    expect(num("Operating cash flow") - num("Capital expenditure")).toBe(num("Free cash flow"));
  });

  it("the headline figure is the derived value in billions, one decimal", () => {
    const fcf = num("Free cash flow"); // $ millions
    const figure = solution.match(/figure: "\$([\d.]+)B"/);
    expect(figure).toBeTruthy();
    expect(Number(figure![1])).toBeCloseTo(fcf / 1000, 1);
  });

  it("the panel's FY25 free cash flow bar is the traced number", () => {
    const fcf = num("Free cash flow") / 1000;
    const fy25 = solution.match(/fy: "FY25", revenue: [\d.]+, fcf: ([\d.]+)/);
    expect(fy25).toBeTruthy();
    expect(Number(fy25![1])).toBeCloseTo(fcf, 1);
  });
});
