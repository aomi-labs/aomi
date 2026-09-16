// =============================================================================
// useAppSecrets — the signed-in user's own keys for an app
// =============================================================================
//
// An app that wraps an account-bound venue (an exchange, a prediction market)
// trades the key owner's own account. The backend therefore keeps a per-user,
// per-application key set (`/api/account/apps/:id/secrets`) and layers it
// over the app's shared environment on that user's threads.
//
// This is deliberately NOT part of `useByok`: that hook is the ephemeral,
// browser-scoped vault (`ingestSecrets`), while these keys are account-scoped
// and durable. No local state either — the backend answer is the truth, and
// the dialog that renders it fetches on open.

import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type {
  AomiClient,
  AomiUserAppSecrets,
  ApplicationId,
} from "@aomi-labs/client";

export type AppSecretsActions = {
  /** Declared slots with `configured` / `app_provided` flags. Never values. */
  listAppSecrets: (applicationId: ApplicationId) => Promise<AomiUserAppSecrets>;
  /** Upsert some slots; omitted slots are left as they are. */
  saveAppSecrets: (
    applicationId: ApplicationId,
    secrets: Record<string, string>,
  ) => Promise<AomiUserAppSecrets>;
  /** Remove one stored value. Resolves to whether a value existed. */
  deleteAppSecret: (
    applicationId: ApplicationId,
    name: string,
  ) => Promise<boolean>;
  /** Remove every value the account stored for the app. */
  clearAppSecrets: (applicationId: ApplicationId) => Promise<void>;
};

type UseAppSecretsOptions = {
  aomiClientRef: MutableRefObject<AomiClient>;
  /** Stable getter for the current control-session id (clientId + sessionId). */
  getControlSessionId: () => string;
};

/** Provider-internal. Consumers use the `useAppSecrets` slice reader exported
 *  from contexts/control-context.tsx. */
export function useAppSecretsImpl({
  aomiClientRef,
  getControlSessionId,
}: UseAppSecretsOptions): { actions: AppSecretsActions } {
  const listAppSecrets = useCallback(
    (applicationId: ApplicationId) =>
      aomiClientRef.current.listAppSecrets(
        getControlSessionId(),
        applicationId,
      ),
    [aomiClientRef, getControlSessionId],
  );

  const saveAppSecrets = useCallback(
    (applicationId: ApplicationId, secrets: Record<string, string>) =>
      aomiClientRef.current.saveAppSecrets(
        getControlSessionId(),
        applicationId,
        secrets,
      ),
    [aomiClientRef, getControlSessionId],
  );

  const deleteAppSecret = useCallback(
    async (applicationId: ApplicationId, name: string) => {
      const { deleted } = await aomiClientRef.current.deleteAppSecret(
        getControlSessionId(),
        applicationId,
        name,
      );
      return deleted;
    },
    [aomiClientRef, getControlSessionId],
  );

  const clearAppSecrets = useCallback(
    async (applicationId: ApplicationId) => {
      await aomiClientRef.current.clearAppSecrets(
        getControlSessionId(),
        applicationId,
      );
    },
    [aomiClientRef, getControlSessionId],
  );

  return {
    actions: {
      listAppSecrets,
      saveAppSecrets,
      deleteAppSecret,
      clearAppSecrets,
    },
  };
}
