"use client";

/**
 * What one ledger line actually exposes you to.
 *
 * The same flow component as the trace, run the other way: one line fans out
 * into the companies it contains, band width being each one's contribution to
 * the BOOK (not its weight inside the fund — the fund's own percentages are a
 * different denominator and mixing them is how look-through goes wrong).
 *
 * The hatched band is the point of this view. A fund picture built from ten
 * disclosed names and drawn as if it were the whole fund is a lie of omission,
 * so the undisclosed remainder is a first-class band with its own label. It is
 * also, usually, the largest one — which is exactly the thing a user should see
 * before trusting any number on this page.
 */

import { useState } from "react";
import { fundOverlapView, positionFan } from "@/lib/exposure/query";
import { Flow, FlowLegend, type FlowBand } from "../flow";
import { Caveat, Eyebrow, MagnitudeBar, Pct, StageSection } from "../primitives";
import type { ViewProps } from "../nav";
import { Missing } from "./trace-view";

const FLOW_HEIGHT = 260;

export function PositionView({ graph, index, selection, navigate }: ViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const fan = positionFan(graph, index, selection.nodeId);
  if (!fan) return <Missing />;

  const { position } = fan;

  const bands: FlowBand[] = fan.constituents.map((c) => ({
    id: c.issuerId,
    label: c.symbol,
    tone: "fund",
    value: c.bookPct,
    detail: `${position.label} ${position.weightPct.toFixed(2)}% of book × ${c.symbol} ${c.innerPct.toFixed(2)}% of ${position.label} = ${c.bookPct.toFixed(2)}% of book`,
    onClick: () => navigate({ nodeId: c.issuerId, view: "trace" }),
  }));

  if (fan.undisclosedPct > 0) {
    const undisclosedBook = (position.weightPct * fan.undisclosedPct) / 100;
    bands.push({
      id: "undisclosed",
      label: `Undisclosed ${fan.undisclosedPct.toFixed(0)}%`,
      tone: "undisclosed",
      value: undisclosedBook,
      detail: `${fan.undisclosedPct.toFixed(1)}% of ${position.label} is not disclosed — ${undisclosedBook.toFixed(2)}% of your book whose underlying companies are unknown.`,
    });
  }

  const maxInner = Math.max(...fan.constituents.map((c) => c.innerPct), 0.01);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="space-y-1.5">
          <Eyebrow>{position.isFund ? "Fund line" : "Direct line"}</Eyebrow>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xl font-semibold tracking-tight text-foreground">
              {position.label}
            </span>
            <span className="text-sm text-muted">{position.name}</span>
          </div>
        </div>
        <div className="flex gap-6 text-right">
          <Stat label="Book weight" value={`${position.weightPct.toFixed(2)}%`} />
          {position.lookThrough?.category ? (
            <Stat label="Category" value={position.lookThrough.category} mono={false} />
          ) : null}
          <Stat
            label="Disclosed"
            value={position.isFund ? `${fan.disclosedPct.toFixed(0)}%` : "—"}
          />
        </div>
      </header>

      {position.opaque ? (
        <Caveat>
          The provider reports no constituent data for {position.label}, so this{" "}
          <Pct value={position.weightPct} /> of your book cannot be looked through at all. It is excluded
          from every effective-exposure figure on this page rather than estimated — which is why those
          figures are floors.
        </Caveat>
      ) : null}

      {fan.dominates.length > 0 ? (
        <p className="text-sm leading-relaxed text-foreground">
          This one line is the majority route to{" "}
          <span className="font-medium">{fan.dominates.length}</span> of your effective exposures
          {fan.dominates.length > 0 ? (
            <>
              {" "}— including{" "}
              {fan.dominates.slice(0, 3).map((d, i) => (
                <span key={d.issuerId}>
                  {i > 0 ? ", " : ""}
                  <button
                    onClick={() => navigate({ nodeId: d.issuerId, view: "trace" })}
                    className="font-mono font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                  >
                    {d.symbol}
                  </button>{" "}
                  <span className="text-muted">({d.sharePct.toFixed(0)}% of it)</span>
                </span>
              ))}
            </>
          ) : null}
          .
        </p>
      ) : null}

      {position.isFund && bands.length > 0 ? (
        <StageSection title="What it contains" hint="band width is the contribution to your book">
          <div className="flex items-stretch">
            <div className="flex w-24 flex-col justify-center pr-3">
              <div className="font-mono text-sm font-semibold text-foreground">{position.label}</div>
              <div className="text-caption text-muted">
                <Pct value={position.weightPct} /> of book
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <Flow
                direction="diverge"
                anchorLabel={position.label}
                headLabel={position.label}
                bands={bands}
                height={FLOW_HEIGHT}
                hoveredId={hovered}
                onHover={setHovered}
              />
            </div>
            <FlowLegend bands={bands} hoveredId={hovered} onHover={setHovered} height={FLOW_HEIGHT} />
          </div>
        </StageSection>
      ) : null}

      {position.isFund && fan.constituents.length > 0 ? (
        <StageSection title="Disclosed constituents" hint="click a name to trace it">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-label uppercase tracking-wider text-faint">
                <th className="py-1.5 text-left font-medium">Company</th>
                <th className="py-1.5 text-right font-medium">Of this line</th>
                <th className="w-40 py-1.5 text-left font-medium" />
                <th className="py-1.5 text-right font-medium">Of your book</th>
              </tr>
            </thead>
            <tbody>
              {fan.constituents.map((c) => (
                <tr
                  key={c.issuerId}
                  onMouseEnter={() => setHovered(c.issuerId)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => navigate({ nodeId: c.issuerId, view: "trace" })}
                  className={`cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-feedback)] ${
                    hovered === c.issuerId ? "bg-surface-2" : ""
                  }`}
                >
                  <td className="py-2">
                    <span className="font-mono font-medium text-foreground">{c.symbol}</span>
                    <span className="ml-2 text-caption text-muted">{c.name}</span>
                  </td>
                  <td className="py-2 text-right text-muted">
                    <Pct value={c.innerPct} />
                  </td>
                  <td className="py-2 pl-3 pr-3">
                    <MagnitudeBar value={c.innerPct} max={maxInner} tone="fund" height={4} />
                  </td>
                  <td className="py-2 text-right font-medium text-foreground">
                    <Pct value={c.bookPct} />
                  </td>
                </tr>
              ))}
              {fan.undisclosedPct > 0 ? (
                <tr className="border-b border-hairline">
                  <td className="py-2 text-muted">Undisclosed remainder</td>
                  <td className="py-2 text-right text-muted">
                    <Pct value={fan.undisclosedPct} />
                  </td>
                  <td className="py-2 pl-3 pr-3">
                    <div
                      className="h-1 w-full rounded-full"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(45deg, var(--faint) 0 2px, transparent 2px 5px)",
                        opacity: 0.5,
                      }}
                    />
                  </td>
                  <td className="py-2 text-right text-muted">
                    <Pct value={(position.weightPct * fan.undisclosedPct) / 100} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </StageSection>
      ) : null}

      {!position.isFund && fan.constituents.length === 1 ? (
        <p className="text-sm leading-relaxed text-foreground">
          This line is the company. Its effective exposure is larger than the{" "}
          <Pct value={position.weightPct} /> shown here whenever a fund you also hold contains it —{" "}
          <button
            onClick={() => navigate({ nodeId: fan.constituents[0].issuerId, view: "trace" })}
            className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            trace {fan.constituents[0].symbol}
          </button>{" "}
          to see every route.
        </p>
      ) : null}

      {fan.overlaps.length > 0 ? (
        <StageSection
          title={position.isFund ? "Also reached by" : "Other lines reaching this company"}
          hint="other lines routing to the same companies"
        >
          <div className="flex flex-wrap gap-2">
            {fan.overlaps.map((o) => (
              <button
                key={o.positionId}
                onClick={() =>
                  navigate({ nodeId: position.id, view: "overlap", secondaryId: o.positionId })
                }
                className="flex items-center gap-2.5 rounded-control border border-border bg-surface-2 px-3 py-2 transition-colors duration-[var(--duration-feedback)] hover:border-border-strong hover:bg-surface-3"
              >
                <span className="font-mono text-xs font-medium text-foreground">{o.label}</span>
                <span className="text-caption text-muted">
                  {o.sharedCount} shared · <Pct value={o.sharedBookPct} dp={1} />
                </span>
              </button>
            ))}
          </div>
        </StageSection>
      ) : null}

      {position.lookThrough?.sectorWeights?.length ? (
        <StageSection title="Sector distribution" hint="reported by the fund, not derived">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 sm:grid-cols-3">
            {position.lookThrough.sectorWeights.slice(0, 9).map((s) => (
              <div key={s.sector} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-muted">{s.sector}</span>
                <span className="font-mono text-xs text-foreground">{s.weightPercent.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </StageSection>
      ) : null}

      {position.isFund && !position.opaque ? <Caveat>{graph.coverage.basis}</Caveat> : null}
    </div>
  );
}

/* ────────────────────────── Two funds, one exposure ────────────────────────── */

export function OverlapView({ graph, index, selection, navigate }: ViewProps) {
  const overlap = selection.secondaryId
    ? fundOverlapView(graph, index, selection.nodeId, selection.secondaryId)
    : null;
  if (!overlap) return <Missing />;

  const max = Math.max(...overlap.shared.map((s) => Math.max(s.aPct, s.bPct)), 0.01);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Eyebrow>Shared holdings</Eyebrow>
        <p className="text-lg leading-snug text-foreground">
          <span className="font-mono font-semibold">{overlap.a.label}</span> and{" "}
          <span className="font-mono font-semibold">{overlap.b.label}</span> are{" "}
          <Pct value={overlap.combinedWeightPct} dp={1} className="font-semibold" /> of your book and route
          to <span className="font-semibold">{overlap.shared.length}</span> of the same companies.
        </p>
      </header>

      {overlap.shared.length === 0 ? (
        <p className="text-sm text-muted">
          No disclosed constituent appears in both lines. On the visible evidence these two are doing
          different jobs.
        </p>
      ) : (
        <StageSection
          title="Companies both lines reach"
          hint="contribution to your book, from each line"
          action={
            <span className="font-mono text-sm font-semibold text-foreground">
              <Pct value={overlap.sharedBookPct} dp={1} />
            </span>
          }
        >
          <div className="space-y-1">
            <div className="flex items-center gap-3 border-b border-hairline pb-1.5 text-label uppercase tracking-wider text-faint">
              <span className="w-20 shrink-0">Company</span>
              <span className="flex-1 text-right">{overlap.a.label}</span>
              <span className="w-32 shrink-0" />
              <span className="flex-1">{overlap.b.label}</span>
            </div>
            {overlap.shared.map((s) => (
              <button
                key={s.issuerId}
                onClick={() => navigate({ nodeId: s.issuerId, view: "trace" })}
                className="flex w-full items-center gap-3 rounded py-1 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
              >
                <span className="w-20 shrink-0 font-mono text-xs font-medium text-foreground">
                  {s.symbol}
                </span>
                {/* A mirrored pair of bars: the shape of the duplication is
                    legible before either number is read. */}
                <span className="flex flex-1 justify-end">
                  <span className="w-full max-w-[180px] scale-x-[-1]">
                    <MagnitudeBar value={s.aPct} max={max} tone="fund" height={5} />
                  </span>
                </span>
                <span className="w-32 shrink-0 text-center font-mono text-caption text-muted">
                  {s.aPct.toFixed(2)}% / {s.bPct.toFixed(2)}%
                </span>
                <span className="flex flex-1">
                  <span className="w-full max-w-[180px]">
                    <MagnitudeBar value={s.bPct} max={max} tone="fund" height={5} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </StageSection>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => navigate({ nodeId: overlap.a.id, view: "position" })}
          className="rounded-control border border-border bg-surface-2 px-3 py-2 text-xs transition-colors duration-[var(--duration-feedback)] hover:border-border-strong hover:bg-surface-3"
        >
          Open {overlap.a.label}
        </button>
        <button
          onClick={() => navigate({ nodeId: overlap.b.id, view: "position" })}
          className="rounded-control border border-border bg-surface-2 px-3 py-2 text-xs transition-colors duration-[var(--duration-feedback)] hover:border-border-strong hover:bg-surface-3"
        >
          Open {overlap.b.label}
        </button>
      </div>

      <Caveat>
        {graph.coverage.basis} Two funds can overlap in names neither one discloses, so the shared figure
        is a floor on the duplication, never a ceiling.
      </Caveat>
    </div>
  );
}

function Stat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-label uppercase tracking-wider text-faint">{label}</div>
      <div className={`text-sm font-medium text-foreground ${mono ? "font-mono tabular-nums" : ""}`}>
        {value}
      </div>
    </div>
  );
}
