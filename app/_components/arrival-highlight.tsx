"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const PARAM = "highlight";

/**
 * Reads the `highlight` query param, reactively. Notification navigation
 * uses next/navigation's router.push() — when the destination is the SAME
 * route as the page the user is already on (e.g. clicking a second Portfolio
 * notification while already on /portfolio), Next.js re-renders the existing
 * page instead of remounting it, so a one-time "read window.location on
 * mount" effect would miss the new param entirely. useSearchParams() is the
 * hook that's actually wired into the router and re-renders on every
 * client-side navigation, at the cost of requiring a Suspense boundary —
 * see the default export of app/{watchlist,research,portfolio}/page.tsx.
 */
export function useArrivalTarget(): string | null {
  return useSearchParams().get(PARAM);
}

function clearHighlightParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete(PARAM);
  // replaceState, not push — stripping the param shouldn't create a back-stack
  // entry a user has to click through to get back to wherever they came from.
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * Drop once per destination page (alongside useArrivalTarget()). Polls for
 * the element tagged `data-arrival-target="<targetId>"` — data on these pages
 * loads asynchronously, so the element the notification points at may not
 * exist yet on the first render — scrolls it into view, and pulses it via
 * the `arrival-flash` CSS animation (app/globals.css).
 */
export function ArrivalHighlight({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return;
    let pollHandle: ReturnType<typeof setTimeout> | null = null;
    let clearHandle: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const maxAttempts = 24; // ~6s at 250ms — generous for async-loaded sections

    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-arrival-target="${CSS.escape(targetId)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("arrival-flash");
        clearHandle = setTimeout(() => {
          el.classList.remove("arrival-flash");
          clearHighlightParam();
        }, 3300); // covers the 2x 1600ms pulse cycle
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) pollHandle = setTimeout(tick, 250);
    };
    tick();

    return () => {
      if (pollHandle) clearTimeout(pollHandle);
      if (clearHandle) clearTimeout(clearHandle);
    };
  }, [targetId]);

  return null;
}
