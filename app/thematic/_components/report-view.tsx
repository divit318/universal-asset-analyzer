"use client";

import { useState } from "react";
import type { ThematicReport } from "@/lib/thematic-engine";
import { Tabs, type TabItem } from "@/app/_components/ui";
import { Hero, IntegrityNotice, RiskFlags } from "./hero";
import { OverviewTab } from "./overview-tab";
import { ChainTab } from "./chain-tab";
import { CompaniesTab } from "./companies-tab";
import { SignalsTab } from "./signals-tab";
import { ChecklistTab } from "./checklist-tab";

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
