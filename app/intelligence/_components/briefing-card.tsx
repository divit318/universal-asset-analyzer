import { Card, Badge } from "@/app/_components/ui";
import type { MissionControlDigest } from "@/lib/mission-control";

export function BriefingCard({ briefing }: { briefing: MissionControlDigest["briefing"] }) {
  return (
    <Card variant="highlight" padding="lg">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted/60">Today&apos;s Briefing</h2>
        <Badge variant={briefing.aiGenerated ? "brand" : "neutral"}>
          {briefing.aiGenerated ? "AI Narrated" : "Summary"}
        </Badge>
      </div>
      <p className="mt-3 text-base leading-7 text-foreground/90">{briefing.text}</p>
    </Card>
  );
}
