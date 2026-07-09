import Link from "next/link";
import { Card, SectionHeader } from "@/app/_components/ui";
import type { MissionControlDigest } from "@/lib/mission-control";

const SEVERITY_DOT: Record<"high" | "medium" | "low", string> = {
  high: "bg-negative",
  medium: "bg-warning",
  low: "bg-muted",
};

export function ActionQueueCard({ actionQueue }: { actionQueue: MissionControlDigest["actionQueue"] }) {
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <SectionHeader label="What Requires Action" />
      {actionQueue.items.length === 0 ? (
        <p className="text-sm text-muted">Nothing urgent right now — you&apos;re caught up.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {actionQueue.items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-start gap-2.5 rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-surface-2"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[item.severity]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-5 text-foreground">{item.title}</p>
                  <p className="truncate text-xs text-muted">{item.description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
