import { useEffect } from "react";

/**
 * Pointer-driven 3D tilt for any element carrying `data-tilt` (value = max degrees).
 * One delegated listener; only active for a fine pointer and when motion is allowed.
 */
export function useTiltEffect() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let current: HTMLElement | null = null;
    let frame = 0;

    const reset = (element: HTMLElement) => {
      element.classList.remove("is-tilting");
      element.style.removeProperty("--rx");
      element.style.removeProperty("--ry");
    };

    const move = (event: PointerEvent) => {
      if (!fine.matches || reduced.matches || event.pointerType !== "mouse") return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tilt]") : null;
      if (current && current !== target) reset(current);
      current = target;
      if (!target) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (current !== target) return;
        const rect = target.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        const strength = Number(target.dataset.tilt) || 8;
        target.style.setProperty("--rx", `${((0.5 - y) * strength).toFixed(2)}deg`);
        target.style.setProperty("--ry", `${((x - 0.5) * strength).toFixed(2)}deg`);
        target.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
        target.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
        target.classList.add("is-tilting");
      });
    };

    const leave = () => {
      cancelAnimationFrame(frame);
      if (current) reset(current);
      current = null;
    };

    document.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      leave();
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, []);
}
