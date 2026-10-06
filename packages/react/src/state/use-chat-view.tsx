"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import type { ChatViewStore } from "./chat-view-store";

export const ChatViewContext = createContext<{
  threadId: string;
  store: ChatViewStore;
} | null>(null);
export const useChatView = () => useContext(ChatViewContext);

/** Standalone trace components retain their local behavior outside a runtime. */
export function useChatViewFlag(key: string, initial: boolean) {
  const view = useChatView();
  const [local, setLocal] = useState(initial);
  const getSnapshot = useCallback(
    () => view?.store.get(view.threadId)?.flags?.[key] ?? local,
    [view, key, local],
  );
  const subscribe = useCallback(
    (listener: () => void) => view?.store.subscribe(listener) ?? (() => {}),
    [view],
  );
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setValue = useCallback(
    (next: SetStateAction<boolean>) => {
      const resolved = typeof next === "function" ? next(getSnapshot()) : next;
      if (view) view.store.setFlag(view.threadId, key, resolved);
      else setLocal(resolved);
    },
    [view, key, getSnapshot],
  );
  return [value, setValue] as const;
}
