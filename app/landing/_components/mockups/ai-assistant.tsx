import { Sparkles, Check, ArrowUp, FileText } from "lucide-react";

/**
 * AI Research Assistant mockup — static, hand-authored sample data. A user
 * question chip, an assistant response whose five findings each cite a
 * specific figure (prominent, tabular monospace), a sources row, suggested
 * follow-ups, and a follow-up input pinned to the frame bottom.
 *
 * Signature: the findings check in sequence (opacity, 120ms apart) once the
 * mockup lands, driven by the ancestor [data-reveal] state.
 */
const FINDINGS: { text: React.ReactNode }[] = [
  {
    text: (
      <>
        Revenue grew <b className="font-mono font-semibold tabular-nums text-foreground">+5%</b> YoY to{" "}
        <b className="font-mono font-semibold tabular-nums text-foreground">$90.8B</b>, driven by Services and Wearables.
      </>
    ),
  },
  {
    text: (
      <>
        Gross margin expanded to <b className="font-mono font-semibold tabular-nums text-foreground">46.6%</b>, up{" "}
        <b className="font-mono font-semibold tabular-nums text-foreground">1.5pp</b> YoY.
      </>
    ),
  },
  {
    text: (
      <>
        iPhone sales were flat YoY, while Services hit a record{" "}
        <b className="font-mono font-semibold tabular-nums text-foreground">$23.1B</b>.
      </>
    ),
  },
  {
    text: (
      <>
        Operating cash flow reached <b className="font-mono font-semibold tabular-nums text-foreground">$28.2B</b>;
        the board added <b className="font-mono font-semibold tabular-nums text-foreground">$110B</b> to buybacks.
      </>
    ),
  },
  {
    text: <>Company raised FY guidance, citing strong demand and cost discipline.</>,
  },
];

const SOURCES = ["10-Q, Q2 FY25", "Earnings call transcript", "8-K, May 2"];
const FOLLOW_UPS = ["Compare with Microsoft's quarter", "Chart Services growth"];

export function AiAssistantMockup() {
  return (
    <div className="flex h-full flex-col p-4 text-left">
      {/* User message */}
      <div className="flex justify-end">
        <p className="rounded-panel rounded-br-sm bg-surface-3 px-3.5 py-2 text-caption text-foreground">
          Summarize Apple&apos;s Q2 earnings call.
        </p>
      </div>

      {/* Assistant response — flex-1 + evenly distributed findings so the
          stretched 16:10 interior never pools dead space above the input. */}
      <div className="mt-3 flex flex-1 gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-caption text-foreground">
            Here are the key takeaways from Apple&apos;s Q2 earnings call:
          </p>
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2">
            {FINDINGS.map((f, i) => (
              <li
                key={i}
                style={{ transitionDelay: `${700 + i * 120}ms` }}
                className="flex items-start gap-2 text-caption leading-relaxed text-muted transition-opacity duration-[700ms] [[data-reveal=hidden]_&]:opacity-0"
              >
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" strokeWidth={2.5} />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-micro uppercase tracking-wide text-muted">Sources</span>
            {SOURCES.map((src) => (
              <span
                key={src}
                className="flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-micro text-muted"
              >
                <FileText className="h-2.5 w-2.5" strokeWidth={2} />
                {src}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Suggested follow-ups + input pinned to the frame bottom. */}
      <div className="mt-auto flex flex-col gap-2 pt-3">
        <div className="flex flex-wrap gap-1.5">
          {FOLLOW_UPS.map((q) => (
            <span key={q} className="rounded-full border border-brand/25 bg-brand/8 px-2.5 py-1 text-micro text-brand">
              {q}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-2 py-1.5 pl-4 pr-1.5">
          <span className="flex-1 text-caption text-muted">Ask a follow-up…</span>
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-background"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
        </div>
      </div>
    </div>
  );
}
