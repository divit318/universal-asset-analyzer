import Link from "next/link";

const NAV = [
  { href: "/research", label: "Research" },
  { href: "/discover", label: "Discover" },
  { href: "/compare", label: "Compare" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/ic-report", label: "Deep Research" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface/50 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
          <span className="text-accent">◆</span> asset
          <span className="text-muted">/</span>analyzer
        </Link>
        <div className="flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
