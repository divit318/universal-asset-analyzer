import ExcelJS from "exceljs";
import type { StockMetrics } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

function scoreColor(v: number | null): string {
  if (v == null) return "FFFFFFFF";
  if (v >= 70) return "FFD1FAE5"; // green tint
  if (v >= 45) return "FFFEF9C3"; // amber tint
  return "FFFEE2E2";              // red tint
}

function scoreFontColor(v: number | null): string {
  if (v == null) return "FF6B7280";
  if (v >= 70) return "FF065F46";
  if (v >= 45) return "FF92400E";
  return "FF991B1B";
}

function pct(v: number | null, digits = 1): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function ratio(v: number | null, digits = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(digits)}x`;
}

function mcap(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}

function scoreCell(ws: ExcelJS.Worksheet, row: ExcelJS.Row, col: number, val: number | null) {
  const cell = row.getCell(col);
  cell.value = val ?? null;
  cell.numFmt = "0";
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: scoreColor(val) } };
  cell.font = { bold: val != null && val >= 70, color: { argb: scoreFontColor(val) }, size: 9 };
  cell.alignment = { horizontal: "center" };
  void ws; // suppress unused warning
}

/** POST /api/export/screener — body: { rows: StockMetrics[] } */
export async function POST(req: Request): Promise<Response> {
  let rows: StockMetrics[] = [];
  try {
    const body = await req.json() as { rows?: StockMetrics[] };
    rows = Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  /* ── Sheet 1: Screener Results ── */
  const ws = wb.addWorksheet("Screener Results", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 1 }],
  });

  const headers: Array<{ label: string; width: number; key: string }> = [
    { key: "#", label: "#", width: 5 },
    { key: "symbol", label: "Symbol", width: 10 },
    { key: "name", label: "Company Name", width: 28 },
    { key: "sector", label: "Sector", width: 18 },
    { key: "industry", label: "Industry", width: 22 },
    // Scores
    { key: "overall", label: "Overall", width: 10 },
    { key: "value", label: "Value", width: 9 },
    { key: "growth", label: "Growth", width: 9 },
    { key: "quality", label: "Quality", width: 9 },
    { key: "health", label: "Health", width: 9 },
    // Price / Size
    { key: "mcap", label: "Market Cap", width: 13 },
    { key: "price", label: "Price", width: 10 },
    // Valuation
    { key: "fwdpe", label: "Fwd P/E", width: 10 },
    { key: "ev", label: "EV/EBITDA", width: 12 },
    { key: "fcfyield", label: "FCF Yield", width: 11 },
    // Growth
    { key: "revgr", label: "Rev Growth YoY", width: 16 },
    { key: "revcagr", label: "Rev CAGR 3Y", width: 14 },
    { key: "epsgr", label: "EPS Growth YoY", width: 16 },
    { key: "epscagr", label: "EPS CAGR 3Y", width: 14 },
    // Quality
    { key: "roic", label: "ROIC", width: 10 },
    { key: "roe", label: "ROE", width: 10 },
    { key: "gm", label: "Gross Margin", width: 14 },
    { key: "om", label: "Op Margin", width: 12 },
    // Strength
    { key: "de", label: "D/E", width: 9 },
    { key: "ndeb", label: "Net Debt/EBITDA", width: 17 },
    { key: "cr", label: "Current Ratio", width: 14 },
    // Cash Flow
    { key: "fcfm", label: "FCF Margin", width: 12 },
    { key: "fcfgr", label: "FCF Growth YoY", width: 16 },
    // Returns
    { key: "divy", label: "Div Yield", width: 11 },
    { key: "bby", label: "Buyback Yield", width: 14 },
    { key: "1yr", label: "1Y Return", width: 11 },
    { key: "52wh", label: "Dist. 52W High", width: 15 },
    // Market Factors
    { key: "instown", label: "Inst. Ownership", width: 16 },
    { key: "esurp", label: "Earnings Surprise", width: 18 },
  ];

  ws.columns = headers.map((h) => ({ header: h.label, key: h.key, width: h.width }));

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF334155" } } };
  });
  headerRow.height = 30;

  // Add section header row (merged cells as category labels)
  // We'll add a metadata row above data with section labels
  ws.spliceRows(1, 0, []); // insert empty row above header
  const catRow = ws.getRow(1);
  catRow.height = 16;

  const catDefs: Array<{ label: string; start: number; end: number; bg: string }> = [
    { label: "", start: 1, end: 5, bg: "FF0F172A" },
    { label: "SCORES", start: 6, end: 10, bg: "FF1E3A5F" },
    { label: "SIZE", start: 11, end: 12, bg: "FF1E3A5F" },
    { label: "VALUATION", start: 13, end: 15, bg: "FF1E40AF" },
    { label: "GROWTH", start: 16, end: 19, bg: "FF065F46" },
    { label: "QUALITY", start: 20, end: 23, bg: "FF6B21A8" },
    { label: "STRENGTH", start: 24, end: 26, bg: "FF92400E" },
    { label: "CASH FLOW", start: 27, end: 28, bg: "FF065F46" },
    { label: "RETURNS", start: 29, end: 32, bg: "FF1E40AF" },
    { label: "MARKET FACTORS", start: 33, end: 34, bg: "FF374151" },
  ];

  for (const cat of catDefs) {
    if (cat.end > cat.start) {
      ws.mergeCells(1, cat.start, 1, cat.end);
    }
    const cell = catRow.getCell(cat.start);
    cell.value = cat.label;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cat.bg } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 8 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // Re-apply header fill to header row (row 2 now)
  const hRow = ws.getRow(2);
  hRow.height = 28;
  hRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  // Freeze rows 1+2 and first 3 columns
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };

  // Add data rows
  rows.forEach((m, i) => {
    const r = ws.addRow([
      i + 1,
      m.symbol,
      m.name ?? "—",
      m.sector ?? "—",
      m.industry ?? "—",
      // scores (filled below)
      null, null, null, null, null,
      mcap(m.marketCap),
      m.price != null ? m.price : null,
      m.forwardPE != null ? m.forwardPE : null,
      m.evToEbitda != null ? m.evToEbitda : null,
      m.fcfYield != null ? m.fcfYield / 100 : null,
      m.revenueGrowthYoY != null ? m.revenueGrowthYoY / 100 : null,
      m.revenueCagr3y != null ? m.revenueCagr3y / 100 : null,
      m.epsGrowthYoY != null ? m.epsGrowthYoY / 100 : null,
      m.epsCagr3y != null ? m.epsCagr3y / 100 : null,
      m.roic != null ? m.roic / 100 : null,
      m.roe != null ? m.roe / 100 : null,
      m.grossMargin != null ? m.grossMargin / 100 : null,
      m.operatingMargin != null ? m.operatingMargin / 100 : null,
      m.debtToEquity,
      m.netDebtToEbitda,
      m.currentRatio,
      m.fcfMargin != null ? m.fcfMargin / 100 : null,
      m.fcfGrowthYoY != null ? m.fcfGrowthYoY / 100 : null,
      m.dividendYield != null ? m.dividendYield / 100 : null,
      m.buybackYield != null ? m.buybackYield / 100 : null,
      m.oneYearReturn != null ? m.oneYearReturn / 100 : null,
      m.distanceFrom52WkHigh != null ? m.distanceFrom52WkHigh / 100 : null,
      m.institutionalOwnership != null ? m.institutionalOwnership / 100 : null,
      m.earningsSurprisePct != null ? m.earningsSurprisePct / 100 : null,
    ]);

    const rowNum = r.number;
    const isEven = i % 2 === 0;
    const baseFill: ExcelJS.Fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: isEven ? "FFFFFFFF" : "FFF8FAFC" },
    };
    r.eachCell((cell) => {
      cell.fill = baseFill;
      cell.font = { size: 9, color: { argb: "FF1F2937" } };
      cell.alignment = { vertical: "middle" };
    });

    // Score cells with conditional coloring (columns 6-10)
    scoreCell(ws, r, 6, m.scores.overall);
    scoreCell(ws, r, 7, m.scores.value);
    scoreCell(ws, r, 8, m.scores.growth);
    scoreCell(ws, r, 9, m.scores.quality);
    scoreCell(ws, r, 10, m.scores.financialHealth);

    // Symbol: bold accent
    const symCell = ws.getCell(rowNum, 2);
    symCell.font = { bold: true, size: 9, color: { argb: "FF1D4ED8" } };
    symCell.alignment = { horizontal: "left", vertical: "middle" };

    // Number formats
    const pctFmt = '+0.0%;-0.0%;0.0%';
    const ratioFmt = '0.0"x"';
    const priceFmt = '$#,##0.00';
    const pctColMap: number[] = [15, 16, 17, 18, 19, 20, 21, 22, 23, 27, 28, 29, 30, 31, 32, 33, 34];
    const ratioColMap: number[] = [13, 14, 24, 25, 26];

    for (const col of pctColMap) {
      const c = ws.getCell(rowNum, col);
      c.numFmt = pctFmt;
      c.alignment = { horizontal: "right", vertical: "middle" };
      // Color positive/negative
      const v = c.value as number | null;
      if (typeof v === "number") {
        c.font = { size: 9, color: { argb: v >= 0 ? "FF065F46" : "FF991B1B" } };
      }
    }
    for (const col of ratioColMap) {
      const c = ws.getCell(rowNum, col);
      c.numFmt = ratioFmt;
      c.alignment = { horizontal: "right", vertical: "middle" };
    }
    const priceCell = ws.getCell(rowNum, 12);
    priceCell.numFmt = priceFmt;
    priceCell.alignment = { horizontal: "right", vertical: "middle" };

    r.height = 18;
    void pct; void ratio; // suppress unused
  });

  /* ── Sheet 2: Glossary ── */
  const glossary = wb.addWorksheet("Glossary");
  glossary.columns = [
    { header: "Metric", key: "metric", width: 22 },
    { header: "Description", key: "desc", width: 60 },
  ];
  const glossaryData = [
    ["Overall Score", "Composite 0–100 score blending Value, Growth, Quality, Health, and Momentum"],
    ["Value Score", "How cheap the stock is relative to earnings, cash flow, and book value (0–100)"],
    ["Growth Score", "Revenue and earnings growth trajectory (0–100)"],
    ["Quality Score", "Return on capital efficiency and margin quality (0–100)"],
    ["Health Score", "Balance sheet strength and debt coverage (0–100)"],
    ["Fwd P/E", "Forward Price-to-Earnings ratio (price ÷ next-12-month EPS estimate)"],
    ["EV/EBITDA", "Enterprise Value divided by EBITDA — a capital-structure-neutral valuation metric"],
    ["FCF Yield", "Free Cash Flow ÷ Market Cap — higher = more cash generated per dollar of market price"],
    ["Rev Growth YoY", "Year-over-year revenue growth rate"],
    ["Rev CAGR 3Y", "3-year compound annual revenue growth rate"],
    ["ROIC", "Return on Invested Capital — how efficiently the business generates returns on capital"],
    ["ROE", "Return on Equity — net income as a % of shareholders' equity"],
    ["D/E", "Debt-to-Equity ratio — total debt divided by shareholders' equity"],
    ["Net Debt/EBITDA", "Leverage: net debt relative to cash generation; >3x is typically high risk"],
    ["Current Ratio", "Current assets ÷ current liabilities; >1x means short-term obligations are covered"],
    ["FCF Margin", "Free Cash Flow as a % of revenue"],
    ["Div Yield", "Annual dividend as a % of current price"],
    ["Buyback Yield", "Net share repurchases as a % of market cap (negative = dilution)"],
    ["1Y Return", "Total price return over the past 12 months"],
    ["Dist. 52W High", "% below the 52-week high (negative = below the high)"],
    ["Inst. Ownership", "% of shares held by institutional investors (mutual funds, pensions, hedge funds)"],
    ["Earnings Surprise", "Most recent earnings surprise vs analyst estimate (%)"],
  ];
  glossaryData.forEach(([metric, desc]) => glossary.addRow([metric, desc]));
  glossary.getRow(1).font = HEADER_FONT;
  glossary.getRow(1).fill = HEADER_FILL;

  const buffer = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="screener-${date}.xlsx"`,
    },
  });
}
