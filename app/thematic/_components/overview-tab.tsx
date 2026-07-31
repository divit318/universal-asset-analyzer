"use client";

import type { ThematicReport, PolicyItem } from "@/lib/thematic-engine";
import { Badge, Card } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { formatPercent, toneClass } from "@/lib/format";
import { Bullets, Chips, Label, StageScore, TierBadge } from "./shared";
import { CompanyTable } from "./companies-tab";

function Panel({
  title,
  score,
  index,
  children,
  className = "",
  evidenced = true,
}: {
  title: string;
  score?: number;
  index: number;
  children: React.ReactNode;
  className?: string;
  /** False when this panel's stage fell back to a neutral default — the
   *  contents below are placeholders, and must never read as findings. */
  evidenced?: boolean;
}) {
  return (
    <Reveal index={index} className={className}>
      <Card padding="md" className="h-full">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {!evidenced && (
              <Badge variant="warning" className="normal-case tracking-normal">
                unevidenced — neutral default
              </Badge>
            )}
          </div>
          {score !== undefined &&
            (evidenced ? (
              <StageScore value={score} />
            ) : (
              /* Mirrors the factor strip: an assumption renders as absence,
                 never as a number that looks measured. */
              <span className="shrink-0 font-mono text-lg font-semibold text-faint">
                —<span className="text-xs font-normal text-muted">/10</span>
              </span>
            ))}
        </div>
        {children}
      </Card>
    </Reveal>
  );
}

export function OverviewTab({ report }: { report: ThematicReport }) {
  const { futureState, bottleneck, supplyDemand, commodityFramework, policy, structuralAdvantage, opportunity } = report;
  // Stage names as the engine records failures — a panel whose stage fell
  // back to a neutral default must say so, or its defaults read as findings.
  const failed = new Set(report.integrity.missingStages);
  const sdEvidenced = !failed.has("Supply/Demand");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Future state" score={futureState.inevitabilityScore} index={0} evidenced={!failed.has("Future State")}>
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted">Horizon to mainstream</span>
            <span className="font-medium">{futureState.timeHorizon}</span>
          </div>
          <div>
            <Label>Driving forces</Label>
            <Bullets items={futureState.drivingForces} />
          </div>
          <p className="text-xs leading-relaxed text-muted">{futureState.rationale}</p>
        </div>
      </Panel>

      <Panel title="Bottleneck" score={bottleneck.score} index={1} evidenced={!failed.has("Bottleneck")}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={bottleneck.bottleneckTier} />
            <span className="text-sm font-medium">Tier {bottleneck.bottleneckTier} constrains the chain</span>
            <Badge variant={bottleneck.substituteRisk === "low" ? "positive" : bottleneck.substituteRisk === "medium" ? "warning" : "negative"}>
              {bottleneck.substituteRisk} substitute risk
            </Badge>
          </div>
          <p className="text-sm leading-relaxed">{bottleneck.bottleneckDescription}</p>
          <div>
            <Label>Why it&apos;s hard to replicate</Label>
            <Chips items={bottleneck.scarceFactors} />
          </div>
          {bottleneck.expansionDifficulty && (
            <p className="text-xs leading-relaxed text-muted">{bottleneck.expansionDifficulty}</p>
          )}
        </div>
      </Panel>

      <Panel title="Supply–demand cycle" score={supplyDemand.score} index={2} className="lg:col-span-2" evidenced={sdEvidenced}>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["Demand", supplyDemand.demandTrajectory, supplyDemand.demandTrajectory === "accelerating" || supplyDemand.demandTrajectory === "growing"],
                ["Supply", supplyDemand.supplyTrajectory, supplyDemand.supplyTrajectory === "constrained" || supplyDemand.supplyTrajectory === "tight"],
                ["Cycle phase", supplyDemand.capitalCyclePhase, supplyDemand.capitalCyclePhase === "early"],
                ["Entry signal", supplyDemand.investmentSignal, supplyDemand.investmentSignal === "strong"],
              ] as [string, string, boolean][]
            ).map(([label, value, good]) => (
              <div key={label} className="flex flex-col gap-0.5 rounded-control border border-border bg-surface-2 px-3 py-2.5">
                <span className="text-label font-semibold uppercase tracking-widest text-muted/70">{label}</span>
                {/* A defaulted enum drawn in full colour reads as a measured
                    one — grey it when the stage never actually answered. */}
                <span className={`text-sm font-semibold capitalize ${!sdEvidenced ? "text-faint" : good ? "text-positive" : "text-foreground"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div>
            <Label>Market proxies</Label>
            {supplyDemand.commodityProxies.length === 0 ? (
              /* Honest absence. This used to show Gold and Crude Oil for any
                 unmatched theme — and feed them to the model as evidence. */
              <p className="text-xs leading-relaxed text-faint">
                No tradable proxy maps cleanly to this theme, so the cycle read below is qualitative only.
              </p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-card border border-border">
                {supplyDemand.commodityProxies.map((p, i) => (
                  <Reveal key={p.ticker} index={i} className="flex items-center justify-between gap-4 px-3 py-2.5">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-mono text-xs font-semibold">{p.ticker}</span>
                      <span className="truncate text-label text-muted">{p.name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 font-mono text-xs tabular-nums">
                      <span className="text-muted">{p.price != null ? `$${p.price.toFixed(2)}` : "—"}</span>
                      {([["1M", p.priceChange1M], ["3M", p.priceChange3M], ["1Y", p.priceChange1Y]] as [string, number | null][]).map(
                        ([period, change]) => (
                          <span key={period} className="flex flex-col items-end leading-tight">
                            <span className={toneClass(change)}>{formatPercent(change, 1)}</span>
                            <span className="text-label text-muted/60">{period}</span>
                          </span>
                        ),
                      )}
                    </div>
                  </Reveal>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Demand drivers</Label>
              <Bullets items={supplyDemand.demandDrivers} tone="positive" />
            </div>
            <div>
              <Label>Supply constraints</Label>
              <Bullets items={supplyDemand.supplyConstraints} tone="negative" />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Commodity framework" score={commodityFramework.score} index={3} evidenced={!failed.has("Commodity Framework")}>
        <div className="flex flex-col gap-4">
          <div>
            <Label>Primary commodities</Label>
            <Chips items={commodityFramework.primaryCommodities} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Demand catalysts</Label>
              <Bullets items={commodityFramework.demandCatalysts} tone="positive" />
            </div>
            <div>
              <Label>Supply risks</Label>
              <Bullets items={commodityFramework.supplyRisks} tone="negative" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Substitution risk</span>
            <Badge variant={commodityFramework.substitutionRisk === "low" ? "positive" : commodityFramework.substitutionRisk === "high" ? "negative" : "warning"}>
              {commodityFramework.substitutionRisk}
            </Badge>
          </div>
          <dl className="flex flex-col gap-2 border-t border-border pt-3">
            <div>
              <dt className="text-label font-semibold uppercase tracking-widest text-muted/70">Reserve concentration</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted">{commodityFramework.reserveConcentration || "Not assessed."}</dd>
            </div>
            <div>
              <dt className="text-label font-semibold uppercase tracking-widest text-muted/70">Recycling economics</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted">{commodityFramework.recyclingEconomics || "Not assessed."}</dd>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel title="Policy & geopolitics" score={policy.score} index={4} evidenced={!failed.has("Policy")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">{policy.capitalFlowDirection || "No clear policy-driven capital flow identified."}</p>
          <PolicyTable policies={policy.relevantPolicies} />
          {policy.geopoliticalFactors.length > 0 && (
            <div>
              <Label>Geopolitical factors</Label>
              <Bullets items={policy.geopoliticalFactors} />
            </div>
          )}
          {policy.indiaSpecificPolicies.length > 0 && (
            <div>
              <Label>India-specific schemes</Label>
              <Chips items={policy.indiaSpecificPolicies} />
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Global structural advantage" score={structuralAdvantage.score} index={5} className="lg:col-span-2" evidenced={!failed.has("Global Structural Advantage")}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="positive">Leads: {structuralAdvantage.currentLeader}</Badge>
            <Badge variant="brand">Closing fastest: {structuralAdvantage.fastestImproving}</Badge>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed">{structuralAdvantage.longTermImplications}</p>
          {structuralAdvantage.regions.length === 0 ? (
            <p className="text-xs text-faint">No regional breakdown returned.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {structuralAdvantage.regions.map((r, i) => (
                <Reveal key={r.region} index={i} className="rounded-card border border-border bg-surface-2 p-3.5">
                  <div className="mb-2.5 text-xs font-semibold">{r.region}</div>
                  <div className="flex flex-col gap-2.5">
                    {r.advantages.length > 0 && <Bullets items={r.advantages} tone="positive" />}
                    {r.disadvantages.length > 0 && <Bullets items={r.disadvantages} tone="negative" />}
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {opportunity.topCompanies.length > 0 && (
        <Reveal index={6} className="lg:col-span-2">
          <Card padding="none">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight">Best expressions of this theme</h2>
              <p className="text-xs text-muted">Ranked by strategic importance, then composite quality, then leverage.</p>
            </div>
            <CompanyTable companies={opportunity.topCompanies} compact theme={report.theme} />
          </Card>
        </Reveal>
      )}
    </div>
  );
}

/* ─────────────────── Policy table ──────────────────────────────────── */

function PolicyTable({ policies }: { policies: PolicyItem[] }) {
  if (policies.length === 0) return <p className="text-xs text-faint">No specific policies identified.</p>;
  return (
    <div className="overflow-hidden rounded-card border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-2">
          <tr className="border-b border-border text-left text-label uppercase tracking-widest text-muted/70">
            <th className="px-3 py-2 font-semibold">Country</th>
            <th className="px-3 py-2 font-semibold">Policy</th>
            <th className="px-3 py-2 font-semibold">Capital</th>
            <th className="px-3 py-2 font-semibold">Impact</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {policies.map((p, i) => (
            <tr key={i} className="transition-colors hover:bg-surface-2">
              <td className="whitespace-nowrap px-3 py-2 font-semibold">{p.country}</td>
              <td className="px-3 py-2 leading-relaxed text-muted">{p.policy}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-muted">{p.estimatedCapitalUSD ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge variant={p.impact.includes("positive") ? "positive" : p.impact === "negative" ? "negative" : "neutral"}>
                  {p.impact}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
