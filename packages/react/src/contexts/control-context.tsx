"use client";

// =============================================================================
// ControlContextProvider — thin composition root
// =============================================================================
//
// This file used to be 978 lines and seven concerns wedged into one component.
// It's now a wiring layer: the four domain hooks in `../control/` each own
// their slice of state + effects + actions, and this file assembles them into
// the public ControlContextApi.
//
// If you need to change behavior, you almost certainly want one of:
//   ../control/api-key.ts          — apiKey + persistence
//   ../control/byok.ts             — BYOK keys + secret vault API
//   ../control/auth-endpoints.ts   — apps + models fetch
//   ../control/per-thread-control.ts — model/app selection + sync
//
// useControl() is preserved as the public hook for now. The new focused
// hooks (useApiKey, useByok, useAuthEndpoints, usePerThreadControl) are
// available as direct imports for consumers that only need one slice.
//
// Deleted in this pass:
//   - onControlStateChange callbacks pub/sub (no external consumers)
//   - setState legacy shim (deprecated since the May 2026 refactor)

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type {
  AomiClient,
  AomiInferenceFundingSource,
  AomiPlatformFilter,
  ApplicationId,
} from "@aomi-labs/client";
import type { ThreadControlState, ThreadMetadata } from "../state/thread-store";
import {
  CLIENT_ID_STORAGE_KEY,
  getControlSessionId,
  getOrCreateClientId,
} from "../utils/client-session";

import {
  useApiKeyImpl,
  type ApiKeyState,
  type ApiKeyActions,
} from "../control/api-key";
import {
  useByokImpl,
  type ByokState,
  type ByokActions,
  type StoredByokKey,
} from "../control/byok";
import {
  useAuthEndpointsImpl,
  type AuthEndpointsState,
  type AuthEndpointsActions,
} from "../control/auth-endpoints";
import {
  usePerThreadControlImpl,
  type PerThreadControlActions,
} from "../control/per-thread-control";

// Re-export domain types so existing consumers that pull them from this file
// keep compiling.
export type { StoredByokKey } from "../control/byok";

// =============================================================================
// Public types
// =============================================================================

/**
 * Aggregated control state. Mirrors the historical shape so callers reading
 * `useControl().state` keep working. New code should prefer the focused
 * hooks and read their narrower slices directly.
 */
export type ControlState = ApiKeyState &
  ByokState &
  AuthEndpointsState & {
    clientId: string | null;
  };

export type ControlContextApi = ApiKeyActions &
  ByokActions &
  AuthEndpointsActions &
  PerThreadControlActions & {
    state: ControlState;
    /** Synchronous getter used by the runtime to read the latest state from a
     *  callback that fires outside render. */
    getControlState: () => ControlState;
  };

// =============================================================================
// Context
// =============================================================================

const ControlContext = createContext<ControlContextApi | null>(null);

export function useControl(): ControlContextApi {
  const ctx = useContext(ControlContext);
  if (!ctx) {
    throw new Error("useControl must be used within ControlContextProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Focused slice readers
//
// Each returns just the slice it's named for. Composes with useControl() —
// the underlying state is the same; these just narrow the surface area so
// callers don't have access to (and don't trigger re-renders for) data they
// don't read.
// ---------------------------------------------------------------------------

export function useApiKey(): {
  state: ApiKeyState & { clientId: string | null };
  actions: ApiKeyActions;
} {
  const ctx = useControl();
  return {
    state: { apiKey: ctx.state.apiKey, clientId: ctx.state.clientId },
    actions: { setApiKey: ctx.setApiKey },
  };
}

export function useByok(): { state: ByokState; actions: ByokActions } {
  const ctx = useControl();
  return {
    state: {
      byokKeys: ctx.state.byokKeys,
      inferenceFunding: ctx.state.inferenceFunding,
    },
    actions: {
      setByok: ctx.setByok,
      removeByok: ctx.removeByok,
      getByokKeys: ctx.getByokKeys,
      hasByok: ctx.hasByok,
      setInferenceFunding: ctx.setInferenceFunding,
      ingestSecrets: ctx.ingestSecrets,
      clearSecrets: ctx.clearSecrets,
      deleteSecret: ctx.deleteSecret,
      listSecrets: ctx.listSecrets,
    },
  };
}

export function useAuthEndpoints(): {
  state: AuthEndpointsState;
  actions: AuthEndpointsActions;
} {
  const ctx = useControl();
  return {
    state: {
      availableModels: ctx.state.availableModels,
      defaultModel: ctx.state.defaultModel,
      authorizedApps: ctx.state.authorizedApps,
      appDescriptors: ctx.state.appDescriptors,
      defaultApp: ctx.state.defaultApp,
    },
    actions: {
      getAvailableModels: ctx.getAvailableModels,
      getAuthorizedApps: ctx.getAuthorizedApps,
    },
  };
}

export function usePerThreadControl(): {
  actions: PerThreadControlActions;
} {
  const ctx = useControl();
  return {
    actions: {
      getCurrentThreadControl: ctx.getCurrentThreadControl,
      getCurrentThreadApp: ctx.getCurrentThreadApp,
      getCurrentThreadApplicationId: ctx.getCurrentThreadApplicationId,
      getPreferredThreadControl: ctx.getPreferredThreadControl,
      onModelSelect: ctx.onModelSelect,
      onAppSelect: ctx.onAppSelect,
      markControlSynced: ctx.markControlSynced,
    },
  };
}

// =============================================================================
// Provider
// =============================================================================

export type ControlContextProviderProps = {
  children: ReactNode;
  aomiClient: AomiClient;
  sessionId: string;
  getThreadMetadata: (threadId: string) => ThreadMetadata | undefined;
  updateThreadMetadata: (
    threadId: string,
    partial: Partial<ThreadMetadata>,
  ) => void;
  appPlatforms?: AomiPlatformFilter;
  applicationId?: ApplicationId;
  inferenceFunding?: AomiInferenceFundingSource;
};

export function ControlContextProvider({
  children,
  aomiClient,
  sessionId,
  getThreadMetadata,
  updateThreadMetadata,
  appPlatforms,
  applicationId,
  inferenceFunding,
}: ControlContextProviderProps) {
  // ---------------------------------------------------------------------------
  // Stable refs into the central plumbing (aomiClient, the props that change
  // per render). Each focused hook reads from these via the args we pass it.
  // ---------------------------------------------------------------------------
  const aomiClientRef = useRef(aomiClient);
  aomiClientRef.current = aomiClient;

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const getThreadMetadataRef = useRef(getThreadMetadata);
  getThreadMetadataRef.current = getThreadMetadata;

  const updateThreadMetadataRef = useRef(updateThreadMetadata);
  updateThreadMetadataRef.current = updateThreadMetadata;

  // clientId is initialized once from localStorage and persisted on change.
  // Treating it as a ref + persist effect keeps it stable across renders.
  const clientIdRef = useRef<string | null>(null);
  if (clientIdRef.current === null) {
    clientIdRef.current = getOrCreateClientId();
  }
  useEffect(() => {
    try {
      if (clientIdRef.current) {
        globalThis.localStorage?.setItem(
          CLIENT_ID_STORAGE_KEY,
          clientIdRef.current,
        );
      }
    } catch {
      // localStorage not available
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Domain hooks
  // ---------------------------------------------------------------------------
  const apiKey = useApiKeyImpl();
  const apiKeyRef = useRef(apiKey.state.apiKey);
  apiKeyRef.current = apiKey.state.apiKey;

  // Stable callback used by every backend call that needs to identify this
  // (clientId, threadId) tuple. Empty deps — reads from refs.
  const getCurrentControlSessionId = useCallback(
    () => getControlSessionId(clientIdRef.current, sessionIdRef.current),
    [],
  );

  const byok = useByokImpl({
    aomiClientRef,
    clientIdRef,
    getControlSessionId: getCurrentControlSessionId,
    initialInferenceFunding: inferenceFunding,
  });

  const authEndpoints = useAuthEndpointsImpl({
    aomiClientRef,
    apiKeyRef,
    getControlSessionId: getCurrentControlSessionId,
    apiKey: apiKey.state.apiKey,
    appPlatforms,
    applicationId,
  });

  // Refs for the auth-endpoint state so per-thread-control callbacks can read
  // the latest values without re-creating themselves on every fetch.
  const availableModelsRef = useRef(authEndpoints.state.availableModels);
  availableModelsRef.current = authEndpoints.state.availableModels;
  const defaultModelRef = useRef(authEndpoints.state.defaultModel);
  defaultModelRef.current = authEndpoints.state.defaultModel;
  const authorizedAppsRef = useRef(authEndpoints.state.authorizedApps);
  authorizedAppsRef.current = authEndpoints.state.authorizedApps;
  const appDescriptorsRef = useRef(authEndpoints.state.appDescriptors);
  appDescriptorsRef.current = authEndpoints.state.appDescriptors;
  const defaultAppRef = useRef(authEndpoints.state.defaultApp);
  defaultAppRef.current = authEndpoints.state.defaultApp;

  const perThread = usePerThreadControlImpl({
    sessionIdRef,
    getThreadMetadataRef,
    updateThreadMetadataRef,
    availableModels: authEndpoints.state.availableModels,
    defaultModel: authEndpoints.state.defaultModel,
    availableModelsRef,
    defaultModelRef,
    authorizedAppsRef,
    appDescriptorsRef,
    defaultAppRef,
    sessionId,
  });

  // ---------------------------------------------------------------------------
  // Aggregate state + stable getter
  // ---------------------------------------------------------------------------
  const aggregateState: ControlState = {
    apiKey: apiKey.state.apiKey,
    clientId: clientIdRef.current,
    byokKeys: byok.state.byokKeys,
    inferenceFunding: byok.state.inferenceFunding,
    availableModels: authEndpoints.state.availableModels,
    defaultModel: authEndpoints.state.defaultModel,
    authorizedApps: authEndpoints.state.authorizedApps,
    appDescriptors: authEndpoints.state.appDescriptors,
    defaultApp: authEndpoints.state.defaultApp,
  };

  const aggregateStateRef = useRef(aggregateState);
  aggregateStateRef.current = aggregateState;

  const getControlState = useCallback(() => aggregateStateRef.current, []);

  // ---------------------------------------------------------------------------
  // Assemble the public api
  // ---------------------------------------------------------------------------
  const api: ControlContextApi = {
    state: aggregateState,
    getControlState,
    ...apiKey.actions,
    ...byok.actions,
    ...authEndpoints.actions,
    ...perThread,
  };

  return (
    <ControlContext.Provider value={api}>{children}</ControlContext.Provider>
  );
}

export type { ThreadControlState };
