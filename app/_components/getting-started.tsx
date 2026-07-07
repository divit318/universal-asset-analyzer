"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

interface SetupState {
  hasPortfolio: boolean;
  hasWatchlist: boolean;
  hasAlerts: boolean;
  hasDecisions: boolean;
}

interface Step {
  key: keyof SetupState;
  title: string;
  desc: string;
  href: string;
  cta: string;
}

const STEPS: Step[] = [
  { key: "hasPortfolio", title: "Build your portfolio", desc: "Add what you own to track live P&L, XIRR, and how you're doing vs the S&P.", href: "/portfolio", cta: "Add a holding" },
  { key: "hasWatchlist", title: "Track names to watch", desc: "Follow stocks you're considering before you commit capital.", href: "/watchlist", cta: "Open watchlist" },
  { key: "hasAlerts", title: "Turn on alerts", desc: "Set a price target or drop alert and the app will notify you when it triggers.", href: "/watchlist", cta: "Set an alert" },
  { key: "hasDecisions", title: "Start your track record", desc: "Log a call with your conviction, then measure whether you were right.", href: "/journal", cta: "Log a decision" },
];

/**
 * First-run guide — a stateful checklist that turns UAA's breadth into a path.
 * Reflects real setup state (portfolio, watchlist, alerts, journal) and hides
 * itself once the user is set up, so it never nags an established user.
 */
export function GettingStarted() {
  const [state, setState] = useState<SetupState | null>(null);

  useEffect(() => {
    let alive = true;
    async function probe() {
      try {
        const [pf, wl, dj] = await Promise.all([
          fetch("/api/portfolio").then((r) => r.json()),
          fetch("/api/watchlist").then((r) => r.json()),
          fetch("/api/decisions").then((r) => r.json()),
        ]);
        if (!alive) return;
        const watchItems: { targetPrice?: number | null; alertPctDrop?: number | null }[] = wl.items ?? [];
        setState({
          hasPortfolio: (pf.positions?.length ?? 0) > 0,
          hasWatchlist: watchItems.length > 0,
          hasAlerts: watchItems.some((i) => i.targetPrice != null || i.alertPctDrop != null),
          hasDecisions: (dj.decisions?.length ?? 0) > 0,
        });
      } catch {
        /* best-effort — stay hidden on failure */
      }
    }
    void probe();
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return null;
  const done = STEPS.filter((s) => state[s.key]).length;
  if (done === STEPS.length) return null; // fully set up — don't nag

  const next = STEPS.find((s) => !state[s.key]);

  return (
    <section className="flex flex-col gap-4 rounded-card border border-brand/25 bg-brand-muted/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Get set up</h2>
          <p className="text-xs text-muted">A few steps to make the platform work for you.</p>
        </div>
        <span className="font-mono text-xs text-muted">{done} / {STEPS.length} done</span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {STEPS.map((s) => {
          const complete = state[s.key];
          const isNext = s.key === next?.key;
          return (
            <Link
              key={s.key}
              href={s.href}
              className={`group flex items-start gap-3 rounded-control border p-3 transition-colors ${
                complete
                  ? "border-border bg-surface/60 opacity-70"
                  : isNext
                    ? "border-brand/40 bg-surface"
                    : "border-border bg-surface hover:border-brand/40"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                  complete ? "border-positive/50 bg-positive/15 text-positive" : "border-border text-faint"
                }`}
              >
                {complete ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`text-sm font-medium ${complete ? "text-muted line-through" : "text-foreground"}`}>{s.title}</span>
                {!complete && <span className="text-xs leading-5 text-muted">{s.desc}</span>}
                {!complete && (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand">
                    {s.cta}
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
