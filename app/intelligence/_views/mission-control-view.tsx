"use client";

import { useEffect, useState } from "react";
import type { MissionControlDigest } from "@/lib/mission-control";
import { BriefingCard } from "../_components/briefing-card";
import { ActionQueueCard } from "../_components/action-queue-card";
import { OpportunityRiskCard } from "../_components/opportunity-risk-card";
import { SectorAttentionCard } from "../_components/sector-attention-card";
import { UpcomingEventsCard } from "../_components/upcoming-events-card";
import { RecentActivityCard } from "../_components/recent-activity-card";
import { CalibrationCard } from "../_components/calibration-card";

export function MissionControlView() {
  const [digest, setDigest] = useState<MissionControlDigest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/intelligence")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))
      .then((data) => { if (!cancelled) setDigest(data); })
      .catch(() => { if (!cancelled) setError("Couldn't load your Mission Control digest — try refreshing."); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
        {error}
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <BriefingCard briefing={digest.briefing} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ActionQueueCard actionQueue={digest.actionQueue} />
        <div id="opportunities">
          <OpportunityRiskCard snapshot={digest.opportunitySnapshot} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectorAttentionCard sectorAttention={digest.sectorAttention} />
        <UpcomingEventsCard upcomingEvents={digest.upcomingEvents} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentActivityCard scope={digest.recentActivityScope} />
        {digest.calibration.eligible && <CalibrationCard calibration={digest.calibration} />}
      </div>
    </div>
  );
}
