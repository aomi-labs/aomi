"use client";

import {
  type FC,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/cn";

const EASE = "cubic-bezier(.22,.8,.26,1)";

export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const still = (): boolean =>
  typeof window === "undefined" ||
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  typeof Element.prototype.animate !== "function";

export const move = (
  el: Element,
  frames: Keyframe[] | PropertyIndexedKeyframes,
  duration: number,
  options: KeyframeAnimationOptions = {},
): Animation | null =>
  still() ? null : el.animate(frames, { duration, easing: EASE, ...options });

/** Old content fades out in place while the new content fades in. */
export const Swap: FC<{
  id: string;
  className?: string;
  /** The text a line is fitted around. */
  fitText?: boolean;
  children: ReactNode;
}> = ({ id, className, fitText, children }) => {
  const box = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLSpanElement>(null);
  const last = useRef<{ id: string; html: string } | null>(null);
  useIsomorphicLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const before = last.current;
    if (before && before.id !== id && box.current && !still()) {
      const ghost = document.createElement("span");
      ghost.className =
        "pointer-events-none absolute left-0 top-0 max-w-full truncate";
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = before.html;
      box.current.append(ghost);
      const out = move(
        ghost,
        [
          { opacity: 1, translate: "0 0" },
          { opacity: 0, translate: "0 -5px" },
        ],
        170,
        { fill: "forwards" },
      );
      if (out) out.onfinish = () => ghost.remove();
      else ghost.remove();
      move(
        el,
        [
          { opacity: 0, translate: "0 6px" },
          { opacity: 1, translate: "0 0" },
        ],
        300,
        { delay: 70, fill: "backwards" },
      );
    }
    last.current = { id, html: el.innerHTML };
  });
  return (
    <span
      ref={box}
      data-fit-text={fitText || undefined}
      className={cn("relative block min-w-0", className)}
    >
      <span
        ref={body}
        className="block truncate max-sm:line-clamp-2 max-sm:whitespace-normal"
      >
        {children}
      </span>
    </span>
  );
};

/** Children marked `data-flip` slide to their new place instead of jumping. */
export function useFlip<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const lefts = useRef(new Map<string, number>());
  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const origin = root.getBoundingClientRect().left;
    const next = new Map<string, number>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const key = el.dataset.flip!;
      const left = el.getBoundingClientRect().left - origin;
      const before = lefts.current.get(key);
      next.set(key, el.offsetLeft);
      if (before !== undefined && Math.abs(before - el.offsetLeft) > 0.5)
        move(
          el,
          [
            { translate: `${before - el.offsetLeft}px 0` },
            { translate: "0 0" },
          ],
          320,
        );
      else if (before === undefined && lefts.current.size > 0 && left >= 0)
        move(el, [{ opacity: 0 }, { opacity: 1 }], 280);
    });
    lefts.current = next;
  });
  return ref;
}

/** A row that opens its own space when it arrives in an open list. */
export const Grow: FC<{ animate: boolean; children: ReactNode }> = ({
  animate,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(animate);
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || !first.current || still()) return;
    first.current = false;
    const height = `${el.offsetHeight}px`;
    el.style.overflow = "hidden";
    const anim = move(
      el,
      [
        { height: "0px", opacity: 0 },
        { height, opacity: 0, offset: 0.45 },
        { height, opacity: 1 },
      ],
      420,
    );
    const done = () => {
      el.style.overflow = "";
    };
    if (anim) anim.onfinish = anim.oncancel = done;
    else done();
  }, []);
  return (
    <div ref={ref} className="aui-trace-row">
      {children}
    </div>
  );
};

/** Fades its content in once, on arrival. */
export const Arrive: FC<{
  animate: boolean;
  className?: string;
  children: ReactNode;
}> = ({ animate, className, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(animate);
  useIsomorphicLayoutEffect(() => {
    if (ref.current && first.current)
      move(
        ref.current,
        [
          { opacity: 0, translate: "0 6px" },
          { opacity: 1, translate: "0 0" },
        ],
        360,
      );
    first.current = false;
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
};

/** Grid-row fold: closed rows take no space and cannot be focused. */
export const Fold: FC<{
  open: boolean;
  slow?: boolean;
  className?: string;
  children: ReactNode;
}> = ({ open, slow = false, className, children }) => (
  <div
    aria-hidden={!open}
    inert={!open}
    className={cn(
      "grid w-full transition-[grid-template-rows,opacity] motion-reduce:transition-none",
      slow ? "duration-[600ms]" : "duration-[340ms]",
      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      className,
    )}
    style={{
      transitionTimingFunction: slow ? "cubic-bezier(.4,0,.1,1)" : EASE,
    }}
  >
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>
);

const ROWS = 5;
const MAX_PX = 320;

/**
 * An opened list: at most five steps high, the rest scrolls under soft edges.
 * While working it follows the newest step until the reader scrolls up; a
 * finished list opens at its first step.
 */
export const StepWindow: FC<{
  open: boolean;
  live: boolean;
  count: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  more: (expanded: boolean, count: number) => ReactNode;
  children: ReactNode;
}> = ({ open, live, count, expanded, onExpandedChange, more, children }) => {
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLSpanElement>(null);
  const bottom = useRef<HTMLSpanElement>(null);
  const follow = useRef(live);
  const frame = useRef(0);
  const [cap, setCap] = useState<number | null>(null);
  const capped = cap !== null && !expanded;

  const edges = () => {
    const el = viewport.current;
    if (!el || !top.current || !bottom.current) return;
    const below = el.scrollHeight - el.clientHeight - el.scrollTop;
    top.current.style.opacity = String(Math.min(1, el.scrollTop / 28));
    bottom.current.style.opacity = String(Math.min(1, Math.max(0, below) / 28));
  };
  const chase = () => {
    cancelAnimationFrame(frame.current);
    const step = () => {
      const el = viewport.current;
      if (!el || !follow.current) return;
      const left = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (left <= 0) return edges();
      el.scrollTop += still() ? left : Math.max(1, left * 0.16);
      edges();
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  const read = () => {
    const el = viewport.current;
    if (!el) return;
    requestAnimationFrame(() => {
      follow.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 8;
    });
  };

  useEffect(() => {
    const el = body.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rows = [
        ...el.querySelectorAll<HTMLElement>(":scope > .aui-trace-row"),
      ];
      const heights = rows.map((row) => row.scrollHeight);
      const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
      const next = Math.round(Math.min(MAX_PX, sum(heights.slice(-ROWS)))) + 14;
      setCap(rows.length > ROWS && sum(heights) + 18 - next > 24 ? next : null);
      if (live && follow.current) chase();
      edges();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, count]);

  useIsomorphicLayoutEffect(() => {
    const el = viewport.current;
    if (!el || !open) return;
    follow.current = live;
    el.scrollTop = live ? el.scrollHeight : 0;
    edges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const was = useRef(expanded);
  useIsomorphicLayoutEffect(() => {
    const el = viewport.current;
    if (!el || was.current === expanded || cap === null) return;
    was.current = expanded;
    const full = `${el.scrollHeight}px`;
    move(
      el,
      [
        { maxHeight: expanded ? `${cap}px` : full },
        { maxHeight: expanded ? full : `${cap}px` },
      ],
      380,
    );
    edges();
  }, [expanded, cap]);

  return (
    <>
      <div className="relative">
        <div
          ref={viewport}
          onScroll={edges}
          onWheel={read}
          onTouchMove={read}
          onKeyUp={read}
          tabIndex={capped && open ? 0 : undefined}
          role={capped ? "group" : undefined}
          aria-label={capped ? "Steps" : undefined}
          className={cn(
            "aui-working-trace-scroll rounded-control",
            capped ? "overflow-y-auto" : "overflow-hidden",
          )}
          style={{ maxHeight: capped ? cap : undefined }}
        >
          <div
            ref={body}
            className="border-aomi-border ml-[7px] border-l-[1.5px] py-1 pl-[17.5px]"
          >
            {children}
          </div>
        </div>
        <span
          ref={top}
          aria-hidden
          className={cn(
            "aui-working-trace-edge-fade-top pointer-events-none absolute inset-x-0 top-0 z-[1] h-[52px]",
            !capped && "hidden",
          )}
          style={{ opacity: 0 }}
        />
        <span
          ref={bottom}
          aria-hidden
          className={cn(
            "aui-working-trace-edge-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[52px]",
            !capped && "hidden",
          )}
          style={{ opacity: 0 }}
        />
      </div>
      {cap !== null && (
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          className="aui-working-trace-more text-aomi-muted hover:text-aomi-fg rounded-control ml-[26px] flex min-h-7 items-center gap-2.5 text-[13px] leading-[18px] transition-colors"
        >
          {more(expanded, count)}
        </button>
      )}
    </>
  );
};

/**
 * Keeps a line whole: children marked `data-fit` show only while they fit
 * completely, first come first. A text that is still too long gets its full
 * wording on hover.
 */
export function useFit<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  const fit = () => {
    const row = ref.current;
    const room = row?.parentElement?.clientWidth;
    if (!row || !room) return;
    const items = [...row.querySelectorAll<HTMLElement>("[data-fit]")];
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    items.forEach((item) => (item.hidden = false));
    const label = row.querySelector<HTMLElement>("[data-fit-text] > span");
    const box = row.querySelector<HTMLElement>("[data-fit-box]");
    // One line's worth of text, also where a phone may wrap it.
    if (label) label.style.whiteSpace = "nowrap";
    const textWidth = label?.scrollWidth ?? 0;
    if (label) label.style.whiteSpace = "";
    let used = 0;
    let shown = 0;
    for (const child of row.children as HTMLCollectionOf<HTMLElement>) {
      if (child === box) continue;
      used += child.hasAttribute("data-fit-text")
        ? textWidth
        : child.offsetWidth;
      used += gap;
    }
    used -= gap;
    const inner = box
      ? Number.parseFloat(getComputedStyle(box).columnGap) || 0
      : 0;
    for (const item of items) {
      const next = used + (shown === 0 ? gap : inner) + item.offsetWidth;
      const fits = next <= room;
      item.hidden = !fits;
      if (!fits) {
        for (const rest of items.slice(items.indexOf(item))) rest.hidden = true;
        break;
      }
      used = next;
      shown += 1;
    }
    if (box) box.hidden = shown === 0;
    row.title = label && label.scrollWidth > label.clientWidth + 1 ? text : "";
  };
  useIsomorphicLayoutEffect(fit);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
