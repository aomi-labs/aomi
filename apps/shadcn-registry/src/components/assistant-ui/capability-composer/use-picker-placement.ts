import { useLayoutEffect, useRef, useState } from "react";

/** Keep the picker inside the composer viewport, including the mobile keyboard. */
export function usePickerPlacement() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ above: true, height: 320 });

  useLayoutEffect(() => {
    const anchor = containerRef.current?.parentElement;
    if (!anchor) return;
    const ancestors: HTMLElement[] = [];
    for (let node = anchor.parentElement; node; node = node.parentElement) {
      ancestors.push(node);
    }
    const update = () => {
      const viewport = window.visualViewport;
      let top = viewport?.offsetTop ?? 0;
      let bottom = top + (viewport?.height ?? window.innerHeight);
      for (const node of ancestors) {
        if (
          !/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowY)
        ) {
          continue;
        }
        const bounds = node.getBoundingClientRect();
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
      const bounds = anchor.getBoundingClientRect();
      const aboveHeight = Math.max(0, bounds.top - top - 40);
      const belowHeight = Math.max(0, bottom - bounds.bottom - 16);
      const above = aboveHeight >= Math.min(160, belowHeight);
      const height = Math.min(320, above ? aboveHeight : belowHeight);
      setPlacement((current) =>
        current.above === above && current.height === height
          ? current
          : { above, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    for (const node of ancestors) observer.observe(node);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return { containerRef, ...placement };
}
