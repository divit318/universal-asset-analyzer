import { Card } from "@/app/_components/ui";
import { BeforeAfter } from "./metric-row";

/**
 * Replaces the "you already hold X" line that used to be buried inside the
 * generic ⚠ warnings list (position-size-explain.ts's buildTransactionWarnings).
 * Adding to a position you already like is normal, expected behavior, not a
 * caution — so it gets its own informational card instead of a warning icon.
 */
export function ExistingPositionNote({
  name,
  currentPct,
  afterPct,
  capPct,
}: {
  name: string;
  currentPct: number;
  afterPct: number;
  capPct: number;
}) {
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <p className="text-[12px] text-foreground">
        You already own <span className="font-semibold">{name}</span>. This purchase increases your existing position rather than opening a new one.
      </p>
      <BeforeAfter label="Allocation" before={`${currentPct.toFixed(1)}%`} after={`${afterPct.toFixed(1)}%`} />
      <p className="text-[11px] text-muted">
        {afterPct < capPct
          ? `This remains comfortably below your ${capPct}% maximum recommended allocation.`
          : `This approaches your ${capPct}% maximum recommended allocation.`}
      </p>
    </Card>
  );
}
