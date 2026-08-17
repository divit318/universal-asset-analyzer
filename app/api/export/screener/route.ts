import ExcelJS from "exceljs";
import { guardedExport } from "@/lib/download";
import { getAssetClass, getMetric, isAssetClassId, unavailableMetrics } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import type { RankedCandidate } from "@/lib/screener/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Screener export.
 *
 * Previously this hardcoded a 20-column equity sheet. It's now driven by the
 * Asset Registry's `columns` for whichever class was screened, so a bond export
 * ships duration and credit rating while a crypto export ships FDV and 90-day
 * return — same code, no branching.
 *
 * The "Data Coverage" sheet is the part worth keeping honest: a spreadsheet
 * outlives the UI that produced it, so the metrics this asset class *couldn't*
 * fill in travel with the data rather than being silently absent from it.
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0F172A" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

function scoreFill(v: number | null): string {
  if (v == null) return "FFFFFFFF";
  if (v >= 70) return "FFD1FAE5";
  if (v >= 45) return "FFFEF9C3";
  return "FFFEE2E2";
}

function scoreFont(v: number | null): string {
  if (v == null) return "FF6B7280";
  if (v >= 70) return "FF065F46";
  if (v >= 45) return "FF92400E";
  return "FF991B1B";
}

/** Excel number formats, from the registry's declared unit. */
function numberFormat(unit: string): string {
  switch (unit) {
    case "%":
      return "0.0";
    case "x":
      return "0.00";
    case "$":
      return "#,##0.00";
    case "$B":
      return "#,##0,,";
    case "yrs":
      return "0.0";
    case "score":
      return "0";
    default:
      return "#,##0";
  }
}

/** POST /api/export/screener — body: { assetClass, rows: RankedCandidate[] } */
export function POST(req: Request): Promise<Response> {
  return guardedExport("api/export/screener", () => buildScreenerExport(req));
}

async function buildScreenerExport(req: Request): Promise<Response> {
  let assetClass: AssetClassId;
  let rows: RankedCandidate[];

  try {
    const body = (await req.json()) as { assetClass?: unknown; rows?: RankedCandidate[] };
    if (!isAssetClassId(body.assetClass)) {
      return new Response("Unknown asset class", { status: 400 });
    }
    assetClass = body.assetClass;
    rows = Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const def = getAssetClass(assetClass);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  /* ── Sheet 1: results ── */
  const ws = wb.addWorksheet(`${def.label} Screen`, {
    views: [{ state: "frozen", xSplit: 3, ySplit: 1 }],
  });

  const columns = [
    { key: "rank", label: "#", width: 5 },
    { key: "symbol", label: "Symbol", width: 12 },
    { key: "name", label: "Name", width: 30 },
    ...def.columns
      .filter((c) => c.key !== "rankScore")
      .map((c) => ({ key: c.key, label: c.label, width: 14 })),
    { key: "rankScore", label: "Rank Score", width: 12 },
    { key: "confidence", label: "Confidence", width: 12 },
    { key: "warnings", label: "Warnings", width: 44 },
  ];

  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.font = HEADER_FONT;
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };

  rows.forEach((row) => {
    const record: Record<string, string | number | null> = {
      rank: row.rank,
      symbol: row.symbol,
      name: row.name,
      rankScore: row.rankScore,
      confidence: row.confidence,
      warnings: row.match.warnings.join("; "),
    };

    for (const col of def.columns) {
      if (col.key === "rankScore") continue;
      const metric = getMetric(assetClass, col.key);
      record[col.key] = metric?.options
        ? (row.attributes[col.key] ?? null)
        : (row.metrics[col.key] ?? null);
    }

    const added = ws.addRow(record);

    // Number formats per column, and the score-tinted rank cell the old export had.
    for (const col of def.columns) {
      if (col.key === "rankScore") continue;
      const metric = getMetric(assetClass, col.key);
      if (metric && !metric.options) {
        added.getCell(col.key).numFmt = numberFormat(metric.unit);
      }
    }

    const scoreCell = added.getCell("rankScore");
    scoreCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: scoreFill(row.rankScore) },
    };
    scoreCell.font = { color: { argb: scoreFont(row.rankScore) }, bold: true };
  });

  /* ── Sheet 2: data coverage ── */
  const coverage = wb.addWorksheet("Data Coverage");
  coverage.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Availability", key: "availability", width: 14 },
    { header: "Source", key: "source", width: 12 },
    { header: "Notes", key: "notes", width: 90 },
  ];
  const coverageHeader = coverage.getRow(1);
  coverageHeader.font = HEADER_FONT;
  coverageHeader.fill = HEADER_FILL;

  for (const m of def.metrics) {
    coverage.addRow({
      metric: m.label,
      availability: m.availability,
      source: m.source ?? "—",
      notes: m.formula ?? m.requires ?? (m.asOf ? `Static reference table, as of ${m.asOf}` : ""),
    });
  }

  const gaps = unavailableMetrics(assetClass).length;
  coverage.addRow({});
  coverage.addRow({
    metric: "SUMMARY",
    availability: `${gaps} gap${gaps === 1 ? "" : "s"}`,
    source: "",
    notes:
      gaps === 0
        ? "Every declared metric for this asset class has a data source."
        : "The metrics marked 'unavailable' above have no wired data provider and were NOT used in filtering or ranking. Do not read their absence as a zero.",
  });

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="uaa-${assetClass}-screen-${stamp}.xlsx"`,
    },
  });
}
