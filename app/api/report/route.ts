import ExcelJS from "exceljs";
import { formatCompactCurrency, formatCurrency, formatPerShare, statementsCurrency } from "@/lib/format";
import { getFundamentals } from "@/lib/fundamentals";
import { normalizeSymbol } from "@/lib/market";
import { getFinancialStatements } from "@/lib/statements";
import { getFundamentalsTimeSeries, getHistory, getQuote } from "@/lib/yahoo";
import { scoreStep, SCORING_METHODOLOGY_VERSION } from "@/lib/recommendation";
import { assessRisks, computeMomentum, computeScore } from "@/lib/scoring";
import { getRecentFilings } from "@/lib/edgar";
import { getPeerComparison } from "@/lib/peers";
import type { FinancialStatements, HistoryPoint, ValuationPoint } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ─── colour palette (ARGB strings for exceljs) ─────────────────────────── */
const NAVY  = "FF0F2D5A";
const BLUE  = "FF1D4ED8";
const WHITE = "FFFFFFFF";
const POS   = "FF15803D";
const NEG   = "FFB91C1C";
const AMBER = "FFB45309";
const MUTED = "FF64748B";
const BGALT = "FFF8FAFC";
const BGHEAD = "FFE2E8F0";
const BORDER_CLR = "FFE2E8F0";

/** Report-palette color for a 0-100 score, from the canonical band steps
 *  (lib/recommendation.ts) — previously an inline 70/45 table. */
const scoreArgbFont = (v: number): string => {
  const step = scoreStep(v);
  return step === "high" ? POS : step === "mid" ? AMBER : NEG;
};

/* ─── formatters ─────────────────────────────────────────────────────────── */
const f2 = (v: number | null | undefined, d = 2): string =>
  v == null || !Number.isFinite(v) ? "—"
  : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fPct = (v: number | null | undefined, d = 1): string =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

/**
 * Compact money in an EXPLICIT currency — the report covers every listing
 * (7974.T, RELIANCE.NS, BP.L), so no cell may bake in a dollar sign. Quote-
 * scale figures pass q.currency; financialData/statement figures pass the
 * reporting currency (statementsCurrency), which differs for ADR-class names.
 */
const fMoney = (v: number | null | undefined, currency: string): string =>
  formatCompactCurrency(v, currency);

const rv = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in v) {
    const x = (v as { raw?: number }).raw;
    return x != null && Number.isFinite(x) ? x : null;
  }
  return null;
};

/* ─── valuation history builder ────────────────────────────────────────── */
function buildValuation(ts: Record<string, unknown>[], hist: HistoryPoint[]): ValuationPoint[] {
  const byYear = new Map<number, ValuationPoint>();
  for (const row of ts) {
    const rd = row.asOfDate ?? row.date;
    if (!rd) continue;
    let iso: string;
    try { iso = new Date(rd as string | Date).toISOString().slice(0, 10); } catch { continue; }
    const year = new Date(iso).getFullYear();
    let price: number | null = null;
    for (const p of hist) if (p.date <= iso) price = p.close;
    if (!price) continue;
    const eps = rv(row.dilutedEPS), rev = rv(row.totalRevenue), sh = rv(row.dilutedAverageShares);
    const pe = eps && eps > 0 ? +(price / eps).toFixed(1) : null;
    const ps = rev && rev > 0 && sh && sh > 0 ? +((price * sh) / rev).toFixed(2) : null;
    if ((pe && pe >= 1 && pe <= 500) || (ps && ps >= 0.1 && ps <= 100))
      byYear.set(year, {
        year,
        peRatio: pe && pe >= 1 && pe <= 500 ? pe : null,
        psRatio: ps && ps >= 0.1 && ps <= 100 ? ps : null,
      });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/* ═══════════════════════════════════════════════════════════════════════
   ExcelJS helpers
════════════════════════════════════════════════════════════════════════ */
type WS = ExcelJS.Worksheet;

const thinBorder = {
  top:    { style: "thin" as const, color: { argb: BORDER_CLR } },
  left:   { style: "thin" as const, color: { argb: BORDER_CLR } },
  bottom: { style: "thin" as const, color: { argb: BORDER_CLR } },
  right:  { style: "thin" as const, color: { argb: BORDER_CLR } },
} as ExcelJS.Borders;

function navyCell(ws: WS, rowNum: number, colNum: number, text: string) {
  const cell = ws.getCell(rowNum, colNum);
  cell.value = text;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  cell.font = { name: "Calibri", bold: true, color: { argb: WHITE }, size: 10 };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  cell.border = thinBorder;
}

function sectionHeader(ws: WS, rowNum: number, colSpan: number, title: string): number {
  const row = ws.getRow(rowNum);
  row.height = 22;
  for (let c = 1; c <= colSpan; c++) navyCell(ws, rowNum, c, "");
  ws.mergeCells(rowNum, 1, rowNum, colSpan);
  const cell = ws.getCell(rowNum, 1);
  cell.value = title;
  cell.font = { name: "Calibri", bold: true, color: { argb: WHITE }, size: 11 };
  cell.alignment = { horizontal: "left", vertical: "middle" };
  return rowNum + 1;
}

function tableHeader(ws: WS, rowNum: number, headers: string[]): number {
  const row = ws.getRow(rowNum);
  row.height = 18;
  headers.forEach((h, i) => navyCell(ws, rowNum, i + 1, h));
  return rowNum + 1;
}

function dataRow(
  ws: WS,
  rowNum: number,
  values: (string | number | null)[],
  opts?: { bold?: boolean; bgArgb?: string; colColors?: (string | undefined)[] },
): number {
  const row = ws.getRow(rowNum);
  row.height = 16;
  const bg = opts?.bgArgb ?? (rowNum % 2 === 0 ? BGALT : WHITE);
  values.forEach((v, i) => {
    const cell = ws.getCell(rowNum, i + 1);
    cell.value = v ?? "—";
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.font = {
      name: "Calibri",
      size: 10,
      bold: opts?.bold && i === 0,
      color: { argb: opts?.colColors?.[i] ?? "FF111827" },
    };
    cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right" };
    cell.border = thinBorder;
  });
  return rowNum + 1;
}

function kvBlock(
  ws: WS,
  startRow: number,
  pairs: { label: string; value: string; color?: string }[],
): number {
  let r = startRow;
  for (const p of pairs) {
    const labelCell = ws.getCell(r, 1);
    labelCell.value = p.label;
    labelCell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
    labelCell.alignment = { horizontal: "left" };
    const valCell = ws.getCell(r, 2);
    valCell.value = p.value;
    valCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: p.color ?? "FF111827" } };
    valCell.alignment = { horizontal: "right" };
    r++;
  }
  return r;
}

/* ═══════════════════════════════════════════════════════════════════════
   ROUTE HANDLER
════════════════════════════════════════════════════════════════════════ */
export async function GET(request: Request) {
  try { return await generateReport(request); }
  catch (err) {
    // Full detail (incl. stack) goes to the server log only — the client gets
    // the message, never the stack.
    console.error("[report]", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
    const msg = err instanceof Error ? err.message : "Report generation failed";
    return new Response(msg, { status: 500 });
  }
}

async function generateReport(request: Request): Promise<Response> {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) return new Response("A valid `symbol` is required", { status: 400 });

  const [quoteR, histR, fundR, stmtsR, tsR, filingsR, peersR] = await Promise.allSettled([
    getQuote(symbol),
    getHistory(symbol, 1825),
    getFundamentals(symbol),
    getFinancialStatements(symbol).then(
      (s) => ({ ok: true as const, data: s as FinancialStatements }),
      (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "unavailable" }),
    ),
    getFundamentalsTimeSeries(symbol).catch(() => [] as Record<string, unknown>[]),
    getRecentFilings(symbol).catch(() => []),
    getPeerComparison(symbol).catch(() => null),
  ]);

  if (quoteR.status === "rejected") return new Response(`Symbol not found: ${symbol}`, { status: 404 });

  const q       = quoteR.value;
  const hist    = histR.status === "fulfilled" ? histR.value : [];
  const fund    = fundR.status === "fulfilled" ? fundR.value : null;
  const stmts   = stmtsR.status === "fulfilled" && stmtsR.value.ok ? stmtsR.value.data : null;
  const ts      = tsR.status === "fulfilled" ? tsR.value : [];
  const filings = filingsR.status === "fulfilled" ? filingsR.value : [];
  const peers   = peersR.status === "fulfilled" ? peersR.value : null;

  const snap      = fund?.snapshot ?? null;
  const analyst   = fund?.analyst ?? null;
  const insider   = fund?.insider ?? null;
  const ownership = fund?.ownership ?? null;
  // Reporting currency for financialData/statement magnitudes (TSM: TWD on a
  // USD listing); identical to the listing currency for non-ADRs.
  const finCur    = statementsCurrency(snap?.financialCurrency, q.currency) ?? q.currency;
  const earnings  = fund?.earnings ?? null;
  const momentum  = computeMomentum(hist);
  const score     = fund && snap ? computeScore(snap, stmts, analyst!, momentum) : null;
  const risks     = fund && snap ? assessRisks(snap, stmts, analyst!, insider!) : [];
  const valHist   = buildValuation(ts, hist);
  const today     = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();
  wb.modified = new Date();
  wb.subject = `Scoring methodology ${SCORING_METHODOLOGY_VERSION}`;

  /* ════════════════════════════════════════════════════════════════════
     SHEET 1 — OVERVIEW
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Overview", { properties: { tabColor: { argb: NAVY } } });
    ws.columns = [
      { key: "a", width: 30 },
      { key: "b", width: 25 },
      { key: "c", width: 25 },
      { key: "d", width: 25 },
    ];

    let r = 1;

    // Title banner
    ws.getRow(r).height = 40;
    for (let c = 1; c <= 4; c++) navyCell(ws, r, c, "");
    ws.mergeCells(r, 1, r, 4);
    const titleCell = ws.getCell(r, 1);
    titleCell.value = `EQUITY RESEARCH REPORT — ${q.symbol}`;
    titleCell.font = { name: "Calibri", bold: true, size: 18, color: { argb: WHITE } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    r++;

    // Subtitle
    ws.getRow(r).height = 22;
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
      cell.value = "";
    }
    ws.mergeCells(r, 1, r, 4);
    const subCell = ws.getCell(r, 1);
    subCell.value = `${q.name}  ·  ${q.exchange ?? ""}  ·  Generated ${today}`;
    subCell.font = { name: "Calibri", size: 11, color: { argb: WHITE } };
    subCell.alignment = { horizontal: "center", vertical: "middle" };
    r++;
    r++; // blank

    // Price row
    ws.getRow(r).height = 30;
    const priceCell = ws.getCell(r, 1);
    priceCell.value = formatCurrency(q.price, q.currency);
    priceCell.font = { name: "Calibri", bold: true, size: 22, color: { argb: "FF111827" } };
    priceCell.alignment = { horizontal: "left", vertical: "middle" };

    const pos = q.changePercent >= 0;
    const chgCell = ws.getCell(r, 2);
    chgCell.value = `${pos ? "+" : ""}${formatCurrency(q.change, q.currency)}  (${pos ? "+" : ""}${q.changePercent.toFixed(2)}%)`;
    chgCell.font = { name: "Calibri", bold: true, size: 13, color: { argb: pos ? POS : NEG } };
    chgCell.alignment = { horizontal: "left", vertical: "middle" };

    if (score) {
      ws.getCell(r, 3).value = `Fundamental Score: ${Math.round(score.total)}/100`;
      ws.getCell(r, 3).font = { name: "Calibri", bold: true, size: 12, color: { argb: scoreArgbFont(score.total) } };
      ws.getCell(r, 4).value = `Rating: ${score.recommendation.replace("_", " ")}`;
      ws.getCell(r, 4).font = { name: "Calibri", bold: true, size: 12, color: { argb: NAVY } };
    }
    r++;
    r++;

    // Key stats
    r = sectionHeader(ws, r, 4, "KEY STATISTICS");

    const ev = q.marketCap != null && snap?.ebitda != null
      ? f2((q.marketCap + (snap.totalDebt ?? 0) - (snap.totalCash ?? 0)) / snap.ebitda) : "—";

    const stats: [string, string, string, string][] = [
      ["Market Cap",       fMoney(q.marketCap, q.currency), "52-Wk High",      formatCurrency(q.fiftyTwoWeekHigh, q.currency)],
      ["P/E (Trailing)",   f2(q.peRatio),                 "52-Wk Low",         formatCurrency(q.fiftyTwoWeekLow, q.currency)],
      ["Forward P/E",      f2(snap?.forwardPE),           "Volume",            q.volume != null ? q.volume.toLocaleString() : "—"],
      ["PEG Ratio",        f2(snap?.pegRatio),            "Dividend Yield",    snap?.dividendYield != null ? `${(snap.dividendYield * 100).toFixed(2)}%` : "—"],
      ["Price / Book",     f2(snap?.priceToBook),         "Free Cash Flow",    fMoney(snap?.freeCashflow, finCur)],
      ["EV / EBITDA",      ev,                            "Total Cash",        fMoney(snap?.totalCash, finCur)],
      ["Debt / Equity",    snap?.debtToEquity != null ? `${f2(snap.debtToEquity)}x` : "—", "Total Debt", fMoney(snap?.totalDebt, finCur)],
      ["Current Ratio",    snap?.currentRatio != null ? `${f2(snap.currentRatio)}x` : "—", "Revenue Growth", snap?.revenueGrowth != null ? fPct(snap.revenueGrowth * 100) : "—"],
      ["Return on Equity", snap?.returnOnEquity != null ? `${(snap.returnOnEquity * 100).toFixed(1)}%` : "—", "Earnings Growth", snap?.earningsGrowth != null ? fPct(snap.earningsGrowth * 100) : "—"],
      ["Net Margin",       snap?.profitMargins != null ? `${(snap.profitMargins * 100).toFixed(1)}%` : "—", "Exchange", q.exchange ?? "—"],
    ];

    r = tableHeader(ws, r, ["Metric", "Value", "Metric", "Value"]);
    stats.forEach(([l1, v1, l2, v2], i) => {
      ws.getRow(r).height = 16;
      const bg = i % 2 === 0 ? WHITE : BGALT;
      [l1, v1, l2, v2].forEach((val, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = val;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.font = { name: "Calibri", size: 10, bold: ci === 0 || ci === 2 };
        cell.alignment = { horizontal: ci % 2 === 0 ? "left" : "right", vertical: "middle" };
        cell.border = thinBorder;
      });
      r++;
    });
    r++;

    // Score breakdown
    if (score) {
      r = sectionHeader(ws, r, 4, "COMPOSITE SCORE BREAKDOWN");
      r = tableHeader(ws, r, ["Category", "Points", "Max", "Score %"]);
      score.buckets.forEach((b, i) => {
        const pct = b.max > 0 ? b.points / b.max : 0;
        const color = scoreArgbFont(pct * 100);
        r = dataRow(ws, r, [b.name, b.points, b.max, `${(pct * 100).toFixed(0)}%`], {
          bgArgb: i % 2 === 0 ? WHITE : BGALT,
          colColors: [undefined, color, undefined, color],
        });
      });
      ws.getRow(r).height = 18;
      ["TOTAL", Math.round(score.total), 100, `${Math.round(score.total)}/100`].forEach((v, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = v;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BGHEAD } };
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: scoreArgbFont(score.total) } };
        cell.alignment = { horizontal: ci === 0 ? "left" : "right", vertical: "middle" };
        cell.border = thinBorder;
      });
      r++;
      r++;

      ws.mergeCells(r, 1, r, 4);
      const ratCell = ws.getCell(r, 1);
      ratCell.value = `Rationale: ${score.rationale}`;
      ratCell.font = { name: "Calibri", size: 9, italic: true, color: { argb: MUTED } };
      ratCell.alignment = { wrapText: true, horizontal: "left" };
      ws.getRow(r).height = 30;
      r++;
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     SHEET 2 — FINANCIAL STATEMENTS
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Financials", { properties: { tabColor: { argb: BLUE } } });

    if (stmts) {
      const yrs = stmts.fiscalYears;
      ws.columns = [
        { key: "metric", width: 26 },
        ...yrs.map(y => ({ key: String(y), width: 16 })),
        { key: "cagr", width: 14 },
      ];

      let r = 1;
      // This sheet's source is getFinancialStatements — the EDGAR path, which
      // extracts USD-unit XBRL facts exclusively (lib/statements.ts) — so the
      // USD here is a property of the data, not an assumption.
      r = sectionHeader(ws, r, yrs.length + 2, "INCOME STATEMENT  (figures in USD)");
      r = tableHeader(ws, r, ["Metric", ...yrs.map(String), "CAGR"]);

      const findV = (arr: { fy: number; value: number }[], y: number) => {
        const x = arr.find(a => a.fy === y); return x ? fMoney(x.value, "USD") : "—";
      };
      // margins are stored as ratios (0.479 = 47.9%)
      const findM = (arr: { fy: number; value: number }[], y: number) => {
        const x = arr.find(a => a.fy === y); return x ? `${(x.value * 100).toFixed(1)}%` : "—";
      };

      [
        ["Revenue",         stmts.revenue,        stmts.revenueCagr],
        ["Gross Profit",    stmts.grossProfit,     null],
        ["Operating Income",stmts.operatingIncome, null],
        ["Net Income",      stmts.netIncome,       null],
        ["Free Cash Flow",  stmts.freeCashFlow,    stmts.fcfCagr],
      ].forEach(([label, arr, cagrVal], i) => {
        r = dataRow(ws, r,
          // cagr is also a ratio: multiply × 100 before fPct
          [label as string, ...yrs.map(y => findV(arr as { fy: number; value: number }[], y)), cagrVal != null ? fPct((cagrVal as number) * 100) : "—"],
          { bold: i === 0, bgArgb: i % 2 === 0 ? WHITE : BGALT },
        );
      });
      r++;

      r = sectionHeader(ws, r, yrs.length + 2, "MARGINS (% of Revenue)");
      r = tableHeader(ws, r, ["Metric", ...yrs.map(String), ""]);
      [
        ["Gross Margin",     stmts.grossMargin],
        ["Operating Margin", stmts.operatingMargin],
        ["Net Margin",       stmts.netMargin],
      ].forEach(([label, arr], i) => {
        r = dataRow(ws, r,
          [label as string, ...yrs.map(y => findM(arr as { fy: number; value: number }[], y)), ""],
          { bgArgb: i % 2 === 0 ? WHITE : BGALT },
        );
      });
      r++;

      if (valHist.length > 0) {
        r = sectionHeader(ws, r, 3, "HISTORICAL VALUATION MULTIPLES");
        r = tableHeader(ws, r, ["Fiscal Year", "P/E Ratio", "P/S Ratio"]);
        valHist.forEach((v, i) => {
          r = dataRow(ws, r, [String(v.year), f2(v.peRatio), f2(v.psRatio)], { bgArgb: i % 2 === 0 ? WHITE : BGALT });
        });
      }
    } else {
      ws.columns = [{ key: "a", width: 60 }];
      ws.getCell(1, 1).value = "Financial statements unavailable — EDGAR data not accessible for this symbol.";
      ws.getCell(1, 1).font = { name: "Calibri", size: 10, italic: true, color: { argb: MUTED } };
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     SHEET 3 — VALUATION & QUALITY
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Valuation & Quality", { properties: { tabColor: { argb: "FF0EA5E9" } } });
    ws.columns = [{ key: "metric", width: 30 }, { key: "value", width: 20 }, { key: "context", width: 40 }];

    let r = 1;
    r = sectionHeader(ws, r, 3, "VALUATION METRICS");
    r = tableHeader(ws, r, ["Metric", "Value", "Context"]);

    const ev = snap?.ebitda != null && q.marketCap != null
      ? f2((q.marketCap + (snap.totalDebt ?? 0) - (snap.totalCash ?? 0)) / snap.ebitda) : "—";

    const valRows: { label: string; value: string; context: string; color?: string }[] = [
      { label: "Trailing P/E",  value: f2(snap?.trailingPE),  context: "vs 25x S&P 500 avg", color: snap?.trailingPE != null ? (snap.trailingPE < 25 ? POS : snap.trailingPE < 40 ? AMBER : NEG) : undefined },
      { label: "Forward P/E",   value: f2(snap?.forwardPE),   context: "next 12 months estimate" },
      { label: "PEG Ratio",     value: f2(snap?.pegRatio),    context: "<1.0 = potentially undervalued", color: snap?.pegRatio != null ? (snap.pegRatio < 1 ? POS : snap.pegRatio < 2 ? AMBER : NEG) : undefined },
      { label: "Price / Book",  value: f2(snap?.priceToBook), context: "" },
      { label: "EV / EBITDA",   value: ev,                    context: "" },
      { label: "Dividend Yield",value: snap?.dividendYield != null ? `${(snap.dividendYield * 100).toFixed(2)}%` : "—", context: "" },
      { label: "Free Cash Flow",value: fMoney(snap?.freeCashflow, finCur), context: "annual" },
      { label: "Total Cash",    value: fMoney(snap?.totalCash, finCur),  context: "" },
      { label: "Total Debt",    value: fMoney(snap?.totalDebt, finCur),  context: "" },
    ];

    valRows.forEach(({ label, value, context, color }, i) => {
      ws.getRow(r).height = 16;
      const bg = i % 2 === 0 ? WHITE : BGALT;
      [label, value, context].forEach((v, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = v;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.font = { name: "Calibri", size: 10, bold: ci === 0, color: { argb: ci === 1 ? (color ?? "FF111827") : ci === 2 ? MUTED : "FF111827" } };
        cell.alignment = { horizontal: ci === 0 || ci === 2 ? "left" : "right", vertical: "middle" };
        cell.border = thinBorder;
      });
      r++;
    });
    r++;

    r = sectionHeader(ws, r, 3, "QUALITY & FINANCIAL HEALTH");
    r = tableHeader(ws, r, ["Metric", "Value", "Benchmark"]);

    const qualRows: { label: string; value: string; benchmark: string; color?: string }[] = [
      { label: "Return on Equity (ROE)",  value: snap?.returnOnEquity != null ? `${(snap.returnOnEquity * 100).toFixed(2)}%` : "—",  benchmark: ">10% = strong", color: snap?.returnOnEquity != null ? (snap.returnOnEquity > 0.1 ? POS : NEG) : undefined },
      { label: "Return on Assets (ROA)",  value: snap?.returnOnAssets != null ? `${(snap.returnOnAssets * 100).toFixed(2)}%` : "—",  benchmark: ">5% = efficient", color: snap?.returnOnAssets != null ? (snap.returnOnAssets > 0.05 ? POS : NEG) : undefined },
      { label: "Gross Margin",            value: snap?.grossMargins != null ? `${(snap.grossMargins * 100).toFixed(1)}%` : "—",       benchmark: "" },
      { label: "Operating Margin",        value: snap?.operatingMargins != null ? `${(snap.operatingMargins * 100).toFixed(1)}%` : "—", benchmark: "" },
      { label: "Net Profit Margin",       value: snap?.profitMargins != null ? `${(snap.profitMargins * 100).toFixed(1)}%` : "—",     benchmark: "" },
      { label: "EBITDA Margin",           value: snap?.ebitdaMargins != null ? `${(snap.ebitdaMargins * 100).toFixed(1)}%` : "—",     benchmark: "" },
      { label: "Debt / Equity",           value: snap?.debtToEquity != null ? `${f2(snap.debtToEquity)}x` : "—",                     benchmark: "<1.0 = low leverage", color: snap?.debtToEquity != null ? (snap.debtToEquity < 1 ? POS : snap.debtToEquity < 2 ? AMBER : NEG) : undefined },
      { label: "Current Ratio",           value: snap?.currentRatio != null ? `${f2(snap.currentRatio)}x` : "—",                     benchmark: ">1.0 = liquid", color: snap?.currentRatio != null ? (snap.currentRatio >= 1 ? POS : NEG) : undefined },
      { label: "Quick Ratio",             value: snap?.quickRatio != null ? `${f2(snap.quickRatio)}x` : "—",                         benchmark: "" },
      { label: "Revenue Growth (YoY)",    value: snap?.revenueGrowth != null ? fPct(snap.revenueGrowth * 100) : "—",                 benchmark: "", color: snap?.revenueGrowth != null ? (snap.revenueGrowth > 0 ? POS : NEG) : undefined },
      { label: "Earnings Growth (YoY)",   value: snap?.earningsGrowth != null ? fPct(snap.earningsGrowth * 100) : "—",               benchmark: "", color: snap?.earningsGrowth != null ? (snap.earningsGrowth > 0 ? POS : NEG) : undefined },
    ];

    qualRows.forEach(({ label, value, benchmark, color }, i) => {
      ws.getRow(r).height = 16;
      const bg = i % 2 === 0 ? WHITE : BGALT;
      [label, value, benchmark].forEach((v, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = v;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.font = { name: "Calibri", size: 10, bold: ci === 0, color: { argb: ci === 1 ? (color ?? "FF111827") : ci === 2 ? MUTED : "FF111827" } };
        cell.alignment = { horizontal: ci === 0 || ci === 2 ? "left" : "right", vertical: "middle" };
        cell.border = thinBorder;
      });
      r++;
    });
  }

  /* ════════════════════════════════════════════════════════════════════
     SHEET 4 — ANALYST & EARNINGS
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Analyst & Earnings", { properties: { tabColor: { argb: "FF7C3AED" } } });
    ws.columns = [{ key: "a", width: 28 }, { key: "b", width: 20 }, { key: "c", width: 20 }, { key: "d", width: 20 }];

    let r = 1;

    if (analyst) {
      r = sectionHeader(ws, r, 4, "ANALYST CONSENSUS");

      kvBlock(ws, r, [
        { label: "Mean Price Target",   value: formatCurrency(analyst.targetMean, q.currency) },
        { label: "High Price Target",   value: formatCurrency(analyst.targetHigh, q.currency) },
        { label: "Low Price Target",    value: formatCurrency(analyst.targetLow, q.currency) },
        { label: "Upside / Downside",   value: analyst.upsidePercent != null ? fPct(analyst.upsidePercent) : "—", color: analyst.upsidePercent != null ? (analyst.upsidePercent > 0 ? POS : NEG) : MUTED },
        { label: "Analyst Count",       value: String(analyst.numberOfOpinions ?? "—") },
        { label: "Recommendation",      value: (analyst.recommendationKey ?? "—").toUpperCase() },
      ]);
      r += 7;

      const total = analyst.strongBuy + analyst.buy + analyst.hold + analyst.sell + analyst.strongSell;
      r = tableHeader(ws, r, ["Rating", "Count", "% of Total", ""]);
      [
        { label: "Strong Buy", val: analyst.strongBuy, color: POS },
        { label: "Buy",        val: analyst.buy,       color: "FF16A34A" },
        { label: "Hold",       val: analyst.hold,      color: AMBER },
        { label: "Sell",       val: analyst.sell,      color: NEG },
        { label: "Strong Sell",val: analyst.strongSell,color: "FF7F1D1D" },
      ].forEach(({ label, val, color }, i) => {
        r = dataRow(ws, r, [label, val, total > 0 ? `${((val / total) * 100).toFixed(1)}%` : "—", ""], {
          bgArgb: i % 2 === 0 ? WHITE : BGALT,
          colColors: [color, color, undefined, undefined],
        });
      });
      r++;
    }

    if (earnings) {
      r = sectionHeader(ws, r, 4, "EARNINGS HISTORY");
      r = tableHeader(ws, r, ["Quarter", "EPS Actual", "EPS Estimate", "Surprise %"]);
      earnings.history.forEach((e, i) => {
        // surprisePercent is stored as a decimal ratio (0.17 = 17%)
        const surprisePct = e.surprisePercent != null ? e.surprisePercent * 100 : null;
        const color = surprisePct != null ? (surprisePct >= 0 ? POS : NEG) : undefined;
        r = dataRow(ws, r, [
          e.quarter,
          formatPerShare(e.epsActual, q.currency),
          formatPerShare(e.epsEstimate, q.currency),
          surprisePct != null ? fPct(surprisePct) : "—",
        ], { bgArgb: i % 2 === 0 ? WHITE : BGALT, colColors: [undefined, undefined, undefined, color] });
      });
      r++;

      const eps: string[] = [];
      if (earnings.trailingEps != null) eps.push(`Trailing EPS: ${formatPerShare(earnings.trailingEps, q.currency)}`);
      if (earnings.forwardEps != null)  eps.push(`Forward EPS: ${formatPerShare(earnings.forwardEps, q.currency)}`);
      if (earnings.nextDate) eps.push(`Next Earnings: ${earnings.nextDate}`);
      if (eps.length) {
        ws.mergeCells(r, 1, r, 4);
        const cell = ws.getCell(r, 1);
        cell.value = eps.join("    ·    ");
        cell.font = { name: "Calibri", size: 9, italic: true, color: { argb: MUTED } };
      }
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     SHEET 5 — PEER COMPARISON
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Peer Comparison", { properties: { tabColor: { argb: "FF0891B2" } } });
    ws.columns = [{ key: "metric", width: 26 }, { key: "target", width: 18 }, { key: "median", width: 18 }, { key: "vs", width: 30 }];

    let r = 1;

    if (peers && peers.peerCount > 0) {
      r = sectionHeader(ws, r, 4, `PEER COMPARISON — ${peers.sector} (${peers.peerCount} peers)`);
      r = tableHeader(ws, r, ["Metric", symbol, "Sector Median", "vs. Peers"]);

      const peersData: { label: string; tgt: string; med: string; vs: string; color?: string }[] = [
        {
          label: "P/E Ratio", tgt: f2(peers.target.pe), med: f2(peers.median.pe),
          vs: peers.target.pe != null && peers.median.pe != null ? (peers.target.pe < peers.median.pe ? "Below median (cheaper)" : "Above median (pricier)") : "—",
          color: peers.target.pe != null && peers.median.pe != null ? (peers.target.pe < peers.median.pe ? POS : AMBER) : undefined,
        },
        {
          label: "Return on Equity",
          tgt: peers.target.roe != null ? `${(peers.target.roe * 100).toFixed(1)}%` : "—",
          med: peers.median.roe != null ? `${(peers.median.roe * 100).toFixed(1)}%` : "—",
          vs: peers.target.roe != null && peers.median.roe != null ? (peers.target.roe > peers.median.roe ? "Above median" : "Below median") : "—",
          color: peers.target.roe != null && peers.median.roe != null ? (peers.target.roe > peers.median.roe ? POS : NEG) : undefined,
        },
        {
          label: "Revenue Growth",
          tgt: peers.target.revenueGrowth != null ? fPct(peers.target.revenueGrowth * 100) : "—",
          med: peers.median.revenueGrowth != null ? fPct(peers.median.revenueGrowth * 100) : "—",
          vs: "—",
        },
        {
          label: "Debt / Equity", tgt: f2(peers.target.debtToEquity), med: f2(peers.median.debtToEquity),
          vs: peers.target.debtToEquity != null && peers.median.debtToEquity != null ? (peers.target.debtToEquity < peers.median.debtToEquity ? "Lower leverage" : "Higher leverage") : "—",
          color: peers.target.debtToEquity != null && peers.median.debtToEquity != null ? (peers.target.debtToEquity < peers.median.debtToEquity ? POS : AMBER) : undefined,
        },
      ];

      peersData.forEach(({ label, tgt, med, vs, color }, i) => {
        ws.getRow(r).height = 16;
        const bg = i % 2 === 0 ? WHITE : BGALT;
        [label, tgt, med, vs].forEach((v, ci) => {
          const cell = ws.getCell(r, ci + 1);
          cell.value = v;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.font = { name: "Calibri", size: 10, bold: ci === 0, color: { argb: ci === 3 && color ? color : "FF111827" } };
          cell.alignment = { horizontal: ci === 0 || ci === 3 ? "left" : "right", vertical: "middle" };
          cell.border = thinBorder;
        });
        r++;
      });
    } else {
      ws.getCell(1, 1).value = "Peer comparison data unavailable.";
      ws.getCell(1, 1).font = { name: "Calibri", size: 10, italic: true, color: { argb: MUTED } };
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     SHEET 6 — OWNERSHIP & MOMENTUM
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Ownership & Momentum", { properties: { tabColor: { argb: "FF059669" } } });
    ws.columns = [{ key: "a", width: 36 }, { key: "b", width: 20 }, { key: "c", width: 20 }, { key: "d", width: 20 }];

    let r = 1;

    if (ownership) {
      r = sectionHeader(ws, r, 4, "OWNERSHIP & SHORT INTEREST");
      kvBlock(ws, r, [
        { label: "Institutional Ownership", value: ownership.institutionsPctHeld != null ? `${(ownership.institutionsPctHeld * 100).toFixed(1)}%` : "—" },
        { label: "Insider Ownership",       value: ownership.insidersPctHeld != null ? `${(ownership.insidersPctHeld * 100).toFixed(1)}%` : "—" },
        { label: "Short % of Float",        value: ownership.shortPctOfFloat != null ? `${(ownership.shortPctOfFloat * 100).toFixed(1)}%` : "—", color: ownership.shortPctOfFloat != null && ownership.shortPctOfFloat > 0.1 ? NEG : undefined },
        { label: "Short Ratio (days)",      value: ownership.shortRatio != null ? f2(ownership.shortRatio, 1) : "—" },
      ]);
      r += 5;

      if (ownership.topHolders?.length) {
        r = sectionHeader(ws, r, 4, "TOP INSTITUTIONAL HOLDERS");
        r = tableHeader(ws, r, ["Institution", "% Held", "Shares", "Market Value"]);
        ownership.topHolders.slice(0, 15).forEach((h, i) => {
          r = dataRow(ws, r, [
            h.name,
            h.pctHeld != null ? `${(h.pctHeld * 100).toFixed(2)}%` : "—",
            h.shares != null ? h.shares.toLocaleString() : "—",
            fMoney(h.value, q.currency),
          ], { bgArgb: i % 2 === 0 ? WHITE : BGALT });
        });
        r++;
      }
    }

    if (momentum) {
      r = sectionHeader(ws, r, 4, "TECHNICAL MOMENTUM");
      r = tableHeader(ws, r, ["Signal", "Value", "", ""]);
      const mColor = (v: number | null) => v == null ? undefined : (v > 0 ? POS : NEG);
      [
        { label: "Momentum Score",      value: `${momentum.score}/100`, color: momentum.score >= 60 ? POS : momentum.score >= 40 ? AMBER : NEG },
        { label: "Trend Direction",     value: momentum.trend.toUpperCase(), color: momentum.trend === "up" ? POS : momentum.trend === "down" ? NEG : MUTED },
        { label: "vs 50-Day SMA",       value: momentum.vsSma50 != null ? fPct(momentum.vsSma50) : "—", color: mColor(momentum.vsSma50 ?? null) },
        { label: "vs 200-Day SMA",      value: momentum.vsSma200 != null ? fPct(momentum.vsSma200) : "—", color: mColor(momentum.vsSma200 ?? null) },
        { label: "3-Month Return",      value: momentum.return3m != null ? fPct(momentum.return3m) : "—", color: mColor(momentum.return3m ?? null) },
        { label: "% from 52-Wk High",  value: momentum.pctFrom52WkHigh != null ? fPct(momentum.pctFrom52WkHigh) : "—", color: MUTED },
        { label: "% from 52-Wk Low",   value: momentum.pctFrom52WkLow != null ? fPct(momentum.pctFrom52WkLow) : "—", color: MUTED },
      ].forEach(({ label, value, color }, i) => {
        r = dataRow(ws, r, [label, value, "", ""], { bgArgb: i % 2 === 0 ? WHITE : BGALT, colColors: [undefined, color] });
      });
      r++;
    }

    if (insider?.transactions.length) {
      r = sectionHeader(ws, r, 4, "INSIDER ACTIVITY");
      ws.mergeCells(r, 1, r, 4);
      const netCell = ws.getCell(r, 1);
      netCell.value = `${insider.buyCount} buys / ${insider.sellCount} sells  ·  Net value: ${fMoney(insider.netValue, q.currency)}`;
      netCell.font = { name: "Calibri", size: 10, italic: true };
      r++;
      r = tableHeader(ws, r, ["Insider", "Type", "Date", "Shares"]);
      insider.transactions.slice(0, 15).forEach((t, i) => {
        r = dataRow(ws, r, [t.name, t.type.toUpperCase(), t.date, t.shares != null ? t.shares.toLocaleString() : "—"], {
          bgArgb: i % 2 === 0 ? WHITE : BGALT,
          colColors: [undefined, t.type === "buy" ? POS : t.type === "sell" ? NEG : MUTED],
        });
      });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     SHEET 7 — RISKS & FILINGS
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Risks & Filings", { properties: { tabColor: { argb: "FFB91C1C" } } });
    ws.columns = [{ key: "level", width: 14 }, { key: "category", width: 26 }, { key: "reason", width: 70 }];

    let r = 1;

    if (risks.length) {
      r = sectionHeader(ws, r, 3, "RISK ASSESSMENT");
      r = tableHeader(ws, r, ["Level", "Category", "Reason"]);
      risks.forEach((risk, i) => {
        const color = risk.level === "low" ? POS : risk.level === "medium" ? AMBER : NEG;
        ws.getRow(r).height = 16;
        const bg = i % 2 === 0 ? WHITE : BGALT;
        [risk.level.toUpperCase(), risk.category, risk.reason].forEach((v, ci) => {
          const cell = ws.getCell(r, ci + 1);
          cell.value = v;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.font = { name: "Calibri", size: 10, bold: ci < 2, color: { argb: ci === 0 ? color : "FF111827" } };
          cell.alignment = { horizontal: "left", vertical: "middle" };
          cell.border = thinBorder;
        });
        r++;
      });
      r++;
    }

    if (filings.length) {
      r = sectionHeader(ws, r, 3, "RECENT SEC FILINGS");
      r = tableHeader(ws, r, ["Form", "Filed Date", "Description"]);
      filings.slice(0, 20).forEach((f, i) => {
        ws.getRow(r).height = 16;
        const bg = i % 2 === 0 ? WHITE : BGALT;
        [f.form, new Date(f.filedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }), f.description ?? "—"].forEach((v, ci) => {
          const cell = ws.getCell(r, ci + 1);
          cell.value = v;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.font = { name: "Calibri", size: 10, bold: ci === 0, color: { argb: ci === 0 ? BLUE : "FF111827" } };
          cell.alignment = { horizontal: "left", vertical: "middle" };
          cell.border = thinBorder;
        });
        r++;
      });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     SHEET 8 — PRICE HISTORY
  ════════════════════════════════════════════════════════════════════ */
  {
    const ws = wb.addWorksheet("Price History", { properties: { tabColor: { argb: MUTED } } });
    ws.columns = [
      { key: "date",   width: 14 },
      { key: "close",  width: 14 },
      { key: "volume", width: 18 },
    ];

    const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const recent = [...hist].filter(p => p.date >= oneYearAgo).reverse();

    sectionHeader(ws, 1, 3, `${symbol} — 1-YEAR DAILY PRICE HISTORY (${recent.length} trading days)`);
    tableHeader(ws, 2, ["Date", "Close", "Volume"]);

    recent.forEach((p, i) => {
      const rn = i + 3;
      ws.getRow(rn).height = 14;
      const bg = i % 2 === 0 ? WHITE : BGALT;
      [
        p.date,
        formatCurrency(p.close, q.currency),
        p.volume != null ? p.volume.toLocaleString() : "—",
      ].forEach((v, ci) => {
        const cell = ws.getCell(rn, ci + 1);
        cell.value = v;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.font = { name: "Calibri", size: 9, color: { argb: "FF111827" } };
        cell.alignment = { horizontal: ci === 0 ? "left" : "right", vertical: "middle" };
        cell.border = thinBorder;
      });
    });

    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2, topLeftCell: "A3" }];
  }

  /* ─── generate buffer ─────────────────────────────────────────────── */
  const raw = await wb.xlsx.writeBuffer();
  const buffer = raw instanceof Buffer ? raw : Buffer.from(raw);

  const filename = `${symbol}_Research_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
