"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createScopedStorage, type AomiAppDescriptor } from "@aomi-labs/client";
import { useAomiDisplayCache } from "../query/display-cache";

const EMPTY: AomiAppDescriptor[] = [];
type Entry = { app: AomiAppDescriptor; key: string };

/** Tab-local credentials, partitioned by backend and account, keyed by exact ID. */
export class PrivateAppStore {
  private entries: Entry[] = [];
  private apps = EMPTY;
  private listeners = new Set<() => void>();
  private storage?: ReturnType<typeof createScopedStorage>;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.apps;
  getKey = (id: number | string) =>
    this.entries.find(({ app }) => String(app.applicationId) === String(id))
      ?.key;
  add = (app: AomiAppDescriptor, key: string) => {
    if (app.applicationId == null || app.isPublic !== false || !key.trim())
      throw new Error("A private application identity and key are required");
    this.entries = [
      ...this.entries.filter(
        ({ app: current }) =>
          String(current.applicationId) !== String(app.applicationId),
      ),
      { app: { ...app, isInstalled: true }, key: key.trim() },
    ];
    this.storage?.setJson("privateApps", this.entries);
    this.publish();
  };
  remove = (id: number | string) => {
    this.entries = this.entries.filter(
      ({ app }) => String(app.applicationId) !== String(id),
    );
    this.storage?.setJson("privateApps", this.entries);
    this.publish();
  };
  persist(backendUrl: string, principal: string) {
    if (this.storage) return;
    let storage: Storage | null = null;
    try {
      storage = globalThis.sessionStorage;
    } catch {
      /* Browser policy. */
    }
    this.storage = createScopedStorage({ backendUrl, principal }, { storage });
    const saved = this.storage.getJson<Entry[]>(
      "privateApps",
      (value): value is Entry[] =>
        Array.isArray(value) &&
        value.every(
          (entry) =>
            entry &&
            typeof entry.key === "string" &&
            entry.app?.isPublic === false &&
            entry.app.applicationId != null &&
            typeof entry.app.name === "string",
        ),
    );
    if (saved) {
      this.entries = saved;
      this.publish();
    }
  }
  private publish() {
    this.apps = this.entries.map(({ app }) => app);
    this.listeners.forEach((listener) => listener());
  }
}

const stores = new Map<string, PrivateAppStore>();
export function usePrivateApps(persistence: "memory" | "session" = "memory") {
  const cache = useAomiDisplayCache();
  const backendUrl = cache?.scope.backendUrl ?? "";
  const account = cache?.scope.account;
  const principal = account ? `${account.kind}:${account.id}` : "anonymous";
  const store = useMemo(() => {
    const id = JSON.stringify([backendUrl, principal]);
    let current = stores.get(id);
    if (!current) {
      current = new PrivateAppStore();
      stores.set(id, current);
    }
    return current;
  }, [backendUrl, principal]);
  useEffect(() => {
    if (persistence === "session") store.persist(backendUrl, principal);
  }, [store, persistence, backendUrl, principal]);
  const apps = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => EMPTY,
  );
  return { apps, add: store.add, remove: store.remove, getKey: store.getKey };
}
