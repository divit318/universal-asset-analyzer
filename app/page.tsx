import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-24">
      <div className="flex max-w-2xl flex-col gap-6">
        <p className="font-mono text-sm text-zinc-500">Universal Asset Analyzer</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-balance sm:text-5xl">
          Inspect any asset, understand it instantly.
        </h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Drop in a file, image, or blob of data and get a structured breakdown —
          type, size, and content-level insights — without leaving the browser.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/analyze"
            className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Start analyzing
          </Link>
        </div>
      </div>
    </main>
  );
}
