"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useThreadContext } from "../contexts/thread-context";

/** External navigation is a selection command, never a selection notification. */
export function useThreadNavigation(
  threadId?: string,
  onThreadChange?: (threadId: string) => void,
) {
  const { currentThreadId, setCurrentThreadId } = useThreadContext();
  const requested = useRef(threadId);
  const notified = useRef(currentThreadId);
  const externalPending = useRef<string | undefined>(undefined);
  const callback = useRef(onThreadChange);
  callback.current = onThreadChange;
  useLayoutEffect(() => {
    if (requested.current === threadId) return;
    requested.current = threadId;
    if (!threadId) return;
    // Advancing this first also suppresses the effect from the old render.
    externalPending.current = threadId;
    notified.current = threadId;
    if (threadId !== currentThreadId) setCurrentThreadId(threadId);
  }, [threadId, currentThreadId, setCurrentThreadId]);
  useEffect(() => {
    if (externalPending.current) {
      if (currentThreadId === externalPending.current)
        externalPending.current = undefined;
      return;
    }
    if (currentThreadId === notified.current) return;
    notified.current = currentThreadId;
    callback.current?.(currentThreadId);
  }, [currentThreadId, threadId]);
}
