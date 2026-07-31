import ExcelJS from "exceljs";
import { isRenderableReport } from "@/lib/thematic-theme";
import type { ThematicReport } from "@/lib/thematic-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thematic report export — XLSX of the companies table plus the score summary
 * and the eligible universe, following the other /api/export/* routes.
 *
 * Takes the report in the POST body (the client already holds the exact
 * report on screen; re-deriving it server-side could export a different run
 * than the one the analyst is looking at).
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0F172A" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

function styleHeader(ws: ExcelJS.Worksheet): void {
  const header = ws.getRow(1);
  header.font = HEADER_FONT;
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };
}

/** POST /api/export/thematic — body: { report: ThematicReport } */
export async function POST(req: Request): Promise<Response> {
  let report: ThematicReport;
  try {
    const body = (await req.json()) as { report?: unknown };
    if (!isRenderableReport(body.report)) {
      return new Response("Body must carry a current-shape thematic report", { status: 400 });
    }
    report = body.report;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Universal Asset Analyzer";
  wb.created = new Date();

  /* ── Sheet 1: companies ── */
  const ws = wb.addWorksheet("Companies", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  ws.columns = [
    { header: "Tier", key: "tier", width: 6 },
    { header: "Tier Label", key: "tierLabel", width: 20 },
    { header: "Symbol", key: "symbol", width: 10 },
    { header: "Name", key: "name", width: 30 },
    { header: "Sector", key: "sector", width: 18 },
    { header: "Industry", key: "industry", width: 24 },
    { header: "Role", key: "role", width: 10 },
    { header: "Moat", key: "moat", width: 12 },
    { header: "Quality (0-100)", key: "quality", width: 14 },
    { header: "ROIC (%)", key: "roic", width: 10 },
    { header: "Gross Margin (%)", key: "margin", width: 15 },
    { header: "Rev Growth YoY (%)", key: "revGrowth", width: 17 },
    { header: "Fwd P/E", key: "forwardPE", width: 10 },
    { header: "EV/EBITDA", key: "evToEbitda", width: 11 },
    { header: "vs 52W High (%)", key: "vsHigh", width: 15 },
    { header: "D/E", key: "debtToEquity", width: 8 },
    { header: "Why It Belongs Here", key: "rationale", width: 50 },
  ];
  styleHeader(ws);

  const sorted = [...report.tierCompanies].sort((a, b) => a.tier - b.tier || a.symbol.localeCompare(b.symbol));
  for (const c of sorted) {
    const row = ws.addRow({
      tier: c.tier,
      tierLabel: c.tierLabel,
      symbol: c.symbol,
      name: c.name,
      sector: c.sector ?? "",
      industry: c.industry ?? "",
      role: c.strategicImportance,
      moat: c.moatType,
      quality: c.qualityScore,
      roic: c.roic,
      margin: c.grossMargin,
      revGrowth: c.revenueGrowthYoY,
      forwardPE: c.forwardPE,
      evToEbitda: c.evToEbitda,
      vsHigh: c.distanceFrom52WkHigh,
      debtToEquity: c.debtToEquity,
      rationale: c.relevanceRationale,
    });
    for (const key of ["roic", "margin", "revGrowth", "forwardPE", "evToEbitda", "vsHigh", "debtToEquity"]) {
      row.getCell(key).numFmt = "0.0";
    }
    row.getCell("quality").numFmt = "0";
  }

  /* ── Sheet 2: score summary ── */
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Value", key: "value", width: 90 },
  ];
  styleHeader(summary);
  summary.addRow({ field: "Theme", value: report.theme });
  summary.addRow({ field: "Generated", value: report.generatedAt });
  summary.addRow({ field: "Model", value: report.model });
  summary.addRow({ field: "Opportunity score", value: `${report.opportunity.themeScore}/100 (${report.opportunity.verdict.toUpperCase()})` });
  summary.addRow({ field: "Verdict rationale", value: report.opportunity.verdictRationale });
  if (report.opportunity.verdictCaveat) summary.addRow({ field: "Verdict caveat", value: report.opportunity.verdictCaveat });
  summary.addRow({
    field: "Evidence",
    value: `${report.integrity.stagesEvidenced}/${report.integrity.stagesTotal} AI stages evidenced · ${report.integrity.evidenceScore}% of the score weight`,
  });
  for (const f of report.opportunity.factors) {
    summary.addRow({
      field: `Factor: ${f.label}`,
      value: `${Math.round(f.score)}/100 · weight ${Math.round(f.weight * 100)}%${f.evidenced ? "" : " · UNEVIDENCED (neutral default)"}`,
    });
  }
  for (const c of report.integrity.caveats) summary.addRow({ field: "Caveat", value: c });
  for (const fl of report.opportunity.riskFlags) {
    summary.addRow({ field: `Risk (${fl.severity})`, value: `${fl.label} — ${fl.detail}` });
  }

  /* ── Sheet 3: the eligible universe (the audit trail behind the picks) ── */
  const universe = wb.addWorksheet("Universe");
  universe.columns = [
    { header: "Symbol", key: "symbol", width: 10 },
    { header: "Name", key: "name", width: 30 },
    { header: "Industry", key: "industry", width: 26 },
    { header: "Matched On", key: "matched", width: 36 },
    { header: "Relevance", key: "score", width: 10 },
    { header: "Outcome", key: "status", width: 14 },
  ];
  styleHeader(universe);
  const STATUS_LABEL = { prompt: "shown to model", shortlist: "shortlisted", cut: "cut by cap" } as const;
  for (const c of report.universePreview.candidates) {
    universe.addRow({
      symbol: c.symbol,
      name: c.name,
      industry: c.industry ?? "",
      matched: c.matched.join(", "),
      score: c.score,
      status: STATUS_LABEL[c.status] ?? c.status,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  const slug = report.theme.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "theme";
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="thematic-${slug}-${date}.xlsx"`,
    },
  });
}
