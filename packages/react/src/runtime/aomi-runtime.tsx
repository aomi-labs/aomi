"use client";

import { useMemo, useRef } from "react";
import type { ReactNode } from "react";

import {
  AomiClient,
  createGuestSessionProvider,
  type ActionCapabilities,
  type CommitCapabilities,
  type AgentTarget,
  type AomiClientOptions,
  type AomiPlatformFilter,
} from "@aomi-labs/client";
import type { AomiInferenceFundingSource } from "../interface";
import { ControlContextProvider } from "../contexts/control-context";
import { NotificationContextProvider } from "../contexts/notification-context";
import {
  ThreadContextProvider,
  useThreadContext,
} from "../contexts/thread-context";
import { ExtUserProvider } from "../contexts/ext-user-context";
import {
  DisplayCacheProvider,
  type RuntimeAccount,
} from "../query/display-cache";
import type { DisplayPersistence } from "../query/display-persistence";
import { AomiRuntimeCore } from "./core";
import { useThreadNavigation } from "./use-thread-navigation";
import {
  buildThreadPersistenceKey,
  readPersistedThreadId,
} from "./thread-persistence";

// =============================================================================
// Props
// =============================================================================

export type AomiRuntimeProviderProps = {
  children: ReactNode;
  /**
   * Who is signed in: a guest, a user, or nobody (null). Leave undefined while
   * the host is still finding out; account data is neither shown nor restored
   * until it is known.
   */
  account?: RuntimeAccount | null;
  /** What to save across reloads. Defaults to the public catalogs. */
  displayPersistence?: DisplayPersistence;
  backendUrl?: string;
  /** Credentials stay in memory unless a host opts into tab-scoped persistence. */
  apiKeyPersistence?: "memory" | "session";
  applicationId?: number | string | null;
  /** Optional host-fixed target. Omit to use the per-thread Auto/Direct control. */
  agentTarget?: AgentTarget;
  appPlatforms?: AomiPlatformFilter;
  clientOptions?: Omit<AomiClientOptions, "baseUrl">;
  inferenceFunding?: AomiInferenceFundingSource;
  actions?: ActionCapabilities;
  commits?: CommitCapabilities;
  /** Whether an account session can load chats without a wallet. */
  accountSessionAvailable?: boolean;
  /** Optional explicit initial thread. Takes precedence over stored state. */
  initialThreadId?: string;
  /** Host-controlled selection; prop changes restore a thread without echoing callbacks. */
  threadId?: string;
  /** Reports selections made inside the runtime. */
  onThreadChange?: (threadId: string) => void;
  /** Persist the active materialized thread in localStorage. Defaults to true. */
  persistThread?: boolean;
  /** Full localStorage key override for vendors that need exact isolation. */
  threadPersistenceKey?: string;
  /** Extra key segment for tenant/user/app scoping of the stored thread. */
  threadPersistenceScope?: string | null;
};

// =============================================================================
// Provider Shell
// =============================================================================

export function AomiRuntimeProvider({
  children,
  account,
  displayPersistence,
  backendUrl,
  apiKeyPersistence,
  applicationId,
  agentTarget,
  appPlatforms,
  clientOptions,
  inferenceFunding,
  actions,
  commits,
  accountSessionAvailable = false,
  initialThreadId,
  threadId,
  onThreadChange,
  persistThread = true,
  threadPersistenceKey,
  threadPersistenceScope,
}: Readonly<AomiRuntimeProviderProps>) {
  if (backendUrl === undefined)
    throw new Error(
      "[aomi] backendUrl is required; pass your API URL explicitly (an empty string selects same-origin transport).",
    );
  const resolvedThreadPersistenceKey = useMemo(() => {
    if (!persistThread) return null;
    return (
      threadPersistenceKey ??
      buildThreadPersistenceKey({
        backendUrl,
        applicationId,
        scope: threadPersistenceScope,
      })
    );
  }, [
    applicationId,
    backendUrl,
    persistThread,
    threadPersistenceKey,
    threadPersistenceScope,
  ]);

  const restoredThreadId = useMemo(() => {
    if (initialThreadId) return initialThreadId;
    if (!resolvedThreadPersistenceKey) return undefined;
    return readPersistedThreadId(resolvedThreadPersistenceKey) ?? undefined;
  }, [initialThreadId, resolvedThreadPersistenceKey]);

  const resolvedClientOptions = useMemo(
    () => ({
      logger: {
        debug: (...args: unknown[]) => console.debug(...args),
      },
      ...clientOptions,
    }),
    [clientOptions],
  );

  const confirmedCookieSession = useRef(accountSessionAvailable);
  confirmedCookieSession.current = accountSessionAvailable;
  const aomiClient = useMemo(
    () =>
      new AomiClient({
        baseUrl: backendUrl,
        ...resolvedClientOptions,
        guest:
          resolvedClientOptions.guest === true ||
          (resolvedClientOptions.guest === undefined &&
            !resolvedClientOptions.oauth &&
            !resolvedClientOptions.getAccountBearer)
            ? createGuestSessionProvider({
                baseUrl: backendUrl,
                fetch: resolvedClientOptions.fetch,
                getCookieSessionAvailable: () => confirmedCookieSession.current,
              })
            : resolvedClientOptions.guest,
      }),
    [backendUrl, resolvedClientOptions],
  );

  return (
    <DisplayCacheProvider
      backendUrl={backendUrl}
      applicationId={applicationId}
      account={account}
      persistence={displayPersistence}
      apiClient={aomiClient}
    >
      <ThreadContextProvider initialThreadId={threadId ?? restoredThreadId}>
        <NotificationContextProvider>
          <ExtUserProvider>
            <AomiRuntimeInner
              account={account}
              threadId={threadId}
              onThreadChange={onThreadChange}
              aomiClient={aomiClient}
              accountAuthSource={
                resolvedClientOptions.getAccountBearer?.required
                  ? resolvedClientOptions.getAccountBearer
                  : resolvedClientOptions.oauth
              }
              apiKeyPersistence={apiKeyPersistence}
              backendUrl={backendUrl}
              inferenceFunding={inferenceFunding}
              applicationId={applicationId}
              agentTarget={agentTarget}
              appPlatforms={appPlatforms}
              accountSessionAvailable={accountSessionAvailable}
              actions={actions}
              commits={commits}
              restoredThreadId={restoredThreadId}
              threadPersistenceKey={resolvedThreadPersistenceKey}
            >
              {children}
            </AomiRuntimeInner>
          </ExtUserProvider>
        </NotificationContextProvider>
      </ThreadContextProvider>
    </DisplayCacheProvider>
  );
}

// =============================================================================
// Inner Provider (needs ThreadContext and UserContext)
// =============================================================================

type AomiRuntimeInnerProps = {
  children: ReactNode;
  account?: RuntimeAccount | null;
  aomiClient: AomiClient;
  accountAuthSource?:
    | AomiClientOptions["getAccountBearer"]
    | AomiClientOptions["oauth"];
  apiKeyPersistence?: "memory" | "session";
  backendUrl: string;
  inferenceFunding?: AomiInferenceFundingSource;
  applicationId?: number | string | null;
  agentTarget?: AgentTarget;
  appPlatforms?: AomiPlatformFilter;
  accountSessionAvailable: boolean;
  actions?: ActionCapabilities;
  commits?: CommitCapabilities;
  restoredThreadId?: string;
  threadId?: string;
  onThreadChange?: (threadId: string) => void;
  threadPersistenceKey?: string | null;
};

function AomiRuntimeInner({
  children,
  account,
  aomiClient,
  accountAuthSource,
  apiKeyPersistence,
  backendUrl,
  inferenceFunding,
  applicationId,
  agentTarget,
  appPlatforms,
  accountSessionAvailable,
  actions,
  commits,
  restoredThreadId,
  threadId,
  onThreadChange,
  threadPersistenceKey,
}: Readonly<AomiRuntimeInnerProps>) {
  const threadContext = useThreadContext();
  const initialSelection = useRef(threadId ?? restoredThreadId).current;
  useThreadNavigation(threadId, onThreadChange);

  return (
    <ControlContextProvider
      aomiClient={aomiClient}
      backendUrl={backendUrl}
      apiKeyPersistence={apiKeyPersistence}
      sessionId={threadContext.currentThreadId}
      getThreadMetadata={threadContext.getThreadMetadata}
      updateThreadMetadata={threadContext.updateThreadMetadata}
      appPlatforms={appPlatforms}
      applicationId={applicationId}
      inferenceFunding={inferenceFunding}
      accountSessionAvailable={accountSessionAvailable}
      account={account}
    >
      <AomiRuntimeCore
        account={account}
        aomiClient={aomiClient}
        accountAuthSource={accountAuthSource}
        agentTarget={agentTarget}
        accountSessionAvailable={accountSessionAvailable}
        actions={actions}
        commits={commits}
        restoredThreadId={initialSelection}
        threadPersistenceKey={threadPersistenceKey}
      >
        {children}
      </AomiRuntimeCore>
    </ControlContextProvider>
  );
}
