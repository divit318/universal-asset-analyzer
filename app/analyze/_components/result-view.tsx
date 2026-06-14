import type { AnalysisResult } from "@/lib/types";

export function ResultView({ result }: { result: AnalysisResult }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Analysis for{" "}
        <code className="font-mono">{result.asset.name}</code>
      </p>

      <dl className="grid gap-px overflow-hidden rounded-lg border border-black/[.08] bg-black/[.08] sm:grid-cols-3 dark:border-white/[.145] dark:bg-white/[.145]">
        {result.insights.map((insight) => (
          <div key={insight.label} className="flex flex-col gap-1 bg-background p-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">
              {insight.label}
            </dt>
            <dd className="font-mono text-sm">{insight.value}</dd>
          </div>
        ))}
      </dl>

      <p className="font-mono text-xs text-zinc-500">
        analyzed at {result.analyzedAt}
      </p>
    </div>
  );
}
