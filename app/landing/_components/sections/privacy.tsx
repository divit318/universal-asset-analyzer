import { Cloud, ShieldCheck, Lock, WifiOff } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Local-First Privacy — the product's moat, stated plainly (Creative Direction
 * §6.4). Copy is the approved §9 final wording. A split contrast (cloud AI vs
 * UAA) plus the concrete local-first guarantees.
 */
const GUARANTEES = [
  { icon: WifiOff, label: "Research database stored on your disk" },
  { icon: Lock, label: "Your own AI key, kept on this machine" },
  { icon: ShieldCheck, label: "No subscriptions" },
];

export function Privacy({ section, index }: SectionProps) {
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
            Local-first. Your data stays yours.
          </h2>
          <p className="text-pretty text-base leading-relaxed text-muted">
            Your portfolios, notes, and research live in a database on your disk — never on our
            servers, because there are none. AI narration runs on Claude with your own key.
          </p>
        </div>

        {/* Contrast: traditional cloud AI vs UAA. */}
        <div className="grid w-full gap-4 sm:grid-cols-2">
          <div className="flex flex-col items-center gap-3 rounded-panel border border-border bg-surface-2 p-6 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-faint">
              <Cloud className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <p className="text-sm font-semibold text-muted">Traditional AI tools</p>
            <p className="text-caption leading-relaxed text-faint">
              Your research history lives in someone else’s account system, on someone else’s
              servers, behind someone else’s subscription.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 rounded-panel border border-brand/30 bg-brand-muted p-6 text-center shadow-glow-brand">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/15 text-brand">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <p className="text-sm font-semibold text-foreground">Universal Asset Analyzer</p>
            <p className="text-caption leading-relaxed text-muted">
              Your data and every computed figure stay on your machine. Only the AI prompts you
              trigger go to the Anthropic API — with your key, under your control.
            </p>
          </div>
        </div>

        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {GUARANTEES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-sm text-foreground">
              <Icon className="h-4 w-4 text-brand" strokeWidth={2} />
              {label}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
