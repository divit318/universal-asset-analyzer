"use client";

/**
 * IC Report — report header (Phase 5.18/5.19, 3.8).
 *
 * Carries price at generation, market cap, shares outstanding, data as-of,
 * model and prompt versions. Renders the report-level disclosure banner
 * (validation issues, data gaps, agents that flagged insufficient data) and
 * the report history with age, staleness and a diff against the previous run.
 */

import { useEffect, useMemo, useState } from "react";
import type { ICReport } from "@/lib/ic-report";
import { fmtMoney, fmtMoneyCompact, fmtDateTime, fmtPercent } from "@/lib/ic/format";
import type { HistoryEntry } from "./use-report-stream";
import { DirectionValue } from "./shared";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function age(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function HeaderSummary({
  report,
  previous,
  history,
  restoredFromCache,
  onSelectHistoric,
  actions,
}: {
  report: ICReport;
  previous: ICReport | null;
  history: HistoryEntry[];
  restoredFromCache: boolean;
  onSelectHistoric: (generatedAt: string) => void;
  actions: React.ReactNode;
}) {
  const facts = report.facts;
  // Age/staleness needs wall-clock time; read it once per report change in an
  // effect so render stays pure (and the server render never disagrees).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wall-clock snapshot, once per report
    setNow(Date.now());
  }, [report.generatedAt]);
  const stale = now != null && now - new Date(report.generatedAt).getTime() > STALE_AFTER_MS;
  const [showVersions, setShowVersions] = useState(false);

  const diff = useMemo(() => {
    if (!previous) return null;
    const parts: string[] = [];
    const h0 = previous.valuation.headline?.perShare;
    const h1 = report.valuation.headline?.perShare;
    if (h0 != null && h1 != null && Math.abs(h1 - h0) > 0.005) {
      parts.push(`headline ${fmtMoney(h0, report.currency)} → ${fmtMoney(h1, report.currency)}`);
    }
    const s0 = previous.signals.length;
    const s1 = report.signals.length;
    if (s0 !== s1) parts.push(`signals ${s0} → ${s1}`);
    const p0 = previous.facts.spot?.value;
    const p1 = report.facts.spot?.value;
    if (p0 != null && p1 != null && p0 !== 0 && Math.abs(p1 / p0 - 1) > 0.001) {
      parts.push(`spot ${fmtPercent(p1 / p0 - 1, { signed: true })}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "no material changes vs previous run";
  }, [previous, report]);

  const dataGapAgents = report.synthesis?.dataGapAgents ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{report.companyName}</h2>
          <p className="text-sm text-muted">
            {report.symbol} · {report.market === "IN" ? "NSE/BSE" : report.market === "US" ? "US" : facts.exchange ?? "intl"} ·{" "}
            {fmtDateTime(report.generatedAt, report.market)} · {report.model}
            <button
              className="ml-1 rounded px-1 text-label text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              onClick={() => setShowVersions((v) => !v)}
              aria-expanded={showVersions}
            >
              prompts v: {showVersions ? "hide" : "show"}
            </button>
          </p>
          {showVersions && (
            <p className="mt-0.5 font-mono text-label text-muted">
              {Object.entries(report.promptVersions).map(([k, v]) => `${k}=${v}`).join("  ")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>

      {/* Key figures strip: price at generation, mcap, shares, as-of (5.18) */}
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <HeaderStat label="Price at generation" value={facts.spot ? fmtMoney(facts.spot.value, report.currency) : "not available"} />
        <HeaderStat label="Market cap" value={facts.marketCap ? fmtMoneyCompact(facts.marketCap.value, report.currency) : "not available"} />
        <HeaderStat label="Shares outstanding" value={facts.sharesOutstanding ? fmtMoneyCompact(facts.sharesOutstanding.value, null).replace(/^\$/, "") : "not available"} />
        <HeaderStat
          label="Blended value"
          value={
            report.valuation.headline ? (
              <span>
                {fmtMoney(report.valuation.headline.perShare, report.currency)}{" "}
                <DirectionValue value={report.valuation.headline.vsSpot} format={(v) => fmtPercent(v, { signed: true })} className="text-xs" />
              </span>
            ) : (
              <span className="text-warning">no estimate</span>
            )
          }
        />
        <HeaderStat label="Data as of" value={fmtDateTime(facts.asOf, report.market)} />
        <HeaderStat
          label="Report age"
          value={
            <span className={stale ? "text-warning" : undefined}>
              {now != null ? age(report.generatedAt, now) : "…"}
              {stale ? " (stale)" : ""}
            </span>
          }
        />
      </div>

      {/* History with diff (5.19) */}
      {(history.length > 1 || restoredFromCache) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {restoredFromCache && <span className="rounded-full border border-border px-2 py-0.5">restored from history</span>}
          {history.length > 1 && (
            <label className="flex items-center gap-1.5">
              <span>Report history:</span>
              <select
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                value={report.generatedAt}
                onChange={(e) => onSelectHistoric(e.target.value)}
                aria-label="Select a previous report"
              >
                {history.map((h) => (
                  <option key={h.generatedAt} value={h.generatedAt}>
                    {new Date(h.generatedAt).toLocaleString()} · {h.model}
                  </option>
                ))}
              </select>
            </label>
          )}
          {diff && <span>Δ vs previous: {diff}</span>}
        </div>
      )}

      {/* Loud validation banner (Phase 1.2 — never silently wrong) */}
      {facts.validationIssues.length > 0 && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative" role="alert">
          <p className="font-medium">Data validation {facts.validationIssues.length === 1 ? "issue" : "issues"} detected: treat affected figures with caution.</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {facts.validationIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Report-level data-insufficiency disclosure (Phase 3.8) */}
      {(facts.gaps.length > 0 || dataGapAgents.length > 0) && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium">
            Known data gaps for this name
            {dataGapAgents.length > 0 && `: ${dataGapAgents.length} of ${report.agentFindings.length} agents flagged insufficient data`}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {facts.gaps.map((g) => (
              <li key={g.concept}>
                {g.concept}: {g.reason}
              </li>
            ))}
            {dataGapAgents.map((a) => (
              <li key={a.agent}>
                {a.agent}: {a.limitation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-label uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate font-medium" title={typeof value === "string" ? value : undefined}>{value}</div>
    </div>
  );
}
