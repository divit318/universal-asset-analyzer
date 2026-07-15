"use client";

/**
 * Module 2 — AI Investment Brief.
 *
 * The long-form morning note. Same model call as Today's Brief (see
 * lib/home/brief.ts); this module just renders the `note` section of it.
 *
 * When Ollama is down there is no long note — and this module says exactly
 * that rather than padding the space with the deterministic headline the module
 * above already shows. A second copy of the same sentence is not a brief.
 */

import { Sparkles } from "lucide-react";
import { Badge } from "@/app/_components/ui";
import { getHomeModule } from "@/lib/home/registry";
import type { SectionState } from "@/app/_components/ui";
import type { HomeBrief } from "@/lib/home/contracts";
import { ModuleShell } from "../module-shell";
import { useHome } from "../home-provider";

const definition = getHomeModule("ai-investment-brief");

type Note = NonNullable<HomeBrief["note"]>;

const SECTIONS: { key: keyof Omit<Note, "recommendations">; label: string }[] = [
  { key: "regime", label: "Market regime" },
  { key: "opportunities", label: "Biggest opportunities" },
  { key: "risks", label: "Biggest risks" },
  { key: "portfolio", label: "Portfolio observations" },
  { key: "sectors", label: "Sectors to watch" },
  { key: "macro", label: "Macro developments" },
];

export function AiInvestmentBriefModule({
  collapsible,
  defaultCollapsed,
}: {
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const { brief, refreshBrief } = useHome();

  const state: SectionState<Note> = {
    status: brief.status,
    data: brief.data?.note ?? null,
    error: brief.error,
    revalidating: brief.revalidating,
  };

  return (
    <ModuleShell
      definition={definition}
      state={state}
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
      minHeight={200}
      onRefresh={refreshBrief}
      emptyMessage="The long-form note needs a running local model. Start Ollama and refresh."
    >
      {(note) => (
        <div className="flex flex-col gap-5">
          <Badge variant="brand">
            <Sparkles className="h-2.5 w-2.5" strokeWidth={2} /> AI generated
          </Badge>

          <div className="grid gap-5 sm:grid-cols-2">
            {SECTIONS.filter((s) => note[s.key]).map((s) => (
              <div key={s.key} className="flex flex-col gap-1.5">
                <h3 className="text-label font-semibold uppercase tracking-wide text-muted">{s.label}</h3>
                <p className="text-sm leading-6 text-foreground/85">{note[s.key]}</p>
              </div>
            ))}
          </div>

          {note.recommendations.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="text-label font-semibold uppercase tracking-wide text-muted">Recommendations</h3>
              <ul className="flex flex-col gap-1.5">
                {note.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-6 text-foreground/85">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="border-t border-border pt-4 text-xs leading-5 text-muted">
            AI-generated from the engine outputs shown elsewhere on this page. Verify independently. Not investment advice.
          </p>
        </div>
      )}
    </ModuleShell>
  );
}
