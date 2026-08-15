/**
 * The Meridian — shared geometry and station derivation.
 *
 * The hero's visual system is an observatory plate: a colossal graduated
 * limb (a circle whose centre sits far below the viewport) arcs across the
 * upper third of the screen, and the market record hangs above it as a
 * constellation. Every renderer — the canvas plate, the live field, and
 * the SVG limb legend — reads THIS module so the three layers can never
 * disagree about where the instrument is.
 *
 * Stations are the constellation's stars: N year-samples of the hero
 * series (NIFTY 50, 2007 to 2026 — the same committed dataset that drove
 * the retired filament ribbon), plotted in the instrument's own polar
 * coordinates: angle = time, altitude above the limb = normalized close.
 * The constellation IS two decades of the index, engraved like a star
 * catalogue. Nothing is invented.
 */

export interface MeridianGeometry {
  w: number;
  h: number;
  /** Limb circle centre (far below the viewport) and radius, in px. */
  cx: number;
  cy: number;
  R: number;
  /** Visible angular span of the limb, radians from vertical (left → right). */
  phi0: number;
  phi1: number;
}

export interface Station {
  /** 0..1 position in time across the series. */
  t: number;
  /** Normalized close, 0..1. */
  v: number;
  /** Calendar year, for the engraved coordinate labels. */
  year: number;
  /** Whether this station carries a visible year label. */
  labeled: boolean;
}

export interface SeriesLike {
  index: string;
  start: string;
  end: string;
  smooth: number[];
}

/** Stations per plate. 20 = one per calendar year of the committed series. */
export const STATION_COUNT = 20;

/** Years that carry an engraved label: first, GFC low, mid-cycle marks,
 *  the covid dip, and the verdict year. Sparse by design — a catalogue
 *  labels what matters, not everything. */
const LABELED_YEARS = new Set([2007, 2009, 2013, 2017, 2020, 2024, 2026]);

/**
 * The limb: a shallow celestial dome across the upper third. The apex sits
 * left-of-centre so the graduated stretch that carries the engraved thesis
 * line clears the headline block below it; the sky band above the limb
 * holds the constellation, biased right.
 */
export function computeGeometry(w: number, h: number, compact: boolean): MeridianGeometry {
  const cx = w * (compact ? 0.5 : 0.55);
  const apexY = h * (compact ? 0.16 : 0.24);
  const R = h * (compact ? 2.6 : 3.4);
  const cy = apexY + R;
  // Visible span: where the circle crosses x = -6%w and x = 106%w (the limb
  // bleeds off both edges — the instrument is larger than the window).
  const phi0 = Math.asin(Math.max(-1, (-0.06 * w - cx) / R));
  const phi1 = Math.asin(Math.min(1, (1.06 * w - cx) / R));
  return { w, h, cx, cy, R, phi0, phi1 };
}

/** A point on (or above) the limb: phi from vertical, alt px above the arc. */
export function limbPoint(geo: MeridianGeometry, phi: number, alt = 0): { x: number; y: number } {
  const r = geo.R + alt;
  return { x: geo.cx + r * Math.sin(phi), y: geo.cy - r * Math.cos(phi) };
}

/**
 * Station placement. Time maps to the right-hand stretch of the visible
 * span (the sky right of the headline's air space); altitude maps the
 * normalized close to a band above the limb, clamped so the tallest star
 * never hides under the fixed nav.
 */
export function stationPoint(geo: MeridianGeometry, s: Station, compact: boolean): { x: number; y: number } {
  const span = geo.phi1 - geo.phi0;
  const a0 = geo.phi0 + span * (compact ? 0.24 : 0.44);
  const a1 = geo.phi0 + span * (compact ? 0.87 : 0.885); // verdict stays ON the plate
  const phi = a0 + (a1 - a0) * s.t;
  const altBand = geo.h * (compact ? 0.1 : 0.19);
  const p = limbPoint(geo, phi, geo.h * 0.035 + altBand * s.v);
  // Nav clearance: the 2026 star must stay a star, not a nav ornament.
  p.y = Math.max(geo.h * 0.11, p.y);
  return p;
}

/** Derive the constellation from the committed hero series. */
export function deriveStations(series: SeriesLike): Station[] {
  const startYear = Number(series.start.slice(0, 4));
  const endYear = Number(series.end.slice(0, 4));
  const last = series.smooth.length - 1;
  return Array.from({ length: STATION_COUNT }, (_, i) => {
    const t = i / (STATION_COUNT - 1);
    const year = Math.round(startYear + t * (endYear - startYear));
    return { t, v: series.smooth[Math.round(t * last)], year, labeled: LABELED_YEARS.has(year) };
  });
}

/**
 * SVG path for an arc riding the limb at a radial offset — the limb legend
 * (the engraved thesis line) draws its textPath along this. Left → right so
 * the text reads forward; sweep=1 because SVG's y-axis points down.
 */
export function limbPathD(geo: MeridianGeometry, alt = 0): string {
  const a = limbPoint(geo, geo.phi0, alt);
  const b = limbPoint(geo, geo.phi1, alt);
  const r = geo.R + alt;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
