import ExcelJS from "exceljs";
import { guardedExport } from "@/lib/download";
import { currencySymbol } from "@/lib/format";
import { normalizeSymbol } from "@/lib/market";
import { getValuationCase, listValuationEvents } from "@/lib/db";
import { DATA_SOURCES } from "@/lib/provenance";
import {
  ASSUMPTION_KEYS,
  ASSUMPTION_LABEL,
  IMPLIED_GROWTH_CAVEAT,
  IMPLIED_GROWTH_LABEL,
  RATE_ASSUMPTIONS,
  VALUATION_METHOD_LABEL,
  VALUATION_METHOD_SCOPE,
  assumptionsToDcf,
  diffAssumptions,
  type Assumption,
  type ValuationCase,
} from "@/lib/valuation/case";
import {
  TERMINAL_GROWTH_RANGE,
  buildScenarios,
  buildSensitivity,
  describeScenario,
  impliedUpside,
} from "@/lib/valuation/dcf";
import { getEnginePrior } from "@/lib/valuation/engine-prior";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/export/valuation — the whole case as a workbook.
 *
 * The old DCF export took raw assumption *numbers*, which meant the spreadsheet
 * lost the only part worth keeping: where each figure came from, why it was
 * chosen, who chose it, and what it used to be. This exports the persisted case
 * instead — assumptions with provenance and rationale, AI's objections, the
 * version history with the price at each point, and the engine's prior — so the
 * file is a faithful record rather than a snapshot of seven inputs.
 */

const NAVY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
const GRAY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
const BRAND: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
const WHITE_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

function sourceLabel(source: Assumption["source"]): string {
  if (source in DATA_SOURCES) return DATA_SOURCES[source as keyof typeof DATA_SOURCES].name;
  switch (source) {
    case "reverse_dcf": return "Implied by price";
    case "ai": return "AI";
    case "user": return "You";
    case "peer_median": return "Peer median";
    case "history": return "Reported history";
    default: return "Default";
  }
}

function titleRow(ws: ExcelJS.Worksheet, text: string, span: number) {
  const row = ws.addRow([text]);
  ws.mergeCells(row.number, 1, row.number, span);
  row.getCell(1).fill = NAVY;
  row.getCell(1).font = WHITE_FONT;
  row.getCell(1).alignment = { horizontal: "center" };
  row.height = 24;
}

function headerRow(ws: ExcelJS.Worksheet, cells: string[]) {
  const row = ws.addRow(cells);
  row.eachCell((cell) => {
    cell.fill = BLUE;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.alignment = { horizontal: "left", vertical: "middle" };
  });
  row.height = 20;
  return row;
}

export function POST(request: Request): Promise<Response> {
  return guardedExport("api/export/valuation", () => buildValuationExport(request));
}

async function buildValuationExport(request: Request): Promise<Response> {
  let body: { symbol?: string };
  try {
    body = (await request.json()) as { symbol?: string };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const symbol = normalizeSymbol(body.symbol);
  if (!symbol) return new Response("A valid `symbol` is required", { status: 400 });

  const vcase = getValuationCase(symbol);
  if (!vcase) return new Response(`No valuation case exists for ${symbol}`, { status: 404 });

  const events = listValuationEvents(symbol, 200);
  const cur = currencySymbol(vcase.currency);
  const money = `"${cur}"#,##0.00`;
  const bn = `"${cur}"#,##0,,,"B"`;
  const date = new Date().toISOString().slice(0, 10);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  /* ── Sheet 1: The case ── */
  buildCaseSheet(wb, vcase, cur, money, bn, date);

  /* ── Sheet 2: Assumptions, with provenance and reasoning ── */
  buildAssumptionsSheet(wb, vcase, cur, money);

  /* ── Sheet 3: Version history ── */
  buildHistorySheet(wb, vcase, events, money);

  /* ── Sheet 4: Projection + sensitivity ── */
  buildModelSheet(wb, vcase, money, bn);

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="valuation-${symbol}-${date}.xlsx"`,
    },
  });
}

function buildCaseSheet(
  wb: ExcelJS.Workbook, vcase: ValuationCase,
  cur: string, money: string, bn: string, date: string,
) {
  const ws = wb.addWorksheet("Valuation Case");
  ws.columns = [{ width: 34 }, { width: 22 }, { width: 62 }];

  titleRow(ws, `Valuation Case — ${vcase.symbol}`, 3);
  ws.addRow([]);

  const kv = (label: string, value: string | number, note = "") => {
    const row = ws.addRow([label, value, note]);
    row.getCell(1).font = { bold: true, size: 9 };
    row.getCell(2).font = { size: 10 };
    row.getCell(3).font = { size: 8, italic: true, color: { argb: "FF6B7280" } };
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    return row;
  };

  kv("Exported", date);
  kv("Version", `v${vcase.version}`, "Every change appends a version; nothing is overwritten.");
  kv("Last changed by", vcase.author === "user" ? "You" : vcase.author === "ai" ? "AI" : "Seeded from price");
  kv("Last changed at", vcase.updatedAt);
  kv("You last edited", vcase.lastUserEventAt ?? "never",
    vcase.lastUserEventAt ? "" : "None of these assumptions are yours yet.");
  kv("Method", VALUATION_METHOD_LABEL[vcase.method], VALUATION_METHOD_SCOPE[vcase.method]);
  kv("Reporting currency", vcase.currency);
  ws.addRow([]);

  const r = vcase.result;
  const fv = kv("Fair value per share", r.fairValue ?? "not computable",
    "What this case's own assumptions imply. Not an AI estimate.");
  if (r.fairValue != null) fv.getCell(2).numFmt = money;
  fv.eachCell((c) => { c.fill = BRAND; });
  fv.getCell(1).font = { bold: true, size: 10, color: { argb: "FF1D4ED8" } };
  fv.getCell(2).font = { bold: true, size: 11, color: { argb: "FF1D4ED8" } };

  const bear = kv("Bear case", r.fairValueBear ?? "—");
  if (r.fairValueBear != null) bear.getCell(2).numFmt = money;
  const bull = kv("Bull case", r.fairValueBull ?? "—");
  if (r.fairValueBull != null) bull.getCell(2).numFmt = money;

  const px = kv("Price when last computed", vcase.priceAt ?? "—",
    "Margins of safety in this file are as of that price.");
  if (vcase.priceAt != null) px.getCell(2).numFmt = money;

  kv("Margin of safety",
    r.marginOfSafety != null ? `${r.marginOfSafety >= 0 ? "+" : ""}${r.marginOfSafety.toFixed(1)}%` : "—",
    "How far the price sits below this case's value.");
  kv(IMPLIED_GROWTH_LABEL,
    r.impliedGrowth != null ? `${r.impliedGrowth.toFixed(1)}%` : "—",
    IMPLIED_GROWTH_CAVEAT);
  kv("Value from terminal period", `${(r.terminalValueShare * 100).toFixed(0)}%`,
    "How much of the valuation rests on the perpetuity rather than the forecast years.");
  if (r.invalidReason) kv("Not computable because", r.invalidReason);

  const prior = getEnginePrior(vcase.symbol);
  if (prior?.p50 != null) {
    ws.addRow([]);
    const h = ws.addRow(["Quant engine prior (independent)"]);
    h.getCell(1).fill = GRAY;
    h.getCell(1).font = { bold: true, size: 9 };
    const p50 = kv("Monte Carlo median (p50)", prior.p50,
      "Median of a 50,000-path simulation run by the quant engine. A systematic prior, not a target.");
    p50.getCell(2).numFmt = money;
    if (prior.p10 != null && prior.p90 != null) {
      const band = kv("p10 – p90", `${cur}${prior.p10.toFixed(2)} – ${cur}${prior.p90.toFixed(2)}`);
      band.getCell(2).font = { size: 9 };
    }
    if (prior.wacc != null) kv("Engine WACC", `${(prior.wacc * 100).toFixed(1)}%`);
    if (prior.asOf) kv("Engine run date", prior.asOf);
    if (r.fairValue != null && prior.p50 !== 0) {
      const spread = ((r.fairValue - prior.p50) / Math.abs(prior.p50)) * 100;
      kv("This case vs the engine", `${spread >= 0 ? "+" : ""}${spread.toFixed(1)}%`,
        "Positive means your case is more optimistic than the systematic prior.");
    }
  }
  void bn;
}

function buildAssumptionsSheet(
  wb: ExcelJS.Workbook, vcase: ValuationCase, cur: string, money: string,
) {
  const ws = wb.addWorksheet("Assumptions");
  ws.columns = [
    { width: 24 }, { width: 16 }, { width: 20 }, { width: 10 },
    { width: 54 }, { width: 40 }, { width: 22 }, { width: 22 },
  ];

  titleRow(ws, "Assumptions — value, where it came from, and why", 8);
  headerRow(ws, [
    "Assumption", "Value", "Source", "Yours?", "Reasoning", "AI's objection",
    "Anchors", "Last changed",
  ]);

  for (const key of ASSUMPTION_KEYS) {
    const a = vcase.assumptions[key];
    const isRate = RATE_ASSUMPTIONS.has(key);
    const anchors = Object.entries(a.anchors)
      .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(1) : v}`)
      .join("; ");

    const row = ws.addRow([
      ASSUMPTION_LABEL[key],
      isRate ? a.value / 100 : a.value,
      sourceLabel(a.source),
      a.locked ? "Yes" : "—",
      a.rationale ?? "",
      a.critique ?? "",
      anchors,
      a.updatedAt,
    ]);
    row.getCell(2).numFmt = isRate ? "0.0%" : key === "sharesOutstanding" ? "#,##0" : money;
    row.eachCell((cell) => {
      cell.font = { size: 9 };
      cell.alignment = { wrapText: true, vertical: "top" };
    });
    // A user-owned assumption is the load-bearing part of the case; mark it.
    if (a.locked) {
      row.getCell(1).font = { size: 9, bold: true };
      row.getCell(4).font = { size: 9, bold: true, color: { argb: "FF1D4ED8" } };
      row.getCell(4).fill = BRAND;
    }
    if (a.critique) row.getCell(6).font = { size: 9, italic: true, color: { argb: "FF92400E" } };
  }

  ws.addRow([]);
  const note = ws.addRow([
    "“Yours?” marks an assumption you set yourself. AI may argue with those — see its objection — but never overwrites them.",
  ]);
  ws.mergeCells(note.number, 1, note.number, 8);
  note.getCell(1).font = { size: 8, italic: true, color: { argb: "FF6B7280" } };
  void cur;
}

function buildHistorySheet(
  wb: ExcelJS.Workbook, vcase: ValuationCase,
  events: ReturnType<typeof listValuationEvents>, money: string,
) {
  // Never name this sheet "History": the bare word is reserved by the XLSX
  // spec for Excel's change-tracking log, and ExcelJS throws on it — which
  // took the whole export down (2026-08-14).
  const ws = wb.addWorksheet("Version History");
  ws.columns = [
    { width: 8 }, { width: 22 }, { width: 16 }, { width: 20 },
    { width: 16 }, { width: 16 }, { width: 52 }, { width: 46 },
  ];

  titleRow(ws, "Version history — what changed, when, and at what price", 8);
  headerRow(ws, [
    "Version", "When", "By", "Why (trigger)", "Price then", "Fair value then",
    "Assumptions changed", "Note",
  ]);

  // Newest first, so the diff is against the next row down.
  events.forEach((event, i) => {
    const previous = events[i + 1];
    const changes = previous ? diffAssumptions(previous.assumptions, event.assumptions) : [];
    const changeText = changes.length > 0
      ? changes.map((c) => `${c.label}: ${c.isRate ? `${c.from.toFixed(1)}% → ${c.to.toFixed(1)}%` : `${c.from.toPrecision(4)} → ${c.to.toPrecision(4)}`}`).join("; ")
      : previous ? "No assumption changed" : "Initial case";

    const row = ws.addRow([
      `v${event.version}`,
      event.createdAt,
      event.author === "user" ? "You" : event.author === "ai" ? "AI" : event.author,
      event.trigger ?? "",
      event.priceAt ?? "—",
      event.result?.fairValue ?? "—",
      changeText,
      event.note ?? "",
    ]);
    if (event.priceAt != null) row.getCell(5).numFmt = money;
    if (event.result?.fairValue != null) row.getCell(6).numFmt = money;
    row.eachCell((cell) => {
      cell.font = { size: 9 };
      cell.alignment = { wrapText: true, vertical: "top" };
    });
    if (event.author === "user") row.getCell(3).font = { size: 9, bold: true, color: { argb: "FF1D4ED8" } };
  });

  ws.addRow([]);
  const note = ws.addRow([
    "The price at each version is recorded so “what margin of safety did I believe at the time?” stays answerable.",
  ]);
  ws.mergeCells(note.number, 1, note.number, 8);
  note.getCell(1).font = { size: 8, italic: true, color: { argb: "FF6B7280" } };

  void vcase;
}

function buildModelSheet(
  wb: ExcelJS.Workbook, vcase: ValuationCase, money: string, bn: string,
) {
  const ws = wb.addWorksheet("Model");
  const dcf = assumptionsToDcf(vcase.assumptions);
  const scen = buildScenarios(dcf);

  ws.columns = [{ width: 26 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];

  titleRow(ws, "Projection, scenarios and sensitivity", 8);

  headerRow(ws, ["Year", "FCF", "Growth applied", "Present value", "Cumulative PV"]);
  for (const p of scen.base.projection) {
    const row = ws.addRow([`Year ${p.year}`, p.fcf, p.growthApplied / 100, p.pv, p.cumulativePv]);
    row.getCell(2).numFmt = bn;
    row.getCell(3).numFmt = "+0.0%;-0.0%";
    row.getCell(4).numFmt = bn;
    row.getCell(5).numFmt = bn;
    row.eachCell((c) => { c.font = { size: 9 }; });
  }

  // The bridge from the projection to the per-share figure — same numbers the
  // engine already computed, so the file shows its working end to end.
  if (scen.base.invalidReason === null) {
    ws.addRow([]);
    const bridge: [string, number, boolean][] = [
      ["PV of forecast years", scen.base.pvExplicit, false],
      ["PV of terminal value", scen.base.pvTerminalValue, false],
      ["Enterprise value", scen.base.enterpriseValue, true],
      ["Less: net debt", dcf.netDebt, false],
      ["Equity value", scen.base.equityValue, true],
    ];
    for (const [label, value, emphasize] of bridge) {
      const row = ws.addRow([label, value]);
      row.getCell(1).font = { size: 9, bold: emphasize };
      row.getCell(2).numFmt = bn;
      row.getCell(2).font = { size: 9, bold: emphasize };
      if (emphasize) { row.getCell(1).fill = GRAY; row.getCell(2).fill = GRAY; }
    }
    const fv = ws.addRow(["→ Fair value per share", scen.base.fairValuePerShare ?? "—"]);
    fv.getCell(1).font = { size: 10, bold: true, color: { argb: "FF1D4ED8" } };
    fv.getCell(2).numFmt = money;
    fv.getCell(2).font = { size: 10, bold: true, color: { argb: "FF1D4ED8" } };
    fv.eachCell((c) => { c.fill = BRAND; });
  }

  ws.addRow([]);
  headerRow(ws, ["Scenario", "Fair value", "Upside vs price", "Assumptions"]);
  const price = vcase.priceAt;
  const upside = (v: number | null): string => {
    const u = impliedUpside(v, price);
    return u == null ? "—" : `${u >= 0 ? "+" : ""}${u.toFixed(1)}%`;
  };
  const rows: [string, number | null, string][] = [
    ["Bear", scen.bear.fairValuePerShare, describeScenario(dcf, scen.bearAssumptions)],
    ["Base", scen.base.fairValuePerShare, "Your assumptions as saved"],
    ["Bull", scen.bull.fairValuePerShare, describeScenario(dcf, scen.bullAssumptions)],
  ];
  for (const [label, value, note] of rows) {
    const row = ws.addRow([label, value ?? "—", upside(value), note]);
    if (value != null) row.getCell(2).numFmt = money;
    row.eachCell((c) => { c.font = { size: 9 }; });
    if (label === "Base") row.eachCell((c) => { c.fill = BRAND; });
  }

  ws.addRow([]);
  const sens = buildSensitivity(dcf);
  headerRow(ws, ["WACC \\ terminal growth", ...TERMINAL_GROWTH_RANGE.map((t) => `${t.toFixed(1)}%`)]);
  sens.waccRange.forEach((wacc, ri) => {
    const row = ws.addRow([`${wacc}%`, ...sens.table[ri].map((v) => v ?? "—")]);
    row.eachCell((cell, col) => {
      cell.font = { size: 9 };
      if (col > 1 && typeof cell.value === "number") cell.numFmt = money;
    });
    row.getCell(1).fill = GRAY;
    row.getCell(1).font = { size: 9, bold: true };
  });

  ws.addRow([]);
  const note = ws.addRow(["A dash means that pair of assumptions cannot be valued — usually a discount rate at or below terminal growth."]);
  ws.mergeCells(note.number, 1, note.number, 8);
  note.getCell(1).font = { size: 8, italic: true, color: { argb: "FF6B7280" } };
}
