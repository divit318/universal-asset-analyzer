"use client";

import { useEffect, useState } from "react";
import type { TimelineEvent, TimelineEventDetail, WhatChangedResult } from "@/lib/types";
import { formatDate, formatPercent } from "@/lib/format";
import { categoryLabel } from "./category-label";
import { Drawer } from "@/app/_components/dialog";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted/60">{title}</h4>
      <div className="text-xs leading-5 text-muted">{children}</div>
    </div>
  );
}

function BulletList({ items, variant }: { items: string[]; variant: "bull" | "bear" }) {
  if (items.length === 0) return <p className="text-xs text-muted/60">None identified.</p>;
  const color = variant === "bull" ? "text-positive" : "text-negative";
  const dot = variant === "bull" ? "▲" : "▼";
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-xs leading-5">
          <span className={`mt-0.5 shrink-0 text-[10px] ${color}`}>{dot}</span>
          <span className="text-muted">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function EventDetailDrawer({ event, onClose }: { event: TimelineEvent; onClose: () => void }) {
  const [detail, setDetail] = useState<TimelineEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [whatChanged, setWhatChanged] = useState<WhatChangedResult | null>(null);
  const [whatChangedLoading, setWhatChangedLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDetail(null);
    setWhatChanged(null);
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch(`/api/timeline/detail?symbol=${encodeURIComponent(event.symbol)}&eventId=${encodeURIComponent(event.id)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setDetail(json.detail ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event.id, event.symbol]);

  async function loadWhatChanged() {
    setWhatChangedLoading(true);
    try {
      const res = await fetch(`/api/timeline/what-changed?symbol=${encodeURIComponent(event.symbol)}&eventId=${encodeURIComponent(event.id)}`);
      const json = await res.json();
      setWhatChanged(json.result ?? null);
    } catch {
      setWhatChanged(null);
    } finally {
      setWhatChangedLoading(false);
    }
  }

  return (
    <Drawer open onClose={onClose} label={`Event details: ${event.title}`} className="max-w-xl bg-background">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-background/95 p-4 backdrop-blur-sm">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted/60">
              {formatDate(event.timestamp)} · {categoryLabel(event.category)}
            </span>
            <h2 className="text-sm font-semibold leading-5 text-foreground">{event.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="15" y2="15" />
              <line x1="15" y1="3" x2="3" y2="15" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {loading ? (
            <div className="flex flex-col gap-2 py-8 text-center text-xs text-muted">
              <span className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
              Generating analysis…
            </div>
          ) : detail ? (
            <>
              <Section title="Executive Summary">{detail.executiveSummary}</Section>
              <Section title="Background">{detail.background}</Section>
              <Section title="Root Cause">{detail.rootCause}</Section>
              <Section title="Immediate Market Reaction">{detail.immediateReaction}</Section>
              <Section title="Long-Term Implications">{detail.longTermImplications}</Section>

              <div className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2">
                <div>
                  <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-positive">Bull Case</h4>
                  <BulletList items={detail.bullCase} variant="bull" />
                </div>
                <div>
                  <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-negative">Bear Case</h4>
                  <BulletList items={detail.bearCase} variant="bear" />
                </div>
              </div>

              <Section title="Historical Context">{detail.historicalContext}</Section>
              <Section title="Current Relevance">{detail.currentRelevance}</Section>

              {detail.supportingEvidence.length > 0 && (
                <Section title="Supporting Evidence">
                  <ul className="flex flex-col gap-1">
                    {detail.supportingEvidence.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <div className="flex items-center justify-between rounded-lg border border-accent/25 bg-accent/5 p-3">
                <span className="text-xs font-medium text-foreground">{detail.investmentTakeaway}</span>
                <span className="shrink-0 pl-3 text-xs font-semibold text-accent">{detail.confidence}%</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted">Unable to generate analysis for this event.</p>
          )}

          <div className="border-t border-border pt-4">
            {!whatChanged ? (
              <button
                type="button"
                onClick={loadWhatChanged}
                disabled={whatChangedLoading}
                className="w-full rounded-lg border border-border py-2 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
              >
                {whatChangedLoading ? "Loading…" : "What Changed Since Then? →"}
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-accent">What Changed Since Then?</h3>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted">Stock response since this event:</span>
                  <span className={`font-mono font-semibold ${(whatChanged.stockResponsePercent ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                    {formatPercent(whatChanged.stockResponsePercent)}
                  </span>
                </div>
                <Section title="Management Execution">{whatChanged.managementExecution}</Section>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-positive">Assumptions Validated</h4>
                    <BulletList items={whatChanged.assumptionsValidated} variant="bull" />
                  </div>
                  <div>
                    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-negative">Assumptions Failed</h4>
                    <BulletList items={whatChanged.assumptionsFailed} variant="bear" />
                  </div>
                </div>
                <Section title="Current Relevance">{whatChanged.currentRelevance}</Section>
                {whatChanged.subsequentEvents.length > 0 && (
                  <Section title={`Subsequent Events (${whatChanged.subsequentEvents.length})`}>
                    <ul className="flex flex-col gap-1">
                      {whatChanged.subsequentEvents.slice(0, 8).map((e) => (
                        <li key={e.id} className="flex gap-2">
                          <span className="shrink-0 text-muted/60">{formatDate(e.timestamp)}</span>
                          <span>{e.title}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}
              </div>
            )}
          </div>
        </div>
    </Drawer>
  );
}
