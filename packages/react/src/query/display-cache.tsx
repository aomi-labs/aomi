"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, useQuery, type QueryKey } from "@tanstack/react-query";
import type { AomiClient } from "@aomi-labs/client";
import {
  persistDisplayCache,
  type DisplayPersistence,
} from "./display-persistence";

/** Who the runtime talks to the backend as. */
export type RuntimeAccount = { kind: "guest" | "user"; id: string };

export type DisplayResource =
  | "models"
  | "app-catalog"
  | "skills"
  | "authorized-models"
  | "authorized-apps"
  | "threads"
  | "profile"
  | "credits"
  | "account-acl"
  | "account-apps"
  | "transaction-safety"
  | "usage";

/** The same for every caller: keyed without the account and cached at the edge. */
const PUBLIC_CATALOGS: ReadonlySet<DisplayResource> = new Set([
  "models",
  "app-catalog",
  "skills",
]);
export const isPublicCatalog = (resource: DisplayResource) =>
  PUBLIC_CATALOGS.has(resource);

const MINUTE = 60_000;
const STALE_TIME: Partial<Record<DisplayResource, number>> = {
  models: 30 * MINUTE,
  "app-catalog": 30 * MINUTE,
  skills: 30 * MINUTE,
  credits: MINUTE,
  "transaction-safety": 10 * MINUTE,
};
const REFRESH_ON_FOCUS: ReadonlySet<DisplayResource> = new Set([
  "profile",
  "account-acl",
]);

/**
 * `account` is undefined while the host is still finding out who is signed in,
 * and null when nobody is.
 */
export type DisplayScope = {
  backendUrl: string;
  appId: string;
  account: RuntimeAccount | null | undefined;
};

/** How to load one display resource. Factories live in `queries.ts`. */
export type DisplayQuery<T> = {
  resource: DisplayResource;
  parameters?: readonly unknown[];
  fetcher: (signal: AbortSignal) => Promise<T>;
  staleTime?: number;
  enabled?: boolean;
};

export type DisplayCache = {
  client: QueryClient;
  scope: DisplayScope;
  apiClient?: AomiClient;
  /** Display-only owner recovered while the host confirms its session. */
  restoredAccount?: RuntimeAccount;
  key: (resource: DisplayResource, parameters?: readonly unknown[]) => QueryKey;
};

export function createDisplayQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * MINUTE,
        gcTime: 24 * 60 * MINUTE,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** The key prefix of everything one account may see. Public catalogs share one prefix. */
export function displayKeyPrefix(
  scope: DisplayScope,
  owner: "public" | RuntimeAccount | null,
): QueryKey {
  return ["aomi", scope.backendUrl, scope.appId, owner];
}

export function displayKey(
  scope: DisplayScope,
  resource: DisplayResource,
  parameters: readonly unknown[] = [],
): QueryKey {
  const owner = isPublicCatalog(resource) ? "public" : (scope.account ?? null);
  return [...displayKeyPrefix(scope, owner), resource, ...parameters];
}

function toQueryOptions<T>(scope: DisplayScope | null, query: DisplayQuery<T>) {
  return {
    queryKey: scope
      ? displayKey(scope, query.resource, query.parameters)
      : ["standalone", query.resource, ...(query.parameters ?? [])],
    queryFn: ({ signal }: { signal: AbortSignal }) => query.fetcher(signal),
    enabled: query.enabled ?? true,
    staleTime: query.staleTime ?? STALE_TIME[query.resource] ?? 5 * MINUTE,
    refetchOnWindowFocus: REFRESH_ON_FOCUS.has(query.resource),
  };
}

/** Read a display resource through the cache without subscribing to it. */
export function fetchDisplayQuery<T>(
  cache: DisplayCache,
  query: DisplayQuery<T>,
): Promise<T> {
  return cache.client.fetchQuery(toQueryOptions(cache.scope, query));
}

const DisplayCacheContext = createContext<DisplayCache | null>(null);
export const useAomiDisplayCache = () => useContext(DisplayCacheContext);

export function DisplayCacheProvider({
  backendUrl,
  applicationId,
  account,
  persistence = "public",
  apiClient,
  children,
}: {
  backendUrl: string;
  applicationId?: number | string | null;
  account?: RuntimeAccount | null;
  persistence?: DisplayPersistence;
  apiClient?: AomiClient;
  children: ReactNode;
}) {
  const [client] = useState(createDisplayQueryClient);
  const normalizedBackend = backendUrl.replace(/\/+$/, "");
  const appId = String(applicationId ?? "");
  const accountKind = account?.kind;
  const accountId = account?.id;
  const accountKnown = account !== undefined;
  const scope = useMemo<DisplayScope>(
    () => ({
      backendUrl: normalizedBackend,
      appId,
      account: !accountKnown
        ? undefined
        : accountKind && accountId
          ? { kind: accountKind, id: accountId }
          : null,
    }),
    [normalizedBackend, appId, accountKnown, accountKind, accountId],
  );
  const [restored, setRestored] = useState<{
    scope: DisplayScope;
    account: RuntimeAccount;
  }>();
  const restoredAccount =
    account === undefined && restored?.scope === scope
      ? restored.account
      : undefined;
  const cache = useMemo<DisplayCache>(
    () => ({
      client,
      scope,
      apiClient,
      restoredAccount,
      key: (resource, parameters) => displayKey(scope, resource, parameters),
    }),
    [client, scope, apiClient, restoredAccount],
  );
  useEffect(() => {
    client.mount();
    return () => {
      client.unmount();
      void client.cancelQueries();
      client.clear();
    };
  }, [client]);
  // Leaving an account drops its reads and data before anything renders for
  // the next one. Public catalogs stay.
  useLayoutEffect(() => {
    const prefix = displayKeyPrefix(scope, scope.account ?? null);
    return () => {
      void client.cancelQueries({ queryKey: prefix });
      client.removeQueries({ queryKey: prefix });
    };
  }, [client, scope]);
  useEffect(
    () =>
      persistDisplayCache(client, scope, persistence, undefined, (owner) => {
        setRestored({ scope, account: owner });
      }),
    [client, scope, persistence],
  );
  useLayoutEffect(() => {
    if (!restored || scope.account === undefined) return;
    if (
      scope.account?.kind === "user" &&
      scope.account.id === restored.account.id
    )
      return;
    client.removeQueries({
      queryKey: displayKeyPrefix(restored.scope, restored.account),
    });
  }, [client, scope, restored]);
  return (
    <DisplayCacheContext.Provider value={cache}>
      {children}
    </DisplayCacheContext.Provider>
  );
}

/** A widget passes its own client explicitly: host/wagmi Query defaults never leak in. */
export function useDisplayQuery<T>(query: DisplayQuery<T>) {
  const runtime = useAomiDisplayCache();
  // Standalone settings components need no host provider.
  const [standalone] = useState(createDisplayQueryClient);
  const client = runtime?.client ?? standalone;
  useEffect(() => {
    if (runtime) return;
    standalone.mount();
    return () => {
      standalone.unmount();
      void standalone.cancelQueries();
      standalone.clear();
    };
  }, [runtime, standalone]);
  return useQuery(toQueryOptions(runtime?.scope ?? null, query), client);
}
