"use client";

import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const WidgetOverlayContext = createContext<HTMLElement | null>(null);
export const useWidgetOverlay = () => useContext(WidgetOverlayContext);

/** Each frame owns its theme and overlay targets, including in composed hosts. */
export function WidgetScope({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  // Created before the first render so no overlay ever falls back to
  // document.body; it joins the widget root before the browser paints.
  const [container] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!container || !slot.current) return;
    container.dataset.aomiOverlays = id;
    slot.current.appendChild(container);
    return () => container.remove();
  }, [container, id]);
  return (
    <div
      className={`aomi-widget ${
        className
          ?.split(/\s+/)
          .filter((value) => value === "dark" || value === "light")
          .join(" ") ?? ""
      }`}
      data-aomi-widget={id}
      style={{ display: "contents" }}
    >
      <WidgetOverlayContext.Provider value={container}>
        {children}
        <div ref={slot} style={{ display: "contents" }} />
      </WidgetOverlayContext.Provider>
    </div>
  );
}
