import { useCallback, type MutableRefObject } from "react";
import { secretNamesFrom, type AomiClient } from "@aomi-labs/client";

export type SecretsActions = {
  ingestSecrets: (
    secrets: Record<string, string>,
  ) => Promise<Record<string, string>>;
  clearSecrets: () => Promise<void>;
  deleteSecret: (name: string) => Promise<void>;
  /** Stored handle names for this client. Never values. */
  listSecrets: () => Promise<string[]>;
};


export function useSecretsImpl({ aomiClientRef, clientIdRef, getControlSessionId }: {
  aomiClientRef: MutableRefObject<AomiClient>;
  clientIdRef: MutableRefObject<string | null>;
  getControlSessionId: () => string;
}): SecretsActions {
  const ingestSecrets = useCallback(
    async (
      secrets: Record<string, string>,
    ): Promise<Record<string, string>> => {
      const clientId = clientIdRef.current;
      if (!clientId) throw new Error("clientId not initialized");
      const { handles } = await aomiClientRef.current.ingestSecrets(
        getControlSessionId(),
        clientId,
        secrets,
      );
      return handles;
    },
    [aomiClientRef, clientIdRef, getControlSessionId],
  );

  const clearSecrets = useCallback(async (): Promise<void> => {
    const clientId = clientIdRef.current;
    if (!clientId) return;
    await aomiClientRef.current.clearSecrets?.(getControlSessionId(), clientId);
  }, [aomiClientRef, clientIdRef, getControlSessionId]);

  const deleteSecret = useCallback(
    async (name: string): Promise<void> => {
      const clientId = clientIdRef.current;
      if (!clientId) return;
      await aomiClientRef.current.deleteSecret(
        getControlSessionId(),
        clientId,
        name,
      );
    },
    [aomiClientRef, clientIdRef, getControlSessionId],
  );

  const listSecrets = useCallback(async (): Promise<string[]> => {
    const response = await aomiClientRef.current.listSecrets(
      getControlSessionId(),
      clientIdRef.current ?? undefined,
    );
    return secretNamesFrom(response);
  }, [aomiClientRef, clientIdRef, getControlSessionId]);

  return { ingestSecrets, clearSecrets, deleteSecret, listSecrets };
}
