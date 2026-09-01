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

/** Labels for the development categories Indian listings carry (lib/india-news.ts).
 *  Plain media stories ("news") show no chip — the chip marks structure, not noise. */
const CATEGORY_LABEL: Record<string, string> = {
  "results": "Results",
  "corporate-action": "Corporate Action",
  "orders": "Order Win",
  "m&a": "M&A",
  "management": "Management",
  "regulatory": "Regulatory",
  "credit-rating": "Credit Rating",
  "board-meeting": "Board Meeting",
  "investor-meet": "Investor Meet",
  "announcement": "Exchange Filing",
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

/** The hero renders the top two catalysts and risks verbatim; this tab must
 *  add evidence, not restate it. Keep in sync with DecisionHero's slice(0, 2). */
const SHOWN_IN_HERO = 2;

export function WhySection({ verdict, verdictLoading, risks, news }: Props) {
  if (verdictLoading && !verdict) return <Skeleton />;

  // Only what the hero did NOT already show. When the model returned two-ish
  // bullets per side, the old full lists repeated the hero word for word —
  // a section that tells the reader nothing new is noise, so it disappears.
  const moreCatalysts = verdict?.catalysts.slice(SHOWN_IN_HERO) ?? [];
  const moreRisks = verdict?.risks.slice(SHOWN_IN_HERO) ?? [];

  // What will actually render. The fallback below used to test whether the
  // INPUTS existed (`!verdict && …`), not whether any of them survived the
  // slicing above — so a verdict whose two catalysts and two risks were all
  // consumed by the hero, on a symbol with no fundamental risks and no news
  // (any index, and any quiet equity), produced a completely blank tab.
  const hasBeyondHero = moreCatalysts.length > 0 || moreRisks.length > 0;
  const hasRisks = (risks?.length ?? 0) > 0;
  const hasNews = (news?.length ?? 0) > 0;
  const hasAnything = hasBeyondHero || hasRisks || hasNews;

  return (
    <div className="flex flex-col gap-7">

      {/* ── 2-col: Why Own / Why Avoid — beyond the hero's summary ── */}
      {(moreCatalysts.length > 0 || moreRisks.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {moreCatalysts.length > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-positive/15 bg-positive/5 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-positive/80">
                Why Own <span className="normal-case tracking-normal text-muted/60">· beyond the verdict summary</span>
              </p>
              <ul className="space-y-2">
                {moreCatalysts.map((c, i) => (
                  <Reveal key={i} as="li" index={i} className="flex gap-2.5 text-sm leading-5 text-foreground/85">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-positive/60" />
                    {c}
                  </Reveal>
                ))}
              </ul>
            </div>
          )}

          {moreRisks.length > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-negative/15 bg-negative/5 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-negative/80">
                Why Avoid <span className="normal-case tracking-normal text-muted/60">· beyond the verdict summary</span>
              </p>
              <ul className="space-y-2">
                {moreRisks.map((r, i) => (
                  <Reveal key={i} as="li" index={i} className="flex gap-2.5 text-sm leading-5 text-foreground/85">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-negative/60" />
                    {r}
                  </Reveal>
                ))}
              </ul>
            </div>
          )}
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
          <SectionHeader title="Recent Developments" subtitle="Company news, most recent first" />
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
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      <span>{item.source}</span>
                      {item.category && CATEGORY_LABEL[item.category] && (
                        <span className="rounded border border-border bg-surface-2 px-1 py-px text-[10px] uppercase tracking-wider text-muted">
                          {CATEGORY_LABEL[item.category]}
                        </span>
                      )}
                    </p>
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

      {/* Fallback if nothing rendered above. Distinguishes "the verdict said
          everything already" from "there is no verdict" — the second is a
          setup problem the user can act on, the first is not. */}
      {!hasAnything && (
        <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
          {verdict
            ? "Everything the analysis found is already shown in the verdict above — no additional catalysts, risks, or recent developments for this symbol."
            : "Investment analysis not yet available. Connect an AI provider in Settings to generate the AI verdict."}
        </div>
      )}
    </div>
  );
}
