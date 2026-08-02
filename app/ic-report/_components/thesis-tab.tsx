"use client";

/**
 * IC Report — thesis tab.
 *
 * Bull/base/bear are shown side by side (Phase 5.16) with each narrative
 * bound to its engine-computed scenario value; agent disagreements render as
 * first-class output ahead of the synthesis summary (Phase 3.5).
 */

import type { Thesis } from "@/lib/ic-thesis";
import type { SynthesisResult } from "@/lib/ic-synthesis";
import type { ValuationSuiteResult } from "@/lib/ic-valuation";
import { fmtMoney, fmtPercent } from "@/lib/ic/format";
import { Card, EmptyState } from "./shared";

export function ThesisTab({
  thesis,
  synthesis,
  valuation,
  currency,
}: {
  thesis: Thesis | undefined;
  synthesis: SynthesisResult | null | undefined;
  valuation: ValuationSuiteResult | undefined;
  currency: string;
}) {
  if (!thesis || !thesis.bull) {
    return <EmptyState title="No thesis yet" detail="The thesis forms after the agent network completes." />;
  }
  const sc = valuation?.dcf.scenarios ?? null;

  const cases = [
    { key: "bear", label: "Bear case", text: thesis.bear, tone: "border-negative/40", labelTone: "text-negative", value: sc?.bear.result.perShare ?? null },
    { key: "base", label: "Base case", text: thesis.base, tone: "border-brand/40", labelTone: "text-brand", value: sc?.base.result.perShare ?? null },
    { key: "bull", label: "Bull case", text: thesis.bull, tone: "border-positive/40", labelTone: "text-positive", value: sc?.bull.result.perShare ?? null },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* AI-interpretation label (product rule: measured vs interpreted) */}
      <p className="text-xs text-muted">
        The narratives below are the model&apos;s interpretation of the agent research; every value beside them is computed by the deterministic engine. Where narrative and numbers disagree, the numbers win.
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        {cases.map((c) => (
          <Card key={c.key} className={c.tone}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className={`text-sm font-semibold uppercase ${c.labelTone}`}>{c.label}</h3>
              {c.value != null && (
                <span className="font-mono text-sm font-semibold" title="Engine-computed scenario value">
                  {fmtMoney(c.value, currency)}
                </span>
              )}
            </div>
            <p className="text-sm leading-6">{c.text || "Not provided."}</p>
          </Card>
        ))}
      </div>

      {/* Disagreements are signal (3.5) */}
      {synthesis && synthesis.disagreements.length > 0 && (
        <Card className="border-warning/40">
          <h3 className="mb-2 text-sm font-semibold text-warning">
            Where the agents disagree ({synthesis.disagreements.length})
          </h3>
          <div className="space-y-3">
            {synthesis.disagreements.map((d, i) => (
              <div key={i}>
                <p className="text-sm font-medium">{d.topic}</p>
                <ul className="mt-1 space-y-0.5">
                  {d.positions.map((p, j) => (
                    <li key={j} className="text-xs text-muted">
                      <span className="font-medium text-foreground">{p.agent}:</span> {p.position}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      {synthesis?.crossAgentSummary && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Cross-agent synthesis</h3>
          <p className="text-sm leading-6 text-muted">{synthesis.crossAgentSummary}</p>
          {synthesis.duplicatesRemoved > 0 && (
            <p className="mt-2 text-label text-muted/70">
              {synthesis.duplicatesRemoved} repeated insight{synthesis.duplicatesRemoved === 1 ? "" : "s"} across agents folded into single attributed findings.
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Variant perception</h3>
          <p className="text-sm leading-5 text-muted">{thesis.variantPerception || "Not provided."}</p>
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Market expectations</h3>
          <p className="text-sm leading-5 text-muted">{thesis.marketExpectations || "Not provided."}</p>
          {valuation?.reverse?.impliedGrowth != null && (
            <p className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs text-muted">
              Computed: the current price implies {fmtPercent(valuation.reverse.impliedGrowth)} stage-1 FCF growth (reverse DCF).
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { title: "Key catalysts", items: thesis.keyCatalysts, tone: "text-positive" },
          { title: "Key drivers", items: thesis.keyDrivers, tone: "text-brand" },
          { title: "Key risks", items: thesis.keyRisks, tone: "text-negative" },
        ].map(({ title, items, tone }) => (
          <Card key={title}>
            <h3 className={`mb-3 text-sm font-semibold ${tone}`}>{title}</h3>
            {items.length === 0 ? (
              <p className="text-xs text-muted">None provided.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted">
                    <span className={`mt-0.5 shrink-0 ${tone}`} aria-hidden="true">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
