"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import type { PublicUser } from "@/lib/auth";

/**
 * The account chip — avatar initial, display name, email — with a small menu
 * (Account settings, Sign out).
 *
 * NOT yet mounted: the header (site-header.tsx) is owned by a concurrent
 * workstream, so the mount instruction lives in HANDOFF-LOGIN.md instead of a
 * cross-session edit. Drop `<AccountMenu />` into the header's right cluster;
 * everything else is self-contained.
 *
 * Renders nothing while signed out — with the auth gate off (the default,
 * daily-loop mode) there may be no account at all, and empty chrome would be
 * a lie. Signed-in state is read once from /api/auth/session on mount.
 */
export function AccountMenu({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d: { user: PublicUser | null }) => {
        if (!cancelled) setUser(d.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Click-outside + Escape close for the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      setUser(null);
      setOpen(false);
      router.push("/landing");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const initial = (user.displayName.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.displayName}`}
        className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-1.5 pr-3 text-sm text-foreground transition-colors hover:bg-surface-2"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-5.5 w-5.5 items-center justify-center rounded-full bg-brand-muted text-caption font-bold text-brand"
        >
          {initial}
        </span>
        <span className="hidden max-w-[12ch] truncate font-medium sm:block">{user.displayName}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="animate-menu-drop absolute right-0 top-full z-50 mt-2 w-60 rounded-panel border border-border bg-surface p-1.5 shadow-popover"
        >
          <div className="border-b border-border px-3 pb-2.5 pt-2">
            <p className="truncate text-sm font-semibold text-foreground">{user.displayName}</p>
            <p className="truncate text-caption text-muted">{user.email}</p>
          </div>
          <Link
            role="menuitem"
            href="/settings/account"
            onClick={() => setOpen(false)}
            className="mt-1.5 flex items-center gap-2.5 rounded-control px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-2"
          >
            <Settings className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
            Account settings
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
