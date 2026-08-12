"use client";

/**
 * Documents & Corporate Actions for Indian listings.
 *
 * Three clearly-separated groups:
 *   1. Corporate actions — dividend and split/bonus history (Yahoo events,
 *      the same series the adjusted chart uses).
 *   2. Company documents — annual reports and earnings-call material. Links
 *      go to the OFFICIAL documents (bseindia.com / nsearchives / agency
 *      sites); screener.in is only the index.
 *   3. Credit ratings — agency rating updates with their dates.
 */

import type { ScreenerInDocuments } from "@/lib/screener-in";
import type { CorporateActions } from "@/lib/yahoo";
import { formatDate } from "@/lib/format";

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
        <p className="text-[10px] text-muted/70">{note}</p>
      </div>
      {children}
    </div>
  );
}

function LinkPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
    >
      {children} ↗
    </a>
  );
}

interface Props {
  documents: ScreenerInDocuments | null;
  actions: CorporateActions | null;
}

export function DocumentsActionsCard({ documents, actions }: Props) {
  const hasActions = (actions?.dividends.length ?? 0) > 0 || (actions?.splits.length ?? 0) > 0;
  const hasDocs =
    (documents?.annualReports.length ?? 0) > 0 ||
    (documents?.concalls.length ?? 0) > 0 ||
    (documents?.creditRatings.length ?? 0) > 0;
  if (!hasActions && !hasDocs) return null;

  const dividends = (actions?.dividends ?? []).slice(-8).reverse();
  const splits = (actions?.splits ?? []).slice(-6).reverse();

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold">Documents &amp; Corporate Actions</h3>
        <p className="text-xs text-muted">
          Official exchange and company material — links open the source document
        </p>
      </div>

      {hasActions && (
        <Group title="Corporate Actions" note="Dividend & split/bonus history · Yahoo Finance price-adjustment events">
          <div className="grid gap-4 sm:grid-cols-2">
            {dividends.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-left uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Dividend (ex-date)</th>
                      <th className="px-3 py-1.5 text-right font-medium">₹ / share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dividends.map((d) => (
                      <tr key={d.date} className="bg-surface">
                        <td className="px-3 py-1.5 text-muted">{formatDate(d.date)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">₹{d.amount.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {splits.length > 0 ? (
                splits.map((s) => (
                  <div key={s.date} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-1.5 text-xs">
                    <span className="text-muted">{formatDate(s.date)}</span>
                    <span className="font-mono">
                      {s.ratio} split/bonus
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted">No splits or bonus issues in the last decade.</p>
              )}
              {splits.length > 0 && (
                <p className="text-[10px] leading-snug text-muted/70">
                  Bonus issues appear as their equivalent split ratio (a 1:1 bonus shows as 2:1) —
                  the chart&apos;s adjusted prices already account for these.
                </p>
              )}
            </div>
          </div>
        </Group>
      )}

      {(documents?.annualReports.length ?? 0) > 0 && (
        <Group title="Annual Reports" note="Company filings via BSE/NSE · indexed by screener.in">
          <div className="flex flex-wrap gap-1.5">
            {documents!.annualReports.map((r) => (
              <LinkPill key={r.url} href={r.url}>
                {r.label.replace(/^Financial Year /, "FY ")}
              </LinkPill>
            ))}
          </div>
        </Group>
      )}

      {(documents?.concalls.length ?? 0) > 0 && (
        <Group title="Earnings Calls" note="Transcripts and presentations · official exchange uploads">
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {documents!.concalls.map((c) => (
              <li key={`${c.date}-${c.transcriptUrl ?? c.pptUrl ?? c.recordingUrl}`} className="flex items-center justify-between gap-3 bg-surface px-3 py-2">
                <span className="text-xs text-muted">{c.date}</span>
                <span className="flex gap-1.5">
                  {c.transcriptUrl && <LinkPill href={c.transcriptUrl}>Transcript</LinkPill>}
                  {c.pptUrl && <LinkPill href={c.pptUrl}>Presentation</LinkPill>}
                  {c.recordingUrl && <LinkPill href={c.recordingUrl}>Recording</LinkPill>}
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {(documents?.creditRatings.length ?? 0) > 0 && (
        <Group title="Credit Ratings" note="Agency rating actions — opens the agency's own release">
          <ul className="flex flex-col gap-1.5">
            {documents!.creditRatings.slice(0, 6).map((r) => (
              <li key={r.url} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-1.5">
                <span className="text-xs text-muted">{r.note ?? r.label}</span>
                <LinkPill href={r.url}>{r.label}</LinkPill>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </section>
  );
}
