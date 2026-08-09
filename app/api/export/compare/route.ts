import ExcelJS from "exceljs";
import type { CompareEntry } from "@/app/api/compare/route";
import { resolveRowHighlights } from "@/lib/compare/metrics";
import { SECTIONS, rowValues, score100, pctSigned, pctAbs, xRatio } from "@/lib/compare/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompareExportPayload {
  entries: CompareEntry[];
  aiVerdict?: string;
}

/** Null-safe wrapper for the registry's number-only formatters. */
const orDash = (v: number | null | undefined, f: (v: number) => string): string =>
  v == null ? "—" : f(v);

const NAVY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
const SECTION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

// Stock column colors (for the symbol header rows) — same hue order as the
// page's categorical palette (violet, sky, teal, amber, pink).
const COL_ARGB = ["FF7C3AED", "FF0284C7", "FF0F766E", "FFB45309", "FFBE185D"];

/** POST /api/export/compare — body: CompareExportPayload */
export async function POST(req: Request): Promise<Response> {
  let payload: CompareExportPayload;
  try {
    payload = await req.json() as CompareExportPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { entries, aiVerdict } = payload;
  const n = Math.min(entries.length, 5);
  const date = new Date().toISOString().slice(0, 10);
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  /* ── Sheet 1: Comparison ── */
  const ws = wb.addWorksheet("Comparison", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
  });

  // Column widths: col 1 = metric label, cols 2..N+1 = stock data
  ws.columns = [
    { width: 26 },
    ...entries.slice(0, 5).map(() => ({ width: 18 })),
  ];

  // Row 1: Report title (merged across all columns)
  ws.mergeCells(1, 1, 1, n + 1);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Asset Comparison Report  ·  ${dateStr}`;
  titleCell.fill = NAVY;
  titleCell.font = { ...WHITE_FONT, size: 12 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  // Row 2: Price row header + current prices
  ws.getCell(2, 1).value = "Current Price";
  ws.getCell(2, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  ws.getCell(2, 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
  ws.getCell(2, 1).alignment = { horizontal: "left", vertical: "middle" };

  entries.slice(0, 5).forEach((e, i) => {
    const cell = ws.getCell(2, i + 2);
    const price = e.quote?.price != null ? `$${e.quote.price.toFixed(2)}` : "—";
    cell.value = price;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.getRow(2).height = 18;

  // Row 3: Symbol header row
  ws.getCell(3, 1).value = "Metric";
  ws.getCell(3, 1).fill = BLUE;
  ws.getCell(3, 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
  ws.getCell(3, 1).alignment = { horizontal: "left", vertical: "middle" };

  entries.slice(0, 5).forEach((e, i) => {
    const cell = ws.getCell(3, i + 2);
    const nameTrunc = (e.name ?? "").length > 20 ? (e.name ?? "").slice(0, 18) + "…" : (e.name ?? "");
    cell.value = `${e.symbol}\n${nameTrunc}`;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_ARGB[i] } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.getRow(3).height = 30;

  // Data rows — grouped by section
  let rowIdx = 4;

  SECTIONS.forEach((section) => {
    // Section header row
    ws.mergeCells(rowIdx, 1, rowIdx, n + 1);
    const secCell = ws.getCell(rowIdx, 1);
    secCell.value = section.title.toUpperCase();
    secCell.fill = SECTION_FILL;
    secCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9, italic: false };
    secCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(rowIdx).height = 18;
    rowIdx++;

    section.metrics.forEach((metric, mi) => {
      // Same applicability + winner resolution as the page's table — a bank's
      // gross margin exports as "n/a", ties mark every tied cell, and best
      // AND worst both get a treatment.
      const cells = rowValues(metric, entries.slice(0, 5));
      const values = cells.map((c) => c.value);
      const winners = resolveRowHighlights(values, metric.direction, metric.format);

      const rowBg = mi % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";

      // Metric label cell
      const labelCell = ws.getCell(rowIdx, 1);
      labelCell.value = metric.label;
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      labelCell.font = { size: 9, color: { argb: "FF374151" } };
      labelCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

      // Value cells
      values.forEach((val, i) => {
        const cell = ws.getCell(rowIdx, i + 2);
        const isBest = winners?.best.includes(i) ?? false;
        const isWorst = winners?.worst.includes(i) ?? false;

        const suffix = metric.format === score100 ? "/100" : "";
        const formatted = cells[i].naReason ? "n/a" : val == null ? "—" : `${metric.format(val)}${suffix}`;

        cell.value = formatted;
        cell.alignment = { horizontal: "center", vertical: "middle" };

        if (isBest) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
          cell.font = { bold: true, size: 9, color: { argb: "FF065F46" } };
        } else if (isWorst) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
          cell.font = { bold: true, size: 9, color: { argb: "FF991B1B" } };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
          // Signed metrics keep their own sign color — the only case the number itself is colored, matching the page.
          if (metric.signed && val != null && val > 0) {
            cell.font = { size: 9, color: { argb: "FF047857" } };
          } else if (metric.signed && val != null && val < 0) {
            cell.font = { size: 9, color: { argb: "FFDC2626" } };
          } else {
            cell.font = { size: 9, color: { argb: cells[i].naReason ? "FF9CA3AF" : "FF374151" } };
          }
        }
      });

      ws.getRow(rowIdx).height = 17;
      rowIdx++;
    });

    // Spacer row between sections
    ws.getRow(rowIdx).height = 4;
    rowIdx++;
  });

  // AI Verdict (if present)
  if (aiVerdict && aiVerdict.trim()) {
    rowIdx++;
    ws.mergeCells(rowIdx, 1, rowIdx, n + 1);
    const verdictHeader = ws.getCell(rowIdx, 1);
    verdictHeader.value = "AI Analysis Verdict";
    verdictHeader.fill = SECTION_FILL;
    verdictHeader.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    verdictHeader.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(rowIdx).height = 18;
    rowIdx++;

    ws.mergeCells(rowIdx, 1, rowIdx, n + 1);
    const verdictCell = ws.getCell(rowIdx, 1);
    verdictCell.value = aiVerdict.trim();
    verdictCell.font = { size: 9, color: { argb: "FF1F2937" } };
    verdictCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true, indent: 1 };
    ws.getRow(rowIdx).height = Math.max(20, Math.ceil(aiVerdict.length / 100) * 14);
    rowIdx++;
  }

  // Disclaimer row
  rowIdx++;
  ws.mergeCells(rowIdx, 1, rowIdx, n + 1);
  const disclaimerCell = ws.getCell(rowIdx, 1);
  disclaimerCell.value = "Generated by Universal Asset Analyzer · Data sourced from Yahoo Finance · For informational purposes only. Not financial advice.";
  disclaimerCell.font = { size: 7, italic: true, color: { argb: "FF9CA3AF" } };
  disclaimerCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(rowIdx).height = 14;

  /* ── Sheet 2: Summary ── */
  const wsSumm = wb.addWorksheet("Summary");
  wsSumm.columns = [{ width: 22 }, ...entries.slice(0, 5).map(() => ({ width: 16 }))];

  // Title
  wsSumm.mergeCells(1, 1, 1, n + 1);
  const summTitle = wsSumm.getCell(1, 1);
  summTitle.value = "Quick Summary";
  summTitle.fill = NAVY;
  summTitle.font = { ...WHITE_FONT, size: 12 };
  summTitle.alignment = { horizontal: "center", vertical: "middle" };
  wsSumm.getRow(1).height = 26;

  // Symbol header
  wsSumm.getCell(2, 1).value = "";
  wsSumm.getCell(2, 1).fill = BLUE;
  entries.slice(0, 5).forEach((e, i) => {
    const cell = wsSumm.getCell(2, i + 2);
    cell.value = e.symbol;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_ARGB[i] } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  wsSumm.getRow(2).height = 22;

  const summaryRows: Array<{ label: string; getValue: (e: CompareEntry) => string; bold?: boolean }> = [
    { label: "Company", getValue: (e) => e.name ?? "—" },
    { label: "Current Price", getValue: (e) => e.quote?.price != null ? `$${e.quote.price.toFixed(2)}` : "—" },
    { label: "Market Cap", getValue: (e) => {
      const mc = e.quote?.marketCap;
      if (mc == null) return "—";
      if (mc >= 1e12) return `$${(mc / 1e12).toFixed(2)}T`;
      if (mc >= 1e9) return `$${(mc / 1e9).toFixed(1)}B`;
      return `$${(mc / 1e6).toFixed(0)}M`;
    }},
    { label: "Overall Score", getValue: (e) => e.score?.composite != null ? `${Math.round(e.score.composite)}/100` : "—", bold: true },
    { label: "Recommendation", getValue: (e) => e.score?.recommendation?.replace(/_/g, " ").toUpperCase() ?? "—", bold: true },
    { label: "Forward P/E", getValue: (e) => orDash(e.snapshot?.forwardPE, xRatio) },
    { label: "Revenue Growth YoY", getValue: (e) => orDash(e.snapshot?.revenueGrowth != null ? e.snapshot.revenueGrowth * 100 : null, pctSigned) },
    { label: "Net Margin", getValue: (e) => orDash(e.snapshot?.profitMargins != null ? e.snapshot.profitMargins * 100 : null, pctAbs) },
    { label: "ROE", getValue: (e) => orDash(e.snapshot?.returnOnEquity != null ? e.snapshot.returnOnEquity * 100 : null, pctAbs) },
    { label: "1-Year Return", getValue: (e) => orDash(e.oneYearReturn, pctSigned) },
    { label: "Analyst Upside", getValue: (e) => orDash(e.analyst?.upsidePercent, pctSigned) },
  ];

  summaryRows.forEach((sr, si) => {
    const bg = si % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
    const lCell = wsSumm.getCell(si + 3, 1);
    lCell.value = sr.label;
    lCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    lCell.font = { bold: true, size: 9, color: { argb: "FF374151" } };
    lCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

    entries.slice(0, 5).forEach((e, ei) => {
      const vCell = wsSumm.getCell(si + 3, ei + 2);
      vCell.value = sr.getValue(e);
      vCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      vCell.font = { bold: sr.bold, size: 9, color: { argb: "FF1F2937" } };
      vCell.alignment = { horizontal: "center", vertical: "middle" };
    });
    wsSumm.getRow(si + 3).height = 17;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const symbols = entries.map((e) => e.symbol).join("-");
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="compare-${symbols}-${date}.xlsx"`,
    },
  });
}
