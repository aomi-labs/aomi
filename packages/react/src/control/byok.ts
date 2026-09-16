// =============================================================================
// useByok — account model-key API + generic secret vault API
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type {
  AomiByokKeyEntry,
  AomiClient,
  AomiInferenceFundingSource,
} from "@aomi-labs/client";
import { secretNamesFrom } from "@aomi-labs/client";

/** The account API's redacted model-key record. Raw keys are never persisted. */
export type StoredByokKey = AomiByokKeyEntry;

export type ByokState = {
  byokKeys: Record<string, StoredByokKey>;
  inferenceFunding?: AomiInferenceFundingSource;
};

export type SecretsActions = {
  ingestSecrets: (
    secrets: Record<string, string>,
  ) => Promise<Record<string, string>>;
  clearSecrets: () => Promise<void>;
  deleteSecret: (name: string) => Promise<void>;
  /** Stored handle names for this client. Never values. */
  listSecrets: () => Promise<string[]>;
};

export type ByokActions = SecretsActions & {
  setByok: (provider: string, apiKey: string, label?: string) => Promise<void>;
  removeByok: (provider: string) => Promise<void>;
  getByokKeys: () => Record<string, StoredByokKey>;
  hasByok: (provider?: string) => boolean;
  /** Selects the account's saved BYOK key for subsequent Agent turns. */
  setInferenceFunding: (
    funding: AomiInferenceFundingSource | undefined,
  ) => void;
};

type UseByokOptions = {
  aomiClientRef: MutableRefObject<AomiClient>;
  clientIdRef: MutableRefObject<string | null>;
  /** Stable getter for the current control-session id (clientId + sessionId). */
  getControlSessionId: () => string;
  initialInferenceFunding?: AomiInferenceFundingSource;
};

/** Provider-internal: owns the BYOK state. Consumers should use the
 *  `useByok` slice reader exported from contexts/control-context.tsx. */
export function useByokImpl({
  aomiClientRef,
  clientIdRef,
  getControlSessionId,
  initialInferenceFunding,
}: UseByokOptions): {
  state: ByokState;
  actions: ByokActions;
} {
  const [byokKeys, setByokKeys] = useState<Record<string, StoredByokKey>>({});
  const [inferenceFunding, setInferenceFunding] = useState<
    AomiInferenceFundingSource | undefined
  >(initialInferenceFunding);

  useEffect(() => {
    if (!clientIdRef.current) return;
    let cancelled = false;
    void aomiClientRef.current
      .listByokKeys(getControlSessionId())
      .then((entries) => {
        if (cancelled) return;
        setByokKeys(
          Object.fromEntries(entries.map((entry) => [entry.provider, entry])),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Failed to load account model keys:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aomiClientRef, clientIdRef, getControlSessionId]);

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

  const setByok = useCallback(
    async (provider: string, apiKey: string, label?: string): Promise<void> => {
      const trimmed = apiKey.trim();
      if (!trimmed) return;
      const entry = await aomiClientRef.current.saveByokKey(
        getControlSessionId(),
        provider,
        trimmed,
        label,
      );
      setByokKeys((prev) => ({ ...prev, [provider]: entry }));
    },
    [aomiClientRef, getControlSessionId],
  );

  const removeByok = useCallback(
    async (provider: string): Promise<void> => {
      await aomiClientRef.current.deleteByokKey(
        getControlSessionId(),
        provider,
      );
      setByokKeys((prev) => {
        const { [provider]: _, ...rest } = prev;
        return rest;
      });
    },
    [aomiClientRef, getControlSessionId],
  );

  const getByokKeys = useCallback(() => byokKeys, [byokKeys]);

  const hasByok = useCallback(
    (provider?: string): boolean =>
      provider ? provider in byokKeys : Object.keys(byokKeys).length > 0,
    [byokKeys],
  );

  return {
    state: { byokKeys, inferenceFunding },
    actions: {
      setByok,
      removeByok,
      getByokKeys,
      hasByok,
      setInferenceFunding,
      ingestSecrets,
      clearSecrets,
      deleteSecret,
      listSecrets,
    },
  };
}
