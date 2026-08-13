import type { Movement } from "../types";
import { streamsMovement } from "./streams";

/**
 * Movements on the shared ink engine, in scroll order: Streams (solution).
 *
 * The HERO is deliberately absent: it runs its own trail-accumulation
 * canvas (../hero-field.ts) because trails must persist between frames and
 * no other section is allowed that technique. Shards (problem) retired with
 * the Problem rebuild: the fragmentation diagram in the section itself does
 * that work now (shards.ts remains for reference). Pinch (privacy) retired
 * with the Local-first rebuild: the section now argues with a proof block,
 * and evidence spends credibility on atmosphere (pinch.ts remains for
 * reference). Well (demo) retired with the Try It rebuild: the section now
 * loads with a real pre-loaded engine result, and the output region belongs
 * to the output (well.ts remains for reference). Seal (cta) retired with
 * the final-CTA rebuild: the close now removes friction with a spec block,
 * and nothing decorative sits between the argument and the action (seal.ts
 * remains for reference). Silence (features, comparison, pricing, faq) is
 * the deliberate absence of an entry.
 */
export const INK_MOVEMENTS: Movement[] = [
  streamsMovement,
];
