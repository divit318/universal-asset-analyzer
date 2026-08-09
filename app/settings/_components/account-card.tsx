"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, User } from "lucide-react";
import { Card } from "@/app/_components/ui";
import type { PublicUser } from "@/lib/auth";
import { validDisplayName, validEmail } from "@/lib/auth-gate";

/**
 * Account card — avatar initial, display name, email, plus the one truthful
 * badge this product supports: "Local" (the account lives in data/app.db).
 * There are no roles or plan tiers in the user model, so none are shown.
 *
 * Save is disabled until a field is dirty, disabled again after a successful
 * save, and both success and failure state are explicit — no silent saves.
 * The sign-out row lives beneath, mirroring the account menu's action.
 */
export function AccountCard({ initialUser }: { initialUser: PublicUser }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialUser);
  const [displayName, setDisplayName] = useState(initialUser.displayName);
  const [email, setEmail] = useState(initialUser.email);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const dirty = displayName !== saved.displayName || email !== saved.email;
  const valid = validDisplayName(displayName) && validEmail(email);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || !valid || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email }),
      });
      const data: { user?: PublicUser; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.user) {
        setStatus({ kind: "error", message: data.error ?? "Saving failed — please try again." });
        return;
      }
      setSaved(data.user);
      setDisplayName(data.user.displayName);
      setEmail(data.user.email);
      setStatus({ kind: "success", message: "Profile saved." });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the local server." });
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      router.push("/landing");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const initial = (saved.displayName.trim()[0] ?? "?").toUpperCase();

  return (
    <Card padding="lg">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-muted text-lg font-bold text-brand"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-foreground">{saved.displayName}</h2>
            <span
              className="rounded-full bg-brand-muted px-2 py-0.5 text-micro font-semibold uppercase tracking-widest text-brand"
              title="This account is stored in this machine's local database (data/app.db)."
            >
              Local
            </span>
          </div>
          <p className="truncate text-sm text-muted">{saved.email}</p>
        </div>
      </div>

      <form onSubmit={save} className="mt-6 flex flex-col gap-4" noValidate>
        <fieldset disabled={saving} className="flex flex-col gap-4">
          <div>
            <label htmlFor="account-name" className="mb-1.5 block text-caption font-medium text-muted">Display name</label>
            <div className="relative">
              <User aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
              <input
                id="account-name"
                name="name"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setStatus(null); }}
                aria-invalid={!validDisplayName(displayName) ? true : undefined}
                className="h-10 w-full rounded-control border border-border bg-surface pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label htmlFor="account-email" className="mb-1.5 block text-caption font-medium text-muted">Email</label>
            <div className="relative">
              <Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
              <input
                id="account-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setStatus(null); }}
                aria-invalid={!validEmail(email) ? true : undefined}
                className="h-10 w-full rounded-control border border-border bg-surface pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60"
              />
            </div>
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
              disabled={!dirty || !valid || saving}
              className="inline-flex h-9 items-center justify-center rounded-control bg-brand px-5 text-sm font-semibold text-background transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </fieldset>
      </form>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <p className="text-sm text-muted">Signed in on this machine.</p>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="rounded-control border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </Card>
  );
}
