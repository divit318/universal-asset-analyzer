import Link from "next/link";
import { LANDING_HOME, APP_ENTRY, NAV_SECTIONS } from "../landing-config";

/**
 * Marketing footer — minimal by design (Creative Direction §16). Brand mark,
 * the same anchor set as the header for quick jumps, and a final entry point
 * into the app. Purely static; no fabricated links, socials, or "trusted by"
 * metrics (reconciliation §G — nothing invented).
 */
export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Link href={LANDING_HOME} className="font-mono text-sm font-semibold tracking-tight">
            <span className="text-brand">◆</span>{" "}
            <span className="text-foreground">asset</span>
            <span className="text-faint">/</span>
            <span className="text-foreground">analyzer</span>
          </Link>
          <p className="max-w-xs text-caption text-muted">
            Institutional-grade equity research, powered by local AI — all on your computer.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2">
          {NAV_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="text-sm text-muted transition-colors hover:text-foreground">
              {s.nav}
            </a>
          ))}
        </nav>

        <Link
          href={APP_ENTRY}
          className="inline-flex h-9 shrink-0 items-center rounded-control bg-brand px-4 text-sm font-semibold text-background transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Experience UAA
        </Link>
      </div>

      <div className="border-t border-border">
        <p className="mx-auto w-full max-w-7xl px-6 py-4 text-micro text-faint">
          © {year} Universal Asset Analyzer. Runs locally. No cloud, no accounts.
        </p>
      </div>
    </footer>
  );
}
