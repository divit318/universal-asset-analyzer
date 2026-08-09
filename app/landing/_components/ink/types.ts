/**
 * The Ink Field type surface, movement edition. Five sealed movements own
 * their own particle sub-pools, bounds, and lifecycles; they never blend
 * positions with a neighbour. Transitions are seam relays: a movement
 * retires its ink to its exit seam, the next spawns from its entry seam.
 */

export interface InkRect {
  /** Viewport-space coordinates (the canvases are fixed). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InkPointer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
  /** False on touch devices: pointer forces are disabled entirely. */
  enabled: boolean;
}

export interface InkPalette {
  brand: string;
  brandStrong: string;
  foreground: string;
  background: string;
  muted: string;
  /** Value-ramp stops, derived from the tokens at mount (never hardcoded):
   *  core = near-white with a warm cast, falloff = deep amber. */
  core: string;
  falloff: string;
}

/**
 * Six materials, one renderer: per-movement parameters for the shared
 * draw path. Materials are the second differentiation axis after
 * silhouette; every formation must be made of a visibly different
 * substance.
 */
export interface InkMaterial {
  shape: "dot" | "streak" | "angular";
  /** 0 for dots; 6-18 px elongation along velocity for filament/flow. */
  streakLength: number;
  jitter: number;
  blend: "additive" | "normal";
  /** 0 loose scatter .. 1 solid (the Seal). Scales dot radius overlap. */
  packing: number;
  /** surface = the Well's 1D height field; everything else is free. */
  constrain: "free" | "surface";
  /** 0 disables neighbour linking. */
  linkDistance: number;
  maxLinks: number;
  linkAlpha: number;
}

export const DEFAULT_MATERIAL: InkMaterial = {
  shape: "dot",
  streakLength: 0,
  jitter: 0,
  blend: "additive",
  packing: 0.4,
  constrain: "free",
  linkDistance: 0,
  maxLinks: 0,
  linkAlpha: 0,
};

/**
 * Everything a movement sees, reused (mutated in place) every frame. The
 * typed arrays are the SHARED pool; a movement touches only the indices in
 * `slots[0..slotCount)`, which it acquired from the free list.
 */
export interface MoveContext {
  /** The slot indices this movement currently owns. */
  slots: Int32Array;
  slotCount: number;
  /** Pool arrays, indexed by slot. */
  px: Float32Array;
  py: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** WRITE: target position, alpha 0..1, sprite size (px), per slot. */
  tx: Float32Array;
  ty: Float32Array;
  alpha: Float32Array;
  size: Float32Array;
  /** Per-slot spawn envelope 0..1 (engine-managed; multiply into alpha). */
  life: Float32Array;
  /** WRITE: 1 = draw on the front layer (capped at 0.35 alpha). */
  layer: Uint8Array;
  /** WRITE: 1 = exempt from keep-out masking (designed resolutions only). */
  exempt: Uint8Array;
  /** Stable per-slot randomness. */
  seed: Float32Array;

  /** 0..1 through this movement's full scroll range (all its sections). */
  progress: number;
  /** Lifecycle envelope 0..1: rises on entry, falls toward the seam exit. */
  presence: number;
  /** True while the movement is being retired (presence falling to 0). */
  retiring: boolean;
  /** Page-space y of the seam the ink should retire toward. */
  seamY: number;

  dt: number;
  time: number;
  scrollY: number;
  scrollV: number;
  vw: number;
  vh: number;
  reduced: boolean;

  gBack: CanvasRenderingContext2D;
  gFront: CanvasRenderingContext2D;
  pointer: InkPointer;
  palette: InkPalette;
  sprite: HTMLCanvasElement;
  spriteHi: HTMLCanvasElement;

  section(id: string): InkRect | null;
  target(name: string): InkRect | null;
  /** Per-movement persistent scratch (pool-sized), allocated once. */
  mem(key: string, fill?: number): Float32Array;
  param<T>(key: string): T | undefined;
  dom(key: string): HTMLElement[] | undefined;
  rand(i: number, salt?: number): number;
}

export interface Movement {
  id: string;
  /** Contiguous landing section ids this movement covers, in scroll order. */
  sections: string[];
  /** Material parameters for the shared renderer. */
  material: InkMaterial;
  /**
   * Formation sub-regions (viewport coords). Occupied area drives the
   * density budget; regions also bound spawn points. Return [] when the
   * layout for this movement is not measurable yet.
   */
  regions(ctx: MoveContext): InkRect[];
  /** Called every fixed step while the movement holds any slots. */
  step(ctx: MoveContext): void;
  /** Optional overlay drawing (gBack / gFront). */
  draw?(ctx: MoveContext): void;
  /** Post-integration constraints (bounce, clamp). */
  constrain?(ctx: MoveContext): void;
  /** Return true when at rest: allows the loop to park (the Return). */
  settled?(ctx: MoveContext): boolean;
  /** Default true: retiring targets drift to the seam. The Stream leaves as
   *  a sealed unit instead and sets this false. */
  seamDrift?: boolean;
  /** Density unit override (px² per particle). */
  unit?: number;
  /** Hard cap on this movement's particle count. */
  maxCount?: number;
}
