import { LineChart, FileText, Table, MessageSquare, Newspaper } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Problem — the "workflow chaos" beat. Static (Milestone 3): a scattered cluster
 * of the tools a serious investor juggles today, conveyed with CSS transforms
 * only. The entrance choreography (icons sliding in) is Milestone 5.
 *
 * Copy is the approved Creative Direction final wording (§9).
 */
const TOOLS = [
  { icon: LineChart, label: "Yahoo Finance", tilt: "-rotate-3" },
  { icon: FileText, label: "EDGAR filings", tilt: "rotate-2" },
  { icon: Table, label: "Spreadsheets", tilt: "rotate-3" },
  { icon: MessageSquare, label: "ChatGPT", tilt: "-rotate-2" },
  { icon: Newspaper, label: "News sites", tilt: "rotate-1" },
];

export function Problem({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <Reveal className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-6 py-24 text-center">
        <div className="flex max-w-2xl flex-col items-center gap-4">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Why does research feel so fragmented?
          </h2>
          <p className="text-pretty text-base leading-relaxed text-muted">
            Every day you hop between Yahoo Finance, EDGAR PDFs, spreadsheets, and ChatGPT. All that
            data — and still hours go by without a single insight.
          </p>
        </div>

        {/* Scattered tool cluster — static clutter, decorative. */}
        <div aria-hidden="true" className="flex flex-wrap items-center justify-center gap-4">
          {TOOLS.map(({ icon: Icon, label, tilt }) => (
            <div
              key={label}
              className={`flex items-center gap-2 rounded-card border border-border bg-surface-2 px-4 py-3 shadow-card ${tilt}`}
            >
              <Icon className="h-4 w-4 text-faint" strokeWidth={1.75} />
              <span className="text-sm font-medium text-muted">{label}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
