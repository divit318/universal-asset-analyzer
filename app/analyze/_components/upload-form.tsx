"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/types";
import { ResultView } from "./result-view";

type Status = "idle" | "analyzing" | "error";

export function UploadForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setStatus("analyzing");
    setError(null);

    const body = new FormData();
    body.append("file", file);

    try {
      const res = await fetch("/api/analyze", { method: "POST", body });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      setResult(data as AnalysisResult);
      setStatus("idle");
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-black/20 px-6 py-12 text-center transition-colors hover:border-foreground/50 dark:border-white/20">
        <span className="text-sm font-medium">
          {status === "analyzing"
            ? "Analyzing…"
            : "Choose a file to analyze"}
        </span>
        <span className="text-xs text-zinc-500">
          {fileName ?? "Any file type · up to 25 MB"}
        </span>
        <input
          type="file"
          className="sr-only"
          onChange={onFileChange}
          disabled={status === "analyzing"}
        />
      </label>

      {status === "error" && error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {result ? <ResultView result={result} /> : null}
    </div>
  );
}
