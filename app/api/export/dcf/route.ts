import ExcelJS from "exceljs";
import { guardedExport } from "@/lib/download";
import { currencySymbol } from "@/lib/format";
import {
  type DcfAssumptions,
  buildScenarios,
  buildSensitivity,
  dcfInvalidReason,
  describeScenario,
  impliedUpside,
  marginOfSafety,
  runDcf,
} from "@/lib/valuation/dcf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A bare model export: one assumption set, no case behind it.
 *
 * Superseded for normal use by /api/export/valuation, which exports the persisted
 * ValuationCase — provenance, reasoning, AI objections and version history — and
 * is what the workspace's "Export case" button calls. This route survives for the
 * one thing that cannot do: exporting an ad-hoc assumption set that was never
 * saved as a case. It shares the same engine (lib/valuation/dcf.ts), so the two
 * workbooks can never disagree on the arithmetic.
 *
 * Only the assumptions are accepted; projections, scenarios and sensitivity are
 * recomputed here. This route used to carry its own copy of the DCF math and its
 * own scenario multipliers, which could and did drift from the UI's.
 */
interface DcfExportPayload {
  symbol: string;
  companyName: string;
  currentPrice: number | null;
  currency?: string;
  inputs: DcfAssumptions;
}

const NAVY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const GREEN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
const AMBER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9C3" } };
const RED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
const GRAY_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

/** POST /api/export/dcf — body: DcfExportPayload */
export function POST(req: Request): Promise<Response> {
  return guardedExport("api/export/dcf", () => buildDcfExport(req));
}

async function buildDcfExport(req: Request): Promise<Response> {
  let payload: DcfExportPayload;
  try {
    payload = await req.json() as DcfExportPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { symbol, companyName, currentPrice, inputs } = payload;
  const reason = inputs ? dcfInvalidReason(inputs) : "non_finite_inputs";
  if (reason !== null) {
    return new Response(`Cannot value these assumptions: ${reason}`, { status: 400 });
  }

  const cur = currencySymbol(payload.currency);
  const money = `"${cur}"#,##0.00`;
  const moneyBn = `"${cur}"#,##0,,,"B"`;
  const compact = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${cur}${(v / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${cur}${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${cur}${(v / 1e6).toFixed(2)}M`;
    return `${cur}${v.toFixed(0)}`;
  };
  const perShare = (v: number | null): string => (v == null ? "—" : `${cur}${v.toFixed(2)}`);

  // One engine, one set of numbers.
  const baseResult = runDcf(inputs);
  const scen = buildScenarios(inputs);
  const { waccRange, terminalGrowthRange: tgRange, table: sensitivity } = buildSensitivity(inputs);
  const scenarios = {
    bear: scen.bear.fairValuePerShare,
    base: scen.base.fairValuePerShare,
    bull: scen.bull.fairValuePerShare,
  };

  const date = new Date().toISOString().slice(0, 10);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  /* ── Sheet 1: Model Inputs ── */
  const wsInputs = wb.addWorksheet("Model Inputs");
  wsInputs.columns = [{ width: 32 }, { width: 22 }, { width: 20 }];

  const addTitle = (ws: ExcelJS.Worksheet, title: string) => {
    ws.mergeCells(ws.rowCount + 1, 1, ws.rowCount + 1, 3);
    const r = ws.lastRow!;
    r.getCell(1).value = title;
    r.getCell(1).fill = NAVY;
    r.getCell(1).font = WHITE_FONT;
    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    r.height = 24;
  };

  const addKV = (ws: ExcelJS.Worksheet, label: string, value: string | number, note?: string) => {
    const r = ws.addRow([label, value, note ?? ""]);
    r.getCell(1).font = { size: 9, color: { argb: "FF374151" } };
    r.getCell(2).font = { bold: true, size: 9, color: { argb: "FF111827" } };
    r.getCell(3).font = { size: 8, color: { argb: "FF9CA3AF" }, italic: true };
    r.getCell(1).fill = GRAY_FILL;
    r.height = 16;
  };

  const addSubheader = (ws: ExcelJS.Worksheet, title: string) => {
    ws.mergeCells(ws.rowCount + 1, 1, ws.rowCount + 1, 3);
    const r = ws.lastRow!;
    r.getCell(1).value = title;
    r.getCell(1).fill = BLUE;
    r.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    r.getCell(1).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    r.height = 18;
  };

  // Title block
  wsInputs.addRow([]);
  addTitle(wsInputs, `DCF Model — ${companyName} (${symbol})`);
  wsInputs.addRow([]);
  const dateRow = wsInputs.addRow(["Generated", date, ""]);
  dateRow.getCell(1).font = { size: 9, color: { argb: "FF6B7280" } };
  dateRow.getCell(2).font = { size: 9, color: { argb: "FF111827" } };
  wsInputs.addRow([]);

  addSubheader(wsInputs, "Company Data");
  addKV(wsInputs, "Symbol", symbol);
  addKV(wsInputs, "Company Name", companyName);
  addKV(wsInputs, "Current Market Price", perShare(currentPrice));
  addKV(wsInputs, "Reporting Currency", (payload.currency ?? "USD").toUpperCase());
  wsInputs.addRow([]);

  addSubheader(wsInputs, "Cash Flow Inputs");
  addKV(wsInputs, "Trailing Free Cash Flow", compact(inputs.baseFcf), "Starting point for projections");
  addKV(wsInputs, "Shares Outstanding", inputs.sharesOutstanding.toLocaleString(), "Used to convert equity value to per-share value");
  addKV(wsInputs, "Net Debt", compact(inputs.netDebt), "Positive = net debt, negative = net cash");
  wsInputs.addRow([]);

  addSubheader(wsInputs, "Growth Assumptions");
  addKV(wsInputs, "FCF Growth Rate (Y1–Y5)", `${inputs.growthRate1.toFixed(1)}%`, "Applied to years 1 through 5");
  addKV(wsInputs, "FCF Growth Rate (Y6–Y10)", `${inputs.growthRate2.toFixed(1)}%`, "Applied to years 6 through 10 (linearly interpolated from Y5)");
  addKV(wsInputs, "Terminal Growth Rate", `${inputs.terminalGrowth.toFixed(1)}%`, "Perpetuity growth rate after year 10. Use GDP-like rates (2–3%)");
  wsInputs.addRow([]);

  addSubheader(wsInputs, "Discount Rate");
  addKV(wsInputs, "WACC (Discount Rate)", `${inputs.discountRate.toFixed(1)}%`, "Weighted Average Cost of Capital — your required return");
  wsInputs.addRow([]);

  addSubheader(wsInputs, "Valuation Results");
  const mos = marginOfSafety(scenarios.base, currentPrice);
  addKV(wsInputs, "Bear Case Fair Value / Share", perShare(scenarios.bear),
    describeScenario(inputs, scen.bearAssumptions));
  addKV(wsInputs, "Base Case Fair Value / Share", perShare(scenarios.base), "Your assumptions as entered");
  addKV(wsInputs, "Bull Case Fair Value / Share", perShare(scenarios.bull),
    describeScenario(inputs, scen.bullAssumptions));
  addKV(wsInputs, "Current Market Price", perShare(currentPrice));
  addKV(wsInputs, "Margin of Safety (Base)", mos != null ? `${mos >= 0 ? "+" : ""}${mos.toFixed(1)}%` : "—",
    "% by which base fair value exceeds current price");
  addKV(wsInputs, "Terminal Value Share of EV", `${(baseResult.terminalValueShare * 100).toFixed(1)}%`,
    "How much of the valuation rests on the perpetuity rather than the forecast period");

  /* ── Sheet 2: Year-by-Year Projections ── */
  const wsProj = wb.addWorksheet("Projections");
  wsProj.columns = [
    { header: "Year", key: "yr", width: 8 },
    { header: `FCF (${cur.trim()})`, key: "fcf", width: 18 },
    { header: "Growth Applied (%)", key: "gr", width: 20 },
    { header: `Present Value (${cur.trim()})`, key: "pv", width: 18 },
    { header: `Cumulative PV (${cur.trim()})`, key: "cpv", width: 18 },
  ];

  wsProj.addRow(["DCF Year-by-Year Free Cash Flow Projections", "", "", "", ""]);
  wsProj.mergeCells(1, 1, 1, 5);
  wsProj.getRow(1).getCell(1).fill = NAVY;
  wsProj.getRow(1).getCell(1).font = WHITE_FONT;
  wsProj.getRow(1).getCell(1).alignment = { horizontal: "center" };
  wsProj.getRow(1).height = 24;
  wsProj.addRow([]);

  const projHeader = wsProj.addRow(["Year", "FCF ($)", "Growth Applied", "Present Value ($)", "Cumulative PV ($)"]);
  projHeader.eachCell((cell) => {
    cell.fill = BLUE;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "center" };
  });
  projHeader.height = 20;

  const pvTv = baseResult.pvTerminalValue;
  const totalPv = baseResult.enterpriseValue;
  const fairValuePerShare = baseResult.fairValuePerShare ?? 0;

  baseResult.projection.forEach((row, i) => {
    const r = wsProj.addRow([
      `Year ${row.year}`,
      row.fcf,
      row.growthApplied / 100,
      row.pv,
      row.cumulativePv,
    ]);
    const fill: ExcelJS.Fill = i % 2 === 0
      ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } }
      : { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    r.eachCell((cell) => { cell.fill = fill; cell.font = { size: 9 }; });
    r.getCell(2).numFmt = moneyBn;
    r.getCell(3).numFmt = "+0.0%;-0.0%";
    r.getCell(4).numFmt = moneyBn;
    r.getCell(5).numFmt = moneyBn;
    r.eachCell((cell, col) => {
      if (col > 1) cell.alignment = { horizontal: "right" };
    });
    r.height = 16;
  });

  // Terminal value and summary rows
  wsProj.addRow([]);
  const tvRow = wsProj.addRow(["Terminal Value (PV)", pvTv, "", "", ""]);
  tvRow.getCell(1).font = { bold: true, size: 9 };
  tvRow.getCell(2).numFmt = moneyBn;
  tvRow.getCell(2).font = { bold: true, size: 9 };
  tvRow.getCell(2).alignment = { horizontal: "right" };
  tvRow.getCell(1).fill = GRAY_FILL;
  tvRow.getCell(2).fill = GRAY_FILL;

  const totalRow = wsProj.addRow(["Total Enterprise Value (PV)", totalPv, "", "", ""]);
  totalRow.getCell(1).font = { bold: true, size: 9 };
  totalRow.getCell(2).numFmt = moneyBn;
  totalRow.getCell(2).font = { bold: true, size: 9 };
  totalRow.getCell(2).alignment = { horizontal: "right" };
  totalRow.getCell(1).fill = GRAY_FILL;
  totalRow.getCell(2).fill = GRAY_FILL;

  wsProj.addRow(["Less: Net Debt", inputs.netDebt, "", "", ""]);
  wsProj.lastRow!.getCell(2).numFmt = moneyBn;
  wsProj.lastRow!.getCell(2).alignment = { horizontal: "right" };
  wsProj.lastRow!.getCell(1).fill = GRAY_FILL;
  wsProj.lastRow!.getCell(2).fill = GRAY_FILL;

  const fvRow = wsProj.addRow(["→ Fair Value Per Share", fairValuePerShare, "", "", ""]);
  fvRow.getCell(1).font = { bold: true, size: 10, color: { argb: "FF1D4ED8" } };
  fvRow.getCell(2).numFmt = money;
  fvRow.getCell(2).font = { bold: true, size: 10, color: { argb: "FF1D4ED8" } };
  fvRow.getCell(2).alignment = { horizontal: "right" };
  fvRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFeff6ff" } };
  });
  fvRow.height = 22;

  /* ── Sheet 3: Scenarios ── */
  const wsScen = wb.addWorksheet("Scenarios");
  wsScen.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }];

  const scenTitle = wsScen.addRow(["Scenario Analysis", "", "", ""]);
  wsScen.mergeCells(1, 1, 1, 4);
  scenTitle.getCell(1).fill = NAVY;
  scenTitle.getCell(1).font = WHITE_FONT;
  scenTitle.getCell(1).alignment = { horizontal: "center" };
  scenTitle.height = 24;
  wsScen.addRow([]);

  const scenHdr = wsScen.addRow(["", "Bear Case", "Base Case", "Bull Case"]);
  scenHdr.eachCell((cell, col) => {
    if (col === 1) return;
    cell.fill = col === 2 ? RED_FILL : col === 3 ? BLUE : GREEN_FILL;
    cell.font = { bold: true, size: 9,
      color: { argb: col === 3 ? "FFFFFFFF" : col === 2 ? "FF991B1B" : "FF065F46" } };
    cell.alignment = { horizontal: "center" };
  });
  scenHdr.height = 22;

  const bearInputs = scen.bearAssumptions;
  const bullInputs = scen.bullAssumptions;
  const upside = (v: number | null): string => {
    const u = impliedUpside(v, currentPrice);
    return u == null ? "—" : `${u >= 0 ? "+" : ""}${u.toFixed(1)}%`;
  };

  const scenRows: Array<[string, string | number, string | number, string | number]> = [
    ["FCF Growth Y1–5 (%)", `${bearInputs.growthRate1.toFixed(1)}%`, `${inputs.growthRate1.toFixed(1)}%`, `${bullInputs.growthRate1.toFixed(1)}%`],
    ["FCF Growth Y6–10 (%)", `${bearInputs.growthRate2.toFixed(1)}%`, `${inputs.growthRate2.toFixed(1)}%`, `${bullInputs.growthRate2.toFixed(1)}%`],
    ["WACC (%)", `${bearInputs.discountRate.toFixed(1)}%`, `${inputs.discountRate.toFixed(1)}%`, `${bullInputs.discountRate.toFixed(1)}%`],
    ["Terminal Growth (%)", `${inputs.terminalGrowth.toFixed(1)}%`, `${inputs.terminalGrowth.toFixed(1)}%`, `${inputs.terminalGrowth.toFixed(1)}%`],
    ["", "", "", ""],
    ["Fair Value / Share", perShare(scenarios.bear), perShare(scenarios.base), perShare(scenarios.bull)],
    ...(currentPrice != null ? [
      ["Current Price", perShare(currentPrice), perShare(currentPrice), perShare(currentPrice)] as [string, string, string, string],
      ["Upside / (Downside)", upside(scenarios.bear), upside(scenarios.base), upside(scenarios.bull)] as [string, string, string, string],
    ] : []),
  ];

  scenRows.forEach(([label, bear, base, bull], i) => {
    const r = wsScen.addRow([label, bear, base, bull]);
    if (!label) { r.height = 8; return; }
    const isValRow = label === "Fair Value / Share";
    r.eachCell((cell) => { cell.font = { size: 9 }; cell.alignment = { vertical: "middle" }; });
    if (isValRow) {
      r.eachCell((cell, col) => {
        cell.font = { bold: true, size: 10, color: { argb: col === 1 ? "FF111827" : col === 2 ? "FF991B1B" : col === 3 ? "FF1D4ED8" : "FF065F46" } };
      });
    }
    const fillColor = i % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
    r.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
    });
    r.height = 18;
  });

  /* ── Sheet 4: Sensitivity Matrix ── */
  const wsSens = wb.addWorksheet("Sensitivity Matrix");

  const sensTitle = wsSens.addRow(["Sensitivity — Fair Value Per Share", ...Array(tgRange.length).fill("")]);
  wsSens.mergeCells(1, 1, 1, tgRange.length + 2);
  sensTitle.getCell(1).fill = NAVY;
  sensTitle.getCell(1).font = WHITE_FONT;
  sensTitle.getCell(1).alignment = { horizontal: "center" };
  sensTitle.height = 24;

  const subTitle = wsSens.addRow(["WACC \\ Terminal Growth →", ...tgRange.map((t) => `${t.toFixed(1)}%`)]);
  subTitle.eachCell((cell, col) => {
    cell.fill = BLUE;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: col === 1 ? "left" : "center" };
  });
  subTitle.height = 20;

  wsSens.getColumn(1).width = 22;
  tgRange.forEach((_, i) => { wsSens.getColumn(i + 2).width = 12; });

  // Highlight the cell matching the base case. Computed once, not per cell.
  const baseWaccIdx = waccRange.reduce((bi, w, i) =>
    Math.abs(w - inputs.discountRate) < Math.abs(waccRange[bi] - inputs.discountRate) ? i : bi, 0);
  const baseTgIdx = tgRange.reduce((bi, t, i) =>
    Math.abs(t - inputs.terminalGrowth) < Math.abs(tgRange[bi] - inputs.terminalGrowth) ? i : bi, 0);

  waccRange.forEach((wacc, ri) => {
    // A null cell is a WACC/terminal-growth pair the model cannot value.
    const r = wsSens.addRow([`${wacc}%`, ...sensitivity[ri].map((v) => v ?? "—")]);
    r.getCell(1).font = { bold: true, size: 9 };
    r.getCell(1).fill = BLUE;
    r.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    r.getCell(1).alignment = { horizontal: "center" };

    sensitivity[ri].forEach((val, ci) => {
      const cell = r.getCell(ci + 2);
      cell.alignment = { horizontal: "center" };
      if (val == null) {
        cell.fill = GRAY_FILL;
        cell.font = { size: 9, italic: true, color: { argb: "FF6B7280" } };
        return;
      }
      cell.numFmt = money;
      let fill: ExcelJS.Fill;
      if (currentPrice && val > currentPrice * 1.3) fill = GREEN_FILL;
      else if (currentPrice && val > currentPrice) fill = AMBER_FILL;
      else fill = RED_FILL;
      cell.fill = fill;
      cell.font = {
        size: 9,
        bold: currentPrice ? val > currentPrice * 1.3 : false,
        color: { argb: currentPrice
          ? val > currentPrice * 1.3 ? "FF065F46" : val > currentPrice ? "FF92400E" : "FF991B1B"
          : "FF111827" },
      };
      if (ri === baseWaccIdx && ci === baseTgIdx) {
        cell.border = { top: { style: "medium", color: { argb: "FF1D4ED8" } }, bottom: { style: "medium", color: { argb: "FF1D4ED8" } }, left: { style: "medium", color: { argb: "FF1D4ED8" } }, right: { style: "medium", color: { argb: "FF1D4ED8" } } };
      }
    });
    r.height = 18;
  });

  wsSens.addRow([]);
  const legend = wsSens.addRow(["Legend:", "Green = >30% above price", "Yellow = above price", "Red = below price"]);
  legend.eachCell((cell) => { cell.font = { size: 8, italic: true, color: { argb: "FF6B7280" } }; });
  const noteRow = wsSens.addRow(["", "Blue border = base case assumptions"]);
  noteRow.getCell(2).font = { size: 8, italic: true, color: { argb: "FF1D4ED8" } };

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dcf-${symbol}-${date}.xlsx"`,
    },
  });
}
