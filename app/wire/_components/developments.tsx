"use client";

import { useState } from "react";
import type { WireDevelopment } from "@/lib/wire/developments";
import type { TapeStory } from "@/lib/wire/tape";
import type { CausalEffect } from "@/lib/types";
import { corroborationLabel, isUncorroborated } from "@/lib/wire/labels";
import { relativeAge } from "@/lib/provenance";
import { Skeleton } from "@/app/_components/ui";

/**
 * Top Developments — the Wire's lead: the few stories that matter most right
 * now, each carrying its measured context (corroboration, live sector
 * reaction, your exposure) and its pipeline-analyzed causal chain.
 *
 * The lead development renders at editorial scale; the rest are compact
 * ledger rows. Everything shown is a join over what the pipeline measured —
 * this component adds no interpretation of its own.
 */

const STATUS_STYLE: Record<
  WireDevelopment["status"],
  { label: string; chip: string } | null
> = {
  breaking: { label: "Breaking", chip: "border-negative/40 bg-negative/10 text-negative" },
  "market-moving": { label: "Market-moving", chip: "border-brand/40 bg-brand/10 text-brand" },
  developing: { label: "Developing", chip: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  context: null, // an honest nothing — not everything deserves a kicker
};

const DIR = {
  bullish: { arrow: "↑", text: "text-positive" },
  bearish: { arrow: "↓", text: "text-negative" },
  neutral: { arrow: "→", text: "text-muted" },
};

function StatusChip({ status }: { status: WireDevelopment["status"] }) {
  const style = STATUS_STYLE[status];
  if (!style) return null;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-label font-semibold uppercase tracking-widest ${style.chip}`}
    >
      {style.label}
    </span>
  );
}

/** True when the reactions/exposure row would render anything at all. */
function hasContext(dev: WireDevelopment): boolean {
  return (
    dev.reactions.some((r) => r.changePercent != null) ||
    dev.heldTickers.length > 0 ||
    dev.watchedTickers.length > 0
  );
}

function MetaLine({
  dev,
  onShowEvidence,
}: {
  dev: WireDevelopment;
  onShowEvidence?: () => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-label uppercase tracking-wide text-muted/70">
      <span className="capitalize">{dev.event.category}</span>
      {dev.ageMs != null && (
        <>
          <span aria-hidden>·</span>
          <span title={new Date(dev.event.publishedAt).toLocaleString()}>
            {relativeAge(dev.ageMs)}
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onShowEvidence}
        disabled={!onShowEvidence}
        className={`${
          isUncorroborated(dev.sourceCount) ? "text-warning" : ""
        } ${onShowEvidence ? "transition-colors hover:text-accent hover:underline" : ""}`}
        title={onShowEvidence ? "Open source articles" : undefined}
      >
        {corroborationLabel(dev.sourceCount)}
      </button>
    </span>
  );
}

function ReactionChips({ dev }: { dev: WireDevelopment }) {
  const priced = dev.reactions.filter((r) => r.changePercent != null);
  if (priced.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {priced.map((r) => (
        <span
          key={r.sector}
          className={`rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-label ${
            (r.changePercent ?? 0) >= 0 ? "text-positive" : "text-negative"
          }`}
          title={`${r.sector} sector ETF, today's session`}
        >
          {r.sector} {(r.changePercent ?? 0) >= 0 ? "+" : ""}
          {(r.changePercent ?? 0).toFixed(1)}%
        </span>
      ))}
    </span>
  );
}

function ExposureLine({ dev }: { dev: WireDevelopment }) {
  if (dev.heldTickers.length === 0 && dev.watchedTickers.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-label uppercase tracking-wide">
      {dev.heldTickers.length > 0 && (
        <span className="rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-mono text-brand">
          You hold {dev.heldTickers.slice(0, 4).join(" · ")}
          {dev.heldTickers.length > 4 ? ` +${dev.heldTickers.length - 4}` : ""}
        </span>
      )}
      {dev.watchedTickers.length > 0 && (
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-muted">
          Watching {dev.watchedTickers.slice(0, 4).join(" · ")}
          {dev.watchedTickers.length > 4 ? ` +${dev.watchedTickers.length - 4}` : ""}
        </span>
      )}
    </span>
  );
}

/** The full pipeline-built chain, compact: one row per effect, order-tagged. */
function Chain({ chain }: { chain: CausalEffect[] }) {
  if (chain.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {chain.map((effect, i) => {
        const dir = DIR[effect.direction];
        return (
          <li key={i} className="flex items-start gap-2 text-xs leading-5">
            <span className="mt-0.5 shrink-0 font-mono text-label text-muted/50">
              {effect.order === 1 ? "1st" : "2nd"}
            </span>
            <span className={`shrink-0 font-bold ${dir.text}`}>{dir.arrow}</span>
            <span className="min-w-0 text-foreground/85">
              {effect.description}
              {effect.affectedSectors.length > 0 && (
                <span className="text-muted/70"> — {effect.affectedSectors.join(", ")}</span>
              )}
              {effect.affectedTickers.length > 0 && (
                <span className="font-mono text-label text-muted/60">
                  {" "}
                  ({effect.affectedTickers.slice(0, 5).join(", ")})
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function WhyLine({ dev }: { dev: WireDevelopment }) {
  if (!dev.whyItMatters) return null;
  const dir = DIR[dev.whyDirection ?? "neutral"];
  return (
    <p className="flex items-baseline gap-2 text-sm leading-5">
      <span className="shrink-0 text-label font-semibold uppercase tracking-widest text-muted/60">
        Why it matters
      </span>
      <span className="min-w-0">
        <span className={`font-bold ${dir.text}`}>{dir.arrow} </span>
        <span className="text-foreground/85">{dev.whyItMatters}</span>
      </span>
    </p>
  );
}

function LeadDevelopment({
  dev,
  onShowEvidence,
  highlighted,
}: {
  dev: WireDevelopment;
  onShowEvidence?: () => void;
  highlighted: boolean;
}) {
  const [chainOpen, setChainOpen] = useState(false);
  return (
    <article
      className={`flex flex-col gap-2.5 px-5 py-4 ${highlighted ? "bg-accent/5" : ""}`}
      aria-label="Lead development"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={dev.status} />
        <MetaLine dev={dev} onShowEvidence={onShowEvidence} />
      </div>
      <h3 className="text-xl font-semibold leading-snug tracking-tight text-foreground">
        {dev.event.headline}
      </h3>
      {dev.event.summary && dev.event.summary !== dev.event.headline && (
        <p className="max-w-3xl text-sm leading-6 text-muted">{dev.event.summary}</p>
      )}
      <WhyLine dev={dev} />
      {dev.secondOrder && (
        <p className="flex items-baseline gap-2 text-sm leading-5">
          <span className="shrink-0 text-label font-semibold uppercase tracking-widest text-muted/60">
            What follows
          </span>
          <span className="min-w-0 text-foreground/75">{dev.secondOrder}</span>
        </p>
      )}
      {hasContext(dev) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ReactionChips dev={dev} />
          <ExposureLine dev={dev} />
        </div>
      )}
      {dev.event.causalChain.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setChainOpen((v) => !v)}
            aria-expanded={chainOpen}
            className="self-start text-xs text-muted transition-colors hover:text-foreground"
          >
            {chainOpen ? "Hide chain −" : `Cause → effect chain (${dev.event.causalChain.length}) +`}
          </button>
          {chainOpen && <Chain chain={dev.event.causalChain} />}
        </div>
      )}
    </article>
  );
}

function DevelopmentRow({
  dev,
  onShowEvidence,
  highlighted,
}: {
  dev: WireDevelopment;
  onShowEvidence?: () => void;
  highlighted: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`flex flex-col gap-1.5 px-5 py-3 ${highlighted ? "bg-accent/5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={dev.status} />
            <MetaLine dev={dev} onShowEvidence={onShowEvidence} />
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-left text-sm font-medium leading-5 text-foreground transition-colors hover:text-accent"
            title={open ? "Collapse" : "Expand for the summary and causal chain"}
          >
            {dev.event.headline}
          </button>
          {!open && dev.whyItMatters && (
            <p className="line-clamp-1 text-xs leading-4 text-muted">
              <span className={`font-bold ${DIR[dev.whyDirection ?? "neutral"].text}`}>
                {DIR[dev.whyDirection ?? "neutral"].arrow}{" "}
              </span>
              {dev.whyItMatters}
            </p>
          )}
        </div>
        <span
          className="mt-0.5 shrink-0 select-none font-mono text-xs text-muted/50"
          aria-hidden
        >
          {open ? "−" : "+"}
        </span>
      </div>
      {hasContext(dev) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ReactionChips dev={dev} />
          <ExposureLine dev={dev} />
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-2 pt-1">
          {dev.event.summary && (
            <p className="max-w-3xl text-xs leading-5 text-muted">{dev.event.summary}</p>
          )}
          <WhyLine dev={dev} />
          <Chain chain={dev.event.causalChain} />
        </div>
      )}
    </li>
  );
}

export function Developments({
  developments,
  loading,
  firstRead,
  onShowEvidence,
  tracedEventIds,
}: {
  developments: WireDevelopment[];
  /** Scan still running and no events streamed yet. */
  loading: boolean;
  /** Clustered headlines shown while events are still being classified. */
  firstRead: TapeStory[] | null;
  onShowEvidence: (dev: WireDevelopment) => void;
  tracedEventIds?: Set<string>;
}) {
  if (developments.length === 0) {
    if (loading && firstRead && firstRead.length > 0) {
      // Honest interim: the raw clusters, labelled as such — not fake events.
      return (
        <div className="rounded-xl border border-border bg-surface">
          <p className="flex items-center gap-2 border-b border-border px-5 py-2.5 text-label font-medium uppercase tracking-widest text-muted/60">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
            </span>
            First read — clustering headlines into events…
          </p>
          <ul>
            {firstRead.map((story) => (
              <li
                key={story.id}
                className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">
                  {story.canonical.headline}
                </span>
                <span className="shrink-0 font-mono text-label uppercase tracking-wide text-muted/60">
                  {story.canonical.source}
                  {story.sourceCount > 1 ? ` +${story.sourceCount - 1}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (loading) {
      return <Skeleton height="h-48" radius="rounded-xl" className="border border-border" />;
    }
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
        No developments from this scan — the feed produced no classifiable events.
      </p>
    );
  }

  const [lead, ...rest] = developments;
  return (
    <div className="animate-fade-rise rounded-xl border border-border bg-surface">
      <LeadDevelopment
        dev={lead}
        onShowEvidence={() => onShowEvidence(lead)}
        highlighted={tracedEventIds?.has(lead.event.id) ?? false}
      />
      {rest.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {rest.map((dev) => (
            <DevelopmentRow
              key={dev.event.id}
              dev={dev}
              onShowEvidence={() => onShowEvidence(dev)}
              highlighted={tracedEventIds?.has(dev.event.id) ?? false}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
