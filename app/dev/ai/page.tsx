import type { Metadata } from "next";
import { PageShell } from "@/app/_components/ui";
import { summarizeAiTelemetry, type AiUsageSlice } from "@/lib/ai/telemetry";

export const metadata: Metadata = { title: "AI Telemetry" };
export const dynamic = "force-dynamic";

/**
 * /dev/ai — the AI instrument panel.
 *
 * A review surface, not a product surface (same standing as /dev/tokens): the
 * ledger lib/ai/telemetry.ts writes, aggregated over a trailing window. This
 * is where routing/caching/tiering policy changes are judged — spend by task,
 * prompt-cache hit rate, p50/p95 latency and TTFT per model, fallback depth,
 * and the most recent failures with their real error messages.
 *
 * Costs are estimates (registry pricing × reported usage), not billing truth.
 */

const WINDOW_DAYS = 7;

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtRate(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

function SliceTable({ title, slices }: { title: string; slices: AiUsageSlice[] }) {
  return (
    <section>
      <h2 className="text-label font-semibold uppercase tracking-widest text-faint">{title}</h2>
      <div className="mt-3 overflow-x-auto rounded-control border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-caption text-muted">
              <th className="px-3 py-2 font-medium">{title === "By task" ? "Task" : "Model"}</th>
              <th className="px-3 py-2 text-right font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">Fail</th>
              <th className="px-3 py-2 text-right font-medium">p50</th>
              <th className="px-3 py-2 text-right font-medium">p95</th>
              <th className="px-3 py-2 text-right font-medium">TTFT p50</th>
              <th className="px-3 py-2 text-right font-medium">In</th>
              <th className="px-3 py-2 text-right font-medium">Out</th>
              <th className="px-3 py-2 text-right font-medium">Cache hit</th>
              <th className="px-3 py-2 text-right font-medium">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {slices.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-center text-muted">
                  No AI calls recorded in this window yet.
                </td>
              </tr>
            )}
            {slices.map((s) => (
              <tr key={s.key} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 font-mono text-caption">{s.key}</td>
                <td className="nums px-3 py-2 text-right">{s.calls}</td>
                <td className={`nums px-3 py-2 text-right ${s.failures > 0 ? "text-negative" : "text-faint"}`}>
                  {s.failures}
                </td>
                <td className="nums px-3 py-2 text-right">{fmtMs(s.p50Ms)}</td>
                <td className="nums px-3 py-2 text-right">{fmtMs(s.p95Ms)}</td>
                <td className="nums px-3 py-2 text-right">{fmtMs(s.p50TtftMs)}</td>
                <td className="nums px-3 py-2 text-right">{fmtTokens(s.promptTokens + s.cacheCreationTokens + s.cacheReadTokens)}</td>
                <td className="nums px-3 py-2 text-right">{fmtTokens(s.completionTokens)}</td>
                <td className="nums px-3 py-2 text-right">{fmtRate(s.cacheHitRate)}</td>
                <td className="nums px-3 py-2 text-right">{fmtUsd(s.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-control border border-border bg-surface px-4 py-3">
      <p className="text-caption uppercase tracking-widest text-faint">{label}</p>
      <p className="nums mt-1 text-xl text-foreground">{value}</p>
      {note && <p className="text-caption text-muted">{note}</p>}
    </div>
  );
}

export default function AiTelemetryPage() {
  const summary = summarizeAiTelemetry(WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const t = summary.totals;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">AI Telemetry</h1>
        <p className="mt-1 text-sm text-muted">
          Trailing {WINDOW_DAYS} days, from the local call ledger. Costs are estimates (registry pricing ×
          reported usage), never billing truth.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Calls" value={String(t.calls)} note={`${t.failures} failed`} />
        <Stat label="Est. spend" value={fmtUsd(t.costUsd)} />
        <Stat label="p50 / p95" value={`${fmtMs(t.p50Ms)} / ${fmtMs(t.p95Ms)}`} />
        <Stat label="TTFT p50" value={fmtMs(t.p50TtftMs)} note="streamed calls" />
        <Stat
          label="Cache hit"
          value={fmtRate(t.cacheHitRate)}
          note={`${fmtTokens(t.cacheReadTokens)} tok read`}
        />
        <Stat label="Fallback rate" value={fmtRate(summary.fallbackRate)} note="attempt > 1" />
      </div>

      <SliceTable title="By task" slices={summary.byTask} />
      <SliceTable title="By model" slices={summary.byModel} />

      <section>
        <h2 className="text-label font-semibold uppercase tracking-widest text-faint">Recent failures</h2>
        {summary.recentFailures.length === 0 ? (
          <p className="mt-3 text-sm text-muted">None in this window.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {summary.recentFailures.map((f, i) => (
              <li key={i} className="rounded-control border border-border bg-surface px-4 py-2 text-sm">
                <span className="font-mono text-caption text-negative">{f.outcome}</span>
                <span className="mx-2 text-faint">·</span>
                <span className="font-mono text-caption">{f.taskType}</span>
                <span className="mx-2 text-faint">·</span>
                <span className="font-mono text-caption text-muted">{f.model}</span>
                <span className="mx-2 text-faint">·</span>
                <span className="text-caption text-muted">{new Date(f.at).toLocaleString()}</span>
                {f.message && <p className="mt-1 truncate text-caption text-muted">{f.message}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
