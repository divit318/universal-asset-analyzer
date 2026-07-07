"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Menu, X, Search, ChevronDown } from "lucide-react";
import { OllamaStatusBadge } from "./ollama-status";
import { ThemeToggle } from "./theme";
import { NotificationBell } from "./notification-bell";
import { NAV, activeObjective, type NavObjective } from "./nav-config";
import { OPEN_PALETTE_EVENT } from "./command-palette";

function openPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

/** A single top-level objective with a hover/focus dropdown of its tools. */
function NavObjectiveItem({ objective, active }: { objective: NavObjective; active: boolean }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasTools = objective.tools.length > 0;

  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); if (hasTools) setOpen(true); }}
      onMouseLeave={scheduleClose}
      onFocusCapture={() => hasTools && setOpen(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <Link
        href={objective.href}
        aria-haspopup={hasTools ? "menu" : undefined}
        aria-expanded={hasTools ? open : undefined}
        className={`inline-flex items-center gap-1 rounded-control px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
          active ? "bg-brand-muted text-brand" : "text-muted hover:bg-surface-2 hover:text-foreground"
        }`}
      >
        {objective.label}
        {hasTools && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />}
      </Link>

      {open && hasTools && (
        <div
          role="menu"
          className="animate-popover-in absolute left-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-panel border border-border bg-surface p-1.5 shadow-popover"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-widest text-faint">
            {objective.tagline}
          </p>
          {objective.tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 rounded-control px-2.5 py-2 outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-muted">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">{tool.label}</span>
                  <span className="text-xs leading-4 text-muted">{tool.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeId = activeObjective(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-6">
        {/* Logo */}
        <Link
          href="/"
          className="mr-2 shrink-0 font-mono text-sm font-semibold tracking-tight outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <span className="text-brand">◆</span>{" "}
          <span className="text-foreground">asset</span>
          <span className="text-faint">/</span>
          <span className="text-foreground">analyzer</span>
        </Link>

        {/* Desktop nav — 4 objectives */}
        <div className="hidden items-center gap-0.5 md:flex">
          {NAV.map((o) => (
            <NavObjectiveItem key={o.id} objective={o} active={activeId === o.id} />
          ))}
        </div>

        {/* Right cluster */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* ⌘K search trigger */}
          <button
            onClick={openPalette}
            className="hidden items-center gap-2 rounded-control border border-border bg-surface-2 py-1.5 pl-2.5 pr-2 text-xs text-muted outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 sm:flex"
            aria-label="Open command palette"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="hidden lg:inline">Search…</span>
            <kbd className="rounded border border-border bg-surface px-1 py-px font-sans text-micro font-medium text-faint">⌘K</kbd>
          </button>

          <NotificationBell />
          <OllamaStatusBadge />
          <ThemeToggle />

          {/* Mobile controls */}
          <button
            onClick={openPalette}
            className="rounded-control p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground sm:hidden"
            aria-label="Search"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button
            className="rounded-control p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground md:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div
          id="mobile-nav"
          className="animate-menu-drop overflow-hidden border-t border-border bg-surface md:hidden"
        >
          {/* Any nav click closes the menu (delegated, so no route-change effect). */}
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4" onClick={() => setMobileOpen(false)}>
              {NAV.map((o) => (
                <div key={o.id}>
                  <Link
                    href={o.href}
                    className={`block text-xs font-semibold uppercase tracking-widest ${
                      activeId === o.id ? "text-brand" : "text-faint"
                    }`}
                  >
                    {o.label}
                  </Link>
                  {o.tools.length > 0 && (
                    <div className="mt-1.5 flex flex-col">
                      {o.tools.map((tool) => (
                        <Link
                          key={tool.href}
                          href={tool.href}
                          className={`rounded-control px-2 py-2 text-sm transition-colors ${
                            pathname === tool.href ? "bg-brand-muted text-brand" : "text-muted hover:bg-surface-2 hover:text-foreground"
                          }`}
                        >
                          {tool.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
      )}
    </header>
  );
}
