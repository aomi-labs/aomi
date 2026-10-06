"use client";

import { useRef, useState, type ReactNode } from "react";
import { AomiMark } from "@/components/aomi-mark";

/** Reserve the avatar gutter only while a mobile reader pulls a turn right. */
export function AssistantMessageRow({
  showMark,
  children,
}: {
  showMark: boolean;
  children: ReactNode;
}) {
  const start = useRef<{ x: number; y: number; horizontal: boolean } | null>(
    null,
  );
  const [offset, setOffset] = useState(0);
  const reset = () => {
    start.current = null;
    setOffset(0);
  };

  return (
    <div
      className="aui-assistant-message-row relative flex w-full gap-3 px-0 md:px-3"
      onTouchStart={(event) => {
        if (
          !showMark ||
          event.touches.length !== 1 ||
          window.matchMedia("(min-width: 768px)").matches
        )
          return;
        const target = event.target as HTMLElement;
        if (target.closest("button, a, input, textarea, [role='slider'], pre"))
          return;
        start.current = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
          horizontal: false,
        };
      }}
      onTouchMove={(event) => {
        if (!start.current) return;
        if (event.touches.length !== 1) {
          reset();
          return;
        }
        const dx = event.touches[0].clientX - start.current.x;
        const dy = event.touches[0].clientY - start.current.y;
        if (!start.current.horizontal) {
          if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
            reset();
            return;
          }
          if (dx < 8 || dx <= Math.abs(dy)) return;
          start.current.horizontal = true;
        }
        setOffset(Math.min(40, Math.max(0, dx * 0.55)));
      }}
      onTouchEnd={reset}
      onTouchCancel={reset}
    >
      {showMark && (
        <>
          <AomiMark
            size={26}
            className="text-aomi-fg mt-0.5 hidden shrink-0 md:block"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute left-0 top-0.5 motion-reduce:transition-none md:hidden"
            style={{ opacity: offset / 40 }}
            aria-hidden
          >
            <AomiMark size={26} />
          </span>
        </>
      )}
      <div
        className="min-w-0 flex-1 transition-transform duration-200 motion-reduce:transition-none"
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          transitionDuration: offset ? "0ms" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
