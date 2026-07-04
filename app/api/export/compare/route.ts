import ExcelJS from "exceljs";
import type { CompareEntry } from "@/app/api/compare/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompareExportPayload {
  entries: CompareEntry[];
  aiVerdict?: string;
}

function pctSigned(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function pctAbs(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}
function xRatio(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}x`;
}

interface MetricDef {
  label: string;
  getValue: (e: CompareEntry) => number | null;
  format: (v: number | null) => string;
  higherBetter: boolean | null;
}
interface SectionDef { title: string; metrics: MetricDef[] }

const SECTIONS: SectionDef[] = [
  {
    title: "Valuation",
    metrics: [
      { label: "Forward P/E", getValue: (e) => e.snapshot?.forwardPE ?? null, format: xRatio, higherBetter: false },
      { label: "Trailing P/E", getValue: (e) => e.snapshot?.trailingPE ?? null, format: xRatio, higherBetter: false },
      { label: "PEG Ratio", getValue: (e) => e.snapshot?.pegRatio ?? null, format: xRatio, higherBetter: false },
      { label: "Price / Book", getValue: (e) => e.snapshot?.priceToBook ?? null, format: xRatio, higherBetter: false },
      { label: "FCF Yield", getValue: (e) => e.fcfYieldPct ?? null, format: pctAbs, higherBetter: true },
      { label: "Analyst Upside", getValue: (e) => e.analyst?.upsidePercent ?? null, format: pctSigned, higherBetter: true },
    ],
  },
  {
    title: "Growth",
    metrics: [
      { label: "Revenue Growth YoY", getValue: (e) => e.snapshot?.revenueGrowth != null ? e.snapshot.revenueGrowth * 100 : null, format: pctSigned, higherBetter: true },
      { label: "Earnings Growth YoY", getValue: (e) => e.snapshot?.earningsGrowth != null ? e.snapshot.earningsGrowth * 100 : null, format: pctSigned, higherBetter: true },
      { label: "Revenue CAGR 3Y", getValue: (e) => e.statements?.revenueCagr != null ? e.statements.revenueCagr * 100 : null, format: pctSigned, higherBetter: true },
      { label: "FCF CAGR 3Y", getValue: (e) => e.statements?.fcfCagr != null ? e.statements.fcfCagr * 100 : null, format: pctSigned, higherBetter: true },
    ],
  },
  {
    title: "Quality & Profitability",
    metrics: [
      { label: "Return on Equity", getValue: (e) => e.snapshot?.returnOnEquity != null ? e.snapshot.returnOnEquity * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Return on Assets", getValue: (e) => e.snapshot?.returnOnAssets != null ? e.snapshot.returnOnAssets * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Gross Margin", getValue: (e) => e.snapshot?.grossMargins != null ? e.snapshot.grossMargins * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Operating Margin", getValue: (e) => e.snapshot?.operatingMargins != null ? e.snapshot.operatingMargins * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Net Margin", getValue: (e) => e.snapshot?.profitMargins != null ? e.snapshot.profitMargins * 100 : null, format: pctAbs, higherBetter: true },
    ],
  },
  {
    title: "Financial Strength",
    metrics: [
      { label: "Debt / Equity", getValue: (e) => e.snapshot?.debtToEquity ?? null, format: xRatio, higherBetter: false },
      { label: "Net Debt / EBITDA", getValue: (e) => e.netDebtToEbitda ?? null, format: xRatio, higherBetter: false },
      { label: "Current Ratio", getValue: (e) => e.snapshot?.currentRatio ?? null, format: xRatio, higherBetter: true },
    ],
  },
  {
    title: "Momentum",
    metrics: [
      { label: "1-Year Return", getValue: (e) => e.oneYearReturn ?? null, format: pctSigned, higherBetter: true },
      { label: "vs SMA-200", getValue: (e) => e.momentum?.vsSma200 ?? null, format: pctSigned, higherBetter: true },
      { label: "3-Month Return", getValue: (e) => e.momentum?.return3m ?? null, format: pctSigned, higherBetter: true },
      { label: "% from 52W High", getValue: (e) => e.momentum?.pctFrom52WkHigh ?? null, format: pctSigned, higherBetter: false },
    ],
  },
  {
    title: "Composite Scores",
    metrics: [
      { label: "Overall Score (/100)", getValue: (e) => e.score?.total ?? null, format: (v) => v != null ? `${Math.round(v)}/100` : "—", higherBetter: true },
      { label: "Composite Score (/100)", getValue: (e) => e.score?.composite ?? null, format: (v) => v != null ? `${Math.round(v)}/100` : "—", higherBetter: true },
      { label: "Recommendation", getValue: () => null, format: () => "—", higherBetter: null },
    ],
  },
];

// Section header colors (navy-ish background)
const SECTION_BG_ARGB = "FF1E3A5F";
const SECTION_BG_FILLS: ExcelJS.Fill[] = SECTIONS.map(() => ({
  type: "pattern" as const, pattern: "solid" as const,
  fgColor: { argb: SECTION_BG_ARGB },
}));
void SECTION_BG_FILLS;

const NAVY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
const SECTION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

// Stock column colors (for the symbol header rows)
const COL_ARGB = ["FF3B82F6", "FFF59E0B", "FF10B981", "FFF43F5E", "FFA855F7"];
const COL_BEST_FILL_ARGB = ["FFD1FAE5", "FFFEF9C3", "FFD1FAE5", "FFFEE2E2", "FFF3E8FF"];

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
  titleCell.value = `Stock Comparison Report  ·  ${dateStr}`;
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
      const values = entries.slice(0, 5).map((e) => metric.getValue(e));
      const numericVals = values.filter((v): v is number => v != null);

      const best = numericVals.length > 1
        ? metric.higherBetter === true ? Math.max(...numericVals)
        : metric.higherBetter === false ? Math.min(...numericVals)
        : null : null;

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
        const isBest = val != null && val === best && numericVals.length > 1;

        const formatted = metric.label === "Recommendation"
          ? (entries[i]?.score?.recommendation?.replace(/_/g, " ").toUpperCase() ?? "—")
          : metric.format(val);

        cell.value = formatted;
        cell.alignment = { horizontal: "center", vertical: "middle" };

        if (isBest) {
          // Best performer: colored highlight
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL_BEST_FILL_ARGB[0] } };
          cell.font = { bold: true, size: 9, color: { argb: "FF065F46" } };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
          // Color positive/negative for relevant metrics
          const isPositiveMetric = metric.higherBetter === true && val != null && val > 0;
          const isNegativeMetric = val != null && val < 0 &&
            (metric.label.includes("Return") || metric.label.includes("Growth") || metric.label.includes("Upside"));
          if (isPositiveMetric) {
            cell.font = { size: 9, color: { argb: "FF1D4ED8" } };
          } else if (isNegativeMetric) {
            cell.font = { size: 9, color: { argb: "FFDC2626" } };
          } else {
            cell.font = { size: 9, color: { argb: "FF374151" } };
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
    { label: "Forward P/E", getValue: (e) => xRatio(e.snapshot?.forwardPE ?? null) },
    { label: "Revenue Growth YoY", getValue: (e) => pctSigned(e.snapshot?.revenueGrowth != null ? e.snapshot.revenueGrowth * 100 : null) },
    { label: "Net Margin", getValue: (e) => pctAbs(e.snapshot?.profitMargins != null ? e.snapshot.profitMargins * 100 : null) },
    { label: "ROE", getValue: (e) => pctAbs(e.snapshot?.returnOnEquity != null ? e.snapshot.returnOnEquity * 100 : null) },
    { label: "1-Year Return", getValue: (e) => pctSigned(e.oneYearReturn ?? null) },
    { label: "Analyst Upside", getValue: (e) => pctSigned(e.analyst?.upsidePercent ?? null) },
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
