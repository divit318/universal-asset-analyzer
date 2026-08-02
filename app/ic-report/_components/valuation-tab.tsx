"use client";

/**
 * IC Report — valuation tab.
 *
 * Every number here is computed by the deterministic engine
 * (lib/ic/valuation-engine.ts); this component only renders. Assumptions are
 * prominent, not hidden behind small disclosure affordances (Phase 5.12);
 * the football field, scenario comparison and sensitivity heatmap replace
 * prose-only sections (Phase 5.20).
 */

import { Fragment, useState } from "react";
import type { ValuationSuiteResult, CaseReconciliation, PriorReconciliation } from "@/lib/ic-valuation";
import type { HistoryStats } from "@/lib/ic/history-stats";
import type { InvariantViolation } from "@/lib/ic/valuation-engine";
import { fmtMoney, fmtMoneyCompact, fmtPercent, fmtMultiple } from "@/lib/ic/format";
import { Card, DirectionValue, EmptyState, ConfidenceChip } from "./shared";

export function ValuationTab({
  valuation,
  caseReconciliation,
  priorReconciliation,
  historyStats,
  currency,
}: {
  valuation: ValuationSuiteResult;
  caseReconciliation: CaseReconciliation | null | undefined;
  priorReconciliation: PriorReconciliation | null | undefined;
  historyStats: HistoryStats | null | undefined;
  currency: string;
}) {
  const v = valuation;

  return (
    <div className="flex flex-col gap-4">
      {/* Blocking violations: explicit failure state naming the invariant (2.2) */}
      {v.blockingViolations.length > 0 && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative" role="alert">
          <p className="font-medium">Valuation blocked: {v.blockingViolations.length} invariant {v.blockingViolations.length === 1 ? "violation" : "violations"}. No headline value is rendered past a blocker.</p>
          <ul className="mt-1.5 list-disc pl-5 text-xs">
            {v.blockingViolations.map((b, i) => (
              <li key={i}>
                <span className="font-medium">{b.invariant}:</span> {b.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Headline strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="text-center">
          <div className="text-xs text-muted">Spot price</div>
          <div className="mt-1 text-xl font-semibold">{v.spot != null ? fmtMoney(v.spot, currency) : "not available"}</div>
        </Card>
        <Card className="text-center">
          <div className="text-xs text-muted">Blended estimate</div>
          <div className="mt-1 text-xl font-semibold">
            {v.headline ? fmtMoney(v.headline.perShare, currency) : <span className="text-base text-warning">no estimate</span>}
          </div>
        </Card>
        <Card className="text-center">
          <div className="text-xs text-muted">Vs spot</div>
          <div className="mt-1 text-xl font-semibold">
            {v.headline?.vsSpot != null
              ? <DirectionValue value={v.headline.vsSpot} format={(x) => fmtPercent(x, { signed: true })} />
              : "not available"}
          </div>
        </Card>
        <Card className="text-center">
          <div className="text-xs text-muted">Reverse DCF: price implies</div>
          <div className="mt-1 text-xl font-semibold">
            {v.reverse?.impliedGrowth != null ? `${fmtPercent(v.reverse.impliedGrowth)} growth` : "not available"}
          </div>
        </Card>
      </div>

      {/* Football field (5.20) */}
      <FootballField valuation={v} currency={currency} />

      {/* Methods table with prominent assumptions (5.12) */}
      <Card>
        <h3 className="mb-1 text-sm font-semibold">Valuation methods</h3>
        <p className="mb-3 text-xs text-muted">
          Estimates carry the blend; anchors reproduce the market&apos;s own multiple and are shown for context only. Methods that do not apply to this company say why.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="pb-2 text-left font-medium">Method</th>
                <th scope="col" className="pb-2 text-right font-medium">Value/share</th>
                <th scope="col" className="pb-2 text-right font-medium">Vs spot</th>
                <th scope="col" className="pb-2 text-left font-medium pl-4">Role</th>
                <th scope="col" className="pb-2 text-right font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {v.methods.map((m) => (
                <Fragment key={m.kind}>
                  <tr className={m.applicable ? undefined : "opacity-70"}>
                    <td className="pt-2.5 font-medium">{m.label}</td>
                    <td className="pt-2.5 text-right font-mono">
                      {m.perShare != null ? fmtMoney(m.perShare, currency) : <span className="text-muted">n/a</span>}
                    </td>
                    <td className="pt-2.5 text-right font-mono">
                      {m.vsSpot != null ? <DirectionValue value={m.vsSpot} format={(x) => fmtPercent(x, { signed: true })} /> : <span className="text-muted">n/a</span>}
                    </td>
                    <td className="pt-2.5 pl-4 text-xs">
                      {m.applicable ? (
                        <span className={m.role === "estimate" ? "text-positive" : "text-muted"}>
                          {m.role === "estimate" ? "estimate (in blend)" : "anchor (context only)"}
                        </span>
                      ) : (
                        <span className="text-muted">not applicable</span>
                      )}
                    </td>
                    <td className="pt-2.5 text-right">
                      {m.applicable ? <ConfidenceChip confidence={m.confidence} /> : <span className="text-xs text-muted">n/a</span>}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="pb-2.5 pt-1">
                      <p className="text-xs leading-5 text-muted">
                        {m.applicable ? m.assumptions : m.notApplicableReason}
                        {m.workings && (
                          <span className="mt-0.5 block font-mono text-label text-muted/80">{m.workings}</span>
                        )}
                      </p>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {v.blend && (
          <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            <span className="font-medium text-foreground">Blend weights: </span>
            {v.blend.components.map((c) => `${c.label} ${(c.weight * 100).toFixed(0)}%`).join(" · ")}
            {" — "}weights favour the method with inspected assumptions; anchors excluded.
          </div>
        )}
        <p className="mt-2 text-label text-muted/80">
          Inputs: {v.modelProposedInputs ? "model-proposed within validation bands" : "history-derived defaults (model proposal unavailable or rejected)"} · WACC {fmtPercent(v.wacc.value)} ({v.wacc.components}) · prompt {v.promptVersion}
        </p>
      </Card>

      {/* Scenario comparison — side by side (5.16) */}
      {v.dcf.scenarios ? (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">DCF scenarios, side by side</h3>
          <div className="grid gap-3 md:grid-cols-3">
            {([v.dcf.scenarios.bear, v.dcf.scenarios.base, v.dcf.scenarios.bull] as const).map((s) => {
              const tone = s.label === "bear" ? "border-negative/40" : s.label === "bull" ? "border-positive/40" : "border-brand/40";
              const labelTone = s.label === "bear" ? "text-negative" : s.label === "bull" ? "text-positive" : "text-brand";
              return (
                <div key={s.label} className={`rounded-lg border ${tone} bg-surface-2 p-4`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`text-sm font-semibold uppercase ${labelTone}`}>{s.label} case</span>
                    <span className="font-mono text-sm font-semibold">{fmtMoney(s.result.perShare, currency)}</span>
                  </div>
                  <dl className="space-y-1 text-xs text-muted">
                    <Row k="Vs spot" v={<DirectionValue value={s.result.vsSpot} format={(x) => fmtPercent(x, { signed: true })} />} />
                    <Row k="Stage-1 growth" v={fmtPercent(s.inputs.growthPath[0])} />
                    <Row k="WACC" v={fmtPercent(s.inputs.wacc)} />
                    <Row k="Terminal growth" v={fmtPercent(s.inputs.terminalGrowth)} />
                    <Row k="Terminal share of EV" v={fmtPercent(s.result.terminalShare)} />
                  </dl>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        v.dcf.skippedReason && (
          <Card>
            <h3 className="mb-1 text-sm font-semibold">DCF</h3>
            <p className="text-sm text-muted">Not run: {v.dcf.skippedReason}</p>
          </Card>
        )
      )}

      {/* Sensitivity heatmap + drivers (2.9 / 5.20) */}
      {v.sensitivity && <SensitivityGrid valuation={v} currency={currency} />}

      {/* DCF intermediates — every step inspectable (2.1) */}
      {v.dcf.base && v.dcf.inputs && <DcfWorkings valuation={v} currency={currency} />}

      {/* Warnings (non-blocking) */}
      {v.warnings.length > 0 && <WarningList warnings={v.warnings} />}

      {/* Reconciliations (2.3) */}
      {(caseReconciliation || priorReconciliation) && (
        <div className="grid gap-3 md:grid-cols-2">
          {caseReconciliation && (
            <Card className={caseReconciliation.divergent ? "border-warning/40" : undefined}>
              <h3 className="mb-1 text-sm font-semibold">
                Your valuation case {caseReconciliation.divergent && <span className="text-warning">(divergent)</span>}
              </h3>
              <p className="text-xs leading-5 text-muted">{caseReconciliation.explanation}</p>
            </Card>
          )}
          {priorReconciliation && (
            <Card className={priorReconciliation.divergent ? "border-warning/40" : undefined}>
              <h3 className="mb-1 text-sm font-semibold">
                Quant engine prior {priorReconciliation.divergent && <span className="text-warning">(divergent)</span>}
              </h3>
              <p className="text-xs leading-5 text-muted">{priorReconciliation.explanation}</p>
            </Card>
          )}
        </div>
      )}

      {/* Run hot / cold — one window, one distribution, self-consistent (2.6/2.7) */}
      {historyStats && <HistoryStatsCard stats={historyStats} />}

      {v.methods.length === 0 && <EmptyState title="No valuation methods could run" detail="The canonical data object carries no usable inputs for this name. See the data gaps banner above." />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{k}</dt>
      <dd className="font-mono text-foreground">{v}</dd>
    </div>
  );
}

/* ── Football field ─────────────────────────────────────────────────────── */

function FootballField({ valuation: v, currency }: { valuation: ValuationSuiteResult; currency: string }) {
  const bars: { label: string; lo: number; hi: number; tone: string }[] = [];
  for (const m of v.methods) {
    if (!m.applicable || m.perShare == null) continue;
    bars.push({
      label: m.label,
      lo: m.perShare,
      hi: m.perShare,
      tone: m.role === "estimate" ? "var(--brand)" : "var(--muted, #6b7280)",
    });
  }
  const sc = v.dcf.scenarios;
  if (sc) {
    bars.unshift({ label: "DCF bear to bull", lo: sc.bear.result.perShare, hi: sc.bull.result.perShare, tone: "var(--brand)" });
  }
  if (bars.length === 0 || v.spot == null) return null;

  const values = bars.flatMap((b) => [b.lo, b.hi]).concat(v.spot, v.headline ? [v.headline.perShare] : []);
  const min = Math.min(...values) * 0.92;
  const max = Math.max(...values) * 1.08;
  const x = (val: number) => ((val - min) / (max - min)) * 100;

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold">Value range across methods, spot marked</h3>
      <div className="flex flex-col gap-2" role="img" aria-label={`Football field chart: spot ${fmtMoney(v.spot, currency)}${v.headline ? `, blended estimate ${fmtMoney(v.headline.perShare, currency)}` : ""}`}>
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-xs text-muted" title={b.label}>{b.label}</span>
            <div className="relative h-6 flex-1 rounded bg-surface-2">
              {/* range or point */}
              {b.hi > b.lo ? (
                <div
                  className="absolute top-1 h-4 rounded"
                  style={{ left: `${x(b.lo)}%`, width: `${Math.max(0.8, x(b.hi) - x(b.lo))}%`, background: "color-mix(in srgb, var(--brand) 35%, transparent)" }}
                />
              ) : (
                <div className="absolute top-1 h-4 w-1.5 rounded" style={{ left: `calc(${x(b.lo)}% - 3px)`, background: b.tone }} />
              )}
              {/* spot marker */}
              <div className="absolute -top-0.5 h-7 w-0.5 bg-negative" style={{ left: `${x(v.spot!)}%` }} aria-hidden="true" />
            </div>
            <span className="w-28 shrink-0 text-right font-mono text-xs">
              {b.hi > b.lo ? `${fmtMoney(b.lo, currency)}–${fmtMoney(b.hi, currency)}` : fmtMoney(b.lo, currency)}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-4 text-label text-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-negative" /> spot {fmtMoney(v.spot, currency)}</span>
          {v.headline && <span>blended estimate {fmtMoney(v.headline.perShare, currency)}</span>}
        </div>
      </div>
    </Card>
  );
}

/* ── Sensitivity ────────────────────────────────────────────────────────── */

function SensitivityGrid({ valuation: v, currency }: { valuation: ValuationSuiteResult; currency: string }) {
  const s = v.sensitivity!;
  const flat = s.grid.perShare.flat().filter((x): x is number => x != null);
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const shade = (val: number) => {
    const t = hi > lo ? (val - lo) / (hi - lo) : 0.5;
    return `color-mix(in srgb, var(--brand) ${Math.round(8 + t * 40)}%, transparent)`;
  };

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold">Sensitivity: WACC by terminal growth</h3>
      <p className="mb-3 text-xs text-muted">
        Per-share DCF value across the grid. Blank cells: terminal growth too close to WACC for a defined perpetuity.
        {s.breakevenGrowth != null && (
          <> Breakeven: spot is reproduced at {fmtPercent(s.breakevenGrowth)} stage-1 growth.</>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th scope="col" className="pb-1 pr-2 text-left font-medium text-muted">WACC \ g∞</th>
              {s.grid.terminalGrowthValues.map((t) => (
                <th key={t} scope="col" className="pb-1 text-right font-medium text-muted">{fmtPercent(t)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.grid.waccValues.map((w, wi) => (
              <tr key={w}>
                <th scope="row" className="py-0.5 pr-2 text-left font-medium text-muted">{fmtPercent(w)}</th>
                {s.grid.terminalGrowthValues.map((t, ti) => {
                  const val = s.grid.perShare[wi][ti];
                  const isCenter = wi === 2 && ti === 2;
                  return (
                    <td
                      key={t}
                      className={`py-0.5 text-right font-mono ${isCenter ? "font-bold" : ""}`}
                      style={val != null ? { background: shade(val) } : undefined}
                    >
                      <span className="px-1.5">{val != null ? fmtMoney(val, currency, { digits: 0 }) : "—"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-muted sm:grid-cols-3">
        <div>+1pp stage-1 growth: <DirectionValue value={s.drivers.growthPlus1pp} format={(x) => fmtMoney(x, currency, { signed: true })} /></div>
        <div>+1pp WACC: <DirectionValue value={s.drivers.waccPlus1pp} format={(x) => fmtMoney(x, currency, { signed: true })} /></div>
        <div>+50bp terminal growth: <DirectionValue value={s.drivers.terminalPlus50bp} format={(x) => fmtMoney(x, currency, { signed: true })} /></div>
      </dl>
    </Card>
  );
}

/* ── DCF workings ───────────────────────────────────────────────────────── */

function DcfWorkings({ valuation: v, currency }: { valuation: ValuationSuiteResult; currency: string }) {
  const [open, setOpen] = useState(false);
  const base = v.dcf.base!;
  const inputs = v.dcf.inputs!;
  return (
    <Card>
      <button
        className="flex w-full min-h-[44px] items-center justify-between gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div>
          <h3 className="text-sm font-semibold">DCF workings: every intermediate, inspectable</h3>
          <p className="text-xs text-muted">
            PV explicit {fmtMoneyCompact(base.pvExplicit, currency)} + PV terminal {fmtMoneyCompact(base.pvTerminalPerp, currency)} − net debt {fmtMoneyCompact(base.netDebt, currency)} = equity {fmtMoneyCompact(base.equityValue, currency)} → {fmtMoney(base.perShare, currency)}/share · terminal carries {fmtPercent(base.terminalShare)} of EV
          </p>
        </div>
        <span className="shrink-0 text-brand">{open ? "collapse" : "expand"}</span>
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th scope="col" className="pb-1 text-left font-medium">Year</th>
                <th scope="col" className="pb-1 text-right font-medium">Growth</th>
                <th scope="col" className="pb-1 text-right font-medium">FCF</th>
                <th scope="col" className="pb-1 text-right font-medium">Discount factor</th>
                <th scope="col" className="pb-1 text-right font-medium">PV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {base.rows.map((r) => (
                <tr key={r.year}>
                  <td className="py-1">{r.year}</td>
                  <td className="py-1 text-right">{fmtPercent(r.growth)}</td>
                  <td className="py-1 text-right">{fmtMoneyCompact(r.fcf, currency)}</td>
                  <td className="py-1 text-right">{r.discountFactor.toFixed(4)}</td>
                  <td className="py-1 text-right">{fmtMoneyCompact(r.pv, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
            <div>Terminal (perpetuity {fmtPercent(inputs.terminalGrowth)}): {fmtMoneyCompact(base.terminalValuePerp, currency)} → PV {fmtMoneyCompact(base.pvTerminalPerp, currency)}</div>
            {base.terminalValueExit != null && (
              <div>Terminal (exit {fmtMultiple(inputs.exitMultiple ?? 0)} EV/FCF): {fmtMoneyCompact(base.terminalValueExit, currency)} → per share {base.perShareExit != null ? fmtMoney(base.perShareExit, currency) : "n/a"}</div>
            )}
            {v.reverse?.impliedYearsAtBaseGrowth != null && (
              <div>Reverse DCF duration: spot implies about {v.reverse.impliedYearsAtBaseGrowth} years at the base growth rate</div>
            )}
          </dl>
        </div>
      )}
    </Card>
  );
}

function WarningList({ warnings }: { warnings: InvariantViolation[] }) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
      <p className="font-medium">Engine warnings ({warnings.length})</p>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {warnings.map((w, i) => (
          <li key={i}>
            <span className="font-medium">{w.invariant}:</span> {w.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── History stats ──────────────────────────────────────────────────────── */

function HistoryStatsCard({ stats }: { stats: HistoryStats }) {
  const v = stats.verdict;
  return (
    <Card className={v?.signal === "run_hot" ? "border-warning/40 bg-warning/5" : v?.signal === "run_cold" ? "border-brand/40 bg-brand/5" : undefined}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="mb-1 text-sm font-semibold">Run hot / cold: return vs own history</h3>
          {v ? (
            <p className="text-sm text-muted">
              Over the {v.windowYears}-year window: current CAGR{" "}
              <strong className="text-foreground">{fmtPercent(v.cagr, { signed: true })}</strong> vs a rolling median of{" "}
              <strong className="text-foreground">{fmtPercent(v.medianCagr, { signed: true })}</strong>, placing it at the{" "}
              <strong className="text-foreground">{v.percentile}th percentile</strong> of {v.observations} rolling observations of the same window.
            </p>
          ) : stats.sinceListing ? (
            <p className="text-sm text-muted">
              Listing history is too short for a rolling percentile. Since listing ({stats.sinceListing.years}y): total return {fmtPercent(stats.sinceListing.totalReturn, { signed: true })}.
            </p>
          ) : (
            <p className="text-sm text-muted">Insufficient price history.</p>
          )}
        </div>
        {v && (
          <span
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold uppercase ${
              v.signal === "run_hot" ? "border-warning/40 text-warning" : v.signal === "run_cold" ? "border-brand/40 text-brand" : "border-border text-muted"
            }`}
          >
            {v.signal.replace("_", " ")} · {v.windowYears}y window
          </span>
        )}
      </div>
      {stats.windows.some((w) => w.available) && (
        <div className="mt-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted">Per-window: CAGR, rolling median, percentile (each within its own window)</div>
          <div className="flex flex-wrap gap-2">
            {stats.windows.filter((w) => w.available).map((w) => (
              <div
                key={w.years}
                className={`flex flex-col items-center rounded-lg border px-3 py-2 ${
                  w.signal === "run_hot" ? "border-warning/50 bg-warning/5" : w.signal === "run_cold" ? "border-brand/50 bg-brand/5" : "border-border bg-surface-2"
                }`}
              >
                <span className="text-xs font-semibold text-muted">{w.years}y</span>
                <span className="font-mono text-sm font-semibold">
                  <DirectionValue value={w.cagr} format={(x) => fmtPercent(x, { signed: true })} />
                </span>
                <span className="text-label text-muted">med {w.medianCagr != null ? fmtPercent(w.medianCagr) : "n/a"}</span>
                <span className={`mt-0.5 text-label font-semibold ${w.signal === "run_hot" ? "text-warning" : w.signal === "run_cold" ? "text-brand" : "text-muted"}`}>
                  {w.percentile != null ? `${w.percentile}th pct (${w.observations} obs)` : `no distribution (${w.observations} obs)`}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-label text-muted">
            Hot: at or above the 80th percentile of the same window&apos;s rolling history. Cold: at or below the 20th. The verdict uses the longest window with a distribution.
          </p>
        </div>
      )}
    </Card>
  );
}
