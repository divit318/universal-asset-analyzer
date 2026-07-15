"use client";

/**
 * Module 1 — Today's Brief.
 *
 * Renders the AI headline when the stream delivers one, and the digest's
 * deterministic briefing until (or instead of) that. The distinction is shown,
 * not hidden: a reader is entitled to know whether a sentence was written by a
 * model or assembled from engine output.
 */

import { Sparkles } from "lucide-react";
import { Badge } from "@/app/_components/ui";
import { getHomeModule } from "@/lib/home/registry";
import type { SectionState } from "@/app/_components/ui";
import type { HomeBrief } from "@/lib/home/contracts";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("todays-brief");

export function TodaysBriefModule() {
  const { brief, refreshBrief } = useHome();
  const digestSlice = useHomeSlice("fallbackBriefing");

  // The module always has something true to say. The AI stream is an upgrade to
  // the deterministic text, never a prerequisite for rendering — so this module
  // resolves to "success" as soon as the digest lands, regardless of Ollama.
  const fallback = digestSlice.data ?? "";

  const state: SectionState<{ text: string; ai: boolean }> = {
    status: brief.data?.headline
      ? "success"
      : digestSlice.status === "success"
        ? "success"
        : digestSlice.status,
    data: brief.data?.headline
      ? { text: brief.data.headline, ai: brief.data.aiGenerated }
      : fallback
        ? { text: fallback, ai: false }
        : null,
    error: digestSlice.error,
    // The quiet refresh dot shows while the model is still writing.
    revalidating: brief.status === "loading" || brief.revalidating,
  };

  return (
    <ModuleShell
      definition={definition}
      state={state}
      minHeight={96}
      onRefresh={refreshBrief}
      emptyMessage="No market or portfolio data yet."
    >
      {(data) => (
        <div className="flex flex-col gap-3">
          <p className="text-pretty text-base leading-7 text-foreground/90">{data.text}</p>
          <div className="flex items-center gap-2">
            {data.ai ? (
              <Badge variant="brand">
                <Sparkles className="h-2.5 w-2.5" strokeWidth={2} /> AI generated
              </Badge>
            ) : (
              <Badge variant="neutral">Computed</Badge>
            )}
            {brief.status === "loading" && !data.ai ? (
              <span className="text-xs text-muted">Writing the AI brief…</span>
            ) : null}
          </div>
        </div>
      )}
    </ModuleShell>
  );
}

export type { HomeBrief };
