/**
 * Cross-theme overlap — POST /api/thematic/overlap
 *
 * Body: { report: ThematicReport, others: string[] }.
 * The client sends the report on screen (the exact run being compared) plus
 * the themes it knows have saved reports (its Recent list). Each other theme
 * is read from the platform cache under the same versioned key the main
 * route writes — no inference, no network, no new storage. Themes without a
 * saved current-shape report are simply skipped.
 */

import { readCache, cacheKey } from "@/lib/platform/cache";
import { computeOverlaps, type ThemeOverlap } from "@/lib/thematic-overlap";
import type { ThematicReport } from "@/lib/thematic-engine";
import { isRenderableReport, themeCacheKey, normalizeTheme, REPORT_SCHEMA_VERSION } from "@/lib/thematic-theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent list is 8; a bounded loop keeps a hostile body from scanning the cache. */
const MAX_OTHERS = 16;

export async function POST(req: Request): Promise<Response> {
  let report: ThematicReport;
  let others: string[];
  try {
    const body = (await req.json()) as { report?: unknown; others?: unknown };
    if (!isRenderableReport(body.report)) {
      return Response.json({ error: "report must be a current-shape thematic report" }, { status: 400 });
    }
    report = body.report;
    others = Array.isArray(body.others)
      ? body.others.filter((t): t is string => typeof t === "string").slice(0, MAX_OTHERS)
      : [];
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const reports: ThematicReport[] = [];
  const seen = new Set<string>();
  for (const raw of others) {
    const theme = normalizeTheme(raw);
    const keyId = themeCacheKey(theme);
    if (!theme || seen.has(keyId) || keyId === themeCacheKey(report.theme)) continue;
    seen.add(keyId);
    const hit = readCache<ThematicReport>(cacheKey("thematicReport", { theme: keyId, v: REPORT_SCHEMA_VERSION }));
    if (hit && isRenderableReport(hit.value)) reports.push(hit.value);
  }

  const overlaps: ThemeOverlap[] = computeOverlaps(report, reports);
  return Response.json({ overlaps, compared: reports.length });
}
