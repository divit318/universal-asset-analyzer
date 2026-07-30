import ExcelJS from "exceljs";
import { classSections, compositeScoreSection, getRawValue, type ClassSectionDef } from "@/app/compare/_components/class-sections";
import { isAssetClassId, getAssetClass } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import type { ClassCompareEntry } from "@/lib/compare/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClassExportPayload {
  assetClass?: string;
  entries: ClassCompareEntry[];
  aiVerdict?: string;
}

// Section header / stock column colors — same palette as the equity export
// (app/api/export/compare/route.ts) so the two workbooks read as one family.
const NAVY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
const SECTION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const COL_ARGB = ["FF3B82F6", "FFF59E0B", "FF10B981", "FFF43F5E", "FFA855F7"];
const BEST_FILL_ARGB = "FFD1FAE5";

/** Same 5%-tolerance-free "highest/lowest numeric wins" rule the on-screen table uses (app/compare/_components/class-compare-view.tsx findWinners) — categorical rows and unavailable metrics are never scored. */
function bestIndex(values: (number | string | null)[], higherBetter: boolean | null): number | null {
  if (higherBetter == null) return null;
  const numeric = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => typeof x.v === "number");
  if (numeric.length < 2) return null;
  return numeric.reduce((best, cur) => (higherBetter ? cur.v > best.v : cur.v < best.v) ? cur : best).i;
}

/** POST /api/export/compare-class — body: ClassExportPayload */
export async function POST(req: Request): Promise<Response> {
  let payload: ClassExportPayload;
  try {
    payload = await req.json() as ClassExportPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!isAssetClassId(payload.assetClass) || payload.assetClass === "equity") {
    return new Response("A non-equity assetClass is required", { status: 400 });
  }
  const assetClass: AssetClassId = payload.assetClass;
  const entries = payload.entries.slice(0, 5);
  const n = entries.length;
  const classLabel = getAssetClass(assetClass).label;
  const date = new Date().toISOString().slice(0, 10);
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const composite = compositeScoreSection(entries);
  const sections: ClassSectionDef[] = composite ? [...classSections(assetClass), composite] : classSections(assetClass);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  /* ── Sheet 1: Comparison ── */
  const ws = wb.addWorksheet("Comparison", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  ws.columns = [{ width: 26 }, ...entries.map(() => ({ width: 18 }))];

  ws.mergeCells(1, 1, 1, n + 1);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${classLabel} Comparison Report  ·  ${dateStr}`;
  titleCell.fill = NAVY;
  titleCell.font = { ...WHITE_FONT, size: 12 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.getCell(2, 1).value = "Current Price";
  ws.getCell(2, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  ws.getCell(2, 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
  ws.getCell(2, 1).alignment = { horizontal: "left", vertical: "middle" };
  entries.forEach((e, i) => {
    const cell = ws.getCell(2, i + 2);
    cell.value = e.price != null ? `$${e.price.toFixed(2)}` : "—";
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.getRow(2).height = 18;

  ws.getCell(3, 1).value = "Metric";
  ws.getCell(3, 1).fill = BLUE;
  ws.getCell(3, 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
  ws.getCell(3, 1).alignment = { horizontal: "left", vertical: "middle" };
  entries.forEach((e, i) => {
    const cell = ws.getCell(3, i + 2);
    const nameTrunc = (e.name ?? "").length > 20 ? (e.name ?? "").slice(0, 18) + "…" : (e.name ?? "");
    cell.value = `${e.symbol}\n${nameTrunc}`;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_ARGB[i] } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.getRow(3).height = 30;

  let rowIdx = 4;
  sections.forEach((section) => {
    ws.mergeCells(rowIdx, 1, rowIdx, n + 1);
    const secCell = ws.getCell(rowIdx, 1);
    secCell.value = section.title.toUpperCase();
    secCell.fill = SECTION_FILL;
    secCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    secCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(rowIdx).height = 18;
    rowIdx++;

    section.metrics.forEach((metric, mi) => {
      const rowBg = mi % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
      const labelCell = ws.getCell(rowIdx, 1);
      labelCell.value = metric.label;
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      labelCell.font = { size: 9, color: { argb: "FF374151" } };
      labelCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

      if (metric.unavailableReason) {
        ws.mergeCells(rowIdx, 2, rowIdx, n + 1);
        const cell = ws.getCell(rowIdx, 2);
        cell.value = "Not available — no data provider yet";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
        cell.font = { italic: true, size: 9, color: { argb: "FF9CA3AF" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(rowIdx).height = 17;
        rowIdx++;
        return;
      }

      const values = entries.map((e) => (e.error ? null : getRawValue(e, metric.key)));
      const best = bestIndex(values, metric.higherBetter);

      values.forEach((val, i) => {
        const cell = ws.getCell(rowIdx, i + 2);
        cell.value = val == null ? "—" : typeof val === "number" ? metric.format(val) : val;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        if (i === best) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BEST_FILL_ARGB } };
          cell.font = { bold: true, size: 9, color: { argb: "FF065F46" } };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
          cell.font = { size: 9, color: { argb: "FF374151" } };
        }
      });
      ws.getRow(rowIdx).height = 17;
      rowIdx++;
    });

    ws.getRow(rowIdx).height = 4;
    rowIdx++;
  });

  if (payload.aiVerdict && payload.aiVerdict.trim()) {
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
    verdictCell.value = payload.aiVerdict.trim();
    verdictCell.font = { size: 9, color: { argb: "FF1F2937" } };
    verdictCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true, indent: 1 };
    ws.getRow(rowIdx).height = Math.max(20, Math.ceil(payload.aiVerdict.length / 100) * 14);
    rowIdx++;
  }

  rowIdx++;
  ws.mergeCells(rowIdx, 1, rowIdx, n + 1);
  const disclaimerCell = ws.getCell(rowIdx, 1);
  disclaimerCell.value = "Generated by Universal Asset Analyzer · Data sourced from Yahoo Finance · For informational purposes only. Not financial advice.";
  disclaimerCell.font = { size: 7, italic: true, color: { argb: "FF9CA3AF" } };
  disclaimerCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(rowIdx).height = 14;

  /* ── Sheet 2: Summary ── */
  const wsSumm = wb.addWorksheet("Summary");
  wsSumm.columns = [{ width: 22 }, ...entries.map(() => ({ width: 16 }))];

  wsSumm.mergeCells(1, 1, 1, n + 1);
  const summTitle = wsSumm.getCell(1, 1);
  summTitle.value = "Quick Summary";
  summTitle.fill = NAVY;
  summTitle.font = { ...WHITE_FONT, size: 12 };
  summTitle.alignment = { horizontal: "center", vertical: "middle" };
  wsSumm.getRow(1).height = 26;

  wsSumm.getCell(2, 1).value = "";
  wsSumm.getCell(2, 1).fill = BLUE;
  entries.forEach((e, i) => {
    const cell = wsSumm.getCell(2, i + 2);
    cell.value = e.symbol;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_ARGB[i] } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  wsSumm.getRow(2).height = 22;

  // First 2-3 key facts (whatever the class's own registry surfaces on the
  // summary card) plus price and overall score — a short glance list, not
  // the full metric table already on Sheet 1.
  const summaryRows: Array<{ label: string; getValue: (e: ClassCompareEntry) => string }> = [
    { label: "Name", getValue: (e) => e.name ?? "—" },
    { label: "Current Price", getValue: (e) => (e.price != null ? `$${e.price.toFixed(2)}` : "—") },
    { label: "Change", getValue: (e) => (e.changePercent != null ? `${e.changePercent >= 0 ? "+" : ""}${e.changePercent.toFixed(2)}%` : "—") },
    { label: "Overall Score", getValue: (e) => (e.scores.overall != null ? `${Math.round(e.scores.overall)}/100` : "—") },
  ];

  summaryRows.forEach((sr, si) => {
    const bg = si % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
    const lCell = wsSumm.getCell(si + 3, 1);
    lCell.value = sr.label;
    lCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    lCell.font = { bold: true, size: 9, color: { argb: "FF374151" } };
    lCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

    entries.forEach((e, ei) => {
      const vCell = wsSumm.getCell(si + 3, ei + 2);
      vCell.value = sr.getValue(e);
      vCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      vCell.font = { bold: sr.label === "Overall Score", size: 9, color: { argb: "FF1F2937" } };
      vCell.alignment = { horizontal: "center", vertical: "middle" };
    });
    wsSumm.getRow(si + 3).height = 17;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const symbols = entries.map((e) => e.symbol).join("-");
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="compare-${assetClass}-${symbols}-${date}.xlsx"`,
    },
  });
}
