"use client";

import { formatCurrency } from "@/lib/format";
import { relativeAge } from "@/lib/provenance";
import { diffAssumptions, type CaseAuthor, type ValuationEvent } from "@/lib/valuation/case";

/**
 * The case's own history, reconstructed from the append-only log.
 *
 * The user never names or manages a version — they edit, and a version appears.
 * What they get back is an audit trail: who changed what, when, and at what
 * price. The price matters more than it looks: it is what makes "you believed a
 * 23% margin of safety when you bought this" answerable later.
 */

const AUTHOR_LABEL: Record<CaseAuthor, string> = {
  reverse: "Seeded from market",
  ai: "AI refresh",
  user: "You",
  engine: "Quant engine",
  system: "System",
};

interface Props {
  events: ValuationEvent[];
  currency: string;
  /** Captured when the history was fetched — reading the clock during render is impure. */
  now: number;
}

export function CaseHistory({ events, currency, now }: Props) {
  if (events.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted">No history yet.</p>;
  }

  return (
    <ol className="flex flex-col">
      {events.map((event, i) => {
        // Events arrive newest-first, so the previous version is the next item.
        const previous = events[i + 1];
        const changes = previous ? diffAssumptions(previous.assumptions, event.assumptions) : [];
        const age = Date.parse(event.createdAt);

        return (
          <li key={event.id} className="flex gap-3 border-t border-border px-3 py-2 first:border-t-0">
            <span className="w-10 shrink-0 font-mono text-[11px] text-muted">v{event.version}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-medium">{AUTHOR_LABEL[event.author]}</span>
                <span className="text-[11px] text-muted">
                  {Number.isFinite(age) ? relativeAge(Math.max(0, now - age)) : ""}
                </span>
                {event.priceAt != null ? (
                  <span className="text-[11px] text-muted">
                    at {formatCurrency(event.priceAt, currency)}
                  </span>
                ) : null}
              </span>

              {changes.length > 0 ? (
                <span className="flex flex-wrap gap-x-3 text-[11px] text-muted">
                  {changes.map((c) => (
                    <span key={c.key}>
                      {c.label}{" "}
                      <span className="font-mono text-foreground/70">
                        {c.isRate ? `${c.from.toFixed(1)}% → ${c.to.toFixed(1)}%` : `${c.from.toPrecision(3)} → ${c.to.toPrecision(3)}`}
                      </span>
                    </span>
                  ))}
                </span>
              ) : previous ? (
                <span className="text-[11px] text-muted">No assumption changed.</span>
              ) : null}

              {event.note ? <span className="text-[11px] italic text-muted">{event.note}</span> : null}
            </span>

            <span className="shrink-0 text-right font-mono text-xs">
              {event.result?.fairValue != null ? formatCurrency(event.result.fairValue, currency) : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
