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
    if (node && savedScroll.current && !savedScroll.current.atBottom)
      node.scrollTop = savedScroll.current.top;
    const frame = requestAnimationFrame(() => {
      // Native runtime messages may mount after our first layout. Restore
      // against their measured height, after the browser can accept the offset.
      if (node && savedScroll.current && !savedScroll.current.atBottom)
        node.scrollTop = savedScroll.current.top;
      setRestoring(false);
    });
    return () => cancelAnimationFrame(frame);
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
      onScroll: (event: UIEvent<HTMLDivElement>) => {
        const node = event.currentTarget;
        setFollowing(
          node.scrollHeight - node.scrollTop - node.clientHeight < 8,
        );
      },
    },
  };
}
