import type { DerivativesSummary } from "@/lib/derivatives-analysis";
import { formatPerShare } from "@/lib/format";

const TERM_STRUCTURE_LABEL: Record<NonNullable<DerivativesSummary["termStructure"]>, string> = {
  backwardation: "Backwardation (near-term richer)",
  contango: "Contango (normal upward curve)",
  flat: "Flat",
};

function GreeksRow({ label, greeks }: { label: string; greeks: DerivativesSummary["atmCallGreeks"] }) {
  if (!greeks) return null;
  return (
    <div className="flex flex-col gap-1 bg-surface p-3">
      <dt className="text-caption uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono text-xs leading-5">
        Δ {greeks.delta.toFixed(2)} · Γ {greeks.gamma.toFixed(4)} · Θ {greeks.theta.toFixed(3)}/day · V {greeks.vega.toFixed(3)}
      </dd>
    </div>
  );
}

export function DerivativesSummaryCard({
  summary,
  currency,
}: {
  summary: DerivativesSummary;
  /** Listing currency of the underlying (Quote.currency) — strikes are struck in it, not in dollars. */
  currency: string;
}) {
  // Strikes are exact contract values: whole where whole, 2dp otherwise.
  const strike = (v: number) => formatPerShare(v, currency, v % 1 === 0 ? 0 : 2);
  return (
    <section className="card-lift flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Options Chain</h3>
        <span className="text-xs text-muted">
          {summary.nearestExpiration ? `Nearest expiration ${summary.nearestExpiration}` : "No expirations listed"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <div className="flex flex-col gap-1 bg-surface p-3">
          <dt className="text-caption uppercase tracking-wide text-muted">ATM IV (near)</dt>
          <dd className="font-mono text-sm">{summary.atmIV != null ? `${summary.atmIV.toFixed(1)}%` : "—"}</dd>
        </div>
        <div className="flex flex-col gap-1 bg-surface p-3">
          <dt className="text-caption uppercase tracking-wide text-muted">ATM IV (far)</dt>
          <dd className="font-mono text-sm">{summary.atmIVFar != null ? `${summary.atmIVFar.toFixed(1)}%` : "—"}</dd>
        </div>
        <div className="flex flex-col gap-1 bg-surface p-3">
          <dt className="text-caption uppercase tracking-wide text-muted">Term structure</dt>
          <dd className="text-sm">{summary.termStructure ? TERM_STRUCTURE_LABEL[summary.termStructure] : "—"}</dd>
        </div>
        <div className="flex flex-col gap-1 bg-surface p-3">
          <dt className="text-caption uppercase tracking-wide text-muted">Put/Call OI ratio</dt>
          <dd className="font-mono text-sm">{summary.putCallOIRatio != null ? summary.putCallOIRatio.toFixed(2) : "—"}</dd>
        </div>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-caption uppercase tracking-wide text-muted">Top call strikes (OI)</span>
          {summary.topCallStrikes.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {summary.topCallStrikes.map((s) => (
                <li key={s.strike} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{strike(s.strike)}</span>
                  <span className="text-muted">{s.openInterest.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted">Not available</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-caption uppercase tracking-wide text-muted">Top put strikes (OI)</span>
          {summary.topPutStrikes.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {summary.topPutStrikes.map((s) => (
                <li key={s.strike} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{strike(s.strike)}</span>
                  <span className="text-muted">{s.openInterest.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted">Not available</span>
          )}
        </div>
      </div>

      {(summary.atmCallGreeks || summary.atmPutGreeks) && (
        <div className="flex flex-col gap-1">
          <span className="text-caption uppercase tracking-wide text-muted">
            ATM Greeks (strike {summary.atmStrike != null ? strike(summary.atmStrike) : "—"}, Black-Scholes from chain IV)
          </span>
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            <GreeksRow label="Call" greeks={summary.atmCallGreeks} />
            <GreeksRow label="Put" greeks={summary.atmPutGreeks} />
          </dl>
        </div>
      )}
    </section>
  );
}
