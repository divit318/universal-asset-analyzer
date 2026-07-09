import Link from "next/link";
import { Card, SectionHeader, Badge } from "@/app/_components/ui";
import type { MissionControlDigest } from "@/lib/mission-control";

const FIT_TIER_VARIANT: Record<string, "positive" | "negative" | "warning" | "neutral"> = {
  excellent: "positive",
  good: "positive",
  neutral: "neutral",
  poor: "warning",
  avoid: "negative",
};

export function OpportunityRiskCard({ snapshot }: { snapshot: MissionControlDigest["opportunitySnapshot"] }) {
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader label="Risks & Opportunities" />
        {snapshot.scannerFreshness && (
          <span className="shrink-0 text-[10px] text-muted/70">Scanner data {snapshot.scannerFreshness.label}</span>
        )}
      </div>

      {snapshot.healthIssues.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Watch</p>
          {snapshot.healthIssues.map((issue) => (
            <div key={issue.title} className="text-sm">
              <p className="font-medium text-foreground">{issue.title}</p>
              <p className="text-xs text-muted">{issue.description}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Opportunities for you</p>
        {snapshot.status === "empty" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">No recent scan to draw opportunities from yet.</p>
            <Link href="/scanner" className="text-xs text-brand hover:underline">Run a scan →</Link>
          </div>
        ) : snapshot.opportunities.length === 0 ? (
          <p className="text-sm text-muted">No new opportunities outside your current holdings right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.opportunities.map((opp) => (
              <li key={opp.symbol}>
                <Link
                  href={`/research?symbol=${opp.symbol}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold">{opp.symbol}</span>
                    <span className="ml-2 text-xs text-muted">{opp.fitSummary}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={FIT_TIER_VARIANT[opp.fitTier] ?? "neutral"}>{opp.fitTier}</Badge>
                    <span className="font-mono text-xs text-muted">{opp.combinedScore}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {snapshot.status === "degraded" && (
          <Link href="/scanner" className="text-xs text-brand hover:underline">Refresh with a new scan →</Link>
        )}
      </div>
    </Card>
  );
}
