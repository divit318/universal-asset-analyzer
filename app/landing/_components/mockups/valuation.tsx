import { ArrowUpRight } from "lucide-react";

/**
 * Valuation Engine mockup — static, hand-authored sample data. Model-type
 * sidebar with DCF active, intrinsic value + upside, and a bar chart: brass
 * historical bars, grey projected bars with E-suffix years, and a dotted
 * trend line across the projections.
 */
const MODELS = [
  "Discounted Cash Flow (DCF)",
  "Comparable Companies",
  "Precedent Transactions",
  "Sum-of-the-Parts",
  "Dividend Discount Model",
];

/* year, bar height (% of chart), historical? */
const BARS: { year: string; h: number; hist: boolean }[] = [
  { year: "2021", h: 34, hist: true },
  { year: "2022", h: 40, hist: true },
  { year: "2023", h: 46, hist: true },
  { year: "2024", h: 54, hist: true },
  { year: "2025E", h: 60, hist: false },
  { year: "2026E", h: 67, hist: false },
  { year: "2027E", h: 75, hist: false },
  { year: "2028E", h: 84, hist: false },
];

export function ValuationMockup() {
  return (
    <div className="flex h-full gap-2.5 p-4 text-left">
      {/* Sidebar */}
      <div className="flex w-40 shrink-0 flex-col rounded-card border border-hairline bg-surface-2/60 p-2.5">
        <p className="px-1.5 text-caption font-semibold text-foreground">Valuation Models</p>
        <p className="px-1.5 pt-0.5 text-micro text-muted">Built-in models. Always up to date.</p>
        <ul className="mt-2 flex flex-col gap-0.5">
          {MODELS.map((m, i) => (
            <li
              key={m}
              className={`rounded-control px-1.5 py-1.5 text-micro leading-snug ${
                i === 0 ? "bg-brand/12 font-semibold text-brand" : "text-muted"
              }`}
            >
              {m}
            </li>
          ))}
        </ul>
      </div>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col rounded-card border border-hairline bg-surface-2/60 p-3.5">
        <p className="text-caption font-semibold text-foreground">Discounted Cash Flow (DCF)</p>
        <div className="mt-1.5 flex items-baseline gap-4">
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Intrinsic Value</p>
            <p className="font-mono text-mk-feature font-semibold tabular-nums text-foreground">$186.42</p>
          </div>
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Upside</p>
            <p className="flex items-center gap-0.5 font-mono text-mk-lead font-semibold tabular-nums text-positive">
              <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
              +24.3%
            </p>
          </div>
        </div>

        {/* Bar chart: brass history, grey projections, dotted trend line. */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className="relative flex flex-1 items-end gap-2">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full text-muted"
            >
              {/* Trend line across the projected years (bars 5–8). */}
              <path
                d="M53 42 L66 35 L78 27 L91 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="2.5 2.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {BARS.map((b, i) => (
              <div key={b.year} className="flex h-full flex-1 items-end">
                <div
                  style={{ transitionDelay: `${700 + i * 50}ms` }}
                  className={`w-full origin-bottom rounded-t-xs transition-transform duration-[700ms] ease-out [[data-reveal=hidden]_&]:scale-y-0 ${
                    b.hist ? "bg-brand/80" : "bg-border-strong"
                  } ${
                    b.h >= 80 ? "h-5/6" : b.h >= 70 ? "h-3/4" : b.h >= 60 ? "h-3/5" : b.h >= 50 ? "h-1/2" : b.h >= 40 ? "h-2/5" : "h-1/3"
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2">
            {BARS.map((b) => (
              <span key={b.year} className="flex-1 text-center font-mono text-micro tabular-nums text-muted">
                {b.year}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
