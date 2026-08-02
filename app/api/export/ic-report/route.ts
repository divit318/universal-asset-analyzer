/**
 * POST /api/export/ic-report — export a schemaVersion-2 ICReport.
 *
 * Body: { report: ICReport, format?: "pdf" | "md" | "json" } (default pdf).
 * The filename date is derived from report.generatedAt in UTC — the same
 * derivation the PDF cover and running header use — so the filename and the
 * document can never disagree across timezones.
 */

import type { ICReport } from "@/lib/ic-report";
import { reportToMarkdown, reportUtcDate } from "@/lib/ic/export-markdown";
import { reportToPdf } from "@/lib/ic/export-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportFormat = "pdf" | "md" | "json";

export async function POST(req: Request): Promise<Response> {
  let report: ICReport;
  let format: ExportFormat;
  try {
    const body = (await req.json()) as { report?: ICReport; format?: string };
    if (!body.report || typeof body.report !== "object") throw new Error("missing report");
    const fmt = body.format ?? "pdf";
    if (fmt !== "pdf" && fmt !== "md" && fmt !== "json") {
      return Response.json({ error: `Unsupported format: ${fmt}` }, { status: 400 });
    }
    format = fmt;
    report = body.report;
  } catch {
    return Response.json({ error: "Invalid JSON or missing report" }, { status: 400 });
  }

  if (report.schemaVersion !== 2) {
    return Response.json(
      { error: "Unsupported report schema: this endpoint requires schemaVersion 2. Regenerate the report." },
      { status: 400 },
    );
  }

  const symbol = String(report.symbol ?? "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "") || "REPORT";
  const date = reportUtcDate(report.generatedAt);
  const filename = (ext: string): string => `ic-report-${symbol}-${date}.${ext}`;

  try {
    if (format === "json") {
      return Response.json(report, {
        headers: { "Content-Disposition": `attachment; filename="${filename("json")}"` },
      });
    }
    if (format === "md") {
      return new Response(reportToMarkdown(report), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename("md")}"`,
        },
      });
    }
    const pdf = await reportToPdf(report);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename("pdf")}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
