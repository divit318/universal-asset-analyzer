import Link from "next/link";
import { Card, SectionHeader, StatTile } from "@/app/_components/ui";
import type { MissionControlDigest } from "@/lib/mission-control";

function pct(v: number | null, digits = 0): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function CalibrationCard({ calibration }: { calibration: MissionControlDigest["calibration"] }) {
  const tr = calibration.trackRecord;
  if (!tr) return null;

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader label="Your Decision Calibration" />
        <Link href="/journal" className="shrink-0 text-xs text-brand hover:underline">Full journal →</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Hit Rate"
          value={pct(tr.hitRate)}
          tone={tr.hitRate != null && tr.hitRate >= 0.5 ? "positive" : "negative"}
          sublabel={`${tr.scored} scored`}
        />
        <StatTile
          label="Avg Return"
          value={pct(tr.avgReturnPct, 1)}
          tone={tr.avgReturnPct != null && tr.avgReturnPct >= 0 ? "positive" : "negative"}
        />
        <StatTile label="Open" value={String(tr.open)} />
        <StatTile label="Closed" value={String(tr.closed)} />
      </div>
    </Card>
  );
}
