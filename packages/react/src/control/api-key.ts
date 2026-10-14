import { useCallback, useEffect, useMemo, useState } from "react";
import { createScopedStorage, type StorageScope } from "@aomi-labs/client";

export type ApiKeyState = { apiKey: string | null };
export type ApiKeyActions = { setApiKey: (apiKey: string | null) => void };

/**
 * Memory is the default. Hosts can retain a credential for this tab explicitly.
 * `revision` changes whenever the key does, so reads made with it can be keyed
 * without putting the key itself in a cache key.
 */
export function useApiKeyImpl(
  scope: StorageScope = { backendUrl: "" },
  persistence: "memory" | "session" = "memory",
): { state: ApiKeyState; actions: ApiKeyActions; revision: number } {
  const storage = useMemo(() => {
    let session: Storage | null = null;
    try {
      session = globalThis.sessionStorage;
    } catch {
      /* Browser policy. */
    }
    return createScopedStorage(scope, {
      storage: persistence === "session" ? session : null,
    });
  }, [scope.backendUrl, scope.appId, scope.principal, persistence]);
  const [{ apiKey, revision }, setCredential] = useState({
    apiKey: null as string | null,
    revision: 0,
  });
  const setApiKeyInternal = useCallback(
    (next: string | null) =>
      setCredential((current) =>
        current.apiKey === next
          ? current
          : { apiKey: next, revision: current.revision + 1 },
      ),
    [],
  );
  useEffect(() => {
    let legacy: string | null = null;
    try {
      legacy = globalThis.localStorage?.getItem("aomi_secret_key") ?? null;
      globalThis.localStorage?.removeItem("aomi_secret_key");
    } catch {
      /* Browser policy. */
    }
    const restored = storage.get("apiKey") ?? legacy;
    setApiKeyInternal(restored?.trim() || null);
    if (restored) storage.set("apiKey", restored);
  }, [storage, setApiKeyInternal]);
  const setApiKey = useCallback(
    (next: string | null) => {
      const value = next?.trim() || null;
      setApiKeyInternal(value);
      if (value) storage.set("apiKey", value);
      else storage.remove("apiKey");
    },
    [storage, setApiKeyInternal],
  );
  return { state: { apiKey }, actions: { setApiKey }, revision };
}
