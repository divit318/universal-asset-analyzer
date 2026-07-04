"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { OllamaStatusBadge } from "./ollama-status";

/* Nav groups keep the 10-item bar scannable at a glance */
const NAV_GROUPS = [
  {
    label: "Discover & Screen",
    items: [
      { href: "/scanner",         label: "Scanner"     },
      { href: "/screener",        label: "Screener"    },
      { href: "/thematic",        label: "Thematic"    },
      { href: "/intelligence",    label: "Intelligence"},
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/research", label: "Research" },
      { href: "/compare",  label: "Compare"  },
    ],
  },
  {
    label: "Analysis",
    items: [
      { href: "/ic-report",      label: "IC Report"   },
      { href: "/dcf",            label: "DCF"         },
      { href: "/engine",         label: "Engine"      },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { href: "/watchlist",      label: "Watchlist"   },
      { href: "/portfolio",      label: "Portfolio"   },
      { href: "/calendar",       label: "Calendar"    },
    ],
  },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-md">
      <nav className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-6">
        {/* Logo */}
        <Link
          href="/"
          className="shrink-0 font-mono text-sm font-semibold tracking-tight transition-opacity hover:opacity-80"
          onClick={() => setMobileOpen(false)}
        >
          <span className="text-accent">◆</span>{" "}
          <span className="text-foreground">asset</span>
          <span className="text-muted">/</span>
          <span className="text-foreground">analyzer</span>
        </Link>

        {/* Desktop nav — groups with visible labels */}
        <div className="hidden flex-1 items-stretch gap-0 md:flex">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label} className="flex items-center">
              {gi > 0 && (
                <span className="mx-3 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              )}
              <div className="group/navgroup relative flex flex-col gap-0">
                {/* Tiny group label — appears on hover or when a child is active */}
                {/* -top must keep the label inside the h-14 header: the group
                    row starts ~14px down, so -12px lands the 9px label at y≈2. */}
                <div className={`absolute -top-[12px] left-2.5 flex items-center gap-1 transition-opacity duration-150 ${
                  group.items.some((i) => isActive(i.href)) ? "opacity-100" : "opacity-0 group-hover/navgroup:opacity-100"
                }`}>
                  <span className="text-[9px] font-semibold uppercase leading-none tracking-widest text-muted/60 whitespace-nowrap">
                    {group.label}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`relative shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        isActive(item.href)
                          ? "bg-accent/10 text-accent"
                          : "text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      {item.label}
                      {isActive(item.href) && (
                        <span className="absolute bottom-0 left-1/2 h-px w-4 -translate-x-1/2 rounded-full bg-accent opacity-60" />
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <OllamaStatusBadge />

          {/* Mobile hamburger */}
          <button
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground md:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="3" x2="15" y2="15" />
                <line x1="15" y1="3" x2="3" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="2" y1="5" x2="16" y2="5" />
                <line x1="2" y1="9" x2="16" y2="9" />
                <line x1="2" y1="13" x2="16" y2="13" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown — grouped */}
      {mobileOpen && (
        <div id="mobile-nav" className="border-t border-border bg-surface pb-4 md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col px-4 pt-2">
            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label}>
                {gi > 0 && <div className="my-1 border-t border-border/50" />}
                <p className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-widest text-muted/50">
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                        isActive(item.href)
                          ? "bg-accent/10 text-accent"
                          : "text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
