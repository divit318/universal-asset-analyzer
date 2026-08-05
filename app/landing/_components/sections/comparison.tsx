import { Check, Minus } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Benchmark comparison (Creative Direction §6.7). A feature comparison — not
 * fabricated metrics or logos (reconciliation §G). Rows are chosen so the
 * differentiation is factual and defensible: the cloud assistants aren't local
 * or private and lack research engines; Bloomberg has data and tools but is
 * cloud, non-private, and subscription-gated.
 */
const COMPETITORS = ["UAA", "ChatGPT", "Perplexity", "Bloomberg"] as const;

// One boolean per competitor, in COMPETITORS order.
const ROWS: { label: string; has: boolean[] }[] = [
  { label: "Local-first: your data on your device", has: [true, false, false, false] },
  { label: "Research data stored on your device", has: [true, false, false, false] },
  { label: "SEC filings & fundamentals", has: [true, false, false, true] },
  { label: "Portfolio & valuation engines", has: [true, false, false, true] },
  { label: "No subscription required", has: [true, false, false, false] },
];

function Cell({ has }: { has: boolean }) {
  return has ? (
    <>
      <Check className="mx-auto h-4 w-4 text-positive" strokeWidth={2.5} aria-hidden="true" />
      <span className="sr-only">Yes</span>
    </>
  ) : (
    <>
      <Minus className="mx-auto h-4 w-4 text-faint" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">No</span>
    </>
  );
}

export function Comparison({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <Reveal className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-24">
        <div className="flex max-w-2xl flex-col gap-4 text-center sm:mx-auto">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            How UAA stacks up
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">Feature comparison of UAA against ChatGPT, Perplexity, and Bloomberg</caption>
            <thead>
              <tr>
                <th scope="col" className="p-3 text-left font-medium text-muted" />
                {COMPETITORS.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={`p-3 text-center font-semibold ${c === "UAA" ? "rounded-t-card bg-brand-muted text-brand" : "text-muted"}`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <th scope="row" className="p-3 text-left font-normal text-foreground">
                    {row.label}
                  </th>
                  {row.has.map((has, i) => (
                    <td key={COMPETITORS[i]} className={`p-3 text-center ${COMPETITORS[i] === "UAA" ? "bg-brand-muted" : ""}`}>
                      <Cell has={has} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </section>
  );
}
