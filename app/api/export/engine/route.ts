import ExcelJS from "exceljs";
import { guardedExport } from "@/lib/download";
import { RECOMMENDATION_ARGB, RECOMMENDATION_LABEL, SCORING_METHODOLOGY_VERSION } from "@/lib/recommendation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScorecardRow {
  symbol: string;
  date: string;
  name?: string;
  sector?: string;
  momentum_score: number;
  quality_score: number;
  value_score: number;
  low_vol_score: number;
  revision_score: number;
  regime_score: number;
  forecast_score: number;
  mc_upside: number;
  kelly_fraction: number;
  composite_score: number;
  signal: string;
  confidence: number;
}

// Signals come from the Python engine as UPPER_SNAKE_CASE (e.g. "STRONG_BUY")
// and also sometimes as title-case — normalise everything to UPPER_SNAKE_CASE.
function normaliseSignal(raw: string): string {
  // "Strong Buy" → "STRONG_BUY", "BUY" → "BUY"
  return raw.trim().toUpperCase().replace(/\s+/g, "_");
}

// Tier labels/palette come from the canonical maps in lib/recommendation.ts.
// The engine's signal is its own vocabulary (emitted in z-score space by
// engine/daily_run.py, see lib/engine-desk.ts) but it shares the five tier
// names, so the export styles it with the same palette as every other export.
const SIGNAL_LABEL: Record<string, string> = { ...RECOMMENDATION_LABEL };
const SIGNAL_ARGB: Record<string, { fill: string; font: string }> = { ...RECOMMENDATION_ARGB };

/**
 * Factor/composite cells hold cross-sectional z-scores (0 = universe median,
 * ±2 ≈ 2nd/98th percentile) — NOT 0-100 scores. This export previously colored
 * them against 70/45 thresholds (every cell read red) — color by sign instead,
 * exactly like the desk UI's ZBar.
 */
const Z_POS_FONT = "FF065F46";
const Z_NEG_FONT = "FF991B1B";
const zFont = (v: number): string => (v >= 0 ? Z_POS_FONT : Z_NEG_FONT);

const NAVY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

/** POST /api/export/engine — body: { rows: ScorecardRow[] } */
export function POST(req: Request): Promise<Response> {
  return guardedExport("api/export/engine", () => buildEngineExport(req));
}

async function buildEngineExport(req: Request): Promise<Response> {
  let rows: ScorecardRow[] = [];
  try {
    const body = await req.json() as { rows?: ScorecardRow[] };
    rows = Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const sorted = [...rows].sort((a, b) => b.composite_score - a.composite_score);
  const date = new Date().toISOString().slice(0, 10);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();
  wb.subject = `Scoring methodology ${SCORING_METHODOLOGY_VERSION}`;

  /* ── Sheet 1: Full Scorecard ── */
  const ws = wb.addWorksheet("Scorecard", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });

  // Title
  ws.mergeCells(1, 1, 1, 16);
  const titleCell = ws.getRow(1).getCell(1);
  titleCell.value = `Quant Engine Scorecard — ${date}  (${sorted.length} stocks)`;
  titleCell.fill = NAVY;
  titleCell.font = WHITE_FONT;
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  const headers = [
    { label: "Rank", width: 7 },
    { label: "Symbol", width: 10 },
    { label: "Company Name", width: 26 },
    { label: "Sector", width: 18 },
    { label: "Signal", width: 13 },
    { label: "Composite", width: 11 },
    { label: "Momentum", width: 11 },
    { label: "Quality", width: 10 },
    { label: "Value", width: 10 },
    { label: "Low Vol", width: 10 },
    { label: "Revision", width: 10 },
    { label: "Regime", width: 10 },
    { label: "Forecast", width: 10 },
    { label: "MC Upside (%)", width: 14 },
    { label: "Kelly Frac.", width: 12 },
    { label: "Confidence", width: 12 },
  ];

  ws.columns = headers.map((h) => ({ width: h.width }));

  const hRow = ws.getRow(2);
  hRow.values = headers.map((h) => h.label);
  hRow.eachCell((cell) => {
    cell.fill = BLUE;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  hRow.height = 28;
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 16 } };

  // A z-score cell: signed two-decimal figure, colored by sign like the desk UI.
  const zScoreCell = (ws: ExcelJS.Worksheet, rowNum: number, col: number, val: number) => {
    const cell = ws.getCell(rowNum, col);
    cell.font = { size: 9, bold: Math.abs(val) >= 1.5, color: { argb: zFont(val) } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.numFmt = "+0.00;-0.00";
  };

  sorted.forEach((row, i) => {
    const r = ws.addRow([
      i + 1,
      row.symbol,
      row.name ?? "—",
      row.sector ?? "—",
      row.signal ?? "—",
      row.composite_score,
      row.momentum_score,
      row.quality_score,
      row.value_score,
      row.low_vol_score,
      row.revision_score,
      row.regime_score,
      row.forecast_score,
      row.mc_upside,
      row.kelly_fraction,
      row.confidence,
    ]);

    const rn = r.number;
    const bg: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" } };
    r.eachCell((cell) => { cell.fill = bg; cell.font = { size: 9 }; cell.alignment = { vertical: "middle" }; });

    // Symbol: blue bold
    ws.getCell(rn, 2).font = { bold: true, size: 9, color: { argb: "FF1D4ED8" } };

    // Signal cell — normalise to UPPER_SNAKE_CASE for lookup
    const sigNorm = normaliseSignal(row.signal);
    const sigCell = ws.getCell(rn, 5);
    const sigArgb = SIGNAL_ARGB[sigNorm];
    sigCell.value = SIGNAL_LABEL[sigNorm] ?? row.signal;
    sigCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sigArgb?.fill ?? "FFFFFFFF" } };
    sigCell.font = { bold: true, size: 9, color: { argb: sigArgb?.font ?? "FF374151" } };
    sigCell.alignment = { horizontal: "center", vertical: "middle" };

    // Score columns (6-13) — cross-sectional z-scores, colored by sign
    zScoreCell(ws, rn, 6, row.composite_score);
    zScoreCell(ws, rn, 7, row.momentum_score);
    zScoreCell(ws, rn, 8, row.quality_score);
    zScoreCell(ws, rn, 9, row.value_score);
    zScoreCell(ws, rn, 10, row.low_vol_score);
    zScoreCell(ws, rn, 11, row.revision_score);
    zScoreCell(ws, rn, 12, row.regime_score);
    zScoreCell(ws, rn, 13, row.forecast_score);

    // MC upside — already a fraction (0.35 = +35%), exactly as the desk UI
    // renders it. Was divided by 100 a second time here.
    const mcCell = ws.getCell(rn, 14);
    mcCell.numFmt = '+0.0%;-0.0%';
    mcCell.value = row.mc_upside;
    mcCell.font = { size: 9, color: { argb: row.mc_upside >= 0 ? "FF065F46" : "FF991B1B" } };
    mcCell.alignment = { horizontal: "right", vertical: "middle" };

    // Kelly — a 0-1 fraction of capital (desk UI shows kelly_fraction × 100 %).
    const kellyCell = ws.getCell(rn, 15);
    kellyCell.numFmt = '0.00%';
    kellyCell.value = row.kelly_fraction;
    kellyCell.alignment = { horizontal: "right", vertical: "middle" };

    // Confidence — a 0-1 probability (desk UI shows confidence × 100 %).
    // Was divided by 100 a second time and color-compared against 70/45.
    const confCell = ws.getCell(rn, 16);
    confCell.numFmt = '0.0%';
    confCell.value = row.confidence;
    confCell.alignment = { horizontal: "right", vertical: "middle" };
    confCell.font = { size: 9, color: { argb: row.confidence >= 0.70 ? "FF065F46" : row.confidence >= 0.45 ? "FF92400E" : "FF991B1B" } };

    r.height = 17;
  });

  /* ── Sheet 2: Summary ── */
  const wsSumm = wb.addWorksheet("Summary");
  wsSumm.columns = [{ width: 28 }, { width: 18 }];

  wsSumm.mergeCells(1, 1, 1, 2);
  const summTitle = wsSumm.getRow(1).getCell(1);
  summTitle.value = "Signal Distribution";
  summTitle.fill = NAVY;
  summTitle.font = WHITE_FONT;
  summTitle.alignment = { horizontal: "center" };
  wsSumm.getRow(1).height = 24;

  // Count by normalised key so both "STRONG_BUY" and "Strong Buy" from the engine are handled
  const signalCounts: Record<string, number> = {};
  for (const r of sorted) {
    const key = normaliseSignal(r.signal);
    signalCounts[key] = (signalCounts[key] ?? 0) + 1;
  }
  const signalOrder = ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"];

  wsSumm.addRow(["Signal", "Count"]).eachCell((cell) => {
    cell.fill = BLUE; cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 }; cell.alignment = { horizontal: "center" };
  });

  signalOrder.forEach((sig) => {
    const count = signalCounts[sig] ?? 0;
    const r = wsSumm.addRow([SIGNAL_LABEL[sig] ?? sig, count]);
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SIGNAL_ARGB[sig]?.fill ?? "FFFFFFFF" } };
    r.getCell(1).font = { bold: true, size: 9, color: { argb: SIGNAL_ARGB[sig]?.font ?? "FF374151" } };
    r.getCell(2).alignment = { horizontal: "center" };
    r.getCell(2).font = { size: 9, bold: true };
    r.height = 16;
  });

  wsSumm.addRow([]);
  wsSumm.addRow(["Total Stocks Scored", sorted.length]).eachCell((cell) => {
    cell.font = { bold: true, size: 9 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });
  wsSumm.addRow(["Report Date", date]).eachCell((cell) => {
    cell.font = { size: 9 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  // Top 10 Strong Buys sub-table (match both "Strong Buy" and "STRONG_BUY" from engine)
  const strongBuys = sorted.filter((r) => normaliseSignal(r.signal) === "STRONG_BUY").slice(0, 10);
  if (strongBuys.length > 0) {
    wsSumm.addRow([]);
    wsSumm.mergeCells(wsSumm.rowCount + 1, 1, wsSumm.rowCount + 1, 2);
    const top10Title = wsSumm.lastRow!;
    top10Title.getCell(1).value = "Top Strong Buy Picks";
    top10Title.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
    top10Title.getCell(1).font = WHITE_FONT;
    top10Title.getCell(1).alignment = { horizontal: "center" };
    top10Title.height = 20;

    wsSumm.addRow(["Symbol", "Composite Score"]).eachCell((cell) => {
      cell.fill = BLUE; cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 }; cell.alignment = { horizontal: "center" };
    });

    strongBuys.forEach((r, i) => {
      const row = wsSumm.addRow([r.symbol, r.composite_score]);
      row.getCell(1).font = { bold: true, size: 9, color: { argb: "FF1D4ED8" } };
      row.getCell(2).numFmt = "+0.00;-0.00"; row.getCell(2).alignment = { horizontal: "center" };
      row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? "FFD1FAE5" : "FFECFDf5" } }; });
      row.height = 16;
    });
  }

  /* ── Sheet 3: Factor Glossary ── */
  const wsG = wb.addWorksheet("Factor Glossary");
  wsG.columns = [{ width: 20 }, { width: 70 }];
  wsG.addRow(["Factor", "Description"]).eachCell((cell) => { cell.fill = NAVY; cell.font = WHITE_FONT; });
  const glossary: [string, string][] = [
    ["Composite Score", "IC-weighted sum of the factor z-scores — the primary ranking signal (z-score: 0 = universe median, +2 ≈ 98th percentile)"],
    ["Momentum Score", "Price trend relative to peers: 1-year return, proximity to 52W high, SMA crossovers"],
    ["Quality Score", "Return on capital efficiency: ROE, ROIC, gross margins, earnings consistency"],
    ["Value Score", "Cheapness relative to fundamentals: P/E, EV/EBITDA, FCF Yield, P/Book"],
    ["Low Vol Score", "Historical price stability — lower volatility earns a higher score"],
    ["Revision Score", "Analyst earnings estimate revision trend — upgrades outperform downgrades"],
    ["Regime Score", "Current market regime (bull/bear/ranging/recovery) and how the stock fits"],
    ["Forecast Score", "ML-model 30/90/180-day return forecast percentile vs universe"],
    ["MC Upside (%)", "Monte Carlo probabilistic DCF — median intrinsic value upside vs current price"],
    ["Kelly Fraction", "Kelly Criterion optimal position size given estimated return and volatility"],
    ["Confidence", "Model confidence in the composite signal, based on data quality and factor agreement"],
    ["Signal", "Overall recommendation: Strong Buy / Buy / Hold / Sell / Strong Sell"],
  ];
  glossary.forEach(([factor, desc]) => {
    const r = wsG.addRow([factor, desc]);
    r.getCell(1).font = { bold: true, size: 9 };
    r.getCell(2).font = { size: 9 };
    r.height = 16;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="quant-engine-${date}.xlsx"`,
    },
  });
}
