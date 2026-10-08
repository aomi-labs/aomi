"use client";

import { useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { useChatView } from "@aomi-labs/react";

/** Saved reader position owns initialization; native live/bottom following remains active. */
export function useChatScroll(loading: boolean) {
  const view = useChatView();
  const viewport = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(view?.store.get(view.threadId)?.scroll);
  const [restoring, setRestoring] = useState(true);
  const restoreReader = Boolean(
    savedScroll.current && !savedScroll.current.atBottom,
  );
  const [following, setFollowing] = useState(!restoreReader);
  useLayoutEffect(() => {
    if (loading) return;
    const node = viewport.current;
    if (node && savedScroll.current && !savedScroll.current.atBottom)
      node.scrollTop = savedScroll.current.top;
    const frame = requestAnimationFrame(() => setRestoring(false));
    return () => cancelAnimationFrame(frame);
  }, [loading]);
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
      onScroll: (event: UIEvent<HTMLDivElement>) => {
        const node = event.currentTarget;
        setFollowing(
          node.scrollHeight - node.scrollTop - node.clientHeight < 8,
        );
      },
    },
  };
}
