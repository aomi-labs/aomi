// =============================================================================
// useAuthEndpoints — fetch authorized apps + available models from BE
// =============================================================================
//
// Both endpoints share three traits:
//   - Scoped to the auth context (apiKey + clientId), NOT per-thread
//   - Cached in React state once fetched, refreshed only when auth changes
//   - Used by per-thread-control to validate model/app selections
//
// Background: the deps on these effects USED to include `sessionId` (current
// thread id) before the May 2026 fix. That caused refire on every thread
// switch — a ~3 s `/api/thread/apps` call burned per click. The stable
// `getControlSessionId` callback (provided by the caller) reads from refs
// inside, so the effect deps stay quiet across thread switches.

import { useCallback, useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type {
  AomiAppDescriptor,
  AomiClient,
  AomiPlatformFilter,
  ApplicationId,
} from "@aomi-labs/client";
import { resolveAutoModel } from "../utils/model-selection";

export type AuthEndpointsState = {
  availableModels: string[];
  defaultModel: string | null;
  authorizedApps: string[];
  appDescriptors: AomiAppDescriptor[];
  defaultApp: string | null;
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
  /** Trigger that should cause apps to refetch (e.g. apiKey changes). */
  apiKey: string | null;
  /** Optional backend platform filter for the app catalog. */
  appPlatforms?: AomiPlatformFilter;
  /** Hosted app this runtime is scoped to; routed on by the edge. */
  applicationId?: ApplicationId;
};

function getDefaultApp(apps: string[]): string | null {
  return apps.includes("default") ? "default" : (apps[0] ?? null);
}

function namesFromDescriptors(apps: ReadonlyArray<{ name: string }>): string[] {
  return apps.map((a) => a.name);
}

/** Provider-internal: owns the apps/models state. Consumers should use the
 *  `useAuthEndpoints` slice reader exported from contexts/control-context.tsx. */
export function useAuthEndpointsImpl({
  aomiClientRef,
  apiKeyRef,
  getControlSessionId,
  apiKey,
  appPlatforms,
  applicationId,
}: UseAuthEndpointsOptions): {
  state: AuthEndpointsState;
  actions: AuthEndpointsActions;
} {
  const appPlatformsKey = Array.isArray(appPlatforms)
    ? appPlatforms.join("\0")
    : (appPlatforms ?? "");
  // Primitive so the callbacks below stay stable across renders.
  const appId = applicationId?.toString() ?? "";
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [authorizedApps, setAuthorizedApps] = useState<string[]>([]);
  const [appDescriptors, setAppDescriptors] = useState<AomiAppDescriptor[]>([]);
  const [defaultApp, setDefaultApp] = useState<string | null>(null);

  const getAvailableModels = useCallback(async (): Promise<string[]> => {
    try {
      const models = await aomiClientRef.current.getModels(
        getControlSessionId(),
        { applicationId: appId },
      );
      setAvailableModels(models);
      setDefaultModel(resolveAutoModel(models));
      return models;
    } catch (error) {
      console.error("Failed to fetch models:", error);
      return [];
    }
  }, [aomiClientRef, getControlSessionId, appId]);

  const getAuthorizedApps = useCallback(async (): Promise<string[]> => {
    try {
      const descriptors = await aomiClientRef.current.getApps(
        getControlSessionId(),
        {
          apiKey: apiKeyRef.current ?? undefined,
          platforms: appPlatforms,
          applicationId: appId,
        },
      );
      const names = namesFromDescriptors(descriptors);
      setAuthorizedApps(names);
      setAppDescriptors(descriptors);
      setDefaultApp(getDefaultApp(names));
      return names;
    } catch (error) {
      console.error("Failed to fetch apps:", error);
      setAuthorizedApps(["default"]);
      setAppDescriptors([{ name: "default" }]);
      setDefaultApp("default");
      return ["default"];
    }
  }, [aomiClientRef, apiKeyRef, getControlSessionId, appPlatformsKey, appId]);

  // Fetch models on mount. Fetch apps whenever the auth context changes —
  // apiKey is the trigger; scoped to apiKey/clientId state, NOT to thread
  // switches (see header comment for history).
  useEffect(() => {
    void getAvailableModels();
  }, [getAvailableModels]);
  useEffect(() => {
    void getAuthorizedApps();
  }, [getAuthorizedApps, apiKey]);

  return {
    state: {
      availableModels,
      defaultModel,
      authorizedApps,
      appDescriptors,
      defaultApp,
    },
    actions: { getAvailableModels, getAuthorizedApps },
  };
}
