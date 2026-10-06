"use client";

import { createScopedStorage } from "@aomi-labs/client";

// Assembles the focused control hooks in ../control/ into useControl().
// Change behaviour in the hook that owns it (api-key, byok, app-secrets,
// auth-endpoints, per-thread-control).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  useAppSecretsImpl,
  type AppSecretsActions,
} from "../control/app-secrets";
import {
  usePerThreadControlImpl,
  type PerThreadControlActions,
} from "../control/per-thread-control";

export type { StoredByokKey } from "../control/byok";

// =============================================================================
// Public types
// =============================================================================

/** All control state. Prefer the focused hooks below for one slice. */
export type ControlState = ApiKeyState &
  ByokState &
  AuthEndpointsState & {
    clientId: string | null;
  };

export type ControlContextApi = ApiKeyActions &
  ByokActions &
  AppSecretsActions &
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

// Focused slice readers over the same state as useControl().

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

export function useAppSecrets(): { actions: AppSecretsActions } {
  const ctx = useControl();
  return {
    actions: {
      listAppSecrets: ctx.listAppSecrets,
      saveAppSecrets: ctx.saveAppSecrets,
      deleteAppSecret: ctx.deleteAppSecret,
      clearAppSecrets: ctx.clearAppSecrets,
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
      modelsLoading: ctx.state.modelsLoading,
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
      getCurrentThreadAgentMode: ctx.getCurrentThreadAgentMode,
      getCurrentThreadTarget: ctx.getCurrentThreadTarget,
      getCurrentThreadApp: ctx.getCurrentThreadApp,
      getCurrentThreadApplicationId: ctx.getCurrentThreadApplicationId,
      getPreferredThreadControl: ctx.getPreferredThreadControl,
      onModelSelect: ctx.onModelSelect,
      onAppSelect: ctx.onAppSelect,
      onAgentTargetSelect: ctx.onAgentTargetSelect,
      onAgentModeSelect: ctx.onAgentModeSelect,
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
  apiKeyPersistence?: "memory" | "session";
  backendUrl?: string;
  inferenceFunding?: AomiInferenceFundingSource;
  accountSessionAvailable?: boolean;
};

export function ControlContextProvider({
  children,
  aomiClient,
  sessionId,
  getThreadMetadata,
  updateThreadMetadata,
  appPlatforms,
  applicationId,
  apiKeyPersistence,
  backendUrl = "",
  inferenceFunding,
  accountSessionAvailable = false,
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

  const storageScope = useMemo(
    () => ({ backendUrl: backendUrl, appId: applicationId }),
    [backendUrl, applicationId],
  );
  const storage = useMemo(
    () => createScopedStorage(storageScope),
    [storageScope],
  );
  const clientIdRef = useRef<string | null>(null);
  const clientIdScopeRef = useRef(storage.key("clientId"));
  if (
    clientIdRef.current === null ||
    clientIdScopeRef.current !== storage.key("clientId")
  ) {
    clientIdRef.current = getOrCreateClientId(storage);
    clientIdScopeRef.current = storage.key("clientId");
  }
  const apiKey = useApiKeyImpl(storageScope, apiKeyPersistence);
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
    accountClient: accountSessionAvailable ? aomiClient : null,
    clientIdRef,
    getControlSessionId: getCurrentControlSessionId,
    initialInferenceFunding: inferenceFunding,
  });

  const appSecrets = useAppSecretsImpl({
    aomiClientRef,
    getControlSessionId: getCurrentControlSessionId,
  });

  const authEndpoints = useAuthEndpointsImpl({
    aomiClientRef,
    apiKeyRef,
    getControlSessionId: getCurrentControlSessionId,
    apiKey: apiKey.state.apiKey,
    credentialRevision: apiKey.revision,
    accountSessionAvailable,
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
    storage,
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
    modelsLoading: authEndpoints.state.modelsLoading,
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
    ...appSecrets.actions,
    ...authEndpoints.actions,
    ...perThread,
  };

  return (
    <ControlContext.Provider value={api}>{children}</ControlContext.Provider>
  );
}

export type { ThreadControlState };
