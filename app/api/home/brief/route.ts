/**
 * GET /api/home/brief — the homepage's AI narrative, streamed.
 *
 * One model call feeds Today's Brief (Module 1), the AI Investment Brief
 * (Module 2), and Portfolio Pulse's summary line (Module 4). See lib/home/brief.ts
 * for why it is one call and not three.
 *
 * Streamed as newline-delimited JSON chunks so the short headline can paint the
 * moment it is ready rather than waiting on the long note. The stream always
 * terminates with a `done` (or `error`) chunk — a client that sees neither can
 * treat the connection as dropped and keep the deterministic fallback it
 * already has from /api/home.
 */
import { getMissionContext } from "@/lib/mission-control";
import { unreadNotificationCount } from "@/lib/db";
import { getPortfolioReport } from "@/lib/portfolio/report";
import { generateHomeBrief, toBriefPortfolio } from "@/lib/home/brief";
import type { HomeBriefChunk } from "@/lib/home/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: HomeBriefChunk) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };

      try {
        // The portfolio facts come from the *universal* report — the same one
        // the Book strip renders — so the narrative and the numbers beside it
        // can never quote two different alignment scores. Both reads go through
        // the platform cache (audit PF-02): serving a cached brief no longer
        // costs an 8-second engine rebuild (audit PF-03's real fix).
        const [ctx, report] = await Promise.all([
          getMissionContext(),
          getPortfolioReport().catch(() => null),
        ]);
        const unread = unreadNotificationCount();

        // generateHomeBrief never throws — it degrades to the deterministic
        // briefing. So the sections below are always real text.
        const brief = await generateHomeBrief(ctx, toBriefPortfolio(report), unread);

        send({ type: "headline", text: brief.headline });
        send({ type: "portfolioSummary", text: brief.portfolioSummary });
        if (brief.note) send({ type: "note", note: brief.note });
        send({ type: "done", aiGenerated: brief.aiGenerated, generatedAt: brief.generatedAt });
      } catch (err) {
        console.error("[api/home/brief]", err);
        send({ type: "error", message: "Brief unavailable" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
