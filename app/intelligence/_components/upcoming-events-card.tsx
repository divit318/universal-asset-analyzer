import Link from "next/link";
import { Card, SectionHeader } from "@/app/_components/ui";
import type { MissionControlDigest } from "@/lib/mission-control";

function daysFromNow(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days}d`;
}

export function UpcomingEventsCard({ upcomingEvents }: { upcomingEvents: MissionControlDigest["upcomingEvents"] }) {
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader label="Upcoming Events" />
        <Link href="/calendar" className="shrink-0 text-xs text-brand hover:underline">Full calendar →</Link>
      </div>
      {upcomingEvents.events.length === 0 ? (
        <p className="text-sm text-muted">Nothing scheduled in the next 14 days.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {upcomingEvents.events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{e.name}</span>
                {e.symbol && <span className="ml-2 font-mono text-xs text-muted">{e.symbol}</span>}
              </div>
              <span className="shrink-0 text-xs text-muted">{daysLabel(daysFromNow(e.date))}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
