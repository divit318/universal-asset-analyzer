"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createInkEngine } from "./engine";
import { INK_MOVEMENTS } from "./movements";

/**
 * InkField — the page's single vessel of ink, split across two fixed
 * canvases sharing one particle pool:
 *
 *   - BACK  (below content): all ambient and formation ink
 *   - FRONT (above content, pointer-events none): only the Membrane's
 *     pressure highlight and the Return's glyph resolution, alpha ≤ 0.35
 *
 * Both are PORTALED to document.body: the app's page-enter template
 * animation leaves a transform on a page wrapper, and a transformed
 * ancestor becomes the containing block for fixed descendants — which
 * would stretch the canvases over the whole document instead of the
 * viewport. On body, fixed means fixed.
 *
 * Content never depends on these canvases: they are aria-hidden, and every
 * word on the page is fully present without them.
 */
export function InkField() {
  const backRef = useRef<HTMLCanvasElement | null>(null);
  const frontRef = useRef<HTMLCanvasElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- the portal
       host (document.body) only exists after hydration; SSR renders nothing. */
    setHost(document.body);
  }, []);

  useEffect(() => {
    const back = backRef.current;
    const front = frontRef.current;
    if (!back || !front || !host) return;
    const engine = createInkEngine(back, front, INK_MOVEMENTS);
    return () => engine.destroy();
  }, [host]);

  if (!host) return null;
  return createPortal(
    <>
      <canvas
        ref={backRef}
        aria-hidden="true"
        data-ink-field="back"
        className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
      />
      <canvas
        ref={frontRef}
        aria-hidden="true"
        data-ink-field="front"
        className="pointer-events-none fixed inset-0 z-[5] h-full w-full"
      />
    </>,
    host,
  );
}
