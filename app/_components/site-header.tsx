import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-black/[.08] dark:border-white/[.145]">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
          asset<span className="text-zinc-400">/</span>analyzer
        </Link>
        <div className="flex items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/analyze" className="transition-colors hover:text-foreground">
            Analyze
          </Link>
        </div>
      </nav>
    </header>
  );
}
