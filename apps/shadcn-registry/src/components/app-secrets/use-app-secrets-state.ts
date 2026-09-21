"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AomiSecretSlot,
  AomiUserAppSecretSlot,
  AomiUserAppSecrets,
  ApplicationId,
} from "@aomi-labs/client";

export type AppSecretOperations = {
  list: (
    applicationId: Exclude<ApplicationId, null>,
  ) => Promise<AomiUserAppSecrets>;
  save: (
    applicationId: Exclude<ApplicationId, null>,
    secrets: Record<string, string>,
  ) => Promise<AomiUserAppSecrets>;
  remove: (
    applicationId: Exclude<ApplicationId, null>,
    name: string,
  ) => Promise<unknown>;
};

type UseAppSecretsStateOptions = {
  scopeKey: string;
  applicationId: ApplicationId | null | undefined;
  enabled: boolean;
  declaredSlots: readonly AomiSecretSlot[];
  operations: AppSecretOperations;
};

export function appSecretsReady(status: AomiUserAppSecrets): boolean {
  return (
    status.ready ??
    status.slots.every((slot) => !slot.required || slot.configured)
  );
}

/**
 * One scoped owner for the credential lifecycle shared by Library and the
 * composer: status loading, stale-response rejection, drafts, mutations, and
 * refresh. Layout-specific open/close and value-visibility state stays with
 * the rendering component.
 */
export function useAppSecretsState({
  scopeKey,
  applicationId,
  enabled,
  declaredSlots,
  operations,
}: UseAppSecretsStateOptions) {
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const requestRevisionRef = useRef(0);
  const [status, setStatus] = useState<AomiUserAppSecrets | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<AomiUserAppSecrets | null> => {
    if (!enabled || applicationId == null) return null;
    const requestScope = scopeKey;
    const revision = ++requestRevisionRef.current;
    try {
      const next = await operationsRef.current.list(applicationId);
      if (
        scopeRef.current === requestScope &&
        requestRevisionRef.current === revision
      ) {
        setStatus(next);
        setError(null);
      }
      return next;
    } catch (cause) {
      if (
        scopeRef.current === requestScope &&
        requestRevisionRef.current === revision
      ) {
        setStatus(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn’t load saved credentials.",
        );
      }
      return null;
    }
  }, [applicationId, enabled, scopeKey]);

  useEffect(() => {
    requestRevisionRef.current += 1;
    setDrafts({});
    setStatus(null);
    setError(null);
    setBusyName(null);
    if (!enabled || applicationId == null) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    void refresh().finally(() => {
      if (current && scopeRef.current === scopeKey) setLoading(false);
    });
    return () => {
      current = false;
      requestRevisionRef.current += 1;
    };
  }, [applicationId, enabled, refresh, scopeKey]);

  const slots = useMemo<AomiUserAppSecretSlot[]>(
    () =>
      status?.slots.filter((slot) => slot.user_own !== false) ??
      declaredSlots.map((slot) => ({
        ...slot,
        configured: false,
        app_provided: false,
      })),
    [declaredSlots, status],
  );
  const pending = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(drafts)
          .map(([name, value]) => [name, value.trim()])
          .filter((entry) => entry[1].length > 0),
      ),
    [drafts],
  );

  const save = useCallback(async (): Promise<AomiUserAppSecrets | null> => {
    if (applicationId == null || Object.keys(pending).length === 0)
      return status;
    const requestScope = scopeKey;
    setBusyName("save");
    setError(null);
    try {
      const next = await operationsRef.current.save(applicationId, pending);
      if (scopeRef.current !== requestScope) return null;
      setStatus(next);
      setDrafts({});
      return next;
    } catch (cause) {
      if (scopeRef.current === requestScope) {
        setError(
          cause instanceof Error ? cause.message : "Couldn’t save credentials.",
        );
      }
      return null;
    } finally {
      if (scopeRef.current === requestScope) setBusyName(null);
    }
  }, [applicationId, pending, scopeKey, status]);

  const remove = useCallback(
    async (name: string): Promise<boolean> => {
      if (applicationId == null) return false;
      const requestScope = scopeKey;
      setBusyName(name);
      setError(null);
      try {
        await operationsRef.current.remove(applicationId, name);
        const next = await operationsRef.current.list(applicationId);
        if (scopeRef.current !== requestScope) return false;
        setStatus(next);
        return true;
      } catch (cause) {
        if (scopeRef.current === requestScope) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t remove the saved credential.",
          );
        }
        return false;
      } finally {
        if (scopeRef.current === requestScope) setBusyName(null);
      }
    },
    [applicationId, scopeKey],
  );

  const retry = useCallback(async () => {
    setLoading(true);
    await refresh();
    if (scopeRef.current === scopeKey) setLoading(false);
  }, [refresh, scopeKey]);

  return {
    status,
    slots,
    drafts,
    setDraft: (name: string, value: string) =>
      setDrafts((current) => ({ ...current, [name]: value })),
    clearDrafts: () => setDrafts({}),
    pending,
    hasPending: Object.keys(pending).length > 0,
    loading,
    busyName,
    busy: busyName !== null,
    error,
    setError,
    refresh,
    retry,
    save,
    remove,
  };
}
