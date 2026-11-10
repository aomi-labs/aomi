"use client";

import { useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { useChatView } from "@aomi-labs/react";
import { useThread } from "@assistant-ui/react";

/** Saved reader position owns initialization; native live/bottom following remains active. */
export function useChatScroll(loading: boolean) {
  const view = useChatView();
  const messageCount = useThread((thread) => thread.messages.length);
  const viewport = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(view?.store.get(view.threadId)?.scroll);
  const [restoring, setRestoring] = useState(true);
  const restoreReader = Boolean(
    savedScroll.current && !savedScroll.current.atBottom,
  );
  const [following, setFollowing] = useState(!restoreReader);
  useLayoutEffect(() => {
    if (!restoring || loading || (restoreReader && messageCount === 0)) return;
    const node = viewport.current;
    let settled: ReturnType<typeof setTimeout>;
    const restore = () => {
      if (node && savedScroll.current && !savedScroll.current.atBottom) {
        node.scrollTop = savedScroll.current.top;
        // A nonempty native transcript can still have only its first rows.
        // Keep observing its layout until the browser can accept the offset.
        if (Math.abs(node.scrollTop - savedScroll.current.top) > 1) return;
      }
      setRestoring(false);
    };
    if (node && restoreReader) node.scrollTop = savedScroll.current!.top;
    const observer = new ResizeObserver(() => {
      restore();
      clearTimeout(settled);
      // A changed conversation may genuinely be shorter. Stop retrying once
      // layout has stayed still, leaving the browser's valid clamped offset.
      settled = setTimeout(() => setRestoring(false), 1000);
    });
    if (node) {
      observer.observe(node);
      for (const child of node.children) observer.observe(child);
    }
    const frame = requestAnimationFrame(() => {
      // Native runtime messages may mount after our first layout. Restore
      // against their measured height, after the browser can accept the offset.
      restore();
      clearTimeout(settled);
      settled = setTimeout(() => setRestoring(false), 1000);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clearTimeout(settled);
    };
  }, [loading, messageCount, restoreReader, restoring]);
  useLayoutEffect(() => {
    const version = view?.store.version();
    return () => {
      const node = viewport.current;
      if (view && node && view.store.version() === version)
        view.store.patch(view.threadId, {
          scroll: {
            top: node.scrollTop,
            atBottom:
              node.scrollHeight - node.scrollTop - node.clientHeight < 8,
          },
        });
    };
  }, [view]);
  return {
    restoring,
    autoScroll: following,
    viewportProps: {
      ref: viewport,
      // Native initialization/switch RAFs are independent of autoScroll.
      // They must not replace an existing reader's restored position.
      scrollToBottomOnInitialize: !restoreReader,
      scrollToBottomOnThreadSwitch: !restoreReader,
      onWheel: () => setRestoring(false),
      onPointerDown: () => setRestoring(false),
      onKeyDown: () => setRestoring(false),
      onScroll: (event: UIEvent<HTMLDivElement>) => {
        const node = event.currentTarget;
        setFollowing(
          node.scrollHeight - node.scrollTop - node.clientHeight < 8,
        );
      },
    },
  };
}
