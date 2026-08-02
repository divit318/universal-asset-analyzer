/**
 * IC Report — Markdown export (schemaVersion 2).
 *
 * Pure function: ICReport in, GitHub-flavoured Markdown out, with full parity
 * to the report object. Every number and date is rendered through
 * lib/ic/format.ts; missing data renders as an explicit "not available"
 * statement, never as silence or zero. Exactly one disclaimer, at the end.
 */

import type { ICReport } from "../ic-report";
import type { CanonicalFacts, Datum } from "./canonical";
import type { MethodEntry } from "./valuation-suite";
import type { InvariantViolation } from "./valuation-engine";
import {
  fmtMoney,
  fmtMoneyCompact,
  fmtPercent,
  fmtMultiple,
  fmtNumber,
  fmtDate,
  fmtDateTime,
  fmtFiscalPeriod,
  NOT_AVAILABLE,
} from "./format";

/** UTC date (YYYY-MM-DD) of the generation timestamp — the single derivation
 *  shared by the export filename, the Markdown header and the PDF cover, so
 *  they can never disagree across timezones. */
export function reportUtcDate(generatedAt: string): string {
  const d = new Date(generatedAt);
  return Number.isNaN(d.getTime()) ? generatedAt.slice(0, 10) : d.toISOString().slice(0, 10);
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

/** Render a Datum's value in its declared unit. */
function fmtDatum(d: Datum, reportCurrency: string): string {
  const c = d.currency ?? reportCurrency;
  switch (d.unit) {
    case "currency": return fmtMoneyCompact(d.value, c);
    case "perShare": return fmtMoney(d.value, c);
    case "fraction": return fmtPercent(d.value);
    case "ratio": return fmtMultiple(d.value, 2);
    case "shares": return fmtNumber(d.value, { digits: 0, currency: c });
  }
}

const DATUM_FIELDS: [keyof CanonicalFacts, string][] = [
  ["spot", "Spot price"],
  ["marketCap", "Market cap"],
  ["sharesOutstanding", "Shares outstanding"],
  ["totalDebt", "Total debt"],
  ["totalCash", "Total cash"],
  ["netDebt", "Net debt"],
  ["enterpriseValue", "Enterprise value"],
  ["freeCashFlowTtm", "Free cash flow (TTM)"],
  ["freeCashFlowFy", "Free cash flow (last FY)"],
  ["ebitdaTtm", "EBITDA (TTM)"],
  ["trailingPE", "Trailing P/E"],
  ["forwardPE", "Forward P/E"],
  ["pegRatio", "PEG ratio"],
  ["priceToBook", "Price/Book"],
  ["evToEbitda", "EV/EBITDA"],
  ["priceToSales", "Price/Sales"],
  ["dividendYield", "Dividend yield"],
  ["returnOnEquity", "Return on equity"],
  ["returnOnAssets", "Return on assets"],
  ["grossMargin", "Gross margin"],
  ["operatingMargin", "Operating margin"],
  ["netMargin", "Net margin"],
  ["revenueGrowthYoY", "Revenue growth YoY"],
  ["earningsGrowthYoY", "Earnings growth YoY"],
  ["debtToEquity", "Debt/Equity"],
  ["currentRatio", "Current ratio"],
];

function isDatum(v: unknown): v is Datum {
  return typeof v === "object" && v !== null && "value" in v && "unit" in v && "source" in v;
}

/** Majority agent confidence, labelled as a derivation (Thesis carries no
 *  conviction field of its own — this is the closest defensible proxy). */
function convictionLine(report: ICReport): string {
  if (report.agentFindings.length === 0) return `${NOT_AVAILABLE} (no agent findings to derive conviction from)`;
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of report.agentFindings) counts[f.confidence]++;
  const order: ("high" | "medium" | "low")[] = ["high", "medium", "low"];
  const top = order.reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return `${top} (majority of ${report.agentFindings.length} agent confidence ratings: ${counts.high} high, ${counts.medium} medium, ${counts.low} low)`;
}

function violationLines(vs: InvariantViolation[]): string[] {
  return vs.map((v) => `- **${v.invariant}** (${v.severity}): ${v.detail}`);
}

/* ── Main ───────────────────────────────────────────────────────────────── */

export function reportToMarkdown(report: ICReport): string {
  const c = report.currency;
  const f = report.facts;
  const v = report.valuation;
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  /* Header */
  push(
    `# IC Report: ${report.symbol}: ${report.companyName}`,
    "",
    `- **Market:** ${report.market} (${f.exchange ?? NOT_AVAILABLE})${f.sector ? ` | Sector: ${f.sector}` : ""}${f.industry ? ` | Industry: ${f.industry}` : ""}`,
    `- **Spot price at generation:** ${f.spot ? fmtMoney(f.spot.value, c) : NOT_AVAILABLE}`,
    `- **Market cap:** ${f.marketCap ? fmtMoneyCompact(f.marketCap.value, c) : NOT_AVAILABLE}`,
    `- **Data as of:** ${fmtDateTime(f.asOf, report.market)}`,
    `- **Generated:** ${reportUtcDate(report.generatedAt)} (UTC)`,
    `- **Model:** ${report.model}`,
    `- **Prompt versions:** ${Object.entries(report.promptVersions).map(([k, ver]) => `${k}: ${ver}`).join(", ")}`,
    "",
  );

  /* Executive summary */
  push("## Executive summary", "");
  if (v.headline) {
    push(`**Blended estimate: ${fmtMoney(v.headline.perShare, c)} per share** (${v.headline.vsSpot != null ? `${fmtPercent(v.headline.vsSpot, { signed: true })} vs spot` : "vs spot: " + NOT_AVAILABLE}).`, "");
  } else if (v.blockingViolations.length > 0) {
    push(`**Headline value: ${NOT_AVAILABLE}: valuation blocked by ${v.blockingViolations.length} invariant violation${v.blockingViolations.length === 1 ? "" : "s"}** (first: ${v.blockingViolations[0].invariant}). See the Valuation section.`, "");
  } else {
    push(`**Headline value: ${NOT_AVAILABLE}** (insufficient method coverage).`, "");
  }
  push(`- **Conviction (derived from agent confidence):** ${convictionLine(report)}`);
  const topRisks = report.thesis.keyRisks.slice(0, 3);
  const topCatalysts = report.thesis.keyCatalysts.slice(0, 3);
  push(`- **Top risks:** ${topRisks.length > 0 ? topRisks.join("; ") : NOT_AVAILABLE}`);
  push(`- **Top catalysts:** ${topCatalysts.length > 0 ? topCatalysts.join("; ") : NOT_AVAILABLE}`);
  push(`- **Key monitorables:** ${report.monitorables.length > 0 ? report.monitorables.map((m) => m.label).join("; ") : NOT_AVAILABLE}`, "");

  /* Validation issues and data gaps */
  push("## Data validation and gaps", "");
  if (f.validationIssues.length === 0) push("No validation issues were raised while canonicalising the input data.", "");
  else push("**Validation issues:**", "", ...f.validationIssues.map((i) => `- ${i}`), "");
  if (f.gaps.length === 0) push("No data gaps were recorded.", "");
  else push("**Data gaps:**", "", mdTable(["Concept", "Reason"], f.gaps.map((g) => [g.concept, g.reason])), "");
  if (report.agentFailures.length > 0) {
    push(
      `**Agent failures:** ${report.agentFailures.length} agent${report.agentFailures.length === 1 ? "" : "s"} failed; the thesis was formed without their input.`,
      "",
      ...report.agentFailures.map((a) => `- ${a.agentLabel}: ${a.error}${a.retryable ? " (retryable)" : ""}`),
      "",
    );
  }

  /* Signal checks */
  push("## Signal checks", "", `${report.signalChecks.length} checks evaluated, ${report.signals.length} fired. Passed and not-evaluable checks are listed too: a check that ran clean is information; one that could not run is a gap.`, "");
  push(
    mdTable(
      ["Check", "Market", "Status", "Severity", "Threshold", "Evidence", "Detail"],
      report.signalChecks.map((ch) => [
        ch.label,
        ch.market,
        ch.fired ? "FIRED" : ch.evaluated ? "Passed" : "Not evaluable",
        ch.signal ? ch.signal.severity : "none",
        ch.threshold,
        ch.evidence,
        ch.signal
          ? `${ch.signal.description}${ch.signal.dataPoints.length > 0 ? ` (${ch.signal.dataPoints.join("; ")})` : ""}`
          : ch.evaluated
            ? "no signal"
            : ch.unavailableReason ?? "data unavailable",
      ]),
    ),
    "",
  );

  /* Questions */
  push("## Investigative questions", "");
  if (report.questions.length === 0) push(`${NOT_AVAILABLE}: no questions were generated.`, "");
  else {
    for (const q of report.questions) {
      push(`- **[${q.kind}]** ${q.question} (priority: ${q.priority}; agents: ${q.assignedAgents.join(", ")}${q.sourceSignals.length > 0 ? `; from signals: ${q.sourceSignals.join(", ")}` : ""})`);
    }
    push("");
  }

  /* Agent findings */
  push("## Agent findings", "");
  if (report.agentFindings.length === 0) push(`${NOT_AVAILABLE}: no agent findings (agents were skipped or all failed).`, "");
  for (const a of report.agentFindings) {
    push(`### ${a.agentLabel}`, "");
    push(`- **Confidence:** ${a.confidence}${a.confidenceDowngraded ? ` (downgraded: ${a.confidenceDowngraded})` : ""}`);
    push(`- **Questions:** ${a.questionsAnswered} answered of ${a.questionsAssigned} assigned`);
    if (a.dataLimitations) push(`- **Data limitations:** ${a.dataLimitations}`);
    push("", a.findings, "");
    if (a.keyInsights.length > 0) {
      push("**Key insights:**", "", ...a.keyInsights.map((k) => `- ${k}`), "");
    }
  }

  /* Synthesis */
  push("## Synthesis", "");
  const syn = report.synthesis;
  if (!syn) push(`${NOT_AVAILABLE}: synthesis was not run (model unavailable or no agent findings).`, "");
  else {
    if (syn.crossAgentSummary) push(syn.crossAgentSummary, "");
    push(`**Disagreements (${syn.disagreements.length}):**`, "");
    if (syn.disagreements.length === 0) push("No cross-agent disagreements were detected.", "");
    for (const d of syn.disagreements) {
      push(`- **${d.topic}**`, ...d.positions.map((p) => `  - ${p.agent}: ${p.position}`));
    }
    if (syn.disagreements.length > 0) push("");
    push(`**Differentiated insights (${syn.dedupedInsights.length}; ${syn.duplicatesRemoved} duplicates folded):**`, "");
    for (const i of syn.dedupedInsights) {
      push(`- ${i.insight} *(${i.agent}${i.alsoStatedBy.length > 0 ? `; also stated by ${i.alsoStatedBy.join(", ")}` : ""})*`);
    }
    push("");
    if (syn.dataGapAgents.length > 0) {
      push("**Agents flagging data limitations:**", "", ...syn.dataGapAgents.map((g) => `- ${g.agent}: ${g.limitation}`), "");
    }
  }

  /* Thesis */
  push("## Thesis", "");
  const t = report.thesis;
  const block = (label: string, text: string) => push(`### ${label}`, "", text.trim() !== "" ? text : NOT_AVAILABLE, "");
  block("Bull case", t.bull);
  block("Base case", t.base);
  block("Bear case", t.bear);
  block("Variant perception", t.variantPerception);
  block("Market expectations", t.marketExpectations);
  push(`**Key catalysts:** ${t.keyCatalysts.length > 0 ? "" : NOT_AVAILABLE}`, "", ...t.keyCatalysts.map((x) => `- ${x}`), "");
  push(`**Key risks:** ${t.keyRisks.length > 0 ? "" : NOT_AVAILABLE}`, "", ...t.keyRisks.map((x) => `- ${x}`), "");
  push(`**Key drivers:** ${t.keyDrivers.length > 0 ? "" : NOT_AVAILABLE}`, "", ...t.keyDrivers.map((x) => `- ${x}`), "");

  /* Valuation */
  push("## Valuation", "");
  if (v.headline) {
    push(`**Blended estimate: ${fmtMoney(v.headline.perShare, c)}** (${v.headline.vsSpot != null ? `${fmtPercent(v.headline.vsSpot, { signed: true })} vs spot ${fmtMoney(v.spot, c)}` : "spot " + NOT_AVAILABLE}).`, "");
  } else {
    push(`**Headline: ${NOT_AVAILABLE}.** ${v.blockingViolations.length > 0 ? "Valuation is blocked by the violations listed below; no numbers past a blocker are rendered as conclusions." : "Insufficient method coverage for a blend."}`, "");
  }
  push(`- **WACC:** ${fmtPercent(v.wacc.value)} (${v.wacc.components})`);
  push(`- **Inputs:** ${v.modelProposedInputs ? "model-proposed within the validation boundary" : "history-derived defaults (model proposal unavailable)"}; prompt version ${v.promptVersion}`, "");

  push("### Methods", "");
  push(
    mdTable(
      ["Method", "Value/share", "vs spot", "Role", "Confidence", "Assumptions", "Workings"],
      v.methods.map((m: MethodEntry) => [
        m.label,
        m.perShare != null ? fmtMoney(m.perShare, c) : NOT_AVAILABLE,
        m.vsSpot != null ? fmtPercent(m.vsSpot, { signed: true }) : NOT_AVAILABLE,
        m.role ?? (m.applicable ? "" : "not applicable"),
        m.confidence,
        m.applicable ? m.assumptions : (m.notApplicableReason ?? m.assumptions),
        m.workings ?? "",
      ]),
    ),
    "",
  );

  push("### DCF", "");
  if (v.dcf.ran && v.dcf.base && v.dcf.inputs) {
    const d = v.dcf.base;
    const inp = v.dcf.inputs;
    push(
      `Stage-1 growth ${fmtPercent(inp.growthPath[0])}, fading to terminal ${fmtPercent(inp.terminalGrowth)} over ${inp.growthPath.length} years at WACC ${fmtPercent(inp.wacc)}.${inp.exitMultiple != null ? ` Terminal cross-check at ${fmtMultiple(inp.exitMultiple)} EV/FCF.` : ""}`,
      "",
      mdTable(
        ["Year", "Growth", "FCF", "Discount factor", "PV"],
        d.rows.map((r) => [
          String(r.year),
          fmtPercent(r.growth),
          fmtMoneyCompact(r.fcf, c),
          fmtNumber(r.discountFactor, { digits: 3 }),
          fmtMoneyCompact(r.pv, c),
        ]),
      ),
      "",
      `- PV(explicit): ${fmtMoneyCompact(d.pvExplicit, c)}`,
      `- Terminal value (perpetuity): ${fmtMoneyCompact(d.terminalValuePerp, c)}; PV ${fmtMoneyCompact(d.pvTerminalPerp, c)} (${fmtPercent(d.terminalShare)} of EV)`,
      d.terminalValueExit != null
        ? `- Terminal value (exit multiple): ${fmtMoneyCompact(d.terminalValueExit, c)}; PV ${fmtMoneyCompact(d.pvTerminalExit, c)}; per share ${fmtMoney(d.perShareExit, c)}`
        : "- Terminal by perpetuity growth only (no exit multiple proposed).",
      `- Enterprise value ${fmtMoneyCompact(d.enterpriseValue, c)} less net debt ${fmtMoneyCompact(d.netDebt, c)} = equity ${fmtMoneyCompact(d.equityValue, c)}`,
      `- **Per share: ${fmtMoney(d.perShare, c)}**${d.vsSpot != null ? ` (${fmtPercent(d.vsSpot, { signed: true })} vs spot)` : ""}`,
      "",
    );
  } else {
    push(`DCF ${NOT_AVAILABLE}: ${v.dcf.skippedReason ?? "not run"}.`, "");
  }

  push("### Scenarios", "");
  const sc = v.dcf.scenarios;
  if (sc) {
    push(
      mdTable(
        ["Scenario", "Per share", "vs spot", "Stage-1 growth", "WACC"],
        ([sc.bear, sc.base, sc.bull] as const).map((s) => [
          s.label,
          fmtMoney(s.result.perShare, c),
          s.result.vsSpot != null ? fmtPercent(s.result.vsSpot, { signed: true }) : NOT_AVAILABLE,
          fmtPercent(s.inputs.growthPath[0]),
          fmtPercent(s.inputs.wacc),
        ]),
      ),
      "",
    );
  } else push(`Scenario set ${NOT_AVAILABLE} (DCF did not run).`, "");

  push("### Sensitivity (per-share value, WACC rows by terminal-growth columns)", "");
  if (v.sensitivity) {
    const g = v.sensitivity.grid;
    push(
      mdTable(
        ["WACC \\ g", ...g.terminalGrowthValues.map((tg) => fmtPercent(tg))],
        g.waccValues.map((w, i) => [
          fmtPercent(w),
          ...g.perShare[i].map((p) => (p != null ? fmtMoney(p, c) : "n/a (g >= WACC)")),
        ]),
      ),
      "",
      `- Value impact of +1pp stage-1 growth: ${fmtMoney(v.sensitivity.drivers.growthPlus1pp, c, { signed: true })}; +1pp WACC: ${fmtMoney(v.sensitivity.drivers.waccPlus1pp, c, { signed: true })}; +50bp terminal growth: ${fmtMoney(v.sensitivity.drivers.terminalPlus50bp, c, { signed: true })}`,
      v.sensitivity.breakevenGrowth != null
        ? `- Breakeven stage-1 growth at spot: ${fmtPercent(v.sensitivity.breakevenGrowth)}`
        : `- Breakeven stage-1 growth at spot: ${NOT_AVAILABLE}`,
      "",
    );
  } else push(`Sensitivity grid ${NOT_AVAILABLE} (DCF did not run).`, "");

  push("### Reverse DCF", "");
  if (v.reverse) {
    if (v.reverse.converged) {
      push(
        `Spot implies stage-1 FCF growth of ${v.reverse.impliedGrowth != null ? fmtPercent(v.reverse.impliedGrowth) : NOT_AVAILABLE} holding fade shape, WACC and terminal growth fixed.${v.reverse.impliedYearsAtBaseGrowth != null ? ` Alternatively: ${v.reverse.impliedYearsAtBaseGrowth} years of stage-1 growth at the proposed base rate.` : ""}`,
        "",
      );
    } else push("The reverse DCF did not converge within its search band; spot sits outside what the fade-path model can express.", "");
  } else push(`Reverse DCF ${NOT_AVAILABLE}.`, "");

  push("### Blend", "");
  if (v.blend) {
    push(
      mdTable(
        ["Component", "Per share", "Weight", "Rationale"],
        v.blend.components.map((b) => [b.label, fmtMoney(b.perShare, c), fmtPercent(b.weight), b.rationale]),
      ),
      "",
    );
  } else push(`Blend ${NOT_AVAILABLE}: no applicable estimate-role methods to blend.`, "");

  if (v.blockingViolations.length > 0) {
    push("### Blocking violations", "", ...violationLines(v.blockingViolations), "");
  }
  if (v.warnings.length > 0) {
    push("### Warnings", "", ...violationLines(v.warnings), "");
  }

  push("### Reconciliations", "");
  push(report.caseReconciliation ? `- **Valuation case:** ${report.caseReconciliation.explanation}` : `- **Valuation case:** ${NOT_AVAILABLE} (no saved case to reconcile against).`);
  push(report.priorReconciliation ? `- **Quant engine prior:** ${report.priorReconciliation.explanation}` : `- **Quant engine prior:** ${NOT_AVAILABLE} (symbol not scored by the quant engine).`, "");

  /* History stats */
  push("## Historical return statistics", "");
  const h = report.historyStats;
  if (!h) push(`${NOT_AVAILABLE}: insufficient price history.`, "");
  else {
    push(
      mdTable(
        ["Window", "CAGR", "Median rolling CAGR", "Percentile", "Observations", "Signal"],
        h.windows.map((w) => [
          `${w.years}y`,
          w.available && w.cagr != null ? fmtPercent(w.cagr, { signed: true }) : NOT_AVAILABLE,
          w.medianCagr != null ? fmtPercent(w.medianCagr, { signed: true }) : NOT_AVAILABLE,
          w.percentile != null ? `${w.percentile}` : NOT_AVAILABLE,
          String(w.observations),
          w.signal ? w.signal.replace("_", " ") : "none",
        ]),
      ),
      "",
    );
    if (h.verdict) {
      push(`**Verdict (${h.verdict.windowYears}y window):** ${h.verdict.signal.replace("_", " ")} at the ${h.verdict.percentile}th percentile of its own rolling history (CAGR ${fmtPercent(h.verdict.cagr, { signed: true })} vs median ${fmtPercent(h.verdict.medianCagr, { signed: true })}, ${h.verdict.observations} observations).`, "");
    } else push(`Verdict: ${NOT_AVAILABLE} (no window has enough rolling observations).`, "");
    if (h.sinceListing) push(`Since listing: ${fmtPercent(h.sinceListing.totalReturn, { signed: true })} total return over ${h.sinceListing.years} years.`, "");
  }

  /* Watch items */
  push("## Watch items", "");
  if (report.monitorables.length === 0) push(`${NOT_AVAILABLE}: no monitorables recorded.`, "");
  else {
    push(
      mdTable(
        ["Item", "Kind", "Trigger", "Source"],
        report.monitorables.map((m) => [m.label, m.kind, m.trigger ?? NOT_AVAILABLE, m.source]),
      ),
      "",
    );
  }

  /* Appendix */
  push("## Appendix: canonical financial data", "");
  const datumRows: string[][] = [];
  for (const [key, label] of DATUM_FIELDS) {
    const d = f[key];
    if (!isDatum(d)) continue;
    datumRows.push([
      label,
      fmtDatum(d, c),
      d.unit,
      d.periodLabel,
      `${d.source.provider}: ${d.source.field}${d.source.ref ? ` (${d.source.ref})` : ""}`,
      fmtDate(d.asOf),
    ]);
  }
  if (datumRows.length === 0) push(`${NOT_AVAILABLE}: no canonical data points resolved.`, "");
  else push(mdTable(["Field", "Value", "Unit", "Period", "Source", "As of"], datumRows), "");

  if (f.statements) {
    const st = f.statements;
    push(
      "### Annual statements",
      "",
      `Provider: ${st.provider}; currency: ${st.currency}.` +
        (st.revenueCagr != null ? ` Revenue CAGR (${st.revenueCagrYears ?? "?"}y): ${fmtPercent(st.revenueCagr, { signed: true })}.` : "") +
        (st.fcfCagr != null ? ` FCF CAGR (${st.fcfCagrYears ?? "?"}y): ${fmtPercent(st.fcfCagr, { signed: true })}.` : ""),
      "",
      mdTable(
        ["Fiscal period", "Revenue", "Net income", "Free cash flow", "Operating margin", "Gross margin"],
        st.fiscalYears.map((fy) => {
          const pick = (s: { fy: number; end?: string | null; value: number }[]): { fy: number; end?: string | null; value: number } | undefined => s.find((p) => p.fy === fy);
          const rev = pick(st.revenue);
          const money = (p?: { value: number }) => (p ? fmtMoneyCompact(p.value, st.currency) : NOT_AVAILABLE);
          const pct = (p?: { value: number }) => (p ? fmtPercent(p.value) : NOT_AVAILABLE);
          return [
            rev ? fmtFiscalPeriod(rev) : `FY${fy}`,
            money(rev),
            money(pick(st.netIncome)),
            money(pick(st.freeCashFlow)),
            pct(pick(st.operatingMargin)),
            pct(pick(st.grossMargin)),
          ];
        }),
      ),
      "",
    );
  }

  push("### Generation timings", "");
  if (report.timings.length === 0) push(`${NOT_AVAILABLE}: no timings recorded.`, "");
  else push(mdTable(["Stage", "Duration"], report.timings.map((tm) => [tm.stage, `${fmtNumber(tm.ms, { digits: 0 })} ms`])), "");

  /* Single disclaimer, once, at the end */
  push(
    "---",
    "",
    "## Disclaimer",
    "",
    "This report is generated for informational purposes only and is not investment advice. Figures derive from third-party data providers and deterministic models with the stated assumptions; verify against primary sources before acting.",
    "",
  );

  return out.join("\n");
}
