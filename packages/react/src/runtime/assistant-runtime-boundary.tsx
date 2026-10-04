"use client";

import type { MutableRefObject, ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";

/** Mount with the chat ID as its key. Indexed message subscribers and their
 * runtime must change together; swapping only the UI leaves old indices alive
 * until assistant-ui applies the next adapter in an effect. */
export function AssistantRuntimeBoundary({
  adapter,
  restoreComposerText,
  children,
}: {
  adapter: ExternalStoreAdapter<ThreadMessageLike>;
  restoreComposerText: MutableRefObject<(text: string) => void>;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime(adapter);
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
