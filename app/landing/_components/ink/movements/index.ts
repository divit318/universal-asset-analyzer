import type { Movement } from "../types";
import { shardsMovement } from "./shards";
import { lensMovement } from "./lens";
import { pinchMovement } from "./pinch";
import { wellMovement } from "./well";
import { sealMovement } from "./seal";

/**
 * Movements on the shared ink engine, in scroll order: Shards (problem) ·
 * Lens (solution) · Pinch (privacy) · Well (demo) · Seal (cta).
 *
 * The HERO is deliberately absent: it runs its own trail-accumulation
 * canvas (../hero-field.ts) because trails must persist between frames and
 * no other section is allowed that technique. Silence (features,
 * comparison, pricing, faq) is the deliberate absence of an entry.
 */
export const INK_MOVEMENTS: Movement[] = [
  shardsMovement,
  lensMovement,
  pinchMovement,
  wellMovement,
  sealMovement,
];
