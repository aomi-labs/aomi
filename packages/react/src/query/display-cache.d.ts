import { type ReactNode } from "react";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import type { AomiClient } from "@aomi-labs/client";
import { type DisplayPersistence } from "./display-persistence";
/** Who the runtime talks to the backend as. */
export type RuntimeAccount = {
    kind: "guest" | "user";
    id: string;
};
export type DisplayResource = "models" | "app-catalog" | "skills" | "authorized-models" | "authorized-apps" | "profile" | "credits" | "account-acl" | "account-apps" | "transaction-safety" | "usage";
export declare const isPublicCatalog: (resource: DisplayResource) => boolean;
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
    key: (resource: DisplayResource, parameters?: readonly unknown[]) => QueryKey;
};
export declare function createDisplayQueryClient(): QueryClient;
/** The key prefix of everything one account may see. Public catalogs share one prefix. */
export declare function displayKeyPrefix(scope: DisplayScope, owner: "public" | RuntimeAccount | null): QueryKey;
export declare function displayKey(scope: DisplayScope, resource: DisplayResource, parameters?: readonly unknown[]): QueryKey;
/** Read a display resource through the cache without subscribing to it. */
export declare function fetchDisplayQuery<T>(cache: DisplayCache, query: DisplayQuery<T>): Promise<T>;
export declare const useAomiDisplayCache: () => DisplayCache | null;
export declare function DisplayCacheProvider({ backendUrl, applicationId, account, persistence, apiClient, children, }: {
    backendUrl: string;
    applicationId?: number | string | null;
    account?: RuntimeAccount | null;
    persistence?: DisplayPersistence;
    apiClient?: AomiClient;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
/** A widget passes its own client explicitly: host/wagmi Query defaults never leak in. */
export declare function useDisplayQuery<T>(query: DisplayQuery<T>): import("@tanstack/react-query").UseQueryResult<import("@tanstack/react-query").NoInfer<T>, Error>;
