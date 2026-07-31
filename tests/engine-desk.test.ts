import { describe, expect, it } from "vitest";
import {
  FACTOR_META,
  REGIME_COLOR,
  REGIME_ORDER,
  SIGNAL_LABEL,
  SIGNAL_ORDER,
  WEIGHTED_FACTORS,
  describeEngineError,
  isDashboardEmpty,
  scoreKey,
  signalTone,
  type DashboardResponse,
} from "@/lib/engine-desk";

describe("engine desk vocabulary", () => {
  it("maps every weighted factor to its scorecard column", () => {
    // The desk reads factor z-scores off scorecard rows by derived key, so a
    // factor without a matching column would silently render as zero.
    const columns = WEIGHTED_FACTORS.map(scoreKey);
    expect(columns).toEqual([
      "momentum_score",
      "quality_score",
      "value_score",
      "low_vol_score",
      "revision_score",
      "regime_score",
      // mc_upside is stored under its own name, not suffixed.
      "mc_upside",
    ]);
  });

  it("documents every weighted factor with a label, description and formula", () => {
    // "Shows its working" is the desk's core claim; a factor missing its formula
    // would render an empty <code> block next to a number the user can't check.
    for (const factor of WEIGHTED_FACTORS) {
      const meta = FACTOR_META[factor];
      expect(meta, factor).toBeDefined();
      expect(meta.label.length, factor).toBeGreaterThan(0);
      expect(meta.desc.length, factor).toBeGreaterThan(0);
      expect(meta.formula.length, factor).toBeGreaterThan(0);
    }
  });

  it("gives every signal tier a label and a tone", () => {
    for (const signal of SIGNAL_ORDER) {
      expect(SIGNAL_LABEL[signal], signal).toBeTruthy();
      const tone = signalTone(signal);
      expect(tone.text, signal).toBeTruthy();
      expect(tone.chip, signal).toBeTruthy();
      expect(tone.bar, signal).toBeTruthy();
    }
  });

  it("falls back to the neutral tone for an unrecognised signal", () => {
    // The engine's signal strings come from Python; an added tier must degrade to
    // readable neutral styling rather than crash on an undefined lookup.
    expect(signalTone("SOMETHING_NEW")).toEqual(signalTone("HOLD"));
  });

  it("orders regimes best-to-worst and colours each one", () => {
    expect(REGIME_ORDER).toEqual(["Bull", "Recovery", "Range", "Bear", "Crash"]);
    for (const regime of REGIME_ORDER) {
      expect(REGIME_COLOR[regime], regime).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("isDashboardEmpty", () => {
  it("narrows an empty brief", () => {
    const res: DashboardResponse = { empty: true, reason: "No scorecard data yet." };
    expect(isDashboardEmpty(res)).toBe(true);
  });

  it("does not treat a populated brief as empty", () => {
    const res = { empty: false, n_symbols: 124 } as unknown as DashboardResponse;
    expect(isDashboardEmpty(res)).toBe(false);
  });

  it("treats a degraded brief as empty so the desk shows its explanation", () => {
    // A brief the route could not build inside its budget must route to the same
    // "explain why, offer a retry" path as a genuinely absent one — never a
    // half-rendered hero reading zeroes.
    const res: DashboardResponse = { empty: true, degraded: true, reason: "Timed out." };
    expect(isDashboardEmpty(res)).toBe(true);
  });
});

describe("describeEngineError", () => {
  const TRACEBACK = [
    "Traceback (most recent call last):",
    '  File "<frozen runpy>", line 203, in _run_module_as_main',
    '  File "/repo/engine/dashboard.py", line 34, in <module>',
    "    import duckdb",
    "ModuleNotFoundError: No module named 'duckdb'",
  ].join("\n");

  it("names the missing package and prescribes the venv fix", () => {
    const { summary, detail } = describeEngineError(TRACEBACK);
    expect(summary).toContain('"duckdb"');
    expect(summary).toContain("requirements.txt");
    // The raw traceback must survive — demoted to detail, never dropped.
    expect(detail).toBe(TRACEBACK);
  });

  it("reduces an arbitrary traceback to its exception line", () => {
    const raw = TRACEBACK.replace(
      "ModuleNotFoundError: No module named 'duckdb'",
      "duckdb.IOException: Conflicting lock on data/engine.duckdb",
    );
    const { summary, detail } = describeEngineError(raw);
    expect(summary).toContain("duckdb.IOException: Conflicting lock");
    expect(summary).not.toContain("_run_module_as_main");
    expect(detail).toBe(raw);
  });

  it("recognises a missing interpreter", () => {
    const { summary } = describeEngineError("spawn /repo/.venv/bin/python ENOENT");
    expect(summary).toContain("Python interpreter");
  });

  it("passes short human-authored messages through with no detail", () => {
    const msg = "Reading the scorecard snapshot timed out.";
    expect(describeEngineError(msg)).toEqual({ summary: msg, detail: null });
  });

  it("never returns an empty summary", () => {
    expect(describeEngineError("").summary.length).toBeGreaterThan(0);
    expect(describeEngineError(null).summary.length).toBeGreaterThan(0);
  });
});
