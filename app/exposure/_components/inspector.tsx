"use client";

/**
 * The onward-links panel — what makes this a web rather than a set of screens.
 *
 * Every view ends somewhere, and the difference between "a page I looked at"
 * and "a system I explored" is whether there was an obvious next move. So the
 * rail always answers three things about wherever the user is standing: what
 * this is, what can be done to it, and what is adjacent to it — every item
 * clickable, every item carrying the magnitude that justifies showing it.
 *
 * Events live here too, and only here. They are annotations on an issuer, never
 * nodes in the graph, and they are fetched lazily so they can never slow a
 * click down.
 */

import { useEffect, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { neighboursOf, type GraphIndex, type Neighbour } from "@/lib/exposure/query";
import type { ExposureGraph } from "@/lib/exposure/types";
import { Eyebrow, Pct, TONE_COLOR } from "./primitives";
import { VIEW_LABEL, type Navigate, type Selection, type StageView } from "./nav";

const KIND_TONE = { position: "fund", issuer: "direct", driver: "derived" } as const;

export function Inspector({
  graph,
  index,
  selection,
  navigate,
  compareWith,
  onPickCompare,
}: {
  graph: ExposureGraph;
  index: GraphIndex;
  selection: Selection;
  navigate: Navigate;
  compareWith: string | null;
  onPickCompare: (id: string | null) => void;
}) {
  const neighbours = neighboursOf(graph, index, selection.nodeId, 14);
  const issuer = index.issuerById.get(selection.nodeId);
  const position = index.positionById.get(selection.nodeId);
  const driver = index.driverById.get(selection.nodeId);

  const title = issuer?.symbol ?? position?.label ?? driver?.label ?? "Portfolio";
  const subtitle = issuer?.name ?? position?.name ?? (driver ? `${driver.issuerIds.length} companies` : "");

  const actions: { view: StageView; label: string; enabled: boolean }[] = issuer
    ? [
        { view: "trace", label: "Exposure trace", enabled: true },
        { view: "blast", label: "Blast radius", enabled: true },
      ]
    : position
      ? [{ view: "position", label: "Inside this line", enabled: true }]
      : driver
        ? [{ view: "driver", label: "Shared driver", enabled: true }]
        : [];

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto">
      <header className="space-y-1">
        <Eyebrow>{VIEW_LABEL[selection.view]}</Eyebrow>
        <div className="font-mono text-lg font-semibold leading-tight text-foreground">{title}</div>
        {subtitle ? <div className="text-caption leading-snug text-muted">{subtitle}</div> : null}
      </header>

      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <button
              key={a.view}
              onClick={() => navigate({ nodeId: selection.nodeId, view: a.view })}
              className={[
                "rounded-control border px-2.5 py-1.5 text-caption font-medium transition-colors duration-[var(--duration-feedback)]",
                selection.view === a.view
                  ? "border-border-strong bg-surface-3 text-foreground"
                  : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-foreground",
              ].join(" ")}
            >
              {a.label}
            </button>
          ))}
          {issuer ? (
            <button
              onClick={() => {
                if (compareWith && compareWith !== issuer.id) {
                  navigate({ nodeId: compareWith, view: "compare", secondaryId: issuer.id });
                  onPickCompare(null);
                } else {
                  onPickCompare(issuer.id);
                }
              }}
              className={[
                "rounded-control border px-2.5 py-1.5 text-caption font-medium transition-colors duration-[var(--duration-feedback)]",
                compareWith === issuer.id
                  ? "border-chart-1/50 bg-chart-1/10 text-chart-1"
                  : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-foreground",
              ].join(" ")}
            >
              {compareWith === issuer.id
                ? "Pick a second name…"
                : compareWith
                  ? `Compare with ${index.issuerById.get(compareWith)?.symbol ?? "…"}`
                  : "Compare with…"}
            </button>
          ) : null}
        </div>
      ) : null}

      {issuer ? (
        <section className="space-y-2">
          <Eyebrow>Position</Eyebrow>
          <dl className="space-y-1 text-caption">
            <Row label="Effective" value={<Pct value={issuer.effectivePct} />} strong />
            <Row label="Held directly" value={issuer.directPct > 0 ? <Pct value={issuer.directPct} /> : "none"} />
            <Row label="Through funds" value={<Pct value={issuer.indirectPct} />} />
            <Row label="Routes" value={String(issuer.routeCount)} />
            {issuer.industry ? <Row label="Industry" value={issuer.industry} /> : null}
            {issuer.sector ? <Row label="Sector" value={issuer.sector} /> : null}
          </dl>
          <a
            href={issuer.href}
            className="inline-block text-caption text-muted underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
          >
            Open {issuer.symbol} in Research →
          </a>
        </section>
      ) : null}

      {neighbours.length > 0 ? (
        <section className="space-y-2">
          <Eyebrow>Explore from here</Eyebrow>
          <div className="space-y-0.5">
            {neighbours.map((n) => (
              <NeighbourRow key={`${n.kind}-${n.id}`} n={n} navigate={navigate} />
            ))}
          </div>
        </section>
      ) : null}

      {issuer ? <EventsPanel key={issuer.symbol} symbol={issuer.symbol} /> : null}
    </div>
  );
}

function NeighbourRow({ n, navigate }: { n: Neighbour; navigate: Navigate }) {
  const view: StageView = n.kind === "issuer" ? "trace" : n.kind === "position" ? "position" : "driver";
  return (
    <button
      onClick={() => navigate({ nodeId: n.id, view })}
      className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
    >
      <span
        aria-hidden
        className="h-3 w-[3px] shrink-0 rounded-full"
        style={{ background: TONE_COLOR[KIND_TONE[n.kind]] }}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
        {n.label}
      </span>
      <span className="shrink-0 font-mono text-caption text-muted">
        <Pct value={n.bookPct} dp={2} />
      </span>
    </button>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono ${strong ? "font-semibold text-foreground" : "text-foreground"}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Recent stories naming this issuer. Lazily fetched, and deliberately inert:
 * headlines are listed, not interpreted. No causal chain is drawn from a story
 * to an exposure, because the data to support one does not exist.
 */
function EventsPanel({ symbol }: { symbol: string }) {
  // Mounted with key={symbol} by the caller, so a new issuer is a new component
  // rather than a reset. That is what lets the initial state BE "loading" and
  // the effect touch state only in its async callback — resetting on every
  // symbol change from inside the effect is a cascading render, and the reset
  // is exactly what remounting already does for free.
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch(`/api/exposure/events?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setItems(Array.isArray(json.items) ? json.items : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol]);

  if (!loading && (!items || items.length === 0)) return null;

  return (
    <section className="space-y-2">
      <Eyebrow>Recent events</Eyebrow>
      {loading ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {(items ?? []).map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block text-caption leading-snug text-muted transition-colors hover:text-foreground"
              >
                {item.headline}
                <span className="mt-0.5 block text-micro uppercase tracking-wider text-faint">
                  {item.source} ·{" "}
                  {new Date(item.publishedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-micro leading-relaxed text-faint">
        Stories the provider tagged with {symbol}. Listed, not interpreted — nothing here is connected
        to an exposure figure.
      </p>
    </section>
  );
}
