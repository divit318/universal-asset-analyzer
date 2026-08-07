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

import { PageHeader } from "@/app/_components/ui";
import { useHydrated } from "./_atmosphere/use-hydrated";
import { fmtTodayDate } from "./_viz/format";
import { useHome } from "./home-provider";

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
    ? [fmtTodayDate("long"), asOf(digest.data?.generatedAt)]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return <PageHeader title="Today" description={description} />;
}
