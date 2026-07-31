"use client";

import type { ThematicReport } from "@/lib/thematic-engine";
import { Badge } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { Chips, Empty, Label, TierBadge } from "./shared";

export function ChainTab({ report }: { report: ThematicReport }) {
  if (report.dependencyChain.length === 0) {
    return (
      <Empty>
        The dependency chain stage returned no usable tiers for this theme, so there is nothing to show here rather
        than a chain we don&apos;t have. Re-run the report to try again — a larger local model maps the six tiers far
        more reliably.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        The value stack from end product down to recycling. The non-obvious tiers are the point — the obvious winner
        is usually the one already priced.
      </p>
      <div className="flex flex-col gap-2.5">
        {report.dependencyChain.map((node, i) => (
          <Reveal
            key={`${node.tier}-${i}`}
            index={i}
            className={`relative overflow-hidden rounded-card border p-4 transition-colors ${
              node.isBottleneck ? "border-warning/40 bg-warning/5" : "border-border bg-surface hover:border-border-strong"
            }`}
          >
            {/* A hairline rail carries the tier colour so the six tiers read as
                one connected stack rather than six unrelated cards. */}
            <span aria-hidden className={`absolute inset-y-3 left-0 w-0.5 rounded-full ${node.isBottleneck ? "bg-warning" : "bg-border-strong"}`} />
            <div className="flex flex-wrap items-center gap-2.5 pl-2">
              <TierBadge tier={node.tier} />
              <span className="text-sm font-semibold">{node.tierLabel}</span>
              {node.isBottleneck && <Badge variant="warning">Bottleneck</Badge>}
            </div>
            <p className="mt-2 pl-2 text-sm leading-relaxed text-muted">{node.description}</p>
            {node.exampleCompanies.length > 0 && (
              <div className="mt-3 pl-2">
                <Label>Representative players</Label>
                <Chips items={node.exampleCompanies} />
              </div>
            )}
          </Reveal>
        ))}
      </div>
    </div>
  );
}
