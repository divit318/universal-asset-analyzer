/**
 * POST /api/portfolio/simulator/intake — one turn of the Step B interview.
 *
 * Stateless by design: the client sends the full profile (Step A answers +
 * follow-up history) and gets back either the next question or done. All
 * persistence goes through the sibling CRUD route — this endpoint owns
 * exactly one thing, asking the AI what to ask next, so a crashed turn can
 * never leave a half-written profile behind.
 */
import { NextResponse } from "next/server";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";
import { runPromptWithMeta } from "@/lib/ai";
import { AllModelsFailedError } from "@/lib/ai/router";
import {
  parseSimFollowUps,
  parseSimProfile,
  type SimProfileInput,
} from "@/lib/portfolio/simulator/profile";
import {
  INTAKE_TIMEOUT_MS,
  buildIntakePrompt,
  intakeAtCap,
  nextGap,
  parseIntakeResponse,
} from "@/lib/portfolio/simulator/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { profile?: SimProfileInput & { followUps?: unknown } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = parseSimProfile(body.profile ?? {});
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const followUps = parseSimFollowUps(body.profile?.followUps);
  if ("error" in followUps) return NextResponse.json({ error: followUps.error }, { status: 400 });
  const profile = { ...parsed.profile, followUps: followUps.followUps };

  // Guard, not policy: the AI is told to aim for 0-2 questions; this stops a
  // model that never says done from trapping the user in an endless interview.
  if (intakeAtCap(profile)) {
    return NextResponse.json({ step: { done: true }, reason: "cap" });
  }

  // Deterministic contradictions first, and they never touch the model. A
  // profile whose objective says "preserve capital" while its risk slider says
  // 9/10 has a known conflict with two known ways out — spending 25-195 seconds
  // of local inference to discover that is pure waste, and the model's phrasing
  // of it would be worse than ours.
  const gap = nextGap(profile);
  if (gap) return NextResponse.json({ step: gap, reason: "gap" });

  try {
    // request.signal: when the client aborts (navigated away, or dev
    // StrictMode's throwaway first mount), cancel the model generation too —
    // an orphaned intake turn is pure spend nobody reads.
    //
    // timeoutMs: an unbounded turn was measured at 195 seconds behind an
    // unlabelled spinner. Finishing on the stated defaults beats waiting
    // indefinitely for one more question.
    const { text: raw } = await runPromptWithMeta("portfolio-construction", buildIntakePrompt(profile), {
      json: true,
      timeoutMs: INTAKE_TIMEOUT_MS,
      signal: request.signal,
    });
    const step = parseIntakeResponse(raw, profile);
    return NextResponse.json({ step });
  } catch (err) {
    if (request.signal.aborted) {
      // The client is gone; nobody reads this response.
      return new Response(null, { status: 499 });
    }
    if (err instanceof AllModelsFailedError) {
      return NextResponse.json(
        {
          error: `AI unavailable — finish with stated defaults, or: ${AI_RECOVERY_HINT}`,
          code: "ai_unavailable",
        },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : "Intake turn failed";
    console.error("[portfolio/simulator/intake]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
