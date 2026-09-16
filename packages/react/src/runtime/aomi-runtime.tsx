"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  AomiClient,
  type ActionCapabilities,
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
import { AomiRuntimeCore } from "./core";
import {
  buildThreadPersistenceKey,
  readPersistedThreadId,
} from "./thread-persistence";

// =============================================================================
// Props
// =============================================================================

export type AomiRuntimeProviderProps = {
  children: ReactNode;
  backendUrl?: string;
  applicationId?: number | string | null;
  appPlatforms?: AomiPlatformFilter;
  clientOptions?: Omit<AomiClientOptions, "baseUrl">;
  inferenceFunding?: AomiInferenceFundingSource;
  actions?: ActionCapabilities;
  /** Whether a canonical account session can load threads without a wallet. */
  accountSessionAvailable?: boolean;
  /** Optional explicit initial thread. Takes precedence over stored state. */
  initialThreadId?: string;
  /** Persist the active materialized thread in localStorage. Defaults to true. */
  persistThread?: boolean;
  /** Full localStorage key override for vendors that need exact isolation. */
  threadPersistenceKey?: string;
  /** Extra key segment for tenant/user/app scoping without owning the full key. */
  threadPersistenceScope?: string | null;
};

// =============================================================================
// Provider Shell
// =============================================================================

export function AomiRuntimeProvider({
  children,
  backendUrl = "http://127.0.0.1:8080",
  applicationId,
  appPlatforms,
  clientOptions,
  inferenceFunding,
  actions,
  accountSessionAvailable = false,
  initialThreadId,
  persistThread = true,
  threadPersistenceKey,
  threadPersistenceScope,
}: Readonly<AomiRuntimeProviderProps>) {
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

  const aomiClient = useMemo(
    () =>
      new AomiClient({
        baseUrl: backendUrl,
        ...resolvedClientOptions,
      }),
    [backendUrl, resolvedClientOptions],
  );

  return (
    <ThreadContextProvider initialThreadId={restoredThreadId}>
      <NotificationContextProvider>
        <ExtUserProvider>
          <AomiRuntimeInner
            aomiClient={aomiClient}
            inferenceFunding={inferenceFunding}
            applicationId={applicationId}
            appPlatforms={appPlatforms}
            accountSessionAvailable={accountSessionAvailable}
            actions={actions}
            restoredThreadId={restoredThreadId}
            threadPersistenceKey={resolvedThreadPersistenceKey}
          >
            {children}
          </AomiRuntimeInner>
        </ExtUserProvider>
      </NotificationContextProvider>
    </ThreadContextProvider>
  );
}

// =============================================================================
// Inner Provider (needs ThreadContext and UserContext)
// =============================================================================

type AomiRuntimeInnerProps = {
  children: ReactNode;
  aomiClient: AomiClient;
  inferenceFunding?: AomiInferenceFundingSource;
  applicationId?: number | string | null;
  appPlatforms?: AomiPlatformFilter;
  accountSessionAvailable: boolean;
  actions?: ActionCapabilities;
  restoredThreadId?: string;
  threadPersistenceKey?: string | null;
};

function AomiRuntimeInner({
  children,
  aomiClient,
  inferenceFunding,
  applicationId,
  appPlatforms,
  accountSessionAvailable,
  actions,
  restoredThreadId,
  threadPersistenceKey,
}: Readonly<AomiRuntimeInnerProps>) {
  const threadContext = useThreadContext();

  return (
    <ControlContextProvider
      aomiClient={aomiClient}
      sessionId={threadContext.currentThreadId}
      getThreadMetadata={threadContext.getThreadMetadata}
      updateThreadMetadata={threadContext.updateThreadMetadata}
      appPlatforms={appPlatforms}
      applicationId={applicationId}
      inferenceFunding={inferenceFunding}
    >
      <AomiRuntimeCore
        aomiClient={aomiClient}
        applicationId={applicationId}
        accountSessionAvailable={accountSessionAvailable}
        actions={actions}
        restoredThreadId={restoredThreadId}
        threadPersistenceKey={threadPersistenceKey}
      >
        {children}
      </AomiRuntimeCore>
    </ControlContextProvider>
  );
}
