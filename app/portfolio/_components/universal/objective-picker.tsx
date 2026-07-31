"use client";

import type { Objective, ObjectiveConfig } from "@/lib/portfolio/engines/optimize";

/**
 * The segmented objective selector shared by the Optimize tab and the Cash
 * tab — same markup, same active-state styling, same "pick one" behavior in
 * both places (deliberately: "Income" means the same thing whichever tab
 * you're on). Callers own filtering `entries` and looking up `description`
 * so this stays a pure rendering component with no engine-specific logic.
 */
export function ObjectivePicker({
  entries,
  active,
  onChange,
  description,
  disabled,
  heading = "Objective",
  headingTag: Heading = "h3",
}: {
  entries: [Objective, ObjectiveConfig][];
  active: Objective;
  onChange: (o: Objective) => void;
  description: string;
  disabled?: boolean;
  heading?: string;
  headingTag?: "h3" | "h4";
}) {
  return (
    <div className="flex flex-col gap-2">
      <Heading className="text-xs font-semibold uppercase tracking-wider text-muted">{heading}</Heading>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([id, cfg]) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              disabled={disabled}
              title={cfg.description}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                isActive
                  ? "border-brand bg-brand/10 font-semibold text-foreground"
                  : "border-border text-muted hover:border-brand/40 hover:text-foreground"
              }`}
            >
              <span aria-hidden>{cfg.icon}</span>
              {cfg.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-muted/70">{description}</p>
    </div>
  );
}
