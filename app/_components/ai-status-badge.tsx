"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";

interface ProvidersStatus {
  reachable: boolean;
  active: { provider: string; model: string | null } | null;
}

const PROVIDER_SHORT: Record<string, string> = {
  devin: "Devin",
  anthropic: "Claude API",
  openai: "OpenAI",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

/**
 * Header badge for AI readiness.
 *
 * AI readiness is one question: can at least one provider in the chain serve
 * a model right now? The badge answers it honestly — "AI · <provider>" naming
 * the provider the Router would reach first, or "AI off · connect" when the
 * whole chain is down — and links to /settings either way, because that is
 * where both states are managed. It never claims locality: generation is
 * hosted unless the user has explicitly routed to the local tier.
 */
export function AiStatusBadge() {
  const [status, setStatus] = useState<"checking" | "ready" | "off">("checking");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/ai-providers")
      .then((r) => r.json())
      .then((d: ProvidersStatus) => {
        if (cancelled) return;
        setStatus(d.reachable ? "ready" : "off");
        setActive(d.active ? (PROVIDER_SHORT[d.active.provider] ?? d.active.provider) : null);
      })
      .catch(() => {
        if (!cancelled) setStatus("off");
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
      title={`AI ready via ${active ?? "your configured provider"}. Manage providers in Settings.`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-positive" />
      AI · {active ?? "ready"}
    </Link>
  ) : (
    <Link
      href="/settings"
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted"
      title={`AI features are off. ${AI_RECOVERY_HINT}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      AI off · connect
    </Link>
  );
}
