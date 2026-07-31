"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/ai/types";
import { GroundingBadge } from "@/app/_components/grounding-badge";
import { LoadingLine } from "@/app/_components/loading-panel";
import { Markdown } from "./markdown";
import { SaveNoteButton } from "../research-notes";

/** One conversation turn. User turns are compact; assistant turns render the
 * full research markdown plus an optional reasoning trace and source chips. */
export function Message({ message, streaming, symbol }: { message: ChatMessage; streaming?: boolean; symbol?: string }) {
  const [showReasoning, setShowReasoning] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-strong/15 px-4 py-2.5 text-sm text-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const empty = !message.content && !message.reasoning;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="text-accent">◆</span>
        <span className="font-medium">Research Copilot</span>
      </div>

      {message.reasoning ? (
        <div className="rounded-lg border border-border bg-surface-2/50">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            <span>{showReasoning ? "Hide" : "Show"} reasoning</span>
            <span>{showReasoning ? "▾" : "▸"}</span>
          </button>
          {showReasoning ? (
            <p className="whitespace-pre-wrap border-t border-border px-3 py-2 text-xs leading-5 text-muted">
              {message.reasoning}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="text-sm text-foreground">
        {empty && streaming ? (
          <LoadingLine message="Analyzing the dossier…" />
        ) : (
          <Markdown content={message.content} />
        )}
        {streaming && message.content ? (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />
        ) : null}
      </div>

      {!streaming && message.grounding ? (
        <GroundingBadge grounding={message.grounding} className="pt-1" />
      ) : null}

      {message.citations && message.citations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted">Sources:</span>
          {message.citations.map((c) =>
            c.url ? (
              <a
                key={c.tag}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-accent hover:bg-surface-2"
                title={c.tag}
              >
                {c.label} ↗
              </a>
            ) : (
              <span
                key={c.tag}
                className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted"
                title={c.tag}
              >
                {c.label}
              </span>
            ),
          )}
        </div>
      ) : null}

      {/* Save-note action: only show on completed assistant turns with content */}
      {!streaming && message.content && symbol ? (
        <div className="flex justify-end pt-1">
          <SaveNoteButton symbol={symbol} content={message.content} />
        </div>
      ) : null}
    </div>
  );
}
