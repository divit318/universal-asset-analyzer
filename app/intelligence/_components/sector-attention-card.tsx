import { Card, SectionHeader } from "@/app/_components/ui";
import type { MissionControlDigest } from "@/lib/mission-control";

export function SectorAttentionCard({ sectorAttention }: { sectorAttention: MissionControlDigest["sectorAttention"] }) {
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <SectionHeader label="Sector Rotation Attention" />
      {sectorAttention.changes.length === 0 ? (
        <p className="text-sm text-muted">No leadership changes in sectors you hold right now.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sectorAttention.changes.map((c) => {
            const improving = c.toRank < c.fromRank;
            return (
              <li key={c.sector} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{c.sector}</span>
                  {c.portfolioWeightPct != null && (
                    <span className="ml-2 text-xs text-muted">{c.portfolioWeightPct.toFixed(1)}% of your portfolio</span>
                  )}
                </div>
                <span className={`shrink-0 font-mono text-xs ${improving ? "text-positive" : "text-negative"}`}>
                  #{c.fromRank} → #{c.toRank}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
