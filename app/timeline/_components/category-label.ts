import type { TimelineEventCategory } from "@/lib/types";

/** "share_buyback" -> "Share Buyback". Derived, not a lookup table — new categories need no map update. */
export function categoryLabel(category: TimelineEventCategory): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
