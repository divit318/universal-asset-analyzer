"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  Badge,
  Button,
  StatTile,
  Tabs,
  DataTable,
  DataTableAction,
  ScoreChip,
  type DataTableColumn,
  type TabItem,
} from "@/app/_components/ui";
import { useToast } from "@/app/_components/toast";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL } from "@/lib/portfolio/model/types";
import type { Holding } from "@/lib/portfolio/model/types";
import type { SimEvaluation } from "@/lib/portfolio/simulator/evaluate";
import type { SimHolding, Simulation } from "@/lib/portfolio/simulator/types";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";
import { AllocationPanel, MacroFactorPanel } from "../universal/allocation-panel";
import { HealthPanel } from "../universal/health-panel";
import { RiskLab } from "../universal/risk-lab";
import { AddDialog, AdjustDialog, RemoveDialog, SwapDialog } from "./edit-dialogs";

type Section = "overview" | "holdings" | "risk";

const SECTIONS: TabItem<Section>[] = [
  { id: "overview", label: "Overview" },
  { id: "holdings", label: "Holdings" },
  { id: "risk", label: "Risk Lab" },
];

/** One row of the holdings table: the persisted spec joined to its live
 * engine-normalized counterpart. */
interface SimRow {
  spec: SimHolding;
  live: Holding | null;
}

/**
 * A generated portfolio, rendered with the SAME panels as the real one
 * (AllocationPanel / HealthPanel / RiskLab) over a live evaluation. Organized
 * as internal sections rather than one scroll: the Risk Lab alone is a full
 * page, and a single scroll would bury the thesis four screens up.
 */
type EditDialog =
  | { kind: "adjust" | "remove" | "swap"; spec: SimHolding; live: Holding | null }
  | { kind: "add" };

export function SimView({
  sim,
  seed,
  onRegenerate,
  onSimChanged,
}: {
  sim: Simulation;
  /** Evaluation from the generation run, when we arrive straight from it. */
  seed: SimEvaluation | null;
  onRegenerate: () => void;
  /** Fired with the fresh row after every persisted edit. */
  onSimChanged: (sim: Simulation) => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [evaluation, setEvaluation] = useState<SimEvaluation | null>(seed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<EditDialog | null>(null);
  const [saving, setSaving] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const toast = useToast();

  const fetchEvaluation = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/simulator/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sim.id }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to evaluate the portfolio");
      setEvaluation(json.evaluation as SimEvaluation);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to evaluate the portfolio");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [sim.id]);

  useEffect(() => {
    if (startedRef.current || seed) return;
    startedRef.current = true;
    void fetchEvaluation();
    return () => {
      startedRef.current = false;
      abortRef.current?.abort();
    };
  }, [fetchEvaluation, seed]);

  /** After an edit persists: numbers refresh NOW; the prose (rationales for
   * changed symbols + thesis + headline) re-narrates in the background —
   * accurate holdings with yesterday's sentence for a minute, never the
   * reverse. */
  const fireNarrative = useCallback(
    async (symbols: string[]) => {
      setNarrating(true);
      try {
        const res = await fetch("/api/portfolio/simulator/refresh-narrative", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sim.id, symbols }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Narrative refresh failed");
        onSimChanged(json.simulation as Simulation);
        setEvaluation(json.evaluation as SimEvaluation);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Rationales could not refresh — the holdings themselves are saved", "info");
      } finally {
        setNarrating(false);
      }
    },
    [sim.id, onSimChanged, toast],
  );

  async function serverEdit(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch("/api/portfolio/simulator/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sim.id, ...payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Edit failed");
      setDialog(null);
      onSimChanged(json.simulation as Simulation);
      if (json.note) toast(json.note as string, "info");
      void fetchEvaluation();
      void fireNarrative(json.changedSymbols as string[]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Edit failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function applySwapChoice(alt: { symbol: string; holdings: SimHolding[] }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/portfolio/simulator?id=${encodeURIComponent(sim.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: alt.holdings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Swap failed");
      setDialog(null);
      onSimChanged(json.simulation as Simulation);
      toast(`Swapped to ${alt.symbol}.`, "success");
      void fetchEvaluation();
      // The replacement carries its own fresh rationale; only the book-level
      // thesis and headline need re-narrating.
      void fireNarrative([]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Swap failed", "error");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <Card className="flex items-center justify-between gap-3 border-negative/25 bg-negative/5 p-4">
        <p className="text-xs text-negative">{error}</p>
        <Button size="sm" variant="secondary" onClick={fetchEvaluation}>
          Retry
        </Button>
      </Card>
    );
  }

  if (!evaluation) {
    return (
      <Card className="p-5">
        <p className="animate-pulse text-xs text-muted">
          Pricing {sim.holdings.length} holdings and scoring the book…
        </p>
      </Card>
    );
  }

  const liveBySymbol = new Map(evaluation.holdings.map((h) => [h.symbol ?? "CASH", h]));
  const rows: SimRow[] = sim.holdings.map((spec) => ({
    spec,
    live: liveBySymbol.get(spec.symbol ?? "CASH") ?? null,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* ── Thesis + strategy tags (the Dashboard banner's language) ── */}
      {sim.thesis && (
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {sim.thesis.tags.map((t) => (
              <Badge key={t} variant="brand">
                {t}
              </Badge>
            ))}
            {sim.thesis.source === "fallback" && <Badge variant="warning">AI narrative unavailable</Badge>}
            {narrating && (
              <span className="animate-pulse text-[10px] text-muted">updating narrative…</span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted">{sim.thesis.summary}</p>
        </Card>
      )}

      {/* ── Headline ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Hypothetical value"
          value={formatCurrency(evaluation.totalValue, sim.profile.currency)}
          sublabel={`${evaluation.holdings.length} holdings · ${evaluation.allocation.byAssetClass.slices.length} asset classes`}
        />
        <StatTile
          label="Annual income"
          value={formatCurrency(evaluation.annualIncome, sim.profile.currency)}
          sublabel={`${evaluation.incomeYieldPct.toFixed(2)}% yield`}
        />
        <StatTile
          label="Health"
          value={<ScoreChip kind="health" score={evaluation.health.total} size="md" showLabel={false} />}
          sublabel={`Grade ${evaluation.health.grade} · ${evaluation.health.coveragePct}% coverage`}
        />
        <StatTile
          label="Volatility"
          value={
            evaluation.risk.annualizedVolatility != null
              ? `${evaluation.risk.annualizedVolatility.toFixed(1)}%`
              : "—"
          }
          sublabel={
            evaluation.risk.maxDrawdown != null
              ? `Max drawdown ${evaluation.risk.maxDrawdown.toFixed(1)}% · mandate allows ~${sim.profile.maxDrawdownPct}%`
              : `Mandate allows ~${sim.profile.maxDrawdownPct}% drawdown`
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Tabs tabs={SECTIONS} active={section} onChange={setSection} layoutId={`sim-sections-${sim.id}`} />
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={fetchEvaluation} disabled={loading}>
            {loading ? "Repricing…" : "Refresh prices"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onRegenerate}>
            Regenerate
          </Button>
        </div>
      </div>

      {section === "overview" && (
        <div className="flex flex-col gap-4">
          <AllocationPanel allocation={evaluation.allocation} />
          {/* Factor exposure moved out of AllocationPanel so the real dashboard can
              place attribution between the two; rendered here to keep this overview
              showing exactly what it did before that split. */}
          <MacroFactorPanel allocation={evaluation.allocation} />
          <HealthPanel health={evaluation.health} />
        </div>
      )}

      {section === "holdings" && (
        <SimHoldingsTable
          rows={rows}
          totalValue={evaluation.totalValue}
          currency={sim.profile.currency}
          narrating={narrating}
          onAdd={() => setDialog({ kind: "add" })}
          onAction={(kind, row) => setDialog({ kind, spec: row.spec, live: row.live })}
        />
      )}

      {section === "risk" && <RiskLab risk={evaluation.risk} scenarios={evaluation.scenarios} />}

      {/* ── Edit dialogs — every confirm recalculates the whole book live ── */}
      {dialog?.kind === "adjust" && (
        <AdjustDialog
          holding={dialog.spec}
          livePrice={dialog.live && dialog.spec.quantity > 0 ? dialog.live.valuation.valueBase / dialog.spec.quantity : null}
          currency={sim.profile.currency}
          cash={sim.holdings.find((h) => h.assetClass === "cash")?.quantity ?? 0}
          saving={saving}
          onApply={(quantity) => void serverEdit({ action: "adjust", symbol: dialog.spec.symbol, quantity })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveDialog
          holding={dialog.spec}
          liveValue={dialog.live?.valuation.valueBase ?? null}
          currency={sim.profile.currency}
          saving={saving}
          onApply={() => void serverEdit({ action: "remove", symbol: dialog.spec.symbol })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "swap" && (
        <SwapDialog
          sim={sim}
          holding={dialog.spec}
          saving={saving}
          onApply={(alt) => void applySwapChoice(alt)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "add" && (
        <AddDialog
          sim={sim}
          saving={saving}
          onApply={(input: { symbol: string; assetClass: PortfolioAssetClass; quantity: number }) =>
            void serverEdit({ action: "add", ...input })
          }
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function SimHoldingsTable({
  rows,
  totalValue,
  currency,
  narrating,
  onAdd,
  onAction,
}: {
  rows: SimRow[];
  totalValue: number;
  currency: string;
  narrating: boolean;
  onAdd: () => void;
  onAction: (kind: "adjust" | "swap" | "remove", row: SimRow) => void;
}) {
  const columns: DataTableColumn<SimRow>[] = [
    {
      key: "symbol",
      label: "Holding",
      firstSortDir: "asc",
      render: (r) => (
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{r.spec.symbol ?? "CASH"}</span>
          <span className="max-w-[16rem] truncate text-[11px] text-muted">{r.spec.name}</span>
        </span>
      ),
      sortValue: (r) => r.spec.symbol ?? "CASH",
    },
    {
      key: "class",
      label: "Class",
      render: (r) => <Badge variant="neutral">{PORTFOLIO_CLASS_LABEL[r.spec.assetClass] ?? r.spec.assetClass}</Badge>,
      sortValue: (r) => r.spec.assetClass,
      hideBelow: "sm",
    },
    {
      key: "quantity",
      label: "Quantity",
      numeric: true,
      render: (r) => (r.spec.assetClass === "cash" ? "—" : r.spec.quantity.toLocaleString("en-US")),
      sortValue: (r) => (r.spec.assetClass === "cash" ? null : r.spec.quantity),
      hideBelow: "md",
    },
    {
      key: "value",
      label: "Value",
      help: "Live market value in the mandate currency.",
      numeric: true,
      render: (r) => (r.live ? formatCurrency(r.live.valuation.valueBase, currency) : "—"),
      sortValue: (r) => r.live?.valuation.valueBase ?? null,
    },
    {
      key: "weight",
      label: "Weight",
      help: "Live weight of total value; drifts from the designed target as prices move.",
      numeric: true,
      render: (r) =>
        r.live && totalValue > 0 ? `${r.live.weight.toFixed(1)}%` : "—",
      sortValue: (r) => r.live?.weight ?? null,
    },
    {
      key: "target",
      label: "Target",
      help: "The designed weight this position was sized to.",
      numeric: true,
      render: (r) => `${r.spec.targetWeight.toFixed(1)}%`,
      sortValue: (r) => r.spec.targetWeight,
      hideBelow: "sm",
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.spec.symbol ?? "CASH"}
      defaultSortKey="value"
      defaultSortDir="desc"
      label="Hypothetical holdings"
      toolbar={
        // NOT "Add holding" — that exact label sits in the page header and adds
        // to the REAL portfolio. Two identical buttons with different blast
        // radii on one screen is how a hypothetical position ends up real.
        <Button size="sm" variant="secondary" onClick={onAdd}>
          Add position to simulation
        </Button>
      }
      actions={(r) =>
        r.spec.assetClass === "cash" ? null : (
          <>
            <DataTableAction onClick={() => onAction("adjust", r)}>Adjust quantity…</DataTableAction>
            <DataTableAction onClick={() => onAction("swap", r)}>Swap for an alternative…</DataTableAction>
            <DataTableAction onClick={() => onAction("remove", r)} tone="danger">
              Remove
            </DataTableAction>
          </>
        )
      }
      renderDetail={(r) =>
        r.spec.rationale ? (
          <div className="flex flex-col gap-1 px-1 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
              Why this holding
            </span>
            <p className="max-w-3xl text-xs leading-relaxed text-muted">
              {r.spec.rationale}
              {narrating && <span className="ml-1.5 animate-pulse text-[10px] text-muted/70">(updating…)</span>}
            </p>
          </div>
        ) : (
          <p className="px-1 py-2 text-xs italic text-muted">
            {narrating ? "Writing a rationale for this position…" : "No rationale recorded for this position."}
          </p>
        )
      }
    />
  );
}
