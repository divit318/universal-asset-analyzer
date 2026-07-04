"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { CalendarEvent } from "@/app/api/calendar/route";
import { formatCompact } from "@/lib/format";

// ─── Style maps ────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<CalendarEvent["type"], { label: string; color: string; bg: string; border: string; dot: string }> = {
  earnings:    { label: "EARNINGS",  color: "text-blue-400",   bg: "bg-blue-400/10",   border: "border-blue-400/25",   dot: "bg-blue-400" },
  exDividend:  { label: "EX-DIV",   color: "text-accent",     bg: "bg-accent/10",     border: "border-accent/25",     dot: "bg-accent" },
  dividend:    { label: "DIVIDEND",  color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25", dot: "bg-emerald-400" },
  macro:       { label: "MACRO",    color: "text-warning",  bg: "bg-warning/10",  border: "border-warning/25",  dot: "bg-warning" },
};

const IMPACT_STYLES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  high:   { label: "HIGH",   color: "text-negative",   bg: "bg-negative/10",   border: "border-negative/25" },
  medium: { label: "MEDIUM", color: "text-warning", bg: "bg-warning/10", border: "border-warning/25" },
  low:    { label: "LOW",    color: "text-muted",     bg: "bg-surface-3",    border: "border-border" },
};

const COUNTRY_FLAG: Record<string, string> = {
  US: "🇺🇸", India: "🇮🇳", Eurozone: "🇪🇺", Japan: "🇯🇵", China: "🇨🇳", UK: "🇬🇧",
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function daysFromNow(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00Z");
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function daysLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d < 0) return `${Math.abs(d)}d ago`;
  return `In ${d} days`;
}

// ─── Quick-links config ────────────────────────────────────────────────────

function getLinks(ev: CalendarEvent): { label: string; href: string }[] {
  if (!ev.symbol) {
    return [{ label: "Scanner", href: `/scanner` }];
  }
  const sym = ev.symbol;
  const links: { label: string; href: string }[] = [
    { label: "Research", href: `/research?symbol=${sym}` },
    { label: "DCF", href: `/dcf?symbol=${sym}` },
    { label: "IC Report", href: `/ic-report?symbol=${sym}` },
    { label: "Compare", href: `/compare?symbols=${sym}` },
  ];
  if (ev.type === "earnings") {
    links.push({ label: "Scanner", href: `/scanner` });
  }
  return links;
}

// ─── Component ─────────────────────────────────────────────────────────────

interface EventDrawerProps {
  event: CalendarEvent | null;
  onClose: () => void;
}

export function EventDrawer({ event, onClose }: EventDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!event) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [event, onClose]);

  useEffect(() => {
    if (!event) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [event]);

  if (!event) return null;

  const ts = TYPE_STYLES[event.type];
  const days = daysFromNow(event.date);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog" aria-label={`Event details: ${event.name}`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl"
        style={{ animation: "dialog-enter 200ms ease-out" }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${ts.color} ${ts.bg} ${ts.border}`}>
                {ts.label}
              </span>
              {event.impact && (
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${IMPACT_STYLES[event.impact].color} ${IMPACT_STYLES[event.impact].bg} ${IMPACT_STYLES[event.impact].border}`}>
                  {IMPACT_STYLES[event.impact].label}
                </span>
              )}
              {event.isEstimate && (
                <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-muted/60 uppercase tracking-widest">
                  Est.
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold leading-tight">{event.name}</h2>
            {event.symbol && (
              <span className="font-mono text-sm font-bold text-accent">{event.symbol}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-md p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 px-6 py-5">
          {/* Date & timing */}
          <Section title="Date & Timing">
            <Row label="Date" value={formatDate(event.date)} />
            {event.dateEnd && event.dateEnd !== event.date && (
              <Row label="Through" value={formatDate(event.dateEnd)} />
            )}
            <Row
              label="When"
              value={
                <span className={days <= 0 ? "text-muted" : days <= 3 ? "text-warning font-semibold" : "text-foreground"}>
                  {daysLabel(days)}
                </span>
              }
            />
            {event.timing && (
              <Row label="Time" value={event.timing === "BMO" ? "Before Market Open" : event.timing === "AMC" ? "After Market Close" : "Time Not Supplied"} />
            )}
          </Section>

          {/* Earnings details */}
          {event.type === "earnings" && (
            <Section title="Earnings Details">
              {event.quarter && <Row label="Quarter" value={event.quarter} />}
              <Row
                label="EPS Estimate"
                value={event.epsEstimate != null ? `$${event.epsEstimate.toFixed(2)}` : "—"}
              />
              <Row
                label="Revenue Estimate"
                value={event.revenueEstimate != null ? `$${formatCompact(event.revenueEstimate)}` : "—"}
              />
              <Row label="Date Status" value={event.isEstimate ? "Estimated window" : "Confirmed date"} />
              {event.dateEnd && event.dateEnd !== event.date && (
                <p className="mt-1 text-xs text-muted">
                  Earnings are expected to be reported between {new Date(event.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} and {new Date(event.dateEnd + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.
                </p>
              )}
            </Section>
          )}

          {/* Dividend details */}
          {(event.type === "exDividend" || event.type === "dividend") && (
            <Section title="Dividend Details">
              <Row
                label="Dividend (Quarterly)"
                value={event.dividendAmount != null ? `$${event.dividendAmount.toFixed(4)}` : "—"}
              />
              <Row
                label="Annual Yield"
                value={event.dividendYield != null ? `${event.dividendYield.toFixed(2)}%` : "—"}
              />
              {event.paymentDate && (
                <Row label="Payment Date" value={formatDate(event.paymentDate)} />
              )}
              {event.type === "exDividend" && (
                <p className="mt-1 text-xs text-muted">
                  You must hold shares before the ex-dividend date to receive this dividend.
                </p>
              )}
            </Section>
          )}

          {/* Macro details */}
          {event.type === "macro" && (
            <>
              <Section title="Event Details">
                {event.country && (
                  <Row
                    label="Country / Region"
                    value={
                      <span className="flex items-center gap-1.5">
                        <span>{COUNTRY_FLAG[event.country] ?? "🌐"}</span>
                        <span>{event.country}</span>
                      </span>
                    }
                  />
                )}
                {event.category && <Row label="Category" value={event.category} />}
                {event.region && <Row label="Region" value={event.region} />}
              </Section>

              {(event.previous || event.forecast || event.actual) && (
                <Section title="Estimates">
                  {event.previous && <Row label="Previous" value={event.previous} />}
                  {event.forecast && <Row label="Consensus Forecast" value={event.forecast} />}
                  {event.actual && (
                    <Row
                      label="Actual"
                      value={<span className="font-semibold text-accent">{event.actual}</span>}
                    />
                  )}
                </Section>
              )}

              {event.description && (
                <Section title="Description">
                  <p className="text-sm leading-6 text-muted">{event.description}</p>
                </Section>
              )}
            </>
          )}

          {/* Source badge */}
          {event.source !== "macro" && (
            <Section title="Coverage">
              <Row
                label="In"
                value={
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${event.source === "portfolio" ? "bg-accent/10 text-accent border border-accent/20" : "bg-blue-400/10 text-blue-400 border border-blue-400/20"}`}>
                    {event.source === "portfolio" ? "Portfolio" : "Watchlist"}
                  </span>
                }
              />
            </Section>
          )}

          {/* Integration links */}
          <div className="flex flex-col gap-2 border-t border-border pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">
              Quick Access
            </p>
            <div className="grid grid-cols-2 gap-2">
              {getLinks(event).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onClose}
                  className="group flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs font-medium text-muted transition-all hover:border-accent/30 hover:bg-surface-3 hover:text-foreground"
                >
                  {link.label}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40 group-hover:opacity-80">
                    <path d="M1 9L9 1M9 1H4M9 1v5" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Small layout helpers ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">{title}</p>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span className="text-right text-xs text-foreground">{value}</span>
    </div>
  );
}
