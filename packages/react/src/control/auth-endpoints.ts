// Models and apps this runtime may use. Both are scoped to the credential
// (app key and account), not to the open chat, so switching chats never
// refetches them. Inside a runtime without a key they come from the public
// catalog; a standalone control provider asks the backend directly.

import { useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import type {
  AomiAppDescriptor,
  AomiClient,
  AomiPlatformFilter,
  ApplicationId,
} from "@aomi-labs/client";
import { useAomiDisplayCache, useDisplayQuery } from "../query/display-cache";
import { displayQueries } from "../query/queries";
import { resolveAutoModel } from "./model-selection";

export type AuthEndpointsState = {
  availableModels: string[];
  defaultModel: string | null;
  authorizedApps: string[];
  appDescriptors: AomiAppDescriptor[];
  defaultApp: string | null;
  /** False once the latest model read settled (success or failure). */
  modelsLoading?: boolean;
};

export type AuthEndpointsActions = {
  /** Force a refresh of the models list. */
  getAvailableModels: () => Promise<string[]>;
  /** Force a refresh of the authorized apps list. */
  getAuthorizedApps: () => Promise<string[]>;
};

type UseAuthEndpointsOptions = {
  aomiClientRef: MutableRefObject<AomiClient>;
  apiKeyRef: MutableRefObject<string | null>;
  /** Stable getter for the current control-session id (clientId + sessionId). */
  getControlSessionId: () => string;
  apiKey: string | null;
  /** Changes whenever the app key does. */
  credentialRevision: number;
  /** Optional backend platform filter for the app catalog. */
  appPlatforms?: AomiPlatformFilter;
  /** Hosted app this runtime is scoped to; routed on by the edge. */
  applicationId?: ApplicationId;
  accountSessionAvailable?: boolean;
};

const NO_APPS: AomiAppDescriptor[] = [];
const DEFAULT_APPS: AomiAppDescriptor[] = [{ name: "default" }];
const NO_MODELS: string[] = [];

function getDefaultApp(apps: string[]): string | null {
  return apps.includes("default") ? "default" : (apps[0] ?? null);
}

const appNames = (apps: ReadonlyArray<{ name: string }>) =>
  apps.map((app) => app.name);

/** Provider-internal: consumers use `useAuthEndpoints` from control-context. */
export function useAuthEndpointsImpl({
  aomiClientRef,
  apiKeyRef,
  getControlSessionId,
  apiKey,
  credentialRevision,
  appPlatforms,
  applicationId,
  accountSessionAvailable = false,
}: UseAuthEndpointsOptions): {
  state: AuthEndpointsState;
  actions: AuthEndpointsActions;
} {
  const api = aomiClientRef.current;
  const appId = applicationId?.toString() ?? "";
  const credential = {
    sessionId: getControlSessionId,
    appId,
    credential: credentialRevision,
  };
  const publicLane = Boolean(useAomiDisplayCache()) && !apiKey;
  const models = useDisplayQuery(
    publicLane
      ? displayQueries.models(api)
      : displayQueries.authorizedModels(api, credential),
  );
  const apps = useDisplayQuery(
    !publicLane || accountSessionAvailable
      ? displayQueries.authorizedApps(api, {
          ...credential,
          apiKey: () => apiKeyRef.current,
          platforms: appPlatforms,
        })
      : displayQueries.appCatalog(api, appPlatforms),
  );
  const availableModels = models.data ?? NO_MODELS;
  const appDescriptors = apps.data ?? (apps.error ? DEFAULT_APPS : NO_APPS);
  const authorizedApps = useMemo(
    () => appNames(appDescriptors),
    [appDescriptors],
  );
  const getAvailableModels = useCallback(
    async () => (await models.refetch()).data ?? [],
    [models.refetch],
  );
  const getAuthorizedApps = useCallback(
    async () => appNames((await apps.refetch()).data ?? DEFAULT_APPS),
    [apps.refetch],
  );

  return {
    state: {
      availableModels,
      defaultModel: resolveAutoModel(availableModels),
      authorizedApps,
      appDescriptors,
      defaultApp: getDefaultApp(authorizedApps),
      modelsLoading: models.isPending,
    },
    actions: { getAvailableModels, getAuthorizedApps },
  };
}
