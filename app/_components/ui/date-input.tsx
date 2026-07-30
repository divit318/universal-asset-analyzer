"use client";

import { formatDate } from "@/lib/format";
import { Input } from "./input";

/**
 * A date field whose displayed date matches the rest of the app.
 *
 * ## The problem this exists for
 *
 * Every date UAA *renders* goes through `formatDate` — one locale, `en-US`,
 * month-first: "Jul 30, 2026". Every date the user *types* went through a bare
 * `<input type="date">`, which renders in the BROWSER's locale, not the app's.
 * On a machine set to en-GB the Simulator's "Exact target date" showed
 * `dd/mm/yyyy` while the Dashboard two tabs away showed `Jul 30, 2026`, so
 * `05/07/2026` was genuinely ambiguous: 5 July by the field, 7 May by everything
 * else on the screen. For a field that sets a portfolio's target date, that is a
 * real misreading, not a cosmetic one.
 *
 * ## Why the native input is kept
 *
 * A native date input's own text is rendered by the browser and OS. It is not
 * reachable from CSS or JS — there is no attribute, no pseudo-element and no
 * locale override that changes it. The choices are therefore to rebuild the
 * control (losing the platform picker, keyboard behaviour, and mobile
 * date-wheel, and taking on parsing of half-typed input) or to keep the native
 * control for ENTRY and make the app state the resolved date in its own format.
 *
 * The second is chosen: the echo below the field is unambiguous regardless of
 * what the widget above it shows, and it is `formatDate` — the same function the
 * Dashboard uses — so the two can never drift. The `value` is always an ISO
 * `yyyy-mm-dd` string either way, so nothing downstream changes.
 */
export function DateInput({
  value,
  onChange,
  /** Suppresses the echo — for a field where the parsed date adds nothing. */
  echo = true,
  className = "",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & {
  /** ISO `yyyy-mm-dd`, or "" for empty. */
  value: string;
  onChange: (iso: string) => void;
  echo?: boolean;
}) {
  return (
    <span className="flex flex-col gap-1">
      <Input
        {...props}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      />
      {/* Only once a date is actually set: echoing "—" next to an empty field
          says nothing and adds a line to every form that has one. */}
      {echo && value !== "" && (
        <span className="text-[11px] text-muted/70">
          {/* aria-hidden: the input already announces its own value, and a screen
              reader reading the same date twice in two formats is noise. */}
          <span aria-hidden>{formatDate(value)}</span>
        </span>
      )}
    </span>
  );
}
