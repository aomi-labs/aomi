/** Browser preference storage. Credentials belong in memory or scoped session storage. */
export type StorageScope = {
  backendUrl: string;
  appId?: string | number | null;
  principal?: string | null;
};
export type ScopedStorage = {
  key(name: string): string;
  get(name: string): string | null;
  set(name: string, value: string): void;
  remove(name: string): void;
  getJson<T>(name: string, guard: (value: unknown) => value is T): T | null;
  setJson(name: string, value: unknown): void;
  migrate(name: string, legacyKey: string): string | null;
  withPrincipal(principal: string | null): ScopedStorage;
};
function part(value: unknown): string {
  return encodeURIComponent(String(value ?? "").trim() || "default");
}
function backend(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}
export function createScopedStorage(
  scope: StorageScope,
  options?: { storage?: Storage | null },
): ScopedStorage {
  const resolve = (): Storage | null => {
    try {
      return options && "storage" in options
        ? (options.storage ?? null)
        : (globalThis.localStorage ?? null);
    } catch {
      return null;
    }
  };
  const prefix = [
    "aomi",
    "v2",
    part(backend(scope.backendUrl)),
    part(scope.appId),
    ...(scope.principal ? [part(scope.principal)] : []),
  ].join(":");
  const key = (name: string) => `${prefix}:${name}`;
  const get = (name: string): string | null => {
    try {
      return resolve()?.getItem(key(name)) ?? null;
    } catch {
      return null;
    }
  };
  const set = (name: string, value: string) => {
    try {
      resolve()?.setItem(key(name), value);
    } catch {
      /* Preferences are optional. */
    }
  };
  const remove = (name: string) => {
    try {
      resolve()?.removeItem(key(name));
    } catch {
      /* Storage can be denied. */
    }
  };
  return {
    key,
    get,
    set,
    remove,
    getJson(name, guard) {
      try {
        const value: unknown = JSON.parse(get(name) ?? "null");
        return guard(value) ? value : null;
      } catch {
        return null;
      }
    },
    setJson(name, value) {
      try {
        set(name, JSON.stringify(value));
      } catch {
        /* Invalid value. */
      }
    },
    migrate(name, legacyKey) {
      const current = get(name);
      if (current !== null) return current;
      try {
        const storage = resolve();
        const value = storage?.getItem(legacyKey) ?? null;
        if (value !== null && storage) {
          storage.setItem(key(name), value);
          storage.removeItem(legacyKey);
        }
        return value;
      } catch {
        return null;
      }
    },
    withPrincipal(principal) {
      return createScopedStorage({ ...scope, principal }, options);
    },
  };
}
