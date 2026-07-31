"use client";

import { ArrowUpRight } from "lucide-react";
import type { ThematicReport } from "@/lib/thematic-engine";
import { Reveal } from "@/app/_components/reveal";
import { Empty } from "./shared";

/**
 * The theme's live news, which the engine has always fetched and the page never
 * showed — 40 headlines gathered on every run and thrown away, while the report
 * had no answer at all to "why now?".
 */
export function SignalsTab({ report }: { report: ThematicReport }) {
  if (report.newsItems.length === 0) {
    return (
      <Empty>
        No recent headline mentions this theme by name. That&apos;s a signal in itself — a theme with no news flow is
        either very early or out of favour, and the policy read above had no live evidence to work from.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        Every headline the policy stage actually read, newest first. This is the evidence behind &ldquo;why now&rdquo; —
        and the place to check whether the AI&apos;s policy read is grounded.
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border">
        {report.newsItems.map((n, i) => (
          <Reveal
            key={`${n.url}-${i}`}
            index={i}
            as="div"
            className="group transition-colors hover:bg-surface-2"
          >
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-4 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <div className="min-w-0">
                <p className="text-sm leading-snug group-hover:text-brand">{n.headline}</p>
                <p className="mt-1 flex items-center gap-2 text-label uppercase tracking-wide text-muted/70">
                  <span>{n.source}</span>
                  <span className="text-faint">·</span>
                  <time dateTime={n.publishedAt}>{new Date(n.publishedAt).toLocaleDateString()}</time>
                </p>
              </div>
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-brand" strokeWidth={2} />
            </a>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
