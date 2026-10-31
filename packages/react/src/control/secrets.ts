import { useCallback, type MutableRefObject } from "react";
import type { Aomi } from "@aomi-labs/client";

export type SecretsActions = {
  ingestSecrets: (
    secrets: Record<string, string>,
  ) => Promise<Record<string, string>>;
  clearSecrets: () => Promise<void>;
  deleteSecret: (name: string) => Promise<void>;
  /** Stored handle names for this client. Never values. */
  listSecrets: () => Promise<string[]>;
};

/** This browser's secrets vault, through `aomi.account.keys`. */
export function useSecretsImpl({
  aomiRef,
  clientIdRef,
  getControlSessionId,
}: {
  aomiRef: MutableRefObject<Aomi>;
  clientIdRef: MutableRefObject<string | null>;
  getControlSessionId: () => string;
}): SecretsActions {
  const scope = useCallback(
    () => ({
      thread: getControlSessionId(),
      clientId: clientIdRef.current ?? undefined,
    }),
    [clientIdRef, getControlSessionId],
  );

  const ingestSecrets = useCallback(
    async (
      secrets: Record<string, string>,
    ): Promise<Record<string, string>> => {
      if (!clientIdRef.current) throw new Error("clientId not initialized");
      return aomiRef.current.account.keys.set(secrets, scope());
    },
    [aomiRef, clientIdRef, scope],
  );

  const clearSecrets = useCallback(async (): Promise<void> => {
    if (clientIdRef.current) await aomiRef.current.account.keys.clear(scope());
  }, [aomiRef, clientIdRef, scope]);

  const deleteSecret = useCallback(
    async (name: string): Promise<void> => {
      if (clientIdRef.current)
        await aomiRef.current.account.keys.remove(name, scope());
    },
    [aomiRef, clientIdRef, scope],
  );

  const listSecrets = useCallback(
    (): Promise<string[]> => aomiRef.current.account.keys.list(scope()),
    [aomiRef, scope],
  );

  return { ingestSecrets, clearSecrets, deleteSecret, listSecrets };
}
