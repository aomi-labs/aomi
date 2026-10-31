// =============================================================================
// useAppSecrets — the signed-in user's own keys for an app
// =============================================================================
//
// Apps can ask each signed-in user for their own credentials. The backend keeps
// those values in a per-user, per-application key set
// (`/v1/account/apps/:id/secrets`) and injects them only for that user's runs.
//
// This is deliberately NOT part of `useByok`: that hook is the ephemeral,
// browser-scoped vault (`ingestSecrets`), while these keys are account-scoped
// and durable. No local state either — the backend answer is the truth, and
// the dialog that renders it fetches on open.

import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type {
  Aomi,
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

/** Provider-internal. Consumers use the `useAppSecrets` slice reader exported
 *  from contexts/control-context.tsx. */
export function useAppSecretsImpl({
  aomiRef,
}: {
  aomiRef: MutableRefObject<Aomi>;
}): { actions: AppSecretsActions } {
  const credentials = useCallback(
    (applicationId: ApplicationId) =>
      aomiRef.current.account.apps.credentials(Number(applicationId)),
    [aomiRef],
  );

  const listAppSecrets = useCallback(
    (applicationId: ApplicationId) => credentials(applicationId).list(),
    [credentials],
  );

  const saveAppSecrets = useCallback(
    (applicationId: ApplicationId, secrets: Record<string, string>) =>
      credentials(applicationId).save(secrets),
    [credentials],
  );

  const deleteAppSecret = useCallback(
    async (applicationId: ApplicationId, name: string) =>
      (await credentials(applicationId).remove(name)).deleted,
    [credentials],
  );

  const clearAppSecrets = useCallback(
    async (applicationId: ApplicationId) => {
      await credentials(applicationId).clear();
    },
    [credentials],
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
