import PDFDocument from "pdfkit";
import { drawBrandMark } from "@/lib/brand/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ICSignal { id: string; category: string; severity: "high" | "medium" | "low"; description: string }
interface AgentFinding { agent: string; agentLabel: string; questionsAnswered: number; findings: string; keyInsights?: string[]; confidence: "high" | "medium" | "low"; dataLimitations?: string | null }
interface AgentFailure { agent: string; agentLabel: string; error: string }
interface ValuationApproach { method: string; priceTarget: string; impliedUpside: string; assumptions: string; confidence: string }
interface ValuationScenario { label: string; priceTarget: string; impliedUpside: string; keyAssumptions: string[] }
interface ICValuation { currentPrice: string; intrinsicValueRange: string; impliedUpside: string; approaches: ValuationApproach[]; scenarios: ValuationScenario[]; dcfSensitivity?: string; valuationVerdict: string }
interface Thesis { bull: string; bear: string; base: string; variantPerception?: string; marketExpectations?: string; keyCatalysts?: string[]; keyRisks?: string[]; keyDrivers?: string[] }
interface RunHotCold { oneYearReturn: number; medianReturn: number; percentile: number; signal: "run_hot" | "run_cold" | "neutral" }

interface ICReport {
  symbol: string;
  companyName: string;
  generatedAt: string;
  model: string;
  signals: ICSignal[];
  agentFindings: AgentFinding[];
  agentFailures?: AgentFailure[];
  thesis: Thesis;
  valuation: ICValuation;
  monitorables: string[];
  runHotCold: RunHotCold | null;
}

const SEV_COLOR: Record<string, string> = { high: "#dc2626", medium: "#d97706", low: "#16a34a" };
const CONF_COLOR: Record<string, string> = { high: "#16a34a", medium: "#d97706", low: "#dc2626" };

/**
 * Strip JSON artifacts from agent findings text.
 * The LLM occasionally returns a partially-parsed JSON string where
 * the "findings" value was extracted but the tail (keyInsights, confidence,
 * dataLimitations) was left in the string, or the whole JSON blob slipped through.
 */
function sanitizeFindings(raw: string): string {
  if (!raw) return "—";
  const trimmed = raw.trim();

  // If it starts with { it may be raw JSON — try parsing it
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.findings === "string" && parsed.findings.length > 10) {
        return parsed.findings;
      }
    } catch { /* fall through to regex cleanup */ }
  }

  // Remove residual JSON tail fragments that appear after the findings text
  return trimmed
    // Remove trailing ", "keyInsights": [...] ... } block
    .replace(/",?\s*"keyInsights"\s*:\s*\[[\s\S]*$/m, "")
    // Remove trailing ", "confidence": "...", ... } block
    .replace(/",?\s*"confidence"\s*:\s*"[^"]*"[\s\S]*$/m, "")
    // Remove trailing ", "dataLimitations": ... block
    .replace(/",?\s*"dataLimitations"\s*:[\s\S]*$/m, "")
    // Strip leading/trailing JSON quotes and commas
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

/** Sanitize any string — strip JSON key/value noise and unescape */
function safeText(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() || "—";
}

/** Draw a running page header */
function pageHeader(doc: PDFKit.PDFDocument, symbol: string, companyName: string, L: number, W: number) {
  // The mark on every page's running header, at 11pt so it sits on the same
  // optical line as the 7pt rule text without becoming the loudest thing on a
  // page of prose. Light scheme: this is white paper.
  drawBrandMark(doc, { x: L, y: 25, size: 11, scheme: "light" });
  doc.fill("#9ca3af").font("Helvetica").fontSize(7)
    .text(`${symbol} · ${companyName} · IC Research Report`, L + 16, 28, { width: W - 76 });
  doc.fill("#d1d5db").font("Helvetica").fontSize(7)
    .text(`Universal Asset Analyzer`, L, 28, { width: W, align: "right" });
  doc.moveTo(L, 38).lineTo(L + W, 38).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
}

/** Add a new page and draw the running header */
function newPage(doc: PDFKit.PDFDocument, symbol: string, companyName: string, L: number, W: number): void {
  doc.addPage();
  pageHeader(doc, symbol, companyName, L, W);
  doc.y = 50;
}

/** Check if we need a new page, add one if so. Returns the new y. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number, symbol: string, companyName: string, L: number, W: number): void {
  if (doc.y + needed > doc.page.height - 60) {
    newPage(doc, symbol, companyName, L, W);
  }
}

/** Draw a dark section header bar */
function sectionHeader(doc: PDFKit.PDFDocument, title: string, L: number, W: number, symbol: string, companyName: string) {
  ensureSpace(doc, 30, symbol, companyName, L, W);
  doc.moveDown(0.5);
  const y = doc.y;
  doc.rect(L, y, W, 20).fill("#1e3a5f");
  doc.fill("#ffffff").font("Helvetica-Bold").fontSize(10)
    .text(title, L + 10, y + 5, { width: W - 20, lineBreak: false });
  doc.y = y + 26;
}

/** Small colored badge */
function badge(doc: PDFKit.PDFDocument, label: string, color: string, x: number, y: number): number {
  const w = Math.max(28, label.length * 5 + 12);
  doc.roundedRect(x, y, w, 12, 2).fill(color + "25");
  doc.fill(color).font("Helvetica-Bold").fontSize(6)
    .text(label.toUpperCase(), x + 6, y + 3, { width: w - 12, lineBreak: false });
  return w + 4;
}

/** POST /api/export/ic-report — body: { report: ICReport } */
export async function POST(req: Request): Promise<Response> {
  let report: ICReport;
  try {
    const body = await req.json() as { report?: ICReport };
    if (!body.report) throw new Error("missing report");
    report = body.report;
  } catch {
    return new Response("Invalid JSON or missing report", { status: 400 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const dateStr = new Date(report.generatedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const buf = await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: { Title: `IC Report — ${report.symbol}`, Author: "Universal Asset Analyzer" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const W = doc.page.width - 100; // 495 on A4
    const L = 50;

    /* ════════════════════════════════════════════
       COVER PAGE
    ════════════════════════════════════════════ */
    doc.rect(0, 0, doc.page.width, doc.page.height).fill("#0f172a");

    // The real mark, centred above the name. This was `"◆  UNIVERSAL ASSET
    // ANALYZER"` — a Unicode diamond standing in for the logo on the cover of the
    // product's flagship deliverable, rendered in whatever symbol font the PDF
    // reader happened to substitute.
    drawBrandMark(doc, { x: doc.page.width / 2 - 15, y: 56, size: 30, scheme: "dark" });
    doc.fill("#3b82f6").font("Helvetica-Bold").fontSize(10)
      .text("UNIVERSAL ASSET ANALYZER", L, 94, { width: W, align: "center", characterSpacing: 1.2 });

    doc.fill("#ffffff").font("Helvetica-Bold").fontSize(34)
      .text("Investment Committee", L, 120, { width: W, align: "center" });
    doc.fill("#94a3b8").font("Helvetica-Bold").fontSize(24)
      .text("Research Report", L, 160, { width: W, align: "center" });

    // Symbol box
    const boxX = L + W / 2 - 75;
    doc.roundedRect(boxX, 210, 150, 46, 6).fill("#1e3a5f");
    doc.fill("#60a5fa").font("Helvetica-Bold").fontSize(26)
      .text(report.symbol, boxX, 222, { width: 150, align: "center", lineBreak: false });

    doc.fill("#e2e8f0").font("Helvetica").fontSize(13)
      .text(report.companyName, L, 272, { width: W, align: "center" });

    // Divider
    doc.moveTo(L + 80, 302).lineTo(L + W - 80, 302).lineWidth(0.5).strokeColor("#334155").stroke();

    doc.fill("#94a3b8").font("Helvetica").fontSize(9)
      .text(`Generated: ${dateStr}`, L, 314, { width: W, align: "center" });
    doc.fill("#64748b").font("Helvetica").fontSize(8)
      .text(`AI Model: ${report.model}  ·  ${report.signals.length} Signals Detected  ·  ${report.agentFindings.length} Agent Investigations`, L, 332, { width: W, align: "center" });

    const highSig = report.signals.filter((s) => s.severity === "high").length;
    const medSig  = report.signals.filter((s) => s.severity === "medium").length;
    const lowSig  = report.signals.filter((s) => s.severity === "low").length;
    doc.fill("#64748b").font("Helvetica").fontSize(8)
      .text(`High Risk Signals: ${highSig}  ·  Medium: ${medSig}  ·  Positive: ${lowSig}`, L, 350, { width: W, align: "center" });

    // Table of Contents
    doc.moveTo(L + 40, 385).lineTo(L + W - 40, 385).lineWidth(0.5).strokeColor("#1e3a5f").stroke();
    doc.fill("#64748b").font("Helvetica-Bold").fontSize(8)
      .text("CONTENTS", L, 395, { width: W, align: "center" });

    const toc = [
      ["01", "Signal Detection"],
      ["02", "Investigation Agent Network"],
      ["03", "Investment Thesis"],
      ["04", "Valuation"],
      ["05", "Key Monitorables"],
      ...(report.runHotCold ? [["06", "Run Hot / Cold Indicator"]] : []),
    ];
    toc.forEach(([num, title], i) => {
      doc.fill("#3b82f6").font("Helvetica-Bold").fontSize(8)
        .text(num, L + 140, 415 + i * 16, { width: 20, lineBreak: false });
      doc.fill("#94a3b8").font("Helvetica").fontSize(8)
        .text(title, L + 162, 415 + i * 16, { width: 200, lineBreak: false });
    });

    doc.fill("#334155").font("Helvetica").fontSize(7)
      .text("For informational purposes only. Not financial advice. Verify all data independently.", L, doc.page.height - 50, { width: W, align: "center" });

    /* ════════════════════════════════════════════
       PAGE 2: SIGNAL DETECTION
    ════════════════════════════════════════════ */
    newPage(doc, report.symbol, report.companyName, L, W);

    sectionHeader(doc, "01   Signal Detection", L, W, report.symbol, report.companyName);

    if (report.signals.length === 0) {
      doc.fill("#6b7280").font("Helvetica").fontSize(9)
        .text("No material signals detected in this analysis.", L + 4, doc.y + 4);
      doc.y += 20;
    } else {
      report.signals.forEach((sig) => {
        const color = SEV_COLOR[sig.severity] ?? "#6b7280";
        const desc = safeText(sig.description);

        // Measure height accurately
        const textH = doc.heightOfString(desc, { width: W - 30, lineGap: 2 });
        const boxH = textH + 28;

        ensureSpace(doc, boxH + 6, report.symbol, report.companyName, L, W);

        const y0 = doc.y;
        // Left accent bar
        doc.rect(L, y0, 3, boxH).fill(color);
        // Box background
        doc.rect(L + 3, y0, W - 3, boxH).fill(color + "08");

        // Category + severity badges on same line
        const catLabel = sig.category.replace(/_/g, " ");
        doc.fill(color).font("Helvetica-Bold").fontSize(8)
          .text(catLabel, L + 10, y0 + 7, { lineBreak: false });
        const sevLabel = `  [${sig.severity.toUpperCase()}]`;
        doc.fill(color + "aa").font("Helvetica").fontSize(7.5)
          .text(sevLabel, { lineBreak: false });

        // Description
        doc.fill("#1f2937").font("Helvetica").fontSize(8.5)
          .text(desc, L + 10, y0 + 18, { width: W - 20, lineGap: 2 });

        doc.y = y0 + boxH + 5;
      });
    }

    /* ════════════════════════════════════════════
       AGENT FINDINGS
    ════════════════════════════════════════════ */
    sectionHeader(doc, "02   Investigation Agent Network", L, W, report.symbol, report.companyName);

    doc.fill("#6b7280").font("Helvetica").fontSize(8)
      .text(`${report.agentFindings.length} specialized AI agents investigated this company.`, L + 2, doc.y);
    doc.y += 12;

    if (report.agentFailures && report.agentFailures.length > 0) {
      doc.fill("#d97706").font("Helvetica-Bold").fontSize(8)
        .text(
          `${report.agentFailures.length} agent(s) failed and are missing from this report: ` +
          report.agentFailures.map((f) => f.agentLabel).join(", "),
          L + 2,
          doc.y,
          { width: W - 4 },
        );
      doc.y += 14;
    }

    report.agentFindings.forEach((finding) => {
      const confColor = CONF_COLOR[finding.confidence] ?? "#6b7280";

      // Sanitize findings text — strip any JSON artifacts
      const findingsText = sanitizeFindings(finding.findings ?? "");

      // Prepare insights
      const insights = (finding.keyInsights ?? []).filter(Boolean).slice(0, 5);

      // Measure content heights accurately
      const HEADER_H = 22;
      const INNER_W = W - 24;
      const findingsH = doc.heightOfString(findingsText, { width: INNER_W, lineGap: 2 });
      const insightsH = insights.length > 0
        ? insights.reduce((acc, ins) => acc + doc.heightOfString(`→ ${ins}`, { width: INNER_W - 10, lineGap: 1.5 }) + 2, 0) + 6
        : 0;
      const limitH = finding.dataLimitations
        ? doc.heightOfString(`Data note: ${finding.dataLimitations}`, { width: INNER_W, lineGap: 1.5 }) + 4
        : 0;
      const boxH = HEADER_H + findingsH + insightsH + limitH + 14;

      ensureSpace(doc, boxH + 8, report.symbol, report.companyName, L, W);

      const y0 = doc.y;

      // Box outline
      doc.roundedRect(L, y0, W, boxH, 4).fill("#fafafa").stroke("#e5e7eb");

      // Header bar
      doc.roundedRect(L, y0, W, HEADER_H, 4).fill("#1e293b");
      // Fix bottom-left/right rounding of header by filling those corners
      doc.rect(L, y0 + HEADER_H - 4, W, 4).fill("#1e293b");

      // Agent label in header
      doc.fill("#f1f5f9").font("Helvetica-Bold").fontSize(8.5)
        .text(safeText(finding.agentLabel), L + 8, y0 + 6, { width: W - 80, lineBreak: false });

      // Confidence badge in header (right-aligned)
      badge(doc, finding.confidence, confColor, L + W - 62, y0 + 5);

      // Questions answered
      doc.fill("#94a3b8").font("Helvetica").fontSize(6.5)
        .text(`${finding.questionsAnswered} question${finding.questionsAnswered !== 1 ? "s" : ""} answered`, L + 8, y0 + HEADER_H - 8, { lineBreak: false });

      // Findings text
      let textY = y0 + HEADER_H + 6;
      doc.fill("#1f2937").font("Helvetica").fontSize(8.5)
        .text(findingsText, L + 10, textY, { width: INNER_W, lineGap: 2 });
      textY += findingsH + 4;

      // Key insights
      if (insights.length > 0) {
        doc.moveTo(L + 10, textY).lineTo(L + W - 10, textY).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
        textY += 5;
        insights.forEach((ins) => {
          doc.fill("#1d4ed8").font("Helvetica-Bold").fontSize(7.5)
            .text("→ ", L + 10, textY, { lineBreak: false });
          doc.fill("#374151").font("Helvetica").fontSize(7.5)
            .text(safeText(ins), { width: INNER_W - 10, lineGap: 1.5 });
          textY = doc.y + 2;
        });
      }

      // Data limitations note
      if (finding.dataLimitations) {
        doc.fill("#9ca3af").font("Helvetica").fontSize(7)
          .text(`Data note: ${safeText(finding.dataLimitations)}`, L + 10, textY, { width: INNER_W, lineGap: 1.5 });
      }

      doc.y = y0 + boxH + 8;
    });

    /* ════════════════════════════════════════════
       THESIS
    ════════════════════════════════════════════ */
    sectionHeader(doc, "03   Investment Thesis", L, W, report.symbol, report.companyName);

    const cases: Array<{ label: string; text: string; color: string; bg: string; borderColor: string }> = [
      { label: "Base Case", text: safeText(report.thesis.base), color: "#1d4ed8", bg: "#eff6ff", borderColor: "#bfdbfe" },
      { label: "Bull Case", text: safeText(report.thesis.bull), color: "#15803d", bg: "#f0fdf4", borderColor: "#bbf7d0" },
      { label: "Bear Case", text: safeText(report.thesis.bear), color: "#dc2626", bg: "#fef2f2", borderColor: "#fecaca" },
    ];

    cases.forEach((c) => {
      const textH = doc.heightOfString(c.text, { width: W - 22, lineGap: 2 });
      const boxH = textH + 28;
      ensureSpace(doc, boxH + 8, report.symbol, report.companyName, L, W);

      const y0 = doc.y;
      doc.roundedRect(L, y0, W, boxH, 4).fill(c.bg).stroke(c.borderColor);
      doc.rect(L, y0, 4, boxH).fill(c.color);

      doc.fill(c.color).font("Helvetica-Bold").fontSize(9)
        .text(c.label, L + 12, y0 + 7, { width: W - 24, lineBreak: false });
      doc.fill("#1f2937").font("Helvetica").fontSize(8.5)
        .text(c.text, L + 12, y0 + 19, { width: W - 22, lineGap: 2 });

      doc.y = y0 + boxH + 8;
    });

    // Variant perception
    if (report.thesis.variantPerception) {
      const vp = safeText(report.thesis.variantPerception);
      const vpH = doc.heightOfString(vp, { width: W - 22, lineGap: 2 });
      ensureSpace(doc, vpH + 30, report.symbol, report.companyName, L, W);

      doc.fill("#7c3aed").font("Helvetica-Bold").fontSize(9)
        .text("Variant Perception", L, doc.y);
      doc.y += 14;
      doc.fill("#1f2937").font("Helvetica").fontSize(8.5)
        .text(vp, L, doc.y, { width: W, lineGap: 2 });
      doc.y += vpH + 10;
    }

    // Catalysts
    if (report.thesis.keyCatalysts?.length) {
      ensureSpace(doc, 30, report.symbol, report.companyName, L, W);
      doc.fill("#15803d").font("Helvetica-Bold").fontSize(9).text("Key Catalysts", L, doc.y);
      doc.y += 12;
      report.thesis.keyCatalysts.forEach((cat) => {
        const t = safeText(cat);
        const h = doc.heightOfString(t, { width: W - 16, lineGap: 1.5 }) + 2;
        ensureSpace(doc, h, report.symbol, report.companyName, L, W);
        doc.fill("#16a34a").font("Helvetica-Bold").fontSize(8).text("✓  ", L, doc.y, { continued: true });
        doc.fill("#374151").font("Helvetica").fontSize(8).text(t, { width: W - 16, lineGap: 1.5 });
        doc.y += 2;
      });
      doc.y += 6;
    }

    // Risks
    if (report.thesis.keyRisks?.length) {
      ensureSpace(doc, 30, report.symbol, report.companyName, L, W);
      doc.fill("#dc2626").font("Helvetica-Bold").fontSize(9).text("Key Risks", L, doc.y);
      doc.y += 12;
      report.thesis.keyRisks.forEach((risk) => {
        const t = safeText(risk);
        const h = doc.heightOfString(t, { width: W - 16, lineGap: 1.5 }) + 2;
        ensureSpace(doc, h, report.symbol, report.companyName, L, W);
        doc.fill("#dc2626").font("Helvetica-Bold").fontSize(8).text("⚠  ", L, doc.y, { continued: true });
        doc.fill("#374151").font("Helvetica").fontSize(8).text(t, { width: W - 16, lineGap: 1.5 });
        doc.y += 2;
      });
      doc.y += 6;
    }

    /* ════════════════════════════════════════════
       VALUATION
    ════════════════════════════════════════════ */
    sectionHeader(doc, "04   Valuation", L, W, report.symbol, report.companyName);

    // Three-column summary strip
    ensureSpace(doc, 44, report.symbol, report.companyName, L, W);
    const valItems: [string, string][] = [
      ["Current Price", safeText(report.valuation.currentPrice)],
      ["Intrinsic Value Range", safeText(report.valuation.intrinsicValueRange)],
      ["Implied Upside", safeText(report.valuation.impliedUpside)],
    ];
    const colW = W / 3;
    const stripY = doc.y;
    doc.rect(L, stripY, W, 40).fill("#f8fafc").stroke("#e5e7eb");

    valItems.forEach(([label, val], i) => {
      const x = L + i * colW;
      if (i > 0) doc.moveTo(x, stripY + 4).lineTo(x, stripY + 36).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
      doc.fill("#6b7280").font("Helvetica").fontSize(7).text(label, x + 8, stripY + 6, { width: colW - 16, lineBreak: false });
      const isNeg = val.includes("-");
      const isPos = val.includes("+");
      const valColor = isPos ? "#16a34a" : isNeg ? "#dc2626" : "#111827";
      doc.fill(valColor).font("Helvetica-Bold").fontSize(12)
        .text(val, x + 8, stripY + 18, { width: colW - 16, lineBreak: false });
    });
    doc.y = stripY + 48;

    // Valuation verdict
    if (report.valuation.valuationVerdict) {
      const vv = safeText(report.valuation.valuationVerdict);
      const vvH = doc.heightOfString(vv, { width: W, lineGap: 2 });
      ensureSpace(doc, vvH + 20, report.symbol, report.companyName, L, W);
      doc.fill("#1d4ed8").font("Helvetica-Bold").fontSize(9).text("Valuation Verdict", L, doc.y);
      doc.y += 12;
      doc.fill("#1f2937").font("Helvetica").fontSize(8.5).text(vv, L, doc.y, { width: W, lineGap: 2 });
      doc.y += vvH + 10;
    }

    // Scenarios
    if (report.valuation.scenarios?.length) {
      ensureSpace(doc, 30, report.symbol, report.companyName, L, W);
      doc.fill("#374151").font("Helvetica-Bold").fontSize(9).text("Scenarios", L, doc.y);
      doc.y += 12;

      const scenColors: Record<string, string> = { Bull: "#15803d", Bear: "#dc2626", Base: "#1d4ed8" };
      report.valuation.scenarios.forEach((sc) => {
        const label = safeText(sc.label);
        const color = scenColors[label] ?? "#374151";
        const assumptions = (sc.keyAssumptions ?? []).map((a) => `• ${safeText(a)}`).join("\n");
        const assH = assumptions ? doc.heightOfString(assumptions, { width: W - 180, lineGap: 1.5 }) : 0;
        const rowH = Math.max(28, assH + 14);
        ensureSpace(doc, rowH + 4, report.symbol, report.companyName, L, W);

        const y0 = doc.y;
        doc.roundedRect(L, y0, W, rowH, 3).fill("#ffffff").stroke("#e5e7eb");
        doc.rect(L, y0, 3, rowH).fill(color);
        doc.fill(color).font("Helvetica-Bold").fontSize(8.5)
          .text(label, L + 10, y0 + 5, { width: 70, lineBreak: false });
        doc.fill("#111827").font("Helvetica-Bold").fontSize(9)
          .text(safeText(sc.priceTarget), L + 85, y0 + 5, { width: 70, lineBreak: false });
        const upColor = sc.impliedUpside?.includes("+") ? "#16a34a" : sc.impliedUpside?.includes("-") ? "#dc2626" : "#6b7280";
        doc.fill(upColor).font("Helvetica-Bold").fontSize(8.5)
          .text(safeText(sc.impliedUpside), L + 155, y0 + 5, { width: 55, lineBreak: false });
        if (assumptions) {
          doc.fill("#6b7280").font("Helvetica").fontSize(7.5)
            .text(assumptions, L + 215, y0 + 5, { width: W - 225, lineGap: 1.5 });
        }
        doc.y = y0 + rowH + 4;
      });
      doc.y += 6;
    }

    // Approaches table
    if (report.valuation.approaches?.length) {
      ensureSpace(doc, 50, report.symbol, report.companyName, L, W);
      doc.fill("#374151").font("Helvetica-Bold").fontSize(9).text("Valuation Approaches", L, doc.y);
      doc.y += 12;

      const colWidths = [W * 0.22, W * 0.14, W * 0.14, W * 0.35, W * 0.15];
      const headers = ["Method", "Price Target", "Implied Upside", "Key Assumptions", "Confidence"];

      // Header row
      const hdrY = doc.y;
      doc.rect(L, hdrY, W, 16).fill("#334155");
      let ax = L;
      headers.forEach((h, i) => {
        doc.fill("#ffffff").font("Helvetica-Bold").fontSize(7)
          .text(h, ax + 4, hdrY + 4, { width: colWidths[i] - 8, lineBreak: false });
        ax += colWidths[i];
      });
      doc.y = hdrY + 16;

      report.valuation.approaches.forEach((ap, ri) => {
        const cells = [
          safeText(ap.method),
          safeText(ap.priceTarget),
          safeText(ap.impliedUpside),
          safeText(ap.assumptions),
          safeText(ap.confidence),
        ];
        const rowH = Math.max(20, doc.heightOfString(cells[3], { width: colWidths[3] - 8, lineGap: 1.5 }) + 8);
        ensureSpace(doc, rowH, report.symbol, report.companyName, L, W);

        const ry = doc.y;
        doc.rect(L, ry, W, rowH).fill(ri % 2 === 0 ? "#ffffff" : "#f8fafc");
        ax = L;
        cells.forEach((val, ci) => {
          const uc = ci === 2 && ap.impliedUpside?.includes("+") ? "#16a34a"
            : ci === 2 && ap.impliedUpside?.includes("-") ? "#dc2626"
            : "#374151";
          doc.fill(uc).font(ci === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(7.5)
            .text(val, ax + 4, ry + 4, { width: colWidths[ci] - 8, lineGap: 1.5 });
          ax += colWidths[ci];
        });
        doc.y = ry + rowH;
      });
      doc.y += 8;
    }

    /* ════════════════════════════════════════════
       MONITORABLES
    ════════════════════════════════════════════ */
    sectionHeader(doc, "05   Key Monitorables (Watch Items)", L, W, report.symbol, report.companyName);

    doc.fill("#6b7280").font("Helvetica").fontSize(8)
      .text("Watch for these signals — any significant change would alter the investment thesis.", L + 2, doc.y);
    doc.y += 12;

    report.monitorables.forEach((m, i) => {
      const t = safeText(m);
      const textH = doc.heightOfString(t, { width: W - 32, lineGap: 1.5 });
      const rowH = textH + 12;
      ensureSpace(doc, rowH + 3, report.symbol, report.companyName, L, W);

      const ry = doc.y;
      doc.rect(L, ry, W, rowH).fill(i % 2 === 0 ? "#f8fafc" : "#ffffff");
      doc.fill("#1d4ed8").font("Helvetica-Bold").fontSize(9)
        .text(`${i + 1}.`, L + 6, ry + 5, { width: 16, lineBreak: false });
      doc.fill("#1f2937").font("Helvetica").fontSize(8.5)
        .text(t, L + 24, ry + 5, { width: W - 32, lineGap: 1.5 });
      doc.y = ry + rowH + 3;
    });

    /* ════════════════════════════════════════════
       RUN HOT / COLD
    ════════════════════════════════════════════ */
    if (report.runHotCold) {
      sectionHeader(doc, "06   Run Hot / Cold Indicator", L, W, report.symbol, report.companyName);
      const rhc = report.runHotCold;
      const sig = rhc.signal;
      const sigColor = sig === "run_hot" ? "#dc2626" : sig === "run_cold" ? "#16a34a" : "#d97706";
      const sigBg    = sig === "run_hot" ? "#fef2f2" : sig === "run_cold" ? "#f0fdf4" : "#fffbeb";
      const sigLabel = sig === "run_hot"  ? "RUN HOT — Trading Near Historical Highs"
        : sig === "run_cold" ? "RUN COLD — Trading Near Historical Lows"
        : "NEUTRAL — Within Normal Historical Range";

      ensureSpace(doc, 60, report.symbol, report.companyName, L, W);
      const y0 = doc.y;
      doc.roundedRect(L, y0, W, 50, 6).fill(sigBg).stroke(sigColor + "60");
      doc.fill(sigColor).font("Helvetica-Bold").fontSize(11)
        .text(sigLabel, L + 14, y0 + 10, { width: W - 28 });
      doc.fill("#374151").font("Helvetica").fontSize(8.5)
        .text(
          `1-Year Return: ${rhc.oneYearReturn >= 0 ? "+" : ""}${rhc.oneYearReturn.toFixed(1)}%  ·  Historical Median: ${rhc.medianReturn >= 0 ? "+" : ""}${rhc.medianReturn.toFixed(1)}%  ·  Percentile: ${rhc.percentile.toFixed(0)}th`,
          L + 14, y0 + 28, { width: W - 28 },
        );
      doc.y = y0 + 58;
    }

    /* ════════════════════════════════════════════
       FOOTER (last page)
    ════════════════════════════════════════════ */
    doc.moveTo(L, doc.page.height - 40).lineTo(L + W, doc.page.height - 40)
      .lineWidth(0.5).strokeColor("#e5e7eb").stroke();
    doc.fill("#9ca3af").font("Helvetica").fontSize(7)
      .text(
        "Universal Asset Analyzer · IC Research Report · For informational purposes only. Not financial advice. Always conduct your own due diligence.",
        L, doc.page.height - 34, { width: W, align: "center" },
      );

    doc.end();
  });

  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Response(arrayBuf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ic-report-${report.symbol}-${date}.pdf"`,
    },
  });
}
