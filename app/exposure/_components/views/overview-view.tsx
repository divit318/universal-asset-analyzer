"use client";

/**
 * The landing state: a map you can start anywhere in.
 *
 * Three ranked lists — what you own, what moves several of those at once, and
 * what you actually bought — each row of which is an entry point into the rest
 * of the page. Ranked rather than arranged, because the first question is
 * always "what is biggest", and a sorted column answers that in one saccade
 * where a canvas asks the eye to search.
 *
 * The effective/stated split is drawn into every exposure row: the solid part
 * is the position you chose, the second segment is what arrived with something
 * else. On a real book that second segment is visible at a glance across the
 * whole column, which is the entire thesis of the feature stated without a
 * sentence.
 */

import { Eyebrow, Pct, StageSection, TONE_COLOR } from "../primitives";
import type { ViewProps } from "../nav";

export function OverviewView({ graph, navigate }: ViewProps) {
  const issuers = graph.issuers.slice(0, 14);
  const maxIssuer = Math.max(...issuers.map((i) => i.effectivePct), 0.01);
  const drivers = graph.drivers.slice(0, 8);
  const maxDriver = Math.max(...drivers.map((d) => d.bookPct), 0.01);
  const positions = graph.positions.slice(0, 18);

  return (
    <div className="space-y-8">
      <StageSection
        title="What you actually own"
        hint="effective exposure, every route counted"
      >
        <div className="space-y-0.5">
          <div className="flex items-center gap-3 border-b border-hairline pb-1.5 text-label uppercase tracking-wider text-faint">
            <span className="w-16 shrink-0">Company</span>
            <span className="w-16 shrink-0 text-right">Effective</span>
            <span className="flex-1" />
            <span className="w-16 shrink-0 text-right">Chosen</span>
            <span className="w-14 shrink-0 text-right">Routes</span>
          </div>
          {issuers.map((issuer) => {
            const directW = (issuer.directPct / maxIssuer) * 100;
            const indirectW = (issuer.indirectPct / maxIssuer) * 100;
            return (
              <button
                key={issuer.id}
                onClick={() => navigate({ nodeId: issuer.id, view: "trace" })}
                className="flex w-full items-center gap-3 rounded py-1.5 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
              >
                <span className="w-16 shrink-0 font-mono text-xs font-medium text-foreground">
                  {issuer.symbol}
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-xs font-medium text-foreground">
                  <Pct value={issuer.effectivePct} />
                </span>
                <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span
                    style={{ width: `${directW}%`, background: TONE_COLOR.direct }}
                    title={`${issuer.directPct.toFixed(2)}% held directly`}
                  />
                  <span
                    style={{ width: `${indirectW}%`, background: TONE_COLOR.fund }}
                    title={`${issuer.indirectPct.toFixed(2)}% through funds`}
                  />
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-xs text-muted">
                  {issuer.directPct > 0 ? <Pct value={issuer.directPct} /> : "—"}
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-xs text-muted">
                  {issuer.routeCount}
                </span>
              </button>
            );
          })}
        </div>
        {graph.issuers.length > issuers.length ? (
          <p className="text-caption text-faint">
            {graph.issuers.length - issuers.length} smaller exposures below this cut, each under{" "}
            <Pct value={issuers[issuers.length - 1]?.effectivePct ?? 0} dp={2} /> of book.
          </p>
        ) : null}
      </StageSection>

      <StageSection
        title="What moves several of them at once"
        hint={
          graph.driversState === "pending"
            ? "resolving industries and reference funds…"
            : graph.driversState === "unavailable"
              ? "unavailable"
              : "each has a named, checkable basis"
        }
      >
        {graph.driversState === "pending" ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : drivers.length === 0 ? (
          <p className="text-sm text-muted">
            No shared driver reached the threshold — no group of at least two companies with a named
            basis accounts for 2% or more of your book. On this evidence, your exposures are not
            clustering.
          </p>
        ) : (
          <div className="space-y-0.5">
            {drivers.map((d) => (
              <button
                key={d.id}
                onClick={() => navigate({ nodeId: d.id, view: "driver" })}
                className="flex w-full items-center gap-3 rounded py-1.5 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
              >
                <span className="w-44 shrink-0 truncate text-sm font-medium text-foreground">
                  {d.label}
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-xs font-medium text-foreground">
                  <Pct value={d.bookPct} dp={1} />
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(d.bookPct / maxDriver) * 100}%`, background: TONE_COLOR.fund }}
                  />
                </span>
                <span className="w-32 shrink-0 truncate text-right text-caption text-muted">
                  {d.issuerIds.length} names · {d.positionCount} line
                  {d.positionCount === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        )}
      </StageSection>

      <StageSection title="What you bought" hint="your ledger, largest first">
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 lg:grid-cols-3">
          {positions.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate({ nodeId: p.id, view: "position" })}
              className="flex items-center gap-2 rounded px-1 py-1.5 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
            >
              <span
                aria-hidden
                className="h-3 w-[3px] shrink-0 rounded-full"
                style={{ background: TONE_COLOR[p.isFund ? "fund" : "direct"] }}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
                {p.label}
              </span>
              {p.opaque ? (
                <span className="shrink-0 text-micro uppercase tracking-wider text-warning">opaque</span>
              ) : null}
              <span className="shrink-0 font-mono text-xs text-muted">
                <Pct value={p.weightPct} dp={1} />
              </span>
            </button>
          ))}
        </div>
      </StageSection>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-4">
        <Eyebrow>Colour</Eyebrow>
        <LegendKey tone="direct" label="held directly" />
        <LegendKey tone="fund" label="arrived through a fund" />
        <LegendKey tone="derived" label="measured relationship" />
        <span className="flex items-center gap-1.5 text-caption text-muted">
          <span
            aria-hidden
            className="h-2.5 w-4 rounded-sm"
            style={{
              backgroundImage: "repeating-linear-gradient(45deg, var(--faint) 0 2px, transparent 2px 5px)",
              opacity: 0.6,
            }}
          />
          undisclosed
        </span>
      </div>
    </div>
  );
}

function LegendKey({ tone, label }: { tone: "direct" | "fund" | "derived"; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-caption text-muted">
      <span aria-hidden className="h-2.5 w-4 rounded-sm" style={{ background: TONE_COLOR[tone] }} />
      {label}
    </span>
  );
}
