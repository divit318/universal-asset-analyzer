"use client";

import { useEffect, useState } from "react";
import type { ThematicReport } from "@/lib/thematic-engine";
import { Tabs, TabPanel, type TabItem } from "@/app/_components/ui";
import { Hero, IntegrityNotice, RiskFlags } from "./hero";
import { OverviewTab } from "./overview-tab";
import { ChainTab } from "./chain-tab";
import { CompaniesTab } from "./companies-tab";
import { SignalsTab } from "./signals-tab";
import { ChecklistTab } from "./checklist-tab";
import { readReportHistory, type ReportSnapshot } from "./storage";

type TabId = "overview" | "chain" | "companies" | "signals" | "checklist";

export function ThematicReportView({ report, onRefresh }: { report: ThematicReport; onRefresh: () => void }) {
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
      <Hero report={report} onRefresh={onRefresh} />
      <IntegrityNotice report={report} />
      <RunHistory report={report} />
      <RiskFlags flags={report.opportunity.riskFlags} />

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} idBase="thematic-report" />

      {/* Each tab is keyed so its reveals and score animations play once on
          entry rather than being replayed by a shared subtree re-render. */}
      <TabPanel key={activeTab} idBase="thematic-report" tabId={activeTab}>
        {activeTab === "overview" && <OverviewTab report={report} />}
        {activeTab === "chain" && <ChainTab report={report} />}
        {activeTab === "companies" && <CompaniesTab report={report} />}
        {activeTab === "signals" && <SignalsTab report={report} />}
        {activeTab === "checklist" && <ChecklistTab items={report.opportunity.analystChecklist} />}
      </TabPanel>
    </div>
  );
}

/**
 * The one-line delta on re-run (PR-8): "score 56 → 61 · capital cycle
 * downturn → early". Each re-run used to overwrite the single cache row, so
 * the previous verdict was gone — the framework could never be graded
 * against itself. History comes from browser storage (see storage.ts) and is
 * read after mount, matching how the page restores its other local state.
 */
function RunHistory({ report }: { report: ThematicReport }) {
  const [prior, setPrior] = useState<ReportSnapshot[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage does not exist during SSR; reading it after mount is the mechanism.
    setPrior(readReportHistory(report.theme).filter((s) => s.generatedAt !== report.generatedAt));
  }, [report]);
  if (prior.length === 0) return null;

  const prev = prior[0];
  const delta = report.opportunity.themeScore - prev.themeScore;
  const cycleChanged = prev.capitalCyclePhase !== report.supplyDemand.capitalCyclePhase;
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Versus the previous run ({day(prev.generatedAt)})
      </p>
      <p className="mt-1 text-sm">
        Score {prev.themeScore} → {report.opportunity.themeScore}
        {delta !== 0 && (
          <span className={`font-mono tabular-nums ${delta > 0 ? "text-positive" : "text-negative"}`}>
            {" "}({delta > 0 ? "+" : ""}{delta})
          </span>
        )}
        <span className="text-muted"> · verdict {prev.verdict.toUpperCase()} → {report.opportunity.verdict.toUpperCase()}</span>
        {cycleChanged && (
          <span className="text-muted"> · capital cycle {prev.capitalCyclePhase} → {report.supplyDemand.capitalCyclePhase}</span>
        )}
      </p>
      {prior.length > 1 && (
        <p className="mt-1.5 text-xs text-muted">
          Earlier runs:{" "}
          {prior
            .slice(1, 5)
            .map((s) => `${day(s.generatedAt)} — ${s.themeScore}/100 ${s.verdict.toUpperCase()}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
