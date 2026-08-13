"use client";

/**
 * "What's new" — the drawer's answer to "what changed in the COMPANY, not the
 * ticker". Three stacked strata, each separately sourced and separately labeled:
 *
 * 1. Alerts that actually fired since the visit baseline (notification table —
 *    the same rows the bell delivered).
 * 2. The deterministic thesis-drift read: which way the classified evidence
 *    leans since the thesis was last reviewed, with the events that lean it.
 * 3. Recent developments — persisted timeline events (news, filings, rotation),
 *    newest first, each with its deterministic impact and a source link.
 *
 * Freshness is stated, not implied: developments come from periodic checks, and
 * the footer says when this name was last checked rather than letting an empty
 * list read as "nothing happened".
 */

import { agoLabel } from "@/lib/provenance";
import type { PulseNotification, SymbolPulse, ThesisSignal } from "@/lib/watchlist-pulse";
import type { TimelineImpact } from "@/lib/types";

const IMPACT_DOT: Record<TimelineImpact, string> = {
  bullish: "bg-positive",
  bearish: "bg-negative",
  neutral: "bg-muted/50",
};

const DRIFT_LABEL: Record<ThesisSignal["status"], string> = {
  strengthening: "Evidence leans with your thesis",
  weakening: "Evidence leans against your thesis",
  mixed: "Evidence is mixed",
  quiet: "No material events",
};

const DRIFT_TONE: Record<ThesisSignal["status"], string> = {
  strengthening: "text-positive",
  weakening: "text-negative",
  mixed: "text-warning",
  quiet: "text-muted/60",
};

function FiredAlerts({ notifications }: { notifications: PulseNotification[] }) {
  if (notifications.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {notifications.map((n) => (
        <li
          key={n.id}
          className={`rounded-lg border px-3 py-2 text-xs ${
            n.severity === "warning"
              ? "border-negative/30 bg-negative/[0.07] text-negative"
              : "border-warning/30 bg-warning/[0.07] text-warning"
          }`}
        >
          <span className="font-semibold">Alert fired · </span>
          {n.title}
          <span className="ml-1.5 opacity-60">{agoLabel(n.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function DriftRead({ signal }: { signal: ThesisSignal }) {
  if (signal.status === "quiet") return null;
  const drivers = signal.status === "weakening" ? signal.bearish : signal.bullish;
  const counter = signal.status === "weakening" ? signal.bullish : signal.bearish;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="flex items-baseline justify-between gap-2">
        <span className={`text-xs font-semibold ${DRIFT_TONE[signal.status]}`}>{DRIFT_LABEL[signal.status]}</span>
        <span className="text-[10px] text-muted/60">
          {signal.eventCount} event{signal.eventCount === 1 ? "" : "s"} · {signal.windowDays}d window
        </span>
      </p>
      {signal.status !== "mixed" && drivers.length > 0 && (
        <ul className="flex flex-col gap-1">
          {drivers.map((t, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-4 text-foreground/80">
              <span aria-hidden="true" className={`mt-1 h-1 w-1 shrink-0 rounded-full ${signal.status === "weakening" ? "bg-negative/70" : "bg-positive/70"}`} />
              {t}
            </li>
          ))}
        </ul>
      )}
      {signal.status === "mixed" && (
        <p className="text-[11px] leading-4 text-muted">
          {signal.bullish.length} supporting · {signal.bearish.length} contradicting — worth a read before acting.
        </p>
      )}
      {signal.status !== "mixed" && counter.length > 0 && (
        <p className="text-[11px] text-muted/70">Against: {counter[0]}</p>
      )}
      <p className="text-[10px] text-muted/50">
        A tally of classified events since your last review — evidence, not a verdict.
      </p>
    </div>
  );
}

export function WhatsNew({
  pulse,
  checking,
}: {
  pulse: SymbolPulse | null;
  /** True while this symbol's news/filings check is running in the background. */
  checking: boolean;
}) {
  const developments = pulse?.developments ?? [];
  const checkedAt = pulse?.developmentsCheckedAt ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">What&apos;s new</p>

      <FiredAlerts notifications={pulse?.notifications ?? []} />
      {pulse?.thesisSignal && <DriftRead signal={pulse.thesisSignal} />}

      {developments.length > 0 ? (
        <ul className="flex flex-col">
          {developments.map((d) => (
            <li key={d.id} className="flex gap-2.5 border-b border-hairline py-2 last:border-0">
              <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${IMPACT_DOT[d.impact]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-[1.4] text-foreground/90">
                  {d.url ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-control underline-offset-2 hover:text-brand hover:underline"
                    >
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted/60">
                  <span>{agoLabel(d.timestamp)}</span>
                  <span className="capitalize">{d.category.replace(/_/g, " ")}</span>
                  {d.sinceBaseline && (
                    <span className="rounded-full border border-brand/30 bg-brand/10 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-brand">
                      New
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted/60">
          {checking ? "Checking news and filings…" : "No developments on record for this name."}
        </p>
      )}

      <p className="text-[10px] text-muted/50">
        {checking
          ? "Checking news and filings now — reload in a moment for the latest."
          : checkedAt != null
            ? `News & filings checked ${agoLabel(checkedAt)}.`
            : "No recent news check — developments may lag. They refresh as you use the page."}
      </p>
    </div>
  );
}
