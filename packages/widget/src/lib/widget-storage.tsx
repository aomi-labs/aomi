"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createScopedStorage,
  type StorageScope,
  type ScopedStorage,
} from "@aomi-labs/client";

const StorageContext = createContext<ScopedStorage | null>(null);
const defaultStorage = createScopedStorage({ backendUrl: "" });
export const useWidgetStorage = () =>
  useContext(StorageContext) ?? defaultStorage;
export function WidgetStorageProvider({
  scope,
  children,
}: {
  scope: StorageScope;
  children: ReactNode;
}) {
  const storage = useMemo(
    () => createScopedStorage(scope),
    [scope.backendUrl, scope.appId, scope.principal],
  );
  return (
    <StorageContext.Provider value={storage}>
      {children}
    </StorageContext.Provider>
  );
}
/** Keeps historical preference API signatures while migrating the underlying keys. */
export function preferenceStorage(storage: ScopedStorage) {
  return {
    getItem: (key: string) => storage.migrate(key, key),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.remove(key),
  };
}
