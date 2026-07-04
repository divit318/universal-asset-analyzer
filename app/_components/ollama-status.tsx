"use client";

import { useEffect, useState } from "react";

export function OllamaStatusBadge() {
  const [status, setStatus] = useState<"checking" | "live" | "offline">("checking");
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/screener/nl")
      .then((r) => r.json())
      .then((d: { models?: string[] }) => {
        if (cancelled) return;
        const models = d.models ?? [];
        if (models.length > 0) {
          setStatus("live");
          setModel(models[0].split(":")[0]); // e.g. "mistral" from "mistral:latest"
        } else {
          setStatus("offline");
        }
      })
      .catch(() => { if (!cancelled) setStatus("offline"); });
    return () => { cancelled = true; };
  }, []);

  if (status === "checking") return null;

  return status === "live" ? (
    <span
      className="flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-xs font-medium text-positive"
      title={`Ollama running · model: ${model}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-positive" />
      AI · {model}
    </span>
  ) : (
    <span
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted"
      title="Ollama is offline — AI features unavailable. Run `ollama serve` to start it."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      AI offline
    </span>
  );
}
