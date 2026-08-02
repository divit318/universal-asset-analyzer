/**
 * IC Report — valuation suite assembly (Phase 2.3/2.4/2.5/2.10).
 *
 * One engine feeds every view: the methods table, the scenario block, the
 * sensitivity grid, the reverse DCF and the headline all derive from the same
 * canonical facts and the same resolved input proposal, so they cannot
 * disagree with each other or with spot. Assumption prose is generated from
 * the structured inputs — the model never free-writes a number next to a
 * method it does not control.
 */

import type { CanonicalFacts } from "./canonical";
import {
  BANDS,
  buildFadePath,
  runDcf,
  runScenarios,
  reverseDcf,
  computeSensitivity,
  runRelativeMethod,
  validateDcfInputs,
  reconcileDcf,
  blendValues,
  type DcfInputs,
  type DcfResult,
  type ScenarioSetResult,
  type ReverseDcfResult,
  type SensitivityResult,
  type RelativeMethodResult,
  type RelativeMethodKind,
  type InvariantViolation,
  type BlendResult,
} from "./valuation-engine";
import type { ResolvedProposal } from "./valuation-inputs";
import { fmtPercent, fmtMultiple, fmtMoney, fmtMoneyCompact } from "./format";

/* ── Method applicability (Phase 4: financials, REITs, loss-makers) ────── */

export interface MethodApplicability {
  kind: RelativeMethodKind | "dcf";
  applicable: boolean;
  reason: string | null;
}

export interface CompanyProfile {
  isFinancial: boolean;
  isReit: boolean;
  hasPositiveFcf: boolean;
  hasPositiveEarnings: boolean;
  hasPositiveBook: boolean;
}

export function profileCompany(facts: CanonicalFacts, sector?: string | null, industry?: string | null): CompanyProfile {
  const sec = (sector ?? facts.sector ?? "").toLowerCase();
  const ind = (industry ?? facts.industry ?? "").toLowerCase();
  const isReit = ind.includes("reit") || sec.includes("real estate");
  const isFinancial = !isReit && (
    sec.includes("financial") || /bank|insurance|capital markets|credit services|asset management/.test(ind)
  );
  return {
    isFinancial,
    isReit,
    hasPositiveFcf: (facts.freeCashFlowTtm?.value ?? 0) > 0,
    hasPositiveEarnings: (facts.trailingPE?.value ?? -1) > 0,
    hasPositiveBook: (facts.priceToBook?.value ?? -1) > 0,
  };
}

export function methodApplicability(profile: CompanyProfile): MethodApplicability[] {
  const out: MethodApplicability[] = [];
  out.push({
    kind: "dcf",
    applicable: !profile.isFinancial && profile.hasPositiveFcf,
    reason: profile.isFinancial
      ? "free-cash-flow DCF is not meaningful for a financial institution (cash flow is working capital); P/E and P/B carry the weight instead"
      : !profile.hasPositiveFcf
        ? "base FCF is zero or negative: a growth-and-fade DCF has nothing to compound; see reverse DCF and relative methods"
        : null,
  });
  out.push({
    kind: "pe",
    applicable: profile.hasPositiveEarnings,
    reason: profile.hasPositiveEarnings ? null : "earnings are negative: a P/E target would be meaningless",
  });
  out.push({
    kind: "ev_ebitda",
    applicable: !profile.isFinancial && !profile.isReit,
    reason: profile.isFinancial
      ? "EBITDA and enterprise value are inappropriate for financial institutions"
      : profile.isReit
        ? "EV/EBITDA understates REIT economics (depreciation-heavy); P/B and yield methods are used instead"
        : null,
  });
  out.push({
    kind: "fcf_yield",
    applicable: profile.hasPositiveFcf && !profile.isFinancial,
    reason: profile.hasPositiveFcf
      ? (profile.isFinancial ? "FCF is not a meaningful concept for financials" : null)
      : "FCF is zero, negative, or unavailable",
  });
  out.push({
    kind: "p_b",
    applicable: profile.hasPositiveBook && (profile.isFinancial || profile.isReit),
    reason: !profile.hasPositiveBook
      ? "book equity is negative: P/B is meaningless"
      : profile.isFinancial || profile.isReit
        ? null
        : "P/B is only used where book value drives economics (financials, REITs)",
  });
  out.push({
    kind: "p_s",
    applicable: !profile.hasPositiveEarnings && !profile.isFinancial,
    reason: !profile.hasPositiveEarnings
      ? null
      : "P/S is a fallback for loss-makers; earnings-based methods dominate here",
  });
  return out;
}

/* ── Suite result ───────────────────────────────────────────────────────── */

export interface MethodEntry {
  kind: RelativeMethodKind | "dcf" | "analyst";
  label: string;
  applicable: boolean;
  notApplicableReason: string | null;
  perShare: number | null;
  vsSpot: number | null;
  /** Deterministic assumption prose generated from the structured inputs. */
  assumptions: string;
  workings: string | null;
  confidence: "high" | "medium" | "low";
  inputSource: "model" | "default";
  /**
   * "estimate": an independent view (DCF, required yield, model-proposed or
   * peer multiple, analyst consensus) — participates in the blend.
   * "anchor": reproduces the market's own current multiple — shown for
   * context, EXCLUDED from the blend (blending it would launder spot into
   * the headline and manufacture false agreement).
   */
  role: "estimate" | "anchor" | null;
}

export interface ValuationSuiteResult {
  currency: string;
  spot: number | null;
  asOf: string;
  promptVersion: string;
  modelProposedInputs: boolean;
  proposal: ResolvedProposal;
  wacc: { value: number; components: string };
  dcf: {
    ran: boolean;
    skippedReason: string | null;
    inputs: DcfInputs | null;
    base: DcfResult | null;
    scenarios: ScenarioSetResult | null;
  };
  reverse: ReverseDcfResult | null;
  sensitivity: SensitivityResult | null;
  methods: MethodEntry[];
  blend: BlendResult | null;
  headline: { perShare: number; vsSpot: number | null } | null;
  /** Blocking violations empty ⇒ renderable. Never render numbers past a blocker. */
  blockingViolations: InvariantViolation[];
  warnings: InvariantViolation[];
}

const clampWeight: Record<string, number> = { dcf: 0.4, pe: 0.25, ev_ebitda: 0.2, fcf_yield: 0.15, p_b: 0.3, p_s: 0.2, analyst: 0.15 };

export interface SuiteContext {
  facts: CanonicalFacts;
  proposal: ResolvedProposal;
  /** Platform WACC (fraction) with a component description, from lib/valuation/prefill. */
  wacc: { value: number; components: string };
  sector?: string | null;
  industry?: string | null;
}

export function assembleValuationSuite(ctx: SuiteContext): ValuationSuiteResult {
  const { facts, proposal } = ctx;
  const spot = facts.spot?.value ?? null;
  const currency = facts.currency;

  const blockingViolations: InvariantViolation[] = [];
  const warnings: InvariantViolation[] = [];
  const push = (vs: InvariantViolation[]) => {
    for (const v of vs) (v.severity === "blocking" ? blockingViolations : warnings).push(v);
  };

  // Platform WACC arrives from CAPM inputs that can drift out of the
  // defensible band (a 0.13 beta produces a 5.0% WACC); clamp to the band
  // edge with an audit note instead of blocking the whole valuation on an
  // upstream input.
  const rawWacc = ctx.wacc.value + proposal.waccAdjustmentBp.value / 10_000;
  const wacc = Math.min(BANDS.waccMax, Math.max(BANDS.waccMin, rawWacc));
  if (wacc !== rawWacc) {
    warnings.push({
      invariant: "WACC band (input clamped)",
      detail: `platform WACC ${(rawWacc * 100).toFixed(1)}% sits outside the defensible band [${BANDS.waccMin * 100}%, ${BANDS.waccMax * 100}%]; clamped to ${(wacc * 100).toFixed(1)}%`,
      severity: "warning",
    });
  }

  const profile = profileCompany(facts, ctx.sector, ctx.industry);
  const applicability = methodApplicability(profile);
  const applicableOf = (kind: MethodApplicability["kind"]) => applicability.find((a) => a.kind === kind)!;

  /* ── DCF ── */
  const dcfApp = applicableOf("dcf");
  let dcfInputs: DcfInputs | null = null;
  let dcfBase: DcfResult | null = null;
  let scenarios: ScenarioSetResult | null = null;
  let reverse: ReverseDcfResult | null = null;
  let sensitivity: SensitivityResult | null = null;

  if (dcfApp.applicable && facts.freeCashFlowTtm && facts.sharesOutstanding) {
    dcfInputs = {
      baseFcf: facts.freeCashFlowTtm.value,
      netDebt: facts.netDebt?.value ?? 0,
      sharesOutstanding: facts.sharesOutstanding.value,
      growthPath: buildFadePath(proposal.growthY1.value, proposal.terminalGrowth.value, proposal.fadeYears.value),
      terminalGrowth: proposal.terminalGrowth.value,
      wacc,
      exitMultiple: proposal.exitMultiple.value,
      justifications: proposal.growthY1.justification ? { growth: proposal.growthY1.justification } : undefined,
    };
    const inputViolations = validateDcfInputs(dcfInputs, spot);
    push(inputViolations);
    if (inputViolations.every((v) => v.severity !== "blocking")) {
      dcfBase = runDcf(dcfInputs, spot);
      push(reconcileDcf(dcfBase));
      scenarios = runScenarios(dcfInputs, spot, {
        bearGrowthDelta: proposal.bearGrowthDelta.value,
        bullGrowthDelta: proposal.bullGrowthDelta.value,
        bearWaccDelta: 0.01,
        bullWaccDelta: 0.005,
      });
      push(scenarios.violations);
      for (const s of [scenarios.bear, scenarios.base, scenarios.bull]) push(s.violations);
      sensitivity = computeSensitivity(dcfInputs, spot);
      if (spot != null) reverse = reverseDcf(dcfInputs, spot);
    }
  } else if (dcfApp.applicable && !facts.freeCashFlowTtm) {
    dcfApp.applicable = false;
    dcfApp.reason = "free cash flow is not available from the provider";
  }

  /* ── Relative methods: metrics derived from canonical facts ── */
  const methods: MethodEntry[] = [];
  const shares = facts.sharesOutstanding?.value ?? null;

  const addMethod = (
    kind: RelativeMethodKind,
    multiple: number | null,
    inputSource: "model" | "default",
    metric: { value: number; label: string } | null,
    opts: { netDebt?: number; confidence: MethodEntry["confidence"]; rationale: string; role: "estimate" | "anchor" },
  ) => {
    const app = applicableOf(kind);
    if (!app.applicable) {
      methods.push({
        kind, label: labelFor(kind), applicable: false, notApplicableReason: app.reason,
        perShare: null, vsSpot: null, assumptions: app.reason ?? "not applicable",
        workings: null, confidence: "low", inputSource, role: null,
      });
      return;
    }
    if (multiple == null || metric == null || shares == null || metric.value <= 0) {
      methods.push({
        kind, label: labelFor(kind), applicable: false,
        notApplicableReason: multiple == null
          ? "no defensible multiple available"
          : metric != null && metric.value <= 0
            ? `${metric.label} is zero or negative: a positive multiple on a negative metric is meaningless`
            : "required metric unavailable",
        perShare: null, vsSpot: null, assumptions: "input unavailable", workings: null, confidence: "low", inputSource, role: null,
      });
      return;
    }
    const res: RelativeMethodResult = runRelativeMethod({
      kind, multiple, metricValue: metric.value, metricLabel: metric.label,
      netDebt: opts.netDebt, sharesOutstanding: shares, rationale: opts.rationale,
    });
    methods.push({
      kind,
      label: res.label,
      applicable: true,
      notApplicableReason: null,
      perShare: res.perShare,
      vsSpot: spot != null && spot > 0 ? res.perShare / spot - 1 : null,
      assumptions: assumptionProse(kind, multiple, metric, opts.rationale, currency, opts.netDebt)
        + (opts.role === "anchor" ? " Anchor: this reproduces the market's own current multiple, so it is shown for context and excluded from the blend." : ""),
      workings: res.workings,
      confidence: opts.confidence,
      inputSource,
      role: opts.role,
    });
  };

  // Metrics derived to stay arithmetically consistent with quoted multiples.
  const epsTtm = spot != null && facts.trailingPE?.value != null && facts.trailingPE.value > 0
    ? { value: spot / facts.trailingPE.value, label: "EPS (TTM, spot ÷ trailing P/E)" }
    : null;
  const bvps = spot != null && facts.priceToBook?.value != null && facts.priceToBook.value !== 0
    ? { value: spot / facts.priceToBook.value, label: "book value per share (spot ÷ P/B)" }
    : null;
  const revenueTotal = facts.marketCap?.value != null && facts.priceToSales?.value != null && facts.priceToSales.value > 0
    ? { value: facts.marketCap.value / facts.priceToSales.value, label: "revenue (TTM, marketCap ÷ P/S)" }
    : null;
  const ebitda = facts.ebitdaTtm ? { value: facts.ebitdaTtm.value, label: "EBITDA (TTM)" } : null;
  const fcf = facts.freeCashFlowTtm ? { value: facts.freeCashFlowTtm.value, label: "FCF (TTM)" } : null;

  // Rationale must describe who actually chose the input: a model-proposed
  // multiple that arrived without a justification says so, instead of
  // borrowing the default's description.
  const rationaleFor = (field: { source: "model" | "default"; justification?: string }, defaultText: string): string =>
    field.justification ?? (field.source === "model" ? "model-proposed multiple (no justification supplied)" : defaultText);

  addMethod("pe", proposal.peMultiple.value, proposal.peMultiple.source, epsTtm, {
    confidence: "medium",
    rationale: rationaleFor(proposal.peMultiple, "own forward multiple held (default)"),
    role: proposal.peMultiple.source === "model" ? "estimate" : "anchor",
  });
  addMethod("ev_ebitda", proposal.evEbitdaMultiple.value, proposal.evEbitdaMultiple.source, ebitda, {
    netDebt: facts.netDebt?.value ?? 0,
    confidence: facts.netDebt ? "medium" : "low",
    rationale: rationaleFor(proposal.evEbitdaMultiple, "current EV/EBITDA held (default)"),
    role: proposal.evEbitdaMultiple.source === "model" ? "estimate" : "anchor",
  });
  addMethod("fcf_yield", proposal.fcfRequiredYield.value, proposal.fcfRequiredYield.source, fcf, {
    confidence: "medium",
    rationale: rationaleFor(proposal.fcfRequiredYield, "4% required equity FCF yield (default)"),
    role: "estimate", // a required yield is an independent view even when defaulted
  });
  addMethod("p_b", facts.priceToBook?.value != null ? facts.priceToBook.value : null, "default", bvps, {
    confidence: "low",
    rationale: "current P/B held",
    role: "anchor",
  });
  addMethod("p_s", facts.priceToSales?.value != null ? facts.priceToSales.value : null, "default", revenueTotal, {
    confidence: "low",
    rationale: "current P/S held",
    role: "anchor",
  });

  // Analyst consensus target: an external estimate with real provenance.
  const analyst = facts.analyst;
  if (analyst && analyst.targetMean != null && (analyst.numberOfOpinions ?? 0) >= 3) {
    methods.push({
      kind: "analyst",
      label: "Analyst consensus",
      applicable: true,
      notApplicableReason: null,
      perShare: analyst.targetMean,
      vsSpot: spot != null && spot > 0 ? analyst.targetMean / spot - 1 : null,
      assumptions: `Mean of ${analyst.numberOfOpinions} analyst price targets (low ${fmtMoney(analyst.targetLow, currency)}, high ${fmtMoney(analyst.targetHigh, currency)}), as of ${analyst.asOf.slice(0, 10)}.`,
      workings: `mean target as reported by provider`,
      confidence: (analyst.numberOfOpinions ?? 0) >= 10 ? "medium" : "low",
      inputSource: "default",
      role: "estimate",
    });
  } else {
    methods.push({
      kind: "analyst",
      label: "Analyst consensus",
      applicable: false,
      notApplicableReason: analyst && (analyst.numberOfOpinions ?? 0) > 0
        ? "fewer than 3 analyst targets: too thin to treat as an estimate"
        : "no analyst coverage reported for this name",
      perShare: null,
      vsSpot: null,
      assumptions: "not available",
      workings: null,
      confidence: "low",
      inputSource: "default",
      role: null,
    });
  }

  // DCF as a method entry for the blend/table.
  methods.unshift({
    kind: "dcf",
    label: "DCF (fade to terminal)",
    applicable: dcfBase != null,
    notApplicableReason: dcfBase == null ? (dcfApp.reason ?? "blocked by input validation") : null,
    perShare: dcfBase?.perShare ?? null,
    vsSpot: dcfBase?.vsSpot ?? null,
    assumptions: dcfInputs
      ? dcfAssumptionProse(dcfInputs, proposal, wacc)
      : dcfApp.reason ?? "not run",
    workings: dcfBase
      ? `PV(explicit ${dcfInputs!.growthPath.length}y) ${fmtMoneyCompact(dcfBase.pvExplicit, currency)} + PV(terminal) ${fmtMoneyCompact(dcfBase.pvTerminalPerp, currency)} − net debt ${fmtMoneyCompact(dcfBase.netDebt, currency)} = equity ${fmtMoneyCompact(dcfBase.equityValue, currency)} over ${(facts.sharesOutstanding?.value ?? 0).toExponential(3)} shares`
      : null,
    confidence: dcfBase != null && (dcfBase.terminalShare <= 0.85) ? "medium" : "low",
    inputSource: proposal.growthY1.source,
    role: dcfBase != null ? "estimate" : null,
  });

  /* ── Blend (Phase 2.10): estimates only — anchors would launder spot in ── */
  const blend = blendValues(
    methods
      .filter((m) => m.applicable && m.role === "estimate" && m.perShare != null && m.perShare > 0)
      .map((m) => ({
        label: m.label,
        perShare: m.perShare!,
        weight: (clampWeight[m.kind] ?? 0.1) * (m.confidence === "high" ? 1.2 : m.confidence === "low" ? 0.6 : 1),
        rationale: m.kind === "dcf"
          ? "primary method: full cash-flow model with inspected assumptions"
          : `cross-check: ${m.assumptions.split(".")[0]}`,
      })),
  );

  const headline = blend && blockingViolations.length === 0
    ? { perShare: blend.perShare, vsSpot: spot != null && spot > 0 ? blend.perShare / spot - 1 : null }
    : null;

  return {
    currency,
    spot,
    asOf: facts.asOf,
    promptVersion: proposal.promptVersion,
    modelProposedInputs: !proposal.modelUnavailable,
    proposal,
    wacc: { value: wacc, components: ctx.wacc.components },
    dcf: {
      ran: dcfBase != null,
      skippedReason: dcfBase == null ? (dcfApp.reason ?? "blocked by input validation: see violations") : null,
      inputs: dcfInputs,
      base: dcfBase,
      scenarios,
    },
    reverse,
    sensitivity,
    methods,
    blend,
    headline,
    blockingViolations,
    warnings,
  };
}

/* ── Deterministic assumption prose (Phase 2.5) ─────────────────────────── */

function labelFor(kind: RelativeMethodKind): string {
  return { pe: "Relative P/E", ev_ebitda: "EV/EBITDA", fcf_yield: "FCF yield", p_s: "Price/Sales", p_b: "Price/Book" }[kind];
}

function assumptionProse(
  kind: RelativeMethodKind,
  multiple: number,
  metric: { value: number; label: string },
  rationale: string,
  currency: string,
  netDebt?: number,
): string {
  switch (kind) {
    case "pe":
      return `${fmtMultiple(multiple)} applied to ${metric.label} of ${fmtMoney(metric.value, currency)}. Basis: ${rationale}`;
    case "p_b":
      return `${fmtMultiple(multiple)} applied to ${metric.label} of ${fmtMoney(metric.value, currency)}. Basis: ${rationale}`;
    case "p_s":
      return `${fmtMultiple(multiple)} applied to ${metric.label} of ${fmtMoneyCompact(metric.value, currency)}. Basis: ${rationale}`;
    case "ev_ebitda":
      return `${fmtMultiple(multiple)} applied to ${metric.label} of ${fmtMoneyCompact(metric.value, currency)}, less net debt of ${fmtMoneyCompact(netDebt ?? 0, currency)}. Basis: ${rationale}`;
    case "fcf_yield":
      return `${fmtPercent(multiple)} required yield on ${metric.label} of ${fmtMoneyCompact(metric.value, currency)}. Basis: ${rationale}`;
  }
}

function dcfAssumptionProse(inputs: DcfInputs, proposal: ResolvedProposal, wacc: number): string {
  const src = proposal.growthY1.source === "model" ? "model-proposed" : "history-derived default";
  const parts = [
    `Stage-1 FCF growth ${fmtPercent(inputs.growthPath[0])} (${src}), fading linearly to terminal ${fmtPercent(inputs.terminalGrowth)} over ${inputs.growthPath.length} years.`,
    `WACC ${fmtPercent(wacc)}${proposal.waccAdjustmentBp.value !== 0 ? ` (incl. ${proposal.waccAdjustmentBp.value}bp model adjustment)` : ""}.`,
    inputs.exitMultiple != null ? `Terminal cross-check at ${fmtMultiple(inputs.exitMultiple)} EV/FCF.` : "Terminal by perpetuity growth.",
  ];
  if (proposal.growthY1.justification) parts.push(`Justification: ${proposal.growthY1.justification}`);
  if (proposal.growthY1.rejectedValue != null) {
    parts.push(`A model proposal of ${fmtPercent(proposal.growthY1.rejectedValue)} was rejected (${proposal.growthY1.rejectionReason}).`);
  }
  return parts.join(" ");
}
