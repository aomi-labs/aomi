import { generateUUID } from "../utils/uuid";
import type { MutableRefObject } from "react";
import type { ExternalStoreThreadData } from "@assistant-ui/react";

import type { AomiClient } from "@aomi-labs/client";
import type { ThreadContext } from "../contexts/thread-context";
import { initThreadControl, type ThreadMetadata } from "../state/thread-store";
import type { ThreadControlState } from "../state/thread-store";
import { isPlaceholderTitle, parseTimestamp } from "./utils";

// =============================================================================
// Thread List Helpers
// =============================================================================

const sortByLastActiveDesc = (
  [, metaA]: [string, ThreadMetadata],
  [, metaB]: [string, ThreadMetadata],
) => {
  const tsA = parseTimestamp(metaA.lastActiveAt);
  const tsB = parseTimestamp(metaB.lastActiveAt);
  return tsB - tsA;
};

function buildThreadLists(
  threadMetadata: Map<string, ThreadMetadata>,
  shouldShowThread: (threadId: string) => boolean,
) {
  const entries = Array.from(threadMetadata.entries()).filter(
    ([threadId, meta]) =>
      !isPlaceholderTitle(meta.title) && shouldShowThread(threadId),
  );

  const regularThreads = entries
    .filter(([, meta]) => meta.status !== "archived")
    .sort(sortByLastActiveDesc)
    .map(
      ([id, meta]): ExternalStoreThreadData<"regular"> => ({
        id,
        title: meta.title || "New Chat",
        status: "regular",
      }),
    );

  const archivedThreads = entries
    .filter(([, meta]) => meta.status === "archived")
    .sort(sortByLastActiveDesc)
    .map(
      ([id, meta]): ExternalStoreThreadData<"archived"> => ({
        id,
        title: meta.title || "New Chat",
        status: "archived",
      }),
    );

  return { regularThreads, archivedThreads };
}

// =============================================================================
// Adapter Builder
// =============================================================================

export type ThreadListAdapterConfig = {
  aomiClientRef: MutableRefObject<AomiClient>;
  threadContext: ThreadContext;
  isLoading?: boolean;
  getInitialControl?: () => ThreadControlState;
  isRemoteThread?: (threadId: string) => boolean;
};

export function buildThreadListAdapter({
  aomiClientRef,
  threadContext,
  isLoading = false,
  getInitialControl = initThreadControl,
  isRemoteThread = () => true,
}: ThreadListAdapterConfig) {
  const shouldShowThread = (threadId: string) => {
    return isRemoteThread(threadId);
  };
  const { regularThreads, archivedThreads } = buildThreadLists(
    threadContext.allThreadsMetadata,
    shouldShowThread,
  );

  /** Remove the unsent local placeholder before switching elsewhere. */
  const cleanupEmptyLocalThread = () => {
    const prevId = threadContext.currentThreadId;
    if (isRemoteThread(prevId)) return;
    threadContext.setThreadMetadata((prev) => {
      const next = new Map(prev);
      next.delete(prevId);
      return next;
    });
  };

  return {
    threadId: threadContext.currentThreadId,
    isLoading,
    threads: regularThreads,
    archivedThreads,

    onSwitchToNewThread: () => {
      const currentThreadId = threadContext.currentThreadId;
      if (!isRemoteThread(currentThreadId)) return;

      cleanupEmptyLocalThread();
      const threadId = generateUUID();
      threadContext.setThreadMetadata((prev) =>
        new Map(prev).set(threadId, {
          title: "New Chat",
          status: "regular",
          lastActiveAt: new Date().toISOString(),
          control: getInitialControl(),
        }),
      );
      threadContext.setCurrentThreadId(threadId);
      threadContext.bumpThreadViewKey();
    },

    onSwitchToThread: (threadId: string) => {
      cleanupEmptyLocalThread();
      threadContext.setCurrentThreadId(threadId);
      threadContext.bumpThreadViewKey();
    },

    onRename: async (threadId: string, newTitle: string) => {
      const previousTitle =
        threadContext.getThreadMetadata(threadId)?.title ?? "";
      const normalizedTitle = isPlaceholderTitle(newTitle) ? "" : newTitle;
      threadContext.updateThreadMetadata(threadId, {
        title: normalizedTitle,
      });

      try {
        await aomiClientRef.current.agent.sessions.update(threadId, {
          title: newTitle,
        });
      } catch (error) {
        console.error("Failed to rename thread:", error);
        threadContext.updateThreadMetadata(threadId, {
          title: previousTitle,
        });
      }
    },

    onArchive: async (threadId: string) => {
      threadContext.updateThreadMetadata(threadId, { status: "archived" });

      try {
        await aomiClientRef.current.agent.sessions.update(threadId, {
          archived: true,
        });
      } catch (error) {
        console.error("Failed to archive thread:", error);
        threadContext.updateThreadMetadata(threadId, { status: "regular" });
      }
    },

    onUnarchive: async (threadId: string) => {
      threadContext.updateThreadMetadata(threadId, { status: "regular" });

      try {
        await aomiClientRef.current.agent.sessions.update(threadId, {
          archived: false,
        });
      } catch (error) {
        console.error("Failed to unarchive thread:", error);
        threadContext.updateThreadMetadata(threadId, { status: "archived" });
      }
    },

    onDelete: async (threadId: string) => {
      try {
        await aomiClientRef.current.agent.sessions.delete(threadId);

        threadContext.setThreadMetadata((prev) => {
          const next = new Map(prev);
          next.delete(threadId);
          return next;
        });
        if (threadContext.currentThreadId === threadId) {
          const firstRegularThread = Array.from(
            threadContext.allThreadsMetadata.entries(),
          ).find(([id, meta]) => meta.status === "regular" && id !== threadId);

          if (firstRegularThread) {
            threadContext.setCurrentThreadId(firstRegularThread[0]);
          } else {
            const defaultId = "default-session";
            threadContext.setThreadMetadata((prev) =>
              new Map(prev).set(defaultId, {
                title: "New Chat",
                status: "regular",
                lastActiveAt: new Date().toISOString(),
                control: getInitialControl(),
              }),
            );
            threadContext.setCurrentThreadId(defaultId);
          }
        }
      } catch (error) {
        console.error("Failed to delete thread:", error);
        throw error;
      }
    },
  };
}
