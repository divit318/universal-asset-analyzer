"use client";

import { useState } from "react";
import { Card } from "@/app/_components/ui";
import { PasswordInput } from "@/app/_components/ui/password-input";
import { passwordStrength, validPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth-gate";

/**
 * Change password — current, new, confirm. Submit stays disabled until all
 * three are valid and the new entries match; success and failure are explicit.
 *
 * Autocomplete contract: current-password on the verification field,
 * new-password on both new entries, and a hidden username field so credential
 * managers know which account the rotation belongs to — the same markup rules
 * the auth modal keeps (asserted by e2e spec-17).
 */
export function ChangePasswordCard({ email }: { email?: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && !validPassword(next);
  const ready = current.length > 0 && validPassword(next) && next === confirm && !submitting;
  const strength = passwordStrength(next);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Changing the password failed — please try again." });
        return;
      }
      setStatus({ kind: "success", message: "Password changed. Other sessions were signed out." });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setStatus({ kind: "error", message: "Could not reach the local server." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padding="lg">
      <h2 className="text-base font-semibold text-foreground">Change password</h2>
      <p className="mt-0.5 text-sm text-muted">
        Changing your password signs out every other session for this account.
      </p>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
        {/* Invisible username anchor for credential managers (never submitted). */}
        {email && (
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            readOnly
            hidden
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        <fieldset disabled={submitting} className="flex flex-col gap-4">
          <div>
            <label htmlFor="pw-current" className="mb-1.5 block text-caption font-medium text-muted">Current password</label>
            <PasswordInput
              id="pw-current"
              name="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => { setCurrent(e.target.value); setStatus(null); }}
            />
          </div>
          <div>
            <label htmlFor="pw-new" className="mb-1.5 block text-caption font-medium text-muted">New password</label>
            <PasswordInput
              id="pw-new"
              name="new-password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => { setNext(e.target.value); setStatus(null); }}
              aria-invalid={tooShort ? true : undefined}
              aria-describedby="pw-new-hint"
            />
            <div id="pw-new-hint" className="mt-1.5 flex items-center gap-2" aria-live="polite">
              <span className="flex h-1 flex-1 gap-1" aria-hidden="true">
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`h-full flex-1 rounded-full transition-colors ${
                      strength.score >= step
                        ? strength.score === 1 ? "bg-negative" : strength.score === 2 ? "bg-warning" : "bg-positive"
                        : "bg-border"
                    }`}
                  />
                ))}
              </span>
              <span className="text-caption text-muted">
                {next.length === 0 ? `At least ${PASSWORD_MIN_LENGTH} characters` : strength.label}
              </span>
            </div>
          </div>
          <div>
            <label htmlFor="pw-confirm" className="mb-1.5 block text-caption font-medium text-muted">Confirm new password</label>
            <PasswordInput
              id="pw-confirm"
              name="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setStatus(null); }}
              aria-invalid={mismatch ? true : undefined}
              aria-describedby={mismatch ? "pw-confirm-error" : undefined}
            />
            {mismatch && (
              <p id="pw-confirm-error" className="mt-1.5 text-caption text-negative">Passwords do not match.</p>
            )}
          </div>

          <div aria-live="polite" className="empty:hidden">
            {status && (
              <p
                className={`rounded-control border px-3 py-2 text-sm ${
                  status.kind === "success"
                    ? "border-positive/30 bg-positive/10 text-positive"
                    : "border-negative/30 bg-negative/10 text-negative"
                }`}
              >
                {status.message}
              </p>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={!ready}
              className="inline-flex h-9 items-center justify-center rounded-control bg-brand px-5 text-sm font-semibold text-background transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Changing…" : "Change password"}
            </button>
          </div>
        </fieldset>
      </form>
    </Card>
  );
}
