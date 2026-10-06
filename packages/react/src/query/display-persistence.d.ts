import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { type DisplayResource, type DisplayScope } from "./display-cache";
/**
 * What a runtime saves across reloads: nothing, the public catalogs, or the
 * public catalogs plus the signed-in user's display profile.
 */
export type DisplayPersistence = "none" | "public" | "account";
type SavedQuery = {
    resource: DisplayResource;
    parameters: unknown[];
    data: unknown;
    updatedAt: number;
};
export type SavedDisplayData = {
    schema: string;
    savedAt: number;
    accountId?: string;
    queries: SavedQuery[];
};
export declare function savedDisplayData(resource: DisplayResource, value: unknown): unknown;
export declare function snapshotDisplayData(client: QueryClient, prefix: QueryKey, accountId?: string): SavedDisplayData;
export declare function restoreDisplayData(client: QueryClient, prefix: QueryKey, value: unknown, accountId?: string): void;
/** Where saved copies live. IndexedDB in browsers; tests pass a map. */
export type SavedCopyStore = {
    get(key: string): Promise<unknown>;
    put(key: string, value: SavedDisplayData): Promise<unknown>;
    delete(key: string): Promise<unknown>;
};
export declare function persistDisplayCache(client: QueryClient, scope: DisplayScope, persistence: DisplayPersistence, store?: SavedCopyStore | null): () => void;
export {};
