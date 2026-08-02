/**
 * IC Report — deterministic valuation engine (Phase 2 rebuild).
 *
 * Architectural rule, non-negotiable: the LLM proposes and justifies INPUTS
 * only (growth, fade, WACC components, terminal growth, exit multiples, peer
 * multiples). ALL arithmetic lives here, in plain TypeScript, fully unit
 * tested. A validation boundary (`validateDcfInputs`, `validateProposal` in
 * valuation-inputs.ts) sits between the model and this maths. The LLM never
 * emits a price target, an intrinsic value or an upside percentage.
 *
 * Every intermediate is inspectable: per-year rows, discount factors, both
 * terminal-value constructions, and the full enterprise-to-equity bridge.
 */

/* ── Input types ────────────────────────────────────────────────────────── */

export interface WaccComponents {
  riskFree: number;
  equityRiskPremium: number;
  beta: number;
  /** Pre-tax cost of debt. */
  costOfDebt: number;
  taxRate: number;
  /** D / (D + E), market values. */
  debtWeight: number;
}

/** WACC assembled from stated components — inspectable, reproducible. */
export function computeWaccFromComponents(c: WaccComponents): { wacc: number; costOfEquity: number } {
  const costOfEquity = c.riskFree + c.beta * c.equityRiskPremium;
  const afterTaxDebt = c.costOfDebt * (1 - c.taxRate);
  const wacc = costOfEquity * (1 - c.debtWeight) + afterTaxDebt * c.debtWeight;
  return { wacc, costOfEquity };
}

export interface DcfInputs {
  /** Base free cash flow (most recent TTM), in trading-currency units. */
  baseFcf: number;
  netDebt: number;
  sharesOutstanding: number;
  /** Per-year growth fractions for the explicit period (built by buildFadePath). */
  growthPath: number[];
  terminalGrowth: number;
  wacc: number;
  waccComponents?: WaccComponents | null;
  /** Optional EV/FCF exit multiple for the terminal cross-check. */
  exitMultiple?: number | null;
  /** Justifications for any out-of-band input, keyed by field. */
  justifications?: Record<string, string>;
}

/**
 * Documented fade curve: linear fade from `startGrowth` to `terminalGrowth`
 * across `years` steps. Year 1 grows at startGrowth; the last explicit year
 * lands one step above terminal, so the handoff to perpetuity is smooth and
 * the path is monotonic toward terminal by construction.
 */
export function buildFadePath(startGrowth: number, terminalGrowth: number, years: number): number[] {
  const n = Math.max(1, Math.round(years));
  if (n === 1) return [startGrowth];
  const path: number[] = [];
  for (let i = 0; i < n; i++) {
    path.push(startGrowth + ((terminalGrowth - startGrowth) * i) / n);
  }
  return path;
}

/* ── Invariants (Phase 2.2) ─────────────────────────────────────────────── */

export interface InvariantViolation {
  invariant: string;
  detail: string;
  severity: "blocking" | "warning";
}

export const BANDS = {
  waccMin: 0.05,
  waccMax: 0.22,
  terminalGrowthMax: 0.05,
  terminalGrowthMin: -0.02,
  /** Terminal growth must sit at least this far below WACC. */
  terminalGap: 0.005,
  growthMin: -0.5,
  growthMax: 0.4,
  /** Growth above this requires an explicit justification. */
  growthJustifyAbove: 0.25,
  /**
   * Scenario per-share value must land within [1/x, x] of spot. Wide enough
   * for a genuine bear case on a richly priced name (−85% is a real scenario);
   * an NVDA-class 300x-spot "intrinsic value" is still two orders of magnitude
   * outside it.
   */
  spotSanityMultiple: 8,
  terminalShareWarn: 0.85,
  exitMultipleMin: 2,
  exitMultipleMax: 60,
} as const;

export function validateDcfInputs(inputs: DcfInputs, spot: number | null): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const { wacc, terminalGrowth, growthPath } = inputs;

  if (!(terminalGrowth < wacc - BANDS.terminalGap)) {
    v.push({
      invariant: "terminal growth < WACC",
      detail: `terminal growth ${(terminalGrowth * 100).toFixed(1)}% is not at least ${(BANDS.terminalGap * 100).toFixed(1)}pp below WACC ${(wacc * 100).toFixed(1)}% — perpetuity value is undefined or explosive`,
      severity: "blocking",
    });
  }
  if (terminalGrowth > BANDS.terminalGrowthMax || terminalGrowth < BANDS.terminalGrowthMin) {
    v.push({
      invariant: "terminal growth ceiling",
      detail: `terminal growth ${(terminalGrowth * 100).toFixed(1)}% outside [${BANDS.terminalGrowthMin * 100}%, ${BANDS.terminalGrowthMax * 100}%] — no business outgrows the economy forever`,
      severity: "blocking",
    });
  }
  if (wacc < BANDS.waccMin || wacc > BANDS.waccMax) {
    v.push({
      invariant: "WACC band",
      detail: `WACC ${(wacc * 100).toFixed(1)}% outside the defensible band [${BANDS.waccMin * 100}%, ${BANDS.waccMax * 100}%]`,
      severity: "blocking",
    });
  }
  for (const [i, g] of growthPath.entries()) {
    if (g < BANDS.growthMin || g > BANDS.growthMax) {
      v.push({
        invariant: "explicit growth band",
        detail: `year ${i + 1} growth ${(g * 100).toFixed(1)}% outside [${BANDS.growthMin * 100}%, ${BANDS.growthMax * 100}%]`,
        severity: "blocking",
      });
      break;
    }
  }
  const maxG = Math.max(...growthPath);
  if (maxG > BANDS.growthJustifyAbove && !inputs.justifications?.growth) {
    v.push({
      invariant: "extreme growth requires justification",
      detail: `peak growth ${(maxG * 100).toFixed(1)}% exceeds ${(BANDS.growthJustifyAbove * 100).toFixed(0)}% with no documented justification`,
      severity: "blocking",
    });
  }
  // Fade must be monotonic toward terminal: |g_i − terminal| non-increasing.
  for (let i = 1; i < growthPath.length; i++) {
    const prevGap = Math.abs(growthPath[i - 1] - inputs.terminalGrowth);
    const gap = Math.abs(growthPath[i] - inputs.terminalGrowth);
    if (gap > prevGap + 1e-9) {
      v.push({
        invariant: "monotonic fade",
        detail: `growth path moves away from terminal growth at year ${i + 1} (${(growthPath[i - 1] * 100).toFixed(1)}% → ${(growthPath[i] * 100).toFixed(1)}%, terminal ${(inputs.terminalGrowth * 100).toFixed(1)}%)`,
        severity: "blocking",
      });
      break;
    }
  }
  if (inputs.exitMultiple != null && (inputs.exitMultiple < BANDS.exitMultipleMin || inputs.exitMultiple > BANDS.exitMultipleMax)) {
    v.push({
      invariant: "exit multiple band",
      detail: `exit EV/FCF multiple ${inputs.exitMultiple.toFixed(1)}x outside [${BANDS.exitMultipleMin}x, ${BANDS.exitMultipleMax}x]`,
      severity: "blocking",
    });
  }
  if (inputs.sharesOutstanding <= 0) {
    v.push({ invariant: "share count", detail: "shares outstanding must be positive", severity: "blocking" });
  }
  if (inputs.baseFcf <= 0) {
    v.push({
      invariant: "positive base cash flow",
      detail: "base FCF is zero or negative — a growth-and-fade DCF on today's FCF is not meaningful; use the loss-maker path (reverse DCF on required future FCF, or relative methods)",
      severity: "blocking",
    });
  }
  void spot;
  return v;
}

/* ── DCF core ───────────────────────────────────────────────────────────── */

export interface DcfYearRow {
  year: number;
  growth: number;
  fcf: number;
  discountFactor: number;
  pv: number;
}

export interface DcfResult {
  rows: DcfYearRow[];
  pvExplicit: number;
  /** Terminal value by perpetuity growth (undiscounted, at end of explicit period). */
  terminalValuePerp: number;
  pvTerminalPerp: number;
  /** Terminal value by exit multiple, when one was proposed. */
  terminalValueExit: number | null;
  pvTerminalExit: number | null;
  /** EV uses the perpetuity terminal; the exit multiple is a cross-check. */
  enterpriseValue: number;
  netDebt: number;
  equityValue: number;
  perShare: number;
  /** Per-share value if the exit-multiple terminal is used instead. */
  perShareExit: number | null;
  terminalShare: number;
  vsSpot: number | null;
}

export function runDcf(inputs: DcfInputs, spot: number | null): DcfResult {
  const { baseFcf, netDebt, sharesOutstanding, growthPath, terminalGrowth, wacc } = inputs;

  const rows: DcfYearRow[] = [];
  let fcf = baseFcf;
  let pvExplicit = 0;
  for (let i = 0; i < growthPath.length; i++) {
    fcf *= 1 + growthPath[i];
    const discountFactor = 1 / Math.pow(1 + wacc, i + 1);
    const pv = fcf * discountFactor;
    pvExplicit += pv;
    rows.push({ year: i + 1, growth: growthPath[i], fcf, discountFactor, pv });
  }

  const lastRow = rows[rows.length - 1];
  const terminalValuePerp = (lastRow.fcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const pvTerminalPerp = terminalValuePerp * lastRow.discountFactor;

  const terminalValueExit = inputs.exitMultiple != null ? lastRow.fcf * inputs.exitMultiple : null;
  const pvTerminalExit = terminalValueExit != null ? terminalValueExit * lastRow.discountFactor : null;

  const enterpriseValue = pvExplicit + pvTerminalPerp;
  const equityValue = enterpriseValue - netDebt;
  const perShare = equityValue / sharesOutstanding;
  const perShareExit = pvTerminalExit != null
    ? (pvExplicit + pvTerminalExit - netDebt) / sharesOutstanding
    : null;

  return {
    rows,
    pvExplicit,
    terminalValuePerp,
    pvTerminalPerp,
    terminalValueExit,
    pvTerminalExit,
    enterpriseValue,
    netDebt,
    equityValue,
    perShare,
    perShareExit,
    terminalShare: pvTerminalPerp / enterpriseValue,
    vsSpot: spot != null && spot > 0 ? perShare / spot - 1 : null,
  };
}

/** Sum-of-parts reconciliation (tested directly, not via snapshots). */
export function reconcileDcf(r: DcfResult): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const tol = Math.max(Math.abs(r.enterpriseValue) * 1e-9, 1e-6);
  const evFromParts = r.pvExplicit + r.pvTerminalPerp;
  if (Math.abs(evFromParts - r.enterpriseValue) > tol) {
    v.push({ invariant: "EV = PV(explicit) + PV(terminal)", detail: `${evFromParts} ≠ ${r.enterpriseValue}`, severity: "blocking" });
  }
  const equityFromBridge = r.enterpriseValue - r.netDebt;
  if (Math.abs(equityFromBridge - r.equityValue) > tol) {
    v.push({ invariant: "equity = EV − net debt", detail: `${equityFromBridge} ≠ ${r.equityValue}`, severity: "blocking" });
  }
  const rowSum = r.rows.reduce((acc, row) => acc + row.pv, 0);
  if (Math.abs(rowSum - r.pvExplicit) > tol) {
    v.push({ invariant: "Σ row PVs = PV(explicit)", detail: `${rowSum} ≠ ${r.pvExplicit}`, severity: "blocking" });
  }
  return v;
}

/* ── Scenarios ──────────────────────────────────────────────────────────── */

export interface ScenarioResult {
  label: "bear" | "base" | "bull";
  inputs: DcfInputs;
  result: DcfResult;
  violations: InvariantViolation[];
}

export interface ScenarioSetResult {
  bear: ScenarioResult;
  base: ScenarioResult;
  bull: ScenarioResult;
  /** Cross-scenario invariants: ordering and spot sanity. */
  violations: InvariantViolation[];
}

export function runScenarios(
  base: DcfInputs,
  spot: number | null,
  deltas: { bearGrowthDelta: number; bullGrowthDelta: number; bearWaccDelta?: number; bullWaccDelta?: number },
): ScenarioSetResult {
  // Scenario construction: shifted growth is clamped into the hard band and
  // carries an automatic justification documenting the construction — the
  // deltas themselves were validated at the input boundary, so a bull shift of
  // an already-justified base must not re-trip the justification invariant.
  const shift = (inputs: DcfInputs, gDelta: number, wDelta: number): DcfInputs => {
    const g = Math.min(BANDS.growthMax, Math.max(BANDS.growthMin, inputs.growthPath[0] + gDelta));
    // The shifted WACC stays inside the band and strictly above terminal
    // growth — a bull shift on a base WACC near the floor must not walk the
    // scenario out of its own invariants.
    const wacc = Math.min(
      BANDS.waccMax,
      Math.max(BANDS.waccMin, Math.max(inputs.terminalGrowth + BANDS.terminalGap + 1e-6, inputs.wacc + wDelta)),
    );
    return {
      ...inputs,
      growthPath: buildFadePath(g, inputs.terminalGrowth, inputs.growthPath.length),
      wacc,
      justifications: {
        ...inputs.justifications,
        growth: inputs.justifications?.growth
          ?? `scenario construction: base growth shifted ${(gDelta * 100).toFixed(1)}pp`,
      },
    };
  };

  const mk = (label: ScenarioResult["label"], inputs: DcfInputs): ScenarioResult => {
    const violations = validateDcfInputs(inputs, spot);
    const result = runDcf(inputs, spot);
    violations.push(...reconcileDcf(result));
    return { label, inputs, result, violations };
  };

  const bear = mk("bear", shift(base, -Math.abs(deltas.bearGrowthDelta), Math.abs(deltas.bearWaccDelta ?? 0)));
  const baseR = mk("base", base);
  const bull = mk("bull", shift(base, Math.abs(deltas.bullGrowthDelta), -Math.abs(deltas.bullWaccDelta ?? 0)));

  const violations: InvariantViolation[] = [];
  if (!(bear.result.perShare < baseR.result.perShare && baseR.result.perShare < bull.result.perShare)) {
    violations.push({
      invariant: "bear < base < bull",
      detail: `per-share values ${bear.result.perShare.toFixed(2)} / ${baseR.result.perShare.toFixed(2)} / ${bull.result.perShare.toFixed(2)} are not strictly ordered`,
      severity: "blocking",
    });
  }
  if (spot != null && spot > 0) {
    for (const s of [bear, baseR, bull]) {
      const ratio = s.result.perShare / spot;
      // Upside beyond the band is a broken model (units, compounding) and
      // blocks. Downside beyond the band is a warning, not a block: a
      // conservative DCF on a name priced for growth outside the defensible
      // band legitimately lands far below spot — the reverse DCF beside it
      // explains the gap. Blocking that would mute exactly the report an IC
      // most needs to see.
      if (ratio > BANDS.spotSanityMultiple) {
        violations.push({
          invariant: "scenario within sane multiple of spot",
          detail: `${s.label} value ${s.result.perShare.toFixed(2)} is ${ratio.toFixed(1)}x spot — above ${BANDS.spotSanityMultiple}x; this is a validation failure, not a result`,
          severity: "blocking",
        });
      } else if (ratio < 1 / BANDS.spotSanityMultiple) {
        violations.push({
          invariant: "scenario far below spot",
          detail: `${s.label} value ${s.result.perShare.toFixed(2)} is ${(ratio * 100).toFixed(0)}% of spot — either the market prices growth outside the defensible band (see reverse DCF) or an input is wrong`,
          severity: "warning",
        });
      }
    }
  }
  for (const s of [bear, baseR, bull]) {
    if (s.result.terminalShare > BANDS.terminalShareWarn) {
      violations.push({
        invariant: "terminal value share",
        detail: `${s.label}: terminal value carries ${(s.result.terminalShare * 100).toFixed(0)}% of EV (> ${(BANDS.terminalShareWarn * 100).toFixed(0)}%) — the answer is mostly assumption`,
        severity: "warning",
      });
    }
  }
  return { bear, base: baseR, bull, violations };
}

/* ── Reverse DCF (Phase 2.8) ────────────────────────────────────────────── */

export interface ReverseDcfResult {
  /** Stage-1 growth implied by spot, holding fade shape, WACC and terminal fixed. */
  impliedGrowth: number | null;
  /** Years of stage-1 growth spot implies at the base growth rate (alternative view). */
  impliedYearsAtBaseGrowth: number | null;
  converged: boolean;
}

export function reverseDcf(base: DcfInputs, spot: number): ReverseDcfResult {
  if (!(spot > 0) || base.sharesOutstanding <= 0 || base.baseFcf <= 0) {
    return { impliedGrowth: null, impliedYearsAtBaseGrowth: null, converged: false };
  }
  const perShareAt = (g: number): number => {
    const inputs: DcfInputs = {
      ...base,
      growthPath: buildFadePath(g, base.terminalGrowth, base.growthPath.length),
    };
    return runDcf(inputs, spot).perShare;
  };

  // Bisection on stage-1 growth in [-0.9, 3.0] — value is monotonic in growth.
  let lo = -0.9;
  let hi = 3.0;
  if (perShareAt(lo) > spot || perShareAt(hi) < spot) {
    return { impliedGrowth: null, impliedYearsAtBaseGrowth: null, converged: false };
  }
  let impliedGrowth: number | null = null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (perShareAt(mid) < spot) lo = mid;
    else hi = mid;
  }
  impliedGrowth = (lo + hi) / 2;

  // Alternative framing: how many years of stage-1 growth (before fade) does
  // spot imply at the proposed base growth rate?
  let impliedYears: number | null = null;
  const g0 = base.growthPath[0];
  if (g0 > base.terminalGrowth + 1e-4) {
    for (let years = 1; years <= 30; years++) {
      const inputs: DcfInputs = {
        ...base,
        growthPath: [...Array<number>(years).fill(g0), ...buildFadePath(g0, base.terminalGrowth, 5).slice(1)],
      };
      if (runDcf(inputs, spot).perShare >= spot) { impliedYears = years; break; }
    }
  }

  return { impliedGrowth, impliedYearsAtBaseGrowth: impliedYears, converged: true };
}

/* ── Sensitivity (Phase 2.9) ────────────────────────────────────────────── */

export interface SensitivityGrid {
  waccValues: number[];
  terminalGrowthValues: number[];
  /** perShare[waccIndex][terminalIndex]; null where terminal ≥ wacc. */
  perShare: (number | null)[][];
}

export interface SensitivityResult {
  grid: SensitivityGrid;
  /** Reverse-DCF breakeven stage-1 growth at spot. */
  breakevenGrowth: number | null;
  drivers: {
    growthPlus1pp: number;
    waccPlus1pp: number;
    terminalPlus50bp: number;
  };
}

export function computeSensitivity(base: DcfInputs, spot: number | null): SensitivityResult {
  const waccValues = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => base.wacc + d);
  const terminalGrowthValues = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => base.terminalGrowth + d);
  const perShare: (number | null)[][] = waccValues.map((w) =>
    terminalGrowthValues.map((t) => {
      if (t >= w - BANDS.terminalGap) return null;
      return runDcf({ ...base, wacc: w, terminalGrowth: t }, spot).perShare;
    }),
  );

  const baseValue = runDcf(base, spot).perShare;
  const at = (mod: Partial<DcfInputs>): number => runDcf({ ...base, ...mod }, spot).perShare;

  return {
    grid: { waccValues, terminalGrowthValues, perShare },
    breakevenGrowth: spot != null && spot > 0 ? reverseDcf(base, spot).impliedGrowth : null,
    drivers: {
      growthPlus1pp:
        at({ growthPath: buildFadePath(base.growthPath[0] + 0.01, base.terminalGrowth, base.growthPath.length) }) - baseValue,
      waccPlus1pp: at({ wacc: base.wacc + 0.01 }) - baseValue,
      terminalPlus50bp:
        base.terminalGrowth + 0.005 < base.wacc - BANDS.terminalGap
          ? at({ terminalGrowth: base.terminalGrowth + 0.005 }) - baseValue
          : 0,
    },
  };
}

/* ── Relative methods (Phase 2.4) — deterministic, tied to stated inputs ── */

export type RelativeMethodKind = "pe" | "ev_ebitda" | "fcf_yield" | "p_s" | "p_b";

export interface RelativeMethodInput {
  kind: RelativeMethodKind;
  /** Proposed multiple (or required yield, as a fraction, for fcf_yield). */
  multiple: number;
  /** The canonical metric the multiple applies to (per-company units). */
  metricValue: number;
  /** Provenance label for the metric, e.g. "EPS (TTM, derived spot ÷ trailing P/E)". */
  metricLabel: string;
  /** Needed for EV-based methods to bridge back to equity. */
  netDebt?: number;
  sharesOutstanding: number;
  /** Why this multiple: peer set / historical band. Carried into the report. */
  rationale: string;
}

export interface RelativeMethodResult {
  kind: RelativeMethodKind;
  label: string;
  perShare: number;
  /** Deterministic recomputation string: "23.0x × $6.42 = $147.66". */
  workings: string;
  inputs: RelativeMethodInput;
}

const METHOD_LABELS: Record<RelativeMethodKind, string> = {
  pe: "Relative P/E",
  ev_ebitda: "EV/EBITDA",
  fcf_yield: "FCF yield",
  p_s: "Price/Sales",
  p_b: "Price/Book",
};

export function runRelativeMethod(input: RelativeMethodInput): RelativeMethodResult {
  const { kind, multiple, metricValue, sharesOutstanding } = input;
  let perShare: number;
  let workings: string;
  switch (kind) {
    case "pe":
    case "p_b": {
      // metricValue is per-share (EPS or BVPS)
      perShare = multiple * metricValue;
      workings = `${multiple.toFixed(1)}x × ${metricValue.toFixed(2)} = ${perShare.toFixed(2)}`;
      break;
    }
    case "p_s": {
      // metricValue is total revenue; equity = multiple × revenue
      perShare = (multiple * metricValue) / sharesOutstanding;
      workings = `${multiple.toFixed(1)}x × ${metricValue.toExponential(3)} ÷ ${sharesOutstanding.toExponential(3)} = ${perShare.toFixed(2)}`;
      break;
    }
    case "ev_ebitda": {
      const netDebt = input.netDebt ?? 0;
      const ev = multiple * metricValue;
      perShare = (ev - netDebt) / sharesOutstanding;
      workings = `${multiple.toFixed(1)}x × ${metricValue.toExponential(3)} − netDebt ${netDebt.toExponential(3)} ÷ ${sharesOutstanding.toExponential(3)} = ${perShare.toFixed(2)}`;
      break;
    }
    case "fcf_yield": {
      // metricValue is equity FCF; multiple is the REQUIRED YIELD as a fraction
      const equity = metricValue / multiple;
      perShare = equity / sharesOutstanding;
      workings = `${metricValue.toExponential(3)} ÷ ${(multiple * 100).toFixed(1)}% ÷ ${sharesOutstanding.toExponential(3)} = ${perShare.toFixed(2)}`;
      break;
    }
  }
  return { kind, label: METHOD_LABELS[kind], perShare, workings, inputs: input };
}

/* ── Confidence-weighted blending (Phase 2.10) ─────────────────────────── */

export interface BlendComponent {
  label: string;
  perShare: number;
  weight: number;
  rationale: string;
}

export interface BlendResult {
  perShare: number;
  components: BlendComponent[];
}

export function blendValues(components: BlendComponent[]): BlendResult | null {
  const usable = components.filter((c) => Number.isFinite(c.perShare) && c.perShare > 0 && c.weight > 0);
  if (usable.length === 0) return null;
  const totalW = usable.reduce((a, c) => a + c.weight, 0);
  const normalised = usable.map((c) => ({ ...c, weight: c.weight / totalW }));
  return {
    perShare: normalised.reduce((a, c) => a + c.perShare * c.weight, 0),
    components: normalised,
  };
}
