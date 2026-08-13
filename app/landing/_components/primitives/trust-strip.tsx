import { Database, Scale, KeyRound, BadgeCheck, type LucideIcon } from "lucide-react";
import { TRUST_CLAIMS } from "../../landing-config";

/**
 * TrustStrip: the row of trust claims (Local-first, Deterministic, Your own
 * key, No subscription). It renders exactly ONCE on the page, closing the
 * Solution section; the hero and final-CTA rebuilds removed their copies so
 * the page states these claims a single time, where they substantiate the
 * section's argument. The copy lives in landing-config.ts and the icons here.
 *
 * Layout contract (audit-landing.mjs asserts it):
 *   - equal-width columns (grid-cols-4, 2x2 below md),
 *   - centred within the measure-content container,
 *   - a min-height on each item plus top-aligned text so one-line and
 *     two-line sub-labels never stagger the label baselines (spread = 0).
 *
 * Variants: "bare" is the one in use (Solution). "contained" (bordered pill)
 * and "stacked" (icon above label) are kept for reuse but have no caller.
 */
const ICONS: LucideIcon[] = [Database, Scale, KeyRound, BadgeCheck];

export function TrustStrip({
  variant = "bare",
  className = "",
}: {
  variant?: "contained" | "bare" | "stacked";
  className?: string;
}) {
  if (variant === "stacked") {
    return (
      <ul data-trust-strip className={`grid w-full grid-cols-2 md:grid-cols-4 ${className}`}>
        {TRUST_CLAIMS.map((item, i) => {
          const Icon = ICONS[i];
          return (
            <li
              key={item.label}
              className={`flex min-h-32 flex-col items-center gap-3 px-4 py-5 text-center ${
                i > 0 ? "border-l border-hairline max-md:odd:border-l-0" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand/18 bg-brand/10 text-brand"
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <p data-trust-label className="text-mk-small font-semibold text-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-mk-small text-muted">{item.sub}</p>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const strip = (
    <ul className="grid w-full grid-cols-2 md:grid-cols-4">
      {TRUST_CLAIMS.map((item, i) => {
        const Icon = ICONS[i];
        return (
          <li
            key={item.label}
            className={`flex min-h-18 items-start gap-3 px-5 py-4 ${
              i > 0 ? "border-l border-hairline max-md:odd:border-l-0" : ""
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand/18 bg-brand/10 text-brand"
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p data-trust-label className="text-mk-small font-semibold text-foreground">
                {item.label}
              </p>
              <p className="text-mk-small text-muted">{item.sub}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (variant === "contained") {
    return (
      <div data-trust-strip className={`w-full rounded-panel border border-border bg-surface/60 ${className}`}>
        {strip}
      </div>
    );
  }
  return (
    <div data-trust-strip className={`w-full ${className}`}>
      {strip}
    </div>
  );
}
