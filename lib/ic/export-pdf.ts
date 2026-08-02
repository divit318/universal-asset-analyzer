/**
 * IC Report — PDF export (schemaVersion 2), built on pdfkit.
 *
 * Hard rules carried over from the export rewrite:
 * - DejaVu fonts only (₹ → • − – and arrows mojibake in WinAnsi Helvetica).
 * - Running header via the "pageAdded" event only; footers ("Page N of M")
 *   post-painted over buffered pages so the total is correct.
 * - Long text always flows through doc.text with a width — never manually
 *   paginated; the pageAdded handler keeps the chrome out of the flow.
 * - Every number and date goes through lib/ic/format.ts.
 * - Colour never carries meaning alone: severity/direction always has a text
 *   label, and values are coloured by their numeric sign, not string matching.
 */

import { AGENT_LABELS } from "../ic-questions";
import PDFDocument from "pdfkit";
import path from "node:path";
import type { ICReport } from "../ic-report";
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
  ordinal,
} from "./format";
import { reportUtcDate } from "./export-markdown";

const FONT = "UAA";
const BOLD = "UAA-Bold";
const ITALIC = "UAA-Oblique";

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#d1d5db";
const NAVY = "#1e3a5f";
const RED = "#b91c1c";
const GREEN = "#15803d";
const AMBER = "#b45309";
const BLUE = "#1d4ed8";
const CHIP_GREY = "#4b5563";

const SECTION_HEADROOM = 120; // widow/orphan control before a section header

interface Col {
  header: string;
  width: number;
  align?: "left" | "right";
}

interface RowCell {
  text: string;
  /** Semantic colour for the VALUE; direction is always in the text too. */
  color?: string;
}

class PdfWriter {
  readonly doc: PDFKit.PDFDocument;
  readonly M: number;
  readonly W: number;
  private readonly report: ICReport;
  private readonly dateStr: string;
  private sectionNo = 0;

  constructor(report: ICReport) {
    this.report = report;
    this.dateStr = reportUtcDate(report.generatedAt);
    this.doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: 64, bottom: 60, left: 48, right: 48 },
      info: {
        Title: `IC Report — ${report.symbol} — ${this.dateStr}`,
        Author: "Universal Asset Analyzer",
        Subject: `Investment Committee research report: ${report.companyName} (${report.symbol})`,
        Creator: "Universal Asset Analyzer",
      },
    });
    const fontsDir = path.join(process.cwd(), "lib/ic/fonts");
    this.doc.registerFont(FONT, path.join(fontsDir, "DejaVuSans.ttf"));
    this.doc.registerFont(BOLD, path.join(fontsDir, "DejaVuSans-Bold.ttf"));
    this.doc.registerFont(ITALIC, path.join(fontsDir, "DejaVuSans-Oblique.ttf"));
    this.M = this.doc.page.margins.left;
    this.W = this.doc.page.width - this.M * 2;
    // Header chrome lives in the top margin, drawn only when a page is added
    // (the cover — the document's first page — deliberately has none).
    this.doc.on("pageAdded", () => this.drawHeader());
  }

  private drawHeader(): void {
    const { doc, M, W } = this;
    doc.save();
    doc.font(FONT).fontSize(7).fillColor(MUTED);
    doc.text(`${this.report.symbol} · ${this.report.companyName} · IC Report`, M, 30, { width: W - 130, lineBreak: false, ellipsis: true });
    doc.text(`${this.dateStr} UTC`, M + W - 120, 30, { width: 120, align: "right", lineBreak: false });
    doc.moveTo(M, 44).lineTo(M + W, 44).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.restore();
    // The handler must hand the flow back exactly where addPage left it.
    doc.x = M;
    doc.y = doc.page.margins.top;
  }

  /** Post-paint page numbers so "of M" is correct on every page. */
  finishPageNumbers(): void {
    const { doc, M, W } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font(FONT).fontSize(7).fillColor(MUTED);
      doc.text(`Page ${i + 1} of ${range.count}`, M, doc.page.height - 40, { width: W, align: "center", lineBreak: false });
    }
  }

  ensure(pts: number): void {
    const { doc } = this;
    if (doc.y + pts > doc.page.height - doc.page.margins.bottom) doc.addPage();
  }

  section(title: string): void {
    this.sectionNo += 1;
    this.ensure(SECTION_HEADROOM);
    const { doc, M, W } = this;
    doc.addNamedDestination(`sec-${this.sectionNo}`);
    doc.outline.addItem(`${this.sectionNo}. ${title}`);
    doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(M, y, W, 20).fill(NAVY);
    doc.fillColor("#ffffff").font(BOLD).fontSize(10).text(`${this.sectionNo}. ${title}`, M + 8, y + 5, { width: W - 16, lineBreak: false });
    doc.x = M;
    doc.y = y + 28;
  }

  sub(title: string): void {
    this.ensure(60);
    const { doc, M, W } = this;
    doc.font(BOLD).fontSize(9.5).fillColor(NAVY).text(title, M, doc.y, { width: W });
    doc.moveDown(0.2);
  }

  para(text: string, opts: { size?: number; color?: string; font?: string; indent?: number } = {}): void {
    const { doc, M, W } = this;
    doc.font(opts.font ?? FONT).fontSize(opts.size ?? 8.5).fillColor(opts.color ?? INK);
    doc.text(text, M + (opts.indent ?? 0), doc.y, { width: W - (opts.indent ?? 0), lineGap: 2 });
    doc.moveDown(0.35);
  }

  bullet(text: string, opts: { color?: string } = {}): void {
    this.para(`•  ${text}`, { indent: 6, color: opts.color });
  }

  kv(label: string, value: string, valueColor?: string): void {
    const { doc, M, W } = this;
    this.ensure(14);
    const y = doc.y;
    doc.font(BOLD).fontSize(8.5).fillColor(MUTED).text(label, M, y, { width: 150, lineBreak: false });
    doc.font(FONT).fontSize(8.5).fillColor(valueColor ?? INK).text(value, M + 154, y, { width: W - 154, lineGap: 1.5 });
    doc.y = Math.max(doc.y, y + 12);
    doc.x = M;
  }

  /** Filled rounded chip sized from the measured label — never a fixed width. */
  chip(label: string, color: string, x: number, y: number): number {
    const { doc } = this;
    const text = label.toUpperCase();
    doc.font(BOLD).fontSize(6.5);
    const w = doc.widthOfString(text) + 12;
    doc.roundedRect(x, y, w, 11, 3).fill(color);
    doc.fillColor("#ffffff").text(text, x + 6, y + 2.5, { width: w - 12, lineBreak: false });
    return w;
  }

  /** Table with wrapped cells; row height from the tallest cell; header
   *  re-drawn after a page break. */
  table(cols: Col[], rows: RowCell[][]): void {
    const { doc, M } = this;
    const pad = 4;
    const cellH = (text: string, width: number): number => {
      doc.font(FONT).fontSize(7.5);
      return doc.heightOfString(text === "" ? " " : text, { width: width - pad * 2, lineGap: 1 });
    };
    const drawHeaderRow = (): void => {
      const y = doc.y;
      let h = 0;
      doc.font(BOLD).fontSize(7.5);
      for (const cItem of cols) h = Math.max(h, doc.heightOfString(cItem.header, { width: cItem.width - pad * 2, lineGap: 1 }));
      h += pad * 2;
      doc.rect(M, y, cols.reduce((a, cItem) => a + cItem.width, 0), h).fill("#eef2f7");
      let x = M;
      for (const cItem of cols) {
        doc.fillColor(NAVY).font(BOLD).fontSize(7.5).text(cItem.header, x + pad, y + pad, { width: cItem.width - pad * 2, lineGap: 1, align: cItem.align ?? "left" });
        x += cItem.width;
      }
      doc.y = y + h;
      doc.x = M;
    };
    drawHeaderRow();
    for (const row of rows) {
      const h = Math.max(...row.map((cell, i) => cellH(cell.text, cols[i].width))) + pad * 2;
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        drawHeaderRow();
      }
      const y = doc.y;
      let x = M;
      for (let i = 0; i < cols.length; i++) {
        doc.font(FONT).fontSize(7.5).fillColor(row[i].color ?? INK);
        doc.text(row[i].text === "" ? " " : row[i].text, x + pad, y + pad, { width: cols[i].width - pad * 2, lineGap: 1, align: cols[i].align ?? "left" });
        x += cols[i].width;
      }
      doc.y = y + h;
      doc.x = M;
      doc.moveTo(M, doc.y).lineTo(M + cols.reduce((a, cItem) => a + cItem.width, 0), doc.y).lineWidth(0.25).strokeColor(LINE).stroke();
    }
    doc.moveDown(0.5);
  }
}

/** Colour for a vs-spot style figure: adverse (negative) is red — decided on
 *  the numeric value, never by matching a "-" in a rendered string. */
function signColor(v: number | null | undefined): string | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  return v < 0 ? RED : v > 0 ? GREEN : undefined;
}

const CONF_COLOR: Record<"high" | "medium" | "low", string> = { high: GREEN, medium: AMBER, low: RED };
const SEV_COLOR: Record<"high" | "medium" | "low", string> = { high: RED, medium: AMBER, low: CHIP_GREY };
/** Scenario labels get their own fixed colours — not derived from sign. */
const SCENARIO_COLOR: Record<"bear" | "base" | "bull", string> = { bear: AMBER, base: BLUE, bull: GREEN };

const TOC = [
  "Executive summary",
  "Validation and data gaps",
  "Signal checks",
  "Investigative questions",
  "Agent findings",
  "Synthesis",
  "Thesis",
  "Valuation",
  "Historical return statistics",
  "Watch items",
  "Appendix",
];

export async function reportToPdf(report: ICReport): Promise<Buffer> {
  const w = new PdfWriter(report);
  const { doc, M, W } = w;
  const c = report.currency;
  const f = report.facts;
  const v = report.valuation;
  const dateStr = reportUtcDate(report.generatedAt);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  /* ── Cover ── */
  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#0f172a");
  doc.fillColor("#60a5fa").font(BOLD).fontSize(10).text("UNIVERSAL ASSET ANALYZER", M, 70, { width: W, align: "center" });
  doc.fillColor("#ffffff").font(BOLD).fontSize(30).text("Investment Committee Report", M, 110, { width: W, align: "center" });
  doc.fillColor("#93c5fd").font(BOLD).fontSize(22).text(report.symbol, M, 175, { width: W, align: "center" });
  doc.fillColor("#e2e8f0").font(FONT).fontSize(13).text(report.companyName, M, 205, { width: W, align: "center" });
  doc.moveTo(M + 80, 236).lineTo(M + W - 80, 236).lineWidth(0.5).strokeColor("#334155").stroke();
  const coverLines: string[] = [
    `Generated: ${dateStr} (UTC)`,
    `Spot price: ${f.spot ? fmtMoney(f.spot.value, c) : NOT_AVAILABLE}  ·  Market cap: ${f.marketCap ? fmtMoneyCompact(f.marketCap.value, c) : NOT_AVAILABLE}`,
    `Data as of: ${fmtDateTime(f.asOf, report.market)}`,
    `Model: ${report.model}`,
    `Prompt versions: ${Object.entries(report.promptVersions).map(([k, ver]) => `${k} ${ver}`).join("  ·  ")}`,
  ];
  let cy = 250;
  for (const line of coverLines) {
    doc.fillColor("#94a3b8").font(FONT).fontSize(9).text(line, M, cy, { width: W, align: "center" });
    cy += 16;
  }
  // Linked table of contents (named destinations added at each section).
  doc.fillColor("#64748b").font(BOLD).fontSize(8).text("CONTENTS", M, cy + 24, { width: W, align: "center" });
  let ty = cy + 44;
  TOC.forEach((title, i) => {
    doc.fillColor("#60a5fa").font(BOLD).fontSize(9).text(String(i + 1).padStart(2, "0"), M + 150, ty, { lineBreak: false });
    doc.fillColor("#cbd5e1").font(FONT).fontSize(9).text(title, M + 175, ty, { width: 240, lineBreak: false, goTo: `sec-${i + 1}` });
    ty += 17;
  });

  /* ── Executive summary ── */
  doc.addPage();
  w.section("Executive summary");
  if (v.headline) {
    const vs = v.headline.vsSpot;
    doc.font(BOLD).fontSize(15).fillColor(INK).text(`Blended estimate: ${fmtMoney(v.headline.perShare, c)} per share`, M, doc.y, { width: W });
    doc.font(BOLD).fontSize(10).fillColor(signColor(vs) ?? INK)
      .text(vs != null ? `${fmtPercent(vs, { signed: true })} vs spot ${fmtMoney(v.spot, c)}` : `vs spot: ${NOT_AVAILABLE}`, M, doc.y + 2, { width: W });
    doc.moveDown(0.6);
  } else if (v.blockingViolations.length > 0) {
    doc.font(BOLD).fontSize(12).fillColor(RED).text(`Headline value: ${NOT_AVAILABLE}: valuation blocked (${v.blockingViolations[0].invariant})`, M, doc.y, { width: W });
    doc.moveDown(0.6);
  } else {
    doc.font(BOLD).fontSize(12).fillColor(INK).text(`Headline value: ${NOT_AVAILABLE} (insufficient method coverage)`, M, doc.y, { width: W });
    doc.moveDown(0.6);
  }
  w.kv("Conviction", convictionText(report));
  const topRisks = report.thesis.keyRisks.slice(0, 3);
  const topCatalysts = report.thesis.keyCatalysts.slice(0, 3);
  w.sub("Top risks");
  if (topRisks.length === 0) w.para(NOT_AVAILABLE, { color: MUTED });
  for (const r of topRisks) w.bullet(r);
  w.sub("Top catalysts");
  if (topCatalysts.length === 0) w.para(NOT_AVAILABLE, { color: MUTED });
  for (const cat of topCatalysts) w.bullet(cat);
  w.sub("Key monitorables");
  if (report.monitorables.length === 0) w.para(NOT_AVAILABLE, { color: MUTED });
  for (const m of report.monitorables) w.bullet(`${m.label} (${m.kind}${m.trigger ? `: ${m.trigger}` : ""})`);

  /* ── Validation and data gaps ── */
  w.section("Validation and data gaps");
  if (f.validationIssues.length === 0) w.para("No validation issues were raised while canonicalising the input data.", { color: MUTED });
  else {
    w.sub("Validation issues");
    for (const issue of f.validationIssues) w.bullet(issue, { color: RED });
  }
  if (f.gaps.length === 0) w.para("No data gaps were recorded.", { color: MUTED });
  else {
    w.sub("Data gaps");
    w.table(
      [{ header: "Concept", width: 150 }, { header: "Reason", width: W - 150 }],
      f.gaps.map((g) => [{ text: g.concept }, { text: g.reason }]),
    );
  }
  if (report.agentFailures.length > 0) {
    w.sub("Agent failures (the thesis was formed without their input)");
    for (const a of report.agentFailures) w.bullet(`${a.agentLabel}: ${a.error}${a.retryable ? " (retryable)" : ""}`, { color: AMBER });
  }

  /* ── Signal checks ── */
  w.section("Signal checks");
  w.para(`${report.signalChecks.length} checks evaluated, ${report.signals.length} fired. Passed and not-evaluable checks are shown too.`, { color: MUTED });
  for (const ch of report.signalChecks) {
    w.ensure(48);
    const y = doc.y;
    const chipLabel = ch.fired && ch.signal ? `${ch.signal.severity}` : ch.evaluated ? "passed" : "no data";
    const chipColor = ch.fired && ch.signal ? SEV_COLOR[ch.signal.severity] : ch.evaluated ? CHIP_GREY : AMBER;
    const cw = w.chip(chipLabel, chipColor, M, y);
    doc.font(BOLD).fontSize(8.5).fillColor(INK).text(`${ch.label}  [${ch.market}]  ${ch.fired ? "FIRED" : ch.evaluated ? "passed: no signal" : "not evaluable"}`, M + cw + 6, y + 1, { width: W - cw - 6, lineGap: 1.5 });
    doc.y = Math.max(doc.y, y + 13);
    doc.x = M;
    w.para(`Threshold: ${ch.threshold}  ·  Evidence: ${ch.evidence}`, { size: 7.5, color: MUTED, indent: 6 });
    if (ch.signal) {
      w.para(`${ch.signal.description}${ch.signal.dataPoints.length > 0 ? `  (${ch.signal.dataPoints.join("; ")})` : ""}`, { indent: 6 });
    } else if (!ch.evaluated) {
      w.para(`Not evaluable: ${ch.unavailableReason ?? "required data unavailable"}`, { indent: 6, color: MUTED });
    }
    doc.moveDown(0.2);
  }

  /* ── Questions ── */
  w.section("Investigative questions");
  if (report.questions.length === 0) w.para(`${NOT_AVAILABLE}: no questions were generated.`, { color: MUTED });
  for (const q of report.questions) {
    w.ensure(30);
    const y = doc.y;
    const cw = w.chip(q.kind, q.kind === "signal" ? BLUE : CHIP_GREY, M, y);
    doc.font(FONT).fontSize(8.5).fillColor(INK).text(q.question, M + cw + 6, y, { width: W - cw - 6, lineGap: 2 });
    doc.x = M;
    doc.moveDown(0.15);
    w.para(`Priority: ${q.priority}  ·  Agents: ${q.assignedAgents.map((a) => AGENT_LABELS[a]).join(", ")}${q.sourceSignals.length > 0 ? `  ·  From signals: ${q.sourceSignals.join(", ")}` : ""}`, { size: 7, color: MUTED, indent: 6 });
  }

  /* ── Agent findings ── */
  w.section("Agent findings");
  if (report.agentFindings.length === 0) w.para(`${NOT_AVAILABLE}: no agent findings (agents were skipped or all failed).`, { color: MUTED });
  for (const a of report.agentFindings) {
    w.ensure(70);
    const y = doc.y;
    doc.font(BOLD).fontSize(10).fillColor(NAVY).text(a.agentLabel, M, y, { lineBreak: false });
    const labelW = doc.widthOfString(a.agentLabel) + 8;
    w.chip(`${a.confidence} confidence`, CONF_COLOR[a.confidence], M + labelW, y);
    doc.x = M;
    doc.y = y + 15;
    w.para(`${a.questionsAnswered} of ${a.questionsAssigned} assigned questions answered`, { size: 7, color: MUTED });
    if (a.confidenceDowngraded) w.para(`Confidence downgraded: ${a.confidenceDowngraded}`, { size: 7.5, color: AMBER, font: ITALIC });
    w.para(a.findings);
    if (a.keyInsights.length > 0) {
      doc.font(BOLD).fontSize(8).fillColor(NAVY).text("Key insights", M, doc.y);
      doc.moveDown(0.15);
      for (const k of a.keyInsights) w.bullet(k);
    }
    if (a.dataLimitations) w.para(`Data limitations: ${a.dataLimitations}`, { size: 7.5, color: MUTED, font: ITALIC });
    doc.moveDown(0.4);
  }

  /* ── Synthesis ── */
  w.section("Synthesis");
  const syn = report.synthesis;
  if (!syn) w.para(`${NOT_AVAILABLE}: synthesis was not run (model unavailable or no agent findings).`, { color: MUTED });
  else {
    if (syn.crossAgentSummary) w.para(syn.crossAgentSummary);
    w.sub(`Disagreements (${syn.disagreements.length})`);
    if (syn.disagreements.length === 0) w.para("No cross-agent disagreements were detected.", { color: MUTED });
    for (const d of syn.disagreements) {
      w.para(d.topic, { font: BOLD });
      for (const p of d.positions) w.bullet(`${p.agent}: ${p.position}`);
    }
    w.sub(`Differentiated insights (${syn.dedupedInsights.length}; ${syn.duplicatesRemoved} duplicates folded)`);
    for (const i of syn.dedupedInsights) {
      w.bullet(`${i.insight}  [${i.agent}${i.alsoStatedBy.length > 0 ? `; also: ${i.alsoStatedBy.join(", ")}` : ""}]`);
    }
    if (syn.dataGapAgents.length > 0) {
      w.sub("Agents flagging data limitations");
      for (const g of syn.dataGapAgents) w.bullet(`${g.agent}: ${g.limitation}`, { color: MUTED });
    }
  }

  /* ── Thesis ── */
  w.section("Thesis");
  const thesisBlock = (label: string, text: string, color: string): void => {
    w.ensure(50);
    doc.font(BOLD).fontSize(9.5).fillColor(color).text(label, M, doc.y);
    doc.moveDown(0.15);
    w.para(text.trim() !== "" ? text : NOT_AVAILABLE, { color: text.trim() !== "" ? INK : MUTED });
  };
  thesisBlock("Bull case", report.thesis.bull, GREEN);
  thesisBlock("Base case", report.thesis.base, BLUE);
  thesisBlock("Bear case", report.thesis.bear, AMBER);
  thesisBlock("Variant perception", report.thesis.variantPerception, NAVY);
  thesisBlock("Market expectations", report.thesis.marketExpectations, NAVY);
  const list = (label: string, items: string[]): void => {
    w.sub(label);
    if (items.length === 0) w.para(NOT_AVAILABLE, { color: MUTED });
    for (const item of items) w.bullet(item);
  };
  list("Key catalysts", report.thesis.keyCatalysts);
  list("Key risks", report.thesis.keyRisks);
  list("Key drivers", report.thesis.keyDrivers);

  /* ── Valuation ── */
  w.section("Valuation");
  if (v.headline) {
    doc.font(BOLD).fontSize(11).fillColor(INK).text(`Blended estimate: ${fmtMoney(v.headline.perShare, c)}`, M, doc.y, { lineBreak: false });
    if (v.headline.vsSpot != null) {
      doc.font(BOLD).fontSize(11).fillColor(signColor(v.headline.vsSpot) ?? INK)
        .text(`   ${fmtPercent(v.headline.vsSpot, { signed: true })} vs spot ${fmtMoney(v.spot, c)}`, { lineBreak: false });
    }
    doc.x = M;
    doc.y += 16;
  } else {
    w.para(`Headline: ${NOT_AVAILABLE}. ${v.blockingViolations.length > 0 ? "Valuation is blocked by the violations below; no numbers past a blocker are conclusions." : "Insufficient method coverage for a blend."}`, { font: BOLD, color: v.blockingViolations.length > 0 ? RED : INK });
  }
  w.kv("WACC", `${fmtPercent(v.wacc.value)} (${v.wacc.components})`);
  w.kv("Inputs", v.modelProposedInputs ? `model-proposed within the validation boundary (prompt ${v.promptVersion})` : `history-derived defaults; model proposal unavailable (prompt ${v.promptVersion})`);
  doc.moveDown(0.3);

  w.sub("Methods");
  {
    const assumpW = W - (92 + 62 + 56 + 52);
    w.table(
      [
        { header: "Method", width: 92 },
        { header: "Value/share", width: 62, align: "right" },
        { header: "vs spot", width: 56, align: "right" },
        { header: "Role", width: 52 },
        { header: "Assumptions and workings", width: assumpW },
      ],
      v.methods.map((m: MethodEntry) => [
        { text: `${m.label}\n(${m.confidence} confidence)` },
        { text: m.perShare != null ? fmtMoney(m.perShare, c) : NOT_AVAILABLE },
        { text: m.vsSpot != null ? fmtPercent(m.vsSpot, { signed: true }) : NOT_AVAILABLE, color: signColor(m.vsSpot) },
        { text: m.role ?? (m.applicable ? "" : "not applicable") },
        { text: (m.applicable ? m.assumptions : (m.notApplicableReason ?? m.assumptions)) + (m.workings ? `\nWorkings: ${m.workings}` : "") },
      ]),
    );
  }

  w.sub("DCF");
  if (v.dcf.ran && v.dcf.base && v.dcf.inputs) {
    const d = v.dcf.base;
    const inp = v.dcf.inputs;
    w.para(`Stage-1 growth ${fmtPercent(inp.growthPath[0])}, fading to terminal ${fmtPercent(inp.terminalGrowth)} over ${inp.growthPath.length} years at WACC ${fmtPercent(inp.wacc)}.${inp.exitMultiple != null ? ` Terminal cross-check at ${fmtMultiple(inp.exitMultiple)} EV/FCF.` : ""}`);
    w.table(
      [
        { header: "Year", width: 40, align: "right" },
        { header: "Growth", width: 70, align: "right" },
        { header: "FCF", width: 120, align: "right" },
        { header: "Discount factor", width: 100, align: "right" },
        { header: "PV", width: 120, align: "right" },
      ],
      d.rows.map((r) => [
        { text: String(r.year) },
        { text: fmtPercent(r.growth) },
        { text: fmtMoneyCompact(r.fcf, c) },
        { text: fmtNumber(r.discountFactor, { digits: 3 }) },
        { text: fmtMoneyCompact(r.pv, c) },
      ]),
    );
    w.bullet(`PV(explicit): ${fmtMoneyCompact(d.pvExplicit, c)}; PV(terminal): ${fmtMoneyCompact(d.pvTerminalPerp, c)} (${fmtPercent(d.terminalShare)} of EV)`);
    if (d.terminalValueExit != null) {
      w.bullet(`Exit-multiple terminal: ${fmtMoneyCompact(d.terminalValueExit, c)}; per share ${fmtMoney(d.perShareExit, c)}`);
    }
    w.bullet(`Enterprise value ${fmtMoneyCompact(d.enterpriseValue, c)} less net debt ${fmtMoneyCompact(d.netDebt, c)} = equity ${fmtMoneyCompact(d.equityValue, c)}`);
    w.para(`Per share: ${fmtMoney(d.perShare, c)}${d.vsSpot != null ? ` (${fmtPercent(d.vsSpot, { signed: true })} vs spot)` : ""}`, { font: BOLD });
  } else {
    w.para(`DCF ${NOT_AVAILABLE}: ${v.dcf.skippedReason ?? "not run"}.`, { color: MUTED });
  }

  w.sub("Scenarios");
  if (v.dcf.scenarios) {
    const sc = v.dcf.scenarios;
    w.table(
      [
        { header: "Scenario", width: 80 },
        { header: "Per share", width: 90, align: "right" },
        { header: "vs spot", width: 80, align: "right" },
        { header: "Stage-1 growth", width: 110, align: "right" },
        { header: "WACC", width: 80, align: "right" },
      ],
      ([sc.bear, sc.base, sc.bull] as const).map((s) => [
        { text: s.label, color: SCENARIO_COLOR[s.label] },
        { text: fmtMoney(s.result.perShare, c) },
        { text: s.result.vsSpot != null ? fmtPercent(s.result.vsSpot, { signed: true }) : NOT_AVAILABLE, color: signColor(s.result.vsSpot) },
        { text: fmtPercent(s.inputs.growthPath[0]) },
        { text: fmtPercent(s.inputs.wacc) },
      ]),
    );
  } else w.para(`Scenario set ${NOT_AVAILABLE} (DCF did not run).`, { color: MUTED });

  w.sub("Sensitivity: per-share value, WACC rows by terminal-growth columns");
  if (v.sensitivity) {
    const g = v.sensitivity.grid;
    const colW = Math.floor(W / (g.terminalGrowthValues.length + 1));
    w.table(
      [
        { header: "WACC \\ g", width: colW },
        ...g.terminalGrowthValues.map((tg) => ({ header: fmtPercent(tg), width: colW, align: "right" as const })),
      ],
      g.waccValues.map((wv, i) => [
        { text: fmtPercent(wv) },
        ...g.perShare[i].map((p) => ({ text: p != null ? fmtMoney(p, c) : "n/a" })),
      ]),
    );
    w.bullet(`+1pp stage-1 growth: ${fmtMoney(v.sensitivity.drivers.growthPlus1pp, c, { signed: true })}; +1pp WACC: ${fmtMoney(v.sensitivity.drivers.waccPlus1pp, c, { signed: true })}; +50bp terminal growth: ${fmtMoney(v.sensitivity.drivers.terminalPlus50bp, c, { signed: true })}`);
    w.bullet(`Breakeven stage-1 growth at spot: ${v.sensitivity.breakevenGrowth != null ? fmtPercent(v.sensitivity.breakevenGrowth) : NOT_AVAILABLE}`);
  } else w.para(`Sensitivity grid ${NOT_AVAILABLE} (DCF did not run).`, { color: MUTED });

  w.sub("Reverse DCF");
  if (v.reverse) {
    if (v.reverse.converged) {
      w.para(`Spot implies stage-1 FCF growth of ${v.reverse.impliedGrowth != null ? fmtPercent(v.reverse.impliedGrowth) : NOT_AVAILABLE} holding fade shape, WACC and terminal growth fixed.${v.reverse.impliedYearsAtBaseGrowth != null ? ` Alternatively: ${v.reverse.impliedYearsAtBaseGrowth} years of stage-1 growth at the proposed base rate.` : ""}`);
    } else w.para("The reverse DCF did not converge within its search band; spot sits outside what the fade-path model can express.", { color: MUTED });
  } else w.para(`Reverse DCF ${NOT_AVAILABLE}.`, { color: MUTED });

  w.sub("Blend");
  if (v.blend) {
    w.table(
      [
        { header: "Component", width: 110 },
        { header: "Per share", width: 80, align: "right" },
        { header: "Weight", width: 60, align: "right" },
        { header: "Rationale", width: W - 250 },
      ],
      v.blend.components.map((b) => [
        { text: b.label },
        { text: fmtMoney(b.perShare, c) },
        { text: fmtPercent(b.weight) },
        { text: b.rationale },
      ]),
    );
  } else w.para(`Blend ${NOT_AVAILABLE}: no applicable estimate-role methods to blend.`, { color: MUTED });

  const violations = (title: string, items: InvariantViolation[], color: string): void => {
    if (items.length === 0) return;
    w.sub(title);
    for (const item of items) {
      w.ensure(24);
      const y = doc.y;
      const cw = w.chip(item.severity, color, M, y);
      doc.font(BOLD).fontSize(8.5).fillColor(INK).text(item.invariant, M + cw + 6, y + 1, { width: W - cw - 6 });
      doc.x = M;
      doc.y = Math.max(doc.y, y + 13);
      w.para(item.detail, { indent: 6, size: 8, color: MUTED });
    }
  };
  violations("Blocking violations", v.blockingViolations, RED);
  violations("Warnings", v.warnings, AMBER);

  w.sub("Reconciliations");
  w.para(`Valuation case: ${report.caseReconciliation ? report.caseReconciliation.explanation : `${NOT_AVAILABLE} (no saved case to reconcile against).`}`);
  w.para(`Quant engine prior: ${report.priorReconciliation ? report.priorReconciliation.explanation : `${NOT_AVAILABLE} (symbol not scored by the quant engine).`}`);

  /* ── History stats ── */
  w.section("Historical return statistics");
  const h = report.historyStats;
  if (!h) w.para(`${NOT_AVAILABLE}: insufficient price history.`, { color: MUTED });
  else {
    w.table(
      [
        { header: "Window", width: 60 },
        { header: "CAGR", width: 80, align: "right" },
        { header: "Median rolling CAGR", width: 120, align: "right" },
        { header: "Percentile", width: 70, align: "right" },
        { header: "Observations", width: 80, align: "right" },
        { header: "Signal", width: 80 },
      ],
      h.windows.map((win) => [
        { text: `${win.years}y` },
        { text: win.cagr != null ? fmtPercent(win.cagr, { signed: true }) : NOT_AVAILABLE, color: signColor(win.cagr) },
        { text: win.medianCagr != null ? fmtPercent(win.medianCagr, { signed: true }) : NOT_AVAILABLE },
        { text: win.percentile != null ? String(win.percentile) : NOT_AVAILABLE },
        { text: String(win.observations) },
        { text: win.signal ? win.signal.replace("_", " ") : "none" },
      ]),
    );
    if (h.verdict) {
      w.para(`Verdict (${h.verdict.windowYears}y window): ${h.verdict.signal.replace("_", " ")} at the ${ordinal(h.verdict.percentile)} percentile of its own rolling history (CAGR ${fmtPercent(h.verdict.cagr, { signed: true })} vs median ${fmtPercent(h.verdict.medianCagr, { signed: true })}, ${h.verdict.observations} observations).`, { font: BOLD });
    } else w.para(`Verdict: ${NOT_AVAILABLE} (no window has enough rolling observations).`, { color: MUTED });
    if (h.sinceListing) w.para(`Since listing: ${fmtPercent(h.sinceListing.totalReturn, { signed: true })} total return over ${h.sinceListing.years} years.`);
  }

  /* ── Watch items ── */
  w.section("Watch items");
  if (report.monitorables.length === 0) w.para(`${NOT_AVAILABLE}: no monitorables recorded.`, { color: MUTED });
  else {
    w.table(
      [
        { header: "Item", width: W - 280 },
        { header: "Kind", width: 50 },
        { header: "Trigger", width: 130 },
        { header: "Source", width: 100 },
      ],
      report.monitorables.map((m) => [
        { text: m.label },
        { text: m.kind },
        { text: m.trigger ?? NOT_AVAILABLE },
        { text: m.source },
      ]),
    );
  }

  /* ── Appendix ── */
  w.section("Appendix");
  w.sub("Canonical financial data (with source and as-of provenance)");
  const datumRows: RowCell[][] = [];
  const pushDatum = (label: string, d: typeof f.spot): void => {
    if (!d) return;
    let value: string;
    switch (d.unit) {
      case "currency": value = fmtMoneyCompact(d.value, d.currency ?? c); break;
      case "perShare": value = fmtMoney(d.value, d.currency ?? c); break;
      case "fraction": value = fmtPercent(d.value); break;
      case "ratio": value = fmtMultiple(d.value, 2); break;
      case "shares": value = fmtNumber(d.value, { digits: 0, currency: c }); break;
    }
    datumRows.push([
      { text: label },
      { text: value },
      { text: d.periodLabel },
      { text: `${d.source.provider}: ${d.source.field}${d.source.ref ? ` (${d.source.ref})` : ""}` },
      { text: fmtDate(d.asOf) },
    ]);
  };
  pushDatum("Spot price", f.spot);
  pushDatum("Market cap", f.marketCap);
  pushDatum("Shares outstanding", f.sharesOutstanding);
  pushDatum("Total debt", f.totalDebt);
  pushDatum("Total cash", f.totalCash);
  pushDatum("Net debt", f.netDebt);
  pushDatum("Enterprise value", f.enterpriseValue);
  pushDatum("Free cash flow (TTM)", f.freeCashFlowTtm);
  pushDatum("Free cash flow (last FY)", f.freeCashFlowFy);
  pushDatum("EBITDA (TTM)", f.ebitdaTtm);
  pushDatum("Trailing P/E", f.trailingPE);
  pushDatum("Forward P/E", f.forwardPE);
  pushDatum("PEG ratio", f.pegRatio);
  pushDatum("Price/Book", f.priceToBook);
  pushDatum("EV/EBITDA", f.evToEbitda);
  pushDatum("Price/Sales", f.priceToSales);
  pushDatum("Dividend yield", f.dividendYield);
  pushDatum("Return on equity", f.returnOnEquity);
  pushDatum("Return on assets", f.returnOnAssets);
  pushDatum("Gross margin", f.grossMargin);
  pushDatum("Operating margin", f.operatingMargin);
  pushDatum("Net margin", f.netMargin);
  pushDatum("Revenue growth YoY", f.revenueGrowthYoY);
  pushDatum("Earnings growth YoY", f.earningsGrowthYoY);
  pushDatum("Debt/Equity", f.debtToEquity);
  pushDatum("Current ratio", f.currentRatio);
  if (datumRows.length === 0) w.para(`${NOT_AVAILABLE}: no canonical data points resolved.`, { color: MUTED });
  else {
    w.table(
      [
        { header: "Field", width: 105 },
        { header: "Value", width: 85, align: "right" },
        { header: "Period", width: 60 },
        { header: "Source", width: W - 330 },
        { header: "As of", width: 80 },
      ],
      datumRows,
    );
  }

  if (f.statements) {
    const st = f.statements;
    w.sub(`Annual statements (${st.provider}, ${st.currency})`);
    w.table(
      [
        { header: "Fiscal period", width: 110 },
        { header: "Revenue", width: 85, align: "right" },
        { header: "Net income", width: 85, align: "right" },
        { header: "Free cash flow", width: 90, align: "right" },
        { header: "Op. margin", width: 65, align: "right" },
        { header: "Gross margin", width: 64, align: "right" },
      ],
      st.fiscalYears.map((fy) => {
        const pick = (s: { fy: number; end?: string | null; value: number }[]): { fy: number; end?: string | null; value: number } | undefined => s.find((p) => p.fy === fy);
        const rev = pick(st.revenue);
        const money = (p?: { value: number }): string => (p ? fmtMoneyCompact(p.value, st.currency) : NOT_AVAILABLE);
        const pct = (p?: { value: number }): string => (p ? fmtPercent(p.value) : NOT_AVAILABLE);
        return [
          { text: rev ? fmtFiscalPeriod(rev) : `FY${fy}` },
          { text: money(rev) },
          { text: money(pick(st.netIncome)) },
          { text: money(pick(st.freeCashFlow)) },
          { text: pct(pick(st.operatingMargin)) },
          { text: pct(pick(st.grossMargin)) },
        ];
      }),
    );
  }

  w.sub("Generation");
  w.kv("Model", report.model);
  w.kv("Prompt versions", Object.entries(report.promptVersions).map(([k, ver]) => `${k}: ${ver}`).join(", "));
  if (report.timings.length > 0) {
    w.table(
      [{ header: "Stage", width: 200 }, { header: "Duration", width: 100, align: "right" }],
      report.timings.map((tm) => [{ text: tm.stage }, { text: `${fmtNumber(tm.ms, { digits: 0 })} ms` }]),
    );
  } else w.para(`Timings: ${NOT_AVAILABLE}.`, { color: MUTED });

  /* Single disclaimer, once, at the end */
  w.ensure(60);
  doc.moveDown(0.6);
  doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.moveDown(0.4);
  doc.font(BOLD).fontSize(8).fillColor(MUTED).text("Disclaimer", M, doc.y);
  doc.moveDown(0.15);
  doc.font(ITALIC).fontSize(7.5).fillColor(MUTED).text(
    "This report is generated for informational purposes only and is not investment advice. Figures derive from third-party data providers and deterministic models with the stated assumptions; verify against primary sources before acting.",
    M, doc.y, { width: W, lineGap: 1.5 },
  );

  w.finishPageNumbers();
  doc.flushPages();
  doc.end();
  return done;
}

function convictionText(report: ICReport): string {
  if (report.agentFindings.length === 0) return `${NOT_AVAILABLE} (no agent findings to derive conviction from)`;
  const counts = { high: 0, medium: 0, low: 0 };
  for (const a of report.agentFindings) counts[a.confidence]++;
  const order: ("high" | "medium" | "low")[] = ["high", "medium", "low"];
  const top = order.reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return `${top}, derived from ${report.agentFindings.length} agent confidence ratings (${counts.high} high, ${counts.medium} medium, ${counts.low} low)`;
}
