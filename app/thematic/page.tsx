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
 *   Stage 7  Global Structural Advantage Analysis
 *   Stage 8  Company Tier Mapping
 *   Stage 9  Company Quality (composite screen over the mapped companies)
 *   Stage 10 Opportunity Score
 *
 * Built entirely on the shared design system (app/_components/ui) and the
 * shared motion primitives (Reveal / ScoreRing / ValueBar / CountUp) rather
 * than the private Score/Badge/Pill/SectionCard/tab-bar this page used to
 * carry — see DESIGN_PROGRESS.md M7.
 */

import { Suspense, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Copy, RotateCcw } from "lucide-react";
import type {
  ThematicReport,
  ThematicProgressEvent,
  TierCompany,
  PolicyItem,
  AnalystChecklistItem,
  RiskFlag,
  ScoreFactor,
} from "@/lib/thematic-engine";
import { MAX_THEME_LENGTH, isRenderableReport } from "@/lib/thematic-theme";
import { Badge, Button, Card, Input, PageShell, SectionHeader, Tabs, type TabItem } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { ScoreRing } from "@/app/_components/score-ring";
import { ValueBar } from "@/app/_components/value-bar";
import { CountUp } from "@/app/_components/count-up";
import { LoadingMark } from "@/app/_components/loading-mark";
import { useToast } from "@/app/_components/toast";

/* ─────────────────── Preset themes ──────────────────────────────────── */

const PRESET_THEMES = [
  { label: "AI Compute", desc: "Data centres, chips, power" },
  { label: "Energy Storage", desc: "Batteries, lithium, grid" },
  { label: "Nuclear Energy", desc: "Uranium, SMRs, decarbonisation" },
  { label: "Copper & Electrification", desc: "EVs, grids, copper bottleneck" },
  { label: "Cybersecurity", desc: "Zero trust, identity, cyber spend" },
  { label: "Water Infrastructure", desc: "Treatment, pipes, desalination" },
  { label: "Rare Earth & Critical Minerals", desc: "Supply-chain sovereignty" },
  { label: "Defence Modernisation", desc: "Rearmament, munitions, primes" },
  { label: "Robotics & Automation", desc: "Factory of the future" },
  { label: "Offshore Wind", desc: "Turbines, cables, ports" },
];

/* ─────────────────── Stage pipeline (single source of truth) ────────── */

/**
 * The pipeline, in order, with its real stage numbers.
 *
 * Previously STAGE_META claimed stage 9 was "Company Quality" while the
 * progress list skipped straight from 8 to 10 — because no stage 9 existed.
 * The engine now emits `company_quality` for real, and this array is the only
 * place the order and numbering live.
 */
const PIPELINE = [
  { id: "future_state", label: "Future state" },
  { id: "dependency_chain", label: "Dependency chain" },
  { id: "bottleneck", label: "Bottleneck" },
  { id: "supply_demand", label: "Supply / demand cycle" },
  { id: "commodity", label: "Commodity framework" },
  { id: "policy", label: "Policy & geopolitics" },
  { id: "global_structural_advantage", label: "Structural advantage" },
  { id: "company_mapping", label: "Company tier mapping" },
  { id: "company_quality", label: "Company quality" },
  { id: "opportunity_score", label: "Opportunity score" },
] as const;

/* ─────────────────── Small display helpers ─────────────────────────── */

function scoreTone(pct: number): { text: string; bar: string } {
  if (pct >= 70) return { text: "text-positive", bar: "bg-positive" };
  if (pct >= 40) return { text: "text-warning", bar: "bg-warning" };
  return { text: "text-negative", bar: "bg-negative" };
}

/** A 0–10 stage score, rendered as one legible figure rather than a bare number. */
function StageScore({ value }: { value: number }) {
  const tone = scoreTone((value / 10) * 100);
  return (
    <span className={`shrink-0 font-mono text-lg font-semibold tabular-nums ${tone.text}`}>
      <CountUp value={value} format={(v) => v.toFixed(1).replace(/\.0$/, "")} />
      <span className="text-xs font-normal text-muted">/10</span>
    </span>
  );
}

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

/** Uppercase micro-label above a group of values. The page's one label style. */
function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-label font-semibold uppercase tracking-widest text-muted/70">{children}</div>;
}

function Bullets({ items, tone = "brand" }: { items: string[]; tone?: "brand" | "positive" | "negative" }) {
  if (items.length === 0) return <p className="text-xs text-faint">Not identified.</p>;
  const dot = tone === "positive" ? "bg-positive" : tone === "negative" ? "bg-negative" : "bg-brand";
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${dot}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-xs text-faint">None identified.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
          {item}
        </span>
      ))}
    </div>
  );
}

/** Honest absence — never a spinner, never an error. Mirrors ui/section.tsx. */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center rounded-card border border-dashed border-border px-6 py-12">
      <p className="max-w-md text-center text-sm leading-relaxed text-faint">{children}</p>
    </div>
  );
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function changeTone(v: number | null): string {
  if (v == null) return "text-faint";
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted";
}

const TIER_TONE: Record<number, string> = {
  1: "border-brand/30 bg-brand/10 text-brand",
  2: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  3: "border-warning/30 bg-warning/10 text-warning",
  4: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  5: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  6: "border-positive/30 bg-positive/10 text-positive",
};

function TierBadge({ tier }: { tier: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-label font-bold ${TIER_TONE[tier] ?? "border-border bg-surface-3 text-muted"}`}
      title={`Tier ${tier}`}
    >
      T{tier}
    </span>
  );
}

const IMPORTANCE_VARIANT = {
  critical: "negative",
  high: "brand",
  medium: "neutral",
  low: "neutral",
} as const;

/** 0–100 composite quality from the screener. Null is a fact, not a zero. */
function QualityCell({ score }: { score: number | null }) {
  if (score == null) return <span className="font-mono text-xs text-faint">—</span>;
  return (
    <span className={`font-mono text-xs font-semibold tabular-nums ${scoreTone(score).text}`}>{score}</span>
  );
}

/* ─────────────────── Hero ──────────────────────────────────────────── */

const VERDICT_VARIANT = {
  exceptional: "positive",
  strong: "positive",
  moderate: "neutral",
  weak: "negative",
  avoid: "negative",
} as const;

function Hero({ report, onRefresh, refreshing }: { report: ThematicReport; onRefresh: () => void; refreshing: boolean }) {
  const { opportunity, integrity } = report;
  const toast = useToast();

  const copyMarkdown = useCallback(() => {
    void navigator.clipboard.writeText(toMarkdown(report)).then(
      () => toast("Report copied as Markdown"),
      () => toast("Couldn't copy to the clipboard", "error"),
    );
  }, [report, toast]);

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand">Thematic report</Badge>
            <Badge variant={VERDICT_VARIANT[opportunity.verdict]}>{opportunity.verdict}</Badge>
            {integrity.stagesEvidenced < integrity.stagesTotal && (
              <Badge variant="warning">
                {integrity.stagesEvidenced}/{integrity.stagesTotal} stages evidenced
              </Badge>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{report.theme}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{opportunity.verdictRationale}</p>
          {opportunity.verdictCaveat && (
            <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {opportunity.verdictCaveat}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{new Date(report.generatedAt).toLocaleString()}</span>
            <span className="text-faint">·</span>
            <span className="font-mono">{report.model}</span>
            <span className="text-faint">·</span>
            <span>
              {integrity.universeShortlisted} of {integrity.universeTotal} screener names in scope
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3">
          <ScoreRing
            key={report.theme}
            score={opportunity.themeScore}
            size={116}
            strokeWidth={5}
            arcClassName={scoreTone(opportunity.themeScore).text}
            valueClassName="text-3xl"
            caption="/ 100"
            label={`Opportunity score ${opportunity.themeScore} out of 100`}
          />
          <div className="flex gap-1.5">
            <Button size="xs" variant="ghost" onClick={copyMarkdown} title="Copy the whole report as Markdown">
              <Copy className="h-3 w-3" strokeWidth={2} /> Copy
            </Button>
            <Button size="xs" variant="ghost" onClick={onRefresh} disabled={refreshing} title="Discard the saved report and re-run every stage">
              <RotateCcw className="h-3 w-3" strokeWidth={2} /> Re-run
            </Button>
          </div>
        </div>
      </div>

      <FactorStrip factors={opportunity.factors} />
    </Card>
  );
}

/**
 * The weighted inputs behind the headline score.
 *
 * Each tile now says what it measures, how much it counts, and — the part that
 * was missing — whether it rests on a real answer at all. An unevidenced factor
 * is drawn muted and struck through with a dashed track so a 5/10 assumption
 * can never be mistaken for a 5/10 finding.
 */
function FactorStrip({ factors }: { factors: ScoreFactor[] }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-2 border-t border-border pt-5 sm:grid-cols-4 lg:grid-cols-7">
      {factors.map((f, i) => {
        const tone = scoreTone(f.score);
        return (
          <Reveal
            key={f.key}
            index={i}
            className="group flex flex-col gap-1.5 rounded-control border border-border bg-surface-2 px-2.5 py-2 transition-colors hover:border-border-strong"
            title={`${f.meaning}${f.evidenced ? "" : "\n\nThis stage returned nothing usable — scored at a neutral default."}`}
          >
            <span className="truncate text-label font-medium uppercase tracking-wide text-muted/70">{f.label}</span>
            <span className="flex items-baseline gap-1">
              <span className={`font-mono text-sm font-semibold tabular-nums ${f.evidenced ? tone.text : "text-faint"}`}>
                {f.evidenced ? Math.round(f.score) : "—"}
              </span>
              <span className="text-label text-muted/60">wt {Math.round(f.weight * 100)}%</span>
            </span>
            <ValueBar
              value={f.evidenced ? f.score : null}
              barClassName={tone.bar}
              trackClassName={f.evidenced ? "bg-border" : "bg-border/40"}
              durationMs={900}
            />
          </Reveal>
        );
      })}
    </div>
  );
}

/**
 * What would have to be true for this report to be wrong.
 *
 * The report used to answer "how good is this theme?" and stop. A research
 * surface that only ever argues one side is a pitch deck, not analysis.
 */
function RiskFlags({ flags }: { flags: RiskFlag[] }) {
  if (flags.length === 0) return null;
  const TONE = {
    high: "border-negative/30 bg-negative/5 text-negative",
    medium: "border-warning/30 bg-warning/5 text-warning",
    low: "border-border bg-surface-2 text-muted",
  } as const;
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader label="What could break this" description="Derived from the stage outputs above — not a separate AI opinion." />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {flags.map((f, i) => (
          <Reveal key={f.label} index={i} className={`rounded-card border px-3.5 py-3 ${TONE[f.severity]}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="text-xs font-semibold capitalize">{f.label}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{f.detail}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/** Caveats that qualify the headline, stated once, at the top, in plain language. */
function IntegrityNotice({ report }: { report: ThematicReport }) {
  const caveats = report.integrity.caveats;
  if (caveats.length === 0) return null;
  return (
    <div className="rounded-card border border-warning/30 bg-warning/5 px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-warning">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        Read this score with {caveats.length} caveat{caveats.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {caveats.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────── Report view ───────────────────────────────────── */

type TabId = "overview" | "chain" | "companies" | "signals" | "checklist";

function ThematicReportView({ report, onRefresh, refreshing }: { report: ThematicReport; onRefresh: () => void; refreshing: boolean }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const tabs: TabItem<TabId>[] = [
    { id: "overview", label: "Overview" },
    { id: "chain", label: "Dependency chain", badge: report.dependencyChain.length, badgeVariant: "brand" },
    { id: "companies", label: "Companies", badge: report.tierCompanies.length, badgeVariant: "brand" },
    { id: "signals", label: "Why now", badge: report.newsItems.length, badgeVariant: "brand" },
    { id: "checklist", label: "Checklist" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Hero report={report} onRefresh={onRefresh} refreshing={refreshing} />
      <IntegrityNotice report={report} />
      <RiskFlags flags={report.opportunity.riskFlags} />

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Each tab is keyed so its reveals and score animations play once on
          entry rather than being replayed by a shared subtree re-render. */}
      <div key={activeTab}>
        {activeTab === "overview" && <OverviewTab report={report} />}
        {activeTab === "chain" && <ChainTab report={report} />}
        {activeTab === "companies" && <CompaniesTab report={report} />}
        {activeTab === "signals" && <SignalsTab report={report} />}
        {activeTab === "checklist" && <ChecklistTab items={report.opportunity.analystChecklist} />}
      </div>
    </div>
  );
}

/* ─────────────────── Overview tab ──────────────────────────────────── */

function OverviewTab({ report }: { report: ThematicReport }) {
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
                            <span className={changeTone(change)}>{pct(change)}</span>
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
            <CompanyTable companies={opportunity.topCompanies} compact />
          </Card>
        </Reveal>
      )}
    </div>
  );
}

/* ─────────────────── Dependency chain tab ──────────────────────────── */

function ChainTab({ report }: { report: ThematicReport }) {
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

/* ─────────────────── Companies tab ──────────────────────────────────── */

function CompaniesTab({ report }: { report: ThematicReport }) {
  const companies = report.tierCompanies;
  const [filterTier, setFilterTier] = useState<number | null>(null);
  const [filterIndia, setFilterIndia] = useState(false);

  const tiers = useMemo(() => [...new Set(companies.map((c) => c.tier))].sort((a, b) => a - b), [companies]);
  // The India filter is only offered when the loaded universe actually contains
  // Indian listings. It was a permanent checkbox over a 100% US universe, so
  // ticking it always returned zero companies and looked like a bug.
  const hasIndia = useMemo(() => companies.some((c) => c.isIndia), [companies]);

  const filtered = useMemo(
    () => companies.filter((c) => (filterTier == null || c.tier === filterTier) && (!filterIndia || c.isIndia)),
    [companies, filterTier, filterIndia],
  );

  if (companies.length === 0) {
    return (
      <Empty>
        {report.integrity.universeTotal === 0
          ? "The screener universe is empty, so there is nothing to map this theme onto. Load the screener once to populate cached fundamentals, then re-run."
          : report.integrity.universeShortlisted === 0
            ? `None of the ${report.integrity.universeTotal} companies in the screener universe plausibly touch this theme — the coverage gap is real, not a failure. Try a broader theme, or one closer to listed industries.`
            : `${report.integrity.universeShortlisted} companies were in scope but the mapping stage couldn't place any of them into a tier. Re-run to try again.`}
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={filterTier == null} onClick={() => setFilterTier(null)}>
          All tiers
        </FilterChip>
        {tiers.map((t) => (
          <FilterChip key={t} active={filterTier === t} onClick={() => setFilterTier(filterTier === t ? null : t)}>
            Tier {t}
          </FilterChip>
        ))}
        {hasIndia && (
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={filterIndia} onChange={(e) => setFilterIndia(e.target.checked)} className="accent-brand" />
            India only
          </label>
        )}
        <span className="ml-auto text-xs text-muted tabular-nums">
          {filtered.length} of {companies.length} companies
        </span>
      </div>

      {tiers.map((t, i) => {
        const rows = filtered.filter((c) => c.tier === t);
        if (rows.length === 0) return null;
        return (
          <Reveal key={t} index={i}>
            <Card padding="none">
              <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-4 py-2.5">
                <TierBadge tier={t} />
                <span className="text-sm font-semibold">{rows[0].tierLabel}</span>
                <span className="text-xs text-muted tabular-nums">{rows.length}</span>
              </div>
              <CompanyTable companies={rows} />
            </Card>
          </Reveal>
        );
      })}

      {filtered.length === 0 && <Empty>No company matches the current filters.</Empty>}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
        active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:border-border-strong hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** The one company table — used by both the hero shortlist and the tier groups. */
function CompanyTable({ companies, compact = false }: { companies: TierCompany[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-label uppercase tracking-widest text-muted/70">
            <th className="px-4 py-2 font-semibold">Symbol</th>
            <th className="px-4 py-2 font-semibold">Company</th>
            {compact && <th className="px-4 py-2 font-semibold">Tier</th>}
            {!compact && <th className="px-4 py-2 font-semibold">Sector</th>}
            <th className="px-4 py-2 font-semibold">Role</th>
            <th className="px-4 py-2 font-semibold">Moat</th>
            <th className="px-4 py-2 text-right font-semibold" title="Composite quality score from the screener (0–100)">Quality</th>
            <th className="px-4 py-2 text-right font-semibold">ROIC</th>
            {!compact && <th className="px-4 py-2 text-right font-semibold">Margin</th>}
            <th className="px-4 py-2 text-right font-semibold">Rev growth</th>
            <th className="px-4 py-2 text-right font-semibold">D/E</th>
            <th className="px-4 py-2 font-semibold">Why it belongs here</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {companies.map((c) => (
            <tr key={c.symbol} className="transition-colors hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <Link
                  href={`/stocks/${encodeURIComponent(c.symbol)}`}
                  className="group inline-flex items-center gap-1 font-mono text-xs font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {c.symbol}
                  <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} />
                </Link>
              </td>
              <td className="max-w-[11rem] truncate px-4 py-2.5 text-muted">{c.name}</td>
              {compact && <td className="px-4 py-2.5"><TierBadge tier={c.tier} /></td>}
              {!compact && <td className="px-4 py-2.5 text-xs text-muted">{c.sector ?? "—"}</td>}
              <td className="px-4 py-2.5">
                <Badge variant={IMPORTANCE_VARIANT[c.strategicImportance]}>{c.strategicImportance}</Badge>
              </td>
              <td className="px-4 py-2.5 text-xs capitalize text-muted">{c.moatType}</td>
              <td className="px-4 py-2.5 text-right"><QualityCell score={c.qualityScore} /></td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                {c.roic != null ? `${c.roic.toFixed(1)}%` : "—"}
              </td>
              {!compact && (
                <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                  {c.grossMargin != null ? `${c.grossMargin.toFixed(1)}%` : "—"}
                </td>
              )}
              <td className={`px-4 py-2.5 text-right font-mono text-xs tabular-nums ${changeTone(c.revenueGrowthYoY)}`}>
                {pct(c.revenueGrowthYoY)}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
                {c.debtToEquity != null ? c.debtToEquity.toFixed(2) : "—"}
              </td>
              <td className="max-w-[16rem] px-4 py-2.5 text-xs leading-relaxed text-muted">{c.relevanceRationale || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────── Why-now / signals tab ─────────────────────────── */

/**
 * The theme's live news, which the engine has always fetched and the page never
 * showed — 40 headlines gathered on every run and thrown away, while the report
 * had no answer at all to "why now?".
 */
function SignalsTab({ report }: { report: ThematicReport }) {
  if (report.newsItems.length === 0) {
    return (
      <Empty>
        No recent headline mentions this theme by name. That&apos;s a signal in itself — a theme with no news flow is
        either very early or out of favour, and the policy read above had no live evidence to work from.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        Every headline the policy stage actually read, newest first. This is the evidence behind &ldquo;why now&rdquo; —
        and the place to check whether the AI&apos;s policy read is grounded.
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border">
        {report.newsItems.map((n, i) => (
          <Reveal
            key={`${n.url}-${i}`}
            index={i}
            as="div"
            className="group transition-colors hover:bg-surface-2"
          >
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-4 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <div className="min-w-0">
                <p className="text-sm leading-snug group-hover:text-brand">{n.headline}</p>
                <p className="mt-1 flex items-center gap-2 text-label uppercase tracking-wide text-muted/70">
                  <span>{n.source}</span>
                  <span className="text-faint">·</span>
                  <time dateTime={n.publishedAt}>{new Date(n.publishedAt).toLocaleDateString()}</time>
                </p>
              </div>
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-brand" strokeWidth={2} />
            </a>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────── Checklist tab ─────────────────────────────────── */

function ChecklistTab({ items }: { items: AnalystChecklistItem[] }) {
  if (items.length === 0) return <Empty>The checklist could not be assembled for this report.</Empty>;

  const SIGNAL = {
    positive: { dot: "bg-positive", variant: "positive" },
    neutral: { dot: "bg-muted", variant: "neutral" },
    negative: { dot: "bg-negative", variant: "negative" },
  } as const;

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        The ten questions this framework insists on answering before capital moves. Each answer is assembled from the
        stage above it, so nothing here is a second opinion.
      </p>
      {items.map((item, i) => (
        <Reveal
          key={i}
          index={i}
          className="flex gap-4 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong"
        >
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SIGNAL[item.signal].dot}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs tabular-nums text-muted/60">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-sm font-semibold leading-snug">{item.question}</span>
            </div>
            <p className="mt-1.5 pl-7 text-sm leading-relaxed text-muted">{item.answer || "Not answered by this run."}</p>
          </div>
          <Badge variant={SIGNAL[item.signal].variant}>{item.signal}</Badge>
        </Reveal>
      ))}
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

/* ─────────────────── Progress view ─────────────────────────────────── */

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Live pipeline progress.
 *
 * The previous version marked a stage complete as soon as *any* event carrying
 * its name arrived — but every stage emits twice (once on entry, once with its
 * result), so each stage showed a green tick and "Done" the instant it started
 * and the panel told the user the run was finished nine times over. Completion
 * is now defined as the arrival of that stage's data-bearing event, which is the
 * only event that means the work actually happened.
 */
function ProgressView({ events, elapsed }: { events: ThematicProgressEvent[]; elapsed: number }) {
  const completed = new Set(events.filter((e) => e.data !== undefined).map((e) => e.stage));
  // The current stage is the first not-yet-complete one, which is robust to a
  // stage that emits no entry event at all.
  const currentIndex = PIPELINE.findIndex((s) => !completed.has(s.id));
  const current = currentIndex === -1 ? null : PIPELINE[currentIndex];
  const latest = events[events.length - 1];
  const detail = latest && latest.stage === current?.id ? latest.message : null;
  const done = completed.size;

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <LoadingMark size={20} label="Running thematic analysis" />
          <div>
            <p className="text-sm font-semibold">
              {current ? current.label : "Assembling the report"}
            </p>
            <p className="text-xs text-muted">{detail ?? "Working…"}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs tabular-nums text-muted">
          <span>
            {done}/{PIPELINE.length} stages
          </span>
          <span className="font-mono">{formatDuration(elapsed * 1000)}</span>
        </div>
      </div>

      {/* A width transition, deliberately not the shared `.animate-bar-fill`
          keyframe: that animates from 0 on every render, so each completed
          stage would restart the whole bar instead of extending it. */}
      <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
          style={{ width: `${(done / PIPELINE.length) * 100}%` }}
        />
      </div>

      <ol className="mt-4 flex flex-col gap-0.5">
        {PIPELINE.map((s, i) => {
          const isDone = completed.has(s.id);
          const isCurrent = current?.id === s.id;
          // Result messages carry the finding, e.g. "Bottleneck score: 8/10" —
          // showing it inline turns a progress list into a live summary.
          const result = [...events].reverse().find((e) => e.stage === s.id && e.data !== undefined)?.message;
          return (
            <li
              key={s.id}
              className={`flex items-center gap-3 rounded-control px-2.5 py-2 transition-colors duration-300 ${
                isCurrent ? "bg-brand/5" : ""
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-micro font-bold transition-colors duration-300 ${
                  isDone
                    ? "bg-positive/15 text-positive"
                    : isCurrent
                      ? "bg-brand/15 text-brand"
                      : "bg-surface-3 text-muted/60"
                }`}
              >
                {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`shrink-0 text-sm ${isDone || isCurrent ? "text-foreground" : "text-muted/60"}`}>
                {s.label}
              </span>
              {isDone && result && (
                <span className="ml-auto truncate pl-4 text-xs text-muted">{result}</span>
              )}
              {isCurrent && <span className="ml-auto shrink-0 text-xs text-brand">Running…</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ─────────────────── Markdown export ───────────────────────────────── */

/** The whole report as pasteable Markdown — for a memo, an email, or a note. */
function toMarkdown(r: ThematicReport): string {
  const lines: string[] = [
    `# ${r.theme} — Thematic Report`,
    "",
    `**Opportunity score:** ${r.opportunity.themeScore}/100 (${r.opportunity.verdict.toUpperCase()})`,
    `**Generated:** ${new Date(r.generatedAt).toLocaleString()} · ${r.model}`,
    `**Evidence:** ${r.integrity.stagesEvidenced}/${r.integrity.stagesTotal} stages evidenced · ${r.integrity.evidenceScore}% of the score weight`,
    "",
    r.opportunity.verdictRationale,
  ];
  if (r.opportunity.verdictCaveat) lines.push("", `> ${r.opportunity.verdictCaveat}`);
  if (r.integrity.caveats.length > 0) {
    lines.push("", "## Caveats", ...r.integrity.caveats.map((c) => `- ${c}`));
  }
  lines.push("", "## Score factors", ...r.opportunity.factors.map(
    (f) => `- **${f.label}** ${Math.round(f.score)}/100 (weight ${Math.round(f.weight * 100)}%)${f.evidenced ? "" : " — unevidenced"}`,
  ));
  if (r.opportunity.riskFlags.length > 0) {
    lines.push("", "## What could break this", ...r.opportunity.riskFlags.map((f) => `- **${f.label}** (${f.severity}) — ${f.detail}`));
  }
  if (r.dependencyChain.length > 0) {
    lines.push("", "## Dependency chain", ...r.dependencyChain.map(
      (n) => `- **T${n.tier} ${n.tierLabel}**${n.isBottleneck ? " *(bottleneck)*" : ""} — ${n.description}`,
    ));
  }
  if (r.tierCompanies.length > 0) {
    lines.push(
      "", "## Companies", "",
      "| Symbol | Tier | Role | Quality | Why |",
      "| --- | --- | --- | --- | --- |",
      ...r.tierCompanies.map(
        (c) => `| ${c.symbol} | T${c.tier} | ${c.strategicImportance} | ${c.qualityScore ?? "—"} | ${c.relevanceRationale.replace(/\|/g, "/")} |`,
      ),
    );
  }
  lines.push("", "## Analyst checklist", ...r.opportunity.analystChecklist.map(
    (q, i) => `${i + 1}. **${q.question}** (${q.signal})\n   ${q.answer}`,
  ));
  return lines.join("\n");
}

/* ─────────────────── Recent themes ─────────────────────────────────── */

const RECENT_KEY = "uaa_thematic_recent";
const STORAGE_KEY = "uaa_thematic_last_report";

/**
 * Accept a stored report only if it has the fields this page renders.
 *
 * sessionStorage outlives the code that wrote it. A report saved by an earlier
 * version has no `integrity` or `factors`, so restoring it blindly crashed the
 * page on first paint with no way for the user to recover except clearing
 * storage by hand. The check itself is the shared `isRenderableReport` — the
 * same one the API route applies to platform-cache hits, so the two storage
 * tiers can never drift apart in what they consider renderable.
 */
function asCurrentReport(value: unknown): ThematicReport | null {
  return isRenderableReport(value) ? value : null;
}

/**
 * Locally remembered themes.
 *
 * A report costs minutes of local inference, and the server now caches it — so
 * a list of what has already been researched is a list of one-click, instant
 * reports. Previously the page kept exactly one report in sessionStorage and
 * forgot every other theme the moment you searched again.
 */
function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushRecent(theme: string): string[] {
  const next = [theme, ...readRecent().filter((t) => t.toLowerCase() !== theme.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}

/* ─────────────────── Main page ──────────────────────────────────────── */

function ThematicPageInner() {
  const searchParams = useSearchParams();
  const themeFromQuery = searchParams.get("theme");

  // Lazy initializers restore from sessionStorage on first render — no effect
  // needed. A `?theme=` deep-link (e.g. from Scanner's "Deep Thematic Research
  // →") always wins over any stale cached report, since we auto-run it below.
  const [report, setReport] = useState<ThematicReport | null>(() => {
    if (themeFromQuery) return null;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? asCurrentReport(JSON.parse(saved)) : null;
    } catch { /* ignore corrupt storage */ }
    return null;
  });
  const [theme, setTheme] = useState(() => themeFromQuery ?? "");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ThematicProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Recent themes come from localStorage, which doesn't exist during SSR — read
  // it after mount so the server and client first paints agree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage after mount IS the mechanism: doing it in the initializer would make the SSR and client first paints disagree.
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    document.title = report ? `${report.theme} · Thematic · UAA` : "Thematic · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [report]);

  // One interval for the whole run; the start time lives in a ref so restarting
  // the timer never depends on a state update landing first.
  const startRef = useRef<number>(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const run = useCallback(async (themeOverride?: string, opts: { refresh?: boolean } = {}) => {
    const t = (themeOverride ?? theme).trim().slice(0, MAX_THEME_LENGTH);
    if (!t) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    startRef.current = Date.now();
    setRunning(true);
    setElapsed(0);
    setEvents([]);
    setReport(null);
    setError(null);
    setRecent(pushRecent(t));

    try {
      const res = await fetch("/api/thematic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: t, refresh: opts.refresh === true }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Request failed (${res.status})`);
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
          let evt: ThematicProgressEvent & { report?: ThematicReport };
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue; // a truncated frame; the next chunk completes it
          }
          setEvents((prev) => [...prev, evt]);
          if (evt.stage === "done" && evt.report) {
            setReport(evt.report);
            try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(evt.report)); } catch { /* quota */ }
          }
          if (evt.stage === "error") setError(evt.message);
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

  const handlePreset = useCallback((label: string) => {
    setTheme(label);
    void run(label);
  }, [run]);

  // Deep-link auto-run: a theme arriving via `?theme=` should populate the field
  // AND start analysis immediately — the user should never re-enter it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off the deep-linked run is the effect's whole purpose; its state writes are the run's progress.
    if (themeFromQuery) void run(themeFromQuery);
    // Mount only — `run`'s identity changes whenever `theme` state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tooLong = theme.length >= MAX_THEME_LENGTH;

  return (
    <PageShell py="py-10">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Thematic Research</h1>
          <Badge variant="brand">10 stages</Badge>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Industries &amp; Commodities Discovery Framework. Most investors study products — this maps the dependency
          chain behind them, finds the bottleneck, and tells you who owns it.
        </p>
      </div>

      {/* Search */}
      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          <Input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !running) void run(); }}
            placeholder="Name a theme — AI Compute, Nuclear Energy, Rare Earths, Cybersecurity, Shipping…"
            maxLength={MAX_THEME_LENGTH}
            disabled={running}
            aria-label="Investment theme to research"
            className="flex-1 py-2.5"
          />
          {running ? (
            <Button variant="destructive" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void run()} disabled={!theme.trim()}>
              Analyse
            </Button>
          )}
        </div>
        {tooLong && (
          <p className="text-xs text-warning">
            Themes are capped at {MAX_THEME_LENGTH} characters — a tighter theme also produces a sharper report.
          </p>
        )}
        {recent.length > 0 && !running && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-label font-semibold uppercase tracking-widest text-muted/60">Recent</span>
            {recent.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handlePreset(t)}
                title="Saved reports load instantly"
                className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted outline-none transition-colors hover:border-brand/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Onboarding — only before the first run */}
      {!running && !report && (
        <div className="flex flex-col gap-5">
          <SectionHeader label="Start here" description="Ten themes the framework handles well." />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {PRESET_THEMES.map((p, i) => (
              <Reveal key={p.label} index={i}>
                <button
                  type="button"
                  onClick={() => handlePreset(p.label)}
                  className="flex h-full w-full flex-col gap-0.5 rounded-card border border-border bg-surface px-3.5 py-3 text-left outline-none transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-xs leading-snug text-muted">{p.desc}</span>
                </button>
              </Reveal>
            ))}
          </div>

          <SectionHeader label="How it works" description="Roughly 5–20 minutes on a local model. Reports are saved, so a repeat search is instant." />
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { step: "1–3", title: "Foundation", desc: "Inevitability of the future state, the six-tier dependency chain, and which tier is the real bottleneck." },
              { step: "4–7", title: "Market dynamics", desc: "Capital-cycle position against live market proxies, commodity intensity, policy flows, and regional advantage." },
              { step: "8–10", title: "Expression", desc: "Screener companies mapped to tiers, screened on composite quality, then scored into one verdict with named risks." },
            ].map(({ step, title, desc }, i) => (
              <Reveal key={step} index={i} className="flex gap-3 rounded-card border border-border bg-surface p-4">
                <span className="mt-0.5 shrink-0 font-mono text-label font-bold text-muted/60">{step}</span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-card border border-negative/30 bg-negative/5 px-4 py-3">
          <p className="text-sm text-negative">{error}</p>
          <Button size="xs" variant="secondary" className="mt-2" onClick={() => void run()}>
            Try again
          </Button>
        </div>
      )}

      {running && <ProgressView events={events} elapsed={elapsed} />}

      {report && (
        <ThematicReportView
          report={report}
          refreshing={running}
          onRefresh={() => void run(report.theme, { refresh: true })}
        />
      )}
    </PageShell>
  );
}

export default function ThematicPage() {
  return (
    <Suspense fallback={<PageShell py="py-10"><div className="h-40" /></PageShell>}>
      <ThematicPageInner />
    </Suspense>
  );
}
