"use client";

import { useState } from "react";
import { Button, Input } from "@/app/_components/ui";
import type { ChatMessage } from "@/lib/ai-research";

/** Lightweight inline Q&A — not persisted across visits, unlike the symbol-based ResearchCopilot (no session/history table for manual assets). */
export function ManualAssetChat({ assetId }: { assetId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setQuestion("");
    setError(null);
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await fetch(`/api/manual-assets/${assetId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Chat failed");
      setMessages((m) => [...m, { role: "assistant", content: json.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-medium">Ask about this asset</h3>

      {messages.length > 0 && (
        <div className="flex flex-col gap-2">
          {messages.map((m, i) => (
            <div key={i} className={`rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "self-end bg-brand/10 text-foreground" : "self-start bg-surface-2 text-muted"}`}>
              {m.content}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-negative">{error}</p>}

      <form onSubmit={ask} className="flex gap-2">
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. how does the cash-on-cash return compare to a typical rental?" disabled={loading} />
        <Button type="submit" variant="secondary" disabled={loading || !question.trim()}>
          {loading ? "Asking…" : "Ask"}
        </Button>
      </form>
    </div>
  );
}
