/**
 * POST /api/portfolio/simulator/generate — run the generation pipeline for a
 * saved simulation, streaming staged progress as NDJSON:
 *
 *   { type: "progress", stage, message, pct }
 *   { type: "result",   simulation, evaluation, fallbacks }
 *   { type: "error",    message, code? }
 *
 * The simulation is persisted (holdings + thesis + headline + status) only on
 * a fully successful run — a failed generation leaves the previous state
 * untouched rather than half-replacing it.
 */
import { getSimulation, updateSimulation } from "@/lib/db";
import { AllModelsFailedError } from "@/lib/ai/router";
import { generatePortfolio } from "@/lib/portfolio/simulator/generate";
import { headlineFrom } from "@/lib/portfolio/simulator/evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const sim = typeof body.id === "string" ? getSimulation(body.id) : null;
  if (!sim) return Response.json({ error: "Simulation not found" }, { status: 404 });
  if (!sim.profile.intakeComplete) {
    return Response.json({ error: "Finish the intake interview before generating" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const result = await generatePortfolio(sim.profile, {
          signal: request.signal,
          onProgress: (p) => send({ type: "progress", ...p }),
        });

        const updated = updateSimulation(sim.id, {
          holdings: result.holdings,
          thesis: result.thesis,
          headline: headlineFrom(result.evaluation),
          status: "complete",
        });
        send({
          type: "result",
          simulation: updated,
          evaluation: result.evaluation,
          fallbacks: result.fallbacks,
          excluded: result.excluded,
        });
      } catch (err) {
        if (!request.signal.aborted) {
          const offline = err instanceof AllModelsFailedError;
          send({
            type: "error",
            message: offline
              ? "Ollama unavailable — start Ollama to generate this portfolio"
              : err instanceof Error
                ? err.message
                : "Generation failed",
            ...(offline ? { code: "ollama_unavailable" } : {}),
          });
          console.error("[portfolio/simulator/generate]", err);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
