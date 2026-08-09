"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CalendarEvent, CalendarResponse } from "@/app/api/calendar/route";
import { formatCompactCurrency, formatPerShare } from "@/lib/format";
import { EventDrawer } from "./_components/event-drawer";
import { PageShell, Skeleton } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";
import { AiBadge } from "@/app/_components/ai-badge";
import { Markdown } from "@/app/_components/markdown";

// ─── Style constants ────────────────────────────────────────────────────────

const TYPE_STYLES: Record<CalendarEvent["type"], {
  label: string; color: string; bg: string; border: string; dot: string;
}> = {
  earnings:   { label: "Earnings",  color: "text-chart-2",    bg: "bg-chart-2/10",   border: "border-chart-2/25",   dot: "bg-chart-2" },
  exDividend: { label: "Ex-Div",    color: "text-brand",      bg: "bg-brand/10",     border: "border-brand/25",     dot: "bg-brand" },
  dividend:   { label: "Dividend",  color: "text-emerald-400 light:text-emerald-700", bg: "bg-emerald-400/10", border: "border-emerald-400/25", dot: "bg-emerald-400 light:bg-emerald-600" },
  macro:      { label: "Macro",     color: "text-warning",   bg: "bg-warning/10",  border: "border-warning/25",  dot: "bg-warning" },
};

const IMPACT_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  high:   { color: "text-negative",   bg: "bg-negative/10",   border: "border-negative/25" },
  medium: { color: "text-warning", bg: "bg-warning/10", border: "border-warning/25" },
  low:    { color: "text-muted",     bg: "bg-surface-3",    border: "border-border" },
};

const COUNTRY_FLAG: Record<string, string> = {
  US: "🇺🇸", India: "🇮🇳", Eurozone: "🇪🇺", Japan: "🇯🇵", China: "🇨🇳", UK: "🇬🇧",
};

const EVENT_TYPES: Array<{ key: string; label: string }> = [
  { key: "all",        label: "All Events" },
  { key: "earnings",   label: "Earnings" },
  { key: "exDividend", label: "Ex-Dividend" },
  { key: "macro",      label: "Macro" },
];

const IMPACT_OPTS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All Impact" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

const REGION_OPTS: Array<{ key: string; label: string }> = [
  { key: "all",    label: "All Regions" },
  { key: "US",     label: "🇺🇸 US" },
  { key: "India",  label: "🇮🇳 India" },
  { key: "Europe", label: "🇪🇺 Europe" },
  { key: "Asia",   label: "🌏 Asia" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysFromNow(iso: string): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00Z");
  return Math.round((target.getTime() - t.getTime()) / 86_400_000);
}

function daysLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d < 0) return `${Math.abs(d)}d ago`;
  return `${d}d`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatWeekday(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

type TimeBucket = "past" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "later";

function timeBucket(iso: string): TimeBucket {
  const d = daysFromNow(iso);
  if (d < 0) return "past";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d <= 7) return "thisWeek";
  if (d <= 14) return "nextWeek";
  return "later";
}

const BUCKET_LABELS: Record<TimeBucket, string> = {
  past:      "Recently Completed",
  today:     "Today",
  tomorrow:  "Tomorrow",
  thisWeek:  "This Week",
  nextWeek:  "Next Week",
  later:     "Later",
};

const BUCKET_ORDER: TimeBucket[] = ["today", "tomorrow", "thisWeek", "nextWeek", "later", "past"];

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted/70">{children}</span>
      {count != null && (
        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-label font-semibold text-muted">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function TypeBadge({ type }: { type: CalendarEvent["type"] }) {
  const ts = TYPE_STYLES[type];
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-micro font-bold uppercase tracking-widest ${ts.color} ${ts.bg} ${ts.border}`}>
      {ts.label}
    </span>
  );
}

function ImpactBadge({ impact }: { impact?: string }) {
  if (!impact) return null;
  const is = IMPACT_STYLES[impact];
  const dots = impact === "high" ? "●●●" : impact === "medium" ? "●●○" : "●○○";
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-micro font-bold uppercase tracking-widest ${is.color} ${is.bg} ${is.border}`}>
      {dots}
    </span>
  );
}

// ─── Earnings event row ──────────────────────────────────────────────────────

function EarningsRow({ ev, onClick, isPortfolio, isWatchlist }: {
  ev: CalendarEvent; onClick: () => void;
  isPortfolio: boolean; isWatchlist: boolean;
}) {
  const days = daysFromNow(ev.date);
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-xl border border-border bg-surface px-4 py-4 text-left transition-all hover:border-chart-2/30 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {/* Top row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type="earnings" />
            {isPortfolio && (
              <span className="rounded border border-brand/20 bg-brand/8 px-1.5 py-0.5 text-micro font-bold uppercase tracking-widest text-brand">
                Portfolio
              </span>
            )}
            {!isPortfolio && isWatchlist && (
              <span className="rounded border border-chart-2/20 bg-chart-2/8 px-1.5 py-0.5 text-micro font-bold uppercase tracking-widest text-chart-2">
                Watchlist
              </span>
            )}
            {ev.isEstimate && (
              <span className="text-micro text-muted/50">Est.</span>
            )}
          </div>

          {/* Name row */}
          <div className="flex items-center gap-2">
            {ev.symbol && (
              <span className="font-mono text-sm font-bold text-chart-2">{ev.symbol}</span>
            )}
            <span className="truncate text-sm text-foreground">{ev.name}</span>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            {ev.quarter && <span>{ev.quarter}</span>}
            {/* Estimates render in their OWN reporting currency. A hardcoded "$"
                turned SK hynix's ₩84.1T revenue estimate into "$84.12T". */}
            {ev.epsEstimate != null && (
              <span>EPS est. <span className="text-foreground">{formatPerShare(ev.epsEstimate, ev.estimateCurrency)}</span></span>
            )}
            {ev.revenueEstimate != null && (
              <span>Rev. est. <span className="text-foreground">{formatCompactCurrency(ev.revenueEstimate, ev.estimateCurrency)}</span></span>
            )}
          </div>
        </div>

        {/* Date column */}
        <div className="shrink-0 text-right">
          <div className="font-mono text-xs font-semibold text-foreground">{formatShortDate(ev.date)}</div>
          <div className={`text-label font-medium ${days <= 3 && days >= 0 ? "text-warning" : "text-muted"}`}>
            {daysLabel(days)}
          </div>
        </div>
      </div>

      {/* Quick links — revealed on hover */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border/40 pt-2.5 text-caption">
        {ev.symbol && (
          <>
            <Link href={`/research?symbol=${ev.symbol}`} className="text-muted transition-colors hover:text-brand" onClick={(e) => e.stopPropagation()}>Research ↗</Link>
            <Link href={`/valuation?symbol=${ev.symbol}`} className="text-muted transition-colors hover:text-brand" onClick={(e) => e.stopPropagation()}>DCF ↗</Link>
            <Link href={`/ic-report?symbol=${ev.symbol}`} className="text-muted transition-colors hover:text-brand" onClick={(e) => e.stopPropagation()}>IC Report ↗</Link>
            <Link href={`/compare?symbols=${ev.symbol}`} className="text-muted transition-colors hover:text-brand" onClick={(e) => e.stopPropagation()}>Compare ↗</Link>
          </>
        )}
      </div>
    </button>
  );
}

// ─── Dividend event row ──────────────────────────────────────────────────────

function DividendRow({ ev, onClick, isPortfolio, isWatchlist }: {
  ev: CalendarEvent; onClick: () => void;
  isPortfolio: boolean; isWatchlist: boolean;
}) {
  const days = daysFromNow(ev.date);
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-xl border border-border bg-surface px-4 py-4 text-left transition-all hover:border-brand/30 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={ev.type} />
            {isPortfolio && (
              <span className="rounded border border-brand/20 bg-brand/8 px-1.5 py-0.5 text-micro font-bold uppercase tracking-widest text-brand">Portfolio</span>
            )}
            {!isPortfolio && isWatchlist && (
              <span className="rounded border border-chart-2/20 bg-chart-2/8 px-1.5 py-0.5 text-micro font-bold uppercase tracking-widest text-chart-2">Watchlist</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ev.symbol && <span className="font-mono text-sm font-bold text-brand">{ev.symbol}</span>}
            <span className="truncate text-sm text-foreground">{ev.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            {ev.dividendAmount != null && (
              <span>Div. <span className="text-foreground">${ev.dividendAmount.toFixed(4)}</span></span>
            )}
            {ev.dividendYield != null && (
              <span>Yield <span className="text-foreground">{ev.dividendYield.toFixed(2)}%</span></span>
            )}
            {ev.paymentDate && (
              <span>Pay date <span className="text-foreground">{formatShortDate(ev.paymentDate)}</span></span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-xs font-semibold text-foreground">{formatShortDate(ev.date)}</div>
          <div className={`text-label font-medium ${days <= 3 && days >= 0 ? "text-warning" : "text-muted"}`}>{daysLabel(days)}</div>
        </div>
      </div>
      {ev.symbol && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border/40 pt-2.5 text-caption">
          <Link href={`/research?symbol=${ev.symbol}`} className="text-muted transition-colors hover:text-brand" onClick={(e) => e.stopPropagation()}>Research ↗</Link>
          <Link href={`/compare?symbols=${ev.symbol}`} className="text-muted transition-colors hover:text-brand" onClick={(e) => e.stopPropagation()}>Compare ↗</Link>
        </div>
      )}
    </button>
  );
}

// ─── Macro event row ─────────────────────────────────────────────────────────

function MacroRow({ ev, onClick }: { ev: CalendarEvent; onClick: () => void }) {
  const days = daysFromNow(ev.date);
  const is = ev.impact ? IMPACT_STYLES[ev.impact] : null;
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-xl border border-border bg-surface px-4 py-4 text-left transition-all hover:border-warning/30 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type="macro" />
            {ev.impact && <ImpactBadge impact={ev.impact} />}
            {ev.category && (
              <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-micro text-muted uppercase tracking-widest">
                {ev.category}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ev.country && <span>{COUNTRY_FLAG[ev.country] ?? "🌐"}</span>}
            <span className="text-sm font-medium text-foreground">{ev.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            {ev.previous && <span>Prev <span className="text-foreground">{ev.previous}</span></span>}
            {ev.forecast && <span>Fcst <span className={`font-medium ${is?.color ?? "text-foreground"}`}>{ev.forecast}</span></span>}
            {ev.actual && <span>Actual <span className="font-semibold text-brand">{ev.actual}</span></span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-xs font-semibold text-foreground">{formatShortDate(ev.date)}</div>
          <div className={`text-label font-medium ${days <= 3 && days >= 0 ? "text-warning" : "text-muted"}`}>{daysLabel(days)}</div>
        </div>
      </div>
    </button>
  );
}

// ─── Week grid ───────────────────────────────────────────────────────────────

function WeekGrid({ events, onSelect }: {
  events: CalendarEvent[];
  onSelect: (ev: CalendarEvent) => void;
}) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(i));

  function eventsOnDay(iso: string): CalendarEvent[] {
    return events.filter((e) => e.date === iso || (e.dateEnd && e.date <= iso && e.dateEnd >= iso));
  }

  return (
    <div className="grid grid-cols-7 gap-px rounded-xl border border-border bg-border overflow-hidden">
      {days.slice(0, 14).map((day, i) => {
        const dayEvents = eventsOnDay(day);
        const isToday = day === today();
        return (
          <div
            key={day}
            className={`flex flex-col gap-1 bg-surface p-2 ${i >= 7 ? "opacity-70" : ""}`}
          >
            <div className={`mb-1 text-center ${isToday ? "" : ""}`}>
              <div className={`text-micro font-semibold uppercase tracking-widest ${isToday ? "text-brand" : "text-muted/60"}`}>
                {formatWeekday(day)}
              </div>
              <div className={`font-mono text-sm font-bold ${isToday ? "text-brand" : "text-muted"}`}>
                {new Date(day + "T00:00:00Z").getDate()}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {dayEvents.slice(0, 4).map((ev) => {
                const ts = TYPE_STYLES[ev.type];
                return (
                  <button
                    key={ev.id}
                    onClick={() => onSelect(ev)}
                    className={`w-full truncate rounded px-1 py-0.5 text-left text-micro font-semibold transition-opacity hover:opacity-80 ${ts.color} ${ts.bg}`}
                    title={ev.symbol ? `${ev.symbol} — ${ev.name}` : ev.name}
                  >
                    {ev.symbol ?? ev.name.slice(0, 10)}
                  </button>
                );
              })}
              {dayEvents.length > 4 && (
                <span className="px-1 text-micro text-muted">+{dayEvents.length - 4} more</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Summary strip ──────────────────────────────────────────────────────────

function SummaryStrip({ events, portfolioSymbols, watchlistSymbols }: {
  events: CalendarEvent[];
  portfolioSymbols: string[];
  watchlistSymbols: string[];
}) {
  const todayStr = today();
  const weekEnd = addDays(7);

  const thisWeek = events.filter((e) => e.date >= todayStr && e.date <= weekEnd);
  const portfolioEvents = events.filter((e) => e.symbol && portfolioSymbols.includes(e.symbol) && e.date >= todayStr);
  const watchlistEvents = events.filter((e) => e.symbol && watchlistSymbols.includes(e.symbol) && e.date >= todayStr);
  const highImpact = events.filter((e) => e.impact === "high" && e.date >= todayStr);

  const nextEarnings = events.find((e) => e.type === "earnings" && e.date >= todayStr);
  const nextMacro = events.find((e) => e.type === "macro" && e.impact === "high" && e.date >= todayStr);
  const nextExDiv = events.find((e) => e.type === "exDividend" && e.date >= todayStr);

  const stats: Array<{ label: string; value: React.ReactNode; sub?: string }> = [
    { label: "This Week", value: thisWeek.length, sub: "upcoming events" },
    { label: "Portfolio", value: portfolioEvents.length, sub: "events" },
    { label: "Watchlist", value: watchlistEvents.length, sub: "events" },
    { label: "High Impact", value: highImpact.length, sub: "events ahead" },
  ];

  if (nextEarnings) {
    const d = daysFromNow(nextEarnings.date);
    stats.push({
      label: "Next Earnings",
      value: <span className="text-chart-2">{nextEarnings.symbol ?? nextEarnings.name.slice(0, 8)}</span>,
      sub: daysLabel(d),
    });
  }
  if (nextExDiv) {
    const d = daysFromNow(nextExDiv.date);
    stats.push({
      label: "Next Ex-Div",
      value: <span className="text-brand">{nextExDiv.symbol ?? nextExDiv.name.slice(0, 8)}</span>,
      sub: daysLabel(d),
    });
  }
  if (nextMacro) {
    const d = daysFromNow(nextMacro.date);
    stats.push({
      label: "Next Macro",
      value: <span className="text-warning">{nextMacro.name.split(" ").slice(0, 3).join(" ")}</span>,
      sub: daysLabel(d),
    });
  }

  return (
    <div className="flex flex-wrap gap-px rounded-xl border border-border bg-border overflow-hidden">
      {/* `grow` so the tiles fill each row edge-to-edge — without it the strip
          ended in a wide dead slab of the container's bg-border. */}
      {stats.map((s, i) => (
        <div key={i} className="flex min-w-[110px] grow flex-col gap-0.5 bg-surface px-5 py-3">
          <span className="text-label font-semibold uppercase tracking-widest text-muted/60">{s.label}</span>
          <span className="font-mono text-lg font-bold">{s.value}</span>
          {s.sub && <span className="text-label text-muted">{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── AI Weekly Brief ─────────────────────────────────────────────────────────

function AiBriefSection({ events, autoGenerate }: { events: CalendarEvent[]; autoGenerate?: boolean }) {
  const [expanded, setExpanded] = useState(!!autoGenerate);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggered = useRef(false);

  async function generate() {
    setLoading(true);
    setError(null);
    const todayStr = today();
    const weekEnd = addDays(7);
    const weekEvents = events.filter((e) => e.date >= todayStr && e.date <= weekEnd);
    try {
      const res = await fetch("/api/calendar/ai-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: weekEvents, weekStart: todayStr, weekEnd }),
      });
      const json = (await res.json()) as { brief?: string; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Brief generation failed");
      setBrief(json.brief ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate brief");
    } finally {
      setLoading(false);
    }
  }

  // Auto-generate when events are available
  useEffect(() => {
    if (!autoGenerate || triggered.current || events.length === 0) return;
    triggered.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, events.length]);

  return (
    <div className="rounded-xl border border-warning/20 bg-warning/5">
      <button
        onClick={() => {
          setExpanded((v) => !v);
          if (!expanded && !brief && !loading) void generate();
        }}
        className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-warning/5"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-warning/20 bg-warning/10">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warning">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">AI Weekly Market Brief</p>
              <AiBadge className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-warning" />
              {loading && <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />}
            </div>
            <p className="text-xs text-muted">AI-written summary of this week&apos;s most important events</p>
          </div>
        </div>
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          className={`shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M2 4l5 5 5-5" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-warning/20 px-5 py-4">
          {loading && (
            <div className="flex items-center gap-3 py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-amber-400" />
              <span className="text-sm text-muted">Generating weekly brief — typically a few seconds…</span>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-negative/30 bg-negative/8 px-4 py-3 text-sm text-negative">
              {error.includes("key") || error.includes("provider") || error.includes("fetch") || error.includes("ECONNREFUSED")
                ? `No AI provider is reachable, so briefs cannot be generated. ${AI_RECOVERY_HINT}`
                : error}
            </div>
          )}
          {brief && (
            // Rendered, not echoed: the model emits markdown emphasis, and a
            // bare <p> printed the literal `**…**` asterisks (2026-08-10 audit).
            <div className="text-sm leading-6 text-foreground/90">
              <Markdown content={brief} />
            </div>
          )}
          {brief && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void generate()}
                className="text-xs text-muted transition-colors hover:text-brand"
              >
                ↻ Regenerate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

type View = "timeline" | "week";
type FilterType = "all" | "earnings" | "exDividend" | "macro";

export default function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("timeline");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [impactFilter, setImpactFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    document.title = "Calendar · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar");
      const json = await res.json() as CalendarResponse;
      if (!res.ok) throw new Error((json as unknown as { error?: string }).error ?? "Failed to load");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const events = data?.events ?? [];
  const portfolioSymbols = data?.portfolioSymbols ?? [];
  const watchlistSymbols = data?.watchlistSymbols ?? [];

  // Apply filters
  const filtered = events.filter((ev) => {
    if (typeFilter !== "all" && ev.type !== typeFilter) return false;
    if (impactFilter !== "all" && ev.impact !== impactFilter) return false;
    if (regionFilter !== "all" && ev.region !== regionFilter) return false;
    if (sourceFilter === "portfolio" && !(ev.symbol && portfolioSymbols.includes(ev.symbol))) return false;
    if (sourceFilter === "watchlist" && !(ev.symbol && watchlistSymbols.includes(ev.symbol))) return false;
    if (search) {
      const q = search.toLowerCase();
      const inSymbol = ev.symbol?.toLowerCase().includes(q) ?? false;
      const inName = ev.name.toLowerCase().includes(q);
      const inCategory = ev.category?.toLowerCase().includes(q) ?? false;
      const inCountry = ev.country?.toLowerCase().includes(q) ?? false;
      if (!inSymbol && !inName && !inCategory && !inCountry) return false;
    }
    return true;
  });

  // Group by time bucket for timeline view
  const grouped = new Map<TimeBucket, CalendarEvent[]>();
  for (const bucket of BUCKET_ORDER) grouped.set(bucket, []);
  for (const ev of filtered) {
    const b = timeBucket(ev.date);
    grouped.get(b)!.push(ev);
  }

  function renderRow(ev: CalendarEvent) {
    const isPortfolio = !!(ev.symbol && portfolioSymbols.includes(ev.symbol));
    const isWatchlist = !!(ev.symbol && watchlistSymbols.includes(ev.symbol));
    const select = () => setSelectedEvent(ev);
    if (ev.type === "earnings") return <EarningsRow key={ev.id} ev={ev} onClick={select} isPortfolio={isPortfolio} isWatchlist={isWatchlist} />;
    if (ev.type === "exDividend" || ev.type === "dividend") return <DividendRow key={ev.id} ev={ev} onClick={select} isPortfolio={isPortfolio} isWatchlist={isWatchlist} />;
    return <MacroRow key={ev.id} ev={ev} onClick={select} />;
  }

  return (
    <PageShell py="py-10">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Reveal index={0} className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Market Events & Catalyst Calendar</h1>
          <p className="text-sm text-muted">
            Earnings, ex-dividends, central bank decisions, and macro releases — in one view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["timeline", "week"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${view === v ? "bg-surface-3 text-foreground" : "text-muted hover:bg-surface-2"}`}
              >
                {v === "timeline" ? (
                  <span className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                    Timeline
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    2-Week Grid
                  </span>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={() => void load()}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↻ Refresh
          </button>
        </div>
      </Reveal>

      {/* ── Summary strip ───────────────────────────────────────────────────── */}
      {!loading && events.length > 0 && (
        <Reveal index={1}>
          <SummaryStrip events={events} portfolioSymbols={portfolioSymbols} watchlistSymbols={watchlistSymbols} />
        </Reveal>
      )}

      {/* ── AI Weekly Brief — auto-generated on data load, shown before filters ── */}
      {!loading && events.length > 0 && (
        <Reveal index={2}>
          <AiBriefSection events={events} autoGenerate />
        </Reveal>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {(data?.unavailableSymbols?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          Couldn&apos;t load earnings/dividend data for {data!.unavailableSymbols.join(", ")} — try refreshing.
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      {!loading && events.length > 0 && (
        <Reveal index={3} className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative min-w-[180px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events…"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-sm outline-none placeholder:text-muted focus:border-brand"
            />
          </div>

          {/* Type filter */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {EVENT_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setTypeFilter(t.key as FilterType)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${typeFilter === t.key ? "bg-surface-3 text-foreground" : "text-muted hover:bg-surface-2"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Impact filter */}
          <select
            value={impactFilter}
            onChange={(e) => setImpactFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-brand"
          >
            {IMPACT_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>

          {/* Region filter */}
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-brand"
          >
            {REGION_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>

          {/* Source filter */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {[
              { key: "all", label: "All" },
              { key: "portfolio", label: "Portfolio" },
              { key: "watchlist", label: "Watchlist" },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => setSourceFilter(o.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${sourceFilter === o.key ? "bg-surface-3 text-foreground" : "text-muted hover:bg-surface-2"}`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Active filter count */}
          {(typeFilter !== "all" || impactFilter !== "all" || regionFilter !== "all" || sourceFilter !== "all" || search) && (
            <button
              onClick={() => { setTypeFilter("all"); setImpactFilter("all"); setRegionFilter("all"); setSourceFilter("all"); setSearch(""); }}
              className="text-xs text-muted transition-colors hover:text-negative"
            >
              ✕ Clear filters
            </button>
          )}
        </Reveal>
      )}

      {/* ── Loading skeleton ─────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} height="h-24" radius="rounded-xl" className="border border-border" />
          ))}
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <>
          {/* 2-Week Grid View */}
          {view === "week" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <SectionLabel>14-Day Overview</SectionLabel>
              </div>
              <WeekGrid events={filtered} onSelect={setSelectedEvent} />

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4">
                {(Object.entries(TYPE_STYLES) as [CalendarEvent["type"], typeof TYPE_STYLES[CalendarEvent["type"]]][]).map(([type, ts]) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <div className={`h-2 w-2 rounded-full ${ts.dot}`} />
                    <span className="text-xs text-muted">{ts.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline View */}
          {view === "timeline" && (
            <div className="flex flex-col gap-8">
              {filtered.length === 0 && (
                <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface py-14 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-semibold">No events match your filters</p>
                    <p className="max-w-xs text-xs text-muted">
                      Try clearing filters, or add symbols to your Watchlist and Portfolio to surface earnings and dividend events.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setTypeFilter("all"); setImpactFilter("all"); setRegionFilter("all"); setSourceFilter("all"); setSearch(""); }}
                      className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
                    >
                      Clear filters
                    </button>
                    <Link href="/watchlist" className="rounded-lg bg-brand-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90">
                      Manage Watchlist →
                    </Link>
                  </div>
                </div>
              )}

              {BUCKET_ORDER.map((bucket) => {
                const items = grouped.get(bucket) ?? [];
                if (items.length === 0) return null;

                return (
                  <div key={bucket} className="flex flex-col gap-3">
                    <SectionLabel count={items.length}>{BUCKET_LABELS[bucket]}</SectionLabel>

                    {/* Portfolio events spotlight (only in "today/tomorrow/thisWeek" buckets) */}
                    {(bucket === "today" || bucket === "tomorrow" || bucket === "thisWeek") && (() => {
                      const portItems = items.filter((e) => e.symbol && portfolioSymbols.includes(e.symbol));
                      if (portItems.length === 0) return null;
                      return (
                        <div className="mb-1 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
                          <p className="mb-2 text-label font-semibold uppercase tracking-widest text-brand/70">
                            Portfolio Impact
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {portItems.map((e) => (
                              <button
                                key={e.id}
                                onClick={() => setSelectedEvent(e)}
                                className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/8 px-2.5 py-1.5 text-xs transition-colors hover:bg-brand/15"
                              >
                                <span className="font-mono font-bold text-brand">{e.symbol}</span>
                                <span className="text-muted">{TYPE_STYLES[e.type].label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
                      {items.map(renderRow)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Legend (timeline view) ──────────────────────────────────────── */}
          {view === "timeline" && filtered.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/40 pt-4">
              {(Object.entries(TYPE_STYLES) as [CalendarEvent["type"], typeof TYPE_STYLES[CalendarEvent["type"]]][]).map(([type, ts]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className={`h-1.5 w-1.5 rounded-full ${ts.dot}`} />
                  <span className="text-xs text-muted">{ts.label}</span>
                </div>
              ))}
              <span className="h-3 w-px bg-border" />
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-negative" />
                <span className="text-xs text-muted">High Impact</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-warning" />
                <span className="text-xs text-muted">Medium Impact</span>
              </div>
            </div>
          )}

          {/* ── Integration links ──────────────────────────────────────────── */}
          {events.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { href: "/watchlist",  label: "Watchlist",  desc: "Add symbols to track their earnings and dividends here" },
                { href: "/portfolio",  label: "Portfolio",  desc: "Portfolio events are highlighted and tracked separately" },
                { href: "/wire",       label: "The Wire",   desc: "Live news around upcoming earnings and macro events" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 transition-all hover:border-brand/30 hover:bg-surface-2"
                >
                  <span className="text-sm font-semibold transition-colors group-hover:text-brand">{link.label} ↗</span>
                  <span className="text-xs leading-5 text-muted">{link.desc}</span>
                </Link>
              ))}
            </div>
          )}

          {/* Empty state — no portfolio or watchlist */}
          {events.filter((e) => e.type !== "macro").length === 0 && !loading && (
            <div className="rounded-xl border border-border bg-surface p-6">
              <p className="mb-2 text-sm font-semibold">No equity events yet</p>
              <p className="mb-4 text-xs leading-5 text-muted">
                Add stocks to your Watchlist or Portfolio to see their upcoming earnings reports and ex-dividend dates alongside these macro events.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/research" className="rounded-lg bg-brand-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90">
                  Research a stock →
                </Link>
                <Link href="/watchlist" className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2">
                  View Watchlist
                </Link>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Event Drawer ─────────────────────────────────────────────────────── */}
      <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </PageShell>
  );
}
