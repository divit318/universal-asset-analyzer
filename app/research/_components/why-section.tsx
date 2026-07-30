"use client";

import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { NewsItem, RiskItem } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { LoadingPanel } from "@/app/_components/loading-panel";
import { Reveal } from "@/app/_components/reveal";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const RISK_BADGE: Record<"high" | "medium" | "low", string> = {
  high:   "text-negative bg-negative/10 border-negative/30",
  medium: "text-warning bg-warning/10 border-warning/30",
  low:    "text-muted bg-surface-2 border-border",
};

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">{title}</h3>
        {subtitle && <p className="text-[10px] text-muted/50">{subtitle}</p>}
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

function Skeleton() {
  return <LoadingPanel height="h-52" message="Assembling the case for and against…" />;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface Props {
  verdict: InvestmentVerdict | null;
  verdictLoading: boolean;
  risks?: RiskItem[];
  news?: NewsItem[];
}

export function WhySection({ verdict, verdictLoading, risks, news }: Props) {
  if (verdictLoading && !verdict) return <Skeleton />;

  return (
    <div className="flex flex-col gap-7">

      {/* ── 2-col: Why Own / Why Avoid ── */}
      {verdict && (
        <div className="grid gap-5 sm:grid-cols-2">
          {/* Why Own */}
          <div className="flex flex-col gap-3 rounded-xl border border-positive/15 bg-positive/5 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-positive/80">
              Why Own
            </p>
            <ul className="space-y-2">
              {verdict.catalysts.map((c, i) => (
                <Reveal key={i} as="li" index={i} className="flex gap-2.5 text-sm leading-5 text-foreground/85">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-positive/60" />
                  {c}
                </Reveal>
              ))}
            </ul>
          </div>

          {/* Why Avoid */}
          <div className="flex flex-col gap-3 rounded-xl border border-negative/15 bg-negative/5 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-negative/80">
              Why Avoid
            </p>
            <ul className="space-y-2">
              {verdict.risks.map((r, i) => (
                <Reveal key={i} as="li" index={i} className="flex gap-2.5 text-sm leading-5 text-foreground/85">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-negative/60" />
                  {r}
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Biggest Risks ── */}
      {risks && risks.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Biggest Risks" subtitle="From fundamental risk assessment" />
          <div className="flex flex-col gap-2">
            {risks
              .sort((a, b) => {
                const order = { high: 0, medium: 1, low: 2 } as const;
                return order[a.level] - order[b.level];
              })
              .slice(0, 6)
              .map((risk, i) => (
                <Reveal
                  key={`${risk.category}-${risk.level}`}
                  index={i}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3"
                >
                  <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${RISK_BADGE[risk.level]}`}>
                    {risk.level}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{risk.category}</p>
                    <p className="text-xs leading-5 text-muted">{risk.reason}</p>
                  </div>
                </Reveal>
              ))}
          </div>
        </div>
      )}

      {/* ── What Changed ── */}
      {news && news.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Latest Intelligence" subtitle="Recent news and developments" />
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {news.slice(0, 5).map((item, i) => (
              <Reveal key={i} as="li" index={i} className="flex items-start justify-between gap-4 bg-surface px-4 py-3">
                <div className="min-w-0">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-foreground/90 hover:text-accent hover:underline"
                    >
                      {item.headline}
                    </a>
                  ) : (
                    <p className="text-sm text-foreground/90">{item.headline}</p>
                  )}
                  {item.source && (
                    <p className="mt-0.5 text-[11px] text-muted">{item.source}</p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">
                  {formatDate(item.publishedAt)}
                </span>
              </Reveal>
            ))}
          </ul>
        </div>
      )}

      {/* Fallback if nothing to show */}
      {!verdict && (!risks || risks.length === 0) && (!news || news.length === 0) && (
        <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
          Investment analysis not yet available. Ensure Ollama is running to generate the AI verdict.
        </div>
      )}
    </div>
  );
}
