import type { SetStateAction } from "react";
import type { AgentMode } from "@aomi-labs/client";

import type { ThreadContext } from "../contexts/thread-context";
import { safeEnv } from "../utils/env";
import { generateUUID } from "../utils/uuid";

const threadLogEnv = safeEnv(() => process.env.NODE_ENV);
const shouldLogThreadUpdates =
  threadLogEnv !== undefined && threadLogEnv !== "production";

export type ThreadStatus = "regular" | "archived";
export type ModelSelectionMode = "auto" | "manual";

export type ThreadControlState = {
  /** Missing on persisted threads created before Auto became the default. */
  agentMode?: AgentMode;
  model: string | null;
  modelMode?: ModelSelectionMode;
  app: string | null;
  applicationId: number | string | null;
  controlDirty: boolean;
};

export type ThreadMetadata = {
  title: string;
  status: ThreadStatus;
  lastActiveAt?: string | number;
  control: ThreadControlState;
};

export function initThreadControl(): ThreadControlState {
  return {
    model: null,
    modelMode: "auto",
    app: null,
    applicationId: null,
    controlDirty: false,
  };
}

type ThreadStoreState = {
  currentThreadId: string;
  threadViewKey: number;
  threadCnt: number;
  threadMetadata: Map<string, ThreadMetadata>;
};

type ThreadStoreOptions = {
  initialThreadId?: string;
};

const initialMetadata = (): ThreadMetadata => ({
  title: "New Chat",
  status: "regular",
  lastActiveAt: new Date().toISOString(),
  control: initThreadControl(),
});

const logThreadMetadataChange = (
  source: string,
  threadId: string,
  previous: ThreadMetadata | undefined,
  next: ThreadMetadata | undefined,
) => {
  if (!shouldLogThreadUpdates || (!previous && !next)) return;
  if (
    !previous ||
    !next ||
    previous.title !== next.title ||
    previous.status !== next.status ||
    previous.lastActiveAt !== next.lastActiveAt
  ) {
    console.debug(`[aomi][thread:${source}]`, {
      threadId,
      previous,
      next,
    });
  }
};

export class ThreadStore {
  private state: ThreadStoreState;
  private readonly listeners = new Set<() => void>();
  private snapshot: ThreadContext;

  constructor(options?: ThreadStoreOptions) {
    const currentThreadId = options?.initialThreadId ?? generateUUID();
    this.state = {
      currentThreadId,
      threadViewKey: 0,
      threadCnt: 1,
      threadMetadata: new Map([[currentThreadId, initialMetadata()]]),
    };
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ThreadContext => this.snapshot;

  private buildSnapshot(): ThreadContext {
    return {
      currentThreadId: this.state.currentThreadId,
      setCurrentThreadId: this.setCurrentThreadId,
      threadViewKey: this.state.threadViewKey,
      bumpThreadViewKey: this.bumpThreadViewKey,
      allThreadsMetadata: this.state.threadMetadata,
      setThreadMetadata: this.setThreadMetadata,
      threadCnt: this.state.threadCnt,
      setThreadCnt: this.setThreadCnt,
      getThreadMetadata: this.getThreadMetadata,
      updateThreadMetadata: this.updateThreadMetadata,
      resetToDefault: this.resetToDefault,
    };
  }

  private updateState(partial: Partial<ThreadStoreState>) {
    this.state = { ...this.state, ...partial };
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private ensureThreadExists(threadId: string) {
    if (this.state.threadMetadata.has(threadId)) return;
    const threadMetadata = new Map(this.state.threadMetadata);
    threadMetadata.set(threadId, initialMetadata());
    this.state = { ...this.state, threadMetadata };
  }

  setCurrentThreadId = (threadId: string) => {
    this.ensureThreadExists(threadId);
    this.updateState({ currentThreadId: threadId });
  };

  bumpThreadViewKey = () => {
    this.updateState({ threadViewKey: this.state.threadViewKey + 1 });
  };

  setThreadCnt = (updater: SetStateAction<number>) => {
    this.updateState({
      threadCnt:
        typeof updater === "function" ? updater(this.state.threadCnt) : updater,
    });
  };

  setThreadMetadata = (
    updater: SetStateAction<Map<string, ThreadMetadata>>,
  ) => {
    const previous = this.state.threadMetadata;
    const resolved =
      typeof updater === "function" ? updater(previous) : updater;
    const threadMetadata = new Map(resolved);
    for (const [threadId, next] of threadMetadata) {
      logThreadMetadataChange(
        "setThreadMetadata",
        threadId,
        previous.get(threadId),
        next,
      );
    }
    for (const [threadId, value] of previous) {
      if (!threadMetadata.has(threadId)) {
        logThreadMetadataChange(
          "setThreadMetadata",
          threadId,
          value,
          undefined,
        );
      }
    }
    this.updateState({ threadMetadata });
  };

  getThreadMetadata = (threadId: string): ThreadMetadata | undefined =>
    this.state.threadMetadata.get(threadId);

  updateThreadMetadata = (
    threadId: string,
    updates: Partial<ThreadMetadata>,
  ) => {
    const previous = this.state.threadMetadata.get(threadId);
    if (!previous) return;
    const next = { ...previous, ...updates };
    const threadMetadata = new Map(this.state.threadMetadata);
    threadMetadata.set(threadId, next);
    logThreadMetadataChange("updateThreadMetadata", threadId, previous, next);
    this.updateState({ threadMetadata });
  };

  resetToDefault = () => {
    const currentThreadId = generateUUID();
    this.state = {
      currentThreadId,
      threadViewKey: this.state.threadViewKey + 1,
      threadCnt: 1,
      threadMetadata: new Map([[currentThreadId, initialMetadata()]]),
    };
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
    return currentThreadId;
  };
}
