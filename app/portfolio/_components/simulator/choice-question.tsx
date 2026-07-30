"use client";

import { useState } from "react";
import { Input } from "@/app/_components/ui";

/**
 * One multiple-choice intake question.
 *
 * ## Why intake is multiple choice
 *
 * The AI interview asked "what is your preferred approach to asset allocation — a
 * globally diversified 60/40 split across public markets, or do you have a
 * preference for regional or sector-specific tilts?" into a free-text box, and the
 * user skipped it. That is the predictable outcome: answering required composing a
 * sentence about portfolio construction, while skipping was one click. The
 * portfolio was then designed on a default the user never chose.
 *
 * Recognising your own view in a list is a far lower bar than writing it. So every
 * intake question — the fixed ones here and the conditional ones the AI still asks
 * — presents concrete options a client can pick as-is.
 *
 * ## Why "Other" is always there anyway
 *
 * Good options make "Other" rare, not unnecessary. On `exclusions` it is the
 * common case ("not my employer's stock"), and on every other topic it is the
 * escape hatch that keeps a well-covered list from becoming a straitjacket. It is
 * a persistent row rather than a mode, so choosing it never hides the options.
 *
 * ## Why Skip survives
 *
 * Skipping with a STATED assumption is the pattern that was already right here —
 * "1 answer was skipped — assumed: X" is honest about a portfolio built on a
 * default. The goal of good options is to make skipping unnecessary, not to make
 * it impossible: forcing an answer just produces a worse one.
 */
export interface ChoiceOption {
  id: string;
  label: string;
}

export function ChoiceQuestion({
  question,
  help,
  options,
  multi = false,
  exclusiveId,
  allowOther = true,
  selectedIds,
  other,
  defaultLabel,
  onChange,
  disabled = false,
}: {
  question: string;
  help?: string;
  options: ChoiceOption[];
  multi?: boolean;
  /** Option that clears all others when picked (e.g. "No exclusions"). */
  exclusiveId?: string;
  allowOther?: boolean;
  selectedIds: string[];
  other: string | null;
  /** What the profile assumes when this is left unanswered. */
  defaultLabel: string;
  onChange: (next: { selectedIds: string[]; other: string | null }) => void;
  disabled?: boolean;
}) {
  // Whether the "Other" row is open is view state, not answer state: a user who
  // opens it, types nothing and moves on has still skipped the question, and
  // persisting an empty string as an answer would suppress the assumption notice.
  const [otherOpen, setOtherOpen] = useState(other !== null);
  const answered = selectedIds.length > 0 || !!other?.trim();

  function toggle(id: string) {
    if (!multi) {
      // Re-picking the current answer clears it. Without this a single-select
      // question is a one-way door: there is no way back to "unanswered" and so
      // no way to take the stated default once you have touched it.
      onChange({ selectedIds: selectedIds[0] === id ? [] : [id], other });
      return;
    }
    if (exclusiveId && id === exclusiveId) {
      onChange({ selectedIds: selectedIds.includes(id) ? [] : [id], other: null });
      setOtherOpen(false);
      return;
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds.filter((x) => x !== exclusiveId), id];
    onChange({ selectedIds: next, other });
  }

  function clear() {
    onChange({ selectedIds: [], other: null });
    setOtherOpen(false);
  }

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground">{question}</span>
        {help && <span className="text-[11px] leading-relaxed text-muted/70">{help}</span>}
      </legend>

      <div className="flex flex-col gap-1">
        {options.map((o) => {
          const active = selectedIds.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              aria-pressed={active}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                active
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted hover:border-brand/40 hover:text-foreground"
              }`}
            >
              <Mark active={active} multi={multi} />
              <span className="leading-relaxed">{o.label}</span>
            </button>
          );
        })}

        {allowOther && (
          <>
            <button
              type="button"
              onClick={() => {
                const next = !otherOpen;
                setOtherOpen(next);
                // Closing "Other" must discard its text, or a hidden value keeps
                // answering a question the user has visibly stopped answering.
                if (!next && other !== null) onChange({ selectedIds, other: null });
              }}
              aria-pressed={otherOpen}
              aria-expanded={otherOpen}
              className={`flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs transition-colors ${
                otherOpen
                  ? "border-brand/60 bg-brand/5 text-foreground"
                  : "border-border text-muted hover:border-brand/40 hover:text-foreground"
              }`}
            >
              <Mark active={otherOpen} multi={multi} />
              <span>Other (type your own)</span>
            </button>
            {otherOpen && (
              <Input
                value={other ?? ""}
                onChange={(e) => onChange({ selectedIds, other: e.target.value })}
                placeholder="In your own words…"
                maxLength={300}
                aria-label={`Your own answer to: ${question}`}
              />
            )}
          </>
        )}
      </div>

      {/* The assumption is shown BEFORE skipping, not after. A default the user
          can only discover by having already accepted it is not disclosure. */}
      <p className="text-[11px] leading-relaxed text-muted/60">
        {answered ? (
          <button type="button" onClick={clear} className="text-brand hover:underline">
            Clear this answer
          </button>
        ) : (
          <>
            Not answered — will assume: <span className="italic">{defaultLabel}</span>
          </>
        )}
      </p>
    </fieldset>
  );
}

/** Radio for single-select, checkbox for multi — the shape states the arity. */
function Mark({ active, multi }: { active: boolean; multi: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center border text-[8px] font-bold ${
        multi ? "rounded-[3px]" : "rounded-full"
      } ${active ? "border-brand bg-brand text-background" : "border-border"}`}
    >
      {active ? "✓" : ""}
    </span>
  );
}
