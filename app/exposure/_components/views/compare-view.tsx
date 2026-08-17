"use client";

/**
 * Two companies, one question: why are these connected?
 *
 * No canvas. The answer is a short, exact list — the lines they both arrive
 * through, the drivers they both participate in, and the correlation between
 * them when it is measurable — because that IS the answer, and drawing it as a
 * network would add motion without adding information.
 *
 * A negative result is rendered as a result. "These two share no route, no
 * driver and no measurable co-movement" is worth knowing: it means the
 * diversification between them is real, which is exactly the thing a
 * concentration-hunting tool should be able to confirm as well as deny.
 */

import { compareIssuers } from "@/lib/exposure/query";
import { BasisTag, Caveat, Eyebrow, Pct, StageSection, TONE_COLOR } from "../primitives";
import type { ViewProps } from "../nav";
import { Missing } from "./trace-view";

export function CompareView({ graph, index, selection, navigate }: ViewProps) {
  const cmp = selection.secondaryId
    ? compareIssuers(graph, index, selection.nodeId, selection.secondaryId)
    : null;
  if (!cmp) return <Missing />;

  const { a, b } = cmp;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Eyebrow>Relationship</Eyebrow>
        <div className="flex items-stretch gap-4">
          <Side issuer={a} onOpen={() => navigate({ nodeId: a.id, view: "trace" })} align="right" />
          <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-1">
            <div className="h-px w-full bg-border-strong" />
            <span className="font-mono text-caption text-muted">
              {cmp.combinedPct.toFixed(2)}%
            </span>
            <span className="text-micro uppercase tracking-wider text-faint">together</span>
          </div>
          <Side issuer={b} onOpen={() => navigate({ nodeId: b.id, view: "trace" })} align="left" />
        </div>
      </header>

      {!cmp.related && cmp.correlation == null ? (
        <div className="rounded-card border border-border bg-surface-2 p-5">
          <p className="text-sm leading-relaxed text-foreground">
            <span className="font-mono font-medium">{a.symbol}</span> and{" "}
            <span className="font-mono font-medium">{b.symbol}</span> share no ledger line, no
            evidence-backed driver, and no measurable co-movement.
          </p>
          <p className="mt-2 text-caption leading-relaxed text-muted">
            On the evidence available, these two are genuinely separate bets. That is a finding, not a
            gap — and the limits behind it are worth knowing: co-movement can only be measured for lines
            you hold directly, and drivers only exist where a classification, a disclosure or a
            correlation put these names together.
          </p>
        </div>
      ) : null}

      {cmp.sharedRoutes.length > 0 ? (
        <StageSection
          title="Lines that carry both"
          hint="the same wrapper delivering both companies"
          action={
            <span className="font-mono text-sm font-semibold text-foreground">
              <Pct value={cmp.sharedRoutePct} dp={2} />
            </span>
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-label uppercase tracking-wider text-faint">
                <th className="py-1.5 text-left font-medium">Line</th>
                <th className="py-1.5 text-right font-medium">→ {a.symbol}</th>
                <th className="py-1.5 text-right font-medium">→ {b.symbol}</th>
                <th className="py-1.5 text-right font-medium">Combined</th>
              </tr>
            </thead>
            <tbody>
              {cmp.sharedRoutes.map((r) => (
                <tr
                  key={r.positionId}
                  onClick={() => navigate({ nodeId: r.positionId, view: "position" })}
                  className="cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
                >
                  <td className="py-2 font-mono font-medium text-foreground">{r.label}</td>
                  <td className="py-2 text-right text-muted">
                    <Pct value={r.aPct} />
                  </td>
                  <td className="py-2 text-right text-muted">
                    <Pct value={r.bPct} />
                  </td>
                  <td className="py-2 text-right font-medium text-foreground">
                    <Pct value={r.aPct + r.bPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StageSection>
      ) : null}

      {cmp.sharedDrivers.length > 0 ? (
        <StageSection title="Drivers they both participate in">
          <div className="space-y-2">
            {cmp.sharedDrivers.map((d) => (
              <button
                key={d.id}
                onClick={() => navigate({ nodeId: d.id, view: "driver" })}
                className="flex w-full items-center justify-between gap-4 rounded-control border border-border bg-surface-2 px-3 py-2 text-left transition-colors duration-[var(--duration-feedback)] hover:border-border-strong hover:bg-surface-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{d.label}</div>
                  <div className="truncate text-caption text-muted">
                    {d.basis.map((x) => x.detail).join(" · ")}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm text-foreground">
                  <Pct value={d.bookPct} dp={1} />
                </span>
              </button>
            ))}
          </div>
        </StageSection>
      ) : null}

      {cmp.correlation ? (
        <StageSection
          title="Measured co-movement"
          action={<BasisTag basis="estimated" />}
        >
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xl font-semibold text-foreground">
              r = {cmp.correlation.r.toFixed(2)}
            </span>
            <span className="text-caption text-muted">
              daily returns over {cmp.correlation.window}
            </span>
          </div>
          <Caveat>
            A correlation describes a window that has already closed. It is evidence about how these two
            behaved, not a claim about how they will behave — and it is never counted as ownership
            anywhere on this page.
          </Caveat>
        </StageSection>
      ) : (
        <p className="text-caption text-muted">
          Correlation between these two could not be measured — it requires a return series for both, and
          the app has series only for lines held directly.
        </p>
      )}
    </div>
  );
}

function Side({
  issuer,
  onOpen,
  align,
}: {
  issuer: { symbol: string; name: string; effectivePct: number; directPct: number; heldDirectly: boolean };
  onOpen: () => void;
  align: "left" | "right";
}) {
  return (
    <button
      onClick={onOpen}
      className={`flex-1 rounded-card border border-border bg-surface-2 p-4 transition-colors duration-[var(--duration-feedback)] hover:border-border-strong hover:bg-surface-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <div className={`flex items-baseline gap-2 ${align === "right" ? "justify-end" : ""}`}>
        <span
          aria-hidden
          className="h-3 w-[3px] rounded-full"
          style={{ background: TONE_COLOR[issuer.heldDirectly ? "direct" : "fund"] }}
        />
        <span className="font-mono text-lg font-semibold text-foreground">{issuer.symbol}</span>
      </div>
      <div className="mt-0.5 truncate text-caption text-muted">{issuer.name}</div>
      <div className="mt-2 font-mono text-sm text-foreground">
        <Pct value={issuer.effectivePct} /> <span className="text-caption text-muted">effective</span>
      </div>
    </button>
  );
}
