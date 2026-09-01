"use client";

/**
 * The intel rail — contextual research intelligence cards.
 *
 * A quiet margin-note column pinned to the right edge, below the header. It
 * watches where the user is researching (route + URL params + the focus
 * spine), asks /api/intel once the context has settled, and renders at most
 * three small cards. Its resting state is nothing at all: no launcher, no
 * empty shell, no skeleton — when the engine has nothing that clears the
 * relevance threshold, this component renders null.
 *
 * Speed: the fetch fires ~1.2s after a context stabilizes (debounced so
 * typing through symbols never spams the API), the server answers from
 * platform-cached data, and if an AI pass is still pending the rail re-polls
 * twice (20s / 65s) and stops — it never waits on AI to show the computed
 * cards, and never polls a hidden tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Compass, Newspaper, PieChart, Sparkles, X } from "lucide-react";
import { useFocusSafe } from "@/lib/focus-context";
import type { IntelCard, IntelResponse, IntelSurface } from "@/lib/intel/types";
import { OPEN_ASSISTANT_EVENT } from "./ai-assistant";

const DEBOUNCE_MS = 1_200;
/** Re-poll offsets while the AI pass is pending. Two shots, then silence. */
const AI_POLL_MS = [20_000, 65_000];
/** A card must be on screen this long before it counts as "shown". */
const SHOWN_AFTER_MS = 8_000;

const CATEGORY_ICON = {
  lead: Compass,
  event: Newspaper,
  portfolio: PieChart,
  suggestion: Sparkles,
} as const;

interface RailContext {
  surface: IntelSurface;
  symbols: string[];
}

/** Route → intel context. Null means the rail has no business on this page. */
function deriveContext(
  pathname: string,
  searchParams: URLSearchParams,
  focusSymbol: string | null,
  focusSymbols: string[],
): RailContext | null {
  // /research is deliberately absent: the Research page consumes the same
  // intel via useIntelCards() and renders it INSIDE its "Why Now?" card. A
  // fixed overlay was occluding the page's own context rail at ≤1700px —
  // intelligence must join the page's hierarchy, not float over it.
  if (pathname === "/valuation" || pathname === "/ic-report") {
    // The focus spine updates when the user switches symbols in-page (the URL
    // often doesn't), so it wins over the initial deep-link param.
    const symbol = focusSymbol ?? searchParams.get("symbol")?.trim().toUpperCase() ?? null;
    return symbol ? { surface: "research", symbols: [symbol] } : null;
  }
  if (pathname === "/compare") {
    const fromUrl = (searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const symbols = fromUrl.length >= 2 ? fromUrl : focusSymbols.slice(0, 3);
    return symbols.length >= 2 ? { surface: "compare", symbols: symbols.slice(0, 4) } : null;
  }
  // /portfolio is deliberately absent too: the Portfolio page renders the same
  // intel as a quiet row under "Know this" (useIntelCards) — the fixed overlay
  // was covering the Alignment tile and the Biggest Mismatch card on a page
  // that is full-width at every viewport.
  if (pathname === "/watchlist") return { surface: "watchlist", symbols: [] };
  if (pathname === "/wire") return { surface: "wire", symbols: [] };
  return null;
}

/**
 * Headless intel consumer for pages that render intelligence INSIDE their own
 * layout instead of as a floating overlay (Research → "Why Now?" card,
 * Portfolio → the row under "Know this").
 *
 * Same contract as the rail: debounced fetch, two re-polls while the AI pass
 * is pending, "shown" reported once per card after it has genuinely been on
 * screen, "opened" reported through `activate`. Cards a user acts on are
 * hidden locally for the session, exactly like the rail's behaviour.
 */
export function useIntelCards(
  context: { surface: IntelSurface; symbols: string[] } | null,
  maxCards = 2,
): {
  cards: IntelCard[];
  activate: (card: IntelCard) => void;
} {
  const router = useRouter();
  const [result, setResult] = useState<{ key: string; cards: IntelCard[] } | null>(null);
  const [used, setUsed] = useState<ReadonlySet<string>>(new Set());
  const shownReported = useRef<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const symbols = context?.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean) ?? [];
  const surface = context?.surface ?? null;
  const contextKey = surface ? `${surface}:${symbols.join(",")}` : null;

  useEffect(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    if (!contextKey || !surface) return;

    const controller = new AbortController();
    const load = async (): Promise<boolean> => {
      if (document.hidden) return false;
      try {
        const params = new URLSearchParams({ surface });
        if (symbols.length > 0) params.set("symbols", symbols.join(","));
        const res = await fetch(`/api/intel?${params}`, { signal: controller.signal });
        if (!res.ok) return false;
        const json = (await res.json()) as IntelResponse;
        if (controller.signal.aborted) return false;
        setResult({ key: contextKey, cards: json.cards });
        return json.aiPending;
      } catch {
        return false; // ambient context: failure renders as nothing
      }
    };

    timers.current.push(
      setTimeout(() => {
        void load().then((aiPending) => {
          if (!aiPending) return;
          for (const delay of AI_POLL_MS) {
            timers.current.push(setTimeout(() => void load(), delay));
          }
        });
      }, DEBOUNCE_MS),
    );

    return () => {
      controller.abort();
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  const cards = useMemo(() => {
    if (!result || result.key !== contextKey) return [];
    return result.cards.filter((c) => !used.has(c.id)).slice(0, maxCards);
  }, [result, contextKey, used, maxCards]);

  useEffect(() => {
    if (cards.length === 0) return;
    const t = setTimeout(() => {
      for (const card of cards) {
        if (shownReported.current.has(card.id)) continue;
        shownReported.current.add(card.id);
        reportIntelEvent(card.id, "shown", card.symbol);
      }
    }, SHOWN_AFTER_MS);
    return () => clearTimeout(t);
  }, [cards]);

  const activate = useCallback(
    (card: IntelCard) => {
      reportIntelEvent(card.id, "opened", card.symbol);
      setUsed((prev) => new Set(prev).add(card.id));
      if (card.action.kind === "assistant" && card.action.prompt) {
        window.dispatchEvent(new CustomEvent(OPEN_ASSISTANT_EVENT, { detail: { question: card.action.prompt } }));
        return;
      }
      const href = card.action.href;
      if (!href) return;
      if (/^https?:\/\//i.test(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        router.push(href);
      }
    },
    [router],
  );

  return { cards, activate };
}

function reportIntelEvent(id: string, status: "shown" | "dismissed" | "opened", symbol?: string) {
  void fetch("/api/intel/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, symbol }),
  }).catch(() => {
    /* suppression is best-effort — never surfaces */
  });
}

export function IntelRail() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const focus = useFocusSafe();

  // Both slots are keyed by the context they belong to and simply don't apply
  // when the context moves on — so a context change needs no state reset in
  // the effect (stale cards filter out at render time instead).
  const [result, setResult] = useState<{ key: string; cards: IntelCard[] } | null>(null);
  const [dismissed, setDismissed] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const shownReported = useRef<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const context = useMemo(
    () => deriveContext(pathname, searchParams, focus?.mostRecent ?? null, focus?.symbols ?? []),
    [pathname, searchParams, focus],
  );
  const contextKey = context ? `${context.surface}:${context.symbols.join(",")}` : null;

  const report = useCallback((id: string, status: "shown" | "dismissed" | "opened", symbol?: string) => {
    void fetch("/api/intel/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, symbol }),
    }).catch(() => {
      /* suppression is best-effort — never surfaces */
    });
  }, []);

  useEffect(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    abortRef.current?.abort();

    if (!contextKey || !context) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const load = async (): Promise<boolean> => {
      if (document.hidden) return false;
      try {
        const params = new URLSearchParams({ surface: context.surface });
        if (context.symbols.length > 0) params.set("symbols", context.symbols.join(","));
        const res = await fetch(`/api/intel?${params}`, { signal: controller.signal });
        if (!res.ok) return false;
        const json = (await res.json()) as IntelResponse;
        if (controller.signal.aborted) return false;
        setResult({ key: contextKey, cards: json.cards });
        return json.aiPending;
      } catch {
        return false; // ambient chrome: failure renders as nothing
      }
    };

    // Debounce the first fetch so rapid navigation/symbol-typing never spams
    // the API, then re-poll only while the AI pass is pending.
    timers.current.push(
      setTimeout(() => {
        void load().then((aiPending) => {
          if (!aiPending) return;
          for (const delay of AI_POLL_MS) {
            timers.current.push(setTimeout(() => void load(), delay));
          }
        });
      }, DEBOUNCE_MS),
    );

    return () => {
      controller.abort();
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  const visible = useMemo(() => {
    if (!result || result.key !== contextKey) return [];
    const hidden = dismissed?.key === contextKey ? dismissed.ids : null;
    return result.cards.filter((c) => !hidden?.has(c.id)).slice(0, 3);
  }, [result, dismissed, contextKey]);

  // After a card has genuinely been on screen for a beat, tell the server so
  // it isn't replayed on the next visit. Once per id per session.
  useEffect(() => {
    if (visible.length === 0) return;
    const t = setTimeout(() => {
      for (const card of visible) {
        if (shownReported.current.has(card.id)) continue;
        shownReported.current.add(card.id);
        report(card.id, "shown", card.symbol);
      }
    }, SHOWN_AFTER_MS);
    return () => clearTimeout(t);
  }, [visible, report]);

  const hideLocally = useCallback(
    (id: string) => {
      if (!contextKey) return;
      setDismissed((prev) => {
        const ids = new Set(prev?.key === contextKey ? prev.ids : []);
        ids.add(id);
        return { key: contextKey, ids };
      });
    },
    [contextKey],
  );

  const dismiss = useCallback(
    (card: IntelCard) => {
      hideLocally(card.id);
      report(card.id, "dismissed", card.symbol);
    },
    [hideLocally, report],
  );

  const activate = useCallback(
    (card: IntelCard) => {
      report(card.id, "opened", card.symbol);
      hideLocally(card.id);
      if (card.action.kind === "assistant" && card.action.prompt) {
        window.dispatchEvent(new CustomEvent(OPEN_ASSISTANT_EVENT, { detail: { question: card.action.prompt } }));
        return;
      }
      const href = card.action.href;
      if (!href) return;
      if (/^https?:\/\//i.test(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        router.push(href);
      }
    },
    [report, router, hideLocally],
  );

  if (visible.length === 0) return null;

  return (
    <aside
      aria-label="Research intelligence"
      className="pointer-events-none fixed right-4 top-36 z-40 hidden w-72 flex-col gap-2 xl:flex"
    >
      {visible.map((card) => {
        const Icon = CATEGORY_ICON[card.category];
        return (
          <article
            key={card.id}
            className="animate-fade-rise pointer-events-auto overflow-hidden rounded-panel border border-border bg-surface/95 shadow-popover backdrop-blur"
          >
            <div className="border-l-2 border-brand/60 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3 w-3 shrink-0 text-brand" strokeWidth={2} />
                <span className="flex-1 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                  {card.eyebrow}
                  {card.symbol ? ` · ${card.symbol}` : ""}
                </span>
                <button
                  onClick={() => dismiss(card)}
                  aria-label={`Dismiss: ${card.eyebrow}`}
                  className="rounded-control p-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground">{card.title}</p>
              {card.detail && <p className="mt-1 text-[11px] leading-snug text-muted">{card.detail}</p>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  onClick={() => activate(card)}
                  className="text-[11px] font-medium text-brand transition-colors hover:text-brand-strong"
                >
                  {card.action.label} →
                </button>
                {card.source === "ai" && (
                  <span
                    className="text-[9px] uppercase tracking-wide text-muted/70"
                    title="An AI interpretation of computed facts — the measured panels win when they disagree."
                  >
                    AI interpretation
                  </span>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </aside>
  );
}
