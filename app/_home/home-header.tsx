"use client";

/**
 * The homepage's page heading.
 *
 * This is NOT the hero that was deleted. The old hero was a marketing pitch
 * ("Institutional-grade equity research, in your browser") with a feature-count
 * strip, aimed at someone deciding whether to use the product — on the first
 * screen of a product they had already installed and were already using.
 *
 * This is the `<h1>` the page needs to be navigable: it names where you are and
 * when the data is from. Every other page in the app has one, and the e2e smoke
 * suite (correctly) asserts it — dropping it left the dashboard as a wall of
 * `<h2>`s with no top-level landmark for a screen reader to anchor on.
 */

import { useSyncExternalStore } from "react";
import { PageHeader } from "@/app/_components/ui";
import { useHome } from "./home-provider";

/**
 * True only once hydrated.
 *
 * `toLocaleDateString`/`toLocaleTimeString` resolve against the *renderer's*
 * locale and timezone. This component is server-rendered before it is hydrated,
 * so the server (UTC) and the browser (wherever the user actually is) format
 * the same instant into different strings — and React throws a hydration
 * mismatch (#418), which the e2e suite catches as a console error.
 *
 * `useSyncExternalStore` is the sanctioned way to express "this value differs
 * between server and client": the server snapshot returns false, the client
 * snapshot returns true, and nothing subscribes because the answer never
 * changes after mount. Doing it with `useState` + `useEffect` works too, but
 * sets state synchronously inside an effect, which is a cascading render that
 * React's lint rules (correctly) reject.
 */
const emptySubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

function asOf(iso: string | undefined): string {
  if (!iso) return "";
  return `Updated ${new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function HomeHeader() {
  const { digest } = useHome();
  const hydrated = useHydrated();

  // Server renders the title alone; the browser fills in its own local date and
  // time, which is the only one correct for the person reading it.
  const description = hydrated
    ? [
        new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
        asOf(digest.data?.generatedAt),
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return <PageHeader title="Today" description={description} />;
}
