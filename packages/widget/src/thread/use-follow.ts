"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Room kept above an answer that reached the top (the pinned header). */
const READING_TOP_PX = 56;
/** Close enough to the bottom to count as being there. */
const BOTTOM_PX = 12;
/** Asks the chat to keep an element where it is while something above folds. */
export const HOLD_EVENT = "aomi-hold-still";

export const holdStill = (from: Element | null, ms: number): void => {
  from?.dispatchEvent(
    new CustomEvent(HOLD_EVENT, { bubbles: true, detail: { ms } }),
  );
};

const still = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const gap = (el: HTMLElement) =>
  el.scrollHeight - el.clientHeight - el.scrollTop;

/** An inner list that can still take this upward scroll. */
const innerCanScrollUp = (target: EventTarget | null) => {
  const list =
    target instanceof Element
      ? target.closest<HTMLElement>(".aui-working-trace-scroll")
      : null;
  return !!list && list.scrollTop > 0;
};

/**
 * The chat moves by itself only while the reader has not touched it: it glides
 * after new content from the bottom, stops when the reader scrolls up or opens
 * something, and stops once the text being written reaches the top, so a long
 * answer is read from its first line.
 */
export function useFollow(
  viewport: RefObject<HTMLDivElement | null>,
  {
    enabled,
    startFollowing,
    threadId,
    sentCount,
  }: {
    enabled: boolean;
    startFollowing: boolean;
    threadId?: string;
    /** The reader's messages; one more means one was just sent. */
    sentCount: number;
  },
): void {
  const follow = useRef(startFollowing);
  const active = useRef(enabled);
  active.current = enabled;
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    let holding = 0;
    let lastTop = el.scrollTop;
    let lastHeight = el.scrollHeight;
    let touchY = 0;

    const target = () => {
      const bottom = el.scrollHeight - el.clientHeight;
      const messages = el.querySelectorAll<HTMLElement>("[data-role]");
      const message = messages[messages.length - 1];
      if (message?.dataset.role !== "assistant") return bottom;
      const blocks = message.querySelectorAll<HTMLElement>(
        ".aui-working-note, .aui-working-answer, .aui-trace-burst",
      );
      const last = blocks[blocks.length - 1];
      if (!last || last.classList.contains("aui-trace-burst")) return bottom;
      const top =
        last.getBoundingClientRect().top -
        el.getBoundingClientRect().top +
        el.scrollTop -
        READING_TOP_PX;
      return Math.min(bottom, Math.max(0, top));
    };
    const step = () => {
      frame = 0;
      if (!follow.current || !active.current || holding) return;
      const left = target() - el.scrollTop;
      if (left <= 0) return;
      const before = el.scrollTop;
      el.scrollTop += still() || left < 1 ? left : Math.max(1, left * 0.16);
      lastTop = el.scrollTop;
      lastHeight = el.scrollHeight;
      if (el.scrollTop !== before) frame = requestAnimationFrame(step);
    };
    const chase = () => {
      if (!frame && follow.current) frame = requestAnimationFrame(step);
    };
    wake.current = chase;

    const letGo = () => {
      follow.current = false;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onScroll = () => {
      const top = el.scrollTop;
      const height = el.scrollHeight;
      if (!holding) {
        // A drop together with a height change is the browser's own clamp.
        if (top < lastTop - 2 && height === lastHeight) letGo();
        else if (top > lastTop && gap(el) <= BOTTOM_PX) follow.current = true;
      }
      lastTop = top;
      lastHeight = height;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && !innerCanScrollUp(event.target)) letGo();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0;
      if (y - touchY > 6 && !innerCanScrollUp(event.target)) letGo();
    };
    // Opening something is reading: what was clicked stays where it is.
    const onClick = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".aui-working-trace button[aria-expanded], .aui-working-trace-more, .aui-working-step button",
        )
      )
        letGo();
    };
    const onHold = (event: Event) => {
      const from = event.target as Element;
      const row = from.closest(".aui-assistant-message-root");
      const keep =
        row?.querySelector<HTMLElement>(".aui-working-answer") ??
        row?.querySelector<HTMLElement>(".aui-assistant-message-footer");
      if (!keep) return;
      const place = keep.getBoundingClientRect().top;
      const until =
        performance.now() + (event as CustomEvent<{ ms: number }>).detail.ms;
      el.style.setProperty("overflow-anchor", "none");
      cancelAnimationFrame(holding);
      const hold = () => {
        const moved = keep.getBoundingClientRect().top - place;
        if (Math.abs(moved) >= 0.5) el.scrollTop += moved;
        lastTop = el.scrollTop;
        lastHeight = el.scrollHeight;
        if (performance.now() < until) {
          holding = requestAnimationFrame(hold);
          return;
        }
        holding = 0;
        el.style.removeProperty("overflow-anchor");
      };
      holding = requestAnimationFrame(hold);
    };

    const sizes = new ResizeObserver(chase);
    sizes.observe(el);
    for (const child of el.children) sizes.observe(child);
    const rows = new MutationObserver((changes) => {
      for (const change of changes)
        change.addedNodes.forEach(
          (node) => node instanceof Element && sizes.observe(node),
        );
      chase();
    });
    rows.observe(el, { childList: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("click", onClick, true);
    el.addEventListener(HOLD_EVENT, onHold);
    return () => {
      sizes.disconnect();
      rows.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(holding);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener(HOLD_EVENT, onHold);
    };
  }, [viewport]);

  // Sending brings the chat down to the new message, once, gently.
  const seen = useRef({ threadId, sentCount });
  useEffect(() => {
    const before = seen.current;
    seen.current = { threadId, sentCount };
    if (before.threadId !== threadId) {
      follow.current = startFollowing;
      return;
    }
    if (sentCount > before.sentCount) follow.current = true;
    if (enabled) wake.current();
  }, [enabled, sentCount, startFollowing, threadId]);
}
