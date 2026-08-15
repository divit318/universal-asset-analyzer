"use client";

import { useEffect, useRef, useState } from "react";
import { createMeridianField } from "./field";
import { computeGeometry, limbPathD } from "./stations";
import series from "../ink/hero-series.json";

/**
 * MeridianField — the hero's full-viewport observatory plate.
 *
 * Three layers, one DOM canvas:
 *   1. The canvas: engraved plate (offscreen, blitted) + live dust and
 *      constellation (field.ts). ONE canvas element — the e2e contract
 *      addresses `section#hero canvas` as a single node.
 *   2. The limb legend: the page's thesis line as REAL TEXT on an SVG
 *      textPath riding the limb — the kicker is engraved on the
 *      instrument itself, selectable and readable by assistive tech.
 *   3. Grain: one static turbulence tile at whisper opacity, so the
 *      darkness reads as material rather than #000 CSS.
 */
export function MeridianField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const section = wrap.closest("section");
    if (!(section instanceof HTMLElement)) return;

    // Canvas text (year labels, degree numerals) must use the same mono the
    // page does: probe the resolved family instead of hardcoding a stack.
    const probe = document.createElement("span");
    probe.className = "font-mono";
    probe.style.cssText = "position:absolute;visibility:hidden";
    probe.textContent = "0";
    wrap.appendChild(probe);
    const monoFamily = getComputedStyle(probe).fontFamily || "ui-monospace, monospace";
    probe.remove();

    const field = createMeridianField(canvas, { section, series, monoFamily });
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 8) setSize({ w: r.width, h: r.height });
    });
    ro.observe(wrap);
    return () => {
      field.destroy();
      ro.disconnect();
    };
  }, []);

  const compact = size !== null && size.w < 768;
  const geo = size ? computeGeometry(size.w, size.h, compact) : null;

  return (
    <div ref={wrapRef} data-ink-target="hero-ink" className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} data-hero-field aria-hidden="true" className="absolute inset-0 h-full w-full" />

      {/* The engraved thesis — real text riding the limb. */}
      {geo && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
          viewBox={`0 0 ${Math.round(geo.w)} ${Math.round(geo.h)}`}
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <path id="mk-limb-legend" d={limbPathD(geo, compact ? 10 : 14)} fill="none" />
          </defs>
          {/* data-mk-keepout (desktop only): the engraving claims a ribbon
              of quiet along its stretch of the limb, exactly as the DOM
              text does. On compact plates the arc's bounding box would
              blanket the whole sky band — there the sparse dust may pass
              behind the lettering instead. */}
          <text className="mk-limb-legend" fontSize={compact ? 9.5 : 11.5} data-mk-keepout={compact ? undefined : ""}>
            <textPath href="#mk-limb-legend" startOffset={compact ? "50%" : "60%"} textAnchor="middle">
              Every figure computed. Every claim traced.
            </textPath>
          </text>
        </svg>
      )}

      {/* Materiality: one static grain tile, no animation, whisper-quiet. */}
      <div aria-hidden="true" className="mk-grain absolute inset-0" />
    </div>
  );
}
