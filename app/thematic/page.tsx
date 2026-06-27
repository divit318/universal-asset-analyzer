"use client";

/**
 * /thematic — Industries & Commodities Discovery Framework
 *
 * 10-stage thematic analysis:
 *   Stage 1  Future State Identification
 *   Stage 2  Dependency Chain Mapping (6 tiers)
 *   Stage 3  Bottleneck Analysis
 *   Stage 4  Supply-Demand & Capital Cycle
 *   Stage 5  Commodity Framework
 *   Stage 6  Policy & Geopolitics
 *   Stage 7  India Leapfrog Analysis
 *   Stage 8  Company Tier Mapping
 *   Stage 9  Company Quality (from screener DB)
 *   Stage 10 Opportunity Score
 */

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import type {
  ThematicReport,
  ThematicProgressEvent,
  TierCompany,
  CommodityProxy,
  PolicyItem,
  AnalystChecklistItem,
} from "@/lib/thematic-engine";

/* ─────────────────── Preset themes ──────────────────────────────────── */

const PRESET_THEMES = [
  { label: "AI Compute", desc: "Data centers, chips, power" },
  { label: "Energy Storage", desc: "Batteries, lithium, grid" },
  { label: "Nuclear Energy", desc: "Uranium, SMRs, grid decarbonisation" },
  { label: "India Defence Modernisation", desc: "HAL, BEL, indigenisation" },
  { label: "Copper & Electrification", desc: "EVs, grids, copper bottleneck" },
  { label: "Water Infrastructure", desc: "Treatment, pipes, Jal Jeevan" },
  { label: "Rare Earth & Critical Minerals", desc: "Supply chain sovereignty" },
  { label: "India Semiconductor Fab", desc: "Leapfrog — PLI, ISMC, Micron" },
  { label: "Precision Robotics & Automation", desc: "Factory of the future" },
  { label: "Offshore Wind", desc: "Turbines, cables, ports, installation" },
];

/* ─────────────────── Stage metadata ────────────────────────────────── */

const STAGE_META: Record<string, { label: string; icon: string }> = {
  init:             { label: "Initialising",            icon: "◈" },
  future_state:     { label: "Future State",             icon: "1" },
  dependency_chain: { label: "Dependency Chain",         icon: "2" },
  bottleneck:       { label: "Bottleneck",               icon: "3" },
  supply_demand:    { label: "Supply / Demand",          icon: "4" },
  commodity:        { label: "Commodity Framework",      icon: "5" },
  policy:           { label: "Policy & Geopolitics",     icon: "6" },
  india_leapfrog:   { label: "India Leapfrog",           icon: "7" },
  company_mapping:  { label: "Company Mapping",          icon: "8" },
  company_quality:  { label: "Company Quality",          icon: "9" },
  opportunity_score:{ label: "Opportunity Score",        icon: "10" },
  done:             { label: "Complete",                 icon: "✓" },
  error:            { label: "Error",                    icon: "✗" },
};

/* ─────────────────── Helpers ───────────────────────────────────────── */

function Score({ value, max = 10, size = "md" }: { value: number; max?: number; size?: "sm" | "md" | "lg" }) {
  const pct = Math.round((value / max) * 100);
  const color = pct >= 70 ? "text-positive" : pct >= 40 ? "text-amber-400" : "text-negative";
  const sizeClass = size === "lg" ? "text-4xl font-bold" : size === "md" ? "text-2xl font-semibold" : "text-base font-semibold";
  return <span className={`font-mono ${color} ${sizeClass}`}>{value}<span className="text-muted text-sm font-normal">/{max}</span></span>;
}

function Badge({ label, variant }: { label: string; variant: "positive" | "negative" | "neutral" | "accent" }) {
  const cls = {
    positive: "bg-positive/15 text-positive border-positive/30",
    negative: "bg-negative/15 text-negative border-negative/30",
    neutral:  "bg-surface-2 text-muted border-border",
    accent:   "bg-accent/15 text-accent border-accent/30",
  }[variant];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
      {children}
    </span>
  );
}

function SectionCard({ title, score, max, children }: { title: string; score?: number; max?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {score !== undefined && <Score value={score} max={max ?? 10} />}
      </div>
      {children}
    </div>
  );
}

function SignalDot({ signal }: { signal: "positive" | "neutral" | "negative" }) {
  return (
    <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${signal === "positive" ? "bg-positive" : signal === "negative" ? "bg-negative" : "bg-muted"}`} />
  );
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function trendColor(trend: string) {
  return trend === "rising" ? "text-positive" : trend === "falling" ? "text-negative" : "text-muted";
}

const TIER_COLORS: Record<number, string> = {
  1: "bg-accent/15 text-accent border-accent/30",
  2: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  3: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  4: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  5: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  6: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

function TierBadge({ tier }: { tier: number }) {
  const cls = TIER_COLORS[tier] ?? "bg-surface-2 text-muted border-border";
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono font-semibold ${cls}`}>T{tier}</span>;
}

/* ─────────────────── Report view ───────────────────────────────────── */

function ThematicReportView({ report }: { report: ThematicReport }) {
  const [activeTab, setActiveTab] = useState<"overview" | "chain" | "companies" | "checklist">("overview");

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "chain" as const, label: "Dependency Chain" },
    { id: "companies" as const, label: `Companies (${report.tierCompanies.length})` },
    { id: "checklist" as const, label: "Analyst Checklist" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 text-xs uppercase tracking-widest text-muted">Thematic Report</div>
            <h1 className="text-2xl font-bold tracking-tight">{report.theme}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{new Date(report.generatedAt).toLocaleString()}</span>
              <span>·</span>
              <span className="font-mono">{report.model}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-xs text-muted uppercase tracking-wider">Opportunity Score</div>
            <Score value={report.opportunity.themeScore} max={100} size="lg" />
            <Badge
              label={report.opportunity.verdict.toUpperCase()}
              variant={
                report.opportunity.verdict === "exceptional" || report.opportunity.verdict === "strong" ? "positive" :
                report.opportunity.verdict === "avoid" || report.opportunity.verdict === "weak" ? "negative" : "neutral"
              }
            />
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted">{report.opportunity.verdictRationale}</p>

        {/* Score breakdown bar */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {(
            [
              ["Inevitability", report.opportunity.themeBreakdown.inevitability, 20],
              ["Bottleneck", report.opportunity.themeBreakdown.bottleneck, 20],
              ["Capital Cycle", report.opportunity.themeBreakdown.capitalCycle, 20],
              ["Demand Growth", report.opportunity.themeBreakdown.demandGrowth, 15],
              ["Policy", report.opportunity.themeBreakdown.policy, 10],
              ["Sub. Resistance", report.opportunity.themeBreakdown.substitutionResistance, 10],
              ["India Edge", report.opportunity.themeBreakdown.indiaAdvantage, 5],
            ] as [string, number, number][]
          ).map(([label, score, weight]) => (
            <div key={label} className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-2.5">
              <span className="text-center text-[10px] leading-tight text-muted">{label}</span>
              <span className="font-mono text-sm font-semibold">{score}</span>
              <span className="text-[10px] text-muted/60">wt {weight}%</span>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === t.id
                ? "border-b-2 border-accent font-medium text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab report={report} />}
      {activeTab === "chain" && <ChainTab report={report} />}
      {activeTab === "companies" && <CompaniesTab companies={report.tierCompanies} />}
      {activeTab === "checklist" && <ChecklistTab items={report.opportunity.analystChecklist} />}
    </div>
  );
}

/* ─────────────────── Overview tab ──────────────────────────────────── */

function OverviewTab({ report }: { report: ThematicReport }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">

      {/* Future State */}
      <SectionCard title="Future State" score={report.futureState.inevitabilityScore}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Horizon</span>
            <span className="font-medium">{report.futureState.timeHorizon}</span>
          </div>
          <div>
            <div className="mb-2 text-xs uppercase tracking-wider text-muted">Driving Forces</div>
            <ul className="flex flex-col gap-1">
              {report.futureState.drivingForces.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm leading-relaxed text-muted">{report.futureState.rationale}</p>
        </div>
      </SectionCard>

      {/* Bottleneck */}
      <SectionCard title="Bottleneck Analysis" score={report.bottleneck.score}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <TierBadge tier={report.bottleneck.bottleneckTier} />
            <span className="text-sm font-medium">Tier {report.bottleneck.bottleneckTier} bottleneck</span>
            <Badge
              label={`Substitute risk: ${report.bottleneck.substituteRisk}`}
              variant={report.bottleneck.substituteRisk === "low" ? "positive" : report.bottleneck.substituteRisk === "medium" ? "neutral" : "negative"}
            />
          </div>
          <p className="text-sm leading-relaxed">{report.bottleneck.bottleneckDescription}</p>
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Scarcity Factors</div>
            <div className="flex flex-wrap gap-1.5">
              {report.bottleneck.scarceFactors.map((f, i) => <Pill key={i}>{f}</Pill>)}
            </div>
          </div>
          <p className="text-xs text-muted">{report.bottleneck.expansionDifficulty}</p>
        </div>
      </SectionCard>

      {/* Supply / Demand */}
      <SectionCard title="Supply-Demand Cycle" score={report.supplyDemand.score}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Demand", report.supplyDemand.demandTrajectory],
                ["Supply", report.supplyDemand.supplyTrajectory],
                ["Cycle Phase", report.supplyDemand.capitalCyclePhase],
                ["Signal", report.supplyDemand.investmentSignal],
              ] as [string, string][]
            ).map(([label, val]) => (
              <div key={label} className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
                <span className="text-sm font-semibold capitalize">{val}</span>
              </div>
            ))}
          </div>

          {/* Commodity proxies */}
          {report.supplyDemand.commodityProxies.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Market Proxies</div>
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {report.supplyDemand.commodityProxies.map((p) => (
                  <div key={p.ticker} className="flex items-center justify-between gap-4 bg-surface px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold font-mono">{p.ticker}</span>
                      <span className="text-[10px] text-muted">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono">
                      {p.price != null && <span>${p.price.toFixed(2)}</span>}
                      <span className={pct(p.priceChange1M) === "—" ? "text-muted" : p.priceChange1M! > 0 ? "text-positive" : "text-negative"}>{pct(p.priceChange1M)} 1M</span>
                      <span className={pct(p.priceChange3M) === "—" ? "text-muted" : p.priceChange3M! > 0 ? "text-positive" : "text-negative"}>{pct(p.priceChange3M)} 3M</span>
                      <span className={trendColor(p.trend) + " capitalize font-semibold"}>{p.trend}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Demand Drivers</div>
              <ul className="flex flex-col gap-1">
                {report.supplyDemand.demandDrivers.map((d, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                    <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-positive" />{d}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Supply Constraints</div>
              <ul className="flex flex-col gap-1">
                {report.supplyDemand.supplyConstraints.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                    <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-negative" />{c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Commodity Framework */}
      <SectionCard title="Commodity Framework" score={report.commodityFramework.score}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {report.commodityFramework.primaryCommodities.map((c, i) => (
              <Badge key={i} label={c} variant="accent" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Demand Catalysts</div>
              <ul className="flex flex-col gap-1">
                {report.commodityFramework.demandCatalysts.map((d, i) => (
                  <li key={i} className="text-xs text-muted">• {d}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Supply Risks</div>
              <ul className="flex flex-col gap-1">
                {report.commodityFramework.supplyRisks.map((r, i) => (
                  <li key={i} className="text-xs text-muted">• {r}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Substitution risk:</span>
            <Badge label={report.commodityFramework.substitutionRisk} variant={report.commodityFramework.substitutionRisk === "low" ? "positive" : report.commodityFramework.substitutionRisk === "high" ? "negative" : "neutral"} />
          </div>
          <p className="text-xs text-muted leading-relaxed">{report.commodityFramework.reserveConcentration}</p>
          <p className="text-xs text-muted leading-relaxed">{report.commodityFramework.recyclingEconomics}</p>
        </div>
      </SectionCard>

      {/* Policy */}
      <SectionCard title="Policy & Geopolitics" score={report.policy.score}>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-muted">{report.policy.capitalFlowDirection}</p>
          <PolicyTable policies={report.policy.relevantPolicies} />
          {report.policy.indiaSpecificPolicies.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">India-Specific Policies</div>
              <div className="flex flex-wrap gap-1.5">
                {report.policy.indiaSpecificPolicies.map((p, i) => <Pill key={i}>{p}</Pill>)}
              </div>
            </div>
          )}
          {report.policy.geopoliticalFactors.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Geopolitical Factors</div>
              <ul className="flex flex-col gap-1">
                {report.policy.geopoliticalFactors.map((f, i) => (
                  <li key={i} className="text-xs text-muted">• {f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SectionCard>

      {/* India Leapfrog */}
      <SectionCard title="India Leapfrog Analysis" score={report.indiaLeapfrog.score}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge
              label={report.indiaLeapfrog.canLeapfrog ? "Can Leapfrog" : "No Clear Leapfrog"}
              variant={report.indiaLeapfrog.canLeapfrog ? "positive" : "neutral"}
            />
          </div>
          <p className="text-sm leading-relaxed">{report.indiaLeapfrog.leapfrogMechanism}</p>
          {report.indiaLeapfrog.analogies.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Analogies</div>
              <div className="flex flex-wrap gap-1.5">
                {report.indiaLeapfrog.analogies.map((a, i) => <Badge key={i} label={a} variant="accent" />)}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Advantages</div>
              <ul className="flex flex-col gap-1">
                {report.indiaLeapfrog.indianAdvantages.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                    <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-positive" />{a}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Challenges</div>
              <ul className="flex flex-col gap-1">
                {report.indiaLeapfrog.indianChallenges.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                    <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-negative" />{c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Top Companies from screener */}
      {report.opportunity.topCompanies.length > 0 && (
        <div className="lg:col-span-2">
          <SectionCard title="Top Companies by Theme Relevance">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                    <th className="pb-2 pr-4">Ticker</th>
                    <th className="pb-2 pr-4">Company</th>
                    <th className="pb-2 pr-4">Tier</th>
                    <th className="pb-2 pr-4">Importance</th>
                    <th className="pb-2 pr-4">Moat</th>
                    <th className="pb-2 pr-4 text-right">ROIC</th>
                    <th className="pb-2 pr-4 text-right">Rev Growth</th>
                    <th className="pb-2">Rationale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.opportunity.topCompanies.map((c) => (
                    <tr key={c.symbol} className="hover:bg-surface-2">
                      <td className="py-2 pr-4">
                        <Link href={`/stocks/${encodeURIComponent(c.symbol)}`} className="font-mono font-semibold text-accent hover:underline">
                          {c.symbol}
                        </Link>
                      </td>
                      <td className="max-w-[10rem] truncate py-2 pr-4 text-muted">{c.name}</td>
                      <td className="py-2 pr-4"><TierBadge tier={c.tier} /></td>
                      <td className="py-2 pr-4">
                        <Badge
                          label={c.strategicImportance}
                          variant={c.strategicImportance === "critical" ? "negative" : c.strategicImportance === "high" ? "accent" : "neutral"}
                        />
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted capitalize">{c.moatType}</td>
                      <td className="py-2 pr-4 text-right font-mono text-xs">{c.roic != null ? `${c.roic.toFixed(1)}%` : "—"}</td>
                      <td className="py-2 pr-4 text-right font-mono text-xs">
                        {c.revenueGrowthYoY != null
                          ? <span className={c.revenueGrowthYoY > 0 ? "text-positive" : "text-negative"}>{pct(c.revenueGrowthYoY)}</span>
                          : "—"}
                      </td>
                      <td className="py-2 max-w-[16rem] text-xs text-muted">{c.relevanceRationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Dependency Chain tab ───────────────────────────── */

function ChainTab({ report }: { report: ThematicReport }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Dependency chain maps the full value stack from end-product down to recycling.
        Elite investors study the non-obvious tiers — never stop at the obvious winner.
      </p>
      {report.dependencyChain.map((node) => (
        <div
          key={node.tier}
          className={`rounded-xl border p-5 ${node.isBottleneck ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-surface"}`}
        >
          <div className="mb-3 flex items-center gap-3">
            <TierBadge tier={node.tier} />
            <span className="font-semibold">{node.tierLabel}</span>
            {node.isBottleneck && (
              <Badge label="BOTTLENECK" variant="negative" />
            )}
          </div>
          <p className="mb-3 text-sm leading-relaxed text-muted">{node.description}</p>
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Example Companies</div>
            <div className="flex flex-wrap gap-1.5">
              {node.exampleCompanies.map((c, i) => <Pill key={i}>{c}</Pill>)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────── Companies tab ──────────────────────────────────── */

function CompaniesTab({ companies }: { companies: TierCompany[] }) {
  const [filterTier, setFilterTier] = useState<number | null>(null);
  const [filterIndia, setFilterIndia] = useState(false);

  const tiers = Array.from(new Set(companies.map((c) => c.tier))).sort();
  const filtered = companies.filter(
    (c) => (filterTier == null || c.tier === filterTier) && (!filterIndia || c.isIndia),
  );

  const byTier = tiers.reduce<Record<number, TierCompany[]>>((acc, t) => {
    acc[t] = filtered.filter((c) => c.tier === t);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilterTier(null)}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${filterTier == null ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:border-accent"}`}
        >
          All tiers
        </button>
        {tiers.map((t) => (
          <button
            key={t}
            onClick={() => setFilterTier(filterTier === t ? null : t)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${filterTier === t ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:border-accent"}`}
          >
            Tier {t}
          </button>
        ))}
        <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={filterIndia} onChange={(e) => setFilterIndia(e.target.checked)} className="accent-accent" />
          India only
        </label>
        <span className="ml-auto text-xs text-muted">{filtered.length} companies</span>
      </div>

      {tiers.map((t) => {
        const rows = byTier[t];
        if (!rows || rows.length === 0) return null;
        const tierLabel = rows[0].tierLabel;
        return (
          <div key={t} className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2.5">
              <TierBadge tier={t} />
              <span className="text-sm font-semibold">{tierLabel}</span>
              <span className="text-xs text-muted">{rows.length} companies</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-2">Symbol</th>
                    <th className="px-4 py-2">Company</th>
                    <th className="px-4 py-2">Sector</th>
                    <th className="px-4 py-2">Importance</th>
                    <th className="px-4 py-2">Moat</th>
                    <th className="px-4 py-2 text-right">ROIC</th>
                    <th className="px-4 py-2 text-right">Margin</th>
                    <th className="px-4 py-2 text-right">Rev Growth</th>
                    <th className="px-4 py-2 text-right">D/E</th>
                    <th className="px-4 py-2">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((c) => (
                    <tr key={c.symbol} className="hover:bg-surface-2">
                      <td className="px-4 py-2.5">
                        <Link href={`/stocks/${encodeURIComponent(c.symbol)}`} className="font-mono font-semibold text-accent hover:underline">
                          {c.symbol}
                        </Link>
                      </td>
                      <td className="max-w-[10rem] truncate px-4 py-2.5 text-muted">{c.name}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">{c.sector ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge
                          label={c.strategicImportance}
                          variant={c.strategicImportance === "critical" ? "negative" : c.strategicImportance === "high" ? "accent" : "neutral"}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted capitalize">{c.moatType}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{c.roic != null ? `${c.roic.toFixed(1)}%` : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{c.grossMargin != null ? `${c.grossMargin.toFixed(1)}%` : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">
                        {c.revenueGrowthYoY != null
                          ? <span className={c.revenueGrowthYoY > 0 ? "text-positive" : "text-negative"}>{pct(c.revenueGrowthYoY)}</span>
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{c.debtToEquity != null ? c.debtToEquity.toFixed(2) : "—"}</td>
                      <td className="px-4 py-2.5 max-w-[14rem] text-xs text-muted">{c.relevanceRationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">No companies in the screener universe matched this theme. Run the quant engine first to populate the database.</p>
      )}
    </div>
  );
}

/* ─────────────────── Checklist tab ─────────────────────────────────── */

function ChecklistTab({ items }: { items: AnalystChecklistItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        10 key questions every analyst must answer before investing in a thematic. Based on YLP Part 10.5 framework.
      </p>
      {items.map((item, i) => (
        <div key={i} className="flex gap-4 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start gap-2 pt-0.5">
            <SignalDot signal={item.signal} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <span className="min-w-[1.5rem] font-mono text-xs text-muted">{i + 1}.</span>
              <span className="text-sm font-semibold leading-snug">{item.question}</span>
            </div>
            <p className="ml-6 text-sm leading-relaxed text-muted">{item.answer}</p>
          </div>
          <div className="ml-auto flex-shrink-0">
            <Badge
              label={item.signal}
              variant={item.signal === "positive" ? "positive" : item.signal === "negative" ? "negative" : "neutral"}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────── Policy table ──────────────────────────────────── */

function PolicyTable({ policies }: { policies: PolicyItem[] }) {
  if (policies.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-2">
          <tr className="border-b border-border text-left uppercase tracking-wider text-muted">
            <th className="px-3 py-2">Country</th>
            <th className="px-3 py-2">Policy</th>
            <th className="px-3 py-2">Capital</th>
            <th className="px-3 py-2">Impact</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {policies.map((p, i) => (
            <tr key={i} className="bg-surface hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold">{p.country}</td>
              <td className="px-3 py-2 text-muted">{p.policy}</td>
              <td className="px-3 py-2 font-mono text-muted">{p.estimatedCapitalUSD ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge
                  label={p.impact}
                  variant={p.impact.includes("positive") ? "positive" : p.impact === "negative" ? "negative" : "neutral"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────── Progress view ─────────────────────────────────── */

function ProgressView({ events }: { events: ThematicProgressEvent[] }) {
  const stageOrder = [
    "future_state", "dependency_chain", "bottleneck", "supply_demand",
    "commodity", "policy", "india_leapfrog", "company_mapping", "opportunity_score",
  ];

  const completedStages = new Set(events.map((e) => e.stage));
  const lastEvent = events[events.length - 1];

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <span className="text-sm font-semibold">Running thematic analysis…</span>
      </div>

      <div className="flex flex-col gap-2">
        {stageOrder.map((stage) => {
          const meta = STAGE_META[stage] ?? { label: stage, icon: "·" };
          const done = completedStages.has(stage as ThematicProgressEvent["stage"]);
          const isRunning = lastEvent?.stage === stage;
          return (
            <div key={stage} className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${done ? "bg-positive/5" : isRunning ? "bg-accent/5" : ""}`}>
              <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-mono font-semibold ${done ? "bg-positive/20 text-positive" : isRunning ? "bg-accent/20 text-accent" : "bg-surface-2 text-muted"}`}>
                {done ? "✓" : meta.icon}
              </span>
              <span className={`text-sm ${done ? "text-foreground" : isRunning ? "text-foreground" : "text-muted"}`}>
                Stage {meta.icon}: {meta.label}
              </span>
              {isRunning && (
                <span className="ml-auto text-xs text-muted">{lastEvent.message}</span>
              )}
              {done && !isRunning && (
                <span className="ml-auto text-xs text-positive">Done</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────── Main page ──────────────────────────────────────── */

export default function ThematicPage() {
  const [theme, setTheme] = useState("");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ThematicProgressEvent[]>([]);
  const [report, setReport] = useState<ThematicReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (themeOverride?: string) => {
    const t = (themeOverride ?? theme).trim();
    if (!t) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setRunning(true);
    setEvents([]);
    setReport(null);
    setError(null);

    try {
      const res = await fetch("/api/thematic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: t, focusIndia: true }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as ThematicProgressEvent & { report?: ThematicReport };
            setEvents((prev) => [...prev, evt]);
            if (evt.stage === "done" && evt.report) {
              setReport(evt.report);
            }
            if (evt.stage === "error") {
              setError(evt.message);
            }
          } catch {
            // ignore parse error
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Unexpected error");
      }
    } finally {
      setRunning(false);
    }
  }, [theme]);

  function handlePreset(label: string) {
    setTheme(label);
    void run(label);
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-10">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Thematic Research</h1>
        <p className="text-sm text-muted">
          Industries &amp; Commodities Discovery Framework — 10-stage analysis of a macro theme.
          Most investors study products. Elite investors study dependencies.
        </p>
      </div>

      {/* Search + run */}
      <div className="flex gap-2">
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !running && void run()}
          placeholder="Enter a theme — e.g. AI Compute, Battery Storage, Nuclear Energy, India Semiconductor Fab…"
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
          disabled={running}
        />
        {running ? (
          <button
            onClick={() => abortRef.current?.abort()}
            className="rounded-lg border border-negative/40 bg-negative/10 px-5 py-2.5 text-sm text-negative transition-colors hover:bg-negative/20"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => void run()}
            disabled={!theme.trim()}
            className="rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Analyse
          </button>
        )}
      </div>

      {/* Preset themes */}
      {!running && !report && (
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-wider text-muted">Quick themes</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {PRESET_THEMES.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePreset(p.label)}
                className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-surface-2"
              >
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-xs text-muted">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* Progress */}
      {running && events.length > 0 && <ProgressView events={events} />}

      {/* Report */}
      {report && <ThematicReportView report={report} />}

      {/* Empty state */}
      {!running && !report && !error && (
        <div className="flex flex-col items-center gap-4 py-16 text-center text-muted">
          <span className="text-5xl">◈</span>
          <p className="max-w-md text-sm">
            Enter a macro theme or pick from the presets. The engine will run all 10 stages —
            from future state scoring to dependency chain mapping, bottleneck analysis,
            commodity supply/demand, policy overlay, India leapfrog potential, and company tier mapping
            against your screener universe.
          </p>
        </div>
      )}
    </main>
  );
}
