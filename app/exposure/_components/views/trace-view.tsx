"use client";

/**
 * Exposure trace, and its reverse.
 *
 * TRACE answers "how am I exposed to this company?" — every route from the book
 * to one issuer, drawn as converging bands whose thickness is the contribution
 * and whose hover text is the arithmetic that produced it.
 *
 * BLAST RADIUS answers "if this moves, what else of mine is on the same side of
 * the trade?" — the same engine run backwards, with one hard rule: the three
 * kinds of answer are never summed into an unqualified number. Ownership is a
 * fact, a shared driver is a structural relationship, and a correlation is an
 * estimate about a window that has already passed. Each tranche states which it
 * is, everywhere it is drawn.
 */

import { useState } from "react";
import { blastRadius, traceIssuer } from "@/lib/exposure/query";
import { Flow, FlowLegend, type FlowBand } from "../flow";
import {
  BasisTag,
  BigPct,
  Caveat,
  Eyebrow,
  MagnitudeBar,
  Pct,
  StageSection,
  TONE_COLOR,
} from "../primitives";
import type { ViewProps } from "../nav";

const FLOW_HEIGHT = 236;

export function TraceView({ graph, index, selection, navigate }: ViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const trace = traceIssuer(graph, index, selection.nodeId);
  // A name with no node is a name with no exposure — which is the answer to the
  // question, not a failure to answer it. Reached whenever someone follows an
  // `?issuer=` link from Research for something they do not hold.
  if (!trace) {
    return (
      <NoExposure
        symbol={selection.nodeId.replace(/^issuer:/, "")}
        onBack={() => navigate({ nodeId: "portfolio", view: "overview" })}
      />
    );
  }

  const { issuer, routes } = trace;

  const bands: FlowBand[] = routes.map((r) => ({
    id: r.positionId,
    label: r.positionLabel,
    tone: r.kind === "direct" ? "direct" : "fund",
    value: r.bookPct,
    detail:
      r.kind === "direct"
        ? `${r.positionLabel} held directly — ${r.bookPct.toFixed(2)}% of book`
        : `${r.positionLabel} ${r.positionWeightPct.toFixed(2)}% of book × ${issuer.symbol} ${r.innerPct.toFixed(2)}% of ${r.positionLabel} = ${r.bookPct.toFixed(2)}% of book`,
    onClick: () => navigate({ nodeId: r.positionId, view: "position" }),
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="space-y-1.5">
          <Eyebrow>Effective exposure</Eyebrow>
          <div className="flex items-baseline gap-3">
            <BigPct value={issuer.effectivePct} dp={2} />
            <span className="text-sm text-muted">
              of book, through {routes.length} route{routes.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="flex gap-6 text-right">
          <Figure label="Stated" value={issuer.directPct} muted />
          <Figure label="Arrived through funds" value={issuer.indirectPct} />
          <Figure label="Not chosen" value={trace.hiddenPp} accent />
        </div>
      </header>

      {issuer.directPct > 0 && trace.hiddenPp > 0 ? (
        <p className="text-sm leading-relaxed text-foreground">
          You chose <Pct value={issuer.directPct} /> of {issuer.symbol}. You own{" "}
          <Pct value={issuer.effectivePct} className="font-semibold" /> — the difference arrives inside{" "}
          {routes.filter((r) => r.kind === "fund").length} fund
          {routes.filter((r) => r.kind === "fund").length === 1 ? "" : "s"} you bought for something else.
        </p>
      ) : issuer.directPct === 0 ? (
        <p className="text-sm leading-relaxed text-foreground">
          {issuer.name} is <Pct value={issuer.effectivePct} className="font-semibold" /> of your portfolio
          and has never appeared as a line item — all of it arrives through funds.
        </p>
      ) : null}

      <StageSection title="Routes" hint="band width is the contribution to your book">
        <div className="flex items-stretch gap-0">
          <FlowLegend bands={bands} hoveredId={hovered} onHover={setHovered} height={FLOW_HEIGHT} />
          <div className="min-w-0 flex-1">
            <Flow
              direction="converge"
              anchorLabel="Portfolio"
              headLabel={issuer.symbol}
              bands={bands}
              height={FLOW_HEIGHT}
              hoveredId={hovered}
              onHover={setHovered}
            />
          </div>
          <div className="flex w-24 flex-col justify-center pl-3">
            <div className="font-mono text-sm font-semibold text-foreground">{issuer.symbol}</div>
            <div className="text-caption text-muted">
              <Pct value={issuer.effectivePct} /> of book
            </div>
          </div>
        </div>
      </StageSection>

      <StageSection title="The arithmetic" hint="click a line to open it">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-label uppercase tracking-wider text-faint">
              <th className="py-1.5 text-left font-medium">Line</th>
              <th className="py-1.5 text-right font-medium">Weight</th>
              <th className="py-1.5 text-right font-medium">Inside it</th>
              <th className="py-1.5 text-right font-medium">Contributes</th>
              <th className="py-1.5 pl-3 text-left font-medium">Basis</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr
                key={r.positionId}
                onMouseEnter={() => setHovered(r.positionId)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => navigate({ nodeId: r.positionId, view: "position" })}
                className={`cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-feedback)] ${
                  hovered === r.positionId ? "bg-surface-2" : ""
                }`}
              >
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 w-[3px] rounded-full"
                      style={{ background: TONE_COLOR[r.kind === "direct" ? "direct" : "fund"] }}
                    />
                    <span className="font-mono font-medium text-foreground">{r.positionLabel}</span>
                    {r.kind === "direct" ? (
                      <span className="text-caption text-muted">held directly</span>
                    ) : null}
                    {r.nested.length > 0 ? (
                      <span className="text-caption text-faint">via {r.nested.join(" → ")}</span>
                    ) : null}
                  </span>
                </td>
                <td className="py-2 text-right text-muted">
                  {r.kind === "direct" ? "—" : <Pct value={r.positionWeightPct} />}
                </td>
                <td className="py-2 text-right text-muted">
                  {r.kind === "direct" ? "—" : <Pct value={r.innerPct} />}
                </td>
                <td className="py-2 text-right font-medium text-foreground">
                  <Pct value={r.bookPct} />
                </td>
                <td className="py-2 pl-3">
                  <BasisTag basis={r.basis} />
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-2 text-label uppercase tracking-wider text-faint">Effective</td>
              <td />
              <td />
              <td className="py-2 text-right font-mono font-semibold text-foreground">
                <Pct value={trace.totalPct} />
              </td>
              <td />
            </tr>
          </tbody>
        </table>
        <Caveat>{graph.coverage.basis}</Caveat>
      </StageSection>

      {trace.drivers.length > 0 ? (
        <StageSection title="What else moves this" hint="shared, evidence-backed exposure">
          <div className="flex flex-wrap gap-2">
            {trace.drivers.map((d) => (
              <button
                key={d.id}
                onClick={() => navigate({ nodeId: d.id, view: "driver" })}
                className="group flex items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2 text-left transition-colors duration-[var(--duration-feedback)] hover:border-border-strong hover:bg-surface-3"
              >
                <span className="text-sm font-medium text-foreground">{d.label}</span>
                <span className="font-mono text-caption text-muted">
                  <Pct value={d.bookPct} dp={1} /> · {d.issuerIds.length} names
                </span>
              </button>
            ))}
          </div>
        </StageSection>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── Blast radius ────────────────────────────── */

export function BlastView({ graph, index, selection, navigate }: ViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const blast = blastRadius(graph, index, selection.nodeId);
  if (!blast) return <Missing />;

  const CLAIM_TONE = {
    ownership: "direct",
    "shared exposure": "fund",
    estimated: "derived",
  } as const;

  const bands: FlowBand[] = blast.tranches.map((t) => ({
    id: t.kind,
    label: t.label,
    tone: CLAIM_TONE[t.claim],
    value: t.bookPct,
    detail: `${t.label} — ${t.bookPct.toFixed(2)}% of book (${t.claim})`,
  }));

  const maxMember = Math.max(
    ...blast.tranches.flatMap((t) => t.members.map((m) => m.bookPct)),
    0.01,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Eyebrow>If {blast.issuer.symbol} moves</Eyebrow>
        <p className="text-lg leading-snug text-foreground">
          <span className="font-mono font-semibold">{blast.totalPct.toFixed(1)}%</span> of your book is on
          the same side of the trade — but the three parts are three different kinds of claim.
        </p>
      </header>

      <div className="flex items-stretch">
        <div className="min-w-0 flex-1">
          <Flow
            direction="diverge"
            anchorLabel={blast.issuer.symbol}
            headLabel={blast.issuer.symbol}
            bands={bands}
            height={140}
            hoveredId={hovered}
            onHover={setHovered}
          />
        </div>
        <FlowLegend bands={bands} hoveredId={hovered} onHover={setHovered} height={140} />
      </div>

      {blast.tranches.map((t) => (
        <StageSection
          key={t.kind}
          title={t.label}
          hint={
            t.claim === "ownership"
              ? "you own this"
              : t.claim === "shared exposure"
                ? "structural — a named, checkable basis"
                : "estimated — a past window, not a promise"
          }
          action={
            <div className="flex items-center gap-2">
              <BasisTag basis={t.claim === "estimated" ? "estimated" : t.claim === "ownership" ? "observed" : "derived"} />
              <span className="font-mono text-sm font-semibold text-foreground">
                <Pct value={t.bookPct} dp={1} />
              </span>
            </div>
          }
        >
          <div className="space-y-1.5">
            {t.members.map((m) => (
              <button
                key={m.issuerId}
                onClick={() => navigate({ nodeId: m.issuerId, view: "trace" })}
                className="flex w-full items-center gap-3 rounded px-1 py-1 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
              >
                <span className="w-16 shrink-0 font-mono text-xs font-medium text-foreground">
                  {m.symbol}
                </span>
                <span className="w-24 shrink-0 font-mono text-xs text-muted">
                  <Pct value={m.bookPct} />
                </span>
                <span className="min-w-0 flex-1">
                  <MagnitudeBar value={m.bookPct} max={maxMember} tone={CLAIM_TONE[t.claim]} />
                </span>
                <span className="w-56 shrink-0 truncate text-caption text-muted">{m.reason}</span>
              </button>
            ))}
          </div>
        </StageSection>
      ))}

      {blast.tranches.every((t) => t.kind === "self") ? (
        <Caveat>
          Nothing else in the book shares a driver or a measured co-movement with {blast.issuer.symbol}.
          On the evidence available, this exposure stands alone.
        </Caveat>
      ) : null}

      <Caveat>
        Correlation is not ownership. The estimated tranche describes how these names moved over{" "}
        {graph.coMovement?.window ?? "the measured window"} — it is not a claim that they will move
        together next time, and it is never added to the ownership figure without this label.
      </Caveat>
    </div>
  );
}

/* ────────────────────────────── Shared ────────────────────────────── */

function Figure({
  label,
  value,
  muted = false,
  accent = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-label uppercase tracking-wider text-faint">{label}</div>
      <div
        className={`font-mono text-sm font-medium tabular-nums ${
          accent ? "text-chart-1" : muted ? "text-muted" : "text-foreground"
        }`}
      >
        {value.toFixed(2)}
        {accent ? "pp" : "%"}
      </div>
    </div>
  );
}

export function Missing() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-muted">
      That entity is no longer in the model.
    </div>
  );
}

/**
 * "You asked about a name you don't own." Stated plainly, with the two caveats
 * that make it a real answer rather than a shrug: look-through only sees each
 * fund's disclosed top ten, and tiny slivers are filtered out of the model.
 */
function NoExposure({ symbol, onBack }: { symbol: string; onBack: () => void }) {
  return (
    <div className="rounded-card border border-border bg-surface-2 p-6">
      <p className="text-sm leading-relaxed text-foreground">
        Your portfolio has no measurable exposure to{" "}
        <span className="font-mono font-semibold">{symbol}</span>.
      </p>
      <p className="mt-2 max-w-xl text-caption leading-relaxed text-muted">
        No direct position, and it does not appear in the disclosed top-ten holdings of any fund you
        hold. Both limits matter: a fund could hold it below its tenth-largest line, and exposures under
        0.1% of book are left out of this model as noise.
      </p>
      <button
        onClick={onBack}
        className="mt-4 rounded-control border border-border-strong bg-surface-3 px-3 py-2 text-caption font-medium text-foreground transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
      >
        See what you do own →
      </button>
    </div>
  );
}
