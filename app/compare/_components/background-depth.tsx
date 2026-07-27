"use client";

import { useEffect, useRef } from "react";

/**
 * A large, blurred, very-low-opacity radial light that trails the cursor at
 * a fraction of its speed — the "dynamic background depth" effect. Deliberately
 * subliminal: heavy easing (6% of the remaining distance per frame) and a
 * huge blur radius mean it should register as "the page feels less flat"
 * rather than as a visible moving object. Skipped entirely under
 * prefers-reduced-motion.
 */
export function BackgroundDepth() {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const target = { x: pos.x, y: pos.y };

    function onMove(e: MouseEvent) {
      target.x = e.clientX;
      target.y = e.clientY;
    }
    window.addEventListener("mousemove", onMove);

    let raf: number;
    function tick() {
      pos.x += (target.x - pos.x) * 0.06;
      pos.y += (target.y - pos.y) * 0.06;
      const el = dotRef.current;
      if (el) el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div
        ref={dotRef}
        className="absolute h-[700px] w-[700px] rounded-full opacity-[0.05] blur-[140px]"
        style={{
          background: "radial-gradient(circle, var(--brand) 0%, transparent 70%)",
          left: 0,
          top: 0,
          willChange: "transform",
        }}
      />
    </div>
  );
}
