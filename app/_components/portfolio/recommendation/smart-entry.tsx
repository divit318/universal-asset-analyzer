export type EntryMode = "recommended" | "manual";

/**
 * The modal's only up-front decision: let the optimizer size the position, or
 * size it yourself. Everything downstream — the recommendation panel, the
 * manual sizing controls, the primary CTA's label — is revealed by this
 * answer, so the opening view is a stock summary and one question rather than
 * three strategy cards, a sizing-mode switcher and a funding panel at once.
 *
 * There is deliberately no "sizing strategy" choice any more. Recommended
 * means the engine picks the amount; Manual means the user does. A third
 * conservative/balanced/aggressive dial in between only asked the user to
 * re-specify, in vaguer language, the thing one of those two modes already
 * settles.
 */
export function AllocationChoice({
  mode,
  onChange,
}: {
  mode: EntryMode | null;
  onChange: (mode: EntryMode) => void;
}) {
  return (
    <div role="radiogroup" aria-label="How would you like to invest?" className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">How would you like to invest?</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <EntryOption
          selected={mode === "recommended"}
          onClick={() => onChange("recommended")}
          title="Recommended Allocation"
          badge="Recommended"
          description="The optimizer sizes this position from your targets, concentration limits and available cash."
          icon={
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <circle cx="10" cy="10" r="7" className="opacity-30" />
              <path d="M10 3a7 7 0 0 1 6.3 3.9L10 10Z" fill="currentColor" stroke="none" />
            </svg>
          }
        />
        <EntryOption
          selected={mode === "manual"}
          onClick={() => onChange("manual")}
          title="Manual Allocation"
          description="Choose the amount yourself — by dollars, shares, % of portfolio or % of cash."
          icon={
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M4 6h12M4 10h12M4 14h12" className="opacity-40" />
              <circle cx="8" cy="6" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="13" cy="10" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="7" cy="14" r="1.8" fill="currentColor" stroke="none" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

function EntryOption({
  selected,
  onClick,
  title,
  description,
  badge,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  badge?: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-brand/50 bg-brand/5" : "border-border bg-surface/40 hover:border-brand/30"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? "border-brand bg-brand" : "border-border-strong"
        }`}
      >
        {selected && (
          <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="var(--surface)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10l4 4 8-8" />
          </svg>
        )}
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">{title}</span>
          {badge && (
            <span className="rounded-control bg-brand/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand">
              {badge}
            </span>
          )}
        </span>
        <span className="text-[11px] leading-snug text-muted">{description}</span>
      </span>

      <span aria-hidden className={`ml-auto shrink-0 self-center ${selected ? "text-brand" : "text-muted/50"}`}>
        {icon}
      </span>
    </button>
  );
}
