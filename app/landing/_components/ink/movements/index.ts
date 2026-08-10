import type { Movement } from "../types";
import { lensMovement } from "./lens";
import { wellMovement } from "./well";
import { sealMovement } from "./seal";

/**
 * Movements on the shared ink engine, in scroll order: Lens (solution) ·
 * Well (demo) · Seal (cta).
 *
 * The HERO is deliberately absent: it runs its own trail-accumulation
 * canvas (../hero-field.ts) because trails must persist between frames and
 * no other section is allowed that technique. Shards (problem) retired with
 * the Problem rebuild: the fragmentation diagram in the section itself does
 * that work now (shards.ts remains for reference). Pinch (privacy) retired
 * with the Local-first rebuild: the section now argues with a proof block,
 * and evidence spends credibility on atmosphere (pinch.ts remains for
 * reference). Silence (features, comparison, pricing, faq) is the
 * deliberate absence of an entry.
 */
export const INK_MOVEMENTS: Movement[] = [
  lensMovement,
  wellMovement,
  sealMovement,
];
