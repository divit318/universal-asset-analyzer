"use client";

import { useEffect, useState } from "react";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";

interface ActiveModel {
  id: string;
  label: string;
  provider: string;
}

/**
 * Header badge for AI readiness.
 *
 * Named for Ollama because that was the only backend when it was written; it
 * now reports whichever provider the Router would actually use, and says which
 * one, because "AI offline" meant two very different fixes depending on
 * whether the user is on the hosted or the local path.
 */
export function OllamaStatusBadge() {
  const [status, setStatus] = useState<"checking" | "live" | "offline">("checking");
  const [model, setModel] = useState<string>("");
  const [hosted, setHosted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/screener/nl")
      .then((r) => r.json())
      .then((d: { active?: ActiveModel | null }) => {
        if (cancelled) return;
        if (!d.active) {
          setStatus("offline");
          return;
        }
        setStatus("live");
        setHosted(d.active.provider === "devin");
        // "mistral" from "mistral:latest"; the registry label for hosted ids,
        // which are not colon-tagged and read badly when truncated.
        setModel(d.active.provider === "devin" ? d.active.label : d.active.id.split(":")[0]);
      })
      .catch(() => { if (!cancelled) setStatus("offline"); });
    return () => { cancelled = true; };
  }, []);

  if (status === "checking") return null;

  return status === "live" ? (
    <span
      className="flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-xs font-medium text-positive"
      title={`AI ready via ${hosted ? "Devin (hosted)" : "Ollama (local)"} · model: ${model}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-positive" />
      AI · {model}
    </span>
  ) : (
    <span
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted"
      title={`No AI provider available. ${AI_RECOVERY_HINT}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      AI offline
    </span>
  );
}
