/**
 * /api/portfolio/simulator — saved-simulation CRUD.
 *
 * GET            → list all simulations (newest-updated first)
 * POST           → create a draft from a Step A profile, or duplicate
 *                  an existing one ({ duplicateOf: id })
 * PATCH  ?id=    → partial update (rename, profile, holdings, status…)
 * DELETE ?id=    → delete
 *
 * Intake chat, generation and evaluation live in sibling routes; this one is
 * pure persistence.
 */
import { NextResponse } from "next/server";
import {
  createSimulation,
  deleteSimulation,
  duplicateSimulation,
  getSimulation,
  listSimulations,
  updateSimulation,
  type SimulationPatch,
} from "@/lib/db";
import {
  parseSimFollowUps,
  parseSimHoldings,
  parseSimProfile,
  type SimProfileInput,
} from "@/lib/portfolio/simulator/profile";
import type { SimulationStatus } from "@/lib/portfolio/simulator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: SimulationStatus[] = ["draft", "complete", "promoted"];

/** A body that isn't JSON is the caller's mistake (400), not a server fault (500). */
async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    return NextResponse.json({ simulations: listSimulations() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list simulations";
    console.error("[portfolio/simulator]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      duplicateOf?: string;
      name?: string;
      profile?: SimProfileInput;
    }>(request);
    if (!body) return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });

    if (body.duplicateOf) {
      const copy = duplicateSimulation(body.duplicateOf);
      if (!copy) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
      return NextResponse.json({ simulation: copy });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) {
      return NextResponse.json({ error: "Name is required (max 80 characters)" }, { status: 400 });
    }
    const parsed = parseSimProfile(body.profile ?? {});
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    return NextResponse.json({ simulation: createSimulation(name, parsed.profile) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create simulation";
    console.error("[portfolio/simulator]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    if (!getSimulation(id)) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

    const body = await readJson<{
      name?: string;
      status?: string;
      profile?: SimProfileInput & { followUps?: unknown; intakeComplete?: unknown };
      holdings?: unknown;
    }>(request);
    if (!body) return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    const patch: SimulationPatch = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 80) {
        return NextResponse.json({ error: "Name is required (max 80 characters)" }, { status: 400 });
      }
      patch.name = name;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as SimulationStatus)) {
        return NextResponse.json({ error: "Unknown status" }, { status: 400 });
      }
      patch.status = body.status as SimulationStatus;
    }
    if (body.profile !== undefined) {
      const parsed = parseSimProfile(body.profile);
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      // Follow-up history and completion flag survive a quick-form re-edit.
      const parsedFollowUps = parseSimFollowUps(body.profile.followUps);
      if ("error" in parsedFollowUps) {
        return NextResponse.json({ error: parsedFollowUps.error }, { status: 400 });
      }
      parsed.profile.followUps = parsedFollowUps.followUps;
      parsed.profile.intakeComplete = body.profile.intakeComplete === true;
      patch.profile = parsed.profile;
    }
    if (body.holdings !== undefined) {
      const parsedHoldings = parseSimHoldings(body.holdings);
      if ("error" in parsedHoldings) {
        return NextResponse.json({ error: parsedHoldings.error }, { status: 400 });
      }
      patch.holdings = parsedHoldings.holdings;
    }

    const updated = updateSimulation(id, patch);
    return NextResponse.json({ simulation: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update simulation";
    console.error("[portfolio/simulator]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const ok = deleteSimulation(id);
    if (!ok) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete simulation";
    console.error("[portfolio/simulator]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
