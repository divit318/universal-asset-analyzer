"use client";

import { useState } from "react";
import type { MarketEvent } from "@/lib/types";

export function SourceExplorer({ events }: { events: MarketEvent[] }) {
  const [open, setOpen] = useState(false);

  const totalSources = events.reduce((sum, e) => sum + e.sources.length, 0);

  return (
    <section className="rounded-xl border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-muted">
          Source Explorer
          <span className="ml-1.5 rounded-full bg-surface-3 px-2 py-0.5 text-xs">
            {totalSources} articles · {events.length} stories
          </span>
        </span>
        <span key={open ? "collapse" : "expand"} className="animate-icon-swap text-muted">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="animate-menu-drop border-t border-border bg-surface">
          {events.map((event) => (
            <div key={event.id} className="border-b border-border last:border-b-0">
              {/* Story header */}
              <div className="px-4 pt-3 pb-1.5">
                <span className="text-xs font-semibold text-foreground">{event.headline}</span>
              </div>
              {/* Sources within story */}
              {event.sources.map((src, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 px-4 py-2 hover:bg-surface-2"
                >
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs leading-5 text-muted hover:text-accent hover:underline"
                  >
                    {src.headline}
                  </a>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted/60">{src.source}</span>
                    {src.url && (
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-accent hover:underline"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
