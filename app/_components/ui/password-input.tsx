"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

/**
 * Password field with a leading lock icon and a trailing show/hide toggle.
 *
 * The credential-manager contract this component keeps (and the auth modal's
 * e2e markup spec asserts):
 * - It renders a real <input type="password"> (type="text" only while
 *   revealed) — `autoComplete` is REQUIRED and must be "current-password" or
 *   "new-password" depending on the form's role.
 * - `id` and `name` are required; the associated <label htmlFor> lives in the
 *   calling form (placeholder-only labelling is banned).
 * - The toggle is type="button" (never submits), keyboard reachable, and
 *   announces its state via aria-pressed + an explicit label.
 * - No :-webkit-autofill overrides: the browser's autofill tint stays visible
 *   in both themes on purpose — legible autofill beats palette purity.
 */
export interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  name: string;
  autoComplete: "current-password" | "new-password";
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = "", ...props }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={`h-10 w-full rounded-control border border-border bg-surface pl-9 pr-10 text-sm text-foreground placeholder:text-faint outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60 ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-control text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <span key={visible ? "off" : "on"} className="animate-icon-swap inline-flex">
            {visible
              ? <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              : <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
          </span>
        </button>
      </div>
    );
  },
);
