"use client";

import { useCallback, useState } from "react";
import { Card, Button, Badge } from "@/app/_components/ui";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { useToast } from "@/app/_components/toast";
import type { Simulation, SimProfile } from "@/lib/portfolio/simulator/types";
import type { SimEvaluation } from "@/lib/portfolio/simulator/evaluate";
import { IntakeForm, type IntakeFormValues } from "./intake-form";
import { IntakeChat } from "./intake-chat";
import { ProfileSummary } from "./profile-summary";
import { SimulationList } from "./simulation-list";
import { GenerateFlow } from "./generate-flow";
import { SimView } from "./sim-view";
import { ComparePanel } from "./compare-panel";
import { PromoteDialog } from "./promote-dialog";

type View =
  | { kind: "list" }
  | { kind: "new" }
  /** A simulation's home: intake chat until the profile completes, then the profile summary. */
  | { kind: "open"; sim: Simulation }
  /** Re-editing the Step A quick form for an existing simulation. */
  | { kind: "editForm"; sim: Simulation }
  /** Side-by-side: this simulation vs the real portfolio or another sim. */
  | { kind: "compare"; sim: Simulation };

const STATUS_BADGE = { draft: "neutral", complete: "positive", promoted: "brand" } as const;

/**
 * The Simulator tab — AI-generated hypothetical portfolios.
 *
 * Landing state is the saved-simulation list; "New Simulation" opens the
 * Step A quick form, and a created draft flows straight into the Step B
 * AI interview. A completed profile shows as a summary, ready for generation.
 */
export function SimulatorPanel({ realPortfolioHasHoldings }: { realPortfolioHasHoldings: boolean }) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Evaluation handed over by a just-finished generation, so the view doesn't
  // immediately re-price a book it already has fresh numbers for.
  const [genSeed, setGenSeed] = useState<SimEvaluation | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const toast = useToast();

  function openSim(sim: Simulation, seed: SimEvaluation | null = null) {
    setGenSeed(seed);
    setRegenerating(false);
    setShowProfile(false);
    setPromoting(false);
    setView({ kind: "open", sim });
  }

  const fetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/portfolio/simulator", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load simulations");
    return json.simulations as Simulation[];
  }, []);
  const { data: simulations, error, isInitialLoading, refresh } = useDataset<Simulation[]>(
    "simulations",
    "all",
    fetcher,
  );

  function backToList() {
    refresh();
    setView({ kind: "list" });
  }

  async function handleCreate(name: string, values: IntakeFormValues) {
    setSaving(true);
    try {
      const res = await fetch("/api/portfolio/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, profile: values }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create simulation");
      refresh();
      // Straight into the interview — the draft exists, no reason to detour
      // through the list first.
      openSim(json.simulation as Simulation);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create simulation", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateForm(sim: Simulation, name: string, values: IntakeFormValues) {
    setSaving(true);
    try {
      const res = await fetch(`/api/portfolio/simulator?id=${encodeURIComponent(sim.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          // `values` already carries `preferences`, so re-editing the form is the
          // supported way to change a preference answer after the fact.
          profile: { ...values, followUps: sim.profile.followUps, intakeComplete: sim.profile.intakeComplete },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update simulation");
      refresh();
      openSim(json.simulation as Simulation);
      toast("Profile updated.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to update simulation", "error");
    } finally {
      setSaving(false);
    }
  }

  async function patchIntakeComplete(sim: Simulation, intakeComplete: boolean) {
    setSaving(true);
    try {
      const profile: SimProfile = { ...sim.profile, intakeComplete };
      const res = await fetch(`/api/portfolio/simulator?id=${encodeURIComponent(sim.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update simulation");
      refresh();
      openSim(json.simulation as Simulation);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to update simulation", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(sim: Simulation) {
    setBusyId(sim.id);
    try {
      const res = await fetch("/api/portfolio/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateOf: sim.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to duplicate simulation");
      refresh();
      toast(`Duplicated as "${(json.simulation as Simulation).name}".`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to duplicate simulation", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(sim: Simulation) {
    setBusyId(sim.id);
    try {
      const res = await fetch(`/api/portfolio/simulator?id=${encodeURIComponent(sim.id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete simulation");
      refresh();
      toast(`"${sim.name}" deleted.`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete simulation", "error");
    } finally {
      setBusyId(null);
    }
  }

  /* ── New / edit quick form ─────────────────────────────────────────────── */
  if (view.kind === "new" || view.kind === "editForm") {
    const editing = view.kind === "editForm" ? view.sim : null;
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => (editing ? openSim(editing) : backToList())}
          className="self-start text-xs text-brand hover:underline"
        >
          ← {editing ? `Back to ${editing.name}` : "Back to simulations"}
        </button>
        <IntakeForm
          initialName={editing?.name ?? ""}
          initialProfile={editing?.profile ?? null}
          simulations={simulations ?? []}
          excludeId={editing?.id ?? null}
          realPortfolioHasHoldings={realPortfolioHasHoldings}
          saving={saving}
          submitLabel={editing ? "Save profile" : "Create simulation"}
          onSubmit={(name, values) =>
            editing ? handleUpdateForm(editing, name, values) : handleCreate(name, values)
          }
          onCancel={() => (editing ? openSim(editing) : backToList())}
        />
      </div>
    );
  }

  /* ── Comparison ────────────────────────────────────────────────────────── */
  if (view.kind === "compare") {
    const sim = view.sim;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={() => openSim(sim)} className="shrink-0 text-xs text-brand hover:underline">
            ← {sim.name}
          </button>
          <h3 className="text-sm font-semibold text-foreground">Comparison</h3>
        </div>
        <ComparePanel
          sim={sim}
          simulations={simulations ?? []}
          realPortfolioHasHoldings={realPortfolioHasHoldings}
        />
      </div>
    );
  }

  /* ── One simulation: interview → profile summary ───────────────────────── */
  if (view.kind === "open") {
    const sim = view.sim;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={backToList} className="shrink-0 text-xs text-brand hover:underline">
              ← Simulations
            </button>
            <h3 className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">{sim.name}</h3>
            <Badge variant={STATUS_BADGE[sim.status]}>
              {sim.status === "draft" ? "Draft" : sim.status === "complete" ? "Ready" : "Promoted"}
            </Badge>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {sim.profile.intakeComplete && sim.holdings.length > 0 && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setPromoting(true)}>
                  {sim.status === "promoted" ? "Promote again…" : "Promote to real portfolio…"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setView({ kind: "compare", sim })}>
                  Compare
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowProfile((v) => !v)}>
                  {showProfile ? "Hide profile" : "Profile"}
                </Button>
              </>
            )}
            {!sim.profile.intakeComplete && (
              <Button variant="ghost" size="sm" onClick={() => setView({ kind: "editForm", sim })}>
                Edit quick form
              </Button>
            )}
          </div>
        </div>

        {!sim.profile.intakeComplete ? (
          <IntakeChat
            sim={sim}
            onSimChanged={(updated) => setView({ kind: "open", sim: updated })}
            onCompleted={(updated) => {
              refresh();
              setView({ kind: "open", sim: updated });
              toast("Profile complete — ready to generate.", "success");
            }}
          />
        ) : sim.holdings.length === 0 || regenerating ? (
          <>
            {sim.holdings.length === 0 && (
              <ProfileSummary
                sim={sim}
                busy={saving}
                onEditForm={() => setView({ kind: "editForm", sim })}
                onReopenIntake={() => void patchIntakeComplete(sim, false)}
              />
            )}
            <GenerateFlow
              sim={sim}
              regenerate={sim.holdings.length > 0}
              onCancel={sim.holdings.length > 0 ? () => setRegenerating(false) : undefined}
              onGenerated={(updated, evaluation, fallbacks, excluded) => {
                refresh();
                openSim(updated, evaluation);
                // A dropped pick is reported, not swallowed: a thinner book has to
                // read as the client's own exclusion being honoured rather than as
                // the generator losing positions.
                const notes = [
                  fallbacks.length > 0 ? `deterministic fallback used for: ${fallbacks.join(", ")}` : null,
                  excluded.length > 0 ? `${excluded.join(", ")} dropped by your exclusions` : null,
                ].filter((n): n is string => n !== null);
                toast(
                  notes.length > 0 ? `Portfolio generated — ${notes.join("; ")}.` : "Portfolio generated.",
                  notes.length > 0 ? "info" : "success",
                );
              }}
            />
          </>
        ) : (
          <>
            {showProfile && (
              <ProfileSummary
                sim={sim}
                busy={saving}
                onEditForm={() => setView({ kind: "editForm", sim })}
                onReopenIntake={() => void patchIntakeComplete(sim, false)}
              />
            )}
            <SimView
              sim={sim}
              seed={genSeed}
              onRegenerate={() => setRegenerating(true)}
              onSimChanged={(updated) => setView({ kind: "open", sim: updated })}
            />
          </>
        )}

        {promoting && (
          <PromoteDialog
            sim={sim}
            onClose={() => setPromoting(false)}
            onPromoted={(updated, portfolioName) => {
              setPromoting(false);
              refresh();
              setView({ kind: "open", sim: updated });
              toast(`Promoted into "${portfolioName}" — switch portfolios on this page to see it live.`, "success");
            }}
          />
        )}
      </div>
    );
  }

  /* ── List ──────────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">Hypothetical portfolios</h3>
          <p className="text-[11px] leading-relaxed text-muted">
            Describe a mandate, let the AI build a fully-specified portfolio with real tickers and
            live prices, then stress-test, tweak and compare it — without touching your real book.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setView({ kind: "new" })}>
          New Simulation
        </Button>
      </div>

      {error && (
        <Card className="flex items-center justify-between gap-3 border-negative/25 bg-negative/5 p-4">
          <p className="text-xs text-negative">{error}</p>
          <button onClick={refresh} className="text-xs text-brand hover:underline">
            Retry
          </button>
        </Card>
      )}

      {isInitialLoading && <p className="text-xs text-muted">Loading simulations…</p>}

      {!isInitialLoading && !error && (simulations?.length ?? 0) === 0 && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-sm font-semibold text-foreground">No simulations yet.</p>
          <p className="max-w-md text-xs leading-relaxed text-muted">
            Start with an amount and an objective — the AI asks the follow-ups it needs, then
            designs a complete portfolio you can score, stress-test and promote to real holdings.
          </p>
          <Button variant="primary" size="md" onClick={() => setView({ kind: "new" })}>
            New Simulation →
          </Button>
        </Card>
      )}

      {simulations && simulations.length > 0 && (
        <SimulationList
          simulations={simulations}
          onOpen={(sim) => openSim(sim)}
          onCompare={(sim) => setView({ kind: "compare", sim })}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          busyId={busyId}
        />
      )}
    </div>
  );
}
