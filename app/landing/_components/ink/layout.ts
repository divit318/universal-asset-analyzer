"use client";

import type { InkRect } from "./types";

/**
 * Cached layout for the ink field. Rects are measured in PAGE coordinates on
 * resize / ResizeObserver only, and converted to viewport coordinates once
 * per frame using a single scrollY read (zero layout thrash: nothing reads
 * getBoundingClientRect inside the frame loop).
 *
 * The landing IA's stable anchor ids ARE the section ids; sub-element
 * anchors (cards, the sparkline, the footer glyph) opt in with
 * data-ink-target.
 */

export const INK_SECTIONS = [
  "hero",
  "problem",
  "solution",
  "privacy",
  "features",
  "demo",
  "comparison",
  "pricing",
  "faq",
  "cta",
] as const;

export type InkSectionId = (typeof INK_SECTIONS)[number];

interface PageRect {
  x: number;
  top: number;
  w: number;
  h: number;
}

const sectionRects = new Map<string, PageRect>();
const targetRects = new Map<string, PageRect>();
let docHeight = 0;
let measured = false;

function pageRect(el: Element): PageRect {
  const r = el.getBoundingClientRect();
  return { x: r.left, top: r.top + window.scrollY, w: r.width, h: r.height };
}

/** Re-measure everything. Called on mount, resize, and ResizeObserver fire. */
export function measureLayout(): void {
  sectionRects.clear();
  targetRects.clear();
  for (const id of INK_SECTIONS) {
    const el = document.getElementById(id);
    if (el) sectionRects.set(id, pageRect(el));
  }
  document.querySelectorAll<HTMLElement>("[data-ink-target]").forEach((el) => {
    const name = el.dataset.inkTarget;
    if (name) targetRects.set(name, pageRect(el));
  });
  docHeight = document.documentElement.scrollHeight;
  measured = true;
}

export function layoutReady(): boolean {
  return measured;
}

export function documentHeight(): number {
  return docHeight;
}

/** Viewport-space section rect. */
export function sectionRect(id: string, scrollY: number): InkRect | null {
  const r = sectionRects.get(id);
  if (!r) return null;
  return { x: r.x, y: r.top - scrollY, w: r.w, h: r.h };
}

export function targetRect(name: string, scrollY: number): InkRect | null {
  const r = targetRects.get(name);
  if (!r) return null;
  return { x: r.x, y: r.top - scrollY, w: r.w, h: r.h };
}

/** Page-space scroll range of a movement's contiguous section group. The
 *  terminal group ("cta") extends to the end of the document (footer). */
export function movementRange(sections: string[]): { top: number; bottom: number } | null {
  const first = sectionRects.get(sections[0]);
  const last = sectionRects.get(sections[sections.length - 1]);
  if (!first || !last) return null;
  const bottom = sections[sections.length - 1] === "cta" ? docHeight : last.top + last.h;
  return { top: first.top, bottom };
}
