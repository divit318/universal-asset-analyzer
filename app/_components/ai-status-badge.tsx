"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";

interface KeyStatus {
  configured: boolean;
  source: "env" | "file" | null;
}

/**
 * Header badge for AI readiness.
 *
 * AI readiness is exactly one question now: is an Anthropic API key
 * configured? The badge answers it honestly — "AI · Claude Opus 5" when a key
 * exists, "AI off · add key" when not — and links to /settings either way,
 * because that is where both states are managed. It never claims locality:
 * generation is hosted, on the user's own key.
 */
export function AiStatusBadge() {
  const [status, setStatus] = useState<"checking" | "ready" | "no-key">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/ai-key")
      .then((r) => r.json())
      .then((d: KeyStatus) => {
        if (!cancelled) setStatus(d.configured ? "ready" : "no-key");
      })
      .catch(() => {
        if (!cancelled) setStatus("no-key");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") return null;

  return status === "ready" ? (
    <Link
      href="/settings"
      className="flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-xs font-medium text-positive"
      title="AI ready: Claude Opus 5 via the Anthropic API, using your API key. Manage it in Settings."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-positive" />
      AI · Claude Opus 5
    </Link>
  ) : (
    <Link
      href="/settings"
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted"
      title={`AI features are off. ${AI_RECOVERY_HINT}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      AI off · add key
    </Link>
  );
}
