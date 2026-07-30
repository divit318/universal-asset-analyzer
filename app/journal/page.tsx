"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageShell, PageHeader, StatTile, Button, Field, Input, Card, SectionHeader, Skeleton } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { useToast } from "@/app/_components/toast";
import type { Decision, DecisionAction, ThesisEvolution } from "@/lib/types";
import type { DecisionOutcome, TrackRecord, GroupStat } from "@/lib/decision-journal";
import { MIN_SCORED_FOR_TRACK_RECORD } from "@/lib/decision-journal";
import { formatCurrency } from "@/lib/format";
import { ThesisEvolutionPanel } from "./_components/thesis-evolution-panel";

const ACTIONS: DecisionAction[] = ["buy", "watch", "hold", "avoid", "sell"];
const ACTION_TONE: Record<DecisionAction, string> = {
  buy: "text-positive border-positive/40 bg-positive/10",
  watch: "text-brand border-brand/40 bg-brand/10",
  hold: "text-warning border-warning/40 bg-warning/10",
  avoid: "text-negative border-negative/40 bg-negative/10",
  sell: "text-negative border-negative/40 bg-negative/10",
};

function pct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  const sign = fraction > 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}
const tone = (v: number | null | undefined) =>
  v == null ? "text-muted" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted";

interface JournalData {
  decisions: Decision[];
  outcomes: Record<number, DecisionOutcome>;
  trackRecord: TrackRecord | null;
}

/** A small calibration table (by conviction / fit tier). */
function CalibrationTable({ title, rows, labelFor }: { title: string; rows: GroupStat[]; labelFor?: (k: string) => string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="mb-1 text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted">Not enough logged decisions yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 text-muted">{labelFor ? labelFor(r.key) : r.key}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${(r.avgReturnPct ?? 0) >= 0 ? "bg-positive" : "bg-negative"}`}
                style={{ width: `${Math.min(100, Math.abs((r.avgReturnPct ?? 0) * 100) * 2 + 6)}%` }}
              />
            </div>
            <span className={`w-14 shrink-0 text-right font-mono ${tone(r.avgReturnPct)}`}>{pct(r.avgReturnPct)}</span>
            <span className="w-16 shrink-0 text-right text-faint">
              {r.hitRate == null ? "—" : `${Math.round(r.hitRate * 100)}% hit`}
            </span>
            <span className="w-8 shrink-0 text-right text-faint">n={r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={null}>
      <JournalPageInner />
    </Suspense>
  );
}

function JournalPageInner() {
  const params = useSearchParams();
  const toast = useToast();
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Log form state ──
  const [symbol, setSymbol] = useState(params.get("symbol")?.toUpperCase() ?? "");
  const [name, setName] = useState<string | null>(null);
  const [action, setAction] = useState<DecisionAction>("buy");
  const [conviction, setConviction] = useState(3);
  // Seed the thesis from a `?note=` param — how a pipeline stage-change prompt
  // deep-links here with the transition already written (§4.5).
  const [thesis, setThesis] = useState(params.get("note") ?? "");
  const [evolution, setEvolution] = useState<ThesisEvolution | null>(null);
  const [priceAt, setPriceAt] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reusable refresh for event handlers (submit / close / delete).
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/decisions");
      const json = (await r.json()) as JournalData;
      setData(json);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — inlined so all setState happens in the async continuation.
  useEffect(() => {
    let alive = true;
    async function initial() {
      try {
        const r = await fetch("/api/decisions");
        const json = (await r.json()) as JournalData;
        if (alive) setData(json);
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    }
    void initial();
    return () => {
      alive = false;
    };
  }, []);

  // Prefill live price + name when a symbol is chosen.
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    async function prefill() {
      try {
        const r = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
        if (!r.ok || !alive) return;
        const q = (await r.json()) as { price?: number; currency?: string; shortName?: string; name?: string };
        if (!alive) return;
        if (q.price != null) setPriceAt(q.price);
        if (q.currency) setCurrency(q.currency);
        setName(q.shortName ?? q.name ?? symbol);
      } catch {
        /* ignore */
      }
    }
    void prefill();
    return () => {
      alive = false;
    };
  }, [symbol]);

  // Thesis evolution for the selected symbol — migrated here from the retired
  // timeline (§4.5). Reads the existing timeline feed; no new engine.
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    async function loadEvolution() {
      try {
        const r = await fetch(`/api/timeline?scope=symbol&id=${encodeURIComponent(symbol)}`);
        if (!r.ok || !alive) return;
        const feed = (await r.json()) as { thesisEvolution?: ThesisEvolution | null };
        if (alive) setEvolution(feed.thesisEvolution ?? null);
      } catch {
        /* non-fatal — the panel just doesn't render */
      }
    }
    void loadEvolution();
    return () => {
      alive = false;
    };
  }, [symbol]);

  async function submit() {
    if (!symbol) return toast("Pick a symbol first", "error");
    setSubmitting(true);
    try {
      const r = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          name,
          action,
          conviction,
          thesis: thesis.trim() || null,
          priceAt,
          currency,
          targetPrice: targetPrice ? Number(targetPrice) : null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to log decision");
      toast(`Logged ${action.toUpperCase()} ${symbol}`, "success");
      setThesis("");
      setTargetPrice("");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function close(id: number) {
    await fetch("/api/decisions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  async function remove(id: number) {
    await fetch(`/api/decisions?id=${id}`, { method: "DELETE" });
    await load();
  }

  const tr = data?.trackRecord;
  const hasDecisions = (data?.decisions.length ?? 0) > 0;
  const convictionLabel = useMemo(() => ["", "1 · low", "2", "3 · med", "4", "5 · high"], []);

  return (
    <PageShell gap="gap-6">
      <Reveal index={0}>
        <PageHeader
          title="Decision Journal"
          description="Log every call with your conviction and thesis, then measure whether you were right. The loop that makes you a better investor."
        />
      </Reveal>

      {/* Track record.
          Below MIN_SCORED_FOR_TRACK_RECORD the statistics are not merely noisy,
          they are actively misleading: with one scored decision the page read
          "HIT RATE 0%" and named the SAME position as both BEST CALL and WORST
          CALL. A track record is a claim about a distribution, so it is withheld
          until there is a distribution — and the withholding is explained, with
          a count of how many more calls it needs. */}
      {tr && tr.scored > 0 && tr.scored < MIN_SCORED_FOR_TRACK_RECORD && (
        <Card>
          <SectionHeader
            label="Track record"
            description={`${tr.scored} of ${MIN_SCORED_FOR_TRACK_RECORD} scored decisions. Hit rate and calibration appear once there are enough closed calls to mean something — ${MIN_SCORED_FOR_TRACK_RECORD - tr.scored} more to go.`}
          />
        </Card>
      )}

      {tr && tr.scored >= MIN_SCORED_FOR_TRACK_RECORD && (
        <Reveal index={1} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Hit Rate"
              tone={tr.hitRate != null && tr.hitRate >= 0.5 ? "positive" : "negative"}
              value={tr.hitRate == null ? "—" : `${Math.round(tr.hitRate * 100)}%`}
              sublabel={`${tr.scored} scored decision${tr.scored === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Avg Return / Call"
              tone={(tr.avgReturnPct ?? 0) >= 0 ? "positive" : "negative"}
              value={pct(tr.avgReturnPct)}
              sublabel="directional, since decision"
            />
            {/* Best and worst are only distinct claims when they are different
                positions. With a degenerate spread, show one labelled extreme
                instead of the same name twice under opposite headings. */}
            <StatTile
              label="Best Call"
              tone="positive"
              value={tr.best ? tr.best.symbol : "—"}
              sublabel={tr.best ? pct(tr.best.directionalReturnPct) : ""}
            />
            <StatTile
              label="Worst Call"
              tone="negative"
              value={tr.worst && tr.worst.symbol !== tr.best?.symbol ? tr.worst.symbol : "—"}
              sublabel={
                tr.worst && tr.worst.symbol !== tr.best?.symbol
                  ? pct(tr.worst.directionalReturnPct)
                  : "needs a second scored call"
              }
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <CalibrationTable title="Calibration — by conviction" rows={tr.byConviction} labelFor={(k) => `Conv. ${k}`} />
            <CalibrationTable title="Does fit help? — by fit tier" rows={tr.byFitTier} />
          </div>
        </Reveal>
      )}

      {/* Log a decision */}
      <Reveal index={2} as="section">
      <Card>
        <SectionHeader label="Log a decision" description="Capture the call and the reasoning while it's fresh" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Symbol">
            <SymbolSearch value={symbol} onChange={setSymbol} onSelect={(s) => setSymbol(s.trim().toUpperCase())} />
          </Field>
          <Field label="Action">
            <div className="flex flex-wrap gap-1.5">
              {ACTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={`rounded-control border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    action === a ? ACTION_TONE[a] : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Conviction — ${convictionLabel[conviction]}`}>
            <input
              type="range"
              min={1}
              max={5}
              value={conviction}
              onChange={(e) => setConviction(Number(e.target.value))}
              className="w-full accent-brand"
            />
          </Field>
          <Field label="Target price (optional)">
            <Input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder={priceAt ? `e.g. ${(priceAt * 1.2).toFixed(2)}` : "—"}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Thesis">
              <textarea
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
                rows={2}
                placeholder="Why this call? The specific catalyst or risk you're betting on."
                className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand/50"
              />
            </Field>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted">
            {priceAt != null ? `Recording at ${formatCurrency(priceAt, currency ?? undefined)}` : "Pick a symbol to capture the current price"}
          </span>
          <Button variant="primary" onClick={submit} disabled={submitting || !symbol}>
            {submitting ? "Logging…" : "Log decision"}
          </Button>
        </div>
      </Card>
      </Reveal>

      {/* Thesis evolution for the selected symbol (migrated from the timeline). */}
      {symbol && evolution && evolution.points.length > 0 ? <ThesisEvolutionPanel evolution={evolution} /> : null}

      {/* Decision list */}
      <Reveal index={3} className="flex flex-col gap-2">
        <SectionHeader label="Decisions" description={hasDecisions ? `${data!.decisions.length} logged` : undefined} />
        {loading ? (
          <Skeleton height="h-24" radius="rounded-card" className="border border-border" />
        ) : !hasDecisions ? (
          <div className="rounded-card border border-border bg-surface px-5 py-10 text-center text-sm text-muted">
            No decisions logged yet. Log your first call above, or from any stock&apos;s research page.
          </div>
        ) : (
          data!.decisions.map((d) => {
            const o = data!.outcomes[d.id];
            return (
              <div key={d.id} className="flex items-start gap-3 rounded-card border border-border bg-surface p-3.5">
                <span className={`mt-0.5 shrink-0 rounded-control border px-2 py-0.5 text-xs font-semibold uppercase ${ACTION_TONE[d.action]}`}>
                  {d.action}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Link href={`/research?symbol=${d.symbol}`} className="text-sm font-semibold hover:text-brand">
                      {d.symbol}
                    </Link>
                    <span className="text-xs text-faint">conv. {d.conviction}/5</span>
                    {d.fitTier && <span className="text-xs text-faint">· fit {d.fitTier}</span>}
                    {d.status === "closed" && <span className="text-xs text-muted">· closed</span>}
                  </div>
                  {d.thesis && <p className="truncate text-xs text-muted">{d.thesis}</p>}
                  <p className="text-micro text-faint">
                    {d.priceAt != null ? `logged at ${formatCurrency(d.priceAt, d.currency ?? undefined)}` : ""}
                    {o?.markPrice != null && d.priceAt != null ? ` → ${formatCurrency(o.markPrice, d.currency ?? undefined)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`font-mono text-sm font-semibold ${tone(o?.directionalReturnPct)}`}>
                    {o?.directionalReturnPct == null ? "—" : pct(o.directionalReturnPct)}
                  </span>
                  <div className="flex gap-1.5 text-micro">
                    {d.status === "open" && (
                      <button onClick={() => close(d.id)} className="text-muted hover:text-foreground">
                        close
                      </button>
                    )}
                    <button onClick={() => remove(d.id)} className="text-muted hover:text-negative">
                      delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Reveal>
    </PageShell>
  );
}
