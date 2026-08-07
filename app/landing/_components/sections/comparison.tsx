import { Check, X, ShieldCheck, Shield, Database, FileText, TrendingUp, Lock, Sparkles, type LucideIcon } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";

/**
 * Compare — a factual feature comparison. The UAA column is brass-tinted with
 * a brass border and shield glyph; its checks are brass, competitor checks
 * white. Negative cells are a muted X at 30% opacity, clearly distinct from
 * both a dash (which reads as "no data") and the brass check.
 *
 * Rows chosen so the differentiation is defensible: the cloud assistants
 * aren't local or private and lack research engines; Bloomberg has data and
 * tools but is cloud, non-private, and subscription-gated. Below 768px the
 * table becomes one stacked card per feature with four labelled cells.
 */
const COMPETITORS = ["UAA", "ChatGPT", "Perplexity", "Bloomberg"] as const;

const ROWS: { icon: LucideIcon; label: string; has: boolean[] }[] = [
  { icon: Shield, label: "Local-first: your data on your device", has: [true, false, false, false] },
  { icon: Database, label: "Research data stored on your device", has: [true, false, false, false] },
  { icon: FileText, label: "SEC filings & fundamentals", has: [true, false, false, true] },
  { icon: TrendingUp, label: "Portfolio & valuation engines", has: [true, false, false, true] },
  { icon: Lock, label: "No subscription required", has: [true, false, false, false] },
];

function Cell({ has, uaa }: { has: boolean; uaa: boolean }) {
  return has ? (
    <>
      <Check className={`mx-auto h-4 w-4 ${uaa ? "text-brand" : "text-foreground"}`} strokeWidth={2.5} aria-hidden="true" />
      <span className="sr-only">Yes</span>
    </>
  ) : (
    <>
      <X className="mx-auto h-4 w-4 text-foreground opacity-30" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">No</span>
    </>
  );
}

export function Comparison({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" });

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
          <div className="rounded-[20px] border border-border bg-surface/50 px-5 py-12 sm:px-10">
            <SectionHeader
              eyebrow="Compare"
              headingId={headingId}
              segments={[{ text: "How UAA" }, { text: "stacks up", tone: "accent" }]}
            />

            {/* Desktop/tablet table */}
            <div className="mt-mk-lead hidden md:block">
              <table className="w-full border-separate border-spacing-0 text-mk-body">
                <caption className="sr-only">
                  Feature comparison of UAA against ChatGPT, Perplexity, and Bloomberg
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="p-3 text-left font-medium text-muted" />
                    {COMPETITORS.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={`p-3 text-center font-semibold ${
                          c === "UAA"
                            ? "rounded-t-card border-x border-t border-brand bg-brand-muted text-brand"
                            : "text-muted"
                        }`}
                      >
                        {c === "UAA" ? (
                          <span className="flex items-center justify-center gap-1.5">
                            <ShieldCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                            UAA
                          </span>
                        ) : (
                          c
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <Reveal as="tbody" delay={280} stagger={50}>
                  {ROWS.map((row, ri) => (
                    <tr key={row.label} className="group">
                      <th
                        scope="row"
                        className="border-t border-hairline p-3 text-left font-normal text-foreground transition-colors group-hover:bg-surface-2/70"
                      >
                        <span className="flex items-center gap-2.5">
                          <row.icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
                          {row.label}
                        </span>
                      </th>
                      {row.has.map((has, i) => (
                        <td
                          key={COMPETITORS[i]}
                          style={COMPETITORS[i] === "UAA" ? { transitionDelay: `${280 + ROWS.length * 50 + ri * 90}ms` } : undefined}
                          className={`border-t border-hairline p-3 text-center transition-colors ${
                            COMPETITORS[i] === "UAA"
                              ? `border-x border-brand bg-brand-muted duration-[200ms] [[data-reveal=hidden]_&]:border-x-transparent ${ri === ROWS.length - 1 ? "rounded-b-card border-b [[data-reveal=hidden]_&]:border-b-transparent" : ""}`
                              : "group-hover:bg-surface-2/70"
                          }`}
                        >
                          <Cell has={has} uaa={COMPETITORS[i] === "UAA"} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Reveal>
              </table>
            </div>

            {/* Mobile: one stacked card per feature. */}
            <ul className="mt-mk-lead flex flex-col gap-3 md:hidden">
              {ROWS.map((row) => (
                <li key={row.label} className="rounded-card border border-hairline bg-surface-2/50 p-4">
                  <p className="flex items-center gap-2.5 text-mk-body font-medium text-foreground">
                    <row.icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
                    {row.label}
                  </p>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {row.has.map((has, i) => (
                      <div
                        key={COMPETITORS[i]}
                        className={`flex flex-col items-center gap-1 rounded-control px-1 py-2 ${
                          COMPETITORS[i] === "UAA" ? "border border-brand/40 bg-brand-muted" : "bg-surface-3/50"
                        }`}
                      >
                        <span className={`text-micro font-medium ${COMPETITORS[i] === "UAA" ? "text-brand" : "text-muted"}`}>
                          {COMPETITORS[i]}
                        </span>
                        <Cell has={has} uaa={COMPETITORS[i] === "UAA"} />
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            {/* Closing pill + honesty caption. */}
            <div className="mt-mk-lead flex flex-col items-center gap-3">
              <p className="flex items-center gap-2.5 rounded-full border border-border bg-surface px-5 py-3 text-center text-mk-small text-foreground">
                <Sparkles className="h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
                <span>
                  UAA combines the power of AI with the <span className="text-brand">privacy</span> and{" "}
                  <span className="text-brand">depth</span> serious investors demand.
                </span>
              </p>
              <p className="text-caption text-muted">
                Comparison reflects publicly documented capabilities as of{" "}
                <span className="font-mono tabular-nums">{today}</span>.
              </p>
            </div>
          </div>
    </SectionShell>
  );
}
