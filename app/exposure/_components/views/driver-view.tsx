"use client";

/**
 * A shared driver, expanded.
 *
 * Ranked bars, not a network. Once the question is "which of my names
 * participate in this, and how much of my book do they add up to?", a sorted
 * list with proportional bars answers it faster and more precisely than any
 * arrangement of circles — and unlike a graph it survives being read on a
 * phone. The relationships were already resolved by the engine; drawing them as
 * edges would only ask the user to re-derive what the sort order states.
 *
 * The basis block is the part that keeps this honest. A driver names its
 * substrates — an industry classification, a disclosed co-membership, a
 * measured correlation — with counts, sources and windows, so the reader can
 * decide how much weight the grouping deserves instead of taking it on trust.
 */

import { driverView } from "@/lib/exposure/query";
import { BasisTag, Caveat, Eyebrow, MagnitudeBar, Pct, StageSection, TONE_COLOR } from "../primitives";
import type { ViewProps } from "../nav";
import { Missing } from "./trace-view";

const BASIS_HEADING: Record<string, string> = {
  industry: "Industry classification",
  "co-membership": "Disclosed co-membership",
  "co-movement": "Measured co-movement",
};

export function DriverView({ graph, index, selection, navigate }: ViewProps) {
  const view = driverView(graph, index, selection.nodeId);
  if (!view) return <Missing />;

  const { driver, members, positions } = view;
  const maxMember = Math.max(...members.map((m) => m.issuer.effectivePct), 0.01);
  const maxPosition = Math.max(...positions.map((p) => p.bookPct), 0.01);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Eyebrow>Shared driver</Eyebrow>
          {driver.labelFromAi ? (
            <span className="rounded border border-border bg-surface-3 px-1.5 py-px text-micro uppercase tracking-wider text-muted">
              name written by AI
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-2xl font-semibold tracking-tight text-foreground">{driver.label}</span>
          <span className="font-mono text-lg text-foreground">
            <Pct value={driver.bookPct} dp={1} />
          </span>
          <span className="text-sm text-muted">
            of your book · {members.length} companies · {driver.positionCount} ledger line
            {driver.positionCount === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <StageSection title="Why this driver exists" hint="every basis is checkable">
        <div className="space-y-2">
          {driver.basis.map((b, i) => (
            <div
              key={`${b.kind}-${i}`}
              className="flex items-start gap-3 rounded-control border border-border bg-surface-2 px-3 py-2"
            >
              <BasisTag basis={b.kind === "co-movement" ? "estimated" : "observed"} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-sm font-medium text-foreground">{BASIS_HEADING[b.kind] ?? b.kind}</div>
                <div className="text-caption leading-relaxed text-muted">
                  {b.detail}
                  {b.via ? (
                    <>
                      {" — "}
                      <button
                        onClick={() => navigate({ nodeId: `position:${b.via}`, view: "position" })}
                        className="font-mono text-muted underline decoration-border underline-offset-2 hover:text-foreground"
                      >
                        {b.via}
                      </button>
                    </>
                  ) : null}
                  {b.strength != null ? ` · mean r = ${b.strength.toFixed(2)}` : ""}
                  {b.window ? ` over ${b.window}` : ""}
                  {` · covers ${b.n} name${b.n === 1 ? "" : "s"}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </StageSection>

      <StageSection title="Companies in this driver" hint="click a name to trace its routes">
        <div className="space-y-1">
          {members.map((m) => (
            <button
              key={m.issuer.id}
              onClick={() => navigate({ nodeId: m.issuer.id, view: "trace" })}
              className="flex w-full items-center gap-3 rounded px-1 py-1.5 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
            >
              <span className="w-16 shrink-0 font-mono text-xs font-medium text-foreground">
                {m.issuer.symbol}
              </span>
              <span className="w-20 shrink-0 font-mono text-xs text-foreground">
                <Pct value={m.issuer.effectivePct} />
              </span>
              <span className="min-w-0 flex-1">
                {/* Route mix inline: the bar itself shows how much of this name
                    was chosen versus how much arrived inside something else. */}
                <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  {m.routes.map((r) => (
                    <span
                      key={r.positionId}
                      title={`${r.positionLabel}: ${r.bookPct.toFixed(2)}%`}
                      style={{
                        width: `${(r.bookPct / maxMember) * 100}%`,
                        background: TONE_COLOR[r.kind === "direct" ? "direct" : "fund"],
                      }}
                    />
                  ))}
                </span>
              </span>
              <span className="w-40 shrink-0 truncate text-right text-caption text-muted">
                {m.routes.map((r) => r.positionLabel).join(", ")}
              </span>
            </button>
          ))}
        </div>
      </StageSection>

      <StageSection title="Lines carrying this driver" hint="where the exposure actually sits">
        <div className="space-y-1">
          {positions.map((p) => (
            <button
              key={p.positionId}
              onClick={() => navigate({ nodeId: p.positionId, view: "position" })}
              className="flex w-full items-center gap-3 rounded px-1 py-1 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
            >
              <span className="w-20 shrink-0 font-mono text-xs font-medium text-foreground">{p.label}</span>
              <span className="w-20 shrink-0 font-mono text-xs text-muted">
                <Pct value={p.bookPct} />
              </span>
              <span className="min-w-0 flex-1">
                <MagnitudeBar value={p.bookPct} max={maxPosition} tone="fund" height={5} />
              </span>
            </button>
          ))}
        </div>
      </StageSection>

      {driver.basis.some((b) => b.kind === "co-movement") ? (
        <Caveat>
          Measured co-movement is available only for lines you hold directly — the app has a return series
          for those and not for companies reached only inside a wrapper. Names in this driver that arrive
          purely through a fund were grouped by the other bases listed above, never by a correlation that
          could not be measured.
        </Caveat>
      ) : null}
    </div>
  );
}
