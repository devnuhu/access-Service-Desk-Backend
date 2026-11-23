import { useEffect, useRef, useState } from "react";

/**
 * The rendered width of an element, kept up to date (charts draw at their real pixel size, so
 * text stays readable on a phone). `fallback` until it is measured (and in tests).
 */
export default function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    // The window too: a layout change (a breakpoint) is not always reported to the observer at once.
    window.addEventListener("resize", measure);
    const frame = window.requestAnimationFrame?.(measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      window.removeEventListener("resize", measure);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);
  return [ref, width];
}
