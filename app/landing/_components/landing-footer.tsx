import Link from "next/link";
import { Mail, Lock } from "lucide-react";
import { BrandLockup } from "@/app/_components/brand";
import { LANDING_HOME, APP_ENTRY, NAV_SECTIONS, PRIMARY_ACTION } from "../landing-config";

/* lucide-react no longer ships brand glyphs; two minimal inline marks. */
function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.6 2H8l4.4 5.9L18.9 2Zm-1.1 18h1.7L7.1 3.9H5.3L17.8 20Z" />
    </svg>
  );
}

function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.7h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5.5c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V21h-4V9Z" />
    </svg>
  );
}

/**
 * Marketing footer — four columns: brand block (logo, description, social
 * tiles), two anchor-link columns, and the primary CTA right-aligned. Below a
 * hairline: the privacy sign-off and a copyright line whose year is computed
 * at build time, with no rights-reserved boilerplate.
 *
 * The social tiles are visual placeholders: UAA has no published social
 * accounts (nothing invented, reconciliation §G), so they render disabled
 * with an honest accessible name until real profiles exist.
 */
function MailGlyph() {
  return <Mail className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />;
}

const SOCIALS = [
  { icon: XGlyph, name: "X" },
  { icon: LinkedInGlyph, name: "LinkedIn" },
  { icon: MailGlyph, name: "Email" },
];

export function LandingFooter() {
  const year = new Date().getFullYear();
  const half = Math.ceil(NAV_SECTIONS.length / 2);
  const columns = [NAV_SECTIONS.slice(0, half), NAV_SECTIONS.slice(half)];

  return (
    <footer className="border-t border-border bg-surface">
      {/* 12-column grid on the content measure: brand 4, gutter 1, links 2+2,
          CTA 3 right-aligned (Phase 0.8). */}
      <div data-measure="content" className="mx-auto grid w-full max-w-measure-content gap-10 px-mk-pad py-14 sm:grid-cols-2 lg:grid-cols-12 lg:gap-y-0">
        <div className="flex flex-col items-start gap-4 lg:col-span-4">
          <BrandLockup href={LANDING_HOME} size="lg" />
          <p className="max-w-xs text-mk-small text-muted">
            Institutional-quality equity research that runs on your machine. Your data, your
            database, your key.
          </p>
          <div className="flex gap-2">
            {SOCIALS.map(({ icon: Icon, name }) => (
              <span
                key={name}
                aria-disabled="true"
                title={`${name} profile coming soon`}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 text-muted"
              >
                <Icon />
                <span className="sr-only">{name} profile, coming soon</span>
              </span>
            ))}
          </div>
        </div>

        {columns.map((col, i) => (
          <nav
            key={i}
            aria-label={i === 0 ? "Footer" : "Footer, continued"}
            className={`flex flex-col gap-2.5 lg:col-span-2 ${i === 0 ? "lg:col-start-6" : "lg:col-start-8"}`}
          >
            {col.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="w-fit rounded-control text-mk-body text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {s.nav}
              </a>
            ))}
          </nav>
        ))}

        <div className="lg:col-span-3 lg:col-start-10 lg:justify-self-end">
          <Link
            href={APP_ENTRY}
            className="group inline-flex h-11 shrink-0 items-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-background outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {PRIMARY_ACTION}
            <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-[3px]">
              →
            </span>
          </Link>
        </div>
      </div>

      <div className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-measure-content flex-col items-center gap-2 px-mk-pad py-6 text-center">
          <p className="flex items-center gap-2 text-mk-small text-muted">
            <Lock className="h-3.5 w-3.5 text-brand" strokeWidth={2} aria-hidden="true" />
            Built for privacy. Designed for serious investors.
          </p>
          <p className="font-mono text-caption tabular-nums text-muted">
            © {year} Universal Asset Analyzer. Local-first data. No subscriptions.
          </p>
        </div>
      </div>
    </footer>
  );
}
