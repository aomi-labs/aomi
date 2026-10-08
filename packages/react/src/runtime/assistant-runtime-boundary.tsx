"use client";

import {
  createContext,
  useContext,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { ChatViewContext } from "../state/use-chat-view";
import type { ChatViewStore } from "../state/chat-view-store";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";

type ComposerAccess = {
  restoreComposerText?: MutableRefObject<(text: string) => void>;
  readComposerText?: MutableRefObject<() => string>;
};

/**
 * Indexed message subscribers and their runtime must change together;
 * swapping only the UI leaves old indices alive until assistant-ui applies
 * the next adapter in an effect. Mount it with the chat as its key.
 */
export function AssistantRuntimeBoundary({
  adapter,
  restoreComposerText,
  readComposerText,
  children,
  view,
}: ComposerAccess & {
  adapter: ExternalStoreAdapter<ThreadMessageLike>;
  children: ReactNode;
  view?: { threadId: string; store: ChatViewStore };
}) {
  const runtime = useExternalStoreRuntime(adapter);
  useLayoutEffect(() => {
    if (!view) return;
    const version = view.store.version();
    view.store.touch(view.threadId);
    const draft = view.store.get(view.threadId)?.draft;
    if (draft) runtime.thread.composer.setText(draft);
    return () => {
      // A cleared store belongs to a previous account; keep its draft out.
      if (view.store.version() !== version) return;
      view.store.patch(view.threadId, {
        draft: runtime.thread.composer.getState().text,
      });
    };
  }, [runtime, view]);
  if (readComposerText)
    readComposerText.current = () => runtime.thread.composer.getState().text;
  if (restoreComposerText)
    restoreComposerText.current = (text) => {
      const composer = runtime.thread.composer;
      if (!composer.getState().text) composer.setText(text);
    };
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

export type ChatBoundaryValue = ComposerAccess & {
  threadId: string;
  adapter: ExternalStoreAdapter<ThreadMessageLike>;
  store: ChatViewStore;
  /** Changes when the chat view store is cleared, so the chat mounts afresh. */
  generation: number;
  /** Streamed text may render a frame late; nothing urgent is on screen. */
  deferMessages: boolean;
  /** Tells the runtime the chat renders here, so the shell needs no messages. */
  onBoundaryMount: () => void;
};
export const ChatBoundaryContext = createContext<ChatBoundaryValue | null>(
  null,
);

/** The shell stays mounted; indexed message subscribers and composer change together. */
export function AomiChatBoundary({ children }: { children: ReactNode }) {
  const chat = useContext(ChatBoundaryContext);
  if (!chat) return <>{children}</>;
  return (
    <ChatBoundaryInner key={`${chat.threadId}:${chat.generation}`} chat={chat}>
      {children}
    </ChatBoundaryInner>
  );
}

function ChatBoundaryInner({
  chat,
  children,
}: {
  chat: ChatBoundaryValue;
  children: ReactNode;
}) {
  const view = useMemo(
    () => ({ threadId: chat.threadId, store: chat.store }),
    [chat.threadId, chat.store],
  );
  const { onBoundaryMount } = chat;
  useLayoutEffect(onBoundaryMount, [onBoundaryMount]);
  const deferredMessages = useDeferredValue(chat.adapter.messages);
  const adapter =
    chat.deferMessages && deferredMessages !== chat.adapter.messages
      ? { ...chat.adapter, messages: deferredMessages }
      : chat.adapter;
  return (
    <ChatViewContext.Provider value={view}>
      <AssistantRuntimeBoundary
        adapter={adapter}
        restoreComposerText={chat.restoreComposerText}
        readComposerText={chat.readComposerText}
        view={view}
      >
        {children}
      </AssistantRuntimeBoundary>
    </ChatViewContext.Provider>
  );
}
