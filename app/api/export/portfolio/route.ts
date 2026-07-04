import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { listPortfolio } from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import type { PortfolioPosition, Quote } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnrichedPosition extends PortfolioPosition {
  quote: Quote | null;
  costBasis: number;
  currentValue: number | null;
  unrealizedPL: number | null;
  unrealizedPct: number | null;
  weight: number | null; // set after total is known
}

async function buildPositions(): Promise<{ positions: EnrichedPosition[]; totalCost: number; totalValue: number }> {
  const raw = listPortfolio();
  const quoteMap: Record<string, Quote> = {};
  if (raw.length > 0) {
    try {
      const quotes = await getQuotes(raw.map((p) => p.symbol));
      for (const q of quotes) quoteMap[q.symbol] = q;
    } catch { /* best-effort */ }
  }

  const enriched: EnrichedPosition[] = raw.map((p) => {
    const q = quoteMap[p.symbol] ?? null;
    const costBasis = p.shares * p.avgCost;
    const currentValue = q ? p.shares * q.price : null;
    const unrealizedPL = currentValue != null ? currentValue - costBasis : null;
    const unrealizedPct = unrealizedPL != null && costBasis > 0 ? (unrealizedPL / costBasis) * 100 : null;
    return { ...p, quote: q, costBasis, currentValue, unrealizedPL, unrealizedPct, weight: null };
  });

  const totalCost = enriched.reduce((s, p) => s + p.costBasis, 0);
  const totalValue = enriched.reduce((s, p) => s + (p.currentValue ?? p.costBasis), 0);
  for (const p of enriched) {
    p.weight = totalValue > 0 ? ((p.currentValue ?? p.costBasis) / totalValue) * 100 : null;
  }

  return { positions: enriched, totalCost, totalValue };
}

function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

/* ──────────────────────────── Excel ──────────────────────────── */
async function buildExcel(positions: EnrichedPosition[], totalCost: number, totalValue: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  const NAVY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
  const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

  /* Sheet 1: Holdings */
  const ws = wb.addWorksheet("Holdings", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
  ws.columns = [
    { key: "symbol", width: 10 },
    { key: "name", width: 26 },
    { key: "shares", width: 10 },
    { key: "avgcost", width: 13 },
    { key: "costbasis", width: 14 },
    { key: "price", width: 13 },
    { key: "value", width: 14 },
    { key: "plDollar", width: 15 },
    { key: "plPct", width: 13 },
    { key: "weight", width: 12 },
  ];

  // Title
  ws.mergeCells(1, 1, 1, 10);
  const titleCell = ws.getRow(1).getCell(1);
  titleCell.value = `Portfolio Holdings — ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`;
  titleCell.fill = NAVY;
  titleCell.font = WHITE_FONT;
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  // Header row
  const hdr = ws.getRow(2);
  hdr.values = ["Symbol", "Company Name", "Shares", "Avg Cost", "Cost Basis", "Current Price", "Current Value", "Unrealized P&L ($)", "Unrealized P&L (%)", "Weight (%)"];
  hdr.eachCell((cell) => {
    cell.fill = BLUE;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  hdr.height = 28;
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 10 } };

  const totalReturnDollar = totalValue - totalCost;
  const totalReturnPct = totalCost > 0 ? (totalReturnDollar / totalCost) * 100 : 0;

  positions.forEach((p, i) => {
    const r = ws.addRow([
      p.symbol,
      p.name,
      p.shares,
      p.avgCost,
      p.costBasis,
      p.quote?.price ?? null,
      p.currentValue,
      p.unrealizedPL,
      p.unrealizedPct != null ? p.unrealizedPct / 100 : null,
      p.weight != null ? p.weight / 100 : null,
    ]);
    const fill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" } };
    r.eachCell((cell) => { cell.fill = fill; cell.font = { size: 9 }; cell.alignment = { vertical: "middle" }; });
    r.getCell(1).font = { bold: true, size: 9, color: { argb: "FF1D4ED8" } };
    [4, 5, 6, 7, 8].forEach((col) => { r.getCell(col).numFmt = '$#,##0.00'; r.getCell(col).alignment = { horizontal: "right" }; });
    r.getCell(9).numFmt = '+0.00%;-0.00%';
    r.getCell(9).alignment = { horizontal: "right" };
    r.getCell(10).numFmt = '0.00%';
    r.getCell(10).alignment = { horizontal: "right" };
    r.getCell(3).numFmt = '#,##0.000';
    r.getCell(3).alignment = { horizontal: "right" };
    // Color P&L
    if (p.unrealizedPL != null) {
      r.getCell(8).font = { size: 9, color: { argb: p.unrealizedPL >= 0 ? "FF065F46" : "FF991B1B" } };
      r.getCell(9).font = { size: 9, color: { argb: p.unrealizedPL >= 0 ? "FF065F46" : "FF991B1B" } };
    }
    r.height = 18;
  });

  // Totals row
  ws.addRow([]);
  const totRow = ws.addRow([
    "TOTAL", "", "", "", totalCost, null, totalValue, totalReturnDollar, totalReturnPct / 100, 1,
  ]);
  totRow.eachCell((cell) => {
    cell.fill = NAVY;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { vertical: "middle" };
  });
  [5, 7, 8].forEach((col) => { totRow.getCell(col).numFmt = '$#,##0.00'; totRow.getCell(col).alignment = { horizontal: "right" }; });
  totRow.getCell(9).numFmt = '+0.00%;-0.00%';
  totRow.getCell(9).alignment = { horizontal: "right" };
  totRow.getCell(10).numFmt = '0%';
  totRow.getCell(10).alignment = { horizontal: "right" };
  totRow.height = 22;

  /* Sheet 2: Summary */
  const wsSumm = wb.addWorksheet("Summary");
  wsSumm.columns = [{ width: 28 }, { width: 20 }];

  const addSummRow = (label: string, value: string, bold = false) => {
    const r = wsSumm.addRow([label, value]);
    r.getCell(1).font = { size: 9, color: { argb: "FF374151" } };
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    r.getCell(2).font = { bold, size: 9, color: { argb: "FF111827" } };
    r.height = 16;
  };

  wsSumm.mergeCells(1, 1, 1, 2);
  const summTitle = wsSumm.getRow(1).getCell(1);
  summTitle.value = "Portfolio Summary";
  summTitle.fill = NAVY;
  summTitle.font = WHITE_FONT;
  summTitle.alignment = { horizontal: "center" };
  wsSumm.getRow(1).height = 24;
  wsSumm.addRow([]);

  addSummRow("Total Cost Basis", compact(totalCost), true);
  addSummRow("Total Current Value", compact(totalValue), true);
  addSummRow("Unrealized P&L ($)", (totalReturnDollar >= 0 ? "+" : "") + compact(totalReturnDollar), true);
  addSummRow("Unrealized P&L (%)", `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(2)}%`, true);
  addSummRow("Number of Positions", String(positions.length));
  addSummRow("Report Date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ──────────────────────────── PDF ──────────────────────────── */
async function buildPdf(positions: EnrichedPosition[], totalCost: number, totalValue: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: "Portfolio Report", Author: "Universal Asset Analyzer" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const W = doc.page.width - 100; // usable width
    const L = 50; // left margin
    const totalReturnDollar = totalValue - totalCost;
    const totalReturnPct = totalCost > 0 ? (totalReturnDollar / totalCost) * 100 : 0;
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // ── Cover header ──
    doc.rect(0, 0, doc.page.width, 90).fill("#0f172a");
    doc.fill("#ffffff").font("Helvetica-Bold").fontSize(20)
      .text("Portfolio Report", L, 24, { width: W });
    doc.fill("#94a3b8").font("Helvetica").fontSize(10)
      .text(`Universal Asset Analyzer  ·  Generated ${dateStr}`, L, 50, { width: W });
    doc.y = 110;

    // ── Summary cards ──
    const cards: Array<{ label: string; value: string; sub?: string; positive?: boolean }> = [
      { label: "Total Value", value: compact(totalValue) },
      { label: "Cost Basis", value: compact(totalCost) },
      { label: "Unrealized P&L", value: `${totalReturnDollar >= 0 ? "+" : ""}${compact(totalReturnDollar)}`, sub: `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(2)}%`, positive: totalReturnDollar >= 0 },
      { label: "Positions", value: String(positions.length) },
    ];

    const cardW = (W - 12) / 4;
    let cardX = L;
    cards.forEach((c) => {
      doc.roundedRect(cardX, doc.y, cardW, 52, 4).fill("#f8fafc");
      doc.roundedRect(cardX, doc.y, cardW, 52, 4).stroke("#e2e8f0");
      doc.fill("#6b7280").font("Helvetica").fontSize(7.5).text(c.label.toUpperCase(), cardX + 8, doc.y + 8, { width: cardW - 16 });
      const plColor = c.positive == null ? "#111827" : c.positive ? "#16a34a" : "#dc2626";
      doc.fill(plColor).font("Helvetica-Bold").fontSize(13).text(c.value, cardX + 8, doc.y + 20, { width: cardW - 16 });
      if (c.sub) {
        doc.fill(plColor).font("Helvetica").fontSize(9).text(c.sub, cardX + 8, doc.y + 36, { width: cardW - 16 });
      }
      cardX += cardW + 4;
    });
    doc.y += 64;
    doc.moveDown(0.5);

    // ── Holdings table ──
    doc.fill("#1e40af").font("Helvetica-Bold").fontSize(11).text("Holdings", L, doc.y);
    doc.moveDown(0.3);

    const colWidths = [55, 130, 45, 60, 65, 65, 65, 55];
    const colLabels = ["Symbol", "Company Name", "Shares", "Avg Cost", "Cost Basis", "Current Value", "P&L ($)", "P&L (%)"];

    // Header row
    let cx = L;
    doc.rect(L, doc.y, W, 18).fill("#0f172a");
    colLabels.forEach((lbl, i) => {
      doc.fill("#ffffff").font("Helvetica-Bold").fontSize(7.5)
        .text(lbl, cx + 3, doc.y - 14, { width: colWidths[i] - 6, align: i <= 1 ? "left" : "right" });
      cx += colWidths[i];
    });
    doc.y += 6;
    doc.moveDown(0.1);

    // Data rows
    positions.forEach((p, i) => {
      const rowH = 16;
      if (doc.y + rowH > doc.page.height - 60) {
        doc.addPage();
        doc.y = 50;
      }
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      doc.rect(L, doc.y, W, rowH).fill(bg);

      cx = L;
      const cells: Array<{ val: string; color?: string; align?: "left" | "right" | "center" }> = [
        { val: p.symbol, color: "#1d4ed8", align: "left" },
        { val: p.name.length > 20 ? p.name.slice(0, 18) + "…" : p.name, align: "left" },
        { val: p.shares.toFixed(p.shares % 1 === 0 ? 0 : 3), align: "right" },
        { val: `$${p.avgCost.toFixed(2)}`, align: "right" },
        { val: compact(p.costBasis), align: "right" },
        { val: p.currentValue != null ? compact(p.currentValue) : "—", align: "right" },
        { val: p.unrealizedPL != null ? `${p.unrealizedPL >= 0 ? "+" : ""}${compact(p.unrealizedPL)}` : "—", color: p.unrealizedPL == null ? "#6b7280" : p.unrealizedPL >= 0 ? "#16a34a" : "#dc2626", align: "right" },
        { val: p.unrealizedPct != null ? `${p.unrealizedPct >= 0 ? "+" : ""}${p.unrealizedPct.toFixed(1)}%` : "—", color: p.unrealizedPct == null ? "#6b7280" : p.unrealizedPct >= 0 ? "#16a34a" : "#dc2626", align: "right" },
      ];

      cells.forEach((cell, ci) => {
        doc.fill(cell.color ?? "#111827").font(ci === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(7.5)
          .text(cell.val, cx + 3, doc.y + 4, { width: colWidths[ci] - 6, align: cell.align ?? "left", lineBreak: false });
        cx += colWidths[ci];
      });
      doc.y += rowH;
    });

    // Totals row
    doc.rect(L, doc.y, W, 20).fill("#0f172a");
    cx = L;
    const totCells = ["TOTAL", "", "", "", compact(totalCost), compact(totalValue),
      `${totalReturnDollar >= 0 ? "+" : ""}${compact(totalReturnDollar)}`,
      `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(1)}%`];
    totCells.forEach((val, i) => {
      const color = i >= 6 ? (totalReturnDollar >= 0 ? "#86efac" : "#fca5a5") : "#ffffff";
      doc.fill(color).font("Helvetica-Bold").fontSize(8)
        .text(val, cx + 3, doc.y + 6, { width: colWidths[i] - 6, align: i <= 1 ? "left" : "right", lineBreak: false });
      cx += colWidths[i];
    });
    doc.y += 28;

    // ── Footer ──
    doc.fontSize(7).fill("#9ca3af")
      .text(`Generated by Universal Asset Analyzer · ${dateStr} · Prices are live at time of export and may not reflect real-time values.`,
        L, doc.page.height - 35, { width: W, align: "center" });

    doc.end();
  });
}

/** GET /api/export/portfolio?format=excel|pdf */
export async function GET(req: Request): Promise<Response> {
  const format = new URL(req.url).searchParams.get("format") ?? "excel";
  const { positions, totalCost, totalValue } = await buildPositions();
  const date = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    const buf = await buildPdf(positions, totalCost, totalValue);
    const pdfArrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Response(pdfArrayBuf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="portfolio-${date}.pdf"`,
      },
    });
  }

  const buf = await buildExcel(positions, totalCost, totalValue);
  const xlsxArrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Response(xlsxArrayBuf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="portfolio-${date}.xlsx"`,
    },
  });
}
