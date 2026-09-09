"use client";

import { createContext, useContext } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";

import type {
  Action,
  ActionAttempt,
  ActionResult,
  AomiInferenceFundingSource,
  AomiSimulateResponse,
  Event,
  TurnState,
  UserState,
} from "@aomi-labs/client";
import type { AccountTransport } from "@aomi-labs/client";
export type { AomiInferenceFundingSource } from "@aomi-labs/client";
import type { ThreadMetadata } from "./state/thread-store";
import type {
  Notification,
  NotificationData,
} from "./contexts/notification-context";

// =============================================================================
// AomiRuntimeApi Type
// =============================================================================

export type AomiRuntimeApi = {
  /** Shared authenticated account transport configured by the runtime. */
  account: AccountTransport;
  // -------------------------------------------------------------------------
  // USER API
  // -------------------------------------------------------------------------
  /** Current user state (wallet connection, address, chain, etc.) */
  user: UserState;
  /** Get current user state synchronously (useful in callbacks) */
  getUserState: () => UserState;
  /** Update user state (partial updates merged with existing state) */
  setUser: (data: Partial<UserState>) => void;
  /** Add or overwrite a value in user_state.ext */
  addExtValue: (key: string, value: unknown) => void;
  /** Remove a value from user_state.ext */
  removeExtValue: (key: string) => void;

  // -------------------------------------------------------------------------
  // THREAD API
  // -------------------------------------------------------------------------
  /** ID of the currently active thread */
  currentThreadId: string;
  /** Key that changes when thread view should remount (use for React key prop) */
  threadViewKey: number;
  /** Metadata for all threads (title, status, lastActiveAt) */
  threadMetadata: Map<string, ThreadMetadata>;
  /** True when the authenticated thread list failed to load. */
  threadListError: boolean;
  /** Get metadata for a specific thread */
  getThreadMetadata: (threadId: string) => ThreadMetadata | undefined;
  /** Create a new thread and return its ID */
  createThread: () => Promise<string>;
  /** Delete a thread by ID */
  deleteThread: (threadId: string) => Promise<void>;
  /** Rename a thread */
  renameThread: (threadId: string, title: string) => Promise<void>;
  /** Archive a thread */
  archiveThread: (threadId: string) => Promise<void>;
  /** Switch to a thread. If thread doesn't exist, creates a new one. */
  selectThread: (threadId: string) => void;

  // -------------------------------------------------------------------------
  // CHAT API
  // -------------------------------------------------------------------------
  /** Whether the assistant is currently generating a response */
  isRunning: boolean;
  /** True only before the first backend event for a submitted turn. */
  isSubmitting: boolean;
  /** Get messages for a thread (defaults to currentThreadId) */
  getMessages: (threadId?: string) => ThreadMessageLike[];
  /** Send a message to the current thread */
  sendMessage: (text: string) => Promise<void>;
  /** Cancel the current generation */
  cancelGeneration: () => void;

  // -------------------------------------------------------------------------
  // NOTIFICATION API
  // -------------------------------------------------------------------------
  /** All active notifications */
  notifications: Notification[];
  /** Show a notification. Returns the notification ID. */
  showNotification: (params: NotificationData) => string;
  /** Dismiss a notification by ID */
  dismissNotification: (id: string) => void;
  /** Clear all notifications */
  clearAllNotifications: () => void;

  // -------------------------------------------------------------------------
  // ACTION API
  // -------------------------------------------------------------------------
  /** Canonical runtime Actions awaiting a client response. */
  pendingActions: Action[];
  actionAttempts: ReadonlyMap<string, ActionAttempt>;
  /** True while an Action is visible or awaiting backend acknowledgement. */
  hasBlockingActions: boolean;
  executeAction: (id: string) => Promise<void>;
  respondToAction: (id: string, result: ActionResult) => Promise<void>;
  rejectAction: (id: string, reason?: string) => Promise<void>;
  /** Simulate a batch against the current thread session context. */
  simulateBatchTransactions: (
    transactions: Array<{
      to: string;
      value?: string;
      data?: string;
      label?: string;
      chain_id?: number;
      chainId?: number;
    }>,
    options?: { from?: string; chainId?: number },
  ) => Promise<AomiSimulateResponse["result"]>;

  // -------------------------------------------------------------------------
  // EVENT STATE
  // -------------------------------------------------------------------------
  /** Canonical ordered events for the active session. */
  events: readonly Event[];
  /** Backend-owned lifecycle for the active turn. */
  turnState?: TurnState;
};

// =============================================================================
// Context
// =============================================================================

const AomiRuntimeContext = createContext<AomiRuntimeApi | null>(null);

export const AomiRuntimeApiProvider = AomiRuntimeContext.Provider;

// =============================================================================
// Hook
// =============================================================================

/**
 * Unified hook that provides access to all Aomi runtime APIs.
 *
 * This is the primary way to interact with the Aomi runtime from consumer code.
 * It combines user, thread, chat, notification, and event APIs into a single interface.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const aomi = useAomiRuntime();
 *
 *   // User API
 *   const { user, setUser } = aomi;
 *
 *   // Thread API
 *   const { currentThreadId, createThread, selectThread } = aomi;
 *
 *   // Chat API
 *   const { isRunning, sendMessage, cancelGeneration } = aomi;
 *
 *   // Notification API
 *   const { showNotification } = aomi;
 *
 *   // Event state
 *   const { events, turnState } = aomi;
 * }
 * ```
 */
export function useAomiRuntime(): AomiRuntimeApi {
  const context = useContext(AomiRuntimeContext);
  if (!context) {
    throw new Error(
      "useAomiRuntime must be used within AomiRuntimeProvider. " +
        "Wrap your app with <AomiRuntimeProvider>...</AomiRuntimeProvider>",
    );
  }
  return context;
}

/** Returns the runtime when mounted, allowing standalone registry previews. */
export function useOptionalAomiRuntime(): AomiRuntimeApi | null {
  return useContext(AomiRuntimeContext);
}
