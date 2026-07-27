/**
 * FeedRow — one entry in the Timeline / Intelligence feeds.
 *
 * Shared so the two feeds (full chronological vs. high-signal subset) render
 * identically; they differ only in which items lib/home/timeline.ts hands them.
 */

import Link from "next/link";
import { Activity, Bell, TriangleAlert, CalendarClock } from "lucide-react";
import type { TimelineItem, TimelineKind, TimelineTone } from "@/lib/home/contracts";
import { relativeTime, countdown } from "./format";

const TONE_DOT: Record<TimelineTone, string> = {
  positive: "bg-positive",
  negative: "bg-negative",
  warning: "bg-warning",
  neutral: "bg-muted",
};

const KIND_ICON: Record<TimelineKind, typeof Activity> = {
  activity: Activity,
  notification: Bell,
  alert: TriangleAlert,
  event: CalendarClock,
};

export function FeedRow({ item }: { item: TimelineItem }) {
  const Icon = KIND_ICON[item.kind];
  const time = item.upcoming ? countdown(item.at) : relativeTime(item.at);

  const body = (
    <div className="flex items-start gap-2.5 rounded-control px-1.5 py-1.5 transition-colors group-hover:bg-surface-2/50">
      <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
        <span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${TONE_DOT[item.tone]}`} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          {item.symbol ? <span className="font-mono text-[11px] font-semibold text-brand">{item.symbol}</span> : null}
          <span className="truncate text-[13px] font-medium text-foreground/90">{item.title}</span>
        </div>
        {item.detail ? <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{item.detail}</p> : null}
      </div>
      <span className={`shrink-0 whitespace-nowrap text-[10px] tabular-nums ${item.upcoming ? "font-medium text-brand" : "text-muted"}`}>
        {time}
      </span>
    </div>
  );

  return item.href ? (
    <li className="group">
      <Link href={item.href} className="block outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
        {body}
      </Link>
    </li>
  ) : (
    <li className="group">{body}</li>
  );
}
