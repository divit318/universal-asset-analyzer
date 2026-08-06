"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

interface ProviderStatus {
  id: string;
  label: string;
  reachable: boolean;
  models: string[];
  keyed: boolean;
  key: { configured: boolean; source: "env" | "file" | null } | null;
}

interface ProvidersResponse {
  reachable: boolean;
  active: { provider: string; model: string | null } | null;
  providers: ProviderStatus[];
}

/** How a keyless provider gets connected — shown when it is unreachable. */
const CONNECT_HINT: Record<string, string> = {
  devin: "Install the Devin CLI and run `devin login`. No API key is needed — inference runs on your Devin plan.",
  ollama: "Start the local Ollama daemon (`ollama serve`) and pull a registered model to enable offline AI.",
};

const KEY_PLACEHOLDER: Record<string, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  gemini: "AIza…",
  openrouter: "sk-or-…",
};

function ProviderRow({ provider, onChanged }: { provider: ProviderStatus; onChanged: () => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, key: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save the API key.");
        return;
      }
      setDraft("");
      setSaved(true);
      onChanged();
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
      await fetch("/api/settings/ai-providers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id }),
      });
      onChanged();
    } catch {
      setError("Could not remove the API key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="md">
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${provider.reachable ? "bg-positive" : "bg-muted"}`}
        />
        <p className="text-sm font-medium">{provider.label}</p>
        <span className="text-xs text-muted">
          {provider.reachable
            ? provider.models.length > 0
              ? `ready · ${provider.models.length} model${provider.models.length === 1 ? "" : "s"}`
              : "reachable"
            : provider.keyed
              ? provider.key?.configured
                ? "key configured — first request will validate it"
                : "no API key"
              : "not connected"}
        </span>
      </div>

      {!provider.keyed && !provider.reachable && CONNECT_HINT[provider.id] && (
        <p className="mt-1 text-xs text-muted">{CONNECT_HINT[provider.id]}</p>
      )}
      {provider.id === "devin" && provider.reachable && (
        <p className="mt-1 text-xs text-muted">
          Signed in via the Devin CLI — inference runs on your Devin plan, no API key needed.
        </p>
      )}

      {provider.keyed && (
        <div className="mt-2">
          {provider.key?.configured && (
            <p className="text-xs text-muted">
              {provider.key.source === "env"
                ? "Key from an environment variable — it takes precedence over a key saved here and can only be changed where the app is launched."
                : "Key stored on this machine (~/.uaa, owner-only permissions)."}
            </p>
          )}
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field
              label={provider.key?.configured ? "Replace API key" : "API key"}
              hint="Saved under ~/.uaa with owner-only permissions — outside the project folder and outside data backups. Sent only to this provider's API, never shown or logged."
            >
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={KEY_PLACEHOLDER[provider.id] ?? "API key"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
              />
            </Field>
            {error && <p className="text-sm text-negative">{error}</p>}
            {saved && <p className="text-sm text-positive">Key saved.</p>}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={busy || draft.trim().length === 0}
              >
                Save key
              </Button>
              {provider.key?.source === "file" && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void clearKey()}
                >
                  Remove stored key
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}

/**
 * Settings — the AI provider chain.
 *
 * UAA is provider-agnostic: the Router walks this chain, best first, and uses
 * the first provider that can serve the routed model. The Devin CLI (top of
 * the default chain) needs no API key at all; the hosted APIs are BYO-key,
 * saved to local key files (~/.uaa/*, mode 600, outside the repository and
 * outside data/ backups); Ollama is the local offline tier. Keys are never
 * displayed back, never logged, and are sent only to their own provider.
 */
export default function SettingsPage() {
  const [data, setData] = useState<ProvidersResponse | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/settings/ai-providers")
      .then((r) => r.json())
      .then((d: ProvidersResponse) => setData(d))
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Configuration lives on this machine. Nothing here is synced anywhere."
      />

      <SettingsNav />

      <div className="flex flex-col gap-4">
        <SectionHeader
          label="AI providers"
          description="The Router walks this chain, best first, per request. The Devin CLI needs no API key; the hosted APIs are bring-your-own-key; Ollama is the local offline tier. Reorder with AI_PROVIDER_ORDER."
        />

        {data && !data.reachable && (
          <Card variant="highlight" padding="md" className="border-warning/40 bg-warning/5">
            <p className="text-sm font-medium">AI features are disabled — no provider is connected.</p>
            <p className="mt-1 text-sm text-muted">
              Every metric, score, and valuation on every page is computed locally by the
              deterministic engines and keeps working without AI. Connecting a provider only
              enables the written narration (verdicts, briefs, the research copilot). Easiest
              path: install the Devin CLI and run <span className="font-mono">devin login</span> —
              no API key required.
            </p>
          </Card>
        )}

        {data?.providers.map((p) => <ProviderRow key={p.id} provider={p} onChanged={refresh} />)}
        {!data && (
          <Card padding="md">
            <p className="text-sm text-muted">Checking provider status…</p>
          </Card>
        )}

        <p className="text-xs text-muted">
          What leaves this machine when AI runs: the prompt for that feature — company metrics,
          filings excerpts and, where relevant, portfolio context — sent to the one provider that
          serves the request. Your database never leaves this machine; the model narrates the
          numbers, it never computes them.
        </p>
      </div>
    </PageShell>
  );
}
