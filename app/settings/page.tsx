"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input, PageHeader, PageShell, SectionHeader } from "@/app/_components/ui";

/**
 * Settings sub-nav — rendered on THIS page only (the account page is the auth
 * session's; per HANDOFF-MIGRATION.md we don't restructure its route).
 */
function SettingsNav() {
  const pathname = usePathname();
  const tabs = [
    { href: "/settings", label: "AI" },
    { href: "/settings/account", label: "Account" },
  ];
  return (
    <nav aria-label="Settings sections" className="flex gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-brand text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

interface KeyStatus {
  configured: boolean;
  source: "env" | "file" | null;
}

/**
 * Settings — today, one section: the Anthropic API key.
 *
 * BYO-key is the default path: the key is saved to a local file
 * (~/.uaa/anthropic_api_key, mode 600), outside the repository and outside
 * data/ backups. The ANTHROPIC_API_KEY env var is the exception for demo/CI
 * builds and, when set, wins over the file. The key is never displayed back,
 * never logged, and is sent to exactly one host: api.anthropic.com.
 */
export default function SettingsPage() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/ai-key")
      .then((r) => r.json())
      .then((d: KeyStatus) => {
        if (!cancelled) setStatus(d);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/ai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save the API key.");
        return;
      }
      setStatus((await res.json()) as KeyStatus);
      setDraft("");
      setSaved(true);
    } catch {
      setError("Could not save the API key.");
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/ai-key", { method: "DELETE" });
      setStatus((await res.json()) as KeyStatus);
    } catch {
      setError("Could not remove the API key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Configuration lives on this machine. Nothing here is synced anywhere."
      />

      <SettingsNav />

      <div className="flex flex-col gap-4">
        <SectionHeader
          label="AI — Anthropic API key"
          description="AI narration runs on Claude via the Anthropic API, using your own key."
        />

        {status && !status.configured && (
          <Card variant="highlight" padding="md" className="border-warning/40 bg-warning/5">
            <p className="text-sm font-medium">AI features are disabled — no API key is configured.</p>
            <p className="mt-1 text-sm text-muted">
              Every metric, score, and valuation on every page is computed locally by the
              deterministic engines and keeps working without a key. A key only enables the
              written narration (verdicts, briefs, the research copilot). Create one at{" "}
              <span className="font-mono">console.anthropic.com</span>.
            </p>
          </Card>
        )}

        {status?.configured && (
          <Card padding="md">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" />
              API key configured
              <span className="text-muted">
                {status.source === "env"
                  ? "· from the ANTHROPIC_API_KEY environment variable"
                  : "· stored on this machine (~/.uaa/anthropic_api_key, owner-only permissions)"}
              </span>
            </p>
            {status.source === "env" && (
              <p className="mt-1 text-xs text-muted">
                The environment variable takes precedence over a saved key. It was set by whoever
                launched this process and can only be removed there.
              </p>
            )}
          </Card>
        )}

        <Card padding="md">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field
              label={status?.configured ? "Replace API key" : "API key"}
              hint="Saved to ~/.uaa/anthropic_api_key with owner-only permissions — outside the project folder and outside data backups. It is sent to api.anthropic.com and nowhere else, and is never shown or logged."
            >
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
              />
            </Field>
            {error && <p className="text-sm text-negative">{error}</p>}
            {saved && <p className="text-sm text-positive">Key saved. AI features are enabled.</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={busy || draft.trim().length === 0}>
                Save key
              </Button>
              {status?.source === "file" && (
                <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void clearKey()}>
                  Remove stored key
                </Button>
              )}
            </div>
          </form>
        </Card>

        <p className="text-xs text-muted">
          What leaves this machine when AI runs: the prompt for that feature — company metrics,
          filings excerpts and, where relevant, portfolio context. Your database never leaves this
          machine; the model narrates the numbers, it never computes them.
        </p>
      </div>
    </PageShell>
  );
}
