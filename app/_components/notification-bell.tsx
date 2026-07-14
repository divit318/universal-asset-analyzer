"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import type { Notification } from "@/lib/types";
import { relativeAge } from "@/lib/provenance";
import { useToast } from "@/app/_components/toast";

const POLL_MS = 90_000; // evaluate alerts every 90s while the app is open

/** Relative age of an ISO timestamp; kept out of render so the impure Date.now
 *  call isn't made during rendering. */
function ago(iso: string): string {
  return relativeAge(Date.now() - Date.parse(iso));
}

/** Raise an OS notification for the newest unread alert, when the browser has
 *  granted permission. Mutates the ref so each alert toasts at most once. */
function osToast(list: Notification[], lastNotifiedId: { current: number }): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (window.Notification.permission !== "granted") return;
  const newest = list.find((n) => !n.read && n.id > lastNotifiedId.current);
  if (newest) {
    lastNotifiedId.current = Math.max(...list.map((n) => n.id));
    new window.Notification(newest.title, { body: newest.body });
  }
}

/**
 * Notification center — the delivery end of the alert pipeline. Polls the
 * monitor (which evaluates watchlist/portfolio alerts against live quotes and
 * persists any that fire), shows an unread badge, and lists notifications in a
 * dropdown. When the browser grants permission it also raises an OS toast, so
 * an alert reaches the user even on another tab.
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [navigatingId, setNavigatingId] = useState<number | null>(null);
  const [resolveError, setResolveError] = useState<{ id: number; message: string } | null>(null);
  const lastNotifiedId = useRef(0);
  const navigatingRef = useRef<number | null>(null); // ref alongside the state — state updates are async and can't gate a synchronous double-click
  const router = useRouter();
  const toast = useToast();

  // Poll the monitor while mounted. All setState happens in async continuations
  // (never synchronously in the effect body), matching the app's polling idiom.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/monitor/run", { method: "POST" });
        const json = (await r.json()) as { created: number; unread: number };
        if (cancelled) return;
        setUnread(json.unread);
        if (json.created > 0) {
          const lr = await fetch("/api/notifications");
          const lj = (await lr.json()) as { items: Notification[]; unread: number };
          if (cancelled) return;
          setItems(lj.items);
          setUnread(lj.unread);
          osToast(lj.items, lastNotifiedId);
        }
      } catch {
        /* monitoring is best-effort */
      }
    }
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setResolveError(null);
    if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "default") {
      void window.Notification.requestPermission();
    }
    try {
      const r = await fetch("/api/notifications");
      const json = (await r.json()) as { items: Notification[]; unread: number };
      setItems(json.items);
      setUnread(json.unread);
    } catch {
      /* best-effort */
    }
  }

  async function markAll() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "readAll" }),
    });
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    setUnread(0);
  }

  async function markOne(id: number) {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    });
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
  }

  /**
   * Every notification is clickable, navigating to wherever it points.
   * Resolution happens server-side (lib/notifications/routing.ts) so the
   * target's continued existence is checked against live data, not a stale
   * client cache — a sold-off holding or a removed watchlist item gracefully
   * redirects to the closest relevant page instead of a dead destination.
   *
   * "Read" is only set once resolution succeeds and navigation is about to
   * happen — a failed lookup (network error) leaves the notification unread
   * so the user can retry, per the read-only-on-success requirement.
   */
  async function navigate(n: Notification) {
    if (navigatingRef.current != null) return; // rapid-click / duplicate-navigation guard
    navigatingRef.current = n.id;
    setNavigatingId(n.id);
    setResolveError(null);
    try {
      const r = await fetch(`/api/notifications/resolve?id=${n.id}`);
      const json = (await r.json()) as { href?: string; fallbackUsed?: boolean; message?: string | null; error?: string };
      if (!r.ok || !json.href) throw new Error(json.error ?? "Could not resolve this notification's destination");

      if (!n.read) await markOne(n.id);
      setOpen(false);
      if (json.message) toast(json.message, json.fallbackUsed ? "info" : "success");
      router.push(json.href);
    } catch (e) {
      setResolveError({ id: n.id, message: e instanceof Error ? e.message : "Navigation failed — try again" });
    } finally {
      navigatingRef.current = null;
      setNavigatingId(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative flex h-8 w-8 items-center justify-center rounded-control text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="animate-popover-in absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-panel border border-border bg-surface shadow-popover">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {items.some((n) => !n.read) && (
                <button onClick={markAll} className="text-xs text-brand hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-muted">
                  No alerts yet. Set a price target or drop alert on a watchlist stock, or hold a position that moves ≥7% in a day.
                </p>
              ) : (
                items.map((n) => (
                  <div key={n.id} className="border-b border-border last:border-0">
                    <button
                      onClick={() => void navigate(n)}
                      disabled={navigatingId != null}
                      aria-busy={navigatingId === n.id}
                      className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-2 disabled:cursor-wait ${
                        n.read ? "opacity-60" : ""
                      } ${navigatingId === n.id ? "bg-surface-2" : ""}`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            n.read ? "bg-transparent" : n.severity === "warning" ? "bg-negative" : "bg-positive"
                          }`}
                          aria-hidden
                        />
                        <span className="text-sm font-medium text-foreground">{n.title}</span>
                        {navigatingId === n.id && (
                          <span className="text-micro text-muted animate-pulse">Opening…</span>
                        )}
                      </span>
                      <span className="pl-3.5 text-xs leading-5 text-muted">{n.body}</span>
                      <span className="pl-3.5 text-micro text-faint">{ago(n.createdAt)}</span>
                    </button>
                    {resolveError?.id === n.id && (
                      <div className="flex items-center justify-between gap-2 bg-negative/8 px-3 py-1.5 text-micro text-negative">
                        <span>{resolveError.message}</span>
                        <button onClick={() => void navigate(n)} className="shrink-0 underline underline-offset-2 hover:no-underline">
                          Try again
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
